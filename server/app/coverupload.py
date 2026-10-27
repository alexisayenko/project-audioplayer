"""What the song cover routes and the album cover routes share: the request body readers and the per-user lookup limits."""

from __future__ import annotations

from email import policy
from email.parser import BytesParser
from typing import Any

from fastapi import Request

from . import coverimg
from .problems import Problem
from .ratelimit import KeyedWindow

PERIOD_S = 3600
JSON_MAX_BYTES = 8192
MULTIPART_OVERHEAD = 64 * 1024
fetches = KeyedWindow(30, PERIOD_S)
suggestions = KeyedWindow(60, PERIOD_S)


def reset_limits() -> None:
    fetches.reset()
    suggestions.reset()


def charge(window: KeyedWindow, user: dict[str, Any]) -> None:
    if user.get("owner"):
        return
    wait_s = window.charge(user["uid"], 1)
    if wait_s:
        minutes = max(1, int(-(-wait_s // 60)))
        raise Problem(429, "cover_limit", f"Cover lookup limit reached. Try again in {minutes} min.",
                      headers={"Retry-After": str(int(wait_s) + 1)}, retry_after_minutes=minutes)


async def read_body(request: Request, limit: int = coverimg.MAX_BYTES) -> bytes:
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
