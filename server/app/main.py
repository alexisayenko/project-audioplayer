"""Audio player API: per-user library, YouTube/SoundCloud import, file serving, web UI."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from . import deps, guest, web
from .problems import Problem
from .routes import analyze, auth, catalog, files, genres, health, legacy, lookup, me, removal, songs

app = FastAPI(title="Electrophone")


@app.exception_handler(deps.MusicRootUnavailable)
async def _music_root_unavailable(request: Request, exc: deps.MusicRootUnavailable) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(Problem)
async def _problem(request: Request, exc: Problem) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status, headers=exc.headers)


@app.middleware("http")
async def _no_store(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    if request.method in ("GET", "HEAD") and (request.url.path in guest.READ_PATHS or request.url.path.startswith(guest.READ_PREFIXES)):
        response.headers["Cache-Control"] = "private, no-cache"
        response.headers["Vary"] = "Cookie, Authorization"
    elif "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    return response


@app.on_event("startup")
def _startup() -> None:
    if deps.SYNC:
        deps.SYNC.resync()


for _module in (auth, me, health, legacy, files, catalog, genres, lookup, songs, analyze, removal):
    app.include_router(_module.router)

web.mount(app)
