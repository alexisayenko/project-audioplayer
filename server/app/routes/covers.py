"""Changing a song's cover: upload an image, take one from a URL, or remove it."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .. import coverimg, deps, library
from ..jsonio import write_bytes_atomic
from ..problems import Problem

router = APIRouter()


class CoverUrlRequest(BaseModel):
    url: str = Field(max_length=2048)


def _require_song(uid: str, video_id: str) -> None:
    if library.find_song(deps.load_songs(uid), video_id) is None:
        raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)


def _store(uid: str, video_id: str, jpeg: bytes) -> dict[str, Any]:
    with deps.tx(uid, f"cover {video_id}"):
        songs = library.load(deps.library_path(uid))
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        dest = deps.covers_dir(uid) / f"{video_id}.jpg"
        dest.parent.mkdir(parents=True, exist_ok=True)
        write_bytes_atomic(dest, jpeg)
        song.update(cover=f"covers/{video_id}.jpg", cover_v=coverimg.version_of(jpeg), cover_off=None, updated_at=library.now_utc())
        deps.save_songs(uid, songs)
        return deps.public_song(uid, song)


async def _body(request: Request) -> bytes:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > coverimg.MAX_BYTES:
        raise coverimg.too_large()
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > coverimg.MAX_BYTES:
            raise coverimg.too_large()
        chunks.append(chunk)
    return b"".join(chunks)


@router.put("/songs/{video_id}/cover", responses=deps.responses(404, 422))
async def put_cover(video_id: str, request: Request, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    """Raw image bytes as the body (JPEG, PNG or WebP, at most 5 MB); stored re-encoded as a JPEG of at most 1024 px."""
    deps.valid_id(video_id)
    uid = user["uid"]
    kind = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if kind not in coverimg.ALLOWED_TYPES:
        raise Problem(415, "cover_bad_type", "Use a JPEG, PNG or WebP image.")
    await run_in_threadpool(_require_song, uid, video_id)
    data = await _body(request)
    jpeg = await run_in_threadpool(coverimg.normalize, data)
    return await run_in_threadpool(_store, uid, video_id, jpeg)


@router.post("/songs/{video_id}/cover/from-url", responses=deps.responses(404, 422, 502))
def cover_from_url(video_id: str, req: CoverUrlRequest, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    deps.valid_id(video_id)
    uid = user["uid"]
    _require_song(uid, video_id)
    jpeg = coverimg.normalize(coverimg.fetch(req.url))
    return _store(uid, video_id, jpeg)


@router.delete("/songs/{video_id}/cover", status_code=204, responses=deps.responses(404, 422))
def delete_cover(video_id: str, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    """Remove the cover so the placeholder shows; idempotent. A later audio fetch does not bring it back."""
    deps.valid_id(video_id)
    uid = user["uid"]
    with deps.tx(uid, f"cover off {video_id}"):
        songs = library.load(deps.library_path(uid))
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        (deps.covers_dir(uid) / f"{video_id}.jpg").unlink(missing_ok=True)
        song.update(cover=None, cover_v=None, cover_off=True, updated_at=library.now_utc())
        deps.save_songs(uid, songs)
