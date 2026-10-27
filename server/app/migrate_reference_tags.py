"""One-off pass (task-0093, ADR-0044): on the OWNER's library only, every song tag `classical <genre>` (bare, or `genre:classical <genre>`) whose `<genre>` resolves to a vocabulary genre becomes a reference track of that genre (role `archetype`, `reviewed` false, sources empty, `song_id`, artist, title and year from the song), and the tag is removed from the song. Unresolvable tags stay and are logged; a tag that is itself a genre (`modern classical` is not touched, nor is `classical music`). Idempotent, with a one-time backup of the library and the catalogue and a marker; `AUDIO_REFERENCE_TAGS=0` disables it."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from . import deps, genre_references as refs, library, migration, users
from .problems import Problem
from .tags import namespace

BACKUP_DIR = "backups-reference-tags"
MARKER_VERSION = 1
PREFIX = "classical "
_log = logging.getLogger(__name__)


def enabled() -> bool:
    return migration.enabled("AUDIO_REFERENCE_TAGS")


def backup_path(uid: str) -> Path:
    """`<repo root>/backups-reference-tags/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree; the catalogue backup sits next to it."""
    return migration.user_backup(BACKUP_DIR, uid)


def marker_path(uid: str) -> Path:
    return migration.marker_beside(backup_path(uid))


def _done(uid: str) -> bool:
    return migration.marker_has(marker_path(uid), "marker", MARKER_VERSION)


def parse_tag(tag: Any) -> str | None:
    """The genre spelling after `classical ` in a bare or `genre:` tag, else None."""
    text = str(tag)
    ns = namespace(text)
    if ns not in ("", "genre"):
        return None
    value = " ".join((text.partition(":")[2] if ns else text).split())
    if not value.casefold().startswith(PREFIX) or refs.resolve_genre(value):
        return None
    rest = value[len(PREFIX):].strip()
    return rest or None


def _convert_tag(song: dict[str, Any], tag: Any, doc: dict[str, list[dict[str, Any]]]) -> str:
    """"plain" (not a reference tag), "left" (kept as it is), "existing" (already a reference) or "converted"; the last two drop the tag."""
    rest = parse_tag(tag)
    if rest is None:
        return "plain"
    genre = refs.resolve_genre(rest)
    if genre is None:
        _log.info("reference tag left untouched (no such genre): %r on %s", str(tag), song.get("id"))
        return "left"
    facts = refs.song_facts(song)
    try:
        entry = refs.make_entry(doc, genre, {**facts, "role": "archetype", "song_id": str(song.get("id"))}, reviewed=False)
    except Problem as exc:
        if exc.status != 409:
            _log.info("reference tag left untouched (%s): %r on %s", exc.code, str(tag), song.get("id"))
            return "left"
        return "existing"
    doc.setdefault(genre, []).append(entry)
    return "converted"


def convert(songs: list[dict[str, Any]], doc: dict[str, list[dict[str, Any]]]) -> tuple[int, int, int]:
    """Convert in place: returns (converted tags, tags already a reference, left unresolved). Songs get the tag removed; `doc` gets the entries."""
    counts = {"converted": 0, "existing": 0, "left": 0}
    for song in songs:
        tags = song.get("tags") or []
        keep: list[Any] = []
        for tag in tags:
            outcome = _convert_tag(song, tag, doc)
            if outcome in counts:
                counts[outcome] += 1
            if outcome in ("plain", "left"):
                keep.append(tag)
        if len(keep) != len(tags):
            song["tags"] = keep
            song["updated_at"] = library.now_utc()
    return counts["converted"], counts["existing"], counts["left"]


def _apply(uid: str, lib: Path) -> tuple[int, int, int]:
    with deps.tx(uid, "convert reference tags"):
        doc = library.load_doc(lib)
        catalogue = refs.load()
        counts = convert(doc["songs"], catalogue)
        if counts[0] or counts[1]:
            backup = backup_path(uid)
            migration.backup_once(lib, backup)
            if refs.path().exists():
                migration.backup_once(refs.path(), backup.parent / refs.FILE_NAME)
            refs.save(catalogue)
            library.save_doc(lib, doc)
        migration.write_marker(marker_path(uid), {"marker": MARKER_VERSION, "converted": counts[0], "existing": counts[1], "left": counts[2]})
    return counts


def run() -> int:
    """Convert the owner's `classical <genre>` tags once; returns the number of entries created. Never raises."""
    if not enabled():
        _log.info("reference tag conversion disabled (AUDIO_REFERENCE_TAGS=0)")
        return 0
    uid = users.owner_uid()
    lib = deps.library_path(uid)
    try:
        if _done(uid) or not lib.is_file():
            return 0
        converted, existing, left = _apply(uid, lib)
        _log.info("reference tags for %s: %d converted, %d already references, %d left untouched", uid[:8], converted, existing, left)
        return converted
    except Exception:
        _log.exception("reference tag conversion failed for %s; the library is unchanged", uid[:8])
        return 0
