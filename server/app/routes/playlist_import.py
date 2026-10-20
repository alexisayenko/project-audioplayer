"""YouTube playlist import: list a playlist's videos with their parsed fields (nothing is stored; the songs are added with POST /songs)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
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


_UNAVAILABLE_MESSAGE = "This playlist is not available: it is private, needs a login, or is an automatic Mix. Use a public or unlisted playlist."


@router.get("/youtube/playlist", responses=deps.responses(400, 422, 429, 502, 504))
async def youtube_playlist(user: Annotated[dict[str, Any], Depends(deps.require_token)], url: Annotated[str, Query(max_length=2000)] = ""):
    ref = urlclean.parse_playlist(url) if url.strip().lower().startswith("https://") else None
    if ref is None:
        return error_response(400, "bad_url", playlist_import.NOT_A_PLAYLIST)
    kind, list_id = ref
    if kind != "playlist":
        return error_response(422, "playlist_unavailable", _UNAVAILABLE_MESSAGE)
    playlist_import.charge_listing(user["uid"], user["owner"])
    try:
        return await run_in_threadpool(playlist_import.draft_listing, list_id)
    except Exception as exc:
        text = str(exc).lower()
        if extractor.error_code(exc) in _STATUS_BY_CODE:
            return error_response(422, "playlist_unavailable", _UNAVAILABLE_MESSAGE)
        if "timed out" in text or "timeout" in text:
            return error_response(504, "timeout", f"playlist lookup timed out: {short_error(exc)}")
        return error_response(502, "failed", f"playlist lookup failed: {short_error(exc)}")
