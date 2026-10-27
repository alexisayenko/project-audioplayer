"""Genre pills for the Add album wizard (task-0120, API-310): the genre names the client already knows from Discogs, the ones pasted from a Rate Your Music page and the Genre field of the English Wikipedia infobox, each mapped onto the closed genre vocabulary. Nothing is saved and nothing is scraped from Rate Your Music; failures never raise."""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any

from . import genre_filter, genre_lookup, wiki_lookup

log = logging.getLogger(__name__)

MAX_SUGGESTIONS = 24
MAX_NAME = 80
MAX_INPUT = 5000
BUDGET_S = 5.0
CACHE_MAX = 512
FOUND_TTL_S = 7 * 86400
MISSING_TTL_S = 3600
FAILED_TTL_S = 60
FAILED = "wikipedia_failed"
SOURCES = ("rym", "discogs", "wikipedia")

_LABEL = re.compile(r"^(?:(?:primary|secondary)\s+)?genres?\b\s*[:\-–]?\s*", re.I)
_SPLIT = re.compile(r"[,;\n\r•·|]+")
_URL = re.compile(r"https?://|www\.", re.I)
_LETTER = re.compile(r"[^\W\d_]")
_STOP = re.compile(r"^\s*(?:descriptors?|language|released|ranked|rating)\b", re.I)

_now = time.monotonic
_lock = threading.Lock()
_cache: OrderedDict[str, tuple[float, tuple[str | None, list[str], str | None]]] = OrderedDict()
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="album-genres")


def _text(value: Any) -> str:
    return value.strip()[:200] if isinstance(value, str) else ""


def _name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split()).strip(" .")
    if not text or len(text) > MAX_NAME or _URL.search(text) or not _LETTER.search(text):
        return None
    return text


def parse_rym(text: Any) -> list[str]:
    """Genre names from text pasted from a Rate Your Music page: separated by commas, semicolons or lines; a leading "Genres" label and anything from a "Descriptors" line on are dropped; junk (links, long text, no letters) is skipped."""
    if not isinstance(text, str):
        return []
    out: list[str] = []
    for line in text[:MAX_INPUT].splitlines():
        if _STOP.match(line):
            break
        for i, part in enumerate(_SPLIT.split(line)):
            name = _name(_LABEL.sub("", part.strip(), count=1) if i == 0 else part)
            if name:
                out.append(name)
    return out


def _names(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return [n for v in values[:100] if (n := _name(v))]


def _key(artist: str, title: str) -> str:
    return f"{genre_lookup._norm(artist)}\x00{genre_lookup._norm(title)}"


def _get(key: str) -> tuple[str | None, list[str], str | None] | None:
    with _lock:
        hit = _cache.get(key)
        if hit is None:
            return None
        if hit[0] <= _now():
            del _cache[key]
            return None
        _cache.move_to_end(key)
        return hit[1]


def _put(key: str, value: tuple[str | None, list[str], str | None]) -> None:
    ttl = FAILED_TTL_S if value[2] else FOUND_TTL_S if value[0] else MISSING_TTL_S
    with _lock:
        _cache[key] = (_now() + ttl, value)
        _cache.move_to_end(key)
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)


def _lookup(artist: str, title: str) -> tuple[str | None, list[str], str | None]:
    query = f"{title} {artist} album"
    page = wiki_lookup._find_article(query, title, ("album",), [artist])
    if page is None:
        wiki_lookup._search_raw(query)
        return None, [], None
    return page, wiki_lookup.infobox_genres(page), None


def _wikipedia(artist: str, title: str) -> tuple[str | None, list[str], str | None]:
    """(article link, infobox genres, error) from the English Wikipedia album article; cached by artist and title."""
    if not title:
        return None, [], None
    key = _key(artist, title)
    hit = _get(key)
    if hit is not None:
        return hit
    try:
        result = _pool.submit(_lookup, artist, title).result(timeout=BUDGET_S)
    except FutureTimeout:
        log.warning("album genre wikipedia lookup timed out")
        result = (None, [], FAILED)
    except Exception as exc:
        log.warning("album genre wikipedia lookup failed: %s", type(exc).__name__)
        result = (None, [], FAILED)
    _put(key, result)
    return result


def suggest(artist: Any, title: Any, year: Any = None, discogs: Any = None, rym: Any = None) -> dict[str, Any]:
    """{suggestions: [{name, source, mapped, unmapped}], wikipediaPage, searchError}: names from RYM text, Discogs and the Wikipedia infobox, mapped to the vocabulary, deduplicated (first source wins) and capped; unmapped names stay, flagged."""
    who, name = _text(artist), _text(title)
    page, wiki_names, error = _wikipedia(who, name)
    found: dict[str, dict[str, Any]] = {}
    for source, names in (("rym", parse_rym(rym)), ("discogs", _names(discogs)), ("wikipedia", wiki_names)):
        for n in names:
            mapped = genre_filter.vocabulary_name(n)
            ident = mapped or genre_lookup._norm(n)
            if ident and ident not in found:
                found[ident] = {"name": n,"source": source, "mapped": mapped, "unmapped": mapped is None}
    return {"suggestions": list(found.values())[:MAX_SUGGESTIONS], "wikipediaPage": page, "searchError": error}
