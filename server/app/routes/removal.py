from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from .. import deps, identify, library

router = APIRouter()


@router.delete("/songs/{video_id}", status_code=204, responses=deps.responses(404, 422))
def delete_song(video_id: str, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    deps.valid_id(video_id)
    uid = user["uid"]
    with deps.tx(uid, f"delete {video_id}"):
        songs = library.load(deps.library_path(uid))
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        deps.save_songs(uid, [s for s in songs if s["id"] != video_id])
        (deps.covers_dir(uid) / f"{video_id}.jpg").unlink(missing_ok=True)
        if library.has_file(song):
            try:
                (deps.audio_dir(uid) / library.file_name(song)).unlink(missing_ok=True)
            except deps.MusicRootUnavailable:
                pass
        deps.JOBS.pop((uid, video_id), None)
        identify.forget(uid, video_id)


@router.delete("/songs/{video_id}/audio", status_code=204, responses=deps.responses(404, 422))
def delete_song_audio(video_id: str, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    """Remove the audio file only; the catalog entry stays (state becomes `none`). Idempotent."""
    deps.valid_id(video_id)
    uid = user["uid"]
    with deps.tx(uid, f"delete audio {video_id}"):
        songs = library.load(deps.library_path(uid))
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        if library.has_file(song):
            (deps.audio_dir(uid) / library.file_name(song)).unlink(missing_ok=True)
            song["file"] = None
            song["updated_at"] = library.now_utc()
            deps.save_songs(uid, songs)
        deps.JOBS.pop((uid, video_id), None)
