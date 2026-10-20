"""Listening history: batched play records in, per-song outcomes out (task-0056). Owner and signed-in users only."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from .. import deps, plays
from ..schemas import PlaysRequest

router = APIRouter()

User = Annotated[dict[str, Any], Depends(deps.require_token)]


@router.post("/plays", responses=deps.responses(422, 503))
def post_plays(req: PlaysRequest, user: User):
    """`{ok, appended, duplicate, ignored}`: plays under 5 s, unknown songs and bad timestamps are skipped; a repeated `batch_key` appends nothing."""
    return plays.append(user["uid"], req.batch_key, [p.model_dump() for p in req.plays])


@router.get("/stats/listening", responses=deps.responses(503))
def get_listening(user: User):
    """`{songs: {id: {listened, skipped, total_listened_s, last_listened}}, generated}`."""
    return plays.listening(user["uid"])
