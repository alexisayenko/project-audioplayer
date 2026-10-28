"""Album routes (API-248..API-253): per-user explicit albums, Discogs source. User routes: a guest or anonymous caller gets 401."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.concurrency import run_in_threadpool

from .. import album_covers, album_genres, album_links, album_masters, album_song_genres, album_youtube, albums, coverimg, coverupload, deps, library, users
from ..problems import Problem
from ..schemas import AlbumCoverRequest, AlbumCoverToSongsRequest, AlbumGenresToSongsRequest, AlbumLinkRequest, AlbumPatchRequest, AlbumPreviewRequest, AlbumSearchRequest

router = APIRouter()
User = Annotated[dict[str, Any], Depends(deps.require_token)]


def _raise(exc: albums.AlbumError):
    raise HTTPException(status_code=exc.status, detail={"code": exc.code, "key": exc.key} if exc.key else exc.code) from exc


def _snapshot(uid: str) -> list[dict[str, Any]]:
    with users.user_lock(uid):
        items = albums.load(deps.albums_path(uid))
        ids = {s.get("id") for s in library.load(deps.library_path(uid))} if any(t.get("songId") for a in items for t in a["tracks"]) else set()
        songs = library.load(deps.library_path(uid)) if items else []
    return [album_covers.present(uid, albums.without_dangling(a, ids), songs) for a in items]


def _out(uid: str, album: dict[str, Any]) -> dict[str, Any]:
    return album_covers.present_one(uid, album)


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
        album_youtube.fill_linked(uid, item)
        albums.save(deps.albums_path(uid), [item, *items])
    item = album_covers.auto(uid, item)
    if linked is None:
        return _out(uid, item)
    return {**_out(uid, item), "linked": linked, "unlinked": len(item["tracks"]) - linked}


@router.post("/albums", status_code=201, responses=deps.responses(409, 422))
async def add_album(body: dict[str, Any], user: User):
    try:
        payload = albums.validate(body)
    except albums.AlbumError as exc:
        _raise(exc)
    return await run_in_threadpool(_create, user["uid"], payload, body.get("songIds"))


@router.post("/albums/youtube/preview", responses=deps.responses(400, 404, 429, 502))
async def youtube_preview(req: AlbumPreviewRequest, user: User):
    songs = await run_in_threadpool(deps.load_songs, user["uid"])
    return await run_in_threadpool(album_youtube.preview, user["uid"], user["owner"], req.url, songs)


@router.post("/albums/youtube/commit", status_code=201, responses=deps.responses(400, 404, 409, 422, 429))
async def youtube_commit(body: dict[str, Any], user: User):
    songs = await run_in_threadpool(deps.load_songs, user["uid"])
    return await run_in_threadpool(album_youtube.commit, user["uid"], user["owner"], body, songs)


@router.post("/albums/discogs/search")
async def discogs_find(body: dict[str, Any], user: User):
    return await run_in_threadpool(album_masters.find, body.get("artist"), body.get("title"), body.get("year"), body.get("all") is True)


@router.post("/albums/discogs/resolve", responses=deps.responses(422))
async def discogs_resolve(body: dict[str, Any], user: User):
    return await run_in_threadpool(album_masters.resolve, body.get("kind"), body.get("id"))


@router.post("/albums/suggest-links")
async def suggest_links(body: dict[str, Any], user: User):
    return await run_in_threadpool(album_links.suggest, body.get("artist"), body.get("title"), body.get("year"))


@router.post("/albums/genres/suggest")
async def suggest_genres(body: dict[str, Any], user: User):
    return await run_in_threadpool(album_genres.suggest, body.get("artist"), body.get("title"), body.get("year"), body.get("discogs"), body.get("rym"))


@router.post("/albums/discogs-search", responses=deps.responses(502, 503))
async def discogs_search(req: AlbumSearchRequest, user: User):
    return await run_in_threadpool(album_youtube.search, req.artist, req.album, req.trackCount, req.durationsS, [t.model_dump() for t in req.playlistTracks] if req.playlistTracks is not None else None)


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
    fields: dict[str, Any] = {}
    try:
        for key, value in (body.links or {}).items():
            changes[key] = albums.clean_link(key, value)
        if "rymUrl" in body.model_fields_set:
            changes["rateyourmusic"] = albums.clean_rym(body.rymUrl)
        for key in ("title", "artist", "year", "genres", "labels"):
            if key in body.model_fields_set:
                fields[key] = albums.clean_field(key, getattr(body, key))
    except albums.AlbumError as exc:
        _raise(exc)
    uid = user["uid"]
    with deps.tx(uid, "albums patch"):
        items = albums.load(deps.albums_path(uid))
        album = _found(items, album_id)
        album.update(fields)
        albums.set_links(album, changes)
        albums.save(deps.albums_path(uid), items)
    return _out(uid, album)


@router.delete("/albums/{album_id}", responses=deps.responses(404))
def delete_album(album_id: str, user: User):
    uid = user["uid"]
    with deps.tx(uid, "albums delete"):
        items = albums.load(deps.albums_path(uid))
        found = _found(items, album_id)
        albums.save(deps.albums_path(uid), [a for a in items if a is not found])
        album_covers.remove_file(uid, album_id)
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
        album_youtube.fill_linked(uid, {**album, "tracks": [track]})
    return _out(uid, album)


@router.delete("/albums/{album_id}/tracks/{no}/song", responses=deps.responses(404))
def unlink_song(album_id: str, no: int, user: User):
    uid = user["uid"]
    with deps.tx(uid, "albums unlink"):
        items = albums.load(deps.albums_path(uid))
        album = _found(items, album_id)
        _track(album, no)["songId"] = None
        albums.save(deps.albums_path(uid), items)
    return _out(uid, album)


@router.get("/albums/{album_id}/cover", responses=deps.responses(404))
def get_album_cover(album_id: str, user: Annotated[dict[str, Any], Depends(deps.require_token_or_query)]):
    path = album_covers.path_of(user["uid"], album_id) if albums.ID_RE.fullmatch(album_id) else None
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="no cover")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, no-cache"})


@router.get("/albums/{album_id}/cover/candidates", responses=deps.responses(404, 429))
def cover_candidates(album_id: str, user: User):
    album = _found(_snapshot(user["uid"]), album_id)
    coverupload.charge(coverupload.suggestions, user)
    return {"candidates": album_covers.candidates(album)}


@router.put("/albums/{album_id}/cover", responses=deps.responses(400, 404, 413, 415, 422, 429, 502))
async def put_cover(album_id: str, request: Request, user: User):
    """The new cover as raw image bytes (`image/jpeg|png|webp` body), multipart/form-data with a `file` part (both stored with source `upload`), or JSON `{"source", "url"}` (the server downloads it). Limits and errors as the song cover upload."""
    uid = user["uid"]
    content_type = request.headers.get("content-type", "")
    kind = content_type.split(";")[0].strip().lower()
    if kind not in (*coverimg.ALLOWED_TYPES, "multipart/form-data", "application/json"):
        raise Problem(415, "cover_bad_type", "Use a JPEG, PNG or WebP image.")
    _found(await run_in_threadpool(_snapshot, uid), album_id)
    url: str | None = None
    source = "upload"
    if kind == "application/json":
        try:
            body = AlbumCoverRequest.model_validate_json(await coverupload.read_body(request, coverupload.JSON_MAX_BYTES))
        except ValueError:
            raise Problem(422, "cover_bad_body", "Send {\"source\": \"url\", \"url\": \"https://...\"}.") from None
        if body.source not in album_covers.SOURCES:
            raise HTTPException(status_code=422, detail={"code": "bad_field", "key": "source"})
        coverupload.charge(coverupload.fetches, user)
        source, url = body.source, body.url
        jpeg = await run_in_threadpool(album_covers.fetch_jpeg, url)
    else:
        if kind == "multipart/form-data":
            data = coverupload.multipart_file(content_type, await coverupload.read_body(request, coverimg.MAX_BYTES + coverupload.MULTIPART_OVERHEAD))
        else:
            data = await coverupload.read_body(request)
        jpeg = await run_in_threadpool(coverimg.normalize, data)
    album = await run_in_threadpool(album_covers.store, uid, album_id, jpeg, source, url)
    if album is None:
        raise HTTPException(status_code=404, detail="not_found")
    return await run_in_threadpool(_out, uid, album)


@router.post("/albums/{album_id}/cover/to-songs", responses=deps.responses(404, 409, 422))
def cover_to_songs(album_id: str, req: AlbumCoverToSongsRequest, user: User):
    """Copy the album's own cover to its linked songs: `{overwrite?: bool}` -> `{linked, applied, unchanged, skipped, failed}`. Songs whose cover the user chose are skipped unless `overwrite`. 409 `no_cover` when the album has no cover of its own."""
    result = album_covers.apply_to_songs(user["uid"], album_id, req.overwrite) if albums.ID_RE.fullmatch(album_id) else None
    if result is None:
        raise HTTPException(status_code=404, detail="not_found")
    return result


@router.post("/albums/{album_id}/genres/to-songs", responses=deps.responses(404, 409, 422))
def genres_to_songs(album_id: str, req: AlbumGenresToSongsRequest, user: User):
    """Give the album's genres to its linked songs: `{overwrite?: bool}` -> `{linked, applied, unchanged, skipped, failed}`. Songs with other genres are kept unless `overwrite`, which replaces their genres. 409 `no_genres` when the album has no genres from the genre tree."""
    result = album_song_genres.apply_to_songs(user["uid"], album_id, req.overwrite) if albums.ID_RE.fullmatch(album_id) else None
    if result is None:
        raise HTTPException(status_code=404, detail="not_found")
    return result


@router.delete("/albums/{album_id}/cover", responses=deps.responses(404))
def delete_cover(album_id: str, user: User):
    uid = user["uid"]
    album = album_covers.clear(uid, album_id) if albums.ID_RE.fullmatch(album_id) else None
    if album is None:
        raise HTTPException(status_code=404, detail="not_found")
    return _out(uid, album)
