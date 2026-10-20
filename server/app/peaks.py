"""Waveform peaks of a song file: ffmpeg decodes to mono 8 kHz PCM, numpy reduces it to min/max pairs, cached beside the audio."""

from __future__ import annotations

import hashlib
import json
import subprocess
import threading
from pathlib import Path
from typing import Any

import numpy as np

from .jsonio import write_bytes_atomic

BUCKETS = 1200
RATE = 8000
VERSION = 1
DECODE_TIMEOUT = 120
CACHE_DIR = ".peaks"

_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}
_slots = threading.BoundedSemaphore(2)


class Unavailable(Exception):
    """ffmpeg is missing, failed or produced no audio."""


def signature(path: Path) -> str:
    st = path.stat()
    return f"{VERSION}-{st.st_size}-{st.st_mtime_ns}"


def etag(path: Path) -> str:
    return '"p' + hashlib.sha1(signature(path).encode()).hexdigest()[:16] + '"'


def decode(path: Path) -> np.ndarray:
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=DECODE_TIMEOUT, check=True).stdout
    except (OSError, subprocess.SubprocessError) as exc:
        raise Unavailable(str(exc)) from exc
    return np.frombuffer(out[: len(out) // 2 * 2], dtype="<i2")


def reduce(samples: np.ndarray, buckets: int = BUCKETS) -> dict[str, Any]:
    """`min` and `max` lists of signed 8-bit values (-127..127), normalised to the loudest sample, and the decoded length in seconds."""
    n = len(samples)
    if n == 0:
        raise Unavailable("no audio decoded")
    count = min(buckets, n)
    starts = np.linspace(0, n, count, endpoint=False).astype(np.int64)
    lows = np.minimum.reduceat(samples, starts).astype(np.float64)
    highs = np.maximum.reduceat(samples, starts).astype(np.float64)
    top = max(float(np.abs(samples).max()), 1.0)
    scale = 127.0 / top
    return {
        "v": VERSION,
        "buckets": count,
        "duration": round(n / RATE, 3),
        "min": [int(round(x * scale)) for x in lows],
        "max": [int(round(x * scale)) for x in highs],
    }


def cache_path(path: Path) -> Path:
    return path.parent / CACHE_DIR / f"{path.stem}.{signature(path)}.json"


def _lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def load(path: Path) -> bytes:
    """The JSON bytes of the peaks of `path`, from the cache or computed once; raises Unavailable."""
    cached = cache_path(path)
    try:
        return cached.read_bytes()
    except OSError:
        pass
    with _lock_for(str(cached)):
        try:
            return cached.read_bytes()
        except OSError:
            pass
        with _slots:
            body = json.dumps(reduce(decode(path)), separators=(",", ":")).encode()
        try:
            for old in cached.parent.glob(f"{path.stem}.*.json"):
                old.unlink(missing_ok=True)
            cached.parent.mkdir(parents=True, exist_ok=True)
            write_bytes_atomic(cached, body)
        except OSError:
            pass
        return body
