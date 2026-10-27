"""Suggested links for an album (task-0120, API-304): the Discogs master (else release) and the English Wikipedia article that match an album artist and title; used by the "Suggest links" button of the album popups. Nothing is saved."""

from __future__ import annotations

import logging
import os
import re
from typing import Any

from . import album_youtube, discogs_lookup, timeutil, wiki_lookup

log = logging.getLogger(__name__)
_PAREN = re.compile(r"^(?P<base>.*?)(?: \((?P<paren>[^()]*)\))?$")
_KIND = re.compile(r"(?:^|\s)(?:album|ep|soundtrack|mixtape|compilation|score)$", re.I)
_YEAR_SLACK = 1


def _text(value: Any) -> str:
    return value.strip()[:200] if isinstance(value, str) else ""


def _same_artist(a: str, b: str) -> bool:
    x, y = discogs_lookup._name(a), discogs_lookup._name(b)
    return bool(x and y and (x == y or x in y or y in x))


def _discogs(artist: str, title: str, year: int | None) -> tuple[str | None, list[dict[str, Any]], str | None]:
    if not os.environ.get("DISCOGS_TOKEN", "").strip():
        return None, [], "discogs_unavailable"
    hint = {"artist": artist, "album": title, "year": year, "type": "album"}
    matched = album_youtube.auto_match(hint, 0) if artist and title else None
    if matched:
        return matched["url"], [], None
    found = album_youtube.find_releases(artist, title, year)
    candidates = found["candidates"]
    for c in candidates:
        same = discogs_lookup._name(c["artist"]) == discogs_lookup._name(artist) and discogs_lookup._name(c["title"]) == discogs_lookup._name(title)
        close = not year or not c["year"] or abs(c["year"] - year) <= _YEAR_SLACK
        if same and close:
            return c["url"], [], None
    return None, candidates[:5], found["searchError"]


def _accepted(page: str, artist: str, title: str) -> bool:
    """A search hit is the album article: its name is the title, bare or disambiguated by "(album)" or "(Artist album)"; a bare title must also name the artist in its infobox."""
    m = _PAREN.match(page)
    base, paren = (m.group("base"), m.group("paren")) if m else (page, None)
    if discogs_lookup._name(base) != discogs_lookup._name(title):
        return False
    if paren is not None:
        kind = _KIND.search(paren)
        if not kind:
            return False
        who = paren[: kind.start()].strip()
        return not who or _same_artist(who, artist)
    box = wiki_lookup.infobox(wiki_lookup._article_url(page))
    return bool(box.get("artist")) and _same_artist(str(box["artist"]), artist)


def _wikipedia(artist: str, title: str) -> str | None:
    if not title:
        return None
    try:
        for page in wiki_lookup._search(f"{title} {artist} album".strip()):
            if _accepted(page, artist, title):
                return wiki_lookup._article_url(page)
    except Exception as exc:
        log.warning("album wikipedia lookup failed: %s", type(exc).__name__)
    return None


def suggest(artist: Any, title: Any, year: Any = None) -> dict[str, Any]:
    """{discogs, wikipedia, candidates, searchError}: each link is a confident match or None; `candidates` are the Discogs releases to choose from when none matched; failures never raise."""
    who, name = _text(artist), _text(title)
    when = timeutil.valid_year(year) if isinstance(year, int) and not isinstance(year, bool) else None
    try:
        link, candidates, error = _discogs(who, name, when)
    except Exception as exc:
        log.warning("album discogs lookup failed: %s", type(exc).__name__)
        link, candidates, error = None, [], "discogs_failed"
    return {"discogs": link, "wikipedia": _wikipedia(who, name), "candidates": candidates, "searchError": error}
