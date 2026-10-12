"""Signed session cookie for the web UI: lets <audio>/<img> GETs authenticate without a token in the URL."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from urllib.parse import urlparse

COOKIE = "__Host-session"
LIFETIME = 12 * 3600
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "audioplayer"


def _key() -> bytes:
    secret = os.environ.get("AUDIO_SESSION_SECRET", "")
    if secret:
        return secret.encode()
    api = os.environ.get("AUDIO_API_TOKEN", "")
    if not api:
        return b""
    return hmac.new(api.encode(), b"audioplayer-session-v1", hashlib.sha256).digest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def available() -> bool:
    return bool(_key())


def issue(identity: dict, now: float | None = None) -> str:
    body = _b64(json.dumps(
        {"p": identity["provider"], "e": identity["email"], "x": int((now or time.time()) + LIFETIME)},
        separators=(",", ":")).encode())
    sig = _b64(hmac.new(_key(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read(value: str, now: float | None = None) -> dict | None:
    key = _key()
    if not key or not value or "." not in value:
        return None
    body, _, sig = value.partition(".")
    good = _b64(hmac.new(key, body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig.encode(), good.encode()):
        return None
    try:
        data = json.loads(_unb64(body))
        if int(data["x"]) < (now or time.time()):
            return None
        return {"provider": data["p"], "email": data["e"]}
    except Exception:
        return None


def csrf_ok(headers, host: str) -> bool:
    """Unsafe cookie-authenticated requests need the custom header, and a same-host Origin if one is sent."""
    if headers.get(CSRF_HEADER, "") != CSRF_VALUE:
        return False
    origin = headers.get("origin", "")
    return not origin or urlparse(origin).netloc == host
