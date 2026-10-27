"""Album from a time-coded video routes (API-264..API-270): preview from the video or a pasted text, create with the split job, job progress. User routes: a guest or anonymous caller gets 401."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import album_video, deps
from ..schemas import AlbumPreviewRequest, AlbumVideoTextRequest

router = APIRouter()
User = Annotated[dict[str, Any], Depends(deps.require_token)]


@router.post("/albums/from-video/preview", responses=deps.responses(400, 404, 413, 422, 429, 502))
async def preview_video(req: AlbumPreviewRequest, user: User):
    songs = await run_in_threadpool(deps.load_songs, user["uid"])
    return await run_in_threadpool(album_video.preview, user["uid"], user["owner"], req.url, songs, None, req.allowEmpty)


@router.post("/albums/from-video/preview-text", responses=deps.responses(400, 404, 413, 422, 429, 502))
async def preview_video_text(req: AlbumVideoTextRequest, user: User):
    songs = await run_in_threadpool(deps.load_songs, user["uid"])
    return await run_in_threadpool(album_video.preview, user["uid"], user["owner"], req.url, songs, req.text)


@router.post("/albums/from-video", status_code=202, responses=deps.responses(400, 403, 404, 409, 413, 422, 429, 502))
async def create_from_video(body: dict[str, Any], user: User):
    return await run_in_threadpool(album_video.create, user["uid"], user["owner"], body)


@router.get("/jobs/{job_id}", responses=deps.responses(404))
def get_job(job_id: str, user: User):
    return album_video.job_status(user["uid"], job_id)
