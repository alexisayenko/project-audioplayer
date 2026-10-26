"""Saved loops of a song: `[{name, start, end}]`, seconds, a section of the audio the user wants to repeat."""

from __future__ import annotations

import math
from typing import Any

MAX_LOOPS = 20
MAX_NAME = 40
MIN_LENGTH = 0.1
DURATION_SLACK = 1.0


def _number(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v) if math.isfinite(v) else None


def clean(raw: Any, duration: Any = None) -> list[dict[str, Any]]:
    """The loops of a request: names trimmed (an empty name becomes "Loop N"), times rounded to milliseconds; ValueError with a message for the first fault."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("loops must be a list")
    if len(raw) > MAX_LOOPS:
        raise ValueError(f"a song can have at most {MAX_LOOPS} loops")
    limit = _number(duration)
    return [_clean_loop(i, item, limit) for i, item in enumerate(raw, 1)]


def _clean_loop(i: int, item: Any, limit: float | None) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError(f"loop {i} must be an object")
    start, end = _number(item.get("start")), _number(item.get("end"))
    if start is None or end is None:
        raise ValueError(f"loop {i} needs numeric start and end")
    if start < 0 or end - start < MIN_LENGTH - 1e-9:
        raise ValueError(f"loop {i} must start at 0 or later and last at least {MIN_LENGTH} s")
    if limit and end > limit + DURATION_SLACK:
        raise ValueError(f"loop {i} ends after the end of the song")
    name = str(item.get("name") or "").strip()
    if len(name) > MAX_NAME:
        raise ValueError(f"loop names are at most {MAX_NAME} characters")
    return {"name": name or f"Loop {i}", "start": round(start, 3), "end": round(end, 3)}


def tolerant(raw: Any) -> list[dict[str, Any]]:
    """Loops read from a file: the valid ones in order, the rest dropped; never raises."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:MAX_LOOPS]:
        try:
            out.extend(clean([item]))
        except ValueError:
            continue
    return out
