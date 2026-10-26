"""Album routes (API-248..API-253): per-user explicit albums, Discogs source. User routes: a guest or anonymous caller gets 401."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from .. import album_youtube, albums, deps, library, users
from ..schemas import AlbumLinkRequest, AlbumPatchRequest, AlbumPreviewRequest, AlbumSearchRequest

router = APIRouter()
User = Annotated[dict[str, Any], Depends(deps.require_token)]


def _raise(exc: albums.AlbumError):
    raise HTTPException(status_code=exc.status, detail={"code": exc.code, "key": exc.key} if exc.key else exc.code) from exc


def _snapshot(uid: str) -> list[dict[str, Any]]:
    with users.user_lock(uid):
        items = albums.load(deps.albums_path(uid))
        ids = {s.get("id") for s in library.load(deps.library_path(uid))} if any(t.get("songId") for a in items for t in a["tracks"]) else set()
    return [albums.without_dangling(a, ids) for a in items]


@router.post("/albums/preview", responses=deps.responses(400, 404, 502, 503))
async def preview_album(req: AlbumPreviewRequest, user: User):
    try:
        return await run_in_threadpool(albums.preview, req.url)
    except albums.AlbumError as exc:
        _raise(exc)


def _create(uid: str, payload: dict[str, Any], song_ids: Any = None) -> dict[str, Any]:
    with deps.tx(uid, "albums add"):
        items = albums.load(deps.albums_path(uid))
        dup = albums.find_source(items, payload["source"])
        if dup:
            raise HTTPException(status_code=409, detail={"code": "already_exists", "id": dup["id"]})
        if len(items) >= albums.MAX_ALBUMS:
            raise HTTPException(status_code=409, detail="album_limit")
        item = albums.build(payload, {a["id"] for a in items})
        linked = album_youtube.auto_link(item, song_ids, library.load(deps.library_path(uid))) if isinstance(song_ids, list) else None
        albums.save(deps.albums_path(uid), [item, *items])
        if linked is None:
            return item
        return {**item, "linked": linked, "unlinked": len(item["tracks"]) - linked}


@router.post("/albums", status_code=201, responses=deps.responses(409, 422))
async def add_album(body: dict[str, Any], user: User):
    try:
        payload = albums.validate(body)
    except albums.AlbumError as exc:
        _raise(exc)
    return await run_in_threadpool(_create, user["uid"], payload, body.get("songIds"))


@router.post("/albums/youtube/start", responses=deps.responses(400, 404, 409, 429, 502))
async def youtube_start(req: AlbumPreviewRequest, user: User):
    songs = await run_in_threadpool(deps.load_songs, user["uid"])
    return await run_in_threadpool(album_youtube.start, user["uid"], user["owner"], req.url, songs)


@router.post("/albums/discogs-search", responses=deps.responses(502, 503))
async def discogs_search(req: AlbumSearchRequest, user: User):
    return await run_in_threadpool(album_youtube.search, req.artist, req.album, req.trackCount, req.durationsS)


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


@router.patch("/albums/{album_id}", responses=deps.responses(404, 422))
def patch_album(album_id: str, body: AlbumPatchRequest, user: User):
    changes: dict[str, Any] = {}
    try:
        for key, value in (body.links or {}).items():
            changes[key] = albums.clean_link(key, value)
        if "rymUrl" in body.model_fields_set:
            changes["rateyourmusic"] = albums.clean_rym(body.rymUrl)
    except albums.AlbumError as exc:
        _raise(exc)
    uid = user["uid"]
    with deps.tx(uid, "albums patch"):
        items = albums.load(deps.albums_path(uid))
        album = _found(items, album_id)
        albums.set_links(album, changes)
        albums.save(deps.albums_path(uid), items)
        return album


@router.delete("/albums/{album_id}", responses=deps.responses(404))
def delete_album(album_id: str, user: User):
    uid = user["uid"]
    with deps.tx(uid, "albums delete"):
        items = albums.load(deps.albums_path(uid))
        found = _found(items, album_id)
        albums.save(deps.albums_path(uid), [a for a in items if a is not found])
    return {"deleted": album_id}


def _track(album: dict[str, Any], no: int) -> dict[str, Any]:
    for t in album["tracks"]:
        if t.get("no") == no:
            return t
    raise HTTPException(status_code=404, detail="track_not_found")


@router.put("/albums/{album_id}/tracks/{no}/song", responses=deps.responses(404, 409, 422))
def link_song(album_id: str, no: int, body: AlbumLinkRequest, user: User):
    uid = user["uid"]
    with deps.tx(uid, "albums link"):
        items = albums.load(deps.albums_path(uid))
        album = _found(items, album_id)
        track = _track(album, no)
        if body.songId not in {s.get("id") for s in library.load(deps.library_path(uid))}:
            raise HTTPException(status_code=404, detail="song_not_found")
        other = next((t for t in album["tracks"] if t is not track and t.get("songId") == body.songId), None)
        if other:
            raise HTTPException(status_code=409, detail={"code": "already_linked", "no": other["no"]})
        track["songId"] = body.songId
        albums.save(deps.albums_path(uid), items)
        return album


@router.delete("/albums/{album_id}/tracks/{no}/song", responses=deps.responses(404))
def unlink_song(album_id: str, no: int, user: User):
    uid = user["uid"]
    with deps.tx(uid, "albums unlink"):
        items = albums.load(deps.albums_path(uid))
        album = _found(items, album_id)
        _track(album, no)["songId"] = None
        albums.save(deps.albums_path(uid), items)
        return album
