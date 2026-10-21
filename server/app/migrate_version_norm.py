"""One-off pass (EC1): every stored remaster spelling in `version.name` becomes the canonical one from `version_norm.normalize_version` ('2024 Remastered' and '(Remastered 2011)' become '2024 remaster' and '2011 remaster'), on the songs of EVERY user at server start. Only `version.name` is touched: `title` is the base title only (DATA-144). Idempotent, with a one-time backup and a marker per user; `AUDIO_VERSION_NORM=0` disables it."""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from . import deps, library
from .jsonio import write_json_atomic
from .version_norm import normalize_version

BACKUP_DIR = "backups-version-norm"
MARKER_VERSION = 1
_log = logging.getLogger(__name__)

def enabled() -> bool:
    return os.environ.get("AUDIO_VERSION_NORM", "1").strip() != "0"

def base_dir() -> Path:
    return deps.SYNC.data_repo if deps.SYNC else deps.data_root()

def backup_path(uid: str) -> Path:
    """`<repo root>/backups-version-norm/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    return base_dir() / BACKUP_DIR / uid / "library.json"

def marker_path(uid: str) -> Path:
    return backup_path(uid).parent / "applied.json"

def _done(uid: str) -> bool:
    try:
        return json.loads(marker_path(uid).read_text(encoding="utf-8")).get("marker") == MARKER_VERSION
    except (OSError, ValueError, AttributeError):
        return False

def apply_norm(songs: list[dict[str, Any]]) -> list[str]:
    """Normalise `version.name` on working songs in place; returns the ids changed (a rerun changes none)."""
    changed: list[str] = []
    for song in songs:
        version = song.get("version")
        name = version.get("name") if isinstance(version, dict) else None
        if not isinstance(name, str):
            continue
        new = normalize_version(name)
        if new != name:
            version["name"] = new
            changed.append(str(song.get("id")))
    return changed

def _apply(uid: str, lib: Path) -> int:
    with deps.tx(uid, "normalize version names"):
        doc = library.load_doc(lib)
        changed = apply_norm(doc["songs"])
        if changed:
            backup = backup_path(uid)
            if not backup.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(lib, backup)
            library.save_doc(lib, doc)
        write_json_atomic(marker_path(uid), {"marker": MARKER_VERSION, "songs": len(changed)})
    return len(changed)

def run() -> int:
    """Normalise the version names in every user's library once; returns the number of songs changed. Never raises."""
    if not enabled():
        _log.info("version name normalisation disabled (AUDIO_VERSION_NORM=0)")
        return 0
    users_dir = deps.data_root() / "users"
    if not users_dir.is_dir():
        return 0
    total = 0
    for lib in sorted(users_dir.glob("*/library.json")):
        uid = lib.parent.name
        try:
            if _done(uid):
                continue
            n = _apply(uid, lib)
            total += n
            _log.info("version names normalised for %s: %d songs", uid[:8], n)
        except Exception:
            _log.exception("version name normalisation failed for %s; the library is unchanged", uid[:8])
    return total
