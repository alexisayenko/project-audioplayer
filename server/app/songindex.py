"""A small in-process index of one library file: song id -> audio file name, plus the stored music_root. Rebuilt only when the file's stamp changes, so hot routes (audio, covers) never parse the library or take the user lock."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, NamedTuple

Stamp = tuple[int, int, int, int]


class Index(NamedTuple):
    files: dict[str, str | None]
    music_root: str


_EMPTY = Index({}, "")
_cache: dict[Path, tuple[Stamp | None, Index]] = {}
_guard = threading.Lock()


def stamp(path: Path) -> Stamp | None:
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size, st.st_ino, st.st_ctime_ns)


def audio_name(song: dict[str, Any]) -> str | None:
    """The audio file name `library.normalize_song` + `library.file_name` would give; None for a metadata-only song (`file: null`)."""
    sid = str(song.get("id", ""))
    raw = song.get("file")
    if "file" not in song or raw == "":
        return f"{sid}.m4a"
    if not raw:
        return None
    return Path(str(raw)).name or f"{sid}.m4a"


def build(path: Path) -> Index:
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (FileNotFoundError, ValueError):
        return _EMPTY
    if isinstance(raw, list):
        raw = {"songs": raw}
    if not isinstance(raw, dict):
        return _EMPTY
    files: dict[str, str | None] = {}
    for song in raw.get("songs") or []:
        if isinstance(song, dict) and isinstance(song.get("id"), str):
            files.setdefault(song["id"], audio_name(song))
    settings = raw.get("settings")
    root = settings.get("music_root") if isinstance(settings, dict) else None
    return Index(files, root if isinstance(root, str) else "")


def get(path: Path) -> Index:
    """The index of `path`, from memory while its (mtime, size, inode, ctime) stamp is unchanged. The stamp is taken before the read, so a write that lands in between only costs one extra rebuild."""
    seen = stamp(path)
    hit = _cache.get(path)
    if hit is not None and hit[0] == seen and seen is not None:
        return hit[1]
    index = build(path) if seen is not None else _EMPTY
    with _guard:
        if len(_cache) > 4096:
            _cache.clear()
        _cache[path] = (seen, index)
    return index


def invalidate(path: Path | None = None) -> None:
    with _guard:
        if path is None:
            _cache.clear()
        else:
            _cache.pop(path, None)
