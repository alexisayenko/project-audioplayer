"""Per-user saved circle positions of the Genres map v2 (API-230, DATA-198): only the circles the user moved."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from .jsonio import write_json_atomic
from .timeutil import now_utc

MAX_ENTRIES = 2000
NAME_MAX = 200
COORD_MAX = 100_000
KINDS = ("positions", "families")


def empty() -> dict[str, Any]:
    return {"positions": {}, "families": {}, "updated": None}


def point(value: Any) -> tuple[int, int] | None:
    """The point rounded to integers, or None when it is not two finite numbers within the bound."""
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    out = []
    for v in value:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > COORD_MAX:
            return None
        out.append(int(round(v)))
    return out[0], out[1]


def count(doc: dict[str, Any]) -> int:
    return sum(len(doc[k]) for k in KINDS)


def load(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return empty()
    if not isinstance(raw, dict):
        return empty()
    doc = empty()
    for kind in KINDS:
        table = raw.get(kind)
        for name, value in (table.items() if isinstance(table, dict) else ()):
            p = point(value)
            if isinstance(name, str) and 0 < len(name) <= NAME_MAX and p is not None:
                doc[kind][name] = [p[0], p[1]]
    stamp = raw.get("updated")
    doc["updated"] = stamp if isinstance(stamp, str) and stamp else None
    return doc


def save(path: Path, positions: dict[str, tuple[int, int]], families: dict[str, tuple[int, int]]) -> dict[str, Any]:
    """Replace the whole document; both tables empty removes the file."""
    if not positions and not families:
        path.unlink(missing_ok=True)
        return empty()
    doc = {
        "positions": {k: [v[0], v[1]] for k, v in positions.items()},
        "families": {k: [v[0], v[1]] for k, v in families.items()},
        "updated": now_utc(),
    }
    write_json_atomic(path, doc, compact=True)
    return doc
