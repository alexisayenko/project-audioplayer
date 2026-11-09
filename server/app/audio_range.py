from __future__ import annotations

import os
import threading
import time
from collections import OrderedDict

RANGE_CHUNK_BYTES = (128 * 1024, 512 * 1024, 2 * 1024 * 1024)
RANGE_CHUNK_ENVS = ("AUDIO_RANGE_CHUNK_1_BYTES", "AUDIO_RANGE_CHUNK_2_BYTES", "AUDIO_RANGE_CHUNK_3_BYTES")
CAP_ENV = "AUDIO_RANGE_CAP_BYTES"
CAP_DEFAULT_BYTES = 0
RUNS_MAX = 512
RUNS_TTL_S = 60.0

_runs: OrderedDict[tuple[str, str], tuple[int, int, float]] = OrderedDict()
_lock = threading.Lock()
_clock = time.monotonic


def enabled() -> bool:
    return os.environ.get("AUDIO_RANGE_RAMP", "").strip() == "1"


def cap_bytes() -> int:
    """The first-chunk cap in bytes; 0 switches the cap off. Read per request."""
    raw = os.environ.get(CAP_ENV, "").strip()
    try:
        return max(0, int(raw)) if raw else CAP_DEFAULT_BYTES
    except ValueError:
        return CAP_DEFAULT_BYTES


def first_chunk(header: str, size: int) -> str:
    """Clamp a single forward byte range to `cap_bytes()` from its start; suffix, multi-range, invalid and small ranges pass through."""
    cap = cap_bytes()
    parsed = _parse(header, size) if cap else None
    if parsed is None:
        return header
    start, end, _ = parsed
    last = start + cap - 1
    return header if end <= last else f"bytes={start}-{last}"


def _chunk(step: int) -> int:
    tier = min(step, len(RANGE_CHUNK_BYTES) - 1)
    try:
        return max(1, int(os.environ.get(RANGE_CHUNK_ENVS[tier], "")))
    except ValueError:
        return RANGE_CHUNK_BYTES[tier]


def _parse(header: str, size: int) -> tuple[int, int, bool] | None:
    spec = header.strip().lower()
    if not spec.startswith("bytes=") or "," in spec:
        return None
    first, _, last = spec[6:].strip().partition("-")
    try:
        start = int(first)
        end = int(last) if last else size - 1
    except ValueError:
        return None
    if start >= size or end < start:
        return None
    return start, min(end, size - 1), bool(last)


def capped_range(header: str, size: int, key: tuple[str, str], record: bool = True) -> str:
    """Clamp a forward byte range to the current ramp step (128 KiB, 512 KiB, then 2 MiB per consecutive continuation); other headers pass through."""
    parsed = _parse(header, size)
    if parsed is None:
        return header
    start, end, bounded = parsed
    now = _clock()
    with _lock:
        for old in [k for k, (_, _, at) in _runs.items() if now - at > RUNS_TTL_S]:
            del _runs[old]
        prev = _runs.get(key)
        step = prev[1] if prev and prev[0] == start else 0
        capped = min(end, start + _chunk(step) - 1)
        if record:
            _runs[key] = (capped + 1, step + 1, now)
            _runs.move_to_end(key)
            while len(_runs) > RUNS_MAX:
                _runs.popitem(last=False)
    return header if capped == end and bounded else f"bytes={start}-{capped}"


def reset() -> None:
    with _lock:
        _runs.clear()
