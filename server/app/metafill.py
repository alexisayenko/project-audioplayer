"""Metadata backfill: the Add form's "Get metadata" for every song whose audio is on the server, filling only empty fields.

One job at a time server-wide, run in a background thread, one song after another with a pause that grows after failures.
State lives in memory only; each song is stamped `metadata_checked_at` so a song with nothing to find is not asked again."""

from __future__ import annotations

import logging
import os
from typing import Any

from . import backgroundjob, credits, deps, genre_filter, genre_lookup, library, metadata, wiki_lookup
from .links import source_info
from .tags import namespace

log = logging.getLogger(__name__)

MAX_PAUSE = 30.0
MAX_SOURCES = 5
GENRE_CAP = 12
COUNTRY_CAP = 1


def _sleep() -> float:
    try:
        return max(0.0, float(os.environ.get("AUDIO_METADATA_SLEEP", "1.5")))
    except ValueError:
        return 1.5


def _blank(value: Any) -> bool:
    return not str(value if value is not None else "").strip()


def _needs(song: dict[str, Any]) -> bool:
    tags = song.get("tags") or []
    return (not credits.albums(song) and not credits.has_version(song)) or _blank(song.get("releaseYear")) or not any(namespace(t) == "genre" for t in tags)


def candidates(uid: str) -> list[str]:
    """Ids of songs with audio on the server, missing an album, year or genre, not yet checked."""
    root = deps.audio_dir(uid)
    return [s["id"] for s in deps.load_songs(uid)
            if library.has_file(s) and (root / library.file_name(s)).is_file() and not s.get("metadata_checked_at") and _needs(s)]


def _urls(song: dict[str, Any]) -> list[str]:
    return [s["url"] for s in library.sources_of(song) if s.get("url")][:MAX_SOURCES]


def _fetch(song: dict[str, Any]) -> dict[str, Any]:
    urls = _urls(song)
    fetchers = [(lambda u=u: source_info(u)) for u in urls]
    version = song.get("version") if credits.has_version(song) else None
    return metadata.gather(str(song.get("title") or "").strip(), credits.lookup_artist(song).strip(), fetchers,
                           song.get("wikipedia_song"), song.get("wikipedia_artist"), metadata.TIMEOUT, urls, song.get("wikipedia_album"),
                           **({"version_kind": version["type"]} if version else {}))


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
    """Write `resp` into `song`, empty fields only; genre tags and, for a song without one, a country are added. True when something changed."""
    changed = False
    version = credits.has_version(song)
    album = resp.get("album")
    if not version and isinstance(album, str) and album.strip() and not credits.albums(song):
        song["albums"] = [album.strip()]
        changed = True
    year = resp.get("year")
    if isinstance(year, int) and not isinstance(year, bool) and _blank(song.get("releaseYear")):
        song["releaseYear"] = year
        changed = True
    tags = library.clean_tags(song.get("tags") or [])
    added = _add_tags(tags, resp.get("tags") or [])
    if added:
        song["tags"] = library.clean_tags([*tags, *added])
        changed = True
    wiki_album = wiki_lookup.clean_link(resp.get("wikipedia_album"))
    if not version and wiki_album and _blank(song.get("wikipedia_album")):
        song["wikipedia_album"] = wiki_album
        changed = True
    mb = ((resp.get("services") or {}).get("musicbrainz") or {}).get("url")
    mb = genre_lookup.clean_recording_url(mb) if mb else None
    if not version and mb and _blank(song.get("musicbrainz_url")):
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
        doc = deps.load_doc(uid)
        fresh = library.find_song(doc["songs"], vid)
        if fresh is None:
            return "skipped"
        changed = apply(fresh, resp)
        fresh["metadata_checked_at"] = library.now_utc()
        if changed:
            fresh["updated_at"] = library.now_utc()
        deps.save_doc(uid, doc)
    return "updated" if changed else "nothing"


def _work(job: backgroundjob.Job, ids: list[str]) -> None:
    pause = _sleep()
    for vid in ids:
        if job.cancel.is_set():
            break
        outcome = _process(job.uid, vid)
        setattr(job, outcome, getattr(job, outcome) + 1)
        pause = min(MAX_PAUSE, max(pause, 1.0) * 2) if outcome == "failed" else _sleep()
        if job.cancel.wait(pause):
            break


_runner = backgroundjob.Runner("metadata backfill", ("updated", "nothing", "failed", "skipped"), candidates, _work)
_jobs = _runner.jobs
status = _runner.status
start = _runner.start
cancel = _runner.cancel
reset = _runner.reset
