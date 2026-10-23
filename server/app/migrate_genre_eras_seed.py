"""One-off seed (decision GF1): the five eras of `goa trance` from `data/genre_eras_seed.json` go into `genre_eras.json`, only while that file has no entry for the genre. A marker keeps it from returning after the owner deletes the eras; a backup of an existing `genre_eras.json` is taken first. Idempotent; `AUDIO_GENRE_ERAS_SEED=0` disables it."""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from . import deps, genre_eras as eras, users
from .jsonio import write_json_atomic

BACKUP_DIR = "backups-genre-eras-seed"
MARKER_VERSION = 1
SEED_FILE = Path(__file__).resolve().parent.parent / "data" / "genre_eras_seed.json"
_log = logging.getLogger(__name__)


def enabled() -> bool:
    return os.environ.get("AUDIO_GENRE_ERAS_SEED", "1").strip() != "0"


def base_dir() -> Path:
    return deps.SYNC.data_repo if deps.SYNC else deps.data_root()


def marker_path() -> Path:
    return base_dir() / BACKUP_DIR / "applied.json"


def _done() -> bool:
    try:
        return json.loads(marker_path().read_text(encoding="utf-8")).get("marker") == MARKER_VERSION
    except (OSError, ValueError, AttributeError):
        return False


def seed() -> dict[str, list[dict[str, Any]]]:
    raw = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    return {genre: eras.clean_all(rows) for genre, rows in raw.items()}


def _apply() -> int:
    with deps.tx(users.owner_uid(), "seed genre eras"):
        doc = eras.load()
        added = 0
        todo = {g: rows for g, rows in seed().items() if not doc.get(g)}
        if todo:
            if eras.path().exists():
                backup = marker_path().parent / eras.FILE_NAME
                backup.parent.mkdir(parents=True, exist_ok=True)
                if not backup.exists():
                    shutil.copy2(eras.path(), backup)
            doc.update(todo)
            eras.save(doc)
            added = sum(len(rows) for rows in todo.values())
        write_json_atomic(marker_path(), {"marker": MARKER_VERSION, "eras": added})
    return added


def run() -> int:
    """Seed the starter eras once; returns the number of eras added. Never raises."""
    if not enabled():
        _log.info("genre eras seed disabled (AUDIO_GENRE_ERAS_SEED=0)")
        return 0
    try:
        if _done():
            return 0
        added = _apply()
        _log.info("genre eras seeded: %d", added)
        return added
    except Exception:
        _log.exception("genre eras seed failed; the eras file is unchanged")
        return 0
