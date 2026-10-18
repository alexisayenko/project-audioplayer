"""Audio player API: per-user library, YouTube/SoundCloud import, file serving, web UI."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from . import deps, genre_vocab, guest, hosts, legal, migrate_model2, migrate_model3, migrate_tags, web
from .problems import Problem
from .routes import playlist_import as playlist_import_routes
from .routes import analyze, auth, backfill, catalog, covers, drafts, files, genres, health, legacy, legal as legal_routes, lookup, me, metafill, removal, songs

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


@app.middleware("http")
async def _canonical_host(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    return hosts.canonical_redirect(request) or await call_next(request)


@app.middleware("http")
async def _no_index(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    response.headers["X-Robots-Tag"] = legal.ROBOTS_TAG
    return response


@app.on_event("startup")
def _startup() -> None:
    legal.check_startup()
    genre_vocab.check()
    if deps.SYNC:
        deps.SYNC.recover_on_startup()
    migrate_model2.run()
    migrate_model3.run()
    migrate_tags.run()


@app.on_event("shutdown")
def _shutdown() -> None:
    if deps.SYNC:
        deps.SYNC.flush()
        deps.SYNC.stop()


for _module in (auth, me, health, legal_routes, legacy, files, catalog, covers, genres, lookup, playlist_import_routes, drafts, songs, analyze, backfill, metafill, removal):
    app.include_router(_module.router)

web.mount(app)
