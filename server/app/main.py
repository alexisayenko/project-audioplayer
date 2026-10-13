"""Audio player API: per-user library, YouTube/SoundCloud import, file serving, web UI."""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import bpm as bpm_detect
from . import jobs, limits, oauth, session, users
from . import extractor, genre_lookup, genres, gitstore, library, metadata, urlclean, wiki_lookup
from .problems import Problem

DOWNLOAD_DIR = Path(os.environ.get("AUDIO_DOWNLOAD_DIR", "downloads"))
DATA_DIR = Path(os.environ.get("AUDIO_DATA_DIR", "."))
WEB_DIR = Path(os.environ.get("AUDIO_WEB_DIR", Path(__file__).resolve().parents[2] / "web"))

SYNC = gitstore.from_env()
SCHED = jobs.Scheduler()

app = FastAPI(title="Electrophone")

_NOT_DOWNLOADED = "not downloaded"
_UNKNOWN_SONG = "unknown song"
_CSRF_DETAIL = "missing or foreign CSRF header"

log = logging.getLogger(__name__)

JOBS: dict[tuple[str, str], dict[str, Any]] = {}
ACTIVE = ("queued", "downloading")


class MusicRootUnavailable(Exception):
    pass


@app.exception_handler(MusicRootUnavailable)
async def _music_root_unavailable(request: Request, exc: MusicRootUnavailable) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=503)


@app.exception_handler(Problem)
async def _problem(request: Request, exc: Problem) -> JSONResponse:
    return JSONResponse(exc.body(), status_code=exc.status, headers=exc.headers)


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


# --- storage layout: users/<uid>/... in both repos, music_root/users/<uid>/ for audio -------------

def data_root() -> Path:
    return SYNC.data_root if SYNC else DATA_DIR


def covers_root() -> Path:
    return SYNC.covers_root if SYNC and SYNC.covers_root else DATA_DIR


def library_path(uid: str) -> Path:
    return data_root() / "users" / uid / "library.json"


def profile_path(uid: str) -> Path:
    return data_root() / "users" / uid / "profile.json"


def covers_dir(uid: str) -> Path:
    return covers_root() / "users" / uid / "covers"


def music_root() -> str:
    """AUDIO_MUSIC_ROOT overrides the owner's settings.music_root (or the legacy library's); else the download dir."""
    if os.environ.get("AUDIO_MUSIC_ROOT"):
        return os.environ["AUDIO_MUSIC_ROOT"]
    for path in (library_path(users.owner_uid()), data_root() / "library.json"):
        found = library.load_doc(path)["settings"].get("music_root")
        if found:
            return found
    return str(DOWNLOAD_DIR)


def music_dir() -> Path:
    try:
        return library.resolve_music_root(music_root())
    except LookupError as exc:
        raise MusicRootUnavailable(str(exc)) from exc


def pool_dir() -> Path:
    return music_dir() / "users"


def audio_dir(uid: str) -> Path:
    return pool_dir() / uid


def _root(uid: str) -> Path | None:
    """The user's audio directory, or None when its music_root server is not configured (state then trusts `file`)."""
    try:
        return library.resolve_music_root(music_root()) / "users" / uid
    except LookupError:
        return None


def _public(uid: str, songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    root = _root(uid)
    return [library.public_song(s, root) for s in songs]


def _load(uid: str) -> list[dict[str, Any]]:
    with users.user_lock(uid):
        return library.load(library_path(uid))


def _save(uid: str, songs: list[dict[str, Any]]) -> None:
    library.save(library_path(uid), songs, default_music_root=music_root())


@contextmanager
def _tx(uid: str, verb: str):
    """One writer per user, one git writer overall: user lock -> pull --rebase -> body -> commit -> push."""
    with users.user_lock(uid):
        if SYNC is None:
            yield
            return
        with SYNC.transaction():
            yield
            SYNC.commit(f"audioplayer: {uid[:8]} {verb}")


# --- who is calling --------------------------------------------------------------------------

_subs: dict[tuple[str, str], str] = {}


def _find_uid_by_sub(provider: str, sub: str) -> str | None:
    """Apple may omit the email: find the profile that recorded this Apple user id."""
    if (provider, sub) in _subs:
        return _subs[(provider, sub)]
    for profile in sorted((data_root() / "users").glob("*/profile.json")):
        data = users.read_profile(profile) or {}
        if (data.get("subs") or {}).get(provider) == sub:
            _subs[(provider, sub)] = profile.parent.name
            return profile.parent.name
    return None


def _identity(who: dict[str, str]) -> dict[str, str]:
    """oauth.verify_identity result -> {provider, email, sub, uid}. Never takes a uid from the client."""
    email = who["email"]
    if who["provider"] == "apple" and who["sub"].lower() in users.pinned_apple_subs():
        email = users.owner_email()
    if email:
        uid = users.uid_for_email(email)
    else:
        uid = _find_uid_by_sub(who["provider"], who["sub"]) or users.uid_for_sub(who["sub"])
    return {"provider": who["provider"], "email": email, "sub": who["sub"], "uid": uid}


def _principal(method: str, identity: dict[str, str]) -> dict[str, Any]:
    uid = identity["uid"]
    return {"method": method, "uid": uid, "email": identity["email"], "provider": identity["provider"],
            "owner": users.is_owner(uid)}


def _admit(method: str, identity: dict[str, str]) -> dict[str, Any]:
    """Create the user's profile on first sign-in (open signup), or refuse when signup is closed."""
    uid = identity["uid"]
    if users.read_profile(profile_path(uid)) is None:
        if not users.is_owner(uid) and not users.signup_open():
            raise Problem(403, "signup_closed", "Sign-up is closed.")
        with _tx(uid, "signup"):
            if users.read_profile(profile_path(uid)) is None:
                users.write_profile(profile_path(uid), users.new_profile(identity))
    return _principal(method, identity)


def _owner_principal(method: str) -> dict[str, Any]:
    return _principal(method, {"provider": "token", "email": users.owner_email(), "sub": "",
                               "uid": users.owner_uid()})


def authenticate(request: Request, x_api_token: str, authorization: str, query_token: str = "") -> dict[str, Any]:
    """X-API-Token (owner) wins, then Bearer ID token, then session cookie, then (files only) ?token= (owner)."""
    bearer = _bearer(authorization)
    if x_api_token:
        _check(x_api_token)
        return _owner_principal("token")
    if bearer:
        return _admit("bearer", _identity(oauth.verify_identity(bearer)))
    who = session.read(request.cookies.get(session.COOKIE, ""))
    if who:
        if request.method not in SAFE_METHODS and not session.csrf_ok(
            request.headers, request.headers.get("host", "")
        ):
            raise HTTPException(status_code=403, detail=_CSRF_DETAIL)
        uid = who["uid"] or users.uid_for_email(who["email"])
        return _admit("session", {"provider": who["provider"], "email": who["email"], "sub": "", "uid": uid})
    _check(query_token)
    return _owner_principal("token")


def require_token(
    request: Request,
    x_api_token: str = Header(default=""),
    authorization: str = Header(default=""),
) -> dict[str, Any]:
    return authenticate(request, x_api_token, authorization)


def require_token_or_query(
    request: Request,
    x_api_token: str = Header(default=""),
    authorization: str = Header(default=""),
    token: str = Query(default=""),
) -> dict[str, Any]:
    """File/cover GETs: <audio>/<img> cannot send headers, so the session cookie (or ?token=, owner only) works too."""
    return authenticate(request, x_api_token, authorization, token)


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


@app.post("/auth/session", responses={403: {"description": "Forbidden"}, 503: {"description": "Not configured"}})
def auth_session(req: SessionRequest, request: Request, response: Response) -> dict[str, str]:
    if not session.csrf_ok(request.headers, request.headers.get("host", "")):
        raise HTTPException(status_code=403, detail=_CSRF_DETAIL)
    if not session.available():
        raise HTTPException(status_code=503, detail="AUDIO_SESSION_SECRET or AUDIO_API_TOKEN is not set")
    identity = _identity(oauth.verify_identity(req.id_token))
    _admit("session", identity)
    response.set_cookie(
        session.COOKIE, session.issue(identity), max_age=session.LIFETIME, path="/",
        httponly=True, secure=True, samesite="strict",
    )
    return {"email": identity["email"], "provider": identity["provider"]}


@app.post("/auth/logout", status_code=204, responses={403: {"description": "Forbidden"}})
def auth_logout(request: Request) -> Response:
    if not session.csrf_ok(request.headers, request.headers.get("host", "")):
        raise HTTPException(status_code=403, detail=_CSRF_DETAIL)
    out = Response(status_code=204)
    out.delete_cookie(session.COOKIE, path="/", httponly=True, secure=True, samesite="strict")
    return out


@app.get("/auth/me")
def auth_me(user: dict[str, Any] = Depends(require_token)) -> dict[str, Any]:
    return {k: user[k] for k in ("method", "email", "provider", "owner")}


@app.get("/me")
def me(user: dict[str, Any] = Depends(require_token)) -> dict[str, Any]:
    profile = users.read_profile(profile_path(user["uid"])) or {}
    return {"email": user["email"], "provider": user["provider"], "owner": user["owner"],
            "created_at": profile.get("created_at")}


@app.get("/me/usage")
def me_usage(user: dict[str, Any] = Depends(require_token)) -> dict[str, Any]:
    uid = user["uid"]
    root = _root(uid)
    return limits.usage(uid, user["owner"], _load(uid), root if root is not None else Path(os.devnull))


@app.middleware("http")
async def _no_store(request: Request, call_next):
    response = await call_next(request)
    if "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    return response


@app.on_event("startup")
def _startup() -> None:
    if SYNC:
        SYNC.resync()


def _vid(video_id: str) -> str:
    if not extractor.is_valid_video_id(video_id):
        raise HTTPException(status_code=422, detail="invalid video id")
    return video_id


def _error(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse({"error": code, "detail": detail}, status_code=status)


class _Resolved:
    """A pasted link resolved to a song id (and, for SoundCloud, its probed metadata)."""

    def __init__(self, vid: str, url: str, probe: dict[str, Any] | None = None):
        self.vid, self.url, self.probe = vid, url, probe


class _Refused(Exception):
    def __init__(self, response: JSONResponse):
        self.response = response


_NOT_A_LINK = "not a YouTube video or SoundCloud track URL"


def _resolve_link(text: str) -> _Resolved:
    """YouTube link -> id; SoundCloud link -> canonical URL, id and probe. Raises _Refused with the JSON error."""
    vid = extractor.parse_video_id(text)
    if vid:
        return _Resolved(vid, extractor.watch_url(vid))
    sc = urlclean.classify_soundcloud(text)
    if sc is None:
        raise _Refused(_error(422, "unsupported", _NOT_A_LINK))
    kind, url = sc
    if kind == "unsupported":
        raise _Refused(_error(422, "unsupported", urlclean.UNSUPPORTED_MESSAGE))
    try:
        if kind == "short":
            url = urlclean.resolve_soundcloud_short(url)
        probe = extractor.soundcloud_probe(url)
    except ValueError as exc:
        raise _Refused(_error(422, "unsupported", str(exc))) from exc
    except Exception as exc:
        code = extractor.error_code(exc)
        status = {"not_found": 404, "private": 403}.get(code or "", 502)
        raise _Refused(_error(status, code or "failed", f"preview failed: {_short(exc)}")) from exc
    if probe.get("preview_only"):
        raise _Refused(_error(422, "preview_only", extractor.PREVIEW_ONLY_MESSAGE))
    return _Resolved(probe["id"], probe["source_url"], probe)


def _clean_text(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


def _cut_hint(text: str) -> str:
    cut = len(text)
    i = text.find("Use --cookies", 1)
    while i > 0:
        if text[i - 1].isspace():
            cut = i
            break
        i = text.find("Use --cookies", i + 1)
    i = text.find("See", 1, cut)
    while i > 0:
        if text[i - 1].isspace():
            rest = text[i + 3 :]
            tail = rest.lstrip()
            if len(tail) < len(rest) and tail.startswith(("http://", "https://")):
                cut = i
                break
        i = text.find("See", i + 1, cut)
    return text[:cut].rstrip()


def _short(exc: Exception) -> str:
    text = re.sub(r"\x1b\[[0-9;]*m", "", str(exc)).strip()
    text = re.sub(r"^ERROR:\s*(\[\w+\]\s*[\w-]+:\s*)?", "", text)
    return _cut_hint(text).strip()[:300]


class DownloadRequest(BaseModel):
    video_id: str


class PreviewRequest(BaseModel):
    url: str


class SongMeta(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    remixer: str | None = None
    year: int | None = Field(default=None, ge=0, le=3000)
    bpm: float | None = Field(default=None, ge=20, le=300)
    wikipedia_song: str | None = None
    wikipedia_artist: str | None = None
    musicbrainz_url: str | None = None


class CreateSongRequest(BaseModel):
    url: str
    audio: bool = True
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


def _inflight(uid: str) -> int:
    return sum(1 for (u, _), job in JOBS.copy().items() if u == uid and job.get("status") in ACTIVE)


def _guard_add(uid: str, owner: bool, with_audio: bool) -> list[dict[str, Any]]:
    """Quota checks before anything is downloaded; returns the user's songs."""
    songs = _load(uid)
    null = Path(os.devnull)
    limits.check_add(uid, owner, songs, audio_dir(uid) if with_audio else null,
                     pool_dir() if with_audio else null, inflight=_inflight(uid), with_audio=with_audio)
    return songs


def _scheduled(uid: str, owner: bool, fn):
    """Run `fn` under the download caps and wait for its result (for the synchronous /download)."""
    done = threading.Event()
    box: dict[str, Any] = {}

    def run() -> None:
        try:
            box["value"] = fn()
        except Exception as exc:
            box["error"] = exc
        finally:
            done.set()

    SCHED.submit(uid, owner, run, lambda: None)
    done.wait()
    if "error" in box:
        raise box["error"]
    if "value" not in box:
        raise RuntimeError("download worker stopped before finishing")
    return box["value"]


@app.post("/download", responses={422: {"description": "Unprocessable"}, 502: {"description": "Upstream failure"}})
async def download(req: DownloadRequest, user: dict[str, Any] = Depends(require_token)):
    if not extractor.is_valid_video_id(req.video_id) or extractor.source_of(req.video_id) != "youtube":
        raise HTTPException(status_code=422, detail="invalid video id")
    uid, owner = user["uid"], user["owner"]
    with users.user_lock(uid):
        songs = _guard_add(uid, owner, True)
        limits.RATE.record(uid, songs)
    out = audio_dir(uid)

    def fetch():
        out.mkdir(parents=True, exist_ok=True)
        return extractor.download(req.video_id, out)

    try:
        meta = await run_in_threadpool(_scheduled, uid, owner, fetch)
    except Exception as exc:  # yt-dlp raises many types; surface as 502
        raise HTTPException(status_code=502, detail=f"download failed: {exc}") from exc
    return {**meta, "file_url": f"/files/{req.video_id}"}


@app.get("/files/{video_id}", responses={404: {"description": "Not found"}, 422: {"description": "Unprocessable"}, 503: {"description": "Not configured"}})
def get_file(video_id: str, user: dict[str, Any] = Depends(require_token_or_query)):
    _vid(video_id)
    uid = user["uid"]
    song = next((s for s in _load(uid) if s["id"] == video_id), None)
    if song is not None and not library.has_file(song):
        raise HTTPException(status_code=404, detail=_NOT_DOWNLOADED)
    name = library.file_name(song) if song else f"{video_id}.m4a"
    base = audio_dir(uid)
    path = base / name
    if not path.resolve().is_relative_to(base.resolve()) or not path.is_file():
        raise HTTPException(status_code=404, detail=_NOT_DOWNLOADED)
    return FileResponse(path, media_type="audio/mp4", filename=path.name,
                        headers={"Cache-Control": "private, no-cache"})


@app.get("/covers/{video_id}", responses={404: {"description": "Not found"}, 422: {"description": "Unprocessable"}})
def get_cover(video_id: str, user: dict[str, Any] = Depends(require_token_or_query)):
    _vid(video_id)
    path = covers_dir(user["uid"]) / f"{video_id}.jpg"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no cover")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, no-cache"})


@app.get("/library")
def get_library(user: dict[str, Any] = Depends(require_token)):
    uid = user["uid"]
    return {"songs": _public(uid, _load(uid))}


def _etag_matches(header: str, etag: str) -> bool:
    return any(t.strip() in ("*", etag, f"W/{etag}") for t in header.split(","))


_SINCE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


@app.get("/catalog", responses={422: {"description": "Unprocessable"}})
def get_catalog(request: Request, since: str | None = Query(default=None),
                user: dict[str, Any] = Depends(require_token)):
    """Metadata-only catalog for clients to poll: `revision`, every id, and the songs changed `>= since`."""
    if since is not None and not _SINCE_RE.match(since):
        raise HTTPException(status_code=422, detail="since must be UTC YYYY-MM-DDTHH:MM:SSZ")
    uid = user["uid"]
    public = _public(uid, _load(uid))
    revision = library.catalog_revision(public)
    etag = f'"{revision}"' if since is None else f'"{revision}.{hashlib.sha1(since.encode()).hexdigest()[:8]}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if _etag_matches(request.headers.get("if-none-match", ""), etag):
        return Response(status_code=304, headers=headers)
    changed = [s for s in public if since is None or library.updated_at(s) >= since]
    body = {
        "revision": revision,
        "total": len(public),
        "ids": [s["id"] for s in public],
        "songs": changed,
    }
    return JSONResponse(body, headers=headers)


@app.get("/tags")
def get_tags(user: dict[str, Any] = Depends(require_token)):
    return library.tag_counts(_load(user["uid"]))


GENRES_MAX = 1000


@app.get("/genres")
def get_genres(user: dict[str, Any] = Depends(require_token)):
    counts: dict[str, int] = {}
    for s in _load(user["uid"]):
        for t in s.get("tags", []):
            key, sep, value = t.partition(":")
            if sep and key.casefold() == "genre":
                n = genres.normalise(value)
                if n:
                    counts[n] = counts.get(n, 0) + 1
    used = sorted(counts, key=lambda g: (-counts[g], g))
    rest = [g for g in genres.BUILTIN if g not in counts]
    return {"genres": [*used, *rest][:GENRES_MAX]}


class WikipediaLookupRequest(BaseModel):
    wikipedia_song: str | None = None
    wikipedia_artist: str | None = None


@app.post("/preview", responses={502: {"description": "Upstream failure"}})
async def preview(req: PreviewRequest, user: dict[str, Any] = Depends(require_token)):
    try:
        link = await run_in_threadpool(_resolve_link, req.url)
    except _Refused as refused:
        return refused.response
    vid = link.vid
    if link.probe is not None:
        meta = {k: v for k, v in link.probe.items() if k != "preview_only"}
    else:
        try:
            meta = await run_in_threadpool(extractor.preview, vid)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"preview failed: {_short(exc)}") from exc
    found = await run_in_threadpool(genre_lookup.suggest_tags, meta.get("artist", ""), meta.get("title", ""))
    wiki = await run_in_threadpool(wiki_lookup.suggest, meta.get("artist", ""), meta.get("title", ""))
    meta["tags"] = metadata.finalize_tags([*meta.get("tags", []), *found, *wiki["tags"]], wiki.get("song_genres"))
    meta["wikipedia_song"] = wiki["wikipedia_song"]
    meta["wikipedia_artist"] = wiki["wikipedia_artist"]
    meta["suggested_year"] = wiki["year"]
    meta["remixer"] = meta.get("remixer")
    if meta.get("year") is None:
        meta["year"] = wiki["year"]
    meta["in_library"] = any(s["id"] == vid for s in _load(user["uid"]))
    return meta


class MetadataSource(BaseModel):
    url: str = ""


class MetadataRequest(BaseModel):
    title: str = ""
    artist: str = ""
    sources: list[MetadataSource] = Field(default_factory=list)
    wiki_song: str | None = None
    wiki_artist: str | None = None


def _source_info(url: str) -> dict[str, Any]:
    """album, year and tags yt-dlp reports for one YouTube/SoundCloud link; raises when the link is unusable."""
    link = _resolve_link(url)
    if link.probe is not None:
        return link.probe
    return extractor.preview(link.vid)


@app.post("/metadata", dependencies=[Depends(require_token)])
async def get_metadata(req: MetadataRequest):
    urls = [src.url.strip() for src in req.sources[:5] if src.url.strip()]
    fetchers = [(lambda u=u: _source_info(u)) for u in urls]
    out = await run_in_threadpool(
        metadata.gather, req.title.strip(), req.artist.strip(), fetchers, req.wiki_song, req.wiki_artist, metadata.TIMEOUT, urls
    )
    return out


@app.post("/lookup/wikipedia", dependencies=[Depends(require_token)])
async def lookup_wikipedia(req: WikipediaLookupRequest):
    found = await run_in_threadpool(wiki_lookup.from_links, req.wikipedia_song, req.wikipedia_artist)
    return {"tags": metadata.finalize_tags(found["tags"], found.get("song_genres")), "year": found["year"]}


def _drop_partial(out: Path | None, vid: str) -> None:
    if out is not None:
        (out / f"{vid}.m4a").unlink(missing_ok=True)


def _run_download(uid: str, owner: bool, vid: str, meta: dict[str, Any], tags: list[str],
                  source_url: str | None = None) -> None:
    job = JOBS[(uid, vid)]
    out: Path | None = None

    def progress(p: float) -> None:
        job["progress"] = round(p, 3)

    try:
        out = audio_dir(uid)
        limits.check_capacity(owner, out, pool_dir())
        info = extractor.download_audio(vid, out, progress, source_url)
        cover = None
        try:
            extractor.fetch_cover(vid, covers_dir(uid) / f"{vid}.jpg", info.get("thumbnail"))
            cover = f"covers/{vid}.jpg"
        except Exception:
            pass
        value = round(meta["bpm"]) if meta.get("bpm") is not None else None
        if value is None:
            try:
                value = bpm_detect.detect_bpm(out / f"{vid}.m4a")
            except Exception as exc:
                log.warning("bpm detection failed for %s: %s", vid, exc)
        song = {
            "id": vid,
            "title": meta.get("title") or info.get("title") or vid,
            "artist": meta.get("artist") or info.get("artist"),
            "album": meta.get("album"),
            "remixer": meta.get("remixer"),
            "year": meta.get("year"),
            "bpm": value,
            "wikipedia_song": wiki_lookup.clean_link(meta.get("wikipedia_song")),
            "wikipedia_artist": wiki_lookup.clean_link(meta.get("wikipedia_artist")),
            "musicbrainz_url": genre_lookup.clean_recording_url(meta.get("musicbrainz_url")),
            **({"source": "soundcloud"} if extractor.source_of(vid) == "soundcloud" else {}),
            "source_url": extractor.watch_url(vid, source_url),
            "sources": [{"source": extractor.source_of(vid), "id": vid, "url": extractor.watch_url(vid, source_url)}],
            "file": f"{vid}.m4a",
            "cover": cover,
            "duration": info.get("duration"),
            "added_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tags": library.with_decade(tags, meta.get("year")),
        }
        with _tx(uid, f"add {vid}"):
            songs = [s for s in library.load(library_path(uid)) if s["id"] != vid]
            _save(uid, songs + [song])
        job.update(status="done", progress=1.0)
    except extractor.PreviewOnly as exc:
        _drop_partial(out, vid)
        job.update(status="error", error=str(exc), code="preview_only")
    except Problem as exc:
        _drop_partial(out, vid)
        job.update(status="error", error=exc.detail, code=exc.code)
    except Exception as exc:
        _drop_partial(out, vid)
        job.update(status="error", error=_short(exc))


@app.post("/songs", status_code=202, responses={409: {"description": "Conflict"}})
def create_song(req: CreateSongRequest, user: dict[str, Any] = Depends(require_token)):
    uid, owner = user["uid"], user["owner"]
    _guard_add(uid, owner, req.audio)
    try:
        link = _resolve_link(req.url)
    except _Refused as refused:
        return refused.response
    vid = link.vid
    key = (uid, vid)
    with users.user_lock(uid):
        songs = _guard_add(uid, owner, req.audio)
        if any(s["id"] == vid for s in songs):
            raise HTTPException(status_code=409, detail="already in library")
        if JOBS.get(key, {}).get("status") in ACTIVE:
            raise HTTPException(status_code=409, detail="already downloading")
        limits.RATE.record(uid, songs)
        JOBS[key] = {"status": "queued", "progress": 0.0, "error": None}
    meta = {
        k: (v.strip() if isinstance(v, str) else v) or None
        for k, v in req.metadata.model_dump().items()
    }
    if not req.audio:
        return _add_metadata_only(uid, vid, link, meta, library.clean_tags(req.tags))

    def started() -> None:
        job = JOBS.get(key)
        if job is not None:
            job["status"] = "downloading"

    began = SCHED.submit(
        uid, owner,
        lambda: _run_download(uid, owner, vid, meta, library.clean_tags(req.tags), link.url), started)
    return {"id": vid, "status": "downloading" if began else "queued"}


def _add_metadata_only(uid: str, vid: str, link: _Resolved, meta: dict[str, Any], tags: list[str]) -> JSONResponse:
    """Catalog entry without audio: `file: null`, state `none`. Gaps in the metadata are filled from the link."""
    try:
        try:
            found = link.probe if link.probe is not None else extractor.preview(vid)
        except Exception as exc:
            log.warning("preview failed for %s: %s", vid, exc)
            found = {}
        cover = None
        try:
            extractor.fetch_cover(vid, covers_dir(uid) / f"{vid}.jpg", found.get("thumbnail"))
            cover = f"covers/{vid}.jpg"
        except Exception:
            pass
        url = extractor.watch_url(vid, link.url)
        now = library.now_utc()
        song = {
            "id": vid,
            "title": meta.get("title") or found.get("title") or vid,
            "artist": meta.get("artist") or found.get("artist") or None,
            "album": meta.get("album") or found.get("album"),
            "remixer": meta.get("remixer"),
            "year": meta["year"] if meta.get("year") is not None else found.get("year"),
            "bpm": round(meta["bpm"]) if meta.get("bpm") is not None else None,
            "wikipedia_song": wiki_lookup.clean_link(meta.get("wikipedia_song")),
            "wikipedia_artist": wiki_lookup.clean_link(meta.get("wikipedia_artist")),
            "musicbrainz_url": genre_lookup.clean_recording_url(meta.get("musicbrainz_url")),
            **({"source": "soundcloud"} if extractor.source_of(vid) == "soundcloud" else {}),
            "source_url": url,
            "sources": [{"source": extractor.source_of(vid), "id": vid, "url": url}],
            "file": None,
            "cover": cover,
            "duration": found.get("duration"),
            "added_at": now,
            "tags": library.with_decade(tags or library.clean_tags(found.get("tags") or []), meta.get("year") or found.get("year")),
        }
        with _tx(uid, f"add {vid}"):
            songs = library.load(library_path(uid))
            if any(s["id"] == vid for s in songs):
                raise HTTPException(status_code=409, detail="already in library")
            _save(uid, songs + [song])
    finally:
        JOBS.pop((uid, vid), None)
    return JSONResponse(
        {"id": vid, "status": "done", "audio_state": "none", "song": library.public_song(song, _root(uid))},
        status_code=201,
    )


@app.get("/songs/{video_id}/status", responses={404: {"description": "Not found"}, 422: {"description": "Unprocessable"}})
def song_status(video_id: str, user: dict[str, Any] = Depends(require_token)):
    _vid(video_id)
    uid = user["uid"]
    job = JOBS.get((uid, video_id))
    if job:
        return {"id": video_id, **job}
    if any(s["id"] == video_id for s in _load(uid)):
        return {"id": video_id, "status": "done", "progress": 1.0, "error": None}
    raise HTTPException(status_code=404, detail=_UNKNOWN_SONG)


@app.patch("/songs/{video_id}", responses={404: {"description": "Not found"}, 422: {"description": "Unprocessable"}})
def patch_song(video_id: str, req: PatchSongRequest, user: dict[str, Any] = Depends(require_token)):
    _vid(video_id)
    uid = user["uid"]
    changes = req.model_dump(exclude_unset=True)
    with _tx(uid, f"edit {video_id}"):
        songs = library.load(library_path(uid))
        song = next((s for s in songs if s["id"] == video_id), None)
        if song is None:
            raise HTTPException(status_code=404, detail=_UNKNOWN_SONG)
        updated = dict(song)
        for key in ("title", "artist", "album", "remixer"):
            if key in changes:
                updated[key] = _clean_text(changes[key])
        if "year" in changes:
            updated["year"] = changes["year"]
        if "bpm" in changes:
            updated["bpm"] = round(changes["bpm"]) if changes["bpm"] is not None else None
        for key in ("wikipedia_song", "wikipedia_artist"):
            if key in changes:
                updated[key] = wiki_lookup.clean_link(changes[key])
        if "musicbrainz_url" in changes:
            updated["musicbrainz_url"] = genre_lookup.clean_recording_url(changes["musicbrainz_url"])
        if changes.get("tags") is not None:
            updated["tags"] = library.clean_tags(changes["tags"])
        if not updated.get("title"):
            raise HTTPException(status_code=422, detail="title must not be empty")
        updated["tags"] = library.with_decade(updated.get("tags") or [], updated.get("year"))
        updated["updated_at"] = library.now_utc()
        song.update(updated)
        _save(uid, songs)
        return library.public_song(song, _root(uid))


@app.post("/songs/{video_id}/bpm/detect", responses={404: {"description": "Not found"}, 422: {"description": "Unprocessable"}})
async def detect_song_bpm(video_id: str, user: dict[str, Any] = Depends(require_token)):
    _vid(video_id)
    uid = user["uid"]
    song = next((s for s in _load(uid) if s["id"] == video_id), None)
    if song is None:
        raise HTTPException(status_code=404, detail=_UNKNOWN_SONG)
    path = audio_dir(uid) / library.file_name(song)
    if not library.has_file(song) or not path.is_file():
        raise HTTPException(status_code=404, detail=_NOT_DOWNLOADED)
    value = await run_in_threadpool(bpm_detect.detect_bpm, path)
    if value is None:
        raise HTTPException(status_code=422, detail="could not detect BPM")
    return await run_in_threadpool(_store_bpm, uid, video_id, value)


def _store_bpm(uid: str, video_id: str, value: float) -> dict[str, Any]:
    with _tx(uid, f"bpm {video_id}"):
        songs = library.load(library_path(uid))
        song = next((s for s in songs if s["id"] == video_id), None)
        if song is None:
            raise HTTPException(status_code=404, detail=_UNKNOWN_SONG)
        song["bpm"] = round(value)
        song["updated_at"] = library.now_utc()
        _save(uid, songs)
        return library.public_song(song, _root(uid))


@app.delete("/songs/{video_id}", status_code=204, responses={404: {"description": "Not found"}, 422: {"description": "Unprocessable"}})
def delete_song(video_id: str, user: dict[str, Any] = Depends(require_token)):
    _vid(video_id)
    uid = user["uid"]
    with _tx(uid, f"delete {video_id}"):
        songs = library.load(library_path(uid))
        song = next((s for s in songs if s["id"] == video_id), None)
        if song is None:
            raise HTTPException(status_code=404, detail=_UNKNOWN_SONG)
        _save(uid, [s for s in songs if s["id"] != video_id])
        (covers_dir(uid) / f"{video_id}.jpg").unlink(missing_ok=True)
        if library.has_file(song):
            try:
                (audio_dir(uid) / library.file_name(song)).unlink(missing_ok=True)
            except MusicRootUnavailable:
                pass
        JOBS.pop((uid, video_id), None)


@app.delete("/songs/{video_id}/audio", status_code=204, responses={404: {"description": "Not found"}, 422: {"description": "Unprocessable"}})
def delete_song_audio(video_id: str, user: dict[str, Any] = Depends(require_token)):
    """Remove the audio file only; the catalog entry stays (state becomes `none`). Idempotent."""
    _vid(video_id)
    uid = user["uid"]
    with _tx(uid, f"delete audio {video_id}"):
        songs = library.load(library_path(uid))
        song = next((s for s in songs if s["id"] == video_id), None)
        if song is None:
            raise HTTPException(status_code=404, detail=_UNKNOWN_SONG)
        if library.has_file(song):
            (audio_dir(uid) / library.file_name(song)).unlink(missing_ok=True)
            song["file"] = None
            song["updated_at"] = library.now_utc()
            _save(uid, songs)
        JOBS.pop((uid, video_id), None)


class NoCacheStaticFiles(StaticFiles):
    """Revalidate on every load so UI edits show up without a hard refresh."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


_ASSET_REF = re.compile(r'(href|src)="(tokens\.css|style\.css|favicon\.svg|js/app\.js)"')
_IMMUTABLE = "public, max-age=31536000, immutable"


def web_version() -> str:
    """Short fingerprint of the web files; it changes whenever any of them is deployed."""
    digest = hashlib.sha256()
    for path in sorted(WEB_DIR.rglob("*")):
        if path.is_file():
            info = path.stat()
            digest.update(f"{path.relative_to(WEB_DIR)}:{info.st_mtime_ns}:{info.st_size}".encode())
    return digest.hexdigest()[:10]


def _index_response(request: Request) -> Response:
    """index.html with every asset under /_v/<version>/, so a deploy is a new URL.

    Browsers and CDNs may keep the versioned files for a year; the page that names
    them is always revalidated (ETag), so users pick up a deploy on the next load.
    """
    version = web_version()
    etag = f'"{version}"'
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    page = (WEB_DIR / "index.html").read_text(encoding="utf-8")
    page = _ASSET_REF.sub(lambda m: f'{m.group(1)}="_v/{version}/{m.group(2)}"', page)
    return HTMLResponse(page, headers=headers)


def _versioned_file(version: str, path: str) -> FileResponse:
    root = WEB_DIR.resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="not found")
    cache = _IMMUTABLE if version == web_version() else "no-cache"
    return FileResponse(target, headers={"Cache-Control": cache})


# Mounted last so API routes above always win.
if WEB_DIR.is_dir():
    if (WEB_DIR / "index.html").is_file():
        app.add_api_route("/", _index_response, methods=["GET"], include_in_schema=False)
        app.add_api_route("/index.html", _index_response, methods=["GET"], include_in_schema=False)
    app.add_api_route("/_v/{version}/{path:path}", _versioned_file, methods=["GET"], include_in_schema=False)
    app.mount("/", NoCacheStaticFiles(directory=WEB_DIR, html=True), name="web")
