"""One-off, owner-approved removal (and optional addition) of genres from the owner's library (TAG-109), applied at server start; idempotent via a marker holding the hash of the removal file."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from . import deps, genre_filter, library, users
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
        if isinstance(row, dict) and row.get("clear") is True:
            if "remove" in row or "add" in row:
                raise ValueError(f"clear row for {sid} must not have remove or add")
            plan[str(sid)] = []
            continue
        remove = row.get("remove") if isinstance(row, dict) else None
        if not isinstance(remove, list) or not all(isinstance(g, str) and g.strip() for g in remove):
            raise ValueError(f"bad removal row for {sid}")
        plan[str(sid)] = [g.strip().lower() for g in remove]
    return plan, hashlib.sha256(raw).hexdigest()


def load_clears(path: Path | None = None) -> set[str]:
    """Ids of the rows marked `"clear": true`: every genre of the song is removed (the only case where a song may end with none)."""
    doc = json.loads((path or DATA_FILE).read_bytes().decode("utf-8"))
    return {str(sid) for sid, row in doc["songs"].items() if isinstance(row, dict) and row.get("clear") is True}


def load_adds(path: Path | None = None) -> dict[str, list[str]]:
    """`{song id: [genre, ...]}` from the optional per-song `add` lists of the removal file; a row without `add` is absent."""
    doc = json.loads((path or DATA_FILE).read_bytes().decode("utf-8"))
    out: dict[str, list[str]] = {}
    for sid, row in doc["songs"].items():
        add = row.get("add", []) if isinstance(row, dict) else []
        if not isinstance(add, list) or not all(isinstance(g, str) and g.strip() for g in add):
            raise ValueError(f"bad addition row for {sid}")
        if add:
            out[str(sid)] = [" ".join(g.lower().split()) for g in add]
    return out


def _add_genres(tags: list[str], wanted: list[str], unknown: list[str]) -> tuple[list[str], list[str]]:
    """Append the wanted vocabulary genres not yet on the song after its last `genre:` tag; names outside the vocabulary go to `unknown`."""
    present = [t.partition(":")[2] for t in tags if namespace(t) == "genre"]
    added: list[str] = []
    for genre in dict.fromkeys(wanted):
        name = genre_filter.vocabulary_name(genre, present)
        if name is None:
            unknown.append(genre)
        elif name not in present:
            present.append(name)
            added.append(name)
    if added:
        at = max((i for i, t in enumerate(tags) if namespace(t) == "genre"), default=-1) + 1
        tags = [*tags[:at], *(f"genre:{g}" for g in added), *tags[at:]]
    return tags, added


def apply_plan(songs: list[dict[str, Any]], plan: dict[str, list[str]], adds: dict[str, list[str]] | None = None, clears: set[str] | None = None) -> dict[str, Any]:
    """Add the `adds` genres, then remove the planned genres, on working songs in place (`tags` holds `genre:` entries); only present genres are removed, never the last one, and an added genre is never removed; a song in `clears` loses every genre. Returns `{"removed", "added", "cleared", "skipped", "unknown"}`, each `{id: [...]}`."""
    adds = adds or {}
    clears = clears or set()
    cleared: dict[str, list[str]] = {}
    removed: dict[str, list[str]] = {}
    added: dict[str, list[str]] = {}
    skipped: dict[str, list[str]] = {}
    unknown: dict[str, list[str]] = {}
    for song in songs:
        sid = str(song.get("id"))
        wanted = plan.get(sid)
        if not (wanted or adds.get(sid) or sid in clears) or not isinstance(song.get("tags"), list):
            continue
        if sid in clears:
            gone = [t.partition(":")[2] for t in song["tags"] if namespace(t) == "genre"]
            if gone:
                cleared[sid] = list(dict.fromkeys(gone))
                song["tags"] = [t for t in song["tags"] if namespace(t) != "genre"]
            continue
        tags = [str(t) for t in song["tags"]]
        if adds.get(sid):
            bad: list[str] = []
            tags, new = _add_genres(tags, adds[sid], bad)
            if new:
                added[sid] = new
                song["tags"] = tags
            if bad:
                unknown[sid] = bad
        wanted = [g for g in wanted or [] if g not in added.get(sid, [])]
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
    return {"removed": removed, "added": added, "cleared": cleared, "skipped": skipped, "unknown": unknown}


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


def _apply(uid: str, lib: Path, plan: dict[str, list[str]], digest: str, adds: dict[str, list[str]] | None = None, clears: set[str] | None = None) -> tuple[int, int, int]:
    with deps.tx(uid, "remove approved genres"):
        doc = library.load_doc(lib)
        result = apply_plan(doc["songs"], plan, adds, clears)
        removed, added, cleared, skipped, unknown = result["removed"], result["added"], result["cleared"], result["skipped"], result["unknown"]
        genres = sum(len(v) for v in removed.values())
        gained = sum(len(v) for v in added.values())
        touched = len(set(removed) | set(added) | set(cleared))
        report = {"uid": uid, "sha256": digest, "removed": removed, "added": added, "cleared": cleared, "skipped": skipped, "unknown": unknown}
        if removed or added or cleared:
            backup = backup_path(uid)
            if not backup.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(lib, backup)
            write_json_atomic(report_path(uid), report)
            library.save_doc(lib, doc)
        write_json_atomic(marker_path(uid), {"sha256": digest, "songs": touched, "genres": genres, "added": gained, "cleared": len(cleared), "skipped": sum(len(v) for v in skipped.values())})
    for sid, gs in skipped.items():
        _log.info("genre removal skipped for %s: song %s would be left without a genre (%s)", uid[:8], sid, ", ".join(gs))
    for sid, gs in unknown.items():
        _log.info("genre addition skipped for %s: song %s, not in the vocabulary (%s)", uid[:8], sid, ", ".join(gs))
    return touched, genres, gained


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
        songs, genres, gained = _apply(uid, lib, plan, digest, load_adds(), load_clears())
        _log.info("genre removals applied for %s: %d songs, %d removed, %d added", uid[:8], songs, genres, gained)
        return genres
    except Exception:
        _log.exception("genre removals failed; the library is unchanged")
        return 0
