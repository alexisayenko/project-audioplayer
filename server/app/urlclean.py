"""Canonical, tracking-free song URLs."""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

_ID = r"([A-Za-z0-9_-]{11})"
_URL_ID_RES = [
    re.compile(rf"^(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:.*&)?v={_ID}(?:[&#].*)?$", re.I),
    re.compile(rf"^(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/(?:shorts|embed|live)/{_ID}(?:[/?#].*)?$", re.I),
    re.compile(rf"^(?:https?://)?youtu\.be/{_ID}(?:[/?#].*)?$", re.I),
]

_TRACKING = {"si", "feature", "pp", "fbclid", "gclid"}


def is_valid_video_id(video_id: str) -> bool:
    return bool(VIDEO_ID_RE.fullmatch(video_id))


def parse_video_id(url_or_id: str) -> str | None:
    """Extract a YouTube video id from a URL (or accept a bare id)."""
    text = url_or_id.strip()
    if is_valid_video_id(text):
        return text
    for rx in _URL_ID_RES:
        m = rx.match(text)
        if m:
            return m.group(1)
    return None


def watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _is_tracking(name: str) -> bool:
    name = name.lower()
    return name in _TRACKING or name.startswith("utm_")


def clean_url(text: str) -> str:
    """YouTube links become https://www.youtube.com/watch?v=<id>; other http(s) links lose tracking params."""
    text = text.strip()
    vid = parse_video_id(text)
    if vid:
        return watch_url(vid)
    parts = urlsplit(text)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc or not parts.query:
        return text
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _is_tracking(k)]
    return urlunsplit(parts._replace(query=urlencode(kept)))
