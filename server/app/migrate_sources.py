"""One-off pass (FG1, DATA-193, ADR-0040): every song's `sources` becomes `[{type, ref, trim_start, trim_end, duration?}]` and the derived `source_url` is no longer stored, on the songs of EVERY user at server start. A stored address that no parser recognises becomes `type: url`; order, primary and every source are kept; drafts are not touched. Idempotent, with a one-time backup and a marker per user; `AUDIO_SOURCES_SHAPE=0` disables it."""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from . import deps, library, sources
from .jsonio import write_json_atomic

BACKUP_DIR = "backups-sources"
MARKER_VERSION = 1
_log = logging.getLogger(__name__)


def enabled() -> bool:
    return os.environ.get("AUDIO_SOURCES_SHAPE", "1").strip() != "0"


def base_dir() -> Path:
    return deps.SYNC.data_repo if deps.SYNC else deps.data_root()


def backup_path(uid: str) -> Path:
    """`<repo root>/backups-sources/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    return base_dir() / BACKUP_DIR / uid / "library.json"


def marker_path(uid: str) -> Path:
    return backup_path(uid).parent / "applied.json"


def _done(uid: str) -> bool:
    try:
        return json.loads(marker_path(uid).read_text(encoding="utf-8")).get("marker") == MARKER_VERSION
    except (OSError, ValueError, AttributeError):
        return False


def needs_conversion(song: dict[str, Any]) -> bool:
    """True when the stored record still has the old shape: a source without `type`/`ref`, a stored `source_url`, or no sources at all."""
    return not sources.is_new_shape(song.get("sources")) or not song.get("sources") or "source_url" in song


def _apply(uid: str, lib: Path) -> int:
    with deps.tx(uid, "convert sources to type and ref"):
        raw = json.loads(lib.read_text(encoding="utf-8")) if lib.is_file() else {}
        raw_songs = raw.get("songs") if isinstance(raw, dict) else raw
        changed = sum(1 for s in raw_songs or [] if isinstance(s, dict) and "id" in s and needs_conversion(s))
        if changed:
            backup = backup_path(uid)
            if not backup.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(lib, backup)
            library.save_doc(lib, library.load_doc(lib))
        write_json_atomic(marker_path(uid), {"marker": MARKER_VERSION, "songs": changed})
    return changed


def run() -> int:
    """Convert the sources of every user's library once; returns the number of songs changed. Never raises."""
    if not enabled():
        _log.info("sources shape migration disabled (AUDIO_SOURCES_SHAPE=0)")
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
            _log.info("sources converted for %s: %d songs", uid[:8], n)
        except Exception:
            _log.exception("sources conversion failed for %s; the library is unchanged", uid[:8])
    return total
