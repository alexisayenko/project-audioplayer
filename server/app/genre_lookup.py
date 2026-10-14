"""Genre and country tag suggestions, first release year and album from MusicBrainz (free, no API key)."""

from __future__ import annotations

import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from . import countrycodes, httpjson, langcodes, timeutil
from .ratelimit import RateLimiter
from .titles import artist_candidates, clean_artist, clean_title, lookup_credits, lookup_query, lookup_title, split_artist_title  # noqa: F401

log = logging.getLogger(__name__)

API = "https://musicbrainz.org/ws/2"
MIN_SCORE = 90
MAX_GENRES = 3
TIMEOUT = 5
MIN_INTERVAL = 1.1
RETRY_DELAY = 1.0

_limiter = RateLimiter(MIN_INTERVAL)
_cache: dict[tuple[str, str, tuple[str, ...]], dict[str, Any]] = {}
_key_locks: dict[tuple[str, str, tuple[str, ...]], threading.Lock] = {}
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
    req = httpjson.build_request(f"{API}/{path}", params)
    with _limiter.serialized():
        try:
            return httpjson.fetch(req, TIMEOUT)
        except urllib.error.HTTPError as exc:
            if exc.code != 503:
                raise
            time.sleep(RETRY_DELAY)
            return httpjson.fetch(req, TIMEOUT)


def _top(entity: dict[str, Any]) -> list[str]:
    items = (entity.get("genres") or []) + (entity.get("tags") or [])
    best: dict[str, int] = {}
    for g in items:
        name = str(g.get("name", "")).strip().casefold()
        if name:
            best[name] = max(best.get(name, 0), int(g.get("count") or 0))
    ranked = sorted(best, key=lambda n: -best[n])
    return [f"genre:{n}" for n in ranked[:MAX_GENRES]]


_PRIMARY_OK = {"album", "ep"}
_SECONDARY_BAD = {"compilation", "mixtape/street", "mixtape", "dj-mix", "live", "remix"}


def _credited_names(credited: list[dict[str, Any]]) -> list[str]:
    return [c.get("name", "") for c in credited] + [(c.get("artist") or {}).get("name", "") for c in credited]


def _release_key(r: dict[str, Any], artist: str) -> tuple[bool, bool, str] | None:
    if not str(r.get("title") or "").strip():
        return None
    if not any(_artist_match(artist, n) for n in _credited_names(r.get("artist-credit") or [])):
        return None
    rg = r.get("release-group") or {}
    primary = str(rg.get("primary-type") or "").casefold()
    secondary = {str(t).casefold() for t in rg.get("secondary-types") or []}
    if primary not in _PRIMARY_OK or secondary & _SECONDARY_BAD:
        return None
    return (primary != "album", r.get("status") != "Official", str(r.get("date") or "9999"))


def _album(full: dict[str, Any], artist: str = "") -> str | None:
    """Title of the best release of a recording: credited to `artist`, an Album or EP without
    Compilation/Mixtape/DJ-mix/Live/Remix types; Albums first, then official, then earliest date."""
    best: tuple[Any, str] | None = None
    for r in full.get("releases") or []:
        key = _release_key(r, artist)
        if key is not None and (best is None or key < best[0]):
            best = (key, str(r.get("title") or "").strip())
    return best[1] if best else None


def _country(artist: dict[str, Any]) -> list[str]:
    code = countrycodes.canonical_country(str(artist.get("country") or "")) if re.fullmatch(r"[A-Za-z]{2}", str(artist.get("country") or "").strip()) else None
    return [f"country:{code}"] if code else []


def _url_rels(entity: dict[str, Any]) -> list[str]:
    """`wikipedia` and `wikidata` URL relations of a MusicBrainz entity."""
    out = []
    for rel in entity.get("relations") or []:
        if rel.get("type") in ("wikipedia", "wikidata"):
            res = (rel.get("url") or {}).get("resource")
            if res:
                out.append(str(res))
    return out


_MBID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def recording_url(mbid: Any) -> str | None:
    """The MusicBrainz page of a recording id; None unless it is a well-formed MBID."""
    text = str(mbid or "").strip().lower()
    return f"https://musicbrainz.org/recording/{text}" if _MBID.fullmatch(text) else None


_MB_RECORDING_URL = re.compile(r"https?://(?:www\.)?musicbrainz\.org/recording/([0-9a-fA-F-]{36})/?")


def clean_recording_url(value: Any) -> str | None:
    """A stored MusicBrainz recording link normalised to https://musicbrainz.org/recording/<mbid>; anything else is None."""
    match = _MB_RECORDING_URL.fullmatch(value.strip()) if isinstance(value, str) else None
    return recording_url(match.group(1)) if match else None


def _first_year(full: dict[str, Any]) -> int | None:
    m = re.match(r"^(\d{4})", str(full.get("first-release-date") or ""))
    return timeutil.valid_year(int(m.group(1))) if m else None


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
    return {"tags": [], "song_rels": [], "artist_rels": [], "year": None, "album": None, "mb_url": None}


def _artist_info(artist: str, credited: list[dict[str, Any]], genres: list[str]) -> tuple[list[str], list[str], list[str]]:
    with_id = [c for c in credited if c.get("artist", {}).get("id")]
    aid = next(
        (c["artist"]["id"] for c in with_id if _norm(artist) == _norm(c["artist"].get("name", "")) or _norm(artist) == _norm(c.get("name", ""))),
        None,
    ) or next((c["artist"]["id"] for c in with_id if _artist_match(artist, c["artist"].get("name", ""))), None)
    if not aid:
        return genres, [], []
    try:
        art = _get(f"artist/{aid}", {"inc": "genres+tags+url-rels", "fmt": "json"})
        return genres or _top(art), _country(art), _url_rels(art)
    except Exception as exc:
        log.warning("artist lookup failed for %r: %s", artist, exc)
        return genres, [], []


def _credits_all(names: list[str], wanted: list[str]) -> bool:
    return all(any(_artist_match(w, n) for n in names) for w in wanted)


def _pick_recording(recs: list[dict[str, Any]], artist: str, featured: list[str]) -> dict[str, Any] | None:
    """First good-score recording credited to `artist`; with featured names, the first one whose credit also has every one of them, else that first one."""
    first = None
    for rec in recs:
        if int(rec.get("score") or 0) < MIN_SCORE:
            continue
        names = _credited_names(rec.get("artist-credit") or [])
        if not any(_artist_match(artist, n) for n in names):
            continue
        if not featured or _credits_all(names, featured):
            return rec
        first = first or rec
    return first


def _lookup(artist: str, title: str, featured: list[str]) -> dict[str, Any]:
    query = f'recording:"{title}" AND artist:"{artist}"'
    data = _get("recording/", {"query": query, "fmt": "json", "limit": "10" if featured else "5"})
    rec = _pick_recording(data.get("recordings") or [], artist, featured)
    if rec:
        full = _get(f"recording/{rec['id']}", {"inc": _REC_INC, "fmt": "json"})
        return _details(rec["id"], full, rec.get("artist-credit") or [], artist)
    return _empty()


_REC_INC = "genres+tags+work-rels+url-rels+releases+release-groups+artist-credits"


def _details(rec_id: str, full: dict[str, Any], credited: list[dict[str, Any]], artist: str) -> dict[str, Any]:
    song_rels = _url_rels(full) or _work_rels(full)
    genres, country, artist_rels = _artist_info(artist, credited, _top(full))
    return {
        "tags": [*genres, *country],
        "song_rels": song_rels,
        "artist_rels": artist_rels,
        "year": _first_year(full),
        "album": _album(full, artist),
        "mb_url": recording_url(rec_id),
    }


def _credit_name(credited: list[dict[str, Any]]) -> str:
    return "".join(f"{c.get('name') or (c.get('artist') or {}).get('name') or ''}{c.get('joinphrase') or ''}" for c in credited).strip()


def _langs(full: dict[str, Any]) -> list[str]:
    """ISO 639-1 codes of the releases' text language, most common first (instrumental, multiple and unknown are dropped)."""
    counts: dict[str, int] = {}
    for r in full.get("releases") or []:
        code = langcodes.to_lang_code(str((r.get("text-representation") or {}).get("language") or ""))
        if code:
            counts[code] = counts.get(code, 0) + 1
    return sorted(counts, key=lambda c: -counts[c])


_rec_cache: dict[str, dict[str, Any]] = {}


def lookup_recording(mbid: str, artist: str = "") -> dict[str, Any]:
    """Like `lookup`, for a known recording id (e.g. from an audio fingerprint): the same tags, links, year, album and
    `mb_url`, plus the recording's `artist`, `title` and `langs`; empty when disabled, malformed or on any error."""
    out = {**_empty(), "artist": "", "title": "", "langs": []}
    mbid = str(mbid or "").strip().lower()
    if not enabled() or recording_url(mbid) is None:
        return out
    try:
        if mbid not in _rec_cache:
            full = _get(f"recording/{mbid}", {"inc": _REC_INC, "fmt": "json"})
            credited = full.get("artist-credit") or []
            first = next((c for c in credited if (c.get("artist") or {}).get("name") or c.get("name")), {})
            name = artist or (first.get("artist") or {}).get("name") or first.get("name") or ""
            found = _details(mbid, full, credited, name)
            _rec_cache[mbid] = {**found, "artist": _credit_name(credited), "title": str(full.get("title") or ""), "langs": _langs(full)}
        hit = _rec_cache[mbid]
        return {**hit, "tags": list(hit["tags"]), "langs": list(hit["langs"])}
    except Exception as exc:
        log.warning("recording lookup failed for %s: %s", mbid, exc)
        return out


def _cached_lookup(artist: str, title: str, feats: list[str]) -> dict[str, Any]:
    key = (artist.casefold(), title.casefold(), tuple(f.casefold() for f in feats))
    if key not in _cache:
        with _key_locks_guard:
            lock = _key_locks.setdefault(key, threading.Lock())
        with lock:
            if key not in _cache:
                _cache[key] = _lookup(artist, title, feats)
    return _cache[key]


def lookup(artist: str, title: str, featured: list[str] | None = None) -> dict[str, Any]:
    """Tags, Wikipedia/Wikidata URL relations (song, artist), first release year, album and the matched recording page (`mb_url`); empty when disabled, unmatched or on any error.

    `featured` names (default: those of a "feat." credit in `artist`) make the recording credited to the primary artist and all of them win; the primary artist's own id then gives country, genres and links."""
    if not enabled():
        return _empty()
    try:
        artist, names, title = lookup_query(artist, title)
        credited_feats = lookup_credits(artist)[1]
        feats = credited_feats if featured is None else [f for f in featured if f and f.strip()]
        if not names[0] or not title:
            return _empty()
        found = _empty()
        for name in names:
            found = _cached_lookup(name, title, feats)
            if found["mb_url"]:
                break
        return {**found, "tags": list(found["tags"])}
    except Exception as exc:
        log.warning("tag lookup failed for %r - %r: %s", artist, title, exc)
        return _empty()


def suggest_tags(artist: str, title: str) -> list[str]:
    """`genre:` (up to 3), and `country:` (up to 1) tags for a track; [] when disabled, unmatched or on any error."""
    return lookup(artist, title)["tags"]
