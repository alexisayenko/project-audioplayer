"""Spotify Web API lookup: metadata only, never audio (ADR-0010, CAT-012..014).

Client credentials come from the git-ignored env (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)
and are never logged. Without them the keyless oEmbed endpoint gives title and thumbnail only
(`partial: true`).
"""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from . import library, urlclean

log = logging.getLogger(__name__)

TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"
OEMBED_URL = "https://open.spotify.com/oembed"
TIMEOUT = 15
MAX_GENRES = 3
NO_AUDIO_MESSAGE = "No audio yet — Spotify gives metadata only; get the audio from a YouTube match later."


class SpotifyError(Exception):
    """A lookup failure with an API error code: not_found, private, rate_limited, unauthorized, failed."""

    def __init__(self, code: str, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.retry_after = retry_after


def credentials() -> tuple[str, str] | None:
    cid = (os.environ.get("SPOTIFY_CLIENT_ID") or "").strip()
    secret = (os.environ.get("SPOTIFY_CLIENT_SECRET") or "").strip()
    return (cid, secret) if cid and secret else None


def enabled() -> bool:
    """Whether full lookups are possible (credentials present)."""
    return credentials() is not None


# --- token cache -----------------------------------------------------------------------------

_token_lock = threading.Lock()
_token: dict[str, Any] = {"value": None, "expires": 0.0}
_SKEW = 60.0


def _fetch_token() -> tuple[str, float]:
    creds = credentials()
    if not creds:
        raise SpotifyError("unauthorized", "Spotify credentials are not configured")
    basic = base64.b64encode(f"{creds[0]}:{creds[1]}".encode()).decode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode(),
        headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 401):
            raise SpotifyError("unauthorized", "Spotify rejected the client credentials") from None
        raise SpotifyError("failed", f"Spotify token request failed ({exc.code})") from None
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise SpotifyError("failed", "Spotify is unreachable") from exc
    token = body.get("access_token")
    if not token:
        raise SpotifyError("failed", "Spotify returned no access token")
    return str(token), time.time() + float(body.get("expires_in") or 3600)


def access_token(force: bool = False) -> str:
    """The cached client-credentials token, refreshed when missing, expired or `force`d."""
    with _token_lock:
        if not force and _token["value"] and time.time() < _token["expires"] - _SKEW:
            return _token["value"]
        value, expires = _fetch_token()
        _token["value"], _token["expires"] = value, expires
        return value


def clear_token() -> None:
    with _token_lock:
        _token["value"], _token["expires"] = None, 0.0


# --- API calls -------------------------------------------------------------------------------


def _get(path: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(f"{API_BASE}{path}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def _api(path: str) -> dict[str, Any]:
    """GET an API path with the cached token; one refresh on 401; 404/429 mapped to SpotifyError."""
    token = access_token()
    for attempt in (0, 1):
        try:
            return _get(path, token)
        except urllib.error.HTTPError as exc:
            if exc.code == 401 and attempt == 0:
                token = access_token(force=True)
                continue
            if exc.code == 401:
                raise SpotifyError("unauthorized", "Spotify rejected the access token") from None
            if exc.code in (400, 404):
                raise SpotifyError("not_found", "Spotify track not found") from None
            if exc.code == 403:
                raise SpotifyError("private", "Spotify refuses to serve this track") from None
            if exc.code == 429:
                retry = exc.headers.get("Retry-After") if exc.headers else None
                seconds = int(retry) if retry and str(retry).isdigit() else None
                wait = f" Try again in {seconds} s." if seconds else ""
                raise SpotifyError("rate_limited", f"Spotify rate limit reached.{wait}", retry_after=seconds) from None
            raise SpotifyError("failed", f"Spotify request failed ({exc.code})") from None
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise SpotifyError("failed", "Spotify is unreachable") from exc
    raise SpotifyError("failed", "Spotify request failed")  # pragma: no cover


# --- mapping ---------------------------------------------------------------------------------


def _year(release_date: Any) -> int | None:
    text = str(release_date or "")[:4]
    return int(text) if text.isdigit() and 1000 <= int(text) <= 3000 else None


def _largest_image(images: Any) -> str | None:
    best, best_px = None, -1
    for img in images or []:
        if not isinstance(img, dict) or not img.get("url"):
            continue
        px = int(img.get("width") or 0) * int(img.get("height") or 0)
        if px > best_px:
            best, best_px = str(img["url"]), px
    return best


def _artist_names(track: dict[str, Any]) -> list[str]:
    return [str(a.get("name")).strip() for a in track.get("artists") or [] if isinstance(a, dict) and a.get("name")]


def map_track(track: dict[str, Any], genres: list[str] | None = None) -> dict[str, Any]:
    """The /preview shape for a Spotify track object: metadata only, `audio: "none"`."""
    track_id = str(track.get("id") or "")
    song_id = urlclean.spotify_song_id(track_id)
    album = track.get("album") if isinstance(track.get("album"), dict) else {}
    year = _year(album.get("release_date"))
    duration_ms = track.get("duration_ms")
    tags = library.clean_tags([f"genre:{g}" for g in (genres or [])[:MAX_GENRES] if str(g).strip()])
    external = track.get("external_ids") if isinstance(track.get("external_ids"), dict) else {}
    return {
        "id": song_id,
        "source": "spotify",
        "source_url": urlclean.watch_url(song_id),
        "audio": "none",
        "title": str(track.get("name") or "").strip(),
        "artist": ", ".join(_artist_names(track)),
        "album": (str(album.get("name")).strip() or None) if album.get("name") else None,
        "year": year,
        "tags": library.with_decade(tags, year),
        "duration": round(float(duration_ms) / 1000, 3) if isinstance(duration_ms, (int, float)) else None,
        "thumbnail": _largest_image(album.get("images")),
        "isrc": (str(external.get("isrc")).strip() or None) if external.get("isrc") else None,
        "partial": False,
    }


def lookup(track_id: str) -> dict[str, Any]:
    """Full metadata for a track id via the Web API (credentials required). Raises SpotifyError."""
    track = _api(f"/tracks/{urllib.parse.quote(track_id)}")
    genres: list[str] = []
    artists = track.get("artists") or []
    primary = artists[0] if artists and isinstance(artists[0], dict) else None
    if primary and primary.get("id"):
        try:
            artist = _api(f"/artists/{urllib.parse.quote(str(primary['id']))}")
            genres = [str(g) for g in artist.get("genres") or []]
        except SpotifyError as exc:
            if exc.code == "rate_limited":
                raise
            log.info("spotify: artist genres unavailable (%s)", exc.code)
    return map_track(track, genres)


def oembed(track_id: str) -> dict[str, Any]:
    """Keyless fallback: title and thumbnail only, `partial: true`. Raises SpotifyError."""
    song_id = urlclean.spotify_song_id(track_id)
    url = urlclean.watch_url(song_id)
    req = urllib.request.Request(f"{OEMBED_URL}?{urllib.parse.urlencode({'url': url})}", headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 404):
            raise SpotifyError("not_found", "Spotify track not found") from None
        if exc.code == 429:
            raise SpotifyError("rate_limited", "Spotify rate limit reached.") from None
        raise SpotifyError("failed", f"Spotify request failed ({exc.code})") from None
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise SpotifyError("failed", "Spotify is unreachable") from exc
    return {
        "id": song_id,
        "source": "spotify",
        "source_url": url,
        "audio": "none",
        "title": str(body.get("title") or "").strip(),
        "artist": "",
        "album": None,
        "year": None,
        "tags": [],
        "duration": None,
        "thumbnail": body.get("thumbnail_url") or None,
        "isrc": None,
        "partial": True,
        "partial_reason": "Spotify credentials are not configured; title and cover only",
    }


def probe(track_url: str) -> dict[str, Any]:
    """Metadata for a canonical Spotify track URL: the Web API when credentials exist, else oEmbed."""
    track_id = urlclean.spotify_track_id_of(track_url)
    if not track_id:
        raise SpotifyError("unsupported", urlclean.UNSUPPORTED_MESSAGE)
    if enabled():
        return lookup(track_id)
    return oembed(track_id)
