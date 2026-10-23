"""Saved circle positions of the Genres map v2 (API-230..API-232): one small document per signed-in user."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import deps, genre_layout, users
from ..schemas import GenreLayoutRequest

router = APIRouter()
User = Annotated[dict[str, Any], Depends(deps.require_token)]


def _read(uid: str) -> dict[str, Any]:
    with users.user_lock(uid):
        return genre_layout.load(deps.genre_layout_path(uid))


def _write(uid: str, req: GenreLayoutRequest) -> dict[str, Any]:
    with deps.tx(uid, "genre layout"):
        return genre_layout.save(deps.genre_layout_path(uid), req.positions, req.families)


@router.get("/me/genre-layout")
async def get_genre_layout(user: User):
    return await run_in_threadpool(_read, user["uid"])


@router.put("/me/genre-layout", responses=deps.responses(422))
async def put_genre_layout(req: GenreLayoutRequest, user: User):
    return await run_in_threadpool(_write, user["uid"], req)
