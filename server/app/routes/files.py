from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from .. import audio_range, deps, guest, library
from ..problems import Problem
from ..safepath import safe_join

router = APIRouter()

AUDIO_TYPE = "audio/mp4"
COVER_TYPE = "image/jpeg"
PRIVATE_NO_CACHE = {"Cache-Control": "private, no-cache"}


def _not_downloaded(download: bool) -> Problem | HTTPException:
    if download:
        return Problem(404, "audio_not_downloaded", "This song's audio is not on the server.")
    return HTTPException(status_code=404, detail=deps.NOT_DOWNLOADED)


@router.head("/files/{video_id}", include_in_schema=False)
@router.get("/files/{video_id}", responses=deps.responses(403, 404, 422, 429, 503))
def get_file(request: Request, video_id: str, download: bool = Query(default=False), user: dict[str, Any] = Depends(deps.read_user)):
    deps.valid_id(video_id)
    visitor = guest.is_guest(user)
    if visitor and not guest.audio_enabled():
        raise Problem(403, "guest_audio_disabled", "Audio is not available to guests.")
    if visitor and download:
        raise Problem(403, "guest_download_disabled", "Guests cannot download files.")
    uid = user["uid"]
    song = library.find_song(deps.load_songs(uid), video_id)
    if song is None and visitor:
        raise _not_downloaded(download)
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
    _cap_request_range(request, path, (uid, video_id))
    if visitor and request.method == "GET":
        return _guest_stream(request, path, headers)
    return FileResponse(path, media_type=AUDIO_TYPE, filename=path.name, headers=headers)


def _cap_request_range(request: Request, path: Path, key: tuple[str, str]) -> None:
    header = request.headers.get("range")
    if header is None or not audio_range.enabled():
        return
    capped = audio_range.capped_range(header, path.stat().st_size, key, record=request.method == "GET")
    if capped != header:
        request.scope["headers"] = [(k, v) for k, v in request.scope["headers"] if k != b"range"] + [(b"range", capped.encode())]
        request.__dict__.pop("_headers", None)


def _guest_stream(request: Request, path: Path, headers: dict[str, str]) -> FileResponse:
    ip = guest.client_ip(request)
    guest.open_stream(ip)
    try:
        guest.charge_audio(ip, guest.range_bytes(request.headers.get("range", ""), path.stat().st_size))
    except Exception:
        guest.close_stream(ip)
        raise
    return guest.GuestFile(path, media_type=AUDIO_TYPE, filename=path.name, headers=headers, ip=ip)


@router.get("/covers/{video_id}", responses=deps.responses(404, 422))
def get_cover(video_id: str, user: dict[str, Any] = Depends(deps.read_user)):
    deps.valid_id(video_id)
    path = deps.covers_dir(user["uid"]) / f"{video_id}.jpg"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no cover")
    return FileResponse(path, media_type=COVER_TYPE, headers=PRIVATE_NO_CACHE)
