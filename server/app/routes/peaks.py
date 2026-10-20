"""Waveform peaks of a song's audio (the Studio page)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool

from .. import deps, guest, library, peaks
from ..problems import Problem
from ..safepath import safe_join

router = APIRouter()

HEADERS = {"Cache-Control": "private, no-cache", "Vary": "Cookie, Authorization"}


@router.get("/songs/{video_id}/peaks", responses=deps.responses(403, 404, 422, 429, 503))
async def get_peaks(request: Request, video_id: str, user: dict[str, Any] = Depends(deps.read_user)):
    """`{v, buckets, duration, min, max}`: signed 8-bit min/max pairs of the whole file; computed on first use, cached beside the audio, ETag per file version."""
    deps.valid_id(video_id)
    visitor = guest.is_guest(user)
    if visitor and not guest.audio_enabled():
        raise Problem(403, "guest_audio_disabled", "Audio is not available to guests.")
    uid = user["uid"]
    song = library.find_song(deps.load_songs(uid), video_id)
    if song is None or not library.has_file(song):
        raise HTTPException(status_code=404, detail=deps.NOT_DOWNLOADED)
    path = safe_join(deps.audio_dir(uid), library.file_name(song))
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail=deps.NOT_DOWNLOADED)
    tag = peaks.etag(path)
    headers = {**HEADERS, "ETag": tag}
    if tag in [t.strip() for t in request.headers.get("if-none-match", "").split(",")]:
        return Response(status_code=304, headers=headers)
    try:
        body = await run_in_threadpool(peaks.load, path)
    except peaks.Unavailable as exc:
        raise Problem(503, "peaks_unavailable", "The waveform cannot be computed on this server.") from exc
    return Response(body, media_type="application/json", headers=headers)
