"""The user's library: full list, the polled metadata catalog and tag counts."""

from __future__ import annotations

import hashlib
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from .. import deps, library

router = APIRouter()

_SINCE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_SINCE_ETAG_LEN = 8


def _etag_matches(header: str, etag: str) -> bool:
    return any(t.strip() in ("*", etag, f"W/{etag}") for t in header.split(","))


@router.get("/library")
def get_library(user: dict[str, Any] = Depends(deps.require_token)):
    uid = user["uid"]
    return {"songs": deps.public_songs(uid, deps.load_songs(uid))}


@router.get("/catalog", responses=deps.responses(422))
def get_catalog(request: Request, since: str | None = Query(default=None),
                user: dict[str, Any] = Depends(deps.require_token)):
    """Metadata-only catalog for clients to poll: `revision`, every id, and the songs changed `>= since`."""
    if since is not None and not _SINCE_RE.match(since):
        raise HTTPException(status_code=422, detail="since must be UTC YYYY-MM-DDTHH:MM:SSZ")
    uid = user["uid"]
    public = deps.public_songs(uid, deps.load_songs(uid))
    revision = library.catalog_revision(public)
    etag = f'"{revision}"' if since is None else f'"{revision}.{hashlib.sha1(since.encode(), usedforsecurity=False).hexdigest()[:_SINCE_ETAG_LEN]}"'
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


@router.get("/tags")
def get_tags(user: dict[str, Any] = Depends(deps.require_token)):
    return library.tag_counts(deps.load_songs(user["uid"]))
