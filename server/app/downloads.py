"""Background audio downloads: job bookkeeping, the download workers and the metadata-only add."""

from __future__ import annotations

import contextlib
import logging
import os
import shutil
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from . import bpm, coverimg, credits, deps, discogs_lookup, extractor, genre_filter, genre_lookup, genre_vocab, identify, jobs, library, limits, previewcache, sources, urlclean, wiki_lookup
from . import trim as trimming
from .jsonio import write_bytes_atomic
from .links import Resolved, short_error
from .problems import Problem
from .tags import namespaced_values

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
        with tempfile.TemporaryDirectory() as tmp:
            staged = Path(tmp) / f"{vid}.jpg"
            extractor.fetch_cover(vid, staged, thumbnail)
            data = staged.read_bytes()
        with deps.SYNC.exclusive() if deps.SYNC else contextlib.nullcontext():
            write_bytes_atomic(deps.covers_dir(uid) / f"{vid}.jpg", data)
    except Exception:
        return None
    return f"covers/{vid}.jpg"


def fetch_cover_bytes(uid: str, vid: str) -> bytes | None:
    """The automatic cover of a song, fetched and stored at covers/<id>.jpg; None when it cannot be fetched."""
    if _fetch_cover(uid, vid, None) is None:
        return None
    return (deps.covers_dir(uid) / f"{vid}.jpg").read_bytes()


def _detect_bpm(path: Path, vid: str) -> float | None:
    try:
        return bpm.detect_bpm(path)
    except Exception as exc:
        log.warning("bpm detection failed for %s: %s", vid, exc)
        return None


def _new_sources(vid: str, url: str, trim: dict[str, Any] | None) -> list[dict[str, Any]]:
    entries = library.clean_sources([{"platform": extractor.source_of(vid), "url": url}], vid)
    if trim:
        sources.apply_trim(entries, trim)
    return entries


def _link_fields(vid: str, meta: dict[str, Any], source_url: str | None) -> dict[str, Any]:
    """The reference fields of a new song record: cleaned links, the source and its URL."""
    url = extractor.watch_url(vid, source_url)
    return {
        "wikipedia_song": wiki_lookup.clean_link(meta.get("wikipedia_song")),
        "wikipedia_artist": wiki_lookup.clean_link(meta.get("wikipedia_artist")),
        **({"wikipedia_album": link} if (link := wiki_lookup.clean_link(meta.get("wikipedia_album"))) else {}),
        "musicbrainz_url": genre_lookup.clean_recording_url(meta.get("musicbrainz_url")),
        "discogs_url": discogs_lookup.clean_url(meta.get("discogs_url")),
        "spotify_url": urlclean.clean_spotify_url(meta.get("spotify_url")),
        **({"source": "soundcloud"} if extractor.source_of(vid) == "soundcloud" else {}),
        "sources": _new_sources(vid, url, meta.get("trim")),
    }


def _credit_meta(meta: dict[str, Any], found: dict[str, Any]) -> dict[str, Any]:
    """The request's credit keys, with the artist and year the source reported filling what the request left empty."""
    out = dict(meta)
    has_artists = any(out.get(k) for k in ("mainArtists", "artists"))
    if not has_artists and not str(out.get("artist") or "").strip() and found.get("artist"):
        out["artist"] = found["artist"]
    if all(out.get(k) is None for k in ("releaseYear", "released", "year")) and found.get("year") is not None:
        out["releaseYear"] = found["year"]
    return out


def _download_audio(vid: str, out: Path, job: dict[str, Any], source_url: str | None, trim: trimming.Trim | None) -> dict[str, Any]:
    """`extractor.download_audio`; the trim is passed only when there is a cut, so an untrimmed download is the call it always was."""
    if trimming.is_cut(trim):
        return extractor.download_audio(vid, out, jobs.Tracker(job), source_url, trim=trim)
    return extractor.download_audio(vid, out, jobs.Tracker(job), source_url)


def _downloaded_song(uid: str, owner: bool, out: Path, vid: str, meta: dict[str, Any], tags: list[str],
                     source_url: str | None, job: dict[str, Any], trim: trimming.Trim | None = None) -> dict[str, Any]:
    limits.check_capacity(owner, out, deps.pool_dir())
    info = _download_audio(vid, out, job, source_url, trim)
    cover = _fetch_cover(uid, vid, info.get("thumbnail"))
    value = round(meta["bpm"]) if meta.get("bpm") is not None else _detect_bpm(out / f"{vid}.m4a", vid)
    fields = credits.new_fields(_credit_meta(meta, info), meta.get("source_raw"))
    record = {
        "id": vid,
        "title": meta.get("title") or info.get("title") or vid,
        **fields,
        "bpm": value,
        **_link_fields(vid, meta, source_url),
        "file": f"{vid}.m4a",
        "cover": cover,
        "duration": info.get("duration"),
        "added_at": library.now_utc(),
        "tags": tags,
    }
    if trimming.is_cut(trim):
        trimming.persist(record, info.get("trim") or trim, info.get("source_duration"))
    return record


def run_download(uid: str, owner: bool, vid: str, meta: dict[str, Any], tags: list[str],
                 source_url: str | None = None, trim: trimming.Trim | None = None) -> None:
    job = deps.JOBS[(uid, vid)]
    out: Path | None = None
    try:
        out = deps.audio_dir(uid)
        song = _downloaded_song(uid, owner, out, vid, meta, tags, source_url, job, trim)
        with deps.tx(uid, f"add {vid}"):
            songs = [s for s in library.load(deps.library_path(uid)) if s["id"] != vid]
            deps.save_songs(uid, songs + [song])
        job.update(status="done", progress=1.0)
        auto_identify(uid, vid)
    except Exception as exc:
        _fail_job(job, out, vid, exc)


def _attach_audio(song: dict[str, Any], vid: str, info: dict[str, Any], cut: trimming.Trim | None, trim: trimming.Trim | None, value: float | None, cover_ok: bool) -> None:
    song["file"] = f"{vid}.m4a"
    if trimming.is_cut(cut):
        song["duration"] = info.get("duration") or song.get("duration")
    elif info.get("duration") and not song.get("duration"):
        song["duration"] = info["duration"]
    if trimming.is_cut(cut) or trim is not None:
        trimming.persist(song, info.get("trim") or cut or trimming.NONE, info.get("source_duration"))
    if song.get("bpm") is None and value is not None:
        song["bpm"] = round(value)
    if cover_ok and not song.get("cover") and not song.get("cover_off"):
        song["cover"] = f"covers/{vid}.jpg"
    song["updated_at"] = library.now_utc()


def run_fetch_audio(uid: str, owner: bool, vid: str, source_url: str | None, trim: trimming.Trim | None = None) -> None:
    """Download audio for a song already in the catalog and attach it to the record. `trim` is a request override (persisted on the primary source); without one the stored trim applies."""
    job = deps.JOBS[(uid, vid)]
    out: Path | None = None
    try:
        out = deps.audio_dir(uid)
        limits.check_capacity(owner, out, deps.pool_dir())
        cut = trim if trim is not None else trimming.stored(library.find_song(deps.load_songs(uid), vid))
        info = _download_audio(vid, out, job, source_url, cut)
        value = _detect_bpm(out / f"{vid}.m4a", vid)
        existing = library.find_song(deps.load_songs(uid), vid)
        pinned = bool(existing) and existing.get("cover_source") in ("custom", "default")
        cover_ok = not pinned and ((deps.covers_dir(uid) / f"{vid}.jpg").is_file() or _fetch_cover(uid, vid, info.get("thumbnail")) is not None)
        with deps.tx(uid, f"audio {vid}"):
            songs = library.load(deps.library_path(uid))
            song = library.find_song(songs, vid)
            if song is None:
                raise Problem(404, "unknown_song", deps.UNKNOWN_SONG)
            _attach_audio(song, vid, info, cut, trim, value, cover_ok)
            deps.save_songs(uid, songs)
        job.update(status="done", progress=1.0)
        auto_identify(uid, vid)
    except Exception as exc:
        _fail_job(job, out, vid, exc)


def run_redownload(uid: str, owner: bool, vid: str, source_url: str | None, trim: trimming.Trim | None = None) -> None:
    """Download a song's audio again from its source and replace the stored file (the trim changed). `trim` is a request override persisted on the primary source; without one the stored trim applies. The old file stays until the new one is complete."""
    job = deps.JOBS[(uid, vid)]
    stage: Path | None = None
    try:
        out = deps.audio_dir(uid)
        limits.check_capacity(owner, out, deps.pool_dir())
        out.mkdir(parents=True, exist_ok=True)
        existing = library.find_song(deps.load_songs(uid), vid)
        cut = trim if trim is not None else trimming.stored(existing)
        stage = Path(tempfile.mkdtemp(prefix=".redownload-", dir=out))
        info = _download_audio(vid, stage, job, source_url, cut)
        staged = stage / f"{vid}.m4a"
        value = _detect_bpm(staged, vid)
        pinned = bool(existing) and (existing.get("cover_source") in ("custom", "default") or bool(existing.get("cover_off")))
        fresh = None if pinned else _fetch_cover(uid, vid, info.get("thumbnail"))
        with deps.tx(uid, f"redownload {vid}"):
            songs = library.load(deps.library_path(uid))
            song = library.find_song(songs, vid)
            if song is None:
                raise Problem(404, "unknown_song", deps.UNKNOWN_SONG)
            os.replace(staged, out / f"{vid}.m4a")
            song["file"] = f"{vid}.m4a"
            song["duration"] = info.get("duration") or song.get("duration")
            if value is not None:
                song["bpm"] = round(value)
            if fresh:
                song["cover"] = fresh
                song["cover_v"] = coverimg.version_of((deps.covers_dir(uid) / f"{vid}.jpg").read_bytes())
            if trimming.is_cut(cut) or trim is not None:
                trimming.persist(song, info.get("trim") or cut or trimming.NONE, info.get("source_duration"))
            song["updated_at"] = library.now_utc()
            deps.save_songs(uid, songs)
        job.update(status="done", progress=1.0)
    except Exception as exc:
        _fail_job(job, None, vid, exc)
    finally:
        if stage is not None:
            shutil.rmtree(stage, ignore_errors=True)


def _known_country_tags(tags: list[str]) -> list[str]:
    bad = set(library.unknown_countries(tags))
    return [t for t in tags if not (t.startswith("country:") and t[8:] in bad)]


def reject_unknown_country(tags: list[str], existing: list[str] | None = None) -> None:
    """422 `unknown_country` for a `country:` value outside ISO 3166-1; values the song already carries (legacy) pass."""
    keep = set(library.unknown_countries(existing or []))
    for value in library.unknown_countries(tags):
        if value not in keep:
            raise Problem(422, "unknown_country", f"Unknown country: {value}", value=value)


def reject_unknown_genre(tags: list[str], existing: list[str] | None = None) -> None:
    """422 `unknown_genre` for a `genre:` value outside the vocabulary (TAG-079), with up to 5 "did you mean" names; values the song already carries (kept unmappable tags, TAG-082) pass. Expects cleaned tags."""
    keep = set(namespaced_values(existing or [], "genre"))
    bad = list(dict.fromkeys(v for v in namespaced_values(tags, "genre") if not genre_vocab.is_canonical(v) and v not in keep))
    if not bad:
        return
    aliases = {**genre_filter.ALIASES, **genre_filter.RETAGS}
    suggestions = {v: genre_vocab.suggest(v, aliases) for v in bad}
    first = bad[0]
    hint = f" Did you mean: {', '.join(suggestions[first])}?" if suggestions[first] else " Pick a name from GET /genres/vocabulary."
    grp = genre_vocab.group(first)
    lead = f"{first} is not a genre ({grp} is a temporary group) and cannot be assigned to a song." if grp else f"Unknown genre: {first}."
    raise Problem(422, "unknown_genre", f"{lead}{hint}", value=first, suggestions=suggestions[first],
                  unknown=[{"value": v, "suggestions": suggestions[v]} for v in bad])


def add_metadata_only(uid: str, vid: str, link: Resolved, meta: dict[str, Any], tags: list[str]) -> JSONResponse:
    """Catalog entry without audio: `file: null`, state `none`. Gaps in the metadata are filled from the link."""
    try:
        try:
            found = link.probe if link.probe is not None else previewcache.youtube(vid)
        except Exception as exc:
            log.warning("preview failed for %s: %s", vid, exc)
            found = {}
        cover = _fetch_cover(uid, vid, found.get("thumbnail"))
        fields = credits.new_fields(_credit_meta(meta, found), meta.get("source_raw"))
        if not fields["albums"] and isinstance(found.get("album"), str) and found["album"].strip():
            fields["albums"] = [found["album"].strip()]
        song = {
            "id": vid,
            "title": meta.get("title") or found.get("title") or vid,
            **fields,
            "bpm": round(meta["bpm"]) if meta.get("bpm") is not None else None,
            **_link_fields(vid, meta, link.url),
            "file": None,
            "cover": cover,
            "duration": found.get("duration"),
            "added_at": library.now_utc(),
            "tags": tags or _known_country_tags(library.clean_tags(found.get("tags") or [])),
        }
        with deps.tx(uid, f"add {vid}"):
            songs = library.load(deps.library_path(uid))
            if library.find_song(songs, vid) is not None:
                raise HTTPException(status_code=409, detail="already in library")
            deps.save_songs(uid, songs + [song])
    finally:
        deps.JOBS.pop((uid, vid), None)
    return JSONResponse(
        {"id": vid, "status": "done", "audio_state": "none", "song": deps.public_song(uid, song)},
        status_code=201,
    )
