"""Generic one-off pass (TAG-111): genres that are no longer genres (`server/data/retired_genres.json`, first `electronic`) are removed from the songs of EVERY user at server start. Per user a marker keeps the set of names already applied, so a name added to the list later runs only for itself and a retired genre the user adds again afterwards is not stripped a second time. A song left without a genre stays without one (unlike migrate_removals)."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any

from . import deps, library
from .jsonio import write_json_atomic
from .tags import namespace

BACKUP_DIR = "backups-genre-retired"
DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "retired_genres.json"
_log = logging.getLogger(__name__)


def enabled() -> bool:
    return os.environ.get("AUDIO_GENRE_RETIRED", "1").strip() != "0"


def load_names(path: Path | None = None) -> list[str]:
    """The retired genre names, lowercase, spaces collapsed, no duplicates; raises ValueError on a malformed file."""
    doc = json.loads((path or DATA_FILE).read_bytes().decode("utf-8"))
    names = doc.get("genres") if isinstance(doc, dict) else None
    if not isinstance(names, list) or not all(isinstance(n, str) and n.strip() for n in names):
        raise ValueError("retired genres file has no genres list")
    return list(dict.fromkeys(" ".join(n.lower().split()) for n in names))


def digest(names: list[str]) -> str:
    return hashlib.sha256(json.dumps(sorted(names)).encode("utf-8")).hexdigest()


def base_dir() -> Path:
    return deps.SYNC.data_repo if deps.SYNC else deps.data_root()


def backup_path(uid: str) -> Path:
    """`<repo root>/backups-genre-retired/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    return base_dir() / BACKUP_DIR / uid / "library.json"


def marker_path(uid: str) -> Path:
    return backup_path(uid).parent / "applied.json"


def report_path(uid: str) -> Path:
    return backup_path(uid).parent / "report.json"


def applied_names(uid: str) -> set[str]:
    try:
        doc = json.loads(marker_path(uid).read_text(encoding="utf-8"))
        return {str(n) for n in doc["applied"]}
    except (OSError, ValueError, KeyError, TypeError):
        return set()


def apply_retired(songs: list[dict[str, Any]], names: list[str]) -> dict[str, Any]:
    """Remove the `genre:` tags named in `names` from working songs in place, keeping order and every other tag. Returns `{"removed": {name: count}, "touched": [ids], "empty": [{"id", "title"}]}`; `empty` lists the touched songs that now have no genre."""
    drop = set(names)
    removed: dict[str, int] = {}
    touched: list[str] = []
    empty: list[dict[str, str]] = []
    for song in songs:
        tags = song.get("tags")
        if not isinstance(tags, list):
            continue
        keep: list[str] = []
        hit = False
        for t in (str(x) for x in tags):
            name = " ".join(t.partition(":")[2].lower().split())
            if namespace(t) == "genre" and name in drop:
                removed[name] = removed.get(name, 0) + 1
                hit = True
            else:
                keep.append(t)
        if not hit:
            continue
        song["tags"] = keep
        touched.append(str(song.get("id")))
        if not any(namespace(t) == "genre" for t in keep):
            empty.append({"id": str(song.get("id")), "title": str(song.get("title", ""))})
    return {"removed": removed, "touched": touched, "empty": empty}


def _apply(uid: str, lib: Path, names: list[str]) -> dict[str, Any]:
    with deps.tx(uid, "retire genres"):
        done = applied_names(uid)
        todo = [n for n in names if n not in done]
        doc = library.load_doc(lib)
        result = apply_retired(doc["songs"], todo)
        if result["touched"]:
            backup = backup_path(uid)
            if not backup.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(lib, backup)
            library.save_doc(lib, doc)
        applied = sorted(done | set(names))
        marker = backup_path(uid).parent
        marker.mkdir(parents=True, exist_ok=True)
        if result["touched"]:
            try:
                runs = json.loads(report_path(uid).read_text(encoding="utf-8")).get("runs", [])
            except (OSError, ValueError, AttributeError):
                runs = []
            run = {"names": todo, "removed": result["removed"], "songs_touched": len(result["touched"]), "touched": result["touched"], "left_without_genre": result["empty"]}
            write_json_atomic(report_path(uid), {"uid": uid, "runs": [*runs, run]})
        write_json_atomic(marker_path(uid), {"sha256": digest(applied), "applied": applied})
    return result


def run() -> int:
    """Retire the listed genres in every user's library once per name; returns the number of songs touched. Never raises."""
    if not enabled():
        _log.info("retired genres disabled (AUDIO_GENRE_RETIRED=0)")
        return 0
    total = 0
    try:
        names = load_names()
        users_dir = deps.data_root() / "users"
        libs = sorted(users_dir.glob("*/library.json")) if users_dir.is_dir() else []
    except Exception:
        _log.exception("retired genres failed; the libraries are unchanged")
        return 0
    for lib in libs:
        uid = lib.parent.name
        try:
            if set(names) <= applied_names(uid):
                continue
            result = _apply(uid, lib, names)
            total += len(result["touched"])
            _log.info("retired genres removed for %s: %d songs, %d left without a genre", uid[:8], len(result["touched"]), len(result["empty"]))
        except Exception:
            _log.exception("retired genres failed for %s; the library is unchanged", uid[:8])
    return total
