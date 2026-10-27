"""One-time rewrite of stored genre tags to their canonical spelling, junk drops, demonym prefixes and retags (TAG-060, TAG-073, TAG-074, TAG-075); idempotent, run at startup. Tags the vocabulary cannot map are kept and listed in a review file (TAG-082); retired genres (TAG-111) are not listed, they are removed at the end of the same start."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from . import deps, genre_filter, genre_vocab, library, migrate_retired, migration, users
from .jsonio import write_json_atomic
from .tags import namespace, namespaced_values

BACKUP_DIR = "backups-genre-merge"
SAMPLE_IDS = 5
_log = logging.getLogger(__name__)

ONE_OFF: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "RVmG_d3HKBA": (("genre:swing",), ()),
    "soundcloud-168294142": ((), ("genre:glitch hop",)),
    "soundcloud-122880128": ((), ("genre:house",)),
    "soundcloud-158983912": ((), ("genre:house",)),
    "JYIaWeVL1JM": (("genre:hardcore",), ()),
    "ylpNEb31k4U": (("genre:hardcore", "genre:dubstep", "genre:techno"), ()),
    "soundcloud-193950580": (("genre:hip hop", "genre:pop punk", "genre:hardstyle"), ()),
}


def _addable(tag: str, retired: set[str]) -> bool:
    name = " ".join(tag.partition(":")[2].lower().split())
    return name not in retired and genre_vocab.is_canonical(name)


def apply_one_off(songs: list[dict[str, Any]]) -> list[str]:
    """TAG-085, one-off: per song id, remove a wrong genre tag and give a song left without any `genre:` tag its target genre. A target that is retired (TAG-111) or not a canonical genre is never added and counts as satisfied. Returns the ids changed; a rerun changes nothing."""
    changed: list[str] = []
    retired = set(migrate_retired.load_names())
    for song in songs:
        rule = ONE_OFF.get(str(song.get("id")))
        if not rule:
            continue
        remove, add = rule
        add = tuple(t for t in add if _addable(t, retired))
        tags = [str(t) for t in song.get("tags") or []]
        new = [t for t in tags if t not in remove]
        if add and not any(namespace(t) == "genre" for t in new):
            new += [t for t in add if t not in new]
        if new != tags:
            song["tags"] = new
            changed.append(str(song.get("id")))
    return changed


def one_off_pending(path: Path) -> bool:
    """True when the loaded (cleaned) library still needs `apply_one_off`; only the owner's library is ever touched."""
    if path.parent.name != users.owner_uid():
        return False
    songs = library.load(path)
    return bool(apply_one_off([dict(s) for s in songs if str(s.get("id")) in ONE_OFF]))


def _stale(path: Path) -> bool:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    songs = raw.get("songs") if isinstance(raw, dict) else raw
    if not isinstance(songs, list):
        return False
    for s in songs:
        tags = library.tag_list(s) if isinstance(s, dict) else None
        if not tags:
            continue
        watched = [str(t) for t in tags if namespace(t) in ("genre", "country", "lang")]
        if [t for t in library.clean_tags([str(t) for t in tags]) if namespace(t) in ("genre", "country", "lang")] != watched:
            return True
    return False


def backup_path(path: Path) -> Path:
    """`<repo root>/backups-genre-merge/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    return migration.user_backup(BACKUP_DIR, path.parent.name, path.name)


def review_path(path: Path) -> Path:
    """`<repo root>/backups-genre-merge/review-<uid>.json`: next to the backups, outside the git-added `audioplayer/` tree."""
    return backup_path(path).parent.parent / f"review-{path.parent.name}.json"


def unmappable_report(path: Path) -> dict[str, Any]:
    """Genre values of the stored library that are neither junk nor in the vocabulary after ALIASES and RETAGS, with song counts and sample ids (TAG-082); retired genres (TAG-111) are not listed, they are removed at the end of the same start."""
    found: dict[str, list[str]] = {}
    retired = set(migrate_retired.load_names())
    for song in library.load(path):
        for value in dict.fromkeys(namespaced_values(song.get("tags") or [], "genre")):
            if value not in retired and genre_filter.unmappable(value):
                found.setdefault(value, []).append(str(song.get("id")))
    rows = [{"tag": tag, "songs": len(ids), "sample_ids": ids[:SAMPLE_IDS]} for tag, ids in found.items()]
    rows.sort(key=lambda r: (-r["songs"], r["tag"]))
    return {"uid": path.parent.name, "unmappable": rows}


def write_review(path: Path) -> int:
    """Write the review file when its content changed (nothing is ever deleted from the library); returns the number of unmappable tags."""
    report = unmappable_report(path)
    target = review_path(path)
    try:
        same = json.loads(target.read_text(encoding="utf-8")) == report
    except (OSError, ValueError):
        same = False
    if not same:
        write_json_atomic(target, report)
    if report["unmappable"]:
        _log.warning("genre review: %d unmappable genre tags kept for %s (see %s)", len(report["unmappable"]), path.parent.name[:8], target.name)
    return len(report["unmappable"])


def migrate(path: Path) -> bool:
    """Rewrite one library.json when a genre tag is not canonical; keeps a one-time backup first. True when rewritten."""
    if not (_stale(path) or one_off_pending(path)):
        return False
    migration.backup_once(path, backup_path(path))
    doc = library.load_doc(path)
    if path.parent.name == users.owner_uid():
        for sid in apply_one_off(doc["songs"]):
            _log.info("one-off genre fix applied to song %s", sid)
    library.save_doc(path, doc)
    return True


def run() -> int:
    done = 0
    for lib in migration.libraries():
        uid = lib.parent.name
        try:
            if _stale(lib) or one_off_pending(lib):
                with deps.tx(uid, "merge genre tags"):
                    done += migrate(lib)
                _log.info("genre tags merged for %s", uid[:8])
        except Exception:
            _log.exception("genre tag migration failed for %s", uid[:8])
        try:
            write_review(lib)
        except Exception:
            _log.exception("genre review report failed for %s", uid[:8])
    return done
