"""Reading the per-user side files (drafts, playlists, albums, genre layout): a missing file is empty, a corrupt or unreadable one is never read as empty.

A file that does not parse is copied once next to itself as `<name>.corrupt-<stamp>`, logged, listed in `/health` for the owner and refused with a coded 500,
so the load-change-save routes cannot replace it with a one-item file. The refusal ends when the file parses again (fixed by hand or restored from the copy).
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

from .jsonio import write_bytes_atomic
from .problems import Problem
from .timeutil import now_utc

log = logging.getLogger("audioplayer.userjson")

CODE = "data_corrupt"
DETAIL = "A stored file of this account cannot be read. A copy was kept and nothing was changed."

_lock = threading.Lock()
_flagged: dict[str, str | None] = {}


def _refuse(path: Path, why: str, copy: Path | None) -> Problem:
    with _lock:
        fresh = str(path) not in _flagged
        _flagged[str(path)] = copy.name if copy else None
    if fresh:
        log.error("stored file %s is unusable (%s); copy: %s; requests for it are refused until it parses", path, why, copy or "none")
    return Problem(500, CODE, DETAIL)


def _clear(path: Path) -> None:
    with _lock:
        was = str(path) in _flagged
        _flagged.pop(str(path), None)
    if was:
        log.warning("stored file %s is usable again", path)


def quarantine(path: Path, data: bytes) -> Path | None:
    """The copy of `data` next to `path`: an identical earlier copy is reused, None when the copy cannot be written."""
    try:
        for old in sorted(path.parent.glob(f"{path.name}.corrupt-*")):
            if old.read_bytes() == data:
                return old
        stamp = now_utc().replace("-", "").replace(":", "")
        copy = path.with_name(f"{path.name}.corrupt-{stamp}")
        for n in range(2, 1000):
            if not copy.exists():
                break
            copy = path.with_name(f"{path.name}.corrupt-{stamp}-{n}")
        write_bytes_atomic(copy, data)
        return copy
    except OSError:
        log.exception("cannot keep a copy of %s", path)
        return None


def read_object(path: Path) -> dict[str, Any] | None:
    """The top-level JSON object of `path`; None when the file does not exist; a refusal (Problem) when it is unreadable, not JSON or not an object."""
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        _clear(path)
        return None
    except OSError as exc:
        raise _refuse(path, f"unreadable: {exc}", None) from exc
    try:
        raw = json.loads(data.decode("utf-8"))
    except ValueError as exc:
        raise _refuse(path, f"not JSON: {exc}", quarantine(path, data)) from exc
    if not isinstance(raw, dict):
        raise _refuse(path, "not a JSON object", quarantine(path, data))
    _clear(path)
    return raw


def check_replaceable(path: Path) -> None:
    """For a writer that replaces the whole file without reading it: an unusable file may be replaced once a copy of it is kept, else the write is refused."""
    try:
        read_object(path)
    except Problem:
        with _lock:
            kept = _flagged.get(str(path))
        if kept is None:
            raise


def mark_replaced(path: Path) -> None:
    _clear(path)


def flagged(root: Path) -> list[dict[str, str | None]]:
    """The refused files for `/health`, path relative to `root` when below it."""
    with _lock:
        items = sorted(_flagged.items())
    out: list[dict[str, str | None]] = []
    for name, copy in items:
        try:
            shown = str(Path(name).relative_to(root))
        except ValueError:
            shown = name
        out.append({"file": shown, "copy": copy})
    return out


def reset() -> None:
    with _lock:
        _flagged.clear()
