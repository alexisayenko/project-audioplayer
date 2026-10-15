"""Public read-only guest view (ADR-0018): config, client IP, per-IP limits and the PII-free serialisation."""

from __future__ import annotations

import ipaddress
import os
import threading
import time
from typing import Any

from fastapi import Request
from fastapi.responses import FileResponse

from . import users
from .problems import Problem
from .ratelimit import KeyedWindow

OWNER_LABEL = "Alex"
LAN_NETS = tuple(ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"))
MB = 1024 * 1024
READ_PATHS = frozenset({"/library", "/tags", "/genres/graph", "/catalog", "/me"})
READ_PREFIXES = ("/files/", "/covers/")
SONG_KEYS = frozenset({
    "id", "source", "title", "artist", "album", "remixer", "year", "remix_year", "tags", "bpm", "duration",
    "source_url", "musicbrainz_url", "discogs_url", "spotify_url", "wikipedia_song", "wikipedia_artist", "wikipedia_album", "sources",
    "updated_at", "cover", "cover_v", "added_at", "audio_state",
})
AUDIO_KEYS = ("format", "size", "duration")


def _flag(name: str, default: str = "1") -> bool:
    return os.environ.get(name, default).strip().lower() not in ("0", "false", "no", "off")


def _number(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, "")))
    except ValueError:
        return default


def enabled() -> bool:
    return _flag("PUBLIC_VIEW")


def audio_enabled() -> bool:
    return _flag("PUBLIC_AUDIO")


def view_uid() -> str:
    return users.uid_for_email(os.environ.get("PUBLIC_VIEW_EMAIL", "").strip() or users.owner_email())


def me_payload() -> dict[str, Any]:
    return {"guest": True, "public_view": True, "audio": audio_enabled(), "owner_label": OWNER_LABEL}


def principal() -> dict[str, Any]:
    return {"method": "guest", "uid": view_uid(), "email": None, "provider": "guest", "owner": False, "guest": True}


def is_guest(user: dict[str, Any]) -> bool:
    return bool(user.get("guest"))


def trusted_peer(host: str) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return addr.is_loopback or addr.is_link_local or any(addr in net for net in LAN_NETS if net.version == addr.version)


def client_ip(request: Request) -> str:
    """The socket address, or CF-Connecting-IP when the peer is loopback/LAN (the cloudflared host)."""
    peer = request.client.host if request.client else ""
    if trusted_peer(peer):
        forwarded = request.headers.get("cf-connecting-ip", "").strip()
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    return peer or "unknown"


_requests = KeyedWindow(240, 60.0)
_audio = KeyedWindow(1024 * MB, 3600.0)
_streams: dict[str, int] = {}
_streams_lock = threading.Lock()


def reset(clock=time.monotonic) -> None:
    _requests.clock = _audio.clock = clock
    _requests.reset()
    _audio.reset()
    with _streams_lock:
        _streams.clear()


def _refuse(wait: float, what: str) -> Problem:
    minutes = max(1, int(-(-wait // 60)))
    return Problem(429, "guest_limit", f"Guest {what} limit reached; try again in {minutes} min.",
                   headers={"Retry-After": str(int(wait) + 1)}, retry_after_minutes=minutes)


def count_request(ip: str) -> None:
    _requests.limit = _number("GUEST_REQ_PER_MIN", 240)
    wait = _requests.charge(ip)
    if wait:
        raise _refuse(wait, "request")


def charge_audio(ip: str, size: int) -> None:
    _audio.limit = _number("GUEST_AUDIO_MB_PER_HOUR", 1024) * MB
    wait = _audio.charge(ip, size)
    if wait:
        raise _refuse(wait, "audio")


def range_bytes(header: str, size: int) -> int:
    """Bytes a Range request will serve; an absent or unparseable header counts as the whole file."""
    spec = header.strip().lower()
    if not spec.startswith("bytes="):
        return size
    total = 0
    for part in spec[6:].split(","):
        start, _, end = part.strip().partition("-")
        try:
            if start == "":
                total += min(int(end), size)
            else:
                first = int(start)
                last = min(int(end), size - 1) if end else size - 1
                total += max(0, last - first + 1)
        except ValueError:
            return size
    return total


def open_stream(ip: str) -> None:
    cap = _number("GUEST_MAX_STREAMS", 3)
    with _streams_lock:
        if _streams.get(ip, 0) >= cap:
            raise _refuse(30.0, "stream")
        _streams[ip] = _streams.get(ip, 0) + 1


def close_stream(ip: str) -> None:
    with _streams_lock:
        left = _streams.get(ip, 0) - 1
        if left > 0:
            _streams[ip] = left
        else:
            _streams.pop(ip, None)


class GuestFile(FileResponse):
    """A file response that holds one of the client's concurrent-stream slots until it finishes or is cut off."""

    def __init__(self, *args: Any, ip: str, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.ip = ip

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            close_stream(self.ip)


def scrub_song(song: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in song.items() if k in SONG_KEYS}
    audio = song.get("audio")
    if isinstance(audio, dict):
        out["audio"] = {k: audio.get(k) for k in AUDIO_KEYS}
    return out


def scrub_songs(songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [scrub_song(s) for s in songs]
