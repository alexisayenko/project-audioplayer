"""Album routes (API-248..API-253): per-user explicit albums, Discogs source. User routes: a guest or anonymous caller gets 401."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from .. import albums, deps, users
from ..schemas import AlbumPreviewRequest

router = APIRouter()
User = Annotated[dict[str, Any], Depends(deps.require_token)]


def _raise(exc: albums.AlbumError):
    raise HTTPException(status_code=exc.status, detail=exc.code) from exc


def _snapshot(uid: str) -> list[dict[str, Any]]:
    with users.user_lock(uid):
        return albums.load(deps.albums_path(uid))


@router.post("/albums/preview", responses=deps.responses(400, 404, 502, 503))
async def preview_album(req: AlbumPreviewRequest, user: User):
    try:
        return await run_in_threadpool(albums.preview, req.url)
    except albums.AlbumError as exc:
        _raise(exc)


def _create(uid: str, payload: dict[str, Any]) -> dict[str, Any]:
    with deps.tx(uid, "albums add"):
        items = albums.load(deps.albums_path(uid))
        dup = albums.find_source(items, payload["source"])
        if dup:
            raise HTTPException(status_code=409, detail={"code": "already_exists", "id": dup["id"]})
        if len(items) >= albums.MAX_ALBUMS:
            raise HTTPException(status_code=409, detail="album_limit")
        item = albums.build(payload, {a["id"] for a in items})
        albums.save(deps.albums_path(uid), [item, *items])
        return item


@router.post("/albums", status_code=201, responses=deps.responses(409, 422))
async def add_album(body: dict[str, Any], user: User):
    try:
        payload = albums.validate(body)
    except albums.AlbumError as exc:
        _raise(exc)
    return await run_in_threadpool(_create, user["uid"], payload)


@router.get("/albums")
def list_albums(user: User):
    return [albums.summary(a) for a in _snapshot(user["uid"])]


def _found(items: list[dict[str, Any]], album_id: str) -> dict[str, Any]:
    for a in items:
        if a["id"] == album_id:
            return a
    raise HTTPException(status_code=404, detail="not_found")


@router.get("/albums/{album_id}", responses=deps.responses(404))
def get_album(album_id: str, user: User):
    return _found(_snapshot(user["uid"]), album_id)


@router.delete("/albums/{album_id}", responses=deps.responses(404))
def delete_album(album_id: str, user: User):
    uid = user["uid"]
    with deps.tx(uid, "albums delete"):
        items = albums.load(deps.albums_path(uid))
        found = _found(items, album_id)
        albums.save(deps.albums_path(uid), [a for a in items if a is not found])
    return {"deleted": album_id}
