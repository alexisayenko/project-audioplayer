"""Flat playlists (API-229..API-238): named, ordered lists of song ids. Per user, never visible to guests."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse

from .. import deps, library, playlists, users
from ..schemas import PlaylistCreateRequest, PlaylistPatchRequest, PlaylistSongsRequest

router = APIRouter()

UNKNOWN_PLAYLIST = "unknown playlist"
SONG_NOT_IN_PLAYLIST = "song is not in the playlist"
User = Annotated[dict[str, Any], Depends(deps.require_token)]


def _known(uid: str) -> set[str]:
    return {s["id"] for s in library.load(deps.library_path(uid))}


def _stored(playlist_id: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    found = playlists.find(items, playlist_id)
    if found is None:
        raise HTTPException(status_code=404, detail=UNKNOWN_PLAYLIST)
    return found


def _read(uid: str, playlist_id: str | None = None) -> tuple[list[dict[str, Any]], set[str]]:
    with users.user_lock(uid):
        items = playlists.load(deps.playlists_path(uid))
        known = _known(uid)
    for item in items:
        playlists.prune(item, known)
    if playlist_id is not None:
        _stored(playlist_id, items)
    return items, known


@router.get("/playlists")
def list_playlists(user: User):
    items, _ = _read(user["uid"])
    return {"playlists": [playlists.summary(p) for p in playlists.by_name(items)]}


@router.post("/playlists", status_code=201, responses=deps.responses(409, 422))
def create_playlist(req: PlaylistCreateRequest, user: User):
    uid, owner = user["uid"], user["owner"]
    name = playlists.clean_name(req.name)
    description = playlists.clean_description(req.description)
    with deps.tx(uid, "playlists create"):
        items = playlists.load(deps.playlists_path(uid))
        playlists.check_room(items, owner)
        playlists.check_name_free(items, name)
        now = library.now_utc()
        item = {"id": playlists.new_id(items), "name": name, "description": description, "created": now, "updated": now, "songs": []}
        playlists.add_songs(item, req.song_ids, _known(uid), owner)
        playlists.save(deps.playlists_path(uid), [*items, item])
        return playlists.detail(item)


@router.get("/playlists/{playlist_id}", responses=deps.responses(404))
def get_playlist(playlist_id: str, user: User):
    items, _ = _read(user["uid"], playlist_id)
    return playlists.detail(_stored(playlist_id, items))


@router.patch("/playlists/{playlist_id}", responses=deps.responses(404, 409, 422))
def patch_playlist(playlist_id: str, req: PlaylistPatchRequest, user: User):
    uid = user["uid"]
    with deps.tx(uid, "playlists edit"):
        items = playlists.load(deps.playlists_path(uid))
        item = _stored(playlist_id, items)
        changed = False
        if req.name is not None:
            name = playlists.clean_name(req.name)
            playlists.check_name_free(items, name, item["id"])
            changed = changed or name != item["name"]
            item["name"] = name
        if req.description is not None:
            description = playlists.clean_description(req.description)
            changed = changed or description != item["description"]
            item["description"] = description
        if changed:
            item["updated"] = library.now_utc()
            playlists.save(deps.playlists_path(uid), items)
        playlists.prune(item, _known(uid))
        return playlists.detail(item)


@router.delete("/playlists/{playlist_id}", status_code=204, responses=deps.responses(404))
def delete_playlist(playlist_id: str, user: User):
    uid = user["uid"]
    with deps.tx(uid, "playlists delete"):
        items = playlists.load(deps.playlists_path(uid))
        found = _stored(playlist_id, items)
        playlists.save(deps.playlists_path(uid), [p for p in items if p is not found])


@router.post("/playlists/{playlist_id}/songs", responses=deps.responses(404, 422))
def add_songs(playlist_id: str, req: PlaylistSongsRequest, user: User):
    uid, owner = user["uid"], user["owner"]
    with deps.tx(uid, "playlists add"):
        items = playlists.load(deps.playlists_path(uid))
        item = _stored(playlist_id, items)
        known = _known(uid)
        playlists.prune(item, known)
        added, skipped = playlists.add_songs(item, req.song_ids, known, owner)
        if added:
            item["updated"] = library.now_utc()
            playlists.save(deps.playlists_path(uid), items)
        return {"added": added, "skipped": skipped}


@router.delete("/playlists/{playlist_id}/songs/{song_id}", status_code=204, responses=deps.responses(404))
def remove_song(playlist_id: str, song_id: str, user: User):
    uid = user["uid"]
    with deps.tx(uid, "playlists remove"):
        items = playlists.load(deps.playlists_path(uid))
        item = _stored(playlist_id, items)
        if song_id not in item["songs"]:
            raise HTTPException(status_code=404, detail=SONG_NOT_IN_PLAYLIST)
        item["songs"] = [s for s in item["songs"] if s != song_id]
        item["updated"] = library.now_utc()
        playlists.save(deps.playlists_path(uid), items)


@router.put("/playlists/{playlist_id}/order", responses=deps.responses(404, 422))
def put_order(playlist_id: str, req: PlaylistSongsRequest, user: User):
    uid = user["uid"]
    with deps.tx(uid, "playlists order"):
        items = playlists.load(deps.playlists_path(uid))
        item = _stored(playlist_id, items)
        playlists.prune(item, _known(uid))
        playlists.set_order(item, req.song_ids)
        item["updated"] = library.now_utc()
        playlists.save(deps.playlists_path(uid), items)
        return playlists.detail(item)


@router.get("/playlists/{playlist_id}/export", response_class=PlainTextResponse, responses=deps.responses(404))
def export_playlist(playlist_id: str, user: User):
    uid = user["uid"]
    items, _ = _read(uid, playlist_id)
    item = _stored(playlist_id, items)
    text = playlists.export_text(item, deps.load_songs(uid))
    return PlainTextResponse(text, media_type="text/plain; charset=utf-8",
                             headers={"Content-Disposition": library.content_disposition(playlists.file_name(item["name"]))})
