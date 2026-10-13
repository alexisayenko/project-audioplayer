"""One-time move of the single-user layout into the owner's per-user layout (ADR-0012).

Legacy: `<data>/library.json`, `<covers>/covers/*.jpg`, audio directly in `music_root`.
New:    `<data>/users/<uid>/library.json`, `<covers>/users/<uid>/covers/*.jpg`, `music_root/users/<uid>/*`.

Safe by construction: every conflict is detected before the first move (abort, nothing changed); a crash
midway leaves a state the next run resumes (a file is moved when its source exists and its target does not);
a marker file written in the same commit stops it from ever running twice.
"""
from __future__ import annotations

import json
import logging
import shutil
from contextlib import nullcontext
from pathlib import Path

from . import extractor, library, users

log = logging.getLogger(__name__)

MESSAGE = "audioplayer: migrate legacy library to per-user layout"
MARKER = Path("migrations") / "legacy-to-per-user.json"


def _load(path: Path) -> list[dict] | None:
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError):
        return None
    return library.normalize(raw)["songs"] if isinstance(raw, (dict, list)) else None


def run(*, data_root: Path, covers_root: Path | None, music_dir: Path | None, owner_email: str, sync=None) -> str:
    """Returns `done` (already migrated), `nothing`, `migrated`, or `aborted: <reason>`."""
    data_root = Path(data_root)
    covers_root = Path(covers_root) if covers_root else data_root
    uid = users.uid_for_email(owner_email)
    marker = data_root / MARKER
    if marker.exists():
        return "done"

    old_lib = data_root / "library.json"
    new_lib = data_root / "users" / uid / "library.json"
    if old_lib.exists() and new_lib.exists():
        return _abort("legacy and per-user library both exist")
    if not old_lib.exists() and not new_lib.exists():
        return "nothing"
    songs = _load(old_lib if old_lib.exists() else new_lib)
    if songs is None:
        return _abort("library.json is not valid JSON")

    plan: list[tuple[Path, Path]] = []
    if old_lib.exists():
        plan.append((old_lib, new_lib))

    old_covers = covers_root / "covers"
    new_covers = covers_root / "users" / uid / "covers"
    if old_covers.is_dir():
        plan += [(p, new_covers / p.name) for p in sorted(old_covers.glob("*.jpg"))]

    if music_dir is not None and Path(music_dir).is_dir():
        music_dir = Path(music_dir)
        new_audio = music_dir / "users" / uid
        names = {library.file_name(s) for s in songs if library.has_file(s)}
        names |= {p.name for p in music_dir.glob("*.m4a") if extractor.is_valid_video_id(p.stem)}
        plan += [(music_dir / n, new_audio / n) for n in sorted(names) if (music_dir / n).is_file()]

    for src, dst in plan:
        if dst.exists():
            return _abort(f"{dst.name} exists at both the old and the new location")
    if not plan:
        return "nothing"

    ctx = sync.transaction() if sync else nullcontext()
    done: list[tuple[Path, Path]] = []
    try:
        with ctx:
            profile = data_root / "users" / uid / "profile.json"
            made_profile = users.read_profile(profile) is None
            try:
                for src, dst in plan:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(src), str(dst))
                    done.append((src, dst))
                if made_profile:
                    users.write_profile(profile, users.new_profile({"provider": "migrated", "email": owner_email}))
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.write_text(json.dumps({"migrated_at": users.now_utc(), "files": len(plan)}) + "\n",
                                  encoding="utf-8")
                if sync:
                    sync.commit(MESSAGE)
            except BaseException:
                marker.unlink(missing_ok=True)
                if made_profile:
                    profile.unlink(missing_ok=True)
                for src, dst in reversed(done):
                    if dst.exists() and not src.exists():
                        shutil.move(str(dst), str(src))
                raise
    except Exception as exc:
        return _abort(f"{type(exc).__name__}: {exc}")
    log.info("migrated the legacy library to users/%s (%d files)", uid[:8], len(plan))
    return "migrated"


def _abort(reason: str) -> str:
    log.error("legacy migration aborted, nothing changed: %s", reason)
    return f"aborted: {reason}"
