"""Personal audio player API: library, YouTube import, file serving, web UI."""

from __future__ import annotations

import hmac
import logging
import os
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import bpm as bpm_detect
from . import oauth, session
from . import extractor, genre_lookup, gitstore, library, wiki_lookup

DOWNLOAD_DIR = Path(os.environ.get("AUDIO_DOWNLOAD_DIR", "downloads"))
DATA_DIR = Path(os.environ.get("AUDIO_DATA_DIR", "."))
WEB_DIR = Path(os.environ.get("AUDIO_WEB_DIR", Path(__file__).resolve().parents[2] / "web"))

SYNC = gitstore.from_env()

app = FastAPI(title="Electrophone")

log = logging.getLogger(__name__)

JOBS: dict[str, dict[str, Any]] = {}


def _check(token: str) -> None:
    expected = os.environ.get("AUDIO_API_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="AUDIO_API_TOKEN is not set")
    if not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="bad token")


def _bearer(authorization: str) -> str:
    scheme, _, value = authorization.partition(" ")
    return value.strip() if scheme.lower() == "bearer" else ""


SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def authenticate(request: Request, x_api_token: str, authorization: str, query_token: str = "") -> dict:
    """X-API-Token wins, then Bearer ID token, then session cookie, then (files only) ?token=."""
    bearer = _bearer(authorization)
    if x_api_token:
        _check(x_api_token)
        return {"method": "token", "email": ""}
    if bearer:
        who = oauth.verify_owner(bearer)
        return {"method": "bearer", "email": who["email"]}
    who = session.read(request.cookies.get(session.COOKIE, ""))
    if who:
        if request.method not in SAFE_METHODS and not session.csrf_ok(
            request.headers, request.headers.get("host", "")
        ):
            raise HTTPException(status_code=403, detail="missing or foreign CSRF header")
        return {"method": "session", "email": who["email"]}
    _check(query_token)
    return {"method": "token", "email": ""}


def require_token(
    request: Request,
    x_api_token: str = Header(default=""),
    authorization: str = Header(default=""),
) -> None:
    authenticate(request, x_api_token, authorization)


def require_token_or_query(
    request: Request,
    x_api_token: str = Header(default=""),
    authorization: str = Header(default=""),
    token: str = Query(default=""),
) -> None:
    """File/cover GETs: <audio>/<img> cannot send headers, so the session cookie (or ?token=) works too."""
    authenticate(request, x_api_token, authorization, token)


class SessionRequest(BaseModel):
    id_token: str = Field(min_length=1, max_length=8192)


def _public_origin(request: Request) -> str:
    return f"https://{request.headers.get('host', request.url.netloc)}"


@app.get("/auth/config")
def auth_config(request: Request) -> dict[str, str]:
    """Non-secret client ids the web UI needs to start Google / Apple sign-in."""
    return {
        "google_client_id": os.environ.get("GOOGLE_WEB_CLIENT_ID", ""),
        "apple_client_id": os.environ.get("APPLE_WEB_CLIENT_ID", ""),
        "apple_redirect": os.environ.get("APPLE_WEB_REDIRECT_URI", "") or _public_origin(request) + "/",
    }


@app.post("/auth/session")
def auth_session(req: SessionRequest, request: Request, response: Response) -> dict[str, str]:
    if not session.csrf_ok(request.headers, request.headers.get("host", "")):
        raise HTTPException(status_code=403, detail="missing or foreign CSRF header")
    if not session.available():
        raise HTTPException(status_code=503, detail="AUDIO_SESSION_SECRET or AUDIO_API_TOKEN is not set")
    who = oauth.verify_owner(req.id_token)
    response.set_cookie(
        session.COOKIE, session.issue(who), max_age=session.LIFETIME, path="/",
        httponly=True, secure=True, samesite="strict",
    )
    return {"email": who["email"], "provider": who["provider"]}


@app.post("/auth/logout", status_code=204)
def auth_logout(request: Request) -> Response:
    if not session.csrf_ok(request.headers, request.headers.get("host", "")):
        raise HTTPException(status_code=403, detail="missing or foreign CSRF header")
    out = Response(status_code=204)
    out.delete_cookie(session.COOKIE, path="/", httponly=True, secure=True, samesite="strict")
    return out


@app.get("/auth/me")
def auth_me(
    request: Request, x_api_token: str = Header(default=""), authorization: str = Header(default="")
) -> dict[str, str]:
    return authenticate(request, x_api_token, authorization)


@app.middleware("http")
async def _no_store(request: Request, call_next):
    response = await call_next(request)
    if "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    return response


def library_path() -> Path:
    return SYNC.library_path if SYNC else DATA_DIR / "library.json"


def covers_dir() -> Path:
    if SYNC and SYNC.covers_dir:
        return SYNC.covers_dir
    return DATA_DIR / "covers"


def music_root() -> str:
    """AUDIO_MUSIC_ROOT overrides settings.music_root; default is the local download dir."""
    return (
        os.environ.get("AUDIO_MUSIC_ROOT")
        or library.load_doc(library_path())["settings"].get("music_root")
        or str(DOWNLOAD_DIR)
    )


def music_dir() -> Path:
    try:
        return library.resolve_music_root(music_root())
    except LookupError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _save(songs: list[dict[str, Any]]) -> None:
    library.save(library_path(), songs, default_music_root=music_root())


@contextmanager
def _tx(message: str):
    """Single writer: lock -> pull --rebase -> body (writes) -> commit -> push."""
    with library.LOCK:
        if SYNC is None:
            yield
            return
        with SYNC.transaction():
            yield
            SYNC.commit(message)


@app.on_event("startup")
def _startup() -> None:
    if SYNC:
        SYNC.resync()


def _vid(video_id: str) -> str:
    if not extractor.is_valid_video_id(video_id):
        raise HTTPException(status_code=422, detail="invalid video id")
    return video_id


def _clean_text(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


def _short(exc: Exception) -> str:
    text = re.sub(r"\x1b\[[0-9;]*m", "", str(exc)).strip()
    text = re.sub(r"^ERROR:\s*(\[\w+\]\s*[\w-]+:\s*)?", "", text)
    text = re.split(r"\s+(?:Use --cookies|See\s+https?://)", text)[0]
    return text.strip()[:300]


class DownloadRequest(BaseModel):
    video_id: str


class PreviewRequest(BaseModel):
    url: str


class SongMeta(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    year: int | None = Field(default=None, ge=0, le=3000)
    bpm: float | None = Field(default=None, ge=20, le=300)
    wikipedia_song: str | None = None
    wikipedia_artist: str | None = None


class CreateSongRequest(BaseModel):
    url: str
    metadata: SongMeta = SongMeta()
    tags: list[str] = []


class PatchSongRequest(SongMeta):
    tags: list[str] | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "sync": SYNC.status() if SYNC else "ok"}


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
    with library.LOCK:
        song = next((s for s in library.load(library_path()) if s["id"] == video_id), None)
    name = library.file_name(song) if song else f"{video_id}.m4a"
    path = music_dir() / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="not downloaded")
    return FileResponse(path, media_type="audio/mp4", filename=path.name,
                        headers={"Cache-Control": "private, no-cache"})


@app.get("/covers/{video_id}", dependencies=[Depends(require_token_or_query)])
def get_cover(video_id: str):
    _vid(video_id)
    path = covers_dir() / f"{video_id}.jpg"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no cover")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, no-cache"})


@app.get("/library", dependencies=[Depends(require_token)])
def get_library():
    with library.LOCK:
        return {"songs": library.load(library_path())}


@app.get("/tags", dependencies=[Depends(require_token)])
def get_tags():
    with library.LOCK:
        return library.tag_counts(library.load(library_path()))


_SUGGEST_CAPS = {"genre": 3, "country": 1, "lang": 2}


def _cap_suggestions(tags: list[str]) -> list[str]:
    used: dict[str, int] = {}
    out = []
    for t in tags:
        key = t.partition(":")[0] if ":" in t else ""
        if key in _SUGGEST_CAPS:
            if used.get(key, 0) >= _SUGGEST_CAPS[key]:
                continue
            used[key] = used.get(key, 0) + 1
        out.append(t)
    return out


class WikipediaLookupRequest(BaseModel):
    wikipedia_song: str | None = None
    wikipedia_artist: str | None = None


@app.post("/preview", dependencies=[Depends(require_token)])
async def preview(req: PreviewRequest):
    vid = extractor.parse_video_id(req.url)
    if not vid:
        raise HTTPException(status_code=422, detail="not a YouTube video URL")
    try:
        meta = await run_in_threadpool(extractor.preview, vid)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"preview failed: {_short(exc)}") from exc
    found = await run_in_threadpool(genre_lookup.suggest_tags, meta.get("artist", ""), meta.get("title", ""))
    wiki = await run_in_threadpool(wiki_lookup.suggest, meta.get("artist", ""), meta.get("title", ""))
    meta["tags"] = _cap_suggestions(library.clean_tags([*meta.get("tags", []), *found, *wiki["tags"]]))
    meta["wikipedia_song"] = wiki["wikipedia_song"]
    meta["wikipedia_artist"] = wiki["wikipedia_artist"]
    meta["suggested_year"] = wiki["year"]
    if meta.get("year") is None:
        meta["year"] = wiki["year"]
    with library.LOCK:
        meta["in_library"] = any(s["id"] == vid for s in library.load(library_path()))
    return meta


@app.post("/lookup/wikipedia", dependencies=[Depends(require_token)])
async def lookup_wikipedia(req: WikipediaLookupRequest):
    found = await run_in_threadpool(wiki_lookup.from_links, req.wikipedia_song, req.wikipedia_artist)
    return {"tags": _cap_suggestions(library.clean_tags(found["tags"])), "year": found["year"]}


def _run_download(vid: str, meta: dict[str, Any], tags: list[str]) -> None:
    job = JOBS[vid]

    def progress(p: float) -> None:
        job["progress"] = round(p, 3)

    try:
        info = extractor.download_audio(vid, music_dir(), progress)
        cover = None
        try:
            extractor.fetch_cover(vid, covers_dir() / f"{vid}.jpg")
            cover = f"covers/{vid}.jpg"
        except Exception:
            pass
        value = round(meta["bpm"]) if meta.get("bpm") is not None else None
        if value is None:
            try:
                value = bpm_detect.detect_bpm(music_dir() / f"{vid}.m4a")
            except Exception as exc:
                log.warning("bpm detection failed for %s: %s", vid, exc)
        song = {
            "id": vid,
            "title": meta.get("title") or info.get("title") or vid,
            "artist": meta.get("artist") or info.get("artist"),
            "album": meta.get("album"),
            "year": meta.get("year"),
            "bpm": value,
            "wikipedia_song": wiki_lookup.clean_link(meta.get("wikipedia_song")),
            "wikipedia_artist": wiki_lookup.clean_link(meta.get("wikipedia_artist")),
            "source_url": extractor.watch_url(vid),
            "file": f"{vid}.m4a",
            "cover": cover,
            "duration": info.get("duration"),
            "added_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tags": library.with_decade(tags, meta.get("year")),
        }
        with _tx(f"audioplayer: add {vid}"):
            songs = [s for s in library.load(library_path()) if s["id"] != vid]
            _save(songs + [song])
        job.update(status="done", progress=1.0)
    except Exception as exc:
        try:
            (music_dir() / f"{vid}.m4a").unlink(missing_ok=True)
        except HTTPException:
            pass
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
    with _tx(f"audioplayer: edit {video_id}"):
        songs = library.load(library_path())
        song = next((s for s in songs if s["id"] == video_id), None)
        if song is None:
            raise HTTPException(status_code=404, detail="unknown song")
        updated = dict(song)
        for key in ("title", "artist", "album"):
            if key in changes:
                updated[key] = _clean_text(changes[key])
        if "year" in changes:
            updated["year"] = changes["year"]
        if "bpm" in changes:
            updated["bpm"] = round(changes["bpm"]) if changes["bpm"] is not None else None
        for key in ("wikipedia_song", "wikipedia_artist"):
            if key in changes:
                updated[key] = wiki_lookup.clean_link(changes[key])
        if changes.get("tags") is not None:
            updated["tags"] = library.clean_tags(changes["tags"])
        if not updated.get("title"):
            raise HTTPException(status_code=422, detail="title must not be empty")
        updated["tags"] = library.with_decade(updated.get("tags") or [], updated.get("year"))
        song.update(updated)
        _save(songs)
        return song


@app.post("/songs/{video_id}/bpm/detect", dependencies=[Depends(require_token)])
async def detect_song_bpm(video_id: str):
    _vid(video_id)
    with library.LOCK:
        song = next((s for s in library.load(library_path()) if s["id"] == video_id), None)
    if song is None:
        raise HTTPException(status_code=404, detail="unknown song")
    path = music_dir() / library.file_name(song)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="not downloaded")
    value = await run_in_threadpool(bpm_detect.detect_bpm, path)
    if value is None:
        raise HTTPException(status_code=422, detail="could not detect BPM")
    return await run_in_threadpool(_store_bpm, video_id, value)


def _store_bpm(video_id: str, value: float) -> dict[str, Any]:
    with _tx(f"audioplayer: bpm {video_id}"):
        songs = library.load(library_path())
        song = next((s for s in songs if s["id"] == video_id), None)
        if song is None:
            raise HTTPException(status_code=404, detail="unknown song")
        song["bpm"] = round(value)
        _save(songs)
        return song


@app.delete("/songs/{video_id}", status_code=204, dependencies=[Depends(require_token)])
def delete_song(video_id: str):
    _vid(video_id)
    with _tx(f"audioplayer: delete {video_id}"):
        songs = library.load(library_path())
        song = next((s for s in songs if s["id"] == video_id), None)
        if song is None:
            raise HTTPException(status_code=404, detail="unknown song")
        _save([s for s in songs if s["id"] != video_id])
        (covers_dir() / f"{video_id}.jpg").unlink(missing_ok=True)
        try:
            (music_dir() / library.file_name(song)).unlink(missing_ok=True)
        except HTTPException:
            pass
        JOBS.pop(video_id, None)


class NoCacheStaticFiles(StaticFiles):
    """Revalidate on every load so UI edits show up without a hard refresh."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


# Mounted last so API routes above always win.
if WEB_DIR.is_dir():
    app.mount("/", NoCacheStaticFiles(directory=WEB_DIR, html=True), name="web")
