from __future__ import annotations

from email.utils import formatdate, parsedate_to_datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response

from .. import audio_range, deps, guest, library, thumbs
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


def etag_matches(header: str, etag: str) -> bool:
    return any(part.strip().removeprefix("W/") == etag for part in header.split(","))


def not_modified_since(header: str, mtime: float) -> bool:
    try:
        return int(mtime) <= parsedate_to_datetime(header).timestamp()
    except (TypeError, ValueError, IndexError):
        return False


FOREVER = "private, max-age=31536000, immutable"
HOUR = "private, max-age=3600, stale-while-revalidate=86400"


def cover_file(request: Request, path: Path, versioned: bool) -> Response:
    """A cover image with a validator, answered 304 to a matching If-None-Match or If-Modified-Since. A request carrying the cover version `v` may be kept for a year: a new cover is a new URL. `private` because the same id is another image for another user."""
    stat = path.stat()
    headers = {
        "Cache-Control": FOREVER if versioned else HOUR,
        "ETag": f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"',
        "Last-Modified": formatdate(stat.st_mtime, usegmt=True),
    }
    tag = request.headers.get("if-none-match")
    if tag is not None:
        fresh = etag_matches(tag, headers["ETag"])
    else:
        fresh = not_modified_since(request.headers.get("if-modified-since", ""), stat.st_mtime)
    if fresh:
        return Response(status_code=304, headers=headers)
    return FileResponse(path, media_type=COVER_TYPE, headers=headers)


@router.get("/covers/{video_id}", responses=deps.responses(400, 404, 422))
def get_cover(
    request: Request,
    video_id: str,
    size: int | None = Query(default=None, description="Thumbnail edge in px: a square centre-crop; snapped to 96, 192 or 320. Omit for the original."),
    v: str = Query(default="", max_length=64, description="The song's cover_v: the answer is then cached for a year."),
    user: dict[str, Any] = Depends(deps.read_user),
):
    deps.valid_id(video_id)
    path = deps.covers_dir(user["uid"]) / f"{video_id}.jpg"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no cover")
    if size is not None:
        if size < 1:
            raise HTTPException(status_code=400, detail="size must be a positive number")
        thumb = thumbs.thumbnail(user["uid"], video_id, path, thumbs.snap(size))
        if thumb is not None:
            return cover_file(request, thumb, bool(v))
    return cover_file(request, path, bool(v))
