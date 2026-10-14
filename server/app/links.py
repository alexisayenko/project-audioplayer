"""Pasted links -> song ids, and short human-readable error text for upstream failures."""

from __future__ import annotations

import re
from typing import Any

from fastapi.responses import JSONResponse

from . import extractor, urlclean

NOT_A_LINK = "not a YouTube video or SoundCloud track URL"
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_ERROR_PREFIX = re.compile(r"^ERROR:\s*(\[\w+\]\s*[\w-]+:\s*)?")
_SHORT_LIMIT = 300
_STATUS_BY_CODE = {"not_found": 404, "private": 403}


def error_response(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse({"error": code, "detail": detail}, status_code=status)


class Resolved:
    """A pasted link resolved to a song id (and, for SoundCloud, its probed metadata)."""

    def __init__(self, vid: str, url: str, probe: dict[str, Any] | None = None) -> None:
        self.vid, self.url, self.probe = vid, url, probe


class Refused(Exception):
    def __init__(self, response: JSONResponse) -> None:
        self.response = response


def _cut_hint(text: str) -> str:
    cut = len(text)
    i = text.find("Use --cookies", 1)
    while i > 0:
        if text[i - 1].isspace():
            cut = i
            break
        i = text.find("Use --cookies", i + 1)
    i = text.find("See", 1, cut)
    while i > 0:
        if text[i - 1].isspace():
            rest = text[i + 3 :]
            tail = rest.lstrip()
            if len(tail) < len(rest) and tail.startswith(("http://", "https://")):
                cut = i
                break
        i = text.find("See", i + 1, cut)
    return text[:cut].rstrip()


def short_error(exc: Exception) -> str:
    text = _ANSI.sub("", str(exc)).strip()
    text = _ERROR_PREFIX.sub("", text)
    return _cut_hint(text).strip()[:_SHORT_LIMIT]


def resolve_link(text: str) -> Resolved:
    """YouTube link -> id; SoundCloud link -> canonical URL, id and probe. Raises Refused with the JSON error."""
    vid = extractor.parse_video_id(text)
    if vid:
        return Resolved(vid, extractor.watch_url(vid))
    sc = urlclean.classify_soundcloud(text)
    if sc is None:
        raise Refused(error_response(422, "unsupported", NOT_A_LINK))
    kind, url = sc
    if kind == "unsupported":
        raise Refused(error_response(422, "unsupported", urlclean.UNSUPPORTED_MESSAGE))
    try:
        if kind == "short":
            url = urlclean.resolve_soundcloud_short(url)
        probe = extractor.soundcloud_probe(url)
    except ValueError as exc:
        raise Refused(error_response(422, "unsupported", str(exc))) from exc
    except Exception as exc:
        code = extractor.error_code(exc)
        status = _STATUS_BY_CODE.get(code or "", 502)
        raise Refused(error_response(status, code or "failed", f"preview failed: {short_error(exc)}")) from exc
    if probe.get("preview_only"):
        raise Refused(error_response(422, "preview_only", extractor.PREVIEW_ONLY_MESSAGE))
    return Resolved(probe["id"], probe["source_url"], probe)
