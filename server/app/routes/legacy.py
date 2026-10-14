"""Endpoints the iOS app still uses: YouTube search and the synchronous download."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from .. import deps, extractor, limits, users
from ..downloads import run_scheduled
from ..schemas import DownloadRequest

router = APIRouter()

SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT = 10, 25


@router.get("/search", dependencies=[Depends(deps.require_token)])
async def search(q: str = Query(min_length=1), limit: int = Query(SEARCH_DEFAULT_LIMIT, ge=1, le=SEARCH_MAX_LIMIT)):
    return await run_in_threadpool(extractor.search, q, limit)


@router.post("/download", responses=deps.responses(422, 502))
async def download(req: DownloadRequest, user: dict[str, Any] = Depends(deps.require_token)):
    if not extractor.is_valid_video_id(req.video_id) or extractor.source_of(req.video_id) != "youtube":
        raise HTTPException(status_code=422, detail="invalid video id")
    uid, owner = user["uid"], user["owner"]
    with users.user_lock(uid):
        songs = deps.guard_add(uid, owner, True)
        limits.RATE.record(uid, songs)
    out = deps.audio_dir(uid)

    def fetch() -> dict[str, Any]:
        out.mkdir(parents=True, exist_ok=True)
        return extractor.download(req.video_id, out)

    try:
        meta = await run_in_threadpool(run_scheduled, uid, owner, fetch)
    except Exception as exc:  # yt-dlp raises many types; surface as 502
        raise HTTPException(status_code=502, detail=f"download failed: {exc}") from exc
    return {**meta, "file_url": f"/files/{req.video_id}"}
