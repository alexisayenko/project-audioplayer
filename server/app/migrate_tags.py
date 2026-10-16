"""One-time rewrite of stored genre tags to their canonical spelling, junk drops, demonym prefixes and retags (TAG-060, TAG-073, TAG-074, TAG-075); idempotent, run at startup."""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path

from . import deps, library
from .tags import namespace

BACKUP_DIR = "backups-genre-merge"
_log = logging.getLogger(__name__)


def _stale(path: Path) -> bool:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    songs = raw.get("songs") if isinstance(raw, dict) else raw
    if not isinstance(songs, list):
        return False
    for s in songs:
        tags = s.get("tags") if isinstance(s, dict) else None
        if not isinstance(tags, list):
            continue
        watched = [str(t) for t in tags if namespace(t) in ("genre", "country", "lang")]
        if [t for t in library.clean_tags([str(t) for t in tags]) if namespace(t) in ("genre", "country", "lang")] != watched:
            return True
    return False


def backup_path(path: Path) -> Path:
    """`<repo root>/backups-genre-merge/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    base = deps.SYNC.data_repo if deps.SYNC else deps.data_root()
    return base / BACKUP_DIR / path.parent.name / path.name


def migrate(path: Path) -> bool:
    """Rewrite one library.json when a genre tag is not canonical; keeps a one-time backup first. True when rewritten."""
    if not _stale(path):
        return False
    backup = backup_path(path)
    if not backup.exists():
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, backup)
    library.save_doc(path, library.load_doc(path))
    return True


def run() -> int:
    users_dir = deps.data_root() / "users"
    if not users_dir.is_dir():
        return 0
    done = 0
    for lib in sorted(users_dir.glob("*/library.json")):
        uid = lib.parent.name
        try:
            if not _stale(lib):
                continue
            with deps.tx(uid, "merge genre tags"):
                done += migrate(lib)
            _log.info("genre tags merged for %s", uid[:8])
        except Exception:
            _log.exception("genre tag migration failed for %s", uid[:8])
    return done
