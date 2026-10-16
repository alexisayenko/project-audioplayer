"""Metadata backfill: the Add form's "Get metadata" for every song whose audio is on the server, filling only empty fields.

One job at a time server-wide, run in a background thread, one song after another with a pause that grows after failures.
State lives in memory only; each song is stamped `metadata_checked_at` so a song with nothing to find is not asked again."""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

from . import deps, genre_filter, genre_lookup, library, metadata, wiki_lookup
from .tags import namespace

log = logging.getLogger(__name__)

MAX_PAUSE = 30.0
MAX_SOURCES = 5
_lock = threading.Lock()
_jobs: dict[str, Job] = {}
_active: str | None = None
GENRE_CAP = 12
COUNTRY_CAP = 1


def _sleep() -> float:
    try:
        return max(0.0, float(os.environ.get("AUDIO_METADATA_SLEEP", "1.5")))
    except ValueError:
        return 1.5


class Job:
    def __init__(self, uid: str, total: int) -> None:
        self.uid = uid
        self.state = "running"
        self.total = total
        self.updated = 0
        self.nothing = 0
        self.failed = 0
        self.skipped = 0
        self.started_at = library.now_utc()
        self.finished_at: str | None = None
        self.last_error: str | None = None
        self.cancel = threading.Event()
        self.thread: threading.Thread | None = None


def _blank(value: Any) -> bool:
    return not str(value if value is not None else "").strip()


def _needs(song: dict[str, Any]) -> bool:
    tags = song.get("tags") or []
    return _blank(song.get("album")) or _blank(song.get("year")) or not any(namespace(t) == "genre" for t in tags)


def candidates(uid: str) -> list[str]:
    """Ids of songs with audio on the server, missing an album, year or genre, not yet checked."""
    root = deps.audio_dir(uid)
    return [s["id"] for s in deps.load_songs(uid)
            if library.has_file(s) and (root / library.file_name(s)).is_file() and not s.get("metadata_checked_at") and _needs(s)]


def status(uid: str) -> dict[str, Any]:
    job = _jobs.get(uid)
    cand = len(candidates(uid))
    if job is None:
        return {"state": "idle", "candidates": cand, "total": 0, "updated": 0, "nothing": 0, "failed": 0, "skipped": 0,
                "started_at": None, "finished_at": None}
    out = {"state": job.state, "candidates": cand, "total": job.total, "updated": job.updated, "nothing": job.nothing,
           "failed": job.failed, "skipped": job.skipped, "started_at": job.started_at, "finished_at": job.finished_at}
    if job.last_error:
        out["last_error"] = job.last_error
    return out


def start(uid: str) -> tuple[str, dict[str, Any] | None]:
    """('started', state) | ('nothing', state) | ('running', None) | ('busy', None)."""
    global _active
    with _lock:
        if _active is not None:
            return ("running" if _active == uid else "busy"), None
        ids = candidates(uid)
        if not ids:
            return "nothing", status(uid)
        job = Job(uid, len(ids))
        _jobs[uid] = job
        _active = uid
        job.thread = threading.Thread(target=_run, args=(job, ids), name="metadata-backfill", daemon=True)
        job.thread.start()
    return "started", status(uid)


def cancel(uid: str) -> dict[str, Any]:
    job = _jobs.get(uid)
    if job is not None and job.state == "running":
        job.cancel.set()
    return status(uid)


def reset() -> None:
    global _active
    for job in _jobs.values():
        job.cancel.set()
        if job.thread is not None:
            job.thread.join(5)
    _jobs.clear()
    _active = None


def _urls(song: dict[str, Any]) -> list[str]:
    return [s["url"] for s in library.sources_of(song) if s.get("url")][:MAX_SOURCES]


def _fetch(song: dict[str, Any]) -> dict[str, Any]:
    from .routes.lookup import source_info

    urls = _urls(song)
    fetchers = [(lambda u=u: source_info(u)) for u in urls]
    return metadata.gather(str(song.get("title") or "").strip(), str(song.get("artist") or "").strip(), fetchers,
                           song.get("wikipedia_song"), song.get("wikipedia_artist"), metadata.TIMEOUT, urls, song.get("wikipedia_album"))


def _add_tags(have: list[str], found: list[str]) -> list[str]:
    caps = {"genre": GENRE_CAP, "country": COUNTRY_CAP}
    out = list(have)
    added: list[str] = []
    for raw in genre_filter.only_canonical([str(r) for r in found]):
        t = str(raw).strip().lower()
        ns = namespace(t)
        if ns not in caps or t.endswith(":") or any(x.lower() == t for x in out):
            continue
        if sum(1 for x in out if namespace(x) == ns) >= caps[ns]:
            continue
        out.append(t)
        added.append(t)
    return added


def apply(song: dict[str, Any], resp: dict[str, Any]) -> bool:
    """Write `resp` into `song`, empty fields only; tags are added. True when something changed."""
    changed = False
    album = resp.get("album")
    if isinstance(album, str) and album.strip() and _blank(song.get("album")):
        song["album"] = album.strip()
        changed = True
    year = resp.get("year")
    if isinstance(year, int) and not isinstance(year, bool) and _blank(song.get("year")):
        song["year"] = year
        changed = True
    tags = library.clean_tags(song.get("tags") or [])
    added = _add_tags(tags, resp.get("tags") or [])
    if added:
        song["tags"] = library.clean_tags([*tags, *added])
        changed = True
    if library.decade_tag(song.get("year")):
        song["tags"] = library.with_decade(song.get("tags") or [], song["year"])
    wiki_album = wiki_lookup.clean_link(resp.get("wikipedia_album"))
    if wiki_album and _blank(song.get("wikipedia_album")):
        song["wikipedia_album"] = wiki_album
        changed = True
    mb = ((resp.get("services") or {}).get("musicbrainz") or {}).get("url")
    mb = genre_lookup.clean_recording_url(mb) if mb else None
    if mb and _blank(song.get("musicbrainz_url")):
        song["musicbrainz_url"] = mb
        changed = True
    return changed


def _process(uid: str, vid: str) -> str:
    """'updated' | 'nothing' | 'skipped' | 'failed'."""
    song = library.find_song(deps.load_songs(uid), vid)
    if song is None or song.get("metadata_checked_at") or not library.has_file(song) or not (deps.audio_dir(uid) / library.file_name(song)).is_file():
        return "skipped"
    try:
        resp = _fetch(song)
    except Exception as exc:
        log.warning("metadata backfill failed for %s: %s", vid, exc)
        return "failed"
    with deps.tx(uid, f"get metadata for {vid}"):
        songs = library.load(deps.library_path(uid))
        fresh = library.find_song(songs, vid)
        if fresh is None:
            return "skipped"
        changed = apply(fresh, resp)
        fresh["metadata_checked_at"] = library.now_utc()
        if changed:
            fresh["updated_at"] = library.now_utc()
        deps.save_songs(uid, songs)
    return "updated" if changed else "nothing"


def _run(job: Job, ids: list[str]) -> None:
    global _active
    try:
        pause = _sleep()
        for vid in ids:
            if job.cancel.is_set():
                break
            outcome = _process(job.uid, vid)
            setattr(job, outcome, getattr(job, outcome) + 1)
            pause = min(MAX_PAUSE, max(pause, 1.0) * 2) if outcome == "failed" else _sleep()
            if job.cancel.wait(pause):
                break
        job.state = "cancelled" if job.cancel.is_set() else "done"
    except Exception as exc:
        log.exception("metadata backfill crashed")
        job.last_error = str(exc)[:200]
        job.state = "error"
    finally:
        job.finished_at = library.now_utc()
        with _lock:
            if _active == job.uid:
                _active = None
