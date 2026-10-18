"""Short-lived memory of link lookups, so Save does not ask YouTube or SoundCloud again right after Fetch did."""

from __future__ import annotations

import copy
import threading
import time
from typing import Any

from . import extractor

TTL_S = 600.0
MAX_ENTRIES = 256

_lock = threading.Lock()
_items: dict[str, tuple[float, dict[str, Any]]] = {}


def clear() -> None:
    with _lock:
        _items.clear()


def recall(key: str) -> dict[str, Any] | None:
    with _lock:
        hit = _items.get(key)
        if hit is None:
            return None
        if time.monotonic() - hit[0] > TTL_S:
            del _items[key]
            return None
        return copy.deepcopy(hit[1])


def remember(key: str, value: dict[str, Any]) -> None:
    with _lock:
        _items[key] = (time.monotonic(), copy.deepcopy(value))
        while len(_items) > MAX_ENTRIES:
            del _items[min(_items, key=lambda k: _items[k][0])]


def youtube(video_id: str) -> dict[str, Any]:
    """extractor.preview, answered from memory when the same video was looked up in the last minutes."""
    key = f"yt:{video_id}"
    found = recall(key)
    if found is None:
        found = extractor.preview(video_id)
        remember(key, found)
    return found
