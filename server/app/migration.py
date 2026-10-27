"""Shared plumbing of the one-off start-up migrations (`migrate_*`): where backups and markers live, the one-time backup, the applied marker, the per-user loop. Each migration keeps its own body and its own marker name and shape, so a pass that already ran in production stays applied. The run order is the registry in `migrations.py` (NFR-112)."""

from __future__ import annotations

import json
import logging
import os
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

from . import deps
from .jsonio import write_json_atomic

LIBRARY_FILE = "library.json"
MARKER_FILE = "applied.json"
_log = logging.getLogger(__name__)


def enabled(variable: str) -> bool:
    """False only when the environment variable is set to `0`."""
    return os.environ.get(variable, "1").strip() != "0"


def base_dir() -> Path:
    """The repo root of the data (beside, not inside, the git-added `audioplayer/` tree)."""
    return deps.SYNC.data_repo if deps.SYNC else deps.data_root()


def user_backup(folder: str, uid: str, name: str = LIBRARY_FILE) -> Path:
    """`<repo root>/<folder>/<uid>/<name>`."""
    return base_dir() / folder / uid / name


def marker_beside(backup: Path) -> Path:
    return backup.parent / MARKER_FILE


def backup_once(source: Path, target: Path) -> None:
    """Copy `source` to `target` unless a backup is already there (the first copy is the one worth keeping)."""
    if target.exists():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def read_marker(path: Path) -> dict[str, Any]:
    """The marker object; empty when the file is missing, unreadable or not an object."""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return doc if isinstance(doc, dict) else {}


def write_marker(path: Path, doc: dict[str, Any]) -> None:
    write_json_atomic(path, doc)


def marker_has(path: Path, key: str, value: Any) -> bool:
    return read_marker(path).get(key) == value


def libraries() -> list[Path]:
    """Every user's `library.json`, sorted; empty when there is no `users/` folder."""
    users_dir = deps.data_root() / "users"
    return sorted(users_dir.glob(f"*/{LIBRARY_FILE}")) if users_dir.is_dir() else []


def run_for_libraries(is_done: Callable[[str], bool], apply: Callable[[str, Path], int], done_message: str, failed_message: str) -> int:
    """Apply a per-user pass to every library that is not yet marked done; returns the sum of `apply` results. A failure is logged and leaves that library unchanged. The messages take the short user id and, for `done_message`, the count."""
    total = 0
    for lib in libraries():
        uid = lib.parent.name
        try:
            if is_done(uid):
                continue
            n = apply(uid, lib)
            total += n
            _log.info(done_message, uid[:8], n)
        except Exception:
            _log.exception(failed_message, uid[:8])
    return total
