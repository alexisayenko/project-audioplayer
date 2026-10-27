"""One-off pass (EC1): every stored remaster spelling in `version.name` becomes the canonical one from `version_norm.normalize_version` ('2024 Remastered' and '(Remastered 2011)' become '2024 remaster' and '2011 remaster'), on the songs of EVERY user at server start. Only `version.name` is touched: `title` is the base title only (DATA-144). Idempotent, with a one-time backup and a marker per user; `AUDIO_VERSION_NORM=0` disables it."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from . import deps, library, migration
from .version_norm import normalize_version

BACKUP_DIR = "backups-version-norm"
MARKER_VERSION = 1
_log = logging.getLogger(__name__)

def enabled() -> bool:
    return migration.enabled("AUDIO_VERSION_NORM")

def backup_path(uid: str) -> Path:
    """`<repo root>/backups-version-norm/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    return migration.user_backup(BACKUP_DIR, uid)

def marker_path(uid: str) -> Path:
    return migration.marker_beside(backup_path(uid))

def _done(uid: str) -> bool:
    return migration.marker_has(marker_path(uid), "marker", MARKER_VERSION)

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
            migration.backup_once(lib, backup_path(uid))
            library.save_doc(lib, doc)
        migration.write_marker(marker_path(uid), {"marker": MARKER_VERSION, "songs": len(changed)})
    return len(changed)

def run() -> int:
    """Normalise the version names in every user's library once; returns the number of songs changed. Never raises."""
    if not enabled():
        _log.info("version name normalisation disabled (AUDIO_VERSION_NORM=0)")
        return 0
    return migration.run_for_libraries(_done, _apply, "version names normalised for %s: %d songs", "version name normalisation failed for %s; the library is unchanged")
