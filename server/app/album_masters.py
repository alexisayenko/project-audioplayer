"""One Discogs row per album for the Add album picker (task-0120, API-301, API-309): the master (the canonical album) instead of every pressing, a deduplicated release when an album has no master, and the full release list on request."""

from __future__ import annotations

import logging
import os
import threading
from collections import OrderedDict
from typing import Any

from fastapi import HTTPException

from . import album_youtube, albums, discogs_lookup, timeutil

log = logging.getLogger(__name__)

MAX_MASTERS = 6
MIN_MASTER_SCORE = 0.4
CACHE_SIZE = 200

_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
_lock = threading.Lock()


def _cached(path: str) -> dict[str, Any]:
    with _lock:
        hit = _cache.get(path)
        if hit is not None:
            _cache.move_to_end(path)
            return hit
    data = albums._fetch(path)
    with _lock:
        _cache[path] = data
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return data


def _split(item: dict[str, Any]) -> tuple[str, str]:
    head, _, tail = str(item.get("title") or "").partition(" - ")
    return (head if tail else ""), (tail or head)


def _https(value: Any) -> str | None:
    text = str(value or "").strip()
    return text if text.startswith("https://") else None


def _positive(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _styles(*sources: Any) -> list[str]:
    out: list[str] = []
    for value in sources:
        for text in album_youtube._texts(value):
            if text.casefold() not in {o.casefold() for o in out}:
                out.append(text[:80])
    return out[: album_youtube.MAX_SUGGESTED_GENRES]


def _row(ident: int, who: str, title: str, year: Any, tracks: list[dict[str, Any]] | None, cover: str | None, genres: list[str], styles: list[str], main: Any, kind_type: str | None) -> dict[str, Any]:
    url = f"https://www.discogs.com/master/{ident}"
    return {
        "id": ident, "url": url, "links": {"discogs": url}, "masterId": ident, "releaseId": _positive(main), "styles": styles, "title": title, "artist": discogs_lookup._DISAMBIG.sub("", who).rstrip(),
        "year": timeutil.valid_year(album_youtube._year_of(year)), "country": None, "label": None, "trackCount": len(tracks) if tracks is not None else None,
        "cover": cover, "genres": genres[: album_youtube.MAX_SUGGESTED_GENRES], "type": kind_type, "kind": "master",
        "mainRelease": _positive(main),
    }


def _master(item: dict[str, Any], artist: str, album: str) -> dict[str, Any]:
    """A master row from a search hit plus its one detail call (cached); a failed detail call leaves the hit's own data."""
    ident = int(item["id"])
    who, title = _split(item)
    year, tracks, main = item.get("year"), None, None
    cover = _https(item.get("cover_image")) or _https(item.get("thumb"))
    genres = albums._genres({"genres": [*album_youtube._texts(item.get("style")), *album_youtube._texts(item.get("genre"))]})
    styles = _styles(item.get("style"))
    try:
        detail = _cached(f"masters/{ident}")
        tracks = albums._flat_tracks(detail)
        title = str(detail.get("title") or title)
        who = albums._artists(detail) or who
        year = detail.get("year") or year
        cover = album_youtube._best_image(detail) or cover
        genres = albums._genres({"genres": [*(detail.get("styles") or []), *(detail.get("genres") or [])]}) or genres
        styles = _styles(detail.get("styles")) or styles
        main = detail.get("main_release")
    except Exception:
        pass
    row = _row(ident, who, title, year, tracks, cover, genres, styles, main, None)
    row["score"] = album_youtube._score(album, artist, None, None, title, who, None)
    return row


def _masters(artist: str, album: str) -> list[dict[str, Any]]:
    params = {"type": "master", "per_page": "20", **({"artist": artist} if artist else {}), **({"release_title": album} if album else {})}
    seen: set[int] = set()
    hits = []
    for item in album_youtube._search_results(params):
        ident = item.get("id") if isinstance(item, dict) else None
        if isinstance(ident, int) and ident not in seen and item.get("type") == "master":
            seen.add(ident)
            who, title = _split(item)
            hits.append((album_youtube._score(album, artist, None, None, title, who, None), item))
    hits.sort(key=lambda h: (-h[0], h[1]["id"]))
    rows = [_master(item, artist, album) for score, item in hits[:MAX_MASTERS] if score >= MIN_MASTER_SCORE]
    return [r for r in rows if r["score"] >= MIN_MASTER_SCORE]


def _richness(item: dict[str, Any]) -> int:
    return sum(1 for key in ("thumb", "format", "label", "country", "catno") if item.get(key))


def _earliest(item: dict[str, Any]) -> tuple[int, int, int]:
    return (album_youtube._year_of(item.get("year")) or 9999, -_richness(item), item["id"])


def _single_releases(artist: str, album: str, skip_masters: set[int]) -> list[dict[str, Any]]:
    """Releases without a master, one per normalised artist and title: the earliest year, then the richest data."""
    params = {"type": "release", "per_page": "20", **({"artist": artist} if artist else {}), **({"release_title": album} if album else {})}
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for item in album_youtube._release_picks(album_youtube._search_results(params)):
        if item.get("master_id") in skip_masters:
            continue
        who, title = _split(item)
        groups.setdefault((discogs_lookup._name(who), discogs_lookup._name(title)), []).append(item)
    reps = [min(group, key=_earliest) for group in groups.values()]
    reps.sort(key=lambda it: (-album_youtube._score(album, artist, None, None, _split(it)[1], _split(it)[0], None), it["id"]))
    return [album_youtube._candidate(item, artist, album, None, None) for item in reps[: album_youtube.MAX_CANDIDATES]]


def _error(exc: HTTPException) -> str:
    return exc.detail if exc.detail in ("discogs_unavailable", "discogs_failed") else "discogs_failed"


def find(artist: Any, title: Any, year: Any = None, show_all: bool = False) -> dict[str, Any]:
    """{candidates, searchError} for an artist and album title: one master row per album (best match first), plus one deduplicated release per album that has no master when no master matches well; `show_all` lists every release as before. Failures give an empty list and a code, never an error."""
    if show_all:
        return album_youtube.find_releases(artist, title, year)
    who, name = str(artist or "").strip(), str(title or "").strip()
    if not os.environ.get("DISCOGS_TOKEN", "").strip():
        return {"candidates": [], "searchError": "discogs_unavailable"}
    if not who and not name:
        return {"candidates": [], "searchError": None}
    wanted = timeutil.valid_year(year) if isinstance(year, int) and not isinstance(year, bool) else None
    try:
        masters = _masters(who, name)
    except HTTPException as exc:
        return {"candidates": [], "searchError": _error(exc)}
    releases: list[dict[str, Any]] = []
    error = None
    if not any(m["score"] >= album_youtube.BEST_MIN_SCORE for m in masters):
        try:
            releases = _single_releases(who, name, {m["id"] for m in masters})
        except HTTPException as exc:
            error = None if masters else _error(exc)
    masters.sort(key=lambda c: (c["year"] != wanted if wanted else False, -c["score"], c["id"]))
    releases.sort(key=lambda c: (c["year"] != wanted if wanted else False, -c["score"], c["discogsId"]))
    out = [{k: v for k, v in m.items() if k != "score"} for m in masters] + album_youtube.public_candidates(releases)
    return {"candidates": out, "searchError": error if not out else None}


def _formats(detail: dict[str, Any]) -> list[Any]:
    return [d for f in detail.get("formats") or [] if isinstance(f, dict) for d in [*(f.get("descriptions") or []), f.get("name")]]


def _with_lengths(first: list[dict[str, Any]], second: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The master tracklist, unless it has no lengths and the main release's has some (masters often list titles only)."""
    if first and (any(t["durationS"] for t in first) or not any(t["durationS"] for t in second)):
        return first
    return second or first


def _fail(exc: albums.AlbumError) -> dict[str, Any]:
    code = exc.code if exc.code in ("discogs_unavailable", "not_found") else "discogs_failed"
    return {"candidate": None, "searchError": "discogs_not_found" if code == "not_found" else code}


def _resolve_release(ident: int) -> dict[str, Any]:
    detail = _cached(f"releases/{ident}")
    url = f"https://www.discogs.com/release/{ident}"
    labels = [str(lb.get("name") or "").strip() for lb in detail.get("labels") or [] if isinstance(lb, dict)]
    master = _positive(detail.get("master_id"))
    row = {
        "id": ident, "url": url, "links": {"discogs": url}, "masterId": master, "releaseId": ident, "styles": _styles(detail.get("styles")),
        "title": str(detail.get("title") or ""), "artist": discogs_lookup._DISAMBIG.sub("", albums._artists(detail)).rstrip(), "year": timeutil.valid_year(album_youtube._year_of(detail.get("year"))),
        "country": album_youtube._text(detail.get("country")), "label": next((lb for lb in labels if lb), None), "tracks": albums._flat_tracks(detail),
        "cover": album_youtube._best_image(detail), "genres": albums._genres({"genres": [*(detail.get("styles") or []), *(detail.get("genres") or [])]})[: album_youtube.MAX_SUGGESTED_GENRES],
        "type": album_youtube.format_type(_formats(detail)), "kind": "release",
    }
    row["trackCount"] = len(row["tracks"])
    return row


def resolve(kind: Any, ident: Any) -> dict[str, Any]:
    """{candidate, searchError} for one picked master or release, with `tracks` [{no, title, durationS}] (a master takes the main release's tracklist when only that has lengths) and the album type read from the formats; a master costs at most two Discogs calls (`masters/<id>`, `releases/<main>`), a release one, all cached; a failure gives candidate None and a code."""
    if kind not in ("master", "release") or not isinstance(ident, int) or isinstance(ident, bool) or ident <= 0:
        raise HTTPException(status_code=422, detail="bad_pick")
    if not os.environ.get("DISCOGS_TOKEN", "").strip():
        return {"candidate": None, "searchError": "discogs_unavailable"}
    try:
        if kind == "release":
            return {"candidate": _resolve_release(ident), "searchError": None}
        detail = _cached(f"masters/{ident}")
    except albums.AlbumError as exc:
        return _fail(exc)
    main = detail.get("main_release")
    release: dict[str, Any] = {}
    if _positive(main):
        try:
            release = _cached(f"releases/{main}")
        except Exception as exc:
            log.warning("discogs main release failed: %s", type(exc).__name__)
    tracks = _with_lengths(albums._flat_tracks(detail), albums._flat_tracks(release))
    genres = albums._genres({"genres": [*(detail.get("styles") or []), *(detail.get("genres") or [])]}) or albums._genres({"genres": [*(release.get("styles") or []), *(release.get("genres") or [])]})
    row = _row(ident, albums._artists(detail) or albums._artists(release), str(detail.get("title") or release.get("title") or ""), detail.get("year") or release.get("year"), tracks,
               album_youtube._best_image(detail) or album_youtube._best_image(release), genres, _styles(detail.get("styles")) or _styles(release.get("styles")), main, album_youtube.format_type(_formats(release)))
    row["tracks"] = tracks
    return {"candidate": row, "searchError": None}
