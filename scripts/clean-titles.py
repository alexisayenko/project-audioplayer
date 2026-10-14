#!/usr/bin/env python3
"""OPTIONAL maintenance: strip promo noise ("[Free Download]") from titles already in a library.

Dry run by default: prints counts and a before/after sample. `--apply` copies each library.json to
<backup-dir>/<user>-library.json.bak-<timestamp> first (never next to the library: the data dir is a
git work tree), then writes through the same store (app.library.save).
Not part of the app, never run automatically; new songs are cleaned when added.

  scripts/clean-titles.py --library /path/to/library.json [--apply] [--backup-dir DIR]
  scripts/clean-titles.py --data-dir /path/to/data [--apply] # every users/*/library.json
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from app import library, titleclean  # noqa: E402


LIBRARY_NAME = "library.json"


def plan(songs: list[dict]) -> list[tuple[int, str, str]]:
    out = []
    for i, song in enumerate(songs):
        old = song.get("title")
        if isinstance(old, str) and (new := titleclean.clean(old)) != old.strip() and new:
            out.append((i, old, new))
    return out


def default_backup_dir(stamp: str) -> Path:
    preferred = Path("/var/backups") / f"audioplayer-titles-{stamp}"
    try:
        preferred.mkdir(parents=True, exist_ok=True)
        if os.access(preferred, os.W_OK):
            return preferred
    except OSError:
        pass
    fallback = Path(tempfile.gettempdir()) / f"audioplayer-titles-{stamp}"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def backup_path(backup_dir: Path, library_path: Path, stamp: str) -> Path:
    owner = library_path.resolve().parent.name or "library"
    return backup_dir / f"{owner}-{library_path.name}.bak-{stamp}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--library", type=Path, action="append", default=[])
    ap.add_argument("--data-dir", type=Path)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--backup-dir", type=Path, help="default: /var/backups/audioplayer-titles-<ts>, else system temp")
    ap.add_argument("--sample", type=int, default=15)
    args = ap.parse_args()
    paths = [p.resolve() for p in args.library]
    if args.data_dir:
        paths += sorted(args.data_dir.resolve().glob("users/*/library.json"))
    if not paths:
        ap.error("give --library or --data-dir")
    if bad := [p for p in paths if p.name != LIBRARY_NAME]:
        ap.error(f"not a {LIBRARY_NAME}: {bad[0]}")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = None
    for path in paths:
        backup_dir = process(path, args, stamp, backup_dir)
    return 0


def process(path: Path, args: argparse.Namespace, stamp: str, backup_dir: Path | None) -> Path | None:
    songs = library.load(path)
    changes = plan(songs)
    print(f"{path}: {len(songs)} songs, {len(changes)} titles would change" + ("" if args.apply else " (dry run)"))
    for _, old, new in changes[: args.sample]:
        print(f"  {old!r} -> {new!r}")
    if args.apply and changes:
        if backup_dir is None:
            backup_dir = args.backup_dir or default_backup_dir(stamp)
            backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_path(backup_dir, path, stamp)
        shutil.copy2(path, backup)
        for i, _, new in changes:
            songs[i]["title"] = new
        library.save(path, songs)
        print(f"  applied; backup at {backup}")
    return backup_dir


if __name__ == "__main__":
    sys.exit(main())
