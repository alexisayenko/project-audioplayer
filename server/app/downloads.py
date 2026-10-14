"""Background audio downloads: job bookkeeping, the download workers and the metadata-only add."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from . import bpm, deps, discogs_lookup, extractor, genre_lookup, identify, jobs, library, limits, wiki_lookup
from .links import Resolved, short_error
from .problems import Problem

log = logging.getLogger(__name__)


def new_job() -> dict[str, Any]:
    return {"status": "queued", "progress": 0.0, "error": None}


def mark_started(key: tuple[str, str]) -> Callable[[], None]:
    def started() -> None:
        job = deps.JOBS.get(key)
        if job is not None:
            job["status"] = "downloading"

    return started


def run_scheduled(uid: str, owner: bool, fn: Callable[[], Any]) -> Any:
    """Run `fn` under the download caps and wait for its result (for the synchronous /download)."""
    done = threading.Event()
    box: dict[str, Any] = {}

    def run() -> None:
        try:
            box["value"] = fn()
        except Exception as exc:
            box["error"] = exc
        finally:
            done.set()

    deps.SCHED.submit(uid, owner, run, lambda: None)
    done.wait()
    if "error" in box:
        raise box["error"]
    if "value" not in box:
        raise RuntimeError("download worker stopped before finishing")
    return box["value"]


def identifiable_song(uid: str, vid: str) -> dict[str, Any] | None:
    song = library.find_song(deps.load_songs(uid), vid)
    if song is None or not library.has_file(song) or not (deps.audio_dir(uid) / library.file_name(song)).is_file():
        return None
    return song


def auto_identify(uid: str, vid: str) -> None:
    """Once after a download: identify in the background. Not an add (no hourly-limit charge); skipped when no source is configured."""
    try:
        if not identify.configured():
            return

        def run() -> None:
            song = identifiable_song(uid, vid)
            if song is not None:
                identify.run_cached(uid, vid, song, deps.audio_dir(uid) / library.file_name(song))

        deps.SCHED.submit(uid, True, run, lambda: None)
    except Exception as exc:
        log.warning("auto identify skipped for %s: %s", vid, type(exc).__name__)


def _drop_partial(out: Path | None, vid: str) -> None:
    if out is not None:
        (out / f"{vid}.m4a").unlink(missing_ok=True)


def _fail_job(job: dict[str, Any], out: Path | None, vid: str, exc: Exception) -> None:
    _drop_partial(out, vid)
    if isinstance(exc, extractor.PreviewOnly):
        job.update(status="error", error=str(exc), code="preview_only")
    elif isinstance(exc, Problem):
        job.update(status="error", error=exc.detail, code=exc.code)
    else:
        job.update(status="error", error=short_error(exc))


def _fetch_cover(uid: str, vid: str, thumbnail: str | None) -> str | None:
    try:
        extractor.fetch_cover(vid, deps.covers_dir(uid) / f"{vid}.jpg", thumbnail)
    except Exception:
        return None
    return f"covers/{vid}.jpg"


def _detect_bpm(path: Path, vid: str) -> float | None:
    try:
        return bpm.detect_bpm(path)
    except Exception as exc:
        log.warning("bpm detection failed for %s: %s", vid, exc)
        return None


def _link_fields(vid: str, meta: dict[str, Any], source_url: str | None) -> dict[str, Any]:
    """The reference fields of a new song record: cleaned links, the source and its URL."""
    url = extractor.watch_url(vid, source_url)
    return {
        "wikipedia_song": wiki_lookup.clean_link(meta.get("wikipedia_song")),
        "wikipedia_artist": wiki_lookup.clean_link(meta.get("wikipedia_artist")),
        "musicbrainz_url": genre_lookup.clean_recording_url(meta.get("musicbrainz_url")),
        "discogs_url": discogs_lookup.clean_url(meta.get("discogs_url")),
        **({"source": "soundcloud"} if extractor.source_of(vid) == "soundcloud" else {}),
        "source_url": url,
        "sources": [{"source": extractor.source_of(vid), "id": vid, "url": url}],
    }


def _downloaded_song(uid: str, owner: bool, out: Path, vid: str, meta: dict[str, Any], tags: list[str],
                     source_url: str | None, job: dict[str, Any]) -> dict[str, Any]:
    limits.check_capacity(owner, out, deps.pool_dir())
    info = extractor.download_audio(vid, out, jobs.Tracker(job), source_url)
    cover = _fetch_cover(uid, vid, info.get("thumbnail"))
    value = round(meta["bpm"]) if meta.get("bpm") is not None else _detect_bpm(out / f"{vid}.m4a", vid)
    return {
        "id": vid,
        "title": meta.get("title") or info.get("title") or vid,
        "artist": meta.get("artist") or info.get("artist"),
        "album": meta.get("album"),
        "remixer": meta.get("remixer"),
        "year": meta.get("year"),
        "remix_year": meta.get("remix_year"),
        "bpm": value,
        **_link_fields(vid, meta, source_url),
        "file": f"{vid}.m4a",
        "cover": cover,
        "duration": info.get("duration"),
        "added_at": library.now_utc(),
        "tags": library.with_decade(tags, meta.get("year")),
    }


def run_download(uid: str, owner: bool, vid: str, meta: dict[str, Any], tags: list[str],
                 source_url: str | None = None) -> None:
    job = deps.JOBS[(uid, vid)]
    out: Path | None = None
    try:
        out = deps.audio_dir(uid)
        song = _downloaded_song(uid, owner, out, vid, meta, tags, source_url, job)
        with deps.tx(uid, f"add {vid}"):
            songs = [s for s in library.load(deps.library_path(uid)) if s["id"] != vid]
            deps.save_songs(uid, songs + [song])
        job.update(status="done", progress=1.0)
        auto_identify(uid, vid)
    except Exception as exc:
        _fail_job(job, out, vid, exc)


def run_fetch_audio(uid: str, owner: bool, vid: str, source_url: str | None) -> None:
    """Download audio for a song already in the catalog and attach it to the record."""
    job = deps.JOBS[(uid, vid)]
    out: Path | None = None
    try:
        out = deps.audio_dir(uid)
        limits.check_capacity(owner, out, deps.pool_dir())
        info = extractor.download_audio(vid, out, jobs.Tracker(job), source_url)
        value = _detect_bpm(out / f"{vid}.m4a", vid)
        cover_ok = (deps.covers_dir(uid) / f"{vid}.jpg").is_file() or _fetch_cover(uid, vid, info.get("thumbnail")) is not None
        with deps.tx(uid, f"audio {vid}"):
            songs = library.load(deps.library_path(uid))
            song = library.find_song(songs, vid)
            if song is None:
                raise Problem(404, "unknown_song", deps.UNKNOWN_SONG)
            song["file"] = f"{vid}.m4a"
            if info.get("duration") and not song.get("duration"):
                song["duration"] = info["duration"]
            if song.get("bpm") is None and value is not None:
                song["bpm"] = round(value)
            if cover_ok and not song.get("cover"):
                song["cover"] = f"covers/{vid}.jpg"
            song["updated_at"] = library.now_utc()
            deps.save_songs(uid, songs)
        job.update(status="done", progress=1.0)
        auto_identify(uid, vid)
    except Exception as exc:
        _fail_job(job, out, vid, exc)


def _known_country_tags(tags: list[str]) -> list[str]:
    bad = set(library.unknown_countries(tags))
    return [t for t in tags if not (t.startswith("country:") and t[8:] in bad)]


def reject_unknown_country(tags: list[str], existing: list[str] | None = None) -> None:
    """422 `unknown_country` for a `country:` value outside ISO 3166-1; values the song already carries (legacy) pass."""
    keep = set(library.unknown_countries(existing or []))
    for value in library.unknown_countries(tags):
        if value not in keep:
            raise Problem(422, "unknown_country", f"Unknown country: {value}", value=value)


def add_metadata_only(uid: str, vid: str, link: Resolved, meta: dict[str, Any], tags: list[str]) -> JSONResponse:
    """Catalog entry without audio: `file: null`, state `none`. Gaps in the metadata are filled from the link."""
    try:
        try:
            found = link.probe if link.probe is not None else extractor.preview(vid)
        except Exception as exc:
            log.warning("preview failed for %s: %s", vid, exc)
            found = {}
        cover = _fetch_cover(uid, vid, found.get("thumbnail"))
        song = {
            "id": vid,
            "title": meta.get("title") or found.get("title") or vid,
            "artist": meta.get("artist") or found.get("artist") or None,
            "album": meta.get("album") or found.get("album"),
            "remixer": meta.get("remixer"),
            "year": meta["year"] if meta.get("year") is not None else found.get("year"),
            "remix_year": meta.get("remix_year"),
            "bpm": round(meta["bpm"]) if meta.get("bpm") is not None else None,
            **_link_fields(vid, meta, link.url),
            "file": None,
            "cover": cover,
            "duration": found.get("duration"),
            "added_at": library.now_utc(),
            "tags": library.with_decade(tags or _known_country_tags(library.clean_tags(found.get("tags") or [])), meta.get("year") or found.get("year")),
        }
        with deps.tx(uid, f"add {vid}"):
            songs = library.load(deps.library_path(uid))
            if library.find_song(songs, vid) is not None:
                raise HTTPException(status_code=409, detail="already in library")
            deps.save_songs(uid, songs + [song])
    finally:
        deps.JOBS.pop((uid, vid), None)
    return JSONResponse(
        {"id": vid, "status": "done", "audio_state": "none", "song": library.public_song(song, deps.user_audio_root(uid))},
        status_code=201,
    )
