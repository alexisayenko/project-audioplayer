"""library.json store: {settings:{music_root}, songs:[...]}, atomic replace on write."""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

from . import langcodes

LOCK = threading.RLock()

_ROOT_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_.-]+)://(.*)$")


def file_name(song: dict[str, Any]) -> str:
    """Audio file name of a song, never a path."""
    default = f"{song.get('id', '')}.m4a"
    return Path(str(song.get("file") or default)).name or default


def normalize(raw: Any) -> dict[str, Any]:
    """Accept the old bare {songs:[...]} shape and return {settings, songs}."""
    if isinstance(raw, list):
        raw = {"songs": raw}
    raw = raw if isinstance(raw, dict) else {}
    settings = dict(raw.get("settings") or {})
    songs = []
    for s in raw.get("songs") or []:
        s = dict(s)
        if "id" in s and not s.get("file"):
            s["file"] = f"{s['id']}.m4a"
        if isinstance(s.get("bpm"), (int, float)) and not isinstance(s["bpm"], bool):
            s["bpm"] = round(s["bpm"])
        genre = s.pop("genre", None)
        tags = list(s.get("tags") or [])
        if isinstance(genre, str) and genre.strip():
            tags.append(f"genre:{genre}")
        if "tags" in s or genre:
            s["tags"] = clean_tags(tags)
        songs.append(s)
    return {"settings": settings, "songs": songs}


def load_doc(path: Path) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as f:
            return normalize(json.load(f))
    except FileNotFoundError:
        return normalize({})


def save_doc(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = {"settings": doc.get("settings") or {}, "songs": doc.get("songs") or []}
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".library-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def load(path: Path) -> list[dict[str, Any]]:
    return load_doc(path)["songs"]


def save(path: Path, songs: list[dict[str, Any]], default_music_root: str | None = None) -> None:
    """Replace the songs, keeping stored settings (seeding music_root if absent)."""
    doc = load_doc(path)
    doc["songs"] = songs
    if default_music_root and not doc["settings"].get("music_root"):
        doc["settings"]["music_root"] = default_music_root
    save_doc(path, doc)


def load_hosts() -> dict[str, str]:
    """Server name -> local mount path: AUDIO_HOSTS="a=/p;b=/q" and/or AUDIO_HOSTS_FILE (JSON)."""
    hosts: dict[str, str] = {}
    file = os.environ.get("AUDIO_HOSTS_FILE", "")
    if file:
        with open(file, encoding="utf-8") as f:
            hosts.update({str(k): str(v) for k, v in json.load(f).items()})
    for item in os.environ.get("AUDIO_HOSTS", "").split(";"):
        name, sep, target = item.partition("=")
        if sep and name.strip() and target.strip():
            hosts[name.strip()] = target.strip()
    return hosts


def resolve_music_root(root: str, hosts: dict[str, str] | None = None) -> Path:
    """`<servername>://<path>/` -> local dir via the hosts map; a plain path is used as is."""
    m = _ROOT_RE.match(root)
    if not m:
        return Path(root)
    name, rest = m.groups()
    hosts = load_hosts() if hosts is None else hosts
    if name not in hosts:
        raise LookupError(f"music_root server {name!r} is not configured (AUDIO_HOSTS)")
    return Path(hosts[name]) / rest.strip("/")


def clean_tag(tag: str) -> str:
    """Trim and collapse spaces; `key:value` is lowercased, a plain tag keeps its case; a half-empty `key:` or `:value` is dropped."""
    key, sep, value = tag.partition(":")
    key, value = " ".join(key.split()), " ".join(value.split())
    if sep and key and value:
        key, value = key.lower(), value.lower()
        if key == "lang":
            value = langcodes.to_lang_code(value) or value
        return f"{key}:{value}"
    if sep:
        return ""
    return " ".join(tag.split())


def clean_tags(tags: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for t in tags:
        t = clean_tag(str(t))
        if t and t.casefold() not in seen:
            seen.add(t.casefold())
            out.append(t)
    return out


def tag_counts(songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, dict[str, Any]] = {}
    for s in songs:
        for t in s.get("tags", []):
            e = counts.setdefault(t.casefold(), {"tag": t, "count": 0})
            e["count"] += 1
    return sorted(counts.values(), key=lambda e: e["tag"].casefold())
