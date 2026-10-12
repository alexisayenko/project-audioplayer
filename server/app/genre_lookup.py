"""Genre, country and language tag suggestions from MusicBrainz (free, no API key)."""

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

from . import langcodes

log = logging.getLogger(__name__)

API = "https://musicbrainz.org/ws/2"
DEFAULT_UA = "audioplayer/0.1 (alex.isayenko@gmail.com)"
MIN_SCORE = 90
MAX_GENRES = 3
MAX_LANGS = 2
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


_OFF = {"0", "false", "no", "off"}


def enabled() -> bool:
    """AUDIO_TAG_LOOKUP is the preferred switch, AUDIO_GENRE_LOOKUP its older alias; either one off disables the lookup."""
    return all(os.environ.get(v, "1").strip().lower() not in _OFF for v in ("AUDIO_TAG_LOOKUP", "AUDIO_GENRE_LOOKUP"))


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


def _languages(rec: dict[str, Any]) -> list[str]:
    codes: list[str] = []
    for rel in rec.get("relations") or []:
        work = rel.get("work") or {}
        for raw in [*(work.get("languages") or []), work.get("language")]:
            code = langcodes.to_lang_code(raw) if raw else None
            if code and f"lang:{code}" not in codes:
                codes.append(f"lang:{code}")
    return codes[:MAX_LANGS]


def _country(artist: dict[str, Any]) -> list[str]:
    code = str(artist.get("country") or "").strip().lower()
    return [f"country:{code}"] if re.fullmatch(r"[a-z]{2}", code) else []


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
        full = _get(f"recording/{rec['id']}", {"inc": "genres+tags+work-rels", "fmt": "json"})
        genres, langs = _top(full), _languages(full)
        country: list[str] = []
        aid = next(
            (
                c["artist"]["id"]
                for c in credits
                if c.get("artist", {}).get("id") and _artist_match(artist, c["artist"].get("name", ""))
            ),
            None,
        )
        if aid:
            try:
                art = _get(f"artist/{aid}", {"inc": "genres+tags", "fmt": "json"})
                country = _country(art)
                genres = genres or _top(art)
            except Exception as exc:
                log.warning("artist lookup failed for %r: %s", artist, exc)
        return [*genres, *country, *langs]
    return []


def suggest_tags(artist: str, title: str) -> list[str]:
    """`genre:` (up to 3), `country:` (up to 1) and `lang:` (up to 2) tags for a track; [] when disabled, unmatched or on any error."""
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
        log.warning("tag lookup failed for %r - %r: %s", artist, title, exc)
        return []
