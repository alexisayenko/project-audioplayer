"""Analysis of a song whose audio is on the server: BPM detection and identification."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from .. import bpm, deps, identify, library
from ..downloads import identifiable_song

router = APIRouter()


def store_bpm(uid: str, video_id: str, value: float) -> dict[str, Any]:
    with deps.tx(uid, f"bpm {video_id}"):
        songs = library.load(deps.library_path(uid))
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        song["bpm"] = round(value)
        song["updated_at"] = library.now_utc()
        deps.save_songs(uid, songs)
        return deps.public_song(uid, song)


@router.post("/songs/{video_id}/bpm/detect", responses=deps.responses(404, 422))
async def detect_song_bpm(video_id: str, user: dict[str, Any] = Depends(deps.require_token)):
    deps.valid_id(video_id)
    uid = user["uid"]
    song = library.find_song(deps.load_songs(uid), video_id)
    if song is None:
        raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
    path = deps.audio_dir(uid) / library.file_name(song)
    if not library.has_file(song) or not path.is_file():
        raise HTTPException(status_code=404, detail=deps.NOT_DOWNLOADED)
    value = await run_in_threadpool(bpm.detect_bpm, path)
    if value is None:
        raise HTTPException(status_code=422, detail="could not detect BPM")
    return await run_in_threadpool(store_bpm, uid, video_id, value)


def _require_song(uid: str, video_id: str) -> None:
    if library.find_song(deps.load_songs(uid), video_id) is None:
        raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)


@router.get("/songs/{video_id}/identify", responses=deps.responses(404, 422))
def get_identify(video_id: str, user: dict[str, Any] = Depends(deps.require_token)):
    """The last identification of the song (kept 24 h in memory) or `status: "not_run"`; `available` says which sources are configured."""
    deps.valid_id(video_id)
    uid = user["uid"]
    _require_song(uid, video_id)
    return identify.recall(uid, video_id) or {"status": "not_run", "available": identify.available()}


@router.post("/songs/{video_id}/identify", responses=deps.responses(404, 422))
async def identify_song(video_id: str, user: dict[str, Any] = Depends(deps.require_token)):
    """Identify a song whose audio is on the server (fingerprint, MusicBrainz, Discogs); suggestions only, nothing is stored. Not an add: no hourly-limit charge."""
    deps.valid_id(video_id)
    uid = user["uid"]
    _require_song(uid, video_id)
    song = identifiable_song(uid, video_id)
    if song is None:
        raise HTTPException(status_code=404, detail=deps.NOT_DOWNLOADED)
    return await run_in_threadpool(identify.run_cached, uid, video_id, song, deps.audio_dir(uid) / library.file_name(song))
