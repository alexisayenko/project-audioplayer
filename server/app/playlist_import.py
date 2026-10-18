"""Import of a YouTube playlist into the catalog: a flat listing, per-video details on request, and the duplicate and length marks. YouTube data only (ADD-150..ADD-158)."""

from __future__ import annotations

import os
import random
import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any

from . import credit_title, credits, credits_split, credits_v1, extractor, metadata, previewcache, titleclean, titles, urlclean
from .library import sources_of
from .problems import Problem
from .ratelimit import KeyedWindow

MAX_ENTRIES = 200
LONG_SECONDS = 300
MAX_DETAIL_IDS = 10
DETAIL_WORKERS = 2
DETAIL_DELAY_S = (0.5, 1.5)
DETAIL_TIMEOUT_S = 40.0
PERIOD_S = 3600.0
NOT_A_PLAYLIST = "not a YouTube playlist link"

_UNAVAILABLE_TITLE = re.compile(r"^\[(private|deleted|unavailable|removed)[^\]]*\]$", re.I)
_TRANSIENT_ERROR = re.compile(r"HTTP Error (?:429|5\d\d)|too many requests|timed? ?out|connection|network|temporary failure|sign in to confirm|rate.?limit", re.I)
_RATE_LIMITED = re.compile(r"HTTP Error 429|too many requests|confirm you.?re not a bot", re.I)
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
    """"Private", "Deleted", "Private or deleted" (no title and no length) or "Unavailable" for a playlist entry YouTube lists without a playable video; None for a normal one."""
    title = str(info.get("title") or "").strip()
    if not title and not info.get("duration"):
        return "Private or deleted"
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
    version = {"type": credits_split.kind_of(remixer), "name": remixer, "artists": credits_split.version_artists(remixer), "releaseYear": meta.get("version_year") or published} if remixer else None
    title = titleclean.clean(str(meta.get("title") or ""))
    artists = meta["mainArtists"] if isinstance(meta.get("mainArtists"), list) else credits_v1.pills(meta.get("artist"))
    featured = list(meta.get("featuredArtists") or [])
    withs = list(meta.get("withArtists") or [])
    lead = None if meta.get("credited") else titles.lead_artist(title)
    if lead:
        found = credit_title.parse(lead[0], lead[1], split_vs=True)
        artists, title = found["mainArtists"], found["title"]
        taken = {credit_title.fold(a) for a in artists}
        featured = credit_title.unique([*featured, *found["featuredArtists"]], taken)
        withs = credit_title.unique([*withs, *found["withArtists"]], taken)
    duration = meta.get("duration")
    return {
        "id": video_id,
        "url": urlclean.watch_url(video_id),
        "state": "ok",
        "reason": None,
        "title": title,
        "mainArtists": artists,
        "featuredArtists": featured,
        "withArtists": withs,
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
        "title": str(info.get("title") or ""), "mainArtists": [], "featuredArtists": [], "withArtists": [], "version": None, "releaseYear": None,
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
    """Full YouTube data (artist and track fields, tags, upload date) for up to MAX_DETAIL_IDS videos, fetched by DETAIL_WORKERS workers with a random pause of DETAIL_DELAY_S between one worker's fetches, within DETAIL_TIMEOUT_S; the ids that failed or timed out are listed in `failed`, those YouTube refused to serve (an error that is not a network, rate-limit or sign-in problem) also in `unavailable`. After a 429 or bot check the remaining ids are not fetched and `rate_limited` is true."""
    owned = Owned(songs)
    halted = threading.Event()
    pending = list(dict.fromkeys(ids))
    lock = threading.Lock()
    results: dict[str, tuple[dict[str, Any] | None, Exception | None]] = {}

    def worker() -> None:
        first = True
        while not halted.is_set():
            with lock:
                if not pending:
                    return
                vid = pending.pop(0)
            if not first:
                time.sleep(random.uniform(*DETAIL_DELAY_S))
            first = False
            if halted.is_set():
                return
            try:
                results[vid] = (previewcache.youtube(vid), None)
            except Exception as exc:
                results[vid] = (None, exc)
                if _RATE_LIMITED.search(str(exc)):
                    halted.set()

    pool = ThreadPoolExecutor(max_workers=DETAIL_WORKERS)
    futures = [pool.submit(worker) for _ in range(min(DETAIL_WORKERS, len(pending)))]
    wait(futures, timeout=DETAIL_TIMEOUT_S)
    halted.set()
    pool.shutdown(wait=False, cancel_futures=True)
    entries: list[dict[str, Any]] = []
    failed: list[str] = []
    unavailable: list[str] = []
    limited = False
    for vid in dict.fromkeys(ids):
        meta, error = results.get(vid, (None, None))
        if meta is not None:
            entries.append(view(vid, meta, owned, detailed=True))
            continue
        failed.append(vid)
        if error is None:
            continue
        if _RATE_LIMITED.search(str(error)):
            limited = True
        elif not _TRANSIENT_ERROR.search(str(error)):
            unavailable.append(vid)
    return {"entries": entries, "failed": failed, "unavailable": unavailable, "rate_limited": limited}
