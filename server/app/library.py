"""library.json store: single writer under a lock, atomic replace on write."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

LOCK = threading.RLock()


def load(path: Path) -> list[dict[str, Any]]:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)["songs"]
    except FileNotFoundError:
        return []


def save(path: Path, songs: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".library-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"songs": songs}, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def clean_tags(tags: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for t in tags:
        t = " ".join(t.split())
        if t and t.casefold() not in seen:
            seen.add(t.casefold())
            out.append(t)
    return out


def tag_counts(songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, dict[str, Any]] = {}
    for s in songs:
        for t in s.get("tags", []):
            e = counts.setdefault(t.casefold(), {"tag": t, "count": 0})
            e["count"] += 1
    return sorted(counts.values(), key=lambda e: e["tag"].casefold())
