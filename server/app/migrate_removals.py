"""One-off, owner-approved removal of wrong genres from the owner's library (TAG-109), applied at server start; idempotent via a marker holding the hash of the removal file."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from . import deps, library, users
from .jsonio import write_json_atomic
from .tags import namespace

BACKUP_DIR = "backups-genre-removals"
DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "library_genre_removals.json"
_log = logging.getLogger(__name__)


def enabled() -> bool:
    return os.environ.get("AUDIO_GENRE_REMOVALS", "1").strip() != "0"


def load_plan(path: Path = DATA_FILE) -> tuple[dict[str, list[str]], str]:
    """`({song id: [genre, ...]}, sha256 of the file)`; raises ValueError on a malformed file."""
    raw = path.read_bytes()
    doc = json.loads(raw.decode("utf-8"))
    songs = doc.get("songs") if isinstance(doc, dict) else None
    if not isinstance(songs, dict):
        raise ValueError("removal file has no songs object")
    plan: dict[str, list[str]] = {}
    for sid, row in songs.items():
        remove = row.get("remove") if isinstance(row, dict) else None
        if not isinstance(remove, list) or not all(isinstance(g, str) and g.strip() for g in remove):
            raise ValueError(f"bad removal row for {sid}")
        plan[str(sid)] = [g.strip().lower() for g in remove]
    return plan, hashlib.sha256(raw).hexdigest()


def apply_plan(songs: list[dict[str, Any]], plan: dict[str, list[str]]) -> dict[str, Any]:
    """Remove the planned genres from working songs in place (`tags` holds `genre:` entries); only present genres, never the last one. Returns `{"removed": {id: [...]}, "skipped": {id: [...]}}`."""
    removed: dict[str, list[str]] = {}
    skipped: dict[str, list[str]] = {}
    for song in songs:
        sid = str(song.get("id"))
        wanted = plan.get(sid)
        if not wanted or not isinstance(song.get("tags"), list):
            continue
        tags = [str(t) for t in song["tags"]]
        present = [t.partition(":")[2] for t in tags if namespace(t) == "genre"]
        left = list(dict.fromkeys(present))
        for genre in dict.fromkeys(wanted):
            if genre not in left:
                continue
            if len(left) == 1:
                skipped.setdefault(sid, []).append(genre)
                continue
            left.remove(genre)
            removed.setdefault(sid, []).append(genre)
        gone = set(removed.get(sid, []))
        if gone:
            song["tags"] = [t for t in tags if not (namespace(t) == "genre" and t.partition(":")[2] in gone)]
    return {"removed": removed, "skipped": skipped}


def base_dir() -> Path:
    return deps.SYNC.data_repo if deps.SYNC else deps.data_root()


def backup_path(uid: str) -> Path:
    """`<repo root>/backups-genre-removals/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    return base_dir() / BACKUP_DIR / uid / "library.json"


def marker_path(uid: str) -> Path:
    return backup_path(uid).parent / "applied.json"


def report_path(uid: str) -> Path:
    return backup_path(uid).parent / "report.json"


def _done(uid: str, digest: str) -> bool:
    try:
        return json.loads(marker_path(uid).read_text(encoding="utf-8")).get("sha256") == digest
    except (OSError, ValueError, AttributeError):
        return False


def _apply(uid: str, lib: Path, plan: dict[str, list[str]], digest: str) -> tuple[int, int]:
    with deps.tx(uid, "remove approved genres"):
        doc = library.load_doc(lib)
        result = apply_plan(doc["songs"], plan)
        removed, skipped = result["removed"], result["skipped"]
        genres = sum(len(v) for v in removed.values())
        report = {"uid": uid, "sha256": digest, "removed": removed, "skipped": skipped}
        if removed:
            backup = backup_path(uid)
            if not backup.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(lib, backup)
            write_json_atomic(report_path(uid), report)
            library.save_doc(lib, doc)
        write_json_atomic(marker_path(uid), {"sha256": digest, "songs": len(removed), "genres": genres, "skipped": sum(len(v) for v in skipped.values())})
    for sid, gs in skipped.items():
        _log.info("genre removal skipped for %s: song %s would be left without a genre (%s)", uid[:8], sid, ", ".join(gs))
    return len(removed), genres


def run() -> int:
    """Apply the removal list to the owner's library once; returns the number of genres removed. Never raises."""
    if not enabled():
        _log.info("genre removals disabled (AUDIO_GENRE_REMOVALS=0)")
        return 0
    try:
        plan, digest = load_plan()
        uid = users.owner_uid()
        lib = deps.library_path(uid)
        if not lib.is_file() or _done(uid, digest):
            return 0
        songs, genres = _apply(uid, lib, plan, digest)
        _log.info("genre removals applied for %s: %d songs, %d genres", uid[:8], songs, genres)
        return genres
    except Exception:
        _log.exception("genre removals failed; the library is unchanged")
        return 0
