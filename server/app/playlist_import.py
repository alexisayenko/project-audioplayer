"""Import of a YouTube playlist into the catalog: a flat listing, per-video details on request, and the duplicate and length marks. YouTube data only (ADD-150..ADD-158)."""

from __future__ import annotations

import os
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any

from . import credits, credits_v1, extractor, metadata, previewcache, titleclean, urlclean
from .library import sources_of
from .problems import Problem
from .ratelimit import KeyedWindow

MAX_ENTRIES = 200
LONG_SECONDS = 300
MAX_DETAIL_IDS = 25
DETAIL_WORKERS = 8
DETAIL_TIMEOUT_S = 40.0
PERIOD_S = 3600.0
NOT_A_PLAYLIST = "not a YouTube playlist link"

_UNAVAILABLE_TITLE = re.compile(r"^\[(private|deleted|unavailable|removed)[^\]]*\]$", re.I)
_UNAVAILABLE_AVAILABILITY = {"private": "Private", "needs_auth": "Private", "premium_only": "Unavailable", "subscriber_only": "Unavailable"}

_lists = KeyedWindow(12, PERIOD_S)
_details = KeyedWindow(600, PERIOD_S)


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, "")))
    except ValueError:
        return default


def reset_limits() -> None:
    _lists.reset()
    _details.reset()


def _charge(window: KeyedWindow, limit: int, uid: str, owner: bool, amount: float) -> None:
    if owner:
        return
    window.limit = limit
    wait_s = window.charge(uid, amount)
    if wait_s:
        minutes = max(1, int(-(-wait_s // 60)))
        raise Problem(429, "import_limit", f"Playlist import limit reached. Try again in {minutes} min.",
                      headers={"Retry-After": str(int(wait_s) + 1)}, retry_after_minutes=minutes)


def charge_listing(uid: str, owner: bool) -> None:
    _charge(_lists, _env_int("PLAYLIST_IMPORTS_PER_HOUR", 12), uid, owner, 1)


def charge_details(uid: str, owner: bool, count: int) -> None:
    _charge(_details, _env_int("PLAYLIST_DETAILS_PER_HOUR", 600), uid, owner, count)


def _fold(text: Any) -> str:
    plain = "".join(c for c in unicodedata.normalize("NFKD", str(text or "")) if not unicodedata.combining(c))
    return " ".join(re.sub(r"\W+", " ", plain.casefold()).split())


def _key(title: Any, artists: list[str], version: dict[str, Any] | None) -> tuple[str, tuple[str, ...], str] | None:
    names = tuple(sorted(n for n in (_fold(a) for a in artists) if n))
    name = _fold(title)
    if not name or not names:
        return None
    kind = (f"{_fold(version.get('type'))} {_fold(version.get('name'))}" if isinstance(version, dict) else "").strip()
    return name, names, kind


class Owned:
    """What the user already has: video ids (a song's id and its sources) and normalised title + main artists + version."""

    def __init__(self, songs: list[dict[str, Any]]) -> None:
        self.ids: set[str] = set()
        self.keys: set[tuple[str, tuple[str, ...], str]] = set()
        for song in songs:
            self.ids.add(str(song.get("id") or ""))
            self.ids.update(str(s.get("id") or "") for s in sources_of(song) if s.get("source") == "youtube")
            key = _key(song.get("title"), credits.main_artists(song), song.get("version"))
            if key:
                self.keys.add(key)

    def duplicate(self, video_id: str, title: str, artists: list[str], version: dict[str, Any] | None) -> str | None:
        if video_id in self.ids:
            return "id"
        key = _key(title, artists, version)
        return "match" if key is not None and key in self.keys else None


def unavailable_reason(info: dict[str, Any]) -> str | None:
    """"Private", "Deleted" or "Unavailable" for a playlist entry YouTube lists without a playable video; None for a normal one."""
    title = str(info.get("title") or "").strip()
    found = _UNAVAILABLE_TITLE.fullmatch(title)
    if found:
        return "Deleted" if found.group(1).lower() in ("deleted", "removed") else "Private" if found.group(1).lower() == "private" else "Unavailable"
    return _UNAVAILABLE_AVAILABILITY.get(str(info.get("availability") or "").lower())


def _genres(meta: dict[str, Any]) -> list[str]:
    return metadata.finalize_tags([*(meta.get("tags") or []), *(meta.get("youtube_genres") or [])])


def view(video_id: str, meta: dict[str, Any], owned: Owned, *, detailed: bool) -> dict[str, Any]:
    """One table row from parsed YouTube data: the credits and year the single-link Add form would hold with every lookup empty."""
    remixer = (meta.get("remixer") or "").strip() or None
    published = meta.get("published_year")
    version = {"type": credits_v1.kind_for(remixer), "name": remixer, "artists": [], "releaseYear": published} if remixer else None
    title = titleclean.clean(str(meta.get("title") or ""))
    artists = credits_v1.pills(meta.get("artist"))
    duration = meta.get("duration")
    return {
        "id": video_id,
        "url": urlclean.watch_url(video_id),
        "state": "ok",
        "reason": None,
        "title": title,
        "mainArtists": artists,
        "featuredArtists": [],
        "version": version,
        "releaseYear": None,
        "publishedYear": published,
        "tags": _genres(meta),
        "duration": duration,
        "long": isinstance(duration, (int, float)) and duration > LONG_SECONDS,
        "thumbnail": meta.get("thumbnail"),
        "raw": meta.get("raw"),
        "duplicate": owned.duplicate(video_id, title, artists, version),
        "detailed": detailed,
    }


def _unavailable_view(video_id: str, info: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "id": video_id, "url": urlclean.watch_url(video_id), "state": "unavailable", "reason": reason,
        "title": str(info.get("title") or ""), "mainArtists": [], "featuredArtists": [], "version": None, "releaseYear": None,
        "publishedYear": None, "tags": [], "duration": None, "long": False, "thumbnail": None, "raw": None,
        "duplicate": None, "detailed": True,
    }


def listing(list_id: str, songs: list[dict[str, Any]]) -> dict[str, Any]:
    """The playlist's entries (at most MAX_ENTRIES) parsed from the flat listing alone: title, channel and duration."""
    found = extractor.playlist(list_id, MAX_ENTRIES)
    owned = Owned(songs)
    seen: set[str] = set()
    entries: list[dict[str, Any]] = []
    for info in found["entries"][:MAX_ENTRIES]:
        video_id = str(info.get("id") or "")
        if not urlclean.VIDEO_ID_RE.fullmatch(video_id) or video_id in seen:
            continue
        seen.add(video_id)
        reason = unavailable_reason(info)
        if reason:
            entries.append(_unavailable_view(video_id, info, reason))
        else:
            entries.append(view(video_id, extractor.meta_from_info(video_id, info), owned, detailed=False))
    total = max(found["total"], len(entries))
    return {
        "playlist": {"id": list_id, "url": urlclean.playlist_url(list_id), "title": found["title"], "uploader": found["uploader"],
                     "total": total, "shown": len(entries), "limit": MAX_ENTRIES, "truncated": total > len(entries) and total > MAX_ENTRIES},
        "entries": entries,
    }


def details(ids: list[str], songs: list[dict[str, Any]]) -> dict[str, Any]:
    """Full YouTube data (artist and track fields, tags, upload date) for up to MAX_DETAIL_IDS videos, fetched in parallel within DETAIL_TIMEOUT_S; the ids that failed or timed out are listed in `failed`."""
    owned = Owned(songs)
    pool = ThreadPoolExecutor(max_workers=DETAIL_WORKERS)
    futures = {vid: pool.submit(previewcache.youtube, vid) for vid in dict.fromkeys(ids)}
    wait(list(futures.values()), timeout=DETAIL_TIMEOUT_S)
    pool.shutdown(wait=False, cancel_futures=True)
    entries: list[dict[str, Any]] = []
    failed: list[str] = []
    for vid, future in futures.items():
        if future.done() and future.exception() is None:
            entries.append(view(vid, future.result(), owned, detailed=True))
        else:
            failed.append(vid)
    return {"entries": entries, "failed": failed}
