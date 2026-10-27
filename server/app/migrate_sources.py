"""One-off pass (FG1, DATA-193, ADR-0040): every song's `sources` becomes `[{type, ref, trim_start, trim_end, duration?}]` and the derived `source_url` is no longer stored, on the songs of EVERY user at server start. A stored address that no parser recognises becomes `type: url`; order, primary and every source are kept; drafts are not touched. Idempotent, with a one-time backup and a marker per user; `AUDIO_SOURCES_SHAPE=0` disables it."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from . import deps, library, migration, sources

BACKUP_DIR = "backups-sources"
MARKER_VERSION = 1
_log = logging.getLogger(__name__)


def enabled() -> bool:
    return migration.enabled("AUDIO_SOURCES_SHAPE")


def backup_path(uid: str) -> Path:
    """`<repo root>/backups-sources/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    return migration.user_backup(BACKUP_DIR, uid)


def marker_path(uid: str) -> Path:
    return migration.marker_beside(backup_path(uid))


def _done(uid: str) -> bool:
    return migration.marker_has(marker_path(uid), "marker", MARKER_VERSION)


def needs_conversion(song: dict[str, Any]) -> bool:
    """True when the stored record still has the old shape: a source without `type`/`ref`, a stored `source_url`, or no sources at all."""
    return not sources.is_new_shape(song.get("sources")) or not song.get("sources") or "source_url" in song


def _apply(uid: str, lib: Path) -> int:
    with deps.tx(uid, "convert sources to type and ref"):
        raw = json.loads(lib.read_text(encoding="utf-8")) if lib.is_file() else {}
        raw_songs = raw.get("songs") if isinstance(raw, dict) else raw
        changed = sum(1 for s in raw_songs or [] if isinstance(s, dict) and "id" in s and needs_conversion(s))
        if changed:
            migration.backup_once(lib, backup_path(uid))
            library.save_doc(lib, library.load_doc(lib))
        migration.write_marker(marker_path(uid), {"marker": MARKER_VERSION, "songs": changed})
    return changed


def run() -> int:
    """Convert the sources of every user's library once; returns the number of songs changed. Never raises."""
    if not enabled():
        _log.info("sources shape migration disabled (AUDIO_SOURCES_SHAPE=0)")
        return 0
    return migration.run_for_libraries(_done, _apply, "sources converted for %s: %d songs", "sources conversion failed for %s; the library is unchanged")
