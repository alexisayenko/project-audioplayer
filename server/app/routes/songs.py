"""Adding songs, fetching their audio, job status and edits."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from .. import credits, deps, discogs_lookup, genre_lookup, jobs, library, limits, loops, sources, titleclean, urlclean, users, wiki_lookup
from .. import trim as trimming
from ..downloads import (
    add_metadata_only, mark_started, new_job, reject_unknown_country, reject_unknown_genre, run_download, run_fetch_audio,
    run_redownload,
)
from ..links import Refused, resolve_link
from ..tags import namespace
from ..schemas import AudioRequest, CreateSongRequest, PatchSongRequest

router = APIRouter()

_TEXT_FIELDS = ("title",)


def _clean_text(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


def _check_credits(changes: dict[str, Any], current: dict[str, Any] | None = None) -> dict[str, Any]:
    """The resolved credit changes of a request; 422 with the message of credits.clean_changes."""
    try:
        return credits.clean_changes(changes, current)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _started_response(vid: str, began: bool) -> dict[str, str]:
    return {"id": vid, "status": "downloading" if began else "queued"}


def _with_hint(response: JSONResponse, hint: int | None) -> JSONResponse:
    """A start time carried by the pasted link is only suggested (`trim_start_hint`), never stored."""
    if hint is None:
        return response
    return JSONResponse({**json.loads(response.body), "trim_start_hint": hint}, status_code=response.status_code)


@router.post("/songs", status_code=202, responses=deps.responses(409))
def create_song(req: CreateSongRequest, user: dict[str, Any] = Depends(deps.require_token)):
    uid, owner = user["uid"], user["owner"]
    cleaned = library.merge_genres(req.genres, req.tags)
    reject_unknown_country(cleaned)
    reject_unknown_genre(cleaned)
    sent = req.metadata.model_dump(exclude_unset=True)
    _check_credits(sent)
    trim = req.trim.model_dump(exclude_unset=True) if req.trim else None
    if trim:
        _checked_trim(trim.get("start"), trim.get("end"), None)
    cut = trimming.check(trim.get("start"), trim.get("end")) if trim else None
    hint = sources.parse_source_url(req.url).get("trim_start")
    deps.guard_add(uid, owner, req.audio)
    try:
        link = resolve_link(req.url)
    except Refused as refused:
        return refused.response
    vid = link.vid
    key = (uid, vid)
    with users.user_lock(uid):
        songs = deps.guard_add(uid, owner, req.audio)
        if library.find_song(songs, vid) is not None:
            raise HTTPException(status_code=409, detail="already in library")
        if deps.JOBS.get(key, {}).get("status") in deps.ACTIVE:
            raise HTTPException(status_code=409, detail="already downloading")
        if req.audio:
            limits.RATE.record(uid, songs)
        deps.JOBS[key] = new_job()
    meta = {k: (v.strip() or None) if isinstance(v, str) else v for k, v in sent.items()}
    if req.source_raw is not None:
        meta["source_raw"] = req.source_raw.model_dump(exclude_none=True)
    if trim:
        meta["trim"] = trim
    if meta.get("title") and not req.keep_title:
        meta["title"] = titleclean.clean(meta["title"])
    if not req.audio:
        return _with_hint(add_metadata_only(uid, vid, link, meta, library.merge_genres(req.genres, req.tags)), hint)
    began = deps.SCHED.submit(
        uid, owner,
        lambda: run_download(uid, owner, vid, meta, library.merge_genres(req.genres, req.tags), link.url, cut), mark_started(key))
    return _with_hint(JSONResponse(_started_response(vid, began), status_code=202), hint)


@router.post("/songs/{video_id}/audio", status_code=202, responses=deps.responses(404, 422))
def fetch_song_audio(video_id: str, req: AudioRequest | None = None, user: dict[str, Any] = Depends(deps.require_token)):
    """Download the audio of a catalog song that has none (state none -> server). Idempotent while a job runs. An optional `trim` overrides (and is stored as) the trim of the primary source."""
    deps.valid_id(video_id)
    uid, owner = user["uid"], user["owner"]
    key = (uid, video_id)
    with users.user_lock(uid):
        songs = deps.load_songs(uid)
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        cut = _requested_trim(req, song)
        if library.audio_state(song, deps.user_audio_root(uid)) == "server":
            return JSONResponse({"id": video_id, "status": "done"}, status_code=200)
        active = deps.JOBS.get(key)
        if active and active.get("status") in deps.ACTIVE:
            return {"id": video_id, "status": active["status"]}
        limits.check_fetch(uid, owner, songs, deps.audio_dir(uid), deps.pool_dir())
        limits.RATE.record(uid, songs)
        deps.JOBS[key] = new_job()
    own = urlclean.source_of(video_id)
    link = next((s.get("url") for s in library.sources_of(song) if s.get("source") == own and s.get("url")), None) or next((s["url"] for s in library.sources_of(song) if s.get("url")), None)
    began = deps.SCHED.submit(
        uid, owner, lambda: run_fetch_audio(uid, owner, video_id, link, cut), mark_started(key))
    return _started_response(video_id, began)


def _requested_trim(req: AudioRequest | None, song: dict[str, Any]) -> trimming.Trim | None:
    """The checked trim override of a request (clamped to the source length when known); None when the request carries none, `(None, None)` when it clears the trim."""
    if req is None or req.trim is None:
        return None
    return trimming.check(req.trim.start, req.trim.end, trimming.source_duration(song))


@router.post("/songs/{video_id}/redownload", status_code=202, responses=deps.responses(404, 409, 422))
def redownload_song(video_id: str, req: AudioRequest | None = None, user: dict[str, Any] = Depends(deps.require_token)):
    """Download the song's audio again (its trim changed) and replace the stored file; duration, bpm, cover version and peaks follow. An optional `trim` is stored on the primary source first; without one the stored trim applies."""
    deps.valid_id(video_id)
    uid, owner = user["uid"], user["owner"]
    key = (uid, video_id)
    with users.user_lock(uid):
        songs = deps.load_songs(uid)
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        cut = _requested_trim(req, song)
        if deps.JOBS.get(key, {}).get("status") in deps.ACTIVE:
            raise HTTPException(status_code=409, detail="already downloading")
        limits.check_fetch(uid, owner, songs, deps.audio_dir(uid), deps.pool_dir())
        limits.RATE.record(uid, songs)
        deps.JOBS[key] = new_job()
    own = urlclean.source_of(video_id)
    link = next((s.get("url") for s in library.sources_of(song) if s.get("source") == own and s.get("url")), None) or next((s["url"] for s in library.sources_of(song) if s.get("url")), None)
    began = deps.SCHED.submit(
        uid, owner, lambda: run_redownload(uid, owner, video_id, link, cut), mark_started(key))
    return _started_response(video_id, began)


@router.get("/songs/{video_id}/status", responses=deps.responses(404, 422))
def song_status(video_id: str, user: dict[str, Any] = Depends(deps.require_token)):
    deps.valid_id(video_id)
    uid = user["uid"]
    job = deps.JOBS.get((uid, video_id))
    if job:
        return {"id": video_id, **jobs.public(job)}
    if library.find_song(deps.load_songs(uid), video_id) is not None:
        return {"id": video_id, **jobs.public({"status": "done", "progress": 1.0, "error": None})}
    raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)


def _apply_links(updated: dict[str, Any], changes: dict[str, Any]) -> None:
    for key in ("wikipedia_song", "wikipedia_artist", "wikipedia_album"):
        if key in changes:
            updated[key] = wiki_lookup.clean_link(changes[key])
    if "musicbrainz_url" in changes:
        updated["musicbrainz_url"] = genre_lookup.clean_recording_url(changes["musicbrainz_url"])
    if "discogs_url" in changes:
        updated["discogs_url"] = discogs_lookup.clean_url(changes["discogs_url"])
    if "spotify_url" in changes:
        updated["spotify_url"] = urlclean.clean_spotify_url(changes["spotify_url"])
    _apply_source_links(updated, changes)


_SOURCE_FIELDS = (
    ("youtube_url", "youtube", urlclean.clean_youtube_link, "a YouTube link (https youtube.com, music.youtube.com or youtu.be)"),
    ("soundcloud_url", "soundcloud", urlclean.clean_soundcloud_link, "a SoundCloud track link (https soundcloud.com/<artist>/<track>)"),
)


def _source_link(field: str, raw: Any, clean: Callable[[str], str | None], what: str) -> str | None:
    if not (isinstance(raw, str) and raw.strip()):
        return None
    link = clean(raw)
    if link is None:
        raise HTTPException(status_code=422, detail=f"{field} must be {what}")
    return link


def _with_source(entries: list[dict[str, Any]], field: str, kind: str, link: str | None, is_primary: bool) -> list[dict[str, Any]]:
    mine = [i for i, e in enumerate(entries) if sources.platform(e) == kind]
    if link is None:
        if is_primary:
            raise HTTPException(status_code=422, detail=f"{field} cannot be cleared: it is the link this song's audio comes from")
        return [e for e in entries if sources.platform(e) != kind]
    parsed = sources.parse_source_url(link)
    new = sources.make_entry(parsed["type"], parsed["ref"])
    if mine:
        old = entries[mine[0]]
        if (old["type"], old["ref"]) == (new["type"], new["ref"]):
            return entries
        entries[mine[0]] = new
    else:
        entries.append(new)
    return sources.dedupe(entries)


def _source_from_request(item: dict[str, Any], current: list[dict[str, Any]]) -> dict[str, Any]:
    if item.get("url"):
        parsed = sources.parse_source_url(str(item["url"]))
        type_, ref = parsed["type"], parsed["ref"]
    elif item.get("type") and item.get("ref"):
        type_, ref = str(item["type"]).strip(), str(item["ref"]).strip()
    else:
        raise HTTPException(status_code=422, detail="a source needs a url, or a type and a ref")
    if not ref or (type_ == sources.URL and not re.match(r"^https?://", ref, re.I)) or (type_ == sources.YOUTUBE and not urlclean.VIDEO_ID_RE.fullmatch(ref)):
        raise HTTPException(status_code=422, detail="a source link is not a valid address")
    known = next((e for e in current if (e["type"], e["ref"]) == (type_, ref)), {})
    entry = sources.make_entry(type_, ref, item.get("trim_start", known.get("trim_start")), item.get("trim_end", known.get("trim_end")), item.get("duration", known.get("duration")))
    entry["trim_start"], entry["trim_end"] = _checked_trim(entry["trim_start"], entry["trim_end"], entry.get("duration"))
    return entry


def _checked_trim(start: Any, end: Any, duration: Any) -> tuple[Any, Any]:
    try:
        return sources.validate_trim(start, end, duration)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _apply_source_links(updated: dict[str, Any], changes: dict[str, Any]) -> None:
    """Edit `sources` (DATA-193): the YouTube / SoundCloud link fields, a whole `sources` list, one more `url`, and the `trim` of the primary source. The song id never changes; the source of the id's own platform cannot be removed."""
    if not any(k in changes for k in ("youtube_url", "soundcloud_url", "sources", "url", "trim")):
        return
    sid = str(updated.get("id", ""))
    own = urlclean.source_of(sid)
    entries = library.clean_sources(updated.get("sources"), sid, updated.get("source_url"))
    for field, kind, clean, what in _SOURCE_FIELDS:
        if field in changes:
            entries = _with_source(entries, field, kind, _source_link(field, changes[field], clean, what), kind == own)
    if changes.get("sources") is not None:
        entries = sources.dedupe(_source_from_request(item, entries) for item in changes["sources"])
        if not any(sources.platform(e) == own for e in entries):
            raise HTTPException(status_code=422, detail="sources must keep the link this song's audio comes from")
    if isinstance(changes.get("url"), str) and changes["url"].strip():
        entries = sources.dedupe([*entries, _source_from_request({"url": changes["url"]}, entries)])
    if changes.get("trim") is not None and entries:
        first = entries[0]
        fallback = updated.get("duration") if first.get("trim_start") is None and first.get("trim_end") is None else None
        try:
            sources.apply_trim(entries, changes["trim"], 0, fallback)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    updated["sources"] = entries
    updated.pop("source_url", None)


def _apply_tag_changes(updated: dict[str, Any], song: dict[str, Any], changes: dict[str, Any]) -> None:
    sent_tags, sent_genres = changes.get("tags"), changes.get("genres")
    if sent_tags is None and sent_genres is None:
        return
    own = sent_tags if sent_tags is not None else song.get("tags") or []
    if sent_genres is not None:
        own = [t for t in own if namespace(str(t)) != "genre"]
    cleaned = library.merge_genres(sent_genres, own)
    stored = library.clean_tags(song.get("tags") or [])
    reject_unknown_country(cleaned, stored)
    reject_unknown_genre(cleaned, stored)
    updated["tags"] = library.drop_derived_tags(cleaned)


def _edited(song: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    updated = dict(song)
    for key in _TEXT_FIELDS:
        if key in changes:
            updated[key] = _clean_text(changes[key])
    try:
        credits.apply_changes(updated, changes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if "bpm" in changes:
        updated["bpm"] = round(changes["bpm"]) if changes["bpm"] is not None else None
    if "loops" in changes:
        try:
            saved = loops.clean(changes["loops"], song.get("duration"))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if saved:
            updated["loops"] = saved
        else:
            updated.pop("loops", None)
    _apply_links(updated, changes)
    _apply_tag_changes(updated, song, changes)
    if not updated.get("title"):
        raise HTTPException(status_code=422, detail="title must not be empty")
    updated["updated_at"] = library.now_utc()
    return updated


@router.patch("/songs/{video_id}", responses=deps.responses(404, 422))
def patch_song(video_id: str, req: PatchSongRequest, user: dict[str, Any] = Depends(deps.require_token)):
    deps.valid_id(video_id)
    uid = user["uid"]
    changes = req.model_dump(exclude_unset=True)
    with deps.tx(uid, f"edit {video_id}"):
        doc = deps.load_doc(uid)
        song = library.find_song(doc["songs"], video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        edited = _edited(song, changes)
        song.clear()
        song.update(edited)
        deps.save_doc(uid, doc)
        return deps.public_song(uid, song)
