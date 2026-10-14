"""Per-user and pool guardrails, read from the environment at call time."""
from __future__ import annotations

import math
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .problems import Problem

GB = 1024 ** 3
WINDOW = 3600


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def max_songs() -> int:
    return _int("USER_MAX_SONGS", 500)


def max_bytes() -> int:
    return _int("USER_MAX_BYTES", 5 * GB)


def max_adds() -> int:
    return _int("USER_ADDS_PER_HOUR", 20)


def user_concurrency() -> int:
    return max(1, _int("USER_MAX_CONCURRENT_DOWNLOADS", 1))


def global_concurrency() -> int:
    return max(1, _int("GLOBAL_MAX_CONCURRENT_DOWNLOADS", 2))


def pool_max_bytes() -> int:
    return _int("POOL_MAX_BYTES", 150 * GB)


def dir_bytes(path: Path) -> int:
    """Sum of the real file sizes below `path` (0 when it does not exist)."""
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.stat(os.path.join(root, name)).st_size
            except OSError:
                pass
    return total


def _epoch(stamp: Any) -> float | None:
    try:
        return datetime.strptime(str(stamp), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


class AddRate:
    """Adds accepted per user in the last hour; after a restart it re-learns from the songs' `added_at`."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stamps: dict[str, list[float]] = {}

    def _fresh(self, uid: str, songs: list[dict[str, Any]], now: float) -> list[float]:
        if uid not in self._stamps:
            seen = [_epoch(s.get("added_at")) for s in songs]
            self._stamps[uid] = [t for t in seen if t is not None]
        self._stamps[uid] = [t for t in self._stamps[uid] if now - t < WINDOW]
        return self._stamps[uid]

    def count(self, uid: str, songs: list[dict[str, Any]], now: float | None = None) -> int:
        now = time.time() if now is None else now
        with self._lock:
            return len(self._fresh(uid, songs, now))

    def retry_minutes(self, uid: str, songs: list[dict[str, Any]], now: float | None = None) -> int:
        now = time.time() if now is None else now
        with self._lock:
            stamps = self._fresh(uid, songs, now)
            if not stamps:
                return 1
            return max(1, math.ceil((min(stamps) + WINDOW - now) / 60))

    def record(self, uid: str, songs: list[dict[str, Any]], now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self._lock:
            self._fresh(uid, songs, now).append(now)

    def reset(self) -> None:
        with self._lock:
            self._stamps.clear()


RATE = AddRate()


def usage(uid: str, owner: bool, songs: list[dict[str, Any]], audio_dir: Path) -> dict[str, Any]:
    return {
        "songs": len(songs),
        "max_songs": None if owner else max_songs(),
        "bytes": dir_bytes(audio_dir),
        "max_bytes": None if owner else max_bytes(),
        "adds_last_hour": RATE.count(uid, songs),
        "max_adds": None if owner else max_adds(),
    }


def check_pool(pool_dir: Path) -> None:
    if dir_bytes(pool_dir) >= pool_max_bytes():
        raise Problem(503, "server_full", "The server's storage is full. Try again later.")


def check_capacity(owner: bool, audio_dir: Path, pool_dir: Path) -> None:
    """Room for one more audio file: the user's bytes (not the owner) and the whole pool."""
    if not owner and dir_bytes(audio_dir) >= max_bytes():
        raise Problem(403, "library_full_bytes",
                      f"Your storage is full ({max_bytes() / GB:g} GB). Delete some songs to add more.")
    check_pool(pool_dir)


def _check_rate(uid: str, songs: list[dict[str, Any]]) -> None:
    if RATE.count(uid, songs) >= max_adds():
        minutes = RATE.retry_minutes(uid, songs)
        raise Problem(429, "hourly_limit",
                      f"You can add {max_adds()} songs per hour. Try again in {minutes} min.",
                      headers={"Retry-After": str(minutes * 60)}, retry_after_minutes=minutes)


def check_add(uid: str, owner: bool, songs: list[dict[str, Any]], audio_dir: Path, pool_dir: Path,
              *, inflight: int = 0, with_audio: bool = True) -> None:
    """Raise Problem before anything is downloaded. The owner skips the per-user limits, not the pool ceiling."""
    if not owner:
        if len(songs) + inflight >= max_songs():
            raise Problem(403, "library_full_songs",
                          f"Your library is full ({max_songs()} songs). Delete some songs to add more.")
        _check_rate(uid, songs)
    if with_audio:
        check_capacity(owner, audio_dir, pool_dir)


def check_fetch(uid: str, owner: bool, songs: list[dict[str, Any]], audio_dir: Path, pool_dir: Path) -> None:
    """Fetching audio for a song already in the catalog: same hourly counter and storage caps, no song-count check."""
    if not owner:
        _check_rate(uid, songs)
    check_capacity(owner, audio_dir, pool_dir)
