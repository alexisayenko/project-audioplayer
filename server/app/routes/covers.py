"""Changing a song's cover: upload an image, take one from a URL, pick a Wikipedia one, pin the placeholder, or go back to the automatic cover."""

from __future__ import annotations

import json
from email import policy
from email.parser import BytesParser
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .. import coverimg, deps, discogs_cover, downloads, library, wiki_lookup
from ..jsonio import write_bytes_atomic
from ..problems import Problem
from ..ratelimit import KeyedWindow

router = APIRouter()

PERIOD_S = 3600
JSON_MAX_BYTES = 8192
MULTIPART_OVERHEAD = 64 * 1024
MAX_SUGGESTIONS = 4
PINNED = ("custom", "default")
CHOICE_HINT = 'Send {"url": "..."} or {"default": true}.'
_fetches = KeyedWindow(30, PERIOD_S)
_suggestions = KeyedWindow(60, PERIOD_S)


def reset_limits() -> None:
    _fetches.reset()
    _suggestions.reset()


def _charge(window: KeyedWindow, user: dict[str, Any]) -> None:
    if user.get("owner"):
        return
    wait_s = window.charge(user["uid"], 1)
    if wait_s:
        minutes = max(1, int(-(-wait_s // 60)))
        raise Problem(429, "cover_limit", f"Cover lookup limit reached. Try again in {minutes} min.",
                      headers={"Retry-After": str(int(wait_s) + 1)}, retry_after_minutes=minutes)


class CoverUrlRequest(BaseModel):
    url: str = Field(max_length=2048)


def _require_song(uid: str, video_id: str) -> None:
    if library.find_song(deps.load_songs(uid), video_id) is None:
        raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)


def _store(uid: str, video_id: str, jpeg: bytes) -> dict[str, Any]:
    with deps.tx(uid, f"cover {video_id}"):
        songs = library.load(deps.library_path(uid))
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        dest = deps.covers_dir(uid) / f"{video_id}.jpg"
        dest.parent.mkdir(parents=True, exist_ok=True)
        write_bytes_atomic(dest, jpeg)
        song.update(cover=f"covers/{video_id}.jpg", cover_v=coverimg.version_of(jpeg), cover_off=None, cover_source="custom", updated_at=library.now_utc())
        deps.save_songs(uid, songs)
        return deps.public_song(uid, song)


def _pin_default(uid: str, video_id: str) -> dict[str, Any]:
    with deps.tx(uid, f"cover default {video_id}"):
        songs = library.load(deps.library_path(uid))
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        (deps.covers_dir(uid) / f"{video_id}.jpg").unlink(missing_ok=True)
        song.update(cover=None, cover_v=None, cover_off=None, cover_source="default", updated_at=library.now_utc())
        deps.save_songs(uid, songs)
        return deps.public_song(uid, song)


async def _body(request: Request, limit: int = coverimg.MAX_BYTES) -> bytes:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise coverimg.too_large()
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise coverimg.too_large()
        chunks.append(chunk)
    return b"".join(chunks)


def multipart_file(content_type: str, body: bytes) -> bytes:
    """The bytes of the `file` part of a multipart/form-data body (stdlib parser, no extra dependency)."""
    head = b"Content-Type: " + content_type.encode("latin-1", "replace") + b"\r\nMIME-Version: 1.0\r\n\r\n"
    try:
        message = BytesParser(policy=policy.default).parsebytes(head + body)
        parts = list(message.iter_parts()) if message.is_multipart() else []
    except Exception:
        raise Problem(400, "cover_bad_body", "The upload could not be read.") from None
    for part in parts:
        if part.get_param("name", header="content-disposition") == "file":
            data = part.get_payload(decode=True)
            if data:
                return data
    raise Problem(422, "cover_no_file", "Send the image in a form field named file.")


def json_choice(body: bytes) -> tuple[str, str]:
    """('default', '') or ('url', address) from a JSON body; anything else is refused."""
    try:
        doc = json.loads(body.decode("utf-8"))
    except ValueError:
        raise Problem(400, "cover_bad_body", "The request body is not valid JSON.") from None
    if not isinstance(doc, dict):
        raise Problem(422, "cover_bad_body", CHOICE_HINT)
    if doc.get("default") is True:
        return "default", ""
    url = doc.get("url")
    if isinstance(url, str) and url.strip() and len(url) <= 2048:
        return "url", url
    raise Problem(422, "cover_bad_body", CHOICE_HINT)


@router.put("/songs/{video_id}/cover", responses=deps.responses(400, 404, 413, 415, 422, 429, 502))
async def put_cover(video_id: str, request: Request, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    """The new cover as raw image bytes (`image/jpeg|png|webp` body), multipart/form-data with a `file` part, JSON `{"url": "https://..."}` (the server downloads it) or JSON `{"default": true}` (pin the placeholder). Images: at most 5 MB, stored re-encoded as a JPEG of at most 1024 px."""
    deps.valid_id(video_id)
    uid = user["uid"]
    content_type = request.headers.get("content-type", "")
    kind = content_type.split(";")[0].strip().lower()
    if kind not in (*coverimg.ALLOWED_TYPES, "multipart/form-data", "application/json"):
        raise Problem(415, "cover_bad_type", "Use a JPEG, PNG or WebP image.")
    await run_in_threadpool(_require_song, uid, video_id)
    if kind == "application/json":
        choice, address = json_choice(await _body(request, JSON_MAX_BYTES))
        if choice == "default":
            return await run_in_threadpool(_pin_default, uid, video_id)
        _charge(_fetches, user)
        data = await run_in_threadpool(discogs_cover.fetch, address)
    elif kind == "multipart/form-data":
        data = multipart_file(content_type, await _body(request, coverimg.MAX_BYTES + MULTIPART_OVERHEAD))
    else:
        data = await _body(request)
    jpeg = await run_in_threadpool(coverimg.normalize, data)
    return await run_in_threadpool(_store, uid, video_id, jpeg)


@router.post("/songs/{video_id}/cover/from-url", responses=deps.responses(404, 422, 429, 502))
def cover_from_url(video_id: str, req: CoverUrlRequest, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    deps.valid_id(video_id)
    uid = user["uid"]
    _require_song(uid, video_id)
    _charge(_fetches, user)
    jpeg = coverimg.normalize(discogs_cover.fetch(req.url))
    return _store(uid, video_id, jpeg)


@router.get("/songs/{video_id}/cover/suggestions", responses=deps.responses(404, 422, 429))
def cover_suggestions(video_id: str, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    """Up to 4 candidate cover images from the song's Wikipedia song and album pages plus its stored Discogs release or master page (`source: discogs`, `url` is the page address; needs DISCOGS_TOKEN); empty when it has no such links."""
    deps.valid_id(video_id)
    song = library.find_song(deps.load_songs(user["uid"]), video_id)
    if song is None:
        raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
    links = [link for key in ("wikipedia_song", "wikipedia_album") if (link := wiki_lookup.clean_link(song.get(key)))]
    discogs = discogs_cover.parse_page(song.get("discogs_url") or "")
    if not links and not discogs:
        return {"suggestions": []}
    _charge(_suggestions, user)
    found = wiki_lookup.cover_candidates(links)[:MAX_SUGGESTIONS] if links else []
    extra = discogs_cover.suggestion(song.get("discogs_url")) if discogs else None
    if extra:
        found = [*found[:MAX_SUGGESTIONS - 1], extra]
    return {"suggestions": found}


@router.delete("/songs/{video_id}/cover", status_code=204, responses=deps.responses(404, 422))
def delete_cover(video_id: str, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    """A custom or default cover goes back to the automatic one (fetched again, `cover_v` bumped); an automatic cover is removed so the placeholder shows. Idempotent; a later audio fetch does not bring a removed cover back."""
    deps.valid_id(video_id)
    uid = user["uid"]
    song = library.find_song(deps.load_songs(uid), video_id)
    if song is None:
        raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
    restored = downloads.fetch_cover_bytes(uid, video_id) if song.get("cover_source") in PINNED else None
    with deps.tx(uid, f"cover off {video_id}"):
        songs = library.load(deps.library_path(uid))
        song = library.find_song(songs, video_id)
        if song is None:
            raise HTTPException(status_code=404, detail=deps.UNKNOWN_SONG)
        was_pinned = song.pop("cover_source", None) in PINNED
        if was_pinned and restored:
            song.update(cover=f"covers/{video_id}.jpg", cover_v=coverimg.version_of(restored), cover_off=None)
        else:
            (deps.covers_dir(uid) / f"{video_id}.jpg").unlink(missing_ok=True)
            song.update(cover=None, cover_v=None, cover_off=None if was_pinned else True)
        song["updated_at"] = library.now_utc()
        deps.save_songs(uid, songs)
