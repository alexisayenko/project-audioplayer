"""Album, year and tag suggestions for the Add form's "Get metadata": yt-dlp sources, MusicBrainz and Wikidata merged."""

from __future__ import annotations

import logging
import threading
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any, Callable

from . import genre_filter, genre_lookup, library, timeutil, wiki_lookup
from .tags import namespace

log = logging.getLogger(__name__)

TIMEOUT = 15
CAPS = {"genre": 8, "country": 1}
DROPPED = {"lang"}


def cap_tags(tags: list[str], priority_genres: int = 0) -> list[str]:
    """Normalise and dedupe; drop `lang:` tags; keep at most 8 `genre:` and 1 `country:`.

    The first `priority_genres` distinct genres are always kept (they may exceed the cap)."""
    used: dict[str, int] = {}
    out: list[str] = []
    for t in library.clean_tags(tags):
        ns = namespace(t)
        if ns in DROPPED:
            continue
        if ns == "country" and library.unknown_countries([t]):
            continue
        if ns in CAPS:
            n = used.get(ns, 0)
            if n >= CAPS[ns] and not (ns == "genre" and n < priority_genres):
                continue
            used[ns] = n + 1
        out.append(t)
    return out


def finalize_tags(tags: list[str], song_genres: list[str] | None = None) -> list[str]:
    """The one rule for suggested tags (/metadata, /preview, /lookup/wikipedia): the song's own genres first, non-genre `genre:` tags filtered, `lang:` dropped, 8 genres and 1 country."""
    song = genre_filter.filter_tags([f"genre:{g}" if ":" not in str(g) else str(g) for g in song_genres or []])
    merged = genre_filter.filter_tags([*song, *tags])
    return cap_tags(merged, len(library.clean_tags(song)))


def _year(value: Any) -> int | None:
    return timeutil.valid_year(value)


def merge(sources: list[dict[str, Any]], mb: dict[str, Any] | None, links: dict[str, Any] | None, guess: dict[str, Any] | None) -> dict[str, Any]:
    """Merge per-source results into {album, year, tags}.

    Precedence: tags the song's own Wikidata genres (all, links else guess), yt-dlp sources, MusicBrainz, user-given wiki links, wiki guess (country: MusicBrainz first);
    year links, song-page infobox, guess, MusicBrainz, sources; album sources, song-page infobox, then MusicBrainz.
    """
    mb, links, guess = mb or {}, links or {}, guess or {}
    tags = finalize_tags([t for r in (*sources, mb, links, guess) for t in r.get("tags") or []], links.get("song_genres") or guess.get("song_genres"))
    box_album = links.get("infobox_album") or guess.get("infobox_album")
    box_year = links.get("infobox_year") or guess.get("infobox_year")
    albums = (*(s.get("album") for s in sources), box_album, mb.get("album"))
    album = next((str(a).strip() for a in albums if a and str(a).strip()), None)
    years = (links.get("year"), box_year, guess.get("year"), mb.get("year"), *(s.get("year") for s in sources))
    year = next((y for y in map(_year, years) if y), None)
    published = next((y for y in (_year(s.get("published_year")) for s in sources) if y), None)
    return {"album": album, "year": year, "published_year": published, "remix_year": _year(mb.get("remix_year")), "tags": tags}


def _service_of(url: str) -> str | None:
    host = (urllib.parse.urlsplit(url.strip() if "//" in url else f"//{url.strip()}").hostname or "").lower()
    if "soundcloud" in host:
        return "soundcloud"
    if "youtu" in host:
        return "youtube"
    return None


def _useful(info: dict[str, Any]) -> bool:
    return bool(info.get("album") or _year(info.get("year")) or info.get("tags"))


def services(source_urls: list[str], src_by_index: dict[int, dict[str, Any]], links: dict[str, Any] | None, guess: dict[str, Any] | None, mb: dict[str, Any] | None = None) -> dict[str, Any]:
    """Per-service outcome for the UI's icons: {youtube, soundcloud, wikipedia, spotify, musicbrainz, discogs: {found, url}}."""
    out: dict[str, Any] = {k: {"found": False, "url": None} for k in ("youtube", "soundcloud", "wikipedia", "spotify", "musicbrainz", "discogs")}
    for i, url in enumerate(source_urls):
        svc = _service_of(url)
        if svc and not out[svc]["found"] and i in src_by_index and _useful(src_by_index[i]):
            out[svc] = {"found": True, "url": url.strip()}
    links, guess = links or {}, guess or {}
    links_hit = bool(links.get("tags") or links.get("year") or links.get("infobox_album") or links.get("infobox_year"))
    urls = [links.get("wikipedia_song") if links_hit else None, guess.get("wikipedia_song"), links.get("wikipedia_artist") if links_hit else None, guess.get("wikipedia_artist")]
    page = next((u for u in urls if u), None)
    if page or links_hit or guess.get("tags") or guess.get("year") or guess.get("infobox_album") or guess.get("infobox_year"):
        out["wikipedia"] = {"found": True, "url": page}
    mb_url = (mb or {}).get("mb_url")
    if mb_url:
        out["musicbrainz"] = {"found": True, "url": mb_url}
    return out


def gather(
    title: str,
    artist: str,
    source_fetchers: list[Callable[[], dict[str, Any]]],
    wiki_song: str | None = None,
    wiki_artist: str | None = None,
    timeout: float = TIMEOUT,
    source_urls: list[str] | None = None,
    wiki_album: str | None = None,
) -> dict[str, Any]:
    """Run every source concurrently under one overall timeout; a failing or late source is skipped.

    Returns {album, year, tags, wikipedia_song, wikipedia_artist, wikipedia_album, suggest, services}; `suggest` is the song infobox's artist and title hint (never auto-filled); `services` only tells the UI which sources answered."""
    lock = threading.Lock()
    found: dict[str, Any] = {}
    src_results: dict[int, dict[str, Any]] = {}

    def record(key: str, fn: Callable[[], Any]) -> Callable[[], None]:
        def run() -> None:
            try:
                value = fn()
            except Exception as exc:
                log.warning("metadata source %s failed: %s", key, exc)
                return
            with lock:
                if key.startswith("src"):
                    src_results[int(key[3:])] = value
                else:
                    found[key] = value

        return run

    tasks = [record(f"src{i}", f) for i, f in enumerate(source_fetchers)]
    if artist and title:
        tasks.append(record("mb", lambda: genre_lookup.lookup(artist, title)))
        tasks.append(record("guess", lambda: wiki_lookup.suggest(artist, title)))
    if wiki_song or wiki_artist or wiki_album:
        tasks.append(record("links", lambda: wiki_lookup.from_links(wiki_song, wiki_artist, wiki_album)))
    if tasks:
        pool = ThreadPoolExecutor(max_workers=len(tasks))
        try:
            wait([pool.submit(t) for t in tasks], timeout=timeout)
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
    with lock:
        sources = [src_results[i] for i in sorted(src_results)]
        snapshot = dict(found)
        by_index = dict(src_results)
    out = merge(sources, snapshot.get("mb"), snapshot.get("links"), snapshot.get("guess"))
    box = (snapshot.get("links") or {}).get("infobox_suggest") or (snapshot.get("guess") or {}).get("infobox_suggest")
    for key in ("wikipedia_song", "wikipedia_artist", "wikipedia_album"):
        out[key] = (snapshot.get("links") or {}).get(key) or (snapshot.get("guess") or {}).get(key)
    out["suggest"] = {"artist": box["artist"], "title": box["title"]} if box else {"artist": None, "title": None}
    out["services"] = services(source_urls or [], by_index, snapshot.get("links"), snapshot.get("guess"), snapshot.get("mb"))
    return out
