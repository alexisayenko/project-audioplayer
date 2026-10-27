"""Backfill of BPM for songs that have audio on the server but no BPM (authenticated, never guest)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import backfill, backgroundjob, deps

router = APIRouter()


@router.get("/me/backfill/bpm")
async def get_backfill(user: dict[str, Any] = Depends(deps.require_token)):
    return await run_in_threadpool(backfill.status, user["uid"])


@router.post("/me/backfill/bpm", status_code=202, responses=deps.responses(409))
async def start_backfill(user: dict[str, Any] = Depends(deps.require_token)):
    """Start detecting missing BPMs: 202, 200 when there is nothing to do, 409 when a job is running (yours or another user's)."""
    kind, state = await run_in_threadpool(backfill.start, user["uid"])
    return backgroundjob.start_reply(kind, state, ("backfill_running", "A BPM detection is already running."),
                                     ("backfill_busy", "Another BPM detection is running on the server. Try again later."))


@router.delete("/me/backfill/bpm")
async def cancel_backfill(user: dict[str, Any] = Depends(deps.require_token)):
    return await run_in_threadpool(backfill.cancel, user["uid"])
