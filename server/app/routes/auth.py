from __future__ import annotations

import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from .. import deps, hosts, oauth, session
from ..schemas import SessionRequest

router = APIRouter()

_COOKIE_FLAGS = {"path": "/", "httponly": True, "secure": True, "samesite": "strict"}


def _require_csrf(request: Request) -> None:
    if not session.csrf_ok(request.headers, request.headers.get("host", "")):
        raise HTTPException(status_code=403, detail=deps.CSRF_DETAIL)


@router.get("/auth/config")
def auth_config(request: Request) -> dict[str, str]:
    """Non-secret client ids the web UI needs to start Google / Apple sign-in."""
    return {
        "google_client_id": os.environ.get("GOOGLE_WEB_CLIENT_ID", ""),
        "apple_client_id": os.environ.get("APPLE_WEB_CLIENT_ID", ""),
        "apple_redirect": hosts.oauth_redirect(request),
    }


@router.post("/auth/session", responses=deps.responses(403, 503))
def auth_session(req: SessionRequest, request: Request, response: Response) -> dict[str, str]:
    _require_csrf(request)
    if not session.available():
        raise HTTPException(status_code=503, detail="AUDIO_SESSION_SECRET or AUDIO_API_TOKEN is not set")
    identity = deps.identity_of(oauth.verify_identity(req.id_token))
    deps.admit("session", identity)
    response.set_cookie(session.COOKIE, session.issue(identity), max_age=session.LIFETIME, **_COOKIE_FLAGS)
    return {"email": identity["email"], "provider": identity["provider"]}


@router.post("/auth/logout", status_code=204, responses=deps.responses(403))
def auth_logout(request: Request) -> Response:
    _require_csrf(request)
    out = Response(status_code=204)
    out.delete_cookie(session.COOKIE, **_COOKIE_FLAGS)
    return out


@router.get("/auth/me")
def auth_me(request: Request, response: Response, user: Annotated[dict[str, Any], Depends(deps.require_token)]) -> dict[str, Any]:
    cookie = request.cookies.get(session.COOKIE, "")
    if user["method"] == "session" and session.renewable(cookie):
        response.set_cookie(session.COOKIE, session.issue(session.read(cookie)), max_age=session.LIFETIME, **_COOKIE_FLAGS)
    return {k: user[k] for k in ("method", "email", "provider", "owner")}
