"""One-time rewrite of a stored library to data model v2 (DATA-151..153, ADR-0025); idempotent, dry-run first, refuses to run twice.

The runtime no longer knows the Artist table it writes (ADR-0031, `migrate_model3` removes it again); the few helpers it needs live here.

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

from . import countrycodes, credits, credits_v1, deps, library, safepath
from .jsonio import write_json_atomic
from .tags import namespace

BACKUP_DIR = "backups-model2"
SCHEMA = 2
MAX_COUNTRIES = 5
MAX_ARTISTS = 20000
LEGACY_FIELDS = ("artist", "remixer", "year", "remix_year", "album")
SAMPLE = 20
_log = logging.getLogger(__name__)



def table_key(name: Any) -> str:
    return " ".join(str(name or "").split()).casefold()


def _clean_countries(values: Any) -> list[str]:
    out: list[str] = []
    for v in values if isinstance(values, (list, tuple)) else []:
        code = countrycodes.canonical_country(str(v))
        if code and code not in out:
            out.append(code)
    return out[:MAX_COUNTRIES]


def parse_table(raw: Any) -> list[dict[str, Any]]:
    """The stored Artist table as a clean list: entries with a name, one per key (first spelling kept), countries canonical."""
    out: dict[str, dict[str, Any]] = {}
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict) or not isinstance(e.get("name"), str):
            continue
        name = " ".join(e["name"].split())
        if not name or table_key(name) in out:
            continue
        out[table_key(name)] = {"name": name, "countries": _clean_countries(e.get("countries"))}
    return list(out.values())[:MAX_ARTISTS]


def _find(table: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    k = table_key(name)
    return next((e for e in table if table_key(e["name"]) == k), None)


def _set_countries(table: list[dict[str, Any]], name: str, countries: Any) -> None:
    entry = _find(table, name)
    if entry is None:
        entry = {"name": " ".join(name.split()), "countries": []}
        table.append(entry)
    entry["countries"] = _clean_countries(list(countries))


def _sync_names(table: list[dict[str, Any]], songs: list[dict[str, Any]]) -> None:
    used: dict[str, str] = {}
    for s in songs:
        for n in s.get("mainArtists") or []:
            if isinstance(n, str) and table_key(n):
                used.setdefault(table_key(n), " ".join(n.split()))
    have = {table_key(e["name"]) for e in table}
    table[:] = [e for e in table if e["countries"] or table_key(e["name"]) in used]
    for k, name in used.items():
        if k not in have:
            table.append({"name": name, "countries": []})
    table.sort(key=lambda e: table_key(e["name"]))


def _view_tags(song: dict[str, Any], table: list[dict[str, Any]]) -> list[str]:
    """The tags a v2 response showed: stored tags, the computed decade and the countries of the main artists."""
    kept, _, _ = library.split_tags(library.tag_list(song))
    decade = library.decade_tag(credits.display_year(song))
    idx = {table_key(e["name"]): e for e in table}
    countries: list[str] = []
    for n in credits.main_artists(song):
        for c in (idx.get(table_key(n)) or {}).get("countries") or []:
            if c not in countries:
                countries.append(c)
    return [*kept, *([decade] if decade else []), *(f"country:{c}" for c in countries)]


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
    stamp = settings.get("credits_schema") if isinstance(settings, dict) else None
    if isinstance(stamp, int) and not isinstance(stamp, bool) and stamp > SCHEMA:
        return True
    if stamp != SCHEMA:
        return False
    return all(isinstance(s, dict) and credits_v1.is_v2(s) and not any(k in s for k in credits.LEGACY_KEYS) and not _prefixed(s) for s in _songs_of(raw))


def _prefixed(song: dict[str, Any]) -> bool:
    """True when a song still holds `genre:`, `decade:`, `lang:` or `country:` tags in `tags` (the form before genres were stored bare)."""
    tags = song.get("tags")
    return isinstance(tags, list) and any(namespace(t) in ("genre", "decade", "lang", "country") for t in tags)


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
    old_table = parse_table(raw.get("artists") if isinstance(raw, dict) else None)
    removed: Counter[str] = Counter()
    types: Counter[str] = Counter()
    diffs: list[dict[str, Any]] = []
    tag_changes: list[dict[str, Any]] = []
    decade_off: list[str] = []
    raw_kept: list[str] = []
    leftovers: list[dict[str, Any]] = []
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
        if "tags" in new or "genres" in new:
            kept, countries, gone = library.split_tags(library.tag_list(new))
            removed.update(gone)
            year_decade = library.decade_tag(credits.release_year(new))
            if any(t.startswith("decade:") and t.casefold() != (year_decade or "").casefold() for t in library.tag_list(old)):
                decade_off.append(str(new.get("id")))
            new.pop("genres", None)
            new["tags"] = kept
            new = library.stored_song(new)
            if "tags" in new:
                leftovers.append({"id": new.get("id"), "tags": new["tags"]})
        else:
            countries = []
        if isinstance(new.get("sources"), list):
            new["sources"] = library.clean_sources(new["sources"])
        names = credits.main_artists(new)
        if countries and len(names) == 1:
            per_artist.setdefault(table_key(names[0]), []).append((names[0], tuple(countries)))
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
        if len(sets) == 1 and not (_find(table, found[0][0]) or {}).get("countries"):
            _set_countries(table, found[0][0], sets[0])
        elif len(sets) > 1:
            conflicts.append({"artist": found[0][0], "countries": [list(s) for s in sets]})
    _sync_names(table, new_songs)
    for old, new in zip(olds, new_songs):
        before, after = _tag_set(library.tag_list(old)), _tag_set(_view_tags(new, table))
        if before != after:
            tag_changes.append({"id": new.get("id"), "removed": sorted(before - after), "added": sorted(after - before)})

    doc = {"settings": {**settings, "credits_schema": SCHEMA}, "songs": new_songs, "artists": table}
    report = {
        "songs": len(new_songs),
        "songs_converted": converted,
        "tags_removed": {k: removed.get(k, 0) for k in ("decade", "lang", "country")},
        "decade_tags_disagreeing_with_release_year": len(decade_off),
        "version_types": dict(sorted(types.items())),
        "raw_kept": raw_kept,
        "artists": {"total": len(table), "with_countries": sum(1 for e in table if e["countries"])},
        "review": {"multi_artist_countries": multi, "conflicting_countries": conflicts, "leftover_tags": leftovers},
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
                if out["review"]["multi_artist_countries"] or out["review"]["conflicting_countries"] or out["review"]["leftover_tags"] or out["raw_kept"]:
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
    try:
        lib_path = safepath.input_file(args.library)
        bases = safepath.trusted_bases(lib_path)
        report = safepath.output_file(args.report, bases) if args.report else None
        backup_dir = safepath.output_dir(args.backup_dir, bases) if args.backup_dir else None
    except safepath.UnsafePath as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    result = migrate(lib_path, apply=args.apply, report_path=report, backup_dir=backup_dir)
    brief = {k: v for k, v in result.items() if k not in ("legacy_diffs", "tag_view_changes", "raw_kept", "review")}
    brief.update(legacy_diffs=len(result.get("legacy_diffs", [])), raw_kept=len(result.get("raw_kept", [])),
                 tag_view_changes=result.get("tag_view_changes", {}).get("songs", 0))
    print(json.dumps(brief, ensure_ascii=False, indent=2))
    return 0 if result["status"] in ("dry_run", "migrated", "already_migrated") else 1


if __name__ == "__main__":
    sys.exit(main())
