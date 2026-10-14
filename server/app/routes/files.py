from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from .. import deps, library
from ..problems import Problem
from ..safepath import safe_join

router = APIRouter()

AUDIO_TYPE = "audio/mp4"
COVER_TYPE = "image/jpeg"
PRIVATE_NO_CACHE = {"Cache-Control": "private, no-cache"}


def _not_downloaded(download: bool) -> Exception:
    if download:
        return Problem(404, "audio_not_downloaded", "This song's audio is not on the server.")
    return HTTPException(status_code=404, detail=deps.NOT_DOWNLOADED)


@router.head("/files/{video_id}", include_in_schema=False)
@router.get("/files/{video_id}", responses=deps.responses(404, 422, 503))
def get_file(video_id: str, download: bool = Query(default=False), user: dict[str, Any] = Depends(deps.require_token_or_query)):
    deps.valid_id(video_id)
    uid = user["uid"]
    song = library.find_song(deps.load_songs(uid), video_id)
    if song is not None and not library.has_file(song):
        raise _not_downloaded(download)
    name = library.file_name(song) if song else f"{video_id}.m4a"
    base = deps.audio_dir(uid)
    path = safe_join(base, name)
    if path is None or not path.is_file():
        raise _not_downloaded(download)
    headers = dict(PRIVATE_NO_CACHE)
    if download:
        headers["Content-Disposition"] = library.content_disposition(library.download_name(song, video_id))
        return FileResponse(path, media_type=AUDIO_TYPE, headers=headers)
    return FileResponse(path, media_type=AUDIO_TYPE, filename=path.name, headers=headers)


@router.get("/covers/{video_id}", responses=deps.responses(404, 422))
def get_cover(video_id: str, user: dict[str, Any] = Depends(deps.require_token_or_query)):
    deps.valid_id(video_id)
    path = deps.covers_dir(user["uid"]) / f"{video_id}.jpg"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no cover")
    return FileResponse(path, media_type=COVER_TYPE, headers=PRIVATE_NO_CACHE)
