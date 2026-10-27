"""Audio player API: per-user library, YouTube/SoundCloud import, file serving, web UI."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import anon, deps, features, genre_vocab, guest, hosts, legal, migrations, plays, readiness, session, web
from .problems import Problem, error_code
from .routes import playlist_import as playlist_import_routes
from .routes import album_video as album_video_routes, albums as albums_routes, analyze, anon as anon_routes, auth, backfill, catalog, covers, drafts, features as features_routes, files, genre_layout as genre_layout_routes, genre_references as genre_references_routes, genres, health, legacy, legal as legal_routes, lookup, me, metafill, peaks as peaks_routes, playlists as playlists_routes, plays as plays_routes, removal, songs

app = FastAPI(title="Electrophone")


@app.exception_handler(deps.MusicRootUnavailable)
async def _music_root_unavailable(request: Request, exc: deps.MusicRootUnavailable) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(Problem)
async def _problem(request: Request, exc: Problem) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status, headers=exc.headers)


@app.exception_handler(StarletteHTTPException)
async def _http_error(request: Request, exc: StarletteHTTPException) -> Response:
    code = error_code(exc.status_code, exc.detail)
    if code is None or exc.status_code < 400:
        return await http_exception_handler(request, exc)
    return JSONResponse({"error": code, "detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)


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
async def _renew_session(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    who = getattr(request.state, "session_renew", None)
    if who and response.status_code < 400 and not any(
        v.startswith(session.COOKIE + "=") for v in response.headers.getlist("set-cookie")
    ):
        response.set_cookie(session.COOKIE, session.issue(who), max_age=session.LIFETIME, **session.COOKIE_FLAGS)
    return response


@app.middleware("http")
async def _canonical_host(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    return hosts.canonical_redirect(request) or await call_next(request)


@app.middleware("http")
async def _no_index(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    response.headers["X-Robots-Tag"] = legal.ROBOTS_TAG
    return response


def _startup_steps() -> list[tuple[str, Callable[[], object]]]:
    steps: list[tuple[str, Callable[[], object]]] = []
    if deps.SYNC:
        steps.append(("git recovery", deps.SYNC.recover_on_startup))
    steps += migrations.startup_steps()
    steps.append(("record startup", features.record_startup))
    return steps


@app.on_event("startup")
def _startup() -> None:
    legal.check_startup()
    genre_vocab.check()
    readiness.start_worker(_startup_steps())
    plays.start_sync()
    anon.start()


@app.on_event("shutdown")
def _shutdown() -> None:
    plays.stop_sync()
    anon.stop()
    if deps.SYNC:
        deps.SYNC.flush()
        deps.SYNC.stop()


app.add_middleware(readiness.ReadinessMiddleware)

for _module in (auth, me, health, legal_routes, legacy, features_routes, files, peaks_routes, plays_routes, catalog, covers, genre_layout_routes, genre_references_routes, genres, lookup, playlist_import_routes, playlists_routes, album_video_routes, albums_routes, drafts, songs, analyze, backfill, metafill, removal, anon_routes):
    app.include_router(_module.router)

web.mount(app)
