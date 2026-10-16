"""Shared server state, per-user storage layout, transactions and the auth/quota dependencies used by every route module."""

from __future__ import annotations

import hmac
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from fastapi import Header, HTTPException, Query, Request

from . import extractor, gitstore, guest, jobs, library, limits, oauth, session, users
from .problems import Problem

DOWNLOAD_DIR = Path(os.environ.get("AUDIO_DOWNLOAD_DIR", "downloads"))
DATA_DIR = Path(os.environ.get("AUDIO_DATA_DIR", "."))

SYNC = gitstore.from_env()
SCHED = jobs.Scheduler()

JOBS: dict[tuple[str, str], dict[str, Any]] = {}
ACTIVE = ("queued", "downloading")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

NOT_DOWNLOADED = "not downloaded"
UNKNOWN_SONG = "unknown song"
CSRF_DETAIL = "missing or foreign CSRF header"

_STATUS_TEXT = {
    403: "Forbidden",
    404: "Not found",
    409: "Conflict",
    429: "Guest limit",
    422: "Unprocessable",
    502: "Upstream failure",
    503: "Not configured",
}


def responses(*codes: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI `responses=` entry for the error statuses a route can return."""
    return {code: {"description": _STATUS_TEXT[code]} for code in codes}


class MusicRootUnavailable(Exception):
    pass


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


def user_audio_root(uid: str) -> Path | None:
    """The user's audio directory, or None when its music_root server is not configured (state then trusts `file`)."""
    try:
        return library.resolve_music_root(music_root()) / "users" / uid
    except LookupError:
        return None


def public_songs(uid: str, songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    root = user_audio_root(uid)
    return [library.public_song(s, root) for s in songs]


def load_songs(uid: str) -> list[dict[str, Any]]:
    with users.user_lock(uid):
        return library.load(library_path(uid))


def save_songs(uid: str, songs: list[dict[str, Any]]) -> None:
    library.save(library_path(uid), songs, default_music_root=music_root())


@contextmanager
def tx(uid: str, verb: str) -> Iterator[None]:
    """One writer per user, one git writer overall: user lock -> git lock -> body -> local commit (request mode: pull before, push after)."""
    with users.user_lock(uid):
        if SYNC is None:
            yield
            return
        with SYNC.transaction():
            yield
            SYNC.commit(f"audioplayer: {uid[:8]} {verb}")


def valid_id(video_id: str) -> str:
    if not extractor.is_valid_video_id(video_id):
        raise HTTPException(status_code=422, detail="invalid video id")
    return video_id


# --- who is calling --------------------------------------------------------------------------

SUBS: dict[tuple[str, str], str] = {}


def find_uid_by_sub(provider: str, sub: str) -> str | None:
    """Apple may omit the email: find the profile that recorded this Apple user id."""
    if (provider, sub) in SUBS:
        return SUBS[(provider, sub)]
    for profile in sorted((data_root() / "users").glob("*/profile.json")):
        data = users.read_profile(profile) or {}
        if (data.get("subs") or {}).get(provider) == sub:
            SUBS[(provider, sub)] = profile.parent.name
            return profile.parent.name
    return None


def identity_of(who: dict[str, str]) -> dict[str, str]:
    """oauth.verify_identity result -> {provider, email, sub, uid}. Never takes a uid from the client."""
    email = who["email"]
    if who["provider"] == "apple" and who["sub"].lower() in users.pinned_apple_subs():
        email = users.owner_email()
    if email:
        uid = users.uid_for_email(email)
    else:
        uid = find_uid_by_sub(who["provider"], who["sub"]) or users.uid_for_sub(who["sub"])
    return {"provider": who["provider"], "email": email, "sub": who["sub"], "uid": uid}


def _principal(method: str, identity: dict[str, str]) -> dict[str, Any]:
    uid = identity["uid"]
    return {"method": method, "uid": uid, "email": identity["email"], "provider": identity["provider"],
            "owner": users.is_owner(uid)}


def admit(method: str, identity: dict[str, str]) -> dict[str, Any]:
    """Create the user's profile on first sign-in (open signup), or refuse when signup is closed."""
    uid = identity["uid"]
    if users.read_profile(profile_path(uid)) is None:
        if not users.is_owner(uid) and not users.signup_open():
            raise Problem(403, "signup_closed", "Sign-up is closed.")
        with tx(uid, "signup"):
            if users.read_profile(profile_path(uid)) is None:
                users.write_profile(profile_path(uid), users.new_profile(identity))
    return _principal(method, identity)


def _owner_principal(method: str) -> dict[str, Any]:
    return _principal(method, {"provider": "token", "email": users.owner_email(), "sub": "",
                               "uid": users.owner_uid()})


def _check_token(token: str) -> None:
    expected = os.environ.get("AUDIO_API_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="AUDIO_API_TOKEN is not set")
    if not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="bad token")


def _bearer(authorization: str) -> str:
    scheme, _, value = authorization.partition(" ")
    return value.strip() if scheme.lower() == "bearer" else ""


def authenticate(request: Request, x_api_token: str, authorization: str, query_token: str = "") -> dict[str, Any]:
    """X-API-Token (owner) wins, then Bearer ID token, then session cookie, then (files only) ?token= (owner)."""
    bearer = _bearer(authorization)
    if x_api_token:
        _check_token(x_api_token)
        return _owner_principal("token")
    if bearer:
        return admit("bearer", identity_of(oauth.verify_identity(bearer)))
    who = session.read(request.cookies.get(session.COOKIE, ""))
    if who:
        if request.method not in SAFE_METHODS and not session.csrf_ok(
            request.headers, request.headers.get("host", "")
        ):
            raise HTTPException(status_code=403, detail=CSRF_DETAIL)
        uid = who["uid"] or users.uid_for_email(who["email"])
        return admit("session", {"provider": who["provider"], "email": who["email"], "sub": "", "uid": uid})
    _check_token(query_token)
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


def sync_viewer(
    request: Request,
    x_api_token: str = Header(default=""),
    authorization: str = Header(default=""),
) -> str:
    """Return owner when the request carries the owner's credentials, else other. Never raises, never creates a profile."""
    try:
        if x_api_token:
            expected = os.environ.get("AUDIO_API_TOKEN", "")
            ok = bool(expected) and hmac.compare_digest(x_api_token.encode(), expected.encode())
            return "owner" if ok else "other"
        bearer = _bearer(authorization)
        if bearer:
            return "owner" if users.is_owner(identity_of(oauth.verify_identity(bearer))["uid"]) else "other"
        who = session.read(request.cookies.get(session.COOKIE, ""))
        if who:
            return "owner" if users.is_owner(who["uid"] or users.uid_for_email(who["email"])) else "other"
    except Exception:
        pass
    return "other"


def _view_exists() -> bool:
    uid = guest.view_uid()
    return users.read_profile(profile_path(uid)) is not None or library_path(uid).is_file()


def read_user(
    request: Request,
    x_api_token: str = Header(default=""),
    authorization: str = Header(default=""),
    token: str = Query(default=""),
) -> dict[str, Any]:
    """The read-only allow-list (ADR-0018): credentials as usual, else the public view's owner as a limited guest."""
    has_credentials = x_api_token or _bearer(authorization) or token or session.read(request.cookies.get(session.COOKIE, ""))
    if has_credentials or not guest.enabled() or not _view_exists():
        return authenticate(request, x_api_token, authorization, token if request.url.path.startswith(guest.READ_PREFIXES) else "")
    guest.count_request(guest.client_ip(request))
    return guest.principal()


# --- quotas ----------------------------------------------------------------------------------

def inflight(uid: str) -> int:
    return sum(1 for (u, _), job in JOBS.copy().items() if u == uid and job.get("status") in ACTIVE)


def guard_add(uid: str, owner: bool, with_audio: bool) -> list[dict[str, Any]]:
    """Quota checks before anything is downloaded; returns the user's songs."""
    songs = load_songs(uid)
    null = Path(os.devnull)
    limits.check_add(uid, owner, songs, audio_dir(uid) if with_audio else null,
                     pool_dir() if with_audio else null, inflight=inflight(uid), with_audio=with_audio)
    return songs
