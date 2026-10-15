"""Identify a downloaded song: audio fingerprint (AcoustID -> MusicBrainz), title-based MusicBrainz/Wikidata and Discogs, merged.

Everything here is a suggestion; nothing is written to the library. Results are cached in memory per song for 24 h."""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from collections.abc import Callable
from typing import Any

from . import acoustid_lookup, discogs_lookup, genre_filter, genre_lookup, library, timeutil, wiki_lookup
from .tags import namespace

log = logging.getLogger(__name__)

TTL = 24 * 3600
COOLDOWN = 20
MAX_ENTRIES = 500
CAPS = {"genre": 4, "country": 1, "lang": 2}

_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
_locks: dict[tuple[str, str], threading.Lock] = {}
_guard = threading.Lock()


def available() -> dict[str, bool]:
    return {"acoustid": acoustid_lookup.available(), "discogs": discogs_lookup.enabled()}


def configured() -> bool:
    return any(available().values())


def recall(uid: str, vid: str, max_age: float = TTL) -> dict[str, Any] | None:
    with _guard:
        hit = _cache.get((uid, vid))
    if hit is None or time.time() - hit[0] > max_age:
        return None
    return hit[1]


def remember(uid: str, vid: str, result: dict[str, Any]) -> None:
    with _guard:
        _cache[(uid, vid)] = (time.time(), result)
        while len(_cache) > MAX_ENTRIES:
            _cache.pop(next(iter(_cache)))


def forget(uid: str, vid: str) -> None:
    with _guard:
        _cache.pop((uid, vid), None)


def _of(tags: list[str], ns: str) -> list[str]:
    return [t for t in tags if namespace(t) == ns]


def _valid_year(value: Any) -> int | None:
    return timeutil.valid_year(value)


def merge_tags(mb: dict[str, Any], disc: dict[str, Any], wiki: dict[str, Any]) -> list[str]:
    """Suggested tags: at most 4 genre, 1 country, 2 lang, deduped and canonical.

    genre: Discogs styles first, then the song's own Wikidata genres, MusicBrainz, the artist's Wikidata genres;
    country: MusicBrainz, then Discogs, then Wikidata; lang: MusicBrainz release languages."""
    song_genres = [g if ":" in str(g) else f"genre:{g}" for g in wiki.get("song_genres") or []]
    mb_tags, disc_tags, wiki_tags = mb.get("tags") or [], disc.get("tags") or [], wiki.get("tags") or []
    genres = genre_filter.filter_tags([*_of(disc_tags, "genre"), *song_genres, *_of(mb_tags, "genre"), *_of(wiki_tags, "genre")])
    countries = [t for t in library.clean_tags([*_of(mb_tags, "country"), *_of(disc_tags, "country"), *_of(wiki_tags, "country")]) if not library.unknown_countries([t])]
    langs = library.clean_tags([f"lang:{c}" for c in mb.get("langs") or []])
    out: list[str] = []
    for ns, tags in (("genre", library.clean_tags(genres)), ("country", countries), ("lang", langs)):
        out.extend(tags[: CAPS[ns]])
    return out


def _links(mb: dict[str, Any], disc: dict[str, Any], wiki: dict[str, Any]) -> dict[str, str | None]:
    return {
        "musicbrainz": genre_lookup.clean_recording_url(mb.get("mb_url")),
        "discogs": discogs_lookup.clean_url(disc.get("url")),
        "wikipedia_song": wiki_lookup.clean_link(wiki.get("wikipedia_song")),
        "wikipedia_artist": wiki_lookup.clean_link(wiki.get("wikipedia_artist")),
        "wikipedia_album": wiki_lookup.clean_link(wiki.get("wikipedia_album")),
    }


def _safe(fn: Callable[..., dict[str, Any] | None], *args: Any) -> dict[str, Any]:
    try:
        return fn(*args) or {}
    except Exception as exc:
        log.warning("identify source %s failed: %s", getattr(fn, "__name__", "?"), type(exc).__name__)
        return {}


def _fingerprint(path: Path, artist: str, title: str) -> tuple[str, str, dict[str, Any] | None, dict[str, Any]]:
    hit = _safe(acoustid_lookup.identify, path, artist, title)
    if not hit.get("match"):
        return artist, title, None, {}
    mb = _safe(genre_lookup.lookup_recording, hit["match"]["mbid"])
    artist, title = mb.get("artist") or hit["match"]["artist"] or artist, mb.get("title") or hit["match"]["title"] or title
    matched = {"artist": artist, "title": title, "confidence": hit["match"]["confidence"], "source": "acoustid"}
    return artist, title, matched, mb


def _used(matched: Any, mb: dict[str, Any], wiki: dict[str, Any], disc: dict[str, Any]) -> list[str]:
    hits = (("acoustid", matched), ("musicbrainz", mb.get("mb_url")),
            ("wikidata", wiki.get("wikipedia_song") or wiki.get("wikipedia_artist") or wiki.get("wikipedia_album") or wiki.get("tags")),
            ("discogs", disc.get("url")))
    return [name for name, hit in hits if hit]


def run(song: dict[str, Any], path: Path | None) -> dict[str, Any]:
    """Identify one song from its audio file `path` and its own metadata; never raises."""
    avail = available()
    base: dict[str, Any] = {"status": "unavailable", "matched": None, "suggested_tags": [], "suggested_year": None,
                            "links": _links({}, {}, {}), "sources": [], "available": avail, "identified_at": library.now_utc()}
    if not any(avail.values()):
        return base
    artist, title = str(song.get("artist") or ""), str(song.get("title") or "")
    matched = None
    mb: dict[str, Any] = {}
    if avail["acoustid"] and path is not None:
        artist, title, matched, mb = _fingerprint(path, artist, title)
    if not matched and artist and title:
        # no fingerprint match: the title-based guess, as /preview does
        mb = _safe(genre_lookup.lookup, artist, title)
    wiki = _safe(wiki_lookup.suggest, artist, title, mb) if mb.get("mb_url") else {}
    disc = _safe(discogs_lookup.suggest, artist, title) if avail["discogs"] else {}
    tags = merge_tags(mb, disc, wiki)
    year = next((y for y in map(_valid_year, (wiki.get("year"), mb.get("year"), disc.get("year"))) if y), None)
    links = _links(mb, disc, wiki)
    found = bool(matched or tags or year or any(links.values()))
    return {**base, "status": "ok" if found else "no_match", "matched": matched, "suggested_tags": tags,
            "suggested_year": year, "links": links, "sources": _used(matched, mb, wiki, disc)}


def run_cached(uid: str, vid: str, song: dict[str, Any], path: Path | None, refresh: bool = True) -> dict[str, Any]:
    """`run`, remembered; a repeat inside COOLDOWN seconds (or any repeat when `refresh` is false) reuses the last result."""
    with _guard:
        lock = _locks.setdefault((uid, vid), threading.Lock())
    with lock:
        last = recall(uid, vid, COOLDOWN if refresh else TTL)
        if last is not None:
            return last
        result = run(song, path)
        if result["status"] != "unavailable":
            remember(uid, vid, result)
        return result
