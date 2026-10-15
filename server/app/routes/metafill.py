"""Backfill of metadata for songs that have audio on the server but no album, year or genre (authenticated, never guest)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from .. import deps, metafill
from ..problems import Problem

router = APIRouter()


@router.get("/me/backfill/metadata")
async def get_metafill(user: dict[str, Any] = Depends(deps.require_token)):
    return await run_in_threadpool(metafill.status, user["uid"])


@router.post("/me/backfill/metadata", status_code=202, responses=deps.responses(409))
async def start_metafill(user: dict[str, Any] = Depends(deps.require_token)):
    """Start getting metadata: 202, 200 when there is nothing to do, 409 when a job is running (yours or another user's)."""
    kind, state = await run_in_threadpool(metafill.start, user["uid"])
    if kind == "running":
        raise Problem(409, "metadata_running", "Getting metadata is already running.")
    if kind == "busy":
        raise Problem(409, "metadata_busy", "Another metadata run is in progress on the server. Try again later.")
    if kind == "nothing":
        return JSONResponse(state, status_code=200)
    return state


@router.delete("/me/backfill/metadata")
async def cancel_metafill(user: dict[str, Any] = Depends(deps.require_token)):
    return await run_in_threadpool(metafill.cancel, user["uid"])
