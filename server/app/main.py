"""Personal audio-download API: search YouTube, fetch m4a, serve the file."""

from __future__ import annotations

import hmac
import os
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import extractor

DOWNLOAD_DIR = Path(os.environ.get("AUDIO_DOWNLOAD_DIR", "downloads"))

app = FastAPI(title="audioplayer-server")


def require_token(x_api_token: str = Header(default="")) -> None:
    expected = os.environ.get("AUDIO_API_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="AUDIO_API_TOKEN is not set")
    if not hmac.compare_digest(x_api_token, expected):
        raise HTTPException(status_code=401, detail="bad token")


class DownloadRequest(BaseModel):
    video_id: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/search", dependencies=[Depends(require_token)])
async def search(q: str = Query(min_length=1), limit: int = Query(10, ge=1, le=25)):
    return await run_in_threadpool(extractor.search, q, limit)


@app.post("/download", dependencies=[Depends(require_token)])
async def download(req: DownloadRequest):
    if not extractor.is_valid_video_id(req.video_id):
        raise HTTPException(status_code=422, detail="invalid video id")
    try:
        meta = await run_in_threadpool(extractor.download, req.video_id, DOWNLOAD_DIR)
    except Exception as exc:  # yt-dlp raises many types; surface as 502
        raise HTTPException(status_code=502, detail=f"download failed: {exc}") from exc
    return {**meta, "file_url": f"/files/{req.video_id}"}


@app.get("/files/{video_id}", dependencies=[Depends(require_token)])
def get_file(video_id: str):
    if not extractor.is_valid_video_id(video_id):
        raise HTTPException(status_code=422, detail="invalid video id")
    path = DOWNLOAD_DIR / f"{video_id}.m4a"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="not downloaded")
    return FileResponse(path, media_type="audio/mp4", filename=path.name)
