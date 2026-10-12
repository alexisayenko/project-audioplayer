"""Personal audio player API: library, YouTube import, file serving, web UI."""

from __future__ import annotations

import hmac
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import extractor, library

DOWNLOAD_DIR = Path(os.environ.get("AUDIO_DOWNLOAD_DIR", "downloads"))
DATA_DIR = Path(os.environ.get("AUDIO_DATA_DIR", "."))
WEB_DIR = Path(os.environ.get("AUDIO_WEB_DIR", Path(__file__).resolve().parents[2] / "web"))

app = FastAPI(title="audioplayer-server")

JOBS: dict[str, dict[str, Any]] = {}


def _check(token: str) -> None:
    expected = os.environ.get("AUDIO_API_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="AUDIO_API_TOKEN is not set")
    if not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="bad token")


def require_token(x_api_token: str = Header(default="")) -> None:
    _check(x_api_token)


def require_token_or_query(
    x_api_token: str = Header(default=""), token: str = Query(default="")
) -> None:
    """File/cover GETs: <audio>/<img> cannot send headers, so ?token= works too."""
    _check(x_api_token or token)


def library_path() -> Path:
    return DATA_DIR / "library.json"


def covers_dir() -> Path:
    return DATA_DIR / "covers"


def _vid(video_id: str) -> str:
    if not extractor.is_valid_video_id(video_id):
        raise HTTPException(status_code=422, detail="invalid video id")
    return video_id


def _clean_text(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


def _short(exc: Exception) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", str(exc)).strip()[:300]


class DownloadRequest(BaseModel):
    video_id: str


class PreviewRequest(BaseModel):
    url: str


class SongMeta(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    year: int | None = Field(default=None, ge=0, le=3000)
    genre: str | None = None


class CreateSongRequest(BaseModel):
    url: str
    metadata: SongMeta = SongMeta()
    tags: list[str] = []


class PatchSongRequest(SongMeta):
    tags: list[str] | None = None


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


@app.get("/files/{video_id}", dependencies=[Depends(require_token_or_query)])
def get_file(video_id: str):
    _vid(video_id)
    path = DOWNLOAD_DIR / f"{video_id}.m4a"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="not downloaded")
    return FileResponse(path, media_type="audio/mp4", filename=path.name)


@app.get("/covers/{video_id}", dependencies=[Depends(require_token_or_query)])
def get_cover(video_id: str):
    _vid(video_id)
    path = covers_dir() / f"{video_id}.jpg"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no cover")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/library", dependencies=[Depends(require_token)])
def get_library():
    with library.LOCK:
        return {"songs": library.load(library_path())}


@app.get("/tags", dependencies=[Depends(require_token)])
def get_tags():
    with library.LOCK:
        return library.tag_counts(library.load(library_path()))


@app.post("/preview", dependencies=[Depends(require_token)])
async def preview(req: PreviewRequest):
    vid = extractor.parse_video_id(req.url)
    if not vid:
        raise HTTPException(status_code=422, detail="not a YouTube video URL")
    try:
        meta = await run_in_threadpool(extractor.preview, vid)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"preview failed: {_short(exc)}") from exc
    with library.LOCK:
        meta["in_library"] = any(s["id"] == vid for s in library.load(library_path()))
    return meta


def _run_download(vid: str, meta: dict[str, Any], tags: list[str]) -> None:
    job = JOBS[vid]

    def progress(p: float) -> None:
        job["progress"] = round(p, 3)

    try:
        info = extractor.download_audio(vid, DOWNLOAD_DIR, progress)
        cover = None
        try:
            extractor.fetch_cover(vid, covers_dir() / f"{vid}.jpg")
            cover = f"covers/{vid}.jpg"
        except Exception:
            pass
        song = {
            "id": vid,
            "title": meta.get("title") or info.get("title") or vid,
            "artist": meta.get("artist") or info.get("artist"),
            "album": meta.get("album"),
            "year": meta.get("year"),
            "genre": meta.get("genre"),
            "source_url": extractor.watch_url(vid),
            "cover": cover,
            "duration": info.get("duration"),
            "added_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tags": tags,
        }
        with library.LOCK:
            songs = [s for s in library.load(library_path()) if s["id"] != vid]
            library.save(library_path(), songs + [song])
        job.update(status="done", progress=1.0)
    except Exception as exc:
        (DOWNLOAD_DIR / f"{vid}.m4a").unlink(missing_ok=True)
        job.update(status="error", error=_short(exc))


@app.post("/songs", status_code=202, dependencies=[Depends(require_token)])
def create_song(req: CreateSongRequest, background: BackgroundTasks):
    vid = extractor.parse_video_id(req.url)
    if not vid:
        raise HTTPException(status_code=422, detail="not a YouTube video URL")
    with library.LOCK:
        if any(s["id"] == vid for s in library.load(library_path())):
            raise HTTPException(status_code=409, detail="already in library")
        if JOBS.get(vid, {}).get("status") == "downloading":
            raise HTTPException(status_code=409, detail="already downloading")
        JOBS[vid] = {"status": "downloading", "progress": 0.0, "error": None}
    meta = {
        k: (v.strip() if isinstance(v, str) else v) or None
        for k, v in req.metadata.model_dump().items()
    }
    background.add_task(_run_download, vid, meta, library.clean_tags(req.tags))
    return {"id": vid, "status": "downloading"}


@app.get("/songs/{video_id}/status", dependencies=[Depends(require_token)])
def song_status(video_id: str):
    _vid(video_id)
    job = JOBS.get(video_id)
    if job:
        return {"id": video_id, **job}
    with library.LOCK:
        if any(s["id"] == video_id for s in library.load(library_path())):
            return {"id": video_id, "status": "done", "progress": 1.0, "error": None}
    raise HTTPException(status_code=404, detail="unknown song")


@app.patch("/songs/{video_id}", dependencies=[Depends(require_token)])
def patch_song(video_id: str, req: PatchSongRequest):
    _vid(video_id)
    changes = req.model_dump(exclude_unset=True)
    with library.LOCK:
        songs = library.load(library_path())
        song = next((s for s in songs if s["id"] == video_id), None)
        if song is None:
            raise HTTPException(status_code=404, detail="unknown song")
        updated = dict(song)
        for key in ("title", "artist", "album", "genre"):
            if key in changes:
                updated[key] = _clean_text(changes[key])
        if "year" in changes:
            updated["year"] = changes["year"]
        if changes.get("tags") is not None:
            updated["tags"] = library.clean_tags(changes["tags"])
        if not updated.get("title"):
            raise HTTPException(status_code=422, detail="title must not be empty")
        song.update(updated)
        library.save(library_path(), songs)
        return song


@app.delete("/songs/{video_id}", status_code=204, dependencies=[Depends(require_token)])
def delete_song(video_id: str):
    _vid(video_id)
    with library.LOCK:
        songs = library.load(library_path())
        if not any(s["id"] == video_id for s in songs):
            raise HTTPException(status_code=404, detail="unknown song")
        library.save(library_path(), [s for s in songs if s["id"] != video_id])
        (DOWNLOAD_DIR / f"{video_id}.m4a").unlink(missing_ok=True)
        (covers_dir() / f"{video_id}.jpg").unlink(missing_ok=True)
        JOBS.pop(video_id, None)


# Mounted last so API routes above always win.
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
