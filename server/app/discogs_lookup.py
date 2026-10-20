"""Genre, country and year suggestions from Discogs (optional: needs DISCOGS_TOKEN, a free personal access token).

Terms: suggestions only; no images, no stored dumps. Responses live only in the in-memory per-query cache."""

from __future__ import annotations

import difflib
import logging
import os
import re
import threading
from typing import Any

from . import countrycodes, genre_lookup, httpjson, timeutil
from .ratelimit import WindowLimiter
from .titles import lookup_query

log = logging.getLogger(__name__)

API = "https://api.discogs.com"
TIMEOUT = 8
MAX_PER_MINUTE = 50
MAX_WAIT = 15.0
MAX_GENRES = 4
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


def _failed() -> dict[str, Any]:
    return {**_empty(), "error": True}


def _acquire() -> None:
    """Global limiter: at most MAX_PER_MINUTE requests in any 60 s; waits briefly, else refuses."""
    _limiter.acquire()


def _get(path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
    headers = {"Accept": "application/vnd.discogs.v2.discogs+json"}
    if _token():
        headers["Authorization"] = f"Discogs token={_token()}"
    req = httpjson.build_request(f"{API}/{path}", params or None, headers=headers)
    _acquire()
    return httpjson.fetch(req, TIMEOUT)


_DISAMBIG = re.compile(r"\(\d+\)$")


def _name_of(artist: dict[str, Any]) -> str:
    return _DISAMBIG.sub("", str(artist["name"])).rstrip()


def _name(value: str) -> str:
    text = str(value or "")
    if m := _DISAMBIG.search(text):
        text = text[: m.start()].rstrip()
    return genre_lookup._norm(text)


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
    return timeutil.valid_year(year)


def rank(results: list[dict[str, Any]], artist: str) -> list[dict[str, Any]]:
    """Releases credited to `artist` (fuzzy), earliest year first, then "Various" compilations (earliest first); other artists are dropped."""
    direct, various = [], []
    for item in results:
        if item.get("type") not in (None, "release") or not item.get("id"):
            continue
        credited = _result_artist(item)
        if _similar(artist, credited):
            direct.append(item)
        elif _is_various(credited):
            various.append(item)
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


STYLE_NAMES = {"hardcore": "hardcore techno"}


def _tags(detail: dict[str, Any]) -> list[str]:
    genres = [STYLE_NAMES.get(g, g) for g in (str(s).strip().casefold() for s in detail.get("styles") or []) if g]
    if not genres:
        genres = [g.casefold() for g in map(str, detail.get("genres") or []) if g.strip() and "," not in g]
    return [f"genre:{s}" for s in dict.fromkeys(genres)][:MAX_GENRES]


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


def from_url(url: Any) -> dict[str, Any]:
    """The same shape as `suggest` for one exact Discogs master or release link (`from_link` true); needs no token. Only discogs.com master/release links with numeric ids are fetched; anything else, an unknown id or an error gives an empty result (`error` set on a failure; never raises)."""
    clean = clean_url(url)
    if not clean or not genre_lookup.enabled():
        return _empty()
    kind, ident = clean.rsplit("/", 2)[1:]
    key = ("link", clean)
    try:
        with _cache_lock:
            hit = _cache.get(key)
        if hit is None:
            detail = _get(f"{kind}s/{int(ident)}")
            country = _country_tag(detail.get("country")) if kind == "release" else None
            hit = {
                "tags": _tags(detail) + ([country] if country else []),
                "year": _year(detail.get("year")),
                "country": country,
                "url": clean,
                "artist": ", ".join(_name_of(a) for a in detail.get("artists") or [] if isinstance(a, dict) and a.get("name")),
                "title": str(detail.get("title") or ""),
                "from_link": True,
            }
            with _cache_lock:
                _cache[key] = hit
        return {**hit, "tags": list(hit["tags"])}
    except Exception as exc:
        log.warning("discogs link lookup failed: %s", type(exc).__name__)
        return _failed()


def suggest(artist: str, title: str) -> dict[str, Any]:
    """{tags (genre: tags from Discogs's styles, country:), year, country, url, artist, title} for a track; empty when off, unmatched or on any error (never raises)."""
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
        return _failed()
