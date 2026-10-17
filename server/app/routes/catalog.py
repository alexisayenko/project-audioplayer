"""The user's library: full list, the polled metadata catalog and tag counts."""

from __future__ import annotations

import hashlib
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from .. import credits, deps, guest, library

router = APIRouter()

_SINCE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_SINCE_ETAG_LEN = 8


def _public(user: dict[str, Any]) -> list[dict[str, Any]]:
    songs = deps.public_songs(user["uid"], deps.load_songs(user["uid"]))
    return guest.scrub_songs(songs) if guest.is_guest(user) else songs


def _etag_matches(header: str, etag: str) -> bool:
    return any(t.strip() in ("*", etag, f"W/{etag}") for t in header.split(","))


@router.get("/library")
def get_library(user: dict[str, Any] = Depends(deps.read_user)):
    return {"credits_schema": credits.SCHEMA, "songs": _public(user)}


@router.get("/catalog", responses=deps.responses(422))
def get_catalog(request: Request, since: str | None = Query(default=None),
                user: dict[str, Any] = Depends(deps.read_user)):
    """Metadata-only catalog for clients to poll: `revision`, every id, and the songs changed `>= since`."""
    if since is not None and not _SINCE_RE.match(since):
        raise HTTPException(status_code=422, detail="since must be UTC YYYY-MM-DDTHH:MM:SSZ")
    public = _public(user)
    revision = library.catalog_revision(public)
    etag = f'"{revision}"' if since is None else f'"{revision}.{hashlib.sha1(since.encode(), usedforsecurity=False).hexdigest()[:_SINCE_ETAG_LEN]}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if _etag_matches(request.headers.get("if-none-match", ""), etag):
        return Response(status_code=304, headers=headers)
    changed = [s for s in public if since is None or library.updated_at(s) >= since]
    body = {
        "credits_schema": credits.SCHEMA,
        "revision": revision,
        "total": len(public),
        "ids": [s["id"] for s in public],
        "songs": changed,
    }
    return JSONResponse(body, headers=headers)


@router.get("/tags")
def get_tags(user: dict[str, Any] = Depends(deps.read_user)):
    return library.tag_counts(deps.public_songs(user["uid"], deps.load_songs(user["uid"])))
