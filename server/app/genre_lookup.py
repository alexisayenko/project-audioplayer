"""Genre and country tag suggestions, first release year and album from MusicBrainz (free, no API key)."""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .titles import clean_artist, clean_title, split_artist_title  # noqa: F401

log = logging.getLogger(__name__)

API = "https://musicbrainz.org/ws/2"
DEFAULT_UA = "audioplayer/0.1 (alex.isayenko@gmail.com)"
MIN_SCORE = 90
MAX_GENRES = 3
TIMEOUT = 5
MIN_INTERVAL = 1.1
RETRY_DELAY = 1.0

_rate_lock = threading.Lock()
_last_call = 0.0
_cache: dict[tuple[str, str], dict[str, Any]] = {}
_key_locks: dict[tuple[str, str], threading.Lock] = {}
_key_locks_guard = threading.Lock()

_OFF = {"0", "false", "no", "off"}


def enabled() -> bool:
    """AUDIO_TAG_LOOKUP is the preferred switch, AUDIO_GENRE_LOOKUP its older alias; either one off disables the lookup."""
    return all(os.environ.get(v, "1").strip().lower() not in _OFF for v in ("AUDIO_TAG_LOOKUP", "AUDIO_GENRE_LOOKUP"))


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
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code != 503:
                    raise
                time.sleep(RETRY_DELAY)
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


_PRIMARY_OK = {"album", "ep", "single"}
_SECONDARY_BAD = {"compilation", "mixtape/street", "mixtape", "dj-mix", "live", "remix"}


def _album(full: dict[str, Any], artist: str = "") -> str | None:
    """Title of the best release of a recording: credited to `artist`, an Album/EP/Single without
    Compilation/Mixtape/DJ-mix/Live/Remix types; Albums first, then official, then earliest date."""
    best: tuple[Any, str] | None = None
    for r in full.get("releases") or []:
        title = str(r.get("title") or "").strip()
        if not title:
            continue
        credits = r.get("artist-credit") or []
        names = [c.get("name", "") for c in credits] + [(c.get("artist") or {}).get("name", "") for c in credits]
        if not any(_artist_match(artist, n) for n in names):
            continue
        rg = r.get("release-group") or {}
        primary = str(rg.get("primary-type") or "").casefold()
        secondary = {str(t).casefold() for t in rg.get("secondary-types") or []}
        if primary not in _PRIMARY_OK or secondary & _SECONDARY_BAD:
            continue
        key = (primary != "album", r.get("status") != "Official", str(r.get("date") or "9999"))
        if best is None or key < best[0]:
            best = (key, title)
    return best[1] if best else None


def _country(artist: dict[str, Any]) -> list[str]:
    code = str(artist.get("country") or "").strip().lower()
    return [f"country:{code}"] if re.fullmatch(r"[a-z]{2}", code) else []


def _url_rels(entity: dict[str, Any]) -> list[str]:
    """`wikipedia` and `wikidata` URL relations of a MusicBrainz entity."""
    out = []
    for rel in entity.get("relations") or []:
        if rel.get("type") in ("wikipedia", "wikidata"):
            res = (rel.get("url") or {}).get("resource")
            if res:
                out.append(str(res))
    return out


def _first_year(full: dict[str, Any]) -> int | None:
    m = re.match(r"^(\d{4})", str(full.get("first-release-date") or ""))
    return int(m.group(1)) if m else None


def _work_rels(full: dict[str, Any]) -> list[str]:
    """URL relations of the first linked work (one extra call), used when the recording has none."""
    for rel in full.get("relations") or []:
        wid = (rel.get("work") or {}).get("id")
        if wid:
            try:
                return _url_rels(_get(f"work/{wid}", {"inc": "url-rels", "fmt": "json"}))
            except Exception as exc:
                log.warning("work lookup failed for %s: %s", wid, exc)
            break
    return []


def _empty() -> dict[str, Any]:
    return {"tags": [], "song_rels": [], "artist_rels": [], "year": None, "album": None}


def _lookup(artist: str, title: str) -> dict[str, Any]:
    query = f'recording:"{title}" AND artist:"{artist}"'
    data = _get("recording/", {"query": query, "fmt": "json", "limit": "5"})
    for rec in data.get("recordings") or []:
        if int(rec.get("score") or 0) < MIN_SCORE:
            continue
        credits = rec.get("artist-credit") or []
        names = [c.get("name", "") for c in credits] + [c.get("artist", {}).get("name", "") for c in credits]
        if not any(_artist_match(artist, n) for n in names):
            continue
        full = _get(f"recording/{rec['id']}", {"inc": "genres+tags+work-rels+url-rels+releases+release-groups+artist-credits", "fmt": "json"})
        genres = _top(full)
        country: list[str] = []
        song_rels = _url_rels(full) or _work_rels(full)
        artist_rels: list[str] = []
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
                art = _get(f"artist/{aid}", {"inc": "genres+tags+url-rels", "fmt": "json"})
                country = _country(art)
                genres = genres or _top(art)
                artist_rels = _url_rels(art)
            except Exception as exc:
                log.warning("artist lookup failed for %r: %s", artist, exc)
        return {
            "tags": [*genres, *country],
            "song_rels": song_rels,
            "artist_rels": artist_rels,
            "year": _first_year(full),
            "album": _album(full, artist),
        }
    return _empty()


def lookup(artist: str, title: str) -> dict[str, Any]:
    """Tags, Wikipedia/Wikidata URL relations (song, artist), first release year and album; empty when disabled, unmatched or on any error."""
    if not enabled():
        return _empty()
    try:
        artist, title = split_artist_title(artist, title)
        if not artist or not title:
            return _empty()
        key = (artist.casefold(), title.casefold())
        if key not in _cache:
            with _key_locks_guard:
                lock = _key_locks.setdefault(key, threading.Lock())
            with lock:
                if key not in _cache:
                    _cache[key] = _lookup(artist, title)
        return {**_cache[key], "tags": list(_cache[key]["tags"])}
    except Exception as exc:
        log.warning("tag lookup failed for %r - %r: %s", artist, title, exc)
        return _empty()


def suggest_tags(artist: str, title: str) -> list[str]:
    """`genre:` (up to 3), and `country:` (up to 1) tags for a track; [] when disabled, unmatched or on any error."""
    return lookup(artist, title)["tags"]
