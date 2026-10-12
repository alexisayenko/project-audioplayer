"""Genre suggestions from MusicBrainz (free, no API key)."""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from typing import Any

log = logging.getLogger(__name__)

API = "https://musicbrainz.org/ws/2"
DEFAULT_UA = "audioplayer/0.1 (alex.isayenko@gmail.com)"
MIN_SCORE = 90
MAX_GENRES = 3
TIMEOUT = 5
MIN_INTERVAL = 1.1

_rate_lock = threading.Lock()
_last_call = 0.0
_cache: dict[tuple[str, str], list[str]] = {}

_NOISE = re.compile(
    r"[\(\[][^\)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|remaster(ed)?|hd|hq|4k|live|clip|mv)\b[^\)\]]*[\)\]]",
    re.I,
)
_FEAT = re.compile(r"\s*[\(\[]?\b(?:feat\.?|ft\.?|featuring)\s.*$", re.I)


def enabled() -> bool:
    return os.environ.get("AUDIO_GENRE_LOOKUP", "1").strip().lower() not in {"0", "false", "no", "off"}


def clean_artist(artist: str) -> str:
    a = re.sub(r"\s*-\s*Topic\s*$", "", artist or "", flags=re.I)
    a = re.sub(r"VEVO\s*$", "", a, flags=re.I)
    a = _FEAT.sub("", a)
    return re.sub(r"\s+", " ", a).strip()


def clean_title(title: str) -> str:
    t = _NOISE.sub("", title or "")
    t = _FEAT.sub("", t)
    t = re.sub(r"[\(\[]\s*[\)\]]", "", t)
    return re.sub(r"\s+", " ", t).strip(" -|")


def split_artist_title(artist: str, title: str) -> tuple[str, str]:
    artist, title = clean_artist(artist), clean_title(title)
    if not artist and " - " in title:
        a, _, t = title.partition(" - ")
        return clean_artist(a), clean_title(t)
    if artist and title.casefold().startswith(artist.casefold() + " - "):
        title = title[len(artist) + 3 :].strip()
    return artist, title


def _norm(s: str) -> str:
    return re.sub(r"[^\w]+", " ", s.casefold()).strip()


def _artist_match(wanted: str, found: str) -> bool:
    w, f = _norm(wanted), _norm(found)
    return bool(w and f and (w == f or w in f or f in w))


def _get(path: str, params: dict[str, str]) -> dict[str, Any]:
    global _last_call
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url, headers={"User-Agent": os.environ.get("AUDIO_MB_USER_AGENT", DEFAULT_UA), "Accept": "application/json"}
    )
    with _rate_lock:
        wait = _last_call + MIN_INTERVAL - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        finally:
            _last_call = time.monotonic()


def _top(entity: dict[str, Any]) -> list[str]:
    items = (entity.get("genres") or []) + (entity.get("tags") or [])
    best: dict[str, int] = {}
    for g in items:
        name = str(g.get("name", "")).strip().casefold()
        if name:
            best[name] = max(best.get(name, 0), int(g.get("count") or 0))
    ranked = sorted(best, key=lambda n: -best[n])
    return [f"genre:{n}" for n in ranked[:MAX_GENRES]]


def _lookup(artist: str, title: str) -> list[str]:
    query = f'recording:"{title}" AND artist:"{artist}"'
    data = _get("recording/", {"query": query, "fmt": "json", "limit": "5"})
    for rec in data.get("recordings") or []:
        if int(rec.get("score") or 0) < MIN_SCORE:
            continue
        credits = rec.get("artist-credit") or []
        names = [c.get("name", "") for c in credits] + [c.get("artist", {}).get("name", "") for c in credits]
        if not any(_artist_match(artist, n) for n in names):
            continue
        found = _top(_get(f"recording/{rec['id']}", {"inc": "genres+tags", "fmt": "json"}))
        if found:
            return found
        for c in credits:
            aid = c.get("artist", {}).get("id")
            if aid and _artist_match(artist, c.get("artist", {}).get("name", "")):
                return _top(_get(f"artist/{aid}", {"inc": "genres+tags", "fmt": "json"}))
        return []
    return []


def suggest_genres(artist: str, title: str) -> list[str]:
    """Up to 3 `genre:<name>` tags for a track; [] when disabled, unmatched or on any error."""
    if not enabled():
        return []
    try:
        artist, title = split_artist_title(artist, title)
        if not artist or not title:
            return []
        key = (artist.casefold(), title.casefold())
        if key in _cache:
            return list(_cache[key])
        result = _lookup(artist, title)
        _cache[key] = result
        return list(result)
    except Exception as exc:
        log.warning("genre lookup failed for %r - %r: %s", artist, title, exc)
        return []
