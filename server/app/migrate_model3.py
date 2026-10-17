"""One-time rewrite of a stored library from data model v2 to v3 (DATA-164..166, ADR-0031): the countries go back onto the songs and the Artist table is removed; idempotent, dry-run first.

Per song the countries are, in this order: the `country:` tags the song already holds; for a song with exactly one main artist the countries of that artist in the table (they include the edits made after model 2); the `country:` tags the song had in the pre-v2 backup `backups-model2/<uid>/library.json` (the oldest copy is the original); for several main artists the union of their table countries. Nothing else of a song changes.

    python -m app.migrate_model3 --library users/<uid>/library.json [--legacy-backup FILE] [--report report.json]       # dry run, writes nothing else
    python -m app.migrate_model3 --library users/<uid>/library.json --apply [--backup-dir DIR] [--legacy-backup FILE]   # backup, then rewrite
"""

from __future__ import annotations

import argparse
import copy
import json
import logging
import re
import shutil
import sys
from pathlib import Path
from typing import Any

from . import countrycodes, credits, deps, migrate_model2
from .jsonio import write_json_atomic
from .tags import namespace

BACKUP_DIR = "backups-model3"
SCHEMA = 3
_log = logging.getLogger(__name__)


class MigrationAborted(Exception):
    """The library or the pre-v2 backup holds something unexpected; nothing was written."""

    def __init__(self, report: dict[str, Any]) -> None:
        super().__init__("; ".join(report["anomalies"][:3]))
        self.report = report


def _stamp(raw: Any) -> Any:
    settings = raw.get("settings") if isinstance(raw, dict) else None
    return settings.get("credits_schema") if isinstance(settings, dict) else None


def is_model3(raw: Any) -> bool:
    """True when the file is stamped 3 or later and no Artist table is left."""
    stamp = _stamp(raw)
    return isinstance(raw, dict) and isinstance(stamp, int) and not isinstance(stamp, bool) and stamp >= SCHEMA and "artists" not in raw


def is_model2(raw: Any) -> bool:
    return isinstance(raw, dict) and _stamp(raw) == migrate_model2.SCHEMA


def country_codes(tags: Any) -> list[str]:
    """The canonical codes of the `country:` tags in a list, in order, without duplicates; unknown values are skipped."""
    out: list[str] = []
    for t in tags if isinstance(tags, list) else []:
        if isinstance(t, str) and namespace(t) == "country":
            code = countrycodes.canonical_country(t.partition(":")[2])
            if code and code not in out:
                out.append(code)
    return out


def _unknown_values(tags: Any) -> int:
    return sum(1 for t in tags if isinstance(t, str) and namespace(t) == "country" and countrycodes.canonical_country(t.partition(":")[2]) is None) if isinstance(tags, list) else 0


def _legacy_countries(legacy: Any, anomalies: list[str]) -> tuple[dict[str, list[str]], int]:
    """`{song id: codes}` of the songs in the pre-v2 file that had a canonical country tag, and the number of unknown values skipped."""
    songs = legacy.get("songs") if isinstance(legacy, dict) else legacy
    if not isinstance(songs, list):
        anomalies.append("the pre-v2 backup holds no list of songs")
        return {}, 0
    out: dict[str, list[str]] = {}
    unknown = 0
    for s in songs:
        if not isinstance(s, dict) or not isinstance(s.get("id"), str):
            continue
        unknown += _unknown_values(s.get("tags"))
        codes = country_codes(s.get("tags"))
        if codes and s["id"] not in out:
            out[s["id"]] = codes
    return out, unknown


def _without_countries(song: dict[str, Any]) -> dict[str, Any]:
    out = dict(song)
    if isinstance(out.get("tags"), list):
        out["tags"] = [t for t in out["tags"] if not (isinstance(t, str) and namespace(t) == "country")]
        if not out["tags"]:
            del out["tags"]
    return out


def _union(table: dict[str, dict[str, Any]], names: list[str]) -> list[str]:
    out: list[str] = []
    for n in names:
        for c in (table.get(migrate_model2.table_key(n)) or {}).get("countries") or []:
            if c not in out:
                out.append(c)
    return out


def convert(raw: Any, legacy: Any = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """`(new_doc, report)` for the raw JSON of one v2 library file and, when there is one, the raw JSON of its pre-v2 backup. Pure: the inputs are not modified. Anomalies are listed in `report["anomalies"]`; the caller must not write when there are any."""
    raw = copy.deepcopy(raw)
    anomalies: list[str] = []
    songs_in = raw.get("songs") if isinstance(raw, dict) else None
    if not isinstance(songs_in, list):
        songs_in = []
        anomalies.append("the library holds no list of songs")
    table_list = migrate_model2.parse_table(raw.get("artists") if isinstance(raw, dict) else None)
    table = {migrate_model2.table_key(e["name"]): e for e in table_list}
    backup, unknown_in_backup = _legacy_countries(legacy, anomalies) if legacy is not None else ({}, 0)
    seen: set[str] = set()
    new_songs: list[dict[str, Any]] = []
    from_backup, from_table, from_song, empty = [], [], [], []
    disagree: list[str] = []
    for i, song in enumerate(songs_in):
        if not isinstance(song, dict) or not isinstance(song.get("id"), str) or not song["id"]:
            anomalies.append(f"song {i} has no id")
            new_songs.append(song)
            continue
        if song["id"] in seen:
            anomalies.append(f"duplicate song id {song['id']}")
        seen.add(song["id"])
        if "tags" in song and not isinstance(song["tags"], list):
            anomalies.append(f"song {song['id']}: tags is not a list")
            new_songs.append(song)
            continue
        names = credits.main_artists(song)
        own = country_codes(song.get("tags"))
        by_table = _union(table, names) if len(names) >= 1 else []
        by_backup = backup.get(song["id"], [])
        if by_table and by_backup and set(by_table) != set(by_backup):
            disagree.append(song["id"])
        if own:
            chosen, bucket = own, from_song
        elif len(names) == 1 and by_table:
            chosen, bucket = by_table, from_table
        elif by_backup:
            chosen, bucket = by_backup, from_backup
        elif len(names) > 1 and by_table:
            chosen, bucket = by_table, from_table
        else:
            chosen, bucket = [], empty
        bucket.append(song["id"])
        new = dict(song)
        if chosen and chosen != own:
            rest = [t for t in new.get("tags") or [] if not (isinstance(t, str) and namespace(t) == "country")]
            new["tags"] = [*rest, *(f"country:{c}" for c in chosen)]
        new_songs.append(new)
    settings = dict(raw.get("settings") or {}) if isinstance(raw, dict) and isinstance(raw.get("settings"), dict) else {}
    doc = {k: v for k, v in raw.items() if k != "artists"} if isinstance(raw, dict) else {}
    doc["settings"] = {**settings, "credits_schema": SCHEMA}
    doc["songs"] = new_songs
    for old, new in zip(songs_in, new_songs):
        if isinstance(old, dict) and isinstance(new, dict) and _without_countries(old) != _without_countries(new):
            anomalies.append(f"song {old.get('id')}: a field other than the countries would change")
            break
    report = {
        "songs": len(new_songs),
        "countries_restored_from_backup": len(from_backup),
        "countries_taken_from_table": len(from_table),
        "countries_already_on_song": len(from_song),
        "left_empty": len(empty),
        "table_and_backup_disagree": {"songs": len(disagree), "ids": disagree},
        "artists_table_removed": len(table_list),
        "backup_found": legacy is not None,
        "unknown_country_values_in_backup": unknown_in_backup,
        "anomalies": anomalies,
        "ok": not anomalies,
    }
    return doc, report


def check(report: dict[str, Any]) -> None:
    if report["anomalies"]:
        raise MigrationAborted(report)


def backup_path(path: Path, backup_dir: Path | None = None) -> Path:
    """`<repo root>/backups-model3/<uid>/library.json`: beside, not inside, the git-added `audioplayer/` tree."""
    if backup_dir is not None:
        return backup_dir / path.name
    base = deps.SYNC.data_repo if deps.SYNC else deps.data_root()
    return base / BACKUP_DIR / path.parent.name / path.name


def legacy_backup_path(path: Path, legacy_dir: Path | None = None) -> Path | None:
    """The oldest pre-v2 copy: `library.json` of `backups-model2/<uid>/`, else the lowest numbered copy; None when there is none."""
    first = migrate_model2.backup_path(path, legacy_dir)
    if first.exists():
        return first
    numbered = []
    for p in first.parent.glob(f"{first.stem}.*{first.suffix}") if first.parent.is_dir() else []:
        m = re.fullmatch(rf"{re.escape(first.stem)}\.(\d+){re.escape(first.suffix)}", p.name)
        if m:
            numbered.append((int(m.group(1)), p))
    return min(numbered)[1] if numbered else None


def _free(target: Path) -> Path:
    if not target.exists():
        return target
    n = 1
    while (numbered := target.with_name(f"{target.stem}.{n}{target.suffix}")).exists():
        n += 1
    return numbered


def migrate(path: Path, apply: bool = False, report_path: Path | None = None, backup_dir: Path | None = None, legacy_backup: Path | None = None) -> dict[str, Any]:
    """Convert one library file. `status`: `dry_run`, `migrated`, `already_migrated`, `not_model2` (run model 2 first), `missing` or `aborted` (the report says why; nothing but the report file is written then). `legacy_backup` is the pre-v2 file; without it the default place is searched, and a missing file is not an error."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"status": "missing"}
    if is_model3(raw):
        out: dict[str, Any] = {"status": "already_migrated", "songs": len(raw.get("songs") or [])}
    elif not is_model2(raw):
        out = {"status": "not_model2", "credits_schema": _stamp(raw)}
    else:
        source = legacy_backup if legacy_backup is not None else legacy_backup_path(path)
        legacy: Any = None
        pre: list[str] = []
        if source is not None:
            try:
                legacy = json.loads(source.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                pre.append(f"the pre-v2 backup {source} cannot be read: {exc}")
        doc, out = convert(raw, legacy)
        out["anomalies"] = [*pre, *out["anomalies"]]
        out["ok"] = not out["anomalies"]
        out["legacy_backup"] = str(source) if source is not None else None
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
                write_json_atomic(path, doc)
    if report_path is not None:
        write_json_atomic(report_path, out)
    return out


def run() -> int:
    """Startup, after model 2: migrate every user's library; returns the number rewritten. An anomaly stops that library (logged), the server still serves it."""
    users_dir = deps.data_root() / "users"
    if not users_dir.is_dir():
        return 0
    done = 0
    for lib in sorted(users_dir.glob("*/library.json")):
        uid = lib.parent.name
        try:
            raw = json.loads(lib.read_text(encoding="utf-8"))
            if is_model3(raw):
                continue
            if not is_model2(raw):
                _log.warning("data model 3 migration skipped for %s: the library is not at schema 2 (%r)", uid[:8], _stamp(raw))
                continue
            with deps.tx(uid, "migrate data model 3"):
                result = migrate(lib, apply=True)
            if result["status"] == "aborted":
                _log.error("data model 3 migration aborted for %s: %s", uid[:8], "; ".join(result["anomalies"][:3]))
            elif result["status"] == "migrated":
                done += 1
                _log.info("data model 3 migrated for %s: %s", uid[:8], json.dumps({k: result[k] for k in (
                    "songs", "countries_restored_from_backup", "countries_taken_from_table", "left_empty", "artists_table_removed")}))
        except Exception:
            _log.exception("data model 3 migration failed for %s", uid[:8])
    return done


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Migrate one library.json from data model v2 to v3 (dry run unless --apply).")
    parser.add_argument("--library", required=True, type=Path)
    parser.add_argument("--apply", action="store_true", help="back up and rewrite the file")
    parser.add_argument("--report", type=Path, help="write the JSON report here")
    parser.add_argument("--backup-dir", type=Path, help="where --apply puts the backup (default: <data repo>/backups-model3/<uid>/)")
    parser.add_argument("--legacy-backup", type=Path, help="the pre-v2 library.json (default: <data repo>/backups-model2/<uid>/library.json or its oldest numbered copy)")
    args = parser.parse_args(argv)
    result = migrate(args.library, apply=args.apply, report_path=args.report, backup_dir=args.backup_dir, legacy_backup=args.legacy_backup)
    brief = {k: v for k, v in result.items() if k != "table_and_backup_disagree"}
    if "table_and_backup_disagree" in result:
        brief["table_and_backup_disagree"] = result["table_and_backup_disagree"]["songs"]
    print(json.dumps(brief, ensure_ascii=False, indent=2))
    return 0 if result["status"] in ("dry_run", "migrated", "already_migrated") else 1


if __name__ == "__main__":
    sys.exit(main())
