"""Adding songs, fetching their audio, job status and edits."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from .. import artist_table, credits, deps, discogs_lookup, genre_lookup, jobs, library, limits, titleclean, urlclean, users, wiki_lookup
from ..downloads import (
    add_metadata_only, mark_started, new_job, reject_unknown_country, reject_unknown_genre, run_download, run_fetch_audio,
)
from ..links import Refused, resolve_link
from ..schemas import CreateSongRequest, PatchSongRequest

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


@router.post("/songs", status_code=202, responses=deps.responses(409))
def create_song(req: CreateSongRequest, user: dict[str, Any] = Depends(deps.require_token)):
    uid, owner = user["uid"], user["owner"]
    cleaned = library.clean_tags(req.tags)
    reject_unknown_country(cleaned)
    reject_unknown_genre(cleaned)
    sent = req.metadata.model_dump(exclude_unset=True)
    _check_credits(sent)
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
    if meta.get("title") and not req.keep_title:
        meta["title"] = titleclean.clean(meta["title"])
    if not req.audio:
        return add_metadata_only(uid, vid, link, meta, library.clean_tags(req.tags))
    began = deps.SCHED.submit(
        uid, owner,
        lambda: run_download(uid, owner, vid, meta, library.clean_tags(req.tags), link.url), mark_started(key))
    return _started_response(vid, began)


@router.post("/songs/{video_id}/audio", status_code=202, responses=deps.responses(404, 422))
def fetch_song_audio(video_id: str, user: dict[str, Any] = Depends(deps.require_token)):
    """Download the audio of a catalog song that has none (state none -> server). Idempotent while a job runs."""
    deps.valid_id(video_id)
    uid, owner = user["uid"], user["owner"]
    key = (uid, video_id)
    with users.user_lock(uid):
        songs = deps.load_songs(uid)
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        if library.audio_state(song, deps.user_audio_root(uid)) == "server":
            return JSONResponse({"id": video_id, "status": "done"}, status_code=200)
        active = deps.JOBS.get(key)
        if active and active.get("status") in deps.ACTIVE:
            return {"id": video_id, "status": active["status"]}
        limits.check_fetch(uid, owner, songs, deps.audio_dir(uid), deps.pool_dir())
        limits.RATE.record(uid, songs)
        deps.JOBS[key] = new_job()
    own = urlclean.source_of(video_id)
    link = next((s.get("url") for s in library.sources_of(song) if s.get("source") == own and s.get("url")), None)
    began = deps.SCHED.submit(
        uid, owner, lambda: run_fetch_audio(uid, owner, video_id, link or song.get("source_url")), mark_started(key))
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


def _apply_source_links(updated: dict[str, Any], changes: dict[str, Any]) -> None:
    """Edit the YouTube / SoundCloud entries of `sources`. The song id never changes; the entry of the id's own kind cannot be cleared."""
    primary = urlclean.source_of(str(updated.get("id", "")))
    sources = [dict(e) for e in library.sources_of(updated)]
    touched = False
    for field, kind, clean, what in _SOURCE_FIELDS:
        if field not in changes:
            continue
        raw = changes[field]
        link = None
        if isinstance(raw, str) and raw.strip():
            link = clean(raw)
            if link is None:
                raise HTTPException(status_code=422, detail=f"{field} must be {what}")
        mine = [e for e in sources if e.get("source") == kind]
        if link is None:
            if kind == primary:
                raise HTTPException(status_code=422, detail=f"{field} cannot be cleared: it is the link this song's audio comes from")
            sources = [e for e in sources if e.get("source") != kind]
        elif mine:
            mine[0]["url"] = link
            if kind == "youtube":
                mine[0]["id"] = urlclean.parse_video_id(link) or mine[0]["id"]
        else:
            ident = urlclean.parse_video_id(link) if kind == "youtube" else link.split("soundcloud.com/", 1)[1]
            sources.append({"source": kind, "id": ident, "url": link})
        if kind == primary:
            updated["source_url"] = link
        touched = True
    if touched:
        updated["sources"] = library.clean_sources(sources)


def _apply_countries(updated: dict[str, Any], countries: list[str], table: list[dict[str, Any]]) -> None:
    """Country tags of a request go to the Artist table (DATA-147): replaced for a song with exactly one main artist; with several main artists a change is refused (DATA-160), the unchanged echo of the derived view passes."""
    names = credits.main_artists(updated)
    if len(names) == 1:
        artist_table.set_countries(table, names[0], countries)
    elif set(countries) != set(artist_table.countries_for(table, names)):
        raise HTTPException(status_code=422, detail="Countries belong to artists; this song has several main artists, edit them via the artist")


def _edited(song: dict[str, Any], changes: dict[str, Any], table: list[dict[str, Any]]) -> dict[str, Any]:
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
    _apply_links(updated, changes)
    if changes.get("tags") is not None:
        cleaned = library.clean_tags(changes["tags"])
        reject_unknown_country(cleaned)
        reject_unknown_genre(cleaned, library.clean_tags(song.get("tags") or []))
        updated["tags"], countries, _ = library.split_tags(cleaned)
        _apply_countries(updated, countries, table)
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
        edited = _edited(song, changes, doc["artists"])
        song.clear()
        song.update(edited)
        deps.save_doc(uid, doc)
        return deps.public_song(uid, song)
