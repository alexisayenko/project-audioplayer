"""Genre/style, country and year suggestions from Discogs (optional: needs DISCOGS_TOKEN, a free personal access token).

Terms: suggestions only; no images, no stored dumps. Responses live only in the in-memory per-query cache."""

from __future__ import annotations

import difflib
import logging
import os
import re
import threading
from typing import Any

from . import countrycodes, genre_lookup, httpjson
from .ratelimit import WindowLimiter
from .titles import lookup_query

log = logging.getLogger(__name__)

API = "https://api.discogs.com"
TIMEOUT = 8
MAX_PER_MINUTE = 50
MAX_WAIT = 15.0
MAX_STYLES = 4
SEARCH_LIMIT = 10
VERIFY_TRIES = 3
FUZZY = 0.85
MIN_FUZZY_TITLE = 3

_limiter = WindowLimiter(MAX_PER_MINUTE, MAX_WAIT, name="discogs rate limit")
_cache: dict[tuple[str, str], dict[str, Any]] = {}
_cache_lock = threading.Lock()


def _token() -> str:
    return os.environ.get("DISCOGS_TOKEN", "").strip()


def enabled() -> bool:
    return bool(_token()) and genre_lookup.enabled()


def _empty() -> dict[str, Any]:
    return {"tags": [], "year": None, "country": None, "url": None, "artist": "", "title": ""}


def _acquire() -> None:
    """Global limiter: at most MAX_PER_MINUTE requests in any 60 s; waits briefly, else refuses."""
    _limiter.acquire()


def _get(path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
    req = httpjson.build_request(
        f"{API}/{path}",
        params or None,
        headers={"Authorization": f"Discogs token={_token()}", "Accept": "application/vnd.discogs.v2.discogs+json"},
    )
    _acquire()
    return httpjson.fetch(req, TIMEOUT)


_DISAMBIG = re.compile(r"\s*\(\d+\)$")


def _name(value: str) -> str:
    return genre_lookup._norm(_DISAMBIG.sub("", str(value or "")))


def _similar(wanted: str, found: str) -> bool:
    w, f = _name(wanted), _name(found)
    if not w or not f:
        return False
    return w == f or w in f or f in w or difflib.SequenceMatcher(None, w, f).ratio() >= FUZZY


def _title_similar(wanted: str, found: str) -> bool:
    w, f = _name(wanted), _name(found)
    if min(len(w), len(f)) < MIN_FUZZY_TITLE:
        return bool(w) and w == f
    return _similar(wanted, found)


def _is_various(artist: str) -> bool:
    return _name(artist) in ("various", "various artists", "va")


def _result_artist(item: dict[str, Any]) -> str:
    return str(item.get("title") or "").partition(" - ")[0]


def _year(value: Any) -> int | None:
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    return year if 1000 < year < 3000 else None


def rank(results: list[dict[str, Any]], artist: str) -> list[dict[str, Any]]:
    """Releases credited to `artist` (fuzzy), earliest year first, then "Various" compilations (earliest first); other artists are dropped."""
    direct, various = [], []
    for item in results:
        if item.get("type") not in (None, "release") or not item.get("id"):
            continue
        credited = _result_artist(item)
        (direct if _similar(artist, credited) else various if _is_various(credited) else []).append(item)
    key = lambda it: (_year(it.get("year")) or 9999, str(it.get("id")))  # noqa: E731
    return sorted(direct, key=key) + sorted(various, key=key)


def _has_track(detail: dict[str, Any], title: str) -> bool:
    titles = []
    for t in detail.get("tracklist") or []:
        titles.append(str(t.get("title") or ""))
        titles.extend(str(s.get("title") or "") for s in t.get("sub_tracks") or [])
    titles = [t for t in titles if t.strip()]
    return not titles or any(_title_similar(title, t) for t in titles)


def release_url(kind: str, ident: Any) -> str | None:
    return f"https://www.discogs.com/{kind}/{int(ident)}" if kind in ("release", "master") and str(ident).isdigit() else None


_URL = re.compile(r"https?://(?:www\.)?discogs\.com/(?:[a-z]{2}(?:-[A-Z]{2})?/)?(release|master)/(\d+)(?:[-/?#].*)?")


def clean_url(value: Any) -> str | None:
    """A stored Discogs link normalised to https://www.discogs.com/(release|master)/<id>; any other host or path is None."""
    match = _URL.fullmatch(value.strip()) if isinstance(value, str) else None
    return release_url(match.group(1), match.group(2)) if match else None


def _tags(detail: dict[str, Any]) -> list[str]:
    styles = [str(s).strip().casefold() for s in detail.get("styles") or [] if str(s).strip()]
    if not styles:
        styles = [g.casefold() for g in map(str, detail.get("genres") or []) if g.strip() and "," not in g]
    return [f"genre:{s}" for s in dict.fromkeys(styles)][:MAX_STYLES]


def _country_tag(value: Any) -> str | None:
    code = countrycodes.canonical_country(str(value or ""))
    return f"country:{code}" if code else None


def _pick_release(title: str, ranked: list[dict[str, Any]]) -> dict[str, Any] | None:
    failed = 0
    for item in ranked[:VERIFY_TRIES]:
        try:
            detail = _get(f"releases/{int(item['id'])}")
        except Exception as exc:
            log.warning("discogs release %s failed: %s", item.get("id"), type(exc).__name__)
            failed += 1
            continue
        if _has_track(detail, title):
            return {**detail, "_various": _is_various(_result_artist(item))}
    if failed:
        raise RuntimeError("discogs release lookup failed")
    return None


def _lookup(artist: str, title: str) -> dict[str, Any]:
    data = _get("database/search", {"type": "release", "artist": artist, "track": title, "per_page": str(SEARCH_LIMIT)})
    release = _pick_release(title, rank(data.get("results") or [], artist))
    if release is None:
        return _empty()
    master = release.get("master_id")
    url = release_url("master", master) if master else release_url("release", release.get("id"))
    country = _country_tag(release.get("country"))
    # a Various compilation says little about the original year or country
    various = release["_various"]
    return {
        "tags": _tags(release) + ([country] if country and not various else []),
        "year": None if various else _year(release.get("year")),
        "country": None if various else country,
        "url": url,
        "artist": ", ".join(str(a.get("name") or "") for a in release.get("artists") or []),
        "title": title,
    }


def suggest(artist: str, title: str) -> dict[str, Any]:
    """{tags (genre: styles, country:), year, country, url, artist, title} for a track; empty when off, unmatched or on any error (never raises)."""
    if not enabled():
        return _empty()
    try:
        _, names, title = lookup_query(artist, title)
        if not names[0] or not title:
            return _empty()
        hit = _empty()
        for name in names:
            key = (name.casefold(), title.casefold())
            with _cache_lock:
                hit = _cache.get(key)
            if hit is None:
                hit = _lookup(name, title)
                with _cache_lock:
                    _cache[key] = hit
            if hit["url"]:
                break
        return {**hit, "tags": list(hit["tags"])}
    except Exception as exc:
        log.warning("discogs lookup failed: %s", type(exc).__name__)
        return _empty()
