"""Album, year and tag suggestions for the Add form's "Get metadata": yt-dlp sources, MusicBrainz and Wikidata merged."""

from __future__ import annotations

import logging
import re
import threading
import unicodedata
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any, Callable

from . import discogs_lookup, genre_filter, genre_lookup, library, timeutil, wiki_lookup
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


SAME_RECORDING = ("remaster", "extended", "instrumental")
_VERSION_WORD = re.compile(r"\b(?:remix|mix|edit|bootleg|mashup|rework|vip|dub|cover|version)\b", re.I)
_BRACKET = re.compile(r"[(\[]([^()\[\]]*)[)\]]")


def is_versioned(version_kind: str | None) -> bool:
    """A version of kind remix, edit, live, cover, mashup, acoustic or other is a different recording: the original's genres are not applied to it (TAG-088). Remaster, extended and instrumental are the same recording."""
    return bool(version_kind) and version_kind not in SAME_RECORDING


def _fold(text: str) -> str:
    plain = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return " ".join(re.sub(r"\W+", " ", plain.casefold()).split())


def artist_is_remixer(artist: str, title: str, remixer: str | None) -> bool:
    """True when `artist` is credited in the remix text (the remixer text, or a bracket of the title with a version word): such an artist is the maker of the version, not the main artist, so its Wikipedia page is not the song's artist link (TAG-096)."""
    name = _fold(artist)
    if not name:
        return False
    texts = [remixer or "", *(m.group(1) for m in _BRACKET.finditer(title or "") if _VERSION_WORD.search(m.group(1)))]
    return any(re.search(rf"(?<!\w){re.escape(name)}(?!\w)", _fold(t)) for t in texts)


def split_for_version(own: list[str], lookup: list[str], song_genres: list[str] | None = None) -> tuple[list[str], list[str]]:
    """(tags, original_genres) for a version: only `own` genres (yt-dlp, SoundCloud, YouTube) and the non-genre lookup tags (country, decade) are applied; the genres the lookups found for the original recording are returned separately as `genre:` tags, never applied (TAG-088, TAG-090)."""
    kept = [t for t in lookup if namespace(t) != "genre"]
    tags = finalize_tags([*own, *kept])
    original = [t for t in finalize_tags(lookup, song_genres) if namespace(t) == "genre" and t not in tags]
    return tags, original


def _year(value: Any) -> int | None:
    return timeutil.valid_year(value)


def merge(sources: list[dict[str, Any]], mb: dict[str, Any] | None, links: dict[str, Any] | None, guess: dict[str, Any] | None, disc: dict[str, Any] | None = None, versioned: bool = False) -> dict[str, Any]:
    """Merge per-source results into {album, year, published_year, remix_year, version_year, tags, original_genres}.

    With `versioned` the tags hold only the sources' own genres (yt-dlp, SoundCloud, YouTube) and the non-genre lookup tags; the genres of the lookups, which describe the original recording, go to `original_genres` and are never applied (TAG-088, TAG-090).

    Precedence: tags the song's own Wikidata genres (all, links else guess), yt-dlp sources, MusicBrainz, user-given wiki links, wiki guess (country: MusicBrainz first);
    year (DATA-126) links, song-page infobox, guess, MusicBrainz, Discogs, never a yt-dlp year; album sources, song-page infobox, then MusicBrainz.
    """
    mb, links, guess, disc = mb or {}, links or {}, guess or {}, disc or {}
    yt = [t for s in sources for t in s.get("youtube_genres") or []]
    song_genres = links.get("song_genres") or guess.get("song_genres")
    own = [t for s in sources for t in s.get("tags") or []]
    disc_tags = disc.get("tags") or []
    lookup = [
        *(t for t in disc_tags if namespace(t) == "genre"),
        *(t for r in (mb, links, guess) for t in r.get("tags") or []),
        *(t for t in disc_tags if namespace(t) != "genre"),
    ]
    original: list[str] = []
    if versioned:
        tags, original = split_for_version([*own, *yt], lookup, song_genres)
    else:
        tags = finalize_tags([*own, *lookup, *yt], song_genres)
    box_album = links.get("infobox_album") or guess.get("infobox_album")
    box_year = links.get("infobox_year") or guess.get("infobox_year")
    albums = (*(s.get("album") for s in sources), box_album, mb.get("album"))
    album = next((str(a).strip() for a in albums if a and str(a).strip()), None)
    years = (links.get("year"), box_year, guess.get("year"), mb.get("year"), disc.get("year"))
    year = next((y for y in map(_year, years) if y), None)
    published = next((y for y in (_year(s.get("published_year")) for s in sources) if y), None)
    version_year = _year(mb.get("remix_year"))
    return {"album": album, "year": year, "published_year": published, "remix_year": version_year, "version_year": version_year, "tags": tags, "original_genres": original}


def _service_of(url: str) -> str | None:
    host = (urllib.parse.urlsplit(url.strip() if "//" in url else f"//{url.strip()}").hostname or "").lower()
    if "soundcloud" in host:
        return "soundcloud"
    if "youtu" in host:
        return "youtube"
    return None


def _useful(info: dict[str, Any]) -> bool:
    return bool(info.get("album") or _year(info.get("year")) or info.get("tags"))


def _mark_sources(out: dict[str, Any], source_urls: list[str], src_by_index: dict[int, dict[str, Any]]) -> None:
    for i, url in enumerate(source_urls):
        svc = _service_of(url)
        if svc and not out[svc]["found"] and i in src_by_index and _useful(src_by_index[i]):
            out[svc] = {"found": True, "url": url.strip()}


def _has_infobox_or_tags(info: dict[str, Any]) -> bool:
    return bool(info.get("tags") or info.get("year") or info.get("infobox_album") or info.get("infobox_year"))


def _wikipedia_service(links: dict[str, Any], guess: dict[str, Any]) -> dict[str, Any] | None:
    links_hit = _has_infobox_or_tags(links)
    urls = [links.get("wikipedia_song") if links_hit else None, guess.get("wikipedia_song"), links.get("wikipedia_artist") if links_hit else None, guess.get("wikipedia_artist")]
    page = next((u for u in urls if u), None)
    if page or links_hit or _has_infobox_or_tags(guess):
        return {"found": True, "url": page}
    return None


def services(source_urls: list[str], src_by_index: dict[int, dict[str, Any]], links: dict[str, Any] | None, guess: dict[str, Any] | None, mb: dict[str, Any] | None = None, disc: dict[str, Any] | None = None, disc_skipped: str | None = None) -> dict[str, Any]:
    """Per-service outcome for the UI's icons: {youtube, soundcloud, wikipedia, spotify, musicbrainz, discogs: {found, url}}; discogs adds `from_link` when the given link was used and, when not found, `skipped` (not_configured, no_match or error)."""
    out: dict[str, Any] = {k: {"found": False, "url": None} for k in ("youtube", "soundcloud", "wikipedia", "spotify", "musicbrainz", "discogs")}
    _mark_sources(out, source_urls, src_by_index)
    wiki = _wikipedia_service(links or {}, guess or {})
    if wiki:
        out["wikipedia"] = wiki
    mb_url = (mb or {}).get("mb_url")
    if mb_url:
        out["musicbrainz"] = {"found": True, "url": mb_url}
    disc_url = (disc or {}).get("url")
    if disc_url:
        out["discogs"] = {"found": True, "url": disc_url, **({"from_link": True} if (disc or {}).get("from_link") else {})}
    elif disc_skipped:
        out["discogs"]["skipped"] = disc_skipped
    return out


def _recorder(lock: threading.Lock, found: dict[str, Any], src_results: dict[int, dict[str, Any]]) -> Callable[[str, Callable[[], Any]], Callable[[], None]]:
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

    return record


def _run_all(tasks: list[Callable[[], None]], timeout: float) -> None:
    if not tasks:
        return
    pool = ThreadPoolExecutor(max_workers=len(tasks))
    try:
        wait([pool.submit(t) for t in tasks], timeout=timeout)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _discogs_task(link: str | None, artist: str, title: str) -> Callable[[], dict[str, Any]]:
    def run() -> dict[str, Any]:
        failed = False
        if link:
            hit = discogs_lookup.from_url(link)
            if hit.get("url") or not (artist and title):
                return hit
            failed = bool(hit.get("error"))
        found = discogs_lookup.suggest(artist, title)
        return {**found, "error": True} if failed and not found.get("url") else found

    return run


def _discogs_skipped(disc: dict[str, Any] | None, link: str | None) -> str | None:
    if not discogs_lookup.enabled() and not (link and genre_lookup.enabled()):
        return "not_configured"
    return "error" if disc is None or disc.get("error") else "no_match"


def _assemble(sources: list[dict[str, Any]], snapshot: dict[str, Any], by_index: dict[int, dict[str, Any]], source_urls: list[str], link: str | None, attempt_disc: bool, version_kind: str | None) -> dict[str, Any]:
    out = merge(sources, snapshot.get("mb"), snapshot.get("links"), snapshot.get("guess"), snapshot.get("disc"), versioned=is_versioned(version_kind))
    box = (snapshot.get("links") or {}).get("infobox_suggest") or (snapshot.get("guess") or {}).get("infobox_suggest")
    for key in ("wikipedia_song", "wikipedia_artist", "wikipedia_album"):
        out[key] = (snapshot.get("links") or {}).get(key) or (snapshot.get("guess") or {}).get(key)
    out["suggest"] = {"artist": box["artist"], "title": box["title"]} if box else {"artist": None, "title": None}
    out["services"] = services(source_urls, by_index, snapshot.get("links"), snapshot.get("guess"), snapshot.get("mb"), snapshot.get("disc"), _discogs_skipped(snapshot.get("disc"), link) if attempt_disc else None)
    if version_kind:
        out["services"]["musicbrainz"] = {"found": False, "url": None}
        out["services"]["discogs"] = {"found": False, "url": None}
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
    version_kind: str | None = None,
    discogs_url: str | None = None,
) -> dict[str, Any]:
    """Run every source concurrently under one overall timeout; a failing or late source is skipped.

    Returns {album, year, version_year, tags, wikipedia_song, wikipedia_artist, wikipedia_album, suggest, services}; `suggest` is the song infobox's artist and title hint (never auto-filled); `services` only tells the UI which sources answered.
    `discogs_url` (a Discogs master or release link) is looked up instead of searching; the search runs only when it gives nothing.
    `title` and `artist` name the original work; with a `version_kind` the MusicBrainz and Discogs links are withheld, they would point at the original (DATA-126)."""
    lock = threading.Lock()
    found: dict[str, Any] = {}
    src_results: dict[int, dict[str, Any]] = {}
    record = _recorder(lock, found, src_results)

    tasks = [record(f"src{i}", f) for i, f in enumerate(source_fetchers)]
    link = discogs_lookup.clean_url(discogs_url)
    attempt_disc = bool(link or (artist and title))
    if artist and title:
        tasks.extend([
            record("mb", lambda: genre_lookup.lookup(artist, title)),
            record("guess", lambda: wiki_lookup.suggest(artist, title)),
        ])
    if attempt_disc:
        tasks.append(record("disc", _discogs_task(link, artist, title)))
    if wiki_song or wiki_artist or wiki_album:
        tasks.append(record("links", lambda: wiki_lookup.from_links(wiki_song, wiki_artist, wiki_album)))
    _run_all(tasks, timeout)
    with lock:
        sources = [src_results[i] for i in sorted(src_results)]
        snapshot = dict(found)
        by_index = dict(src_results)
    return _assemble(sources, snapshot, by_index, source_urls or [], link, attempt_disc, version_kind)
