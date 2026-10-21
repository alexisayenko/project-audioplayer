"""Anonymous temp-staged downloads (ADR-0041): the only unauthenticated routes that touch song data. Every route but the session needs `X-Anon-Token`."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import anon, guest
from ..problems import Problem

router = APIRouter(prefix="/anon")

AUDIO_TYPE = "audio/mp4"
COVER_TYPE = "image/jpeg"
PRIVATE_NO_CACHE = {"Cache-Control": "private, no-cache"}
_REFUSALS = {code: {"description": text} for code, text in {
    401: "Missing, bad or expired token", 403: "Anonymous downloads are off", 404: "No such download",
    409: "Not ready", 422: "Bad input", 429: "Limit reached", 503: "Server busy, low on disk or not configured"}.items()}


class DownloadRequest(BaseModel):
    url: str


class AckRequest(BaseModel):
    sha256: str


def require_anon(x_anon_token: str = Header(default="")) -> str:
    """The device id of a valid anonymous token. It grants nothing outside /anon."""
    if not anon.enabled():
        raise Problem(403, "anon_disabled", "Anonymous downloads are turned off.")
    did = anon.read(x_anon_token)
    if did is None:
        raise Problem(401, "bad_token", "Missing, bad or expired token.")
    return did


@router.post("/session", responses=_REFUSALS)
def create_session(request: Request, x_anon_token: str = Header(default="")) -> dict[str, Any]:
    """A signed device token. Sending a still-valid one renews it for the same device."""
    if not anon.enabled():
        raise Problem(403, "anon_disabled", "Anonymous downloads are turned off.")
    if not anon.available():
        raise Problem(503, "not_configured", "Anonymous downloads are not configured.")
    ip = guest.client_ip(request)
    anon.check_session(ip)
    token, ttl = anon.issue(anon.read(x_anon_token))
    anon.log.info("anon session ip=%s", anon.short(anon.ip_key(ip)))
    return {"token": token, "expires_in": ttl}


@router.post("/downloads", status_code=202, responses=_REFUSALS)
def start_download(req: DownloadRequest, request: Request, did: str = Depends(require_anon)) -> dict[str, Any]:
    return anon.create(did, guest.client_ip(request), req.url)


@router.get("/downloads/{job_id}", responses=_REFUSALS)
def download_status(job_id: str, did: str = Depends(require_anon)) -> dict[str, Any]:
    return anon.public(anon.get(job_id, did))


@router.head("/downloads/{job_id}/file", include_in_schema=False)
@router.get("/downloads/{job_id}/file", responses=_REFUSALS)
def download_file(job_id: str, request: Request, did: str = Depends(require_anon)):
    job = anon.get(job_id, did)
    path = anon.file_path(job)
    if not path.is_file():
        raise Problem(404, "not_found", "No such download.")
    response = FileResponse(path, media_type=AUDIO_TYPE, filename=path.name, headers=PRIVATE_NO_CACHE, stat_result=os.stat(path))
    if request.headers.get("if-none-match") == response.headers["etag"]:
        return Response(status_code=304, headers={**PRIVATE_NO_CACHE, "ETag": response.headers["etag"]})
    return response


@router.get("/downloads/{job_id}/cover", responses=_REFUSALS)
def download_cover(job_id: str, did: str = Depends(require_anon)):
    return FileResponse(anon.cover_path(anon.get(job_id, did)), media_type=COVER_TYPE, headers=PRIVATE_NO_CACHE)


@router.post("/downloads/{job_id}/ack", status_code=204, responses=_REFUSALS)
def acknowledge(job_id: str, req: AckRequest, did: str = Depends(require_anon)) -> Response:
    anon.acknowledge(anon.get(job_id, did, acked_ok=True), req.sha256)
    return Response(status_code=204)
