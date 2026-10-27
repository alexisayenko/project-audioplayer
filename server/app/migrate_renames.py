"""One-off rename of genre tags whose vocabulary node was renamed (TAG-110): `genre:hardcore` becomes `genre:hardcore techno` on every user's songs (decision AX1). Run at server start after the other tag migrations; idempotent, with a one-time backup and a marker per user. Deliberately not an alias: a bare `hardcore` typed later is ambiguous (punk, hip hop, techno) and is never resolved to the renamed genre."""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from . import deps, library, migration
from .tags import namespace

BACKUP_DIR = "backups-genre-rename"
RENAMES: dict[str, str] = {"hardcore": "hardcore techno"}
_log = logging.getLogger(__name__)


def digest() -> str:
    return hashlib.sha256(json.dumps(RENAMES, sort_keys=True).encode("utf-8")).hexdigest()


def backup_path(uid: str) -> Path:
    """`<repo root>/backups-genre-rename/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    return migration.user_backup(BACKUP_DIR, uid)


def marker_path(uid: str) -> Path:
    return migration.marker_beside(backup_path(uid))


def _done(uid: str) -> bool:
    return migration.marker_has(marker_path(uid), "sha256", digest())


def rename_tags(tags: list[str]) -> list[str]:
    """`genre:` tags renamed in place (exact lowercase value, spaces collapsed); a rename whose target the song already has drops the old tag."""
    out: list[str] = []
    for t in tags:
        if namespace(t) == "genre":
            new = RENAMES.get(" ".join(t.partition(":")[2].lower().split()))
            if new:
                t = f"genre:{new}"
        if t not in out:
            out.append(t)
    return out


def apply_renames(songs: list[dict[str, Any]]) -> list[str]:
    """Rename on working songs in place; returns the ids changed (a rerun changes none)."""
    changed: list[str] = []
    for song in songs:
        tags = song.get("tags")
        if not isinstance(tags, list):
            continue
        tags = [str(t) for t in tags]
        new = rename_tags(tags)
        if new != tags:
            song["tags"] = new
            changed.append(str(song.get("id")))
    return changed


def _apply(uid: str, lib: Path) -> int:
    with deps.tx(uid, "rename genre tags"):
        doc = library.load_doc(lib)
        changed = apply_renames(doc["songs"])
        if changed:
            migration.backup_once(lib, backup_path(uid))
            library.save_doc(lib, doc)
        migration.write_marker(marker_path(uid), {"sha256": digest(), "songs": len(changed), "renames": RENAMES})
    return len(changed)


def run() -> int:
    """Rename the genre tags in every user's library once; returns the number of songs changed. Never raises."""
    return migration.run_for_libraries(_done, _apply, "genre tags renamed for %s: %d songs", "genre rename failed for %s; the library is unchanged")
