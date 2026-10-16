"""One-time rewrite of a stored library to data model v2 (DATA-151..153, ADR-0025); idempotent, dry-run first, refuses to run twice.

`convert` is a pure function over the raw JSON of the deployed shape (flat legacy or ADR-0024; v2 songs pass through), `check` proves that the five legacy derived fields of every song are unchanged, and `migrate` adds the backup, the review files and the atomic write.

    python -m app.migrate_model2 --library users/<uid>/library.json [--report report.json]            # dry run, writes nothing else
    python -m app.migrate_model2 --library users/<uid>/library.json --apply [--backup-dir DIR]        # backup, then rewrite
"""

from __future__ import annotations

import argparse
import copy
import json
import logging
import shutil
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from . import artist_table, credits, credits_v1, deps, library
from .jsonio import write_json_atomic

BACKUP_DIR = "backups-model2"
LEGACY_FIELDS = ("artist", "remixer", "year", "remix_year", "album")
SAMPLE = 20
_log = logging.getLogger(__name__)


class MigrationAborted(Exception):
    """The check found a song whose derived legacy fields would change; nothing was written."""

    def __init__(self, report: dict[str, Any]) -> None:
        super().__init__(f"{len(report['legacy_diffs'])} songs would change their derived legacy fields")
        self.report = report


def _songs_of(raw: Any) -> list[Any]:
    songs = raw.get("songs") if isinstance(raw, dict) else raw
    return songs if isinstance(songs, list) else []


def is_model2(raw: Any) -> bool:
    """True when the file already is data model v2: the schema stamp is 2 and every song has the v2 shape."""
    settings = raw.get("settings") if isinstance(raw, dict) else None
    if not isinstance(settings, dict) or settings.get("credits_schema") != credits.SCHEMA:
        return False
    return all(isinstance(s, dict) and credits_v1.is_v2(s) and not any(k in s for k in credits.LEGACY_KEYS) for s in _songs_of(raw))


def _oracle(song: dict[str, Any]) -> dict[str, Any]:
    """The five legacy derived fields of a song as the deployed code derived them."""
    return credits.project(song) if credits_v1.is_v2(song) else credits_v1.project_v1(song)


def _normalised(values: dict[str, Any]) -> dict[str, Any]:
    return {k: (values.get(k).strip() or None) if isinstance(values.get(k), str) else values.get(k) for k in LEGACY_FIELDS}


def _tag_set(tags: Any) -> set[str]:
    return {str(t).casefold() for t in tags if isinstance(t, str)} if isinstance(tags, list) else set()


def convert(raw: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    """`(new_doc, report)` for the raw JSON of one library file. Pure: the input is not modified."""
    raw = copy.deepcopy(raw)
    settings = dict(raw.get("settings") or {}) if isinstance(raw, dict) else {}
    old_table = artist_table.parse(raw.get("artists") if isinstance(raw, dict) else None)
    removed: Counter[str] = Counter()
    types: Counter[str] = Counter()
    diffs: list[dict[str, Any]] = []
    tag_changes: list[dict[str, Any]] = []
    decade_off: list[str] = []
    raw_kept: list[str] = []
    converted = 0
    per_artist: dict[str, list[tuple[str, tuple[str, ...]]]] = {}
    multi: list[dict[str, Any]] = []
    new_songs: list[dict[str, Any]] = []
    olds: list[dict[str, Any]] = []
    for song in _songs_of(raw):
        if not isinstance(song, dict):
            continue
        old = copy.deepcopy(song)
        expected = _normalised(_oracle(old))
        new = copy.deepcopy(song)
        if credits.ensure(new):
            converted += 1
        if "tags" in new:
            kept, countries, gone = library.split_tags(new["tags"] or [])
            new["tags"] = kept
            removed.update(gone)
            year_decade = library.decade_tag(credits.release_year(new))
            if any(t.startswith("decade:") and t.casefold() != (year_decade or "").casefold() for t in map(str, old.get("tags") or [])):
                decade_off.append(str(new.get("id")))
        else:
            countries = []
        if isinstance(new.get("sources"), list):
            new["sources"] = library.clean_sources(new["sources"])
        names = credits.main_artists(new)
        if countries and len(names) == 1:
            per_artist.setdefault(artist_table.key(names[0]), []).append((names[0], tuple(countries)))
        elif countries:
            multi.append({"id": new.get("id"), "mainArtists": names, "countries": countries})
        if new.get("raw"):
            raw_kept.append(str(new.get("id")))
        if isinstance(new.get("version"), dict):
            types[str(new["version"].get("type"))] += 1
        actual = _normalised(credits.project(new))
        if actual != expected:
            diffs.append({"id": new.get("id"), "before": expected, "after": actual})
        new_songs.append(new)
        olds.append(old)

    table = [dict(e) for e in old_table]
    conflicts: list[dict[str, Any]] = []
    for k, found in per_artist.items():
        sets = list(dict.fromkeys(c for _, c in found))
        if len(sets) == 1 and not (artist_table.find(table, found[0][0]) or {}).get("countries"):
            artist_table.set_countries(table, found[0][0], sets[0])
        elif len(sets) > 1:
            conflicts.append({"artist": found[0][0], "countries": [list(s) for s in sets]})
    artist_table.sync_names(table, new_songs)
    idx = artist_table.index(table)
    for old, new in zip(olds, new_songs):
        before, after = _tag_set(old.get("tags")), _tag_set(library.view_tags(new, idx))
        if before != after:
            tag_changes.append({"id": new.get("id"), "removed": sorted(before - after), "added": sorted(after - before)})

    doc = {"settings": {**settings, "credits_schema": credits.SCHEMA}, "songs": new_songs, "artists": table}
    report = {
        "songs": len(new_songs),
        "songs_converted": converted,
        "tags_removed": {k: removed.get(k, 0) for k in ("decade", "lang", "country")},
        "decade_tags_disagreeing_with_release_year": len(decade_off),
        "version_types": dict(sorted(types.items())),
        "raw_kept": raw_kept,
        "artists": {"total": len(table), "with_countries": sum(1 for e in table if e["countries"])},
        "review": {"multi_artist_countries": multi, "conflicting_countries": conflicts},
        "legacy_diffs": diffs,
        "tag_view_changes": {"songs": len(tag_changes), "sample": tag_changes[:SAMPLE]},
        "ok": not diffs,
    }
    return doc, report


def check(report: dict[str, Any]) -> None:
    """Abort when any song would change its derived legacy fields (DATA-151)."""
    if report["legacy_diffs"]:
        raise MigrationAborted(report)


def backup_path(path: Path, backup_dir: Path | None = None) -> Path:
    """`<repo root>/backups-model2/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    if backup_dir is not None:
        return backup_dir / path.name
    base = deps.SYNC.data_repo if deps.SYNC else deps.data_root()
    return base / BACKUP_DIR / path.parent.name / path.name


def review_path(path: Path, backup_dir: Path | None = None) -> Path:
    folder = backup_dir if backup_dir is not None else backup_path(path).parent.parent
    return folder / f"review-model2-{path.parent.name}.json"


def _free(target: Path) -> Path:
    if not target.exists():
        return target
    n = 1
    while (numbered := target.with_name(f"{target.stem}.{n}{target.suffix}")).exists():
        n += 1
    return numbered


def migrate(path: Path, apply: bool = False, report_path: Path | None = None, backup_dir: Path | None = None) -> dict[str, Any]:
    """Convert one library file. `status`: `dry_run`, `migrated`, `already_migrated` or `aborted` (the report says why; nothing is written then, except the report file)."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"status": "missing"}
    if is_model2(raw):
        out: dict[str, Any] = {"status": "already_migrated", "songs": len(_songs_of(raw))}
    else:
        doc, out = convert(raw)
        try:
            check(out)
        except MigrationAborted:
            out["status"] = "aborted"
        else:
            out["status"] = "migrated" if apply else "dry_run"
            if apply:
                backup = _free(backup_path(path, backup_dir))
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, backup)
                out["backup"] = str(backup)
                if out["review"]["multi_artist_countries"] or out["review"]["conflicting_countries"] or out["raw_kept"]:
                    write_json_atomic(review_path(path, backup_dir), {"uid": path.parent.name, "review": out["review"], "raw_kept": out["raw_kept"]})
                write_json_atomic(path, doc)
    if report_path is not None:
        write_json_atomic(report_path, out)
    return out


def run() -> int:
    """Startup: migrate every user's library; returns the number rewritten. A song whose derived fields would change stops that library (logged), the server still serves it."""
    users_dir = deps.data_root() / "users"
    if not users_dir.is_dir():
        return 0
    done = 0
    for lib in sorted(users_dir.glob("*/library.json")):
        uid = lib.parent.name
        try:
            raw = json.loads(lib.read_text(encoding="utf-8"))
            if is_model2(raw):
                continue
            with deps.tx(uid, "migrate data model 2"):
                result = migrate(lib, apply=True)
            if result["status"] == "aborted":
                _log.error("data model 2 migration aborted for %s: %d songs would change (first: %s)", uid[:8],
                           len(result["legacy_diffs"]), json.dumps(result["legacy_diffs"][:1], ensure_ascii=False))
            elif result["status"] == "migrated":
                done += 1
                _log.info("data model 2 migrated for %s: %s", uid[:8], json.dumps({k: result[k] for k in ("songs", "tags_removed", "artists")}))
        except Exception:
            _log.exception("data model 2 migration failed for %s", uid[:8])
    return done


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Migrate one library.json to data model v2 (dry run unless --apply).")
    parser.add_argument("--library", required=True, type=Path)
    parser.add_argument("--apply", action="store_true", help="back up and rewrite the file")
    parser.add_argument("--report", type=Path, help="write the JSON report here")
    parser.add_argument("--backup-dir", type=Path, help="where --apply puts the backup (default: <data repo>/backups-model2/<uid>/)")
    args = parser.parse_args(argv)
    result = migrate(args.library, apply=args.apply, report_path=args.report, backup_dir=args.backup_dir)
    brief = {k: v for k, v in result.items() if k not in ("legacy_diffs", "tag_view_changes", "raw_kept", "review")}
    brief.update(legacy_diffs=len(result.get("legacy_diffs", [])), raw_kept=len(result.get("raw_kept", [])),
                 tag_view_changes=result.get("tag_view_changes", {}).get("songs", 0))
    print(json.dumps(brief, ensure_ascii=False, indent=2))
    return 0 if result["status"] in ("dry_run", "migrated", "already_migrated") else 1


if __name__ == "__main__":
    sys.exit(main())
