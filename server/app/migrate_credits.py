"""One-time rewrite of stored songs from the legacy artist, remixer, remix_year and year keys to structured credits and versions (DATA-125); idempotent, run at startup.

Nothing is split beyond the pill separators; ambiguous credits go to a review file as suggestions only."""

from __future__ import annotations

import json
import logging
import shutil
from collections import Counter
from pathlib import Path
from typing import Any

from . import credits, credits_split, deps, library
from .jsonio import write_json_atomic

BACKUP_DIR = "backups-credits"
_log = logging.getLogger(__name__)


SPLIT_FLAGS = frozenset({
    "feat_in_artist", "feat_in_title", "multi_artist_in_one_pill", "remix_text_in_title", "mixed_by", "live", "acoustic",
    "unplugged", "extended", "instrumental", "remaster", "edit", "cover",
})


def _suggested(song: dict[str, Any], raw: dict[str, Any]) -> dict[str, Any]:
    found = credits_split.suggest(raw.get("artist"), raw.get("title"), raw.get("remixer"))
    version = song.get("version") if isinstance(song.get("version"), dict) else None
    out: dict[str, Any] = {}
    if found["artists"] and found["artists"] != song.get("artists"):
        out["artists"] = found["artists"]
    if found["featured"] and found["featured"] != song.get("featured"):
        out["featured"] = found["featured"]
    if found["title"] and found["title"] != song.get("title"):
        out["title"] = found["title"]
    wanted = found["version"]
    if wanted and (version is None or version.get("kind") != wanted["kind"] or (wanted["by"] and not version.get("by"))):
        out["version"] = {"kind": wanted["kind"], "by": wanted["by"]}
        if wanted.get("of"):
            out["version"]["of"] = wanted["of"]
        elif "cover_performer" in found["notes"]:
            out["version"]["performer"] = credits_split.cover_name(wanted["name"])
        elif "cover_ambiguous" in found["notes"]:
            out["version"]["ambiguous"] = True
        if "mashup_makers_unknown" in found["notes"]:
            out["version"]["ambiguous"] = True
    return out


def _items(songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Songs whose original strings hold something a person should look at; suggestions only, never applied."""
    items: list[dict[str, Any]] = []
    for song in songs:
        raw = song.get("raw") if isinstance(song.get("raw"), dict) else {}
        found = set(credits_split.review_flags(raw)) - {"blank_artist"} if raw else set()
        if not song.get("artists") and not song.get("featured"):
            found.add("blank_artist")
        flags = [f for f in credits_split.FLAGS if f in found]
        suggested = _suggested(song, raw) if raw else {}
        if not (set(flags) - SPLIT_FLAGS) and not suggested:
            continue
        items.append({"id": song.get("id"), "title": raw.get("title", song.get("title")), "artist": raw.get("artist"),
                      "remixer": raw.get("remixer"), "flags": flags, "suggested": suggested})
    return items


def _stale(path: Path) -> bool:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    songs = raw.get("songs") if isinstance(raw, dict) else raw
    if not isinstance(songs, list):
        return False
    settings = raw.get("settings") if isinstance(raw, dict) else None
    if not isinstance(settings, dict) or settings.get("credits_schema") != credits.SCHEMA:
        return True
    return any(isinstance(s, dict) and (not isinstance(s.get("artists"), list) or any(k in s for k in credits.LEGACY_KEYS)) for s in songs)


def backup_path(path: Path) -> Path:
    """`<repo root>/backups-credits/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    base = deps.SYNC.data_repo if deps.SYNC else deps.data_root()
    return base / BACKUP_DIR / path.parent.name / path.name


def review_path(path: Path) -> Path:
    """`<repo root>/backups-credits/review-credits-<uid>.json`, next to the backups."""
    return backup_path(path).parent.parent / f"review-credits-{path.parent.name}.json"


def report(path: Path) -> dict[str, Any]:
    return {"uid": path.parent.name, "schema": credits.SCHEMA, "items": _items(library.load(path))}


def write_review(path: Path) -> int:
    """Write the review file when its content changed (the library is never touched); returns the number of songs listed."""
    data = report(path)
    target = review_path(path)
    try:
        same = json.loads(target.read_text(encoding="utf-8")) == data
    except (OSError, ValueError):
        same = False
    if not same:
        write_json_atomic(target, data)
    if data["items"]:
        counts = Counter(flag for item in data["items"] for flag in item["flags"])
        _log.warning("credits review: %d songs for %s: %s (see %s)", len(data["items"]), path.parent.name[:8],
                     ", ".join(f"{flag} {n}" for flag, n in sorted(counts.items())), target.name)
    return len(data["items"])


def migrate(path: Path) -> bool:
    """Rewrite one library.json to the structured shape; keeps a one-time backup first. True when rewritten."""
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
            if _stale(lib):
                with deps.tx(uid, "migrate credits"):
                    done += migrate(lib)
                _log.info("credits migrated for %s", uid[:8])
        except Exception:
            _log.exception("credits migration failed for %s", uid[:8])
        try:
            write_review(lib)
        except Exception:
            _log.exception("credits review report failed for %s", uid[:8])
    return done
