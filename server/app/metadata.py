"""Album, year and tag suggestions for the Add form's "Get metadata": yt-dlp sources, MusicBrainz and Wikidata merged."""

from __future__ import annotations

import logging
import threading
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any, Callable

from . import genre_lookup, library, wiki_lookup

log = logging.getLogger(__name__)

TIMEOUT = 15
CAPS = {"genre": 3, "country": 1}
DROPPED = {"lang"}


def _namespace(tag: str) -> str:
    return tag.partition(":")[0] if ":" in tag else ""


def cap_tags(tags: list[str]) -> list[str]:
    """Normalise and dedupe; drop `lang:` tags; keep at most 3 `genre:` and 1 `country:`."""
    used: dict[str, int] = {}
    out: list[str] = []
    for t in library.clean_tags(tags):
        ns = _namespace(t)
        if ns in DROPPED:
            continue
        if ns in CAPS:
            if used.get(ns, 0) >= CAPS[ns]:
                continue
            used[ns] = used.get(ns, 0) + 1
        out.append(t)
    return out


def _year(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 < value < 10000 else None


def merge(sources: list[dict[str, Any]], mb: dict[str, Any] | None, links: dict[str, Any] | None, guess: dict[str, Any] | None) -> dict[str, Any]:
    """Merge per-source results into {album, year, tags}.

    Precedence: tags yt-dlp sources, MusicBrainz, user-given wiki links, wiki guess (country: MusicBrainz first);
    year links, guess, MusicBrainz, sources; album sources, then MusicBrainz.
    """
    mb, links, guess = mb or {}, links or {}, guess or {}
    tags = [t for r in (*sources, mb, links, guess) for t in r.get("tags") or []]
    album = next((str(a).strip() for a in (*(s.get("album") for s in sources), mb.get("album")) if a and str(a).strip()), None)
    year = next((y for y in (_year(r.get("year")) for r in (links, guess, mb, *sources)) if y), None)
    return {"album": album, "year": year, "tags": cap_tags(tags)}


def _service_of(url: str) -> str | None:
    host = (urllib.parse.urlsplit(url.strip() if "//" in url else f"//{url.strip()}").hostname or "").lower()
    if "soundcloud" in host:
        return "soundcloud"
    if "youtu" in host:
        return "youtube"
    return None


def _useful(info: dict[str, Any]) -> bool:
    return bool(info.get("album") or _year(info.get("year")) or info.get("tags"))


def services(source_urls: list[str], src_by_index: dict[int, dict[str, Any]], links: dict[str, Any] | None, guess: dict[str, Any] | None) -> dict[str, Any]:
    """Per-service outcome for the UI's icons: {youtube, soundcloud, wikipedia, spotify: {found, url}}."""
    out: dict[str, Any] = {k: {"found": False, "url": None} for k in ("youtube", "soundcloud", "wikipedia", "spotify")}
    for i, url in enumerate(source_urls):
        svc = _service_of(url)
        if svc and not out[svc]["found"] and i in src_by_index and _useful(src_by_index[i]):
            out[svc] = {"found": True, "url": url.strip()}
    links, guess = links or {}, guess or {}
    links_hit = bool(links.get("tags") or links.get("year"))
    urls = [links.get("wikipedia_song") if links_hit else None, guess.get("wikipedia_song"), links.get("wikipedia_artist") if links_hit else None, guess.get("wikipedia_artist")]
    page = next((u for u in urls if u), None)
    if page or links_hit or guess.get("tags") or guess.get("year"):
        out["wikipedia"] = {"found": True, "url": page}
    return out


def gather(
    title: str,
    artist: str,
    source_fetchers: list[Callable[[], dict[str, Any]]],
    wiki_song: str | None = None,
    wiki_artist: str | None = None,
    timeout: float = TIMEOUT,
    source_urls: list[str] | None = None,
) -> dict[str, Any]:
    """Run every source concurrently under one overall timeout; a failing or late source is skipped.

    Returns {album, year, tags, services}; `services` only tells the UI which sources answered."""
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
    if wiki_song or wiki_artist:
        tasks.append(record("links", lambda: wiki_lookup.from_links(wiki_song, wiki_artist)))
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
    out["services"] = services(source_urls or [], by_index, snapshot.get("links"), snapshot.get("guess"))
    return out
