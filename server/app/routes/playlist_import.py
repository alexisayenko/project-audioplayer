"""YouTube playlist import: list a playlist's videos with their parsed fields (nothing is stored; the songs are added with POST /songs)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool

from .. import deps, extractor, playlist_import, urlclean
from ..links import error_response, short_error
from ..schemas import PlaylistDetailsRequest, PlaylistImportRequest

router = APIRouter()

_STATUS_BY_CODE = {"not_found": 404, "private": 403}


@router.post("/import/youtube-playlist", responses=deps.responses(403, 404, 422, 429, 502))
async def preview_playlist(req: PlaylistImportRequest, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    ref = urlclean.parse_playlist(req.url)
    if ref is None:
        return error_response(422, "unsupported", playlist_import.NOT_A_PLAYLIST)
    kind, list_id = ref
    if kind == "mix":
        return error_response(422, "mix", urlclean.MIX_MESSAGE)
    if kind == "private":
        return error_response(403, "private", urlclean.PRIVATE_LIST_MESSAGE)
    playlist_import.charge_listing(user["uid"], user["owner"])
    songs = await run_in_threadpool(deps.load_songs, user["uid"])
    try:
        return await run_in_threadpool(playlist_import.listing, list_id, songs)
    except Exception as exc:
        code = extractor.error_code(exc)
        return error_response(_STATUS_BY_CODE.get(code or "", 502), code or "failed", f"playlist lookup failed: {short_error(exc)}")


@router.post("/import/youtube-playlist/details", responses=deps.responses(422, 429))
async def playlist_details(req: PlaylistDetailsRequest, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    bad = [i for i in req.ids if not urlclean.VIDEO_ID_RE.fullmatch(i)]
    if bad:
        return error_response(422, "unsupported", "ids must be 11-character YouTube video ids")
    playlist_import.charge_details(user["uid"], user["owner"], len(req.ids))
    songs = await run_in_threadpool(deps.load_songs, user["uid"])
    return await run_in_threadpool(playlist_import.details, req.ids, songs)
