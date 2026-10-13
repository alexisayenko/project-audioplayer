"""library.json store: {settings:{music_root}, songs:[...]}, atomic replace on write."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import langcodes, urlclean, wiki_lookup

LOCK = threading.RLock()

_ROOT_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_.-]+)://(.*)$")
_DECADE_RE = re.compile(r"^\d{2}s$")
DECADE_MIN, DECADE_MAX = 1950, 2029


def file_name(song: dict[str, Any]) -> str:
    """Audio file name of a song, never a path."""
    default = f"{song.get('id', '')}.m4a"
    return Path(str(song.get("file") or default)).name or default


def has_file(song: dict[str, Any]) -> bool:
    """True when the record names an audio file; an explicit `file: null` is a metadata-only song."""
    return bool(song.get("file"))


def clean_sources(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict) or not isinstance(e.get("source"), str) or not e.get("id"):
            continue
        url = urlclean.clean_url(e["url"]) if isinstance(e.get("url"), str) else None
        out.append({"source": e["source"], "id": str(e["id"]), "url": url})
    return out


def sources_of(song: dict[str, Any]) -> list[dict[str, Any]]:
    """Stored `sources`, or the single source derived from the id and `source_url` (old records)."""
    stored = song.get("sources")
    if isinstance(stored, list) and stored:
        return stored
    sid = str(song.get("id", ""))
    return [{"source": urlclean.source_of(sid), "id": sid, "url": song.get("source_url")}]


def audio_state(song: dict[str, Any], root: Path | None) -> str:
    """`server` when the audio file is on the server, else `none`; never stored. `phone` is client-side.

    `root` None (music_root server not configured) trusts the record's `file`."""
    if not has_file(song):
        return "none"
    if root is None:
        return "server"
    return "server" if (root / file_name(song)).is_file() else "none"


def public_song(song: dict[str, Any], root: Path | None) -> dict[str, Any]:
    """The record plus derived, additive fields: `audio_state`, `sources`, and `audio` when a file exists."""
    out = dict(song)
    state = audio_state(song, root)
    out["audio_state"] = state
    out["sources"] = sources_of(song)
    if state == "server":
        name = file_name(song)
        size = None
        if root is not None:
            try:
                size = (root / name).stat().st_size
            except OSError:
                pass
        out["audio"] = {
            "file": name,
            "format": Path(name).suffix.lstrip(".").lower() or None,
            "size": size,
            "duration": song.get("duration"),
        }
    return out


def updated_at(song: dict[str, Any]) -> str:
    return str(song.get("updated_at") or song.get("added_at") or "")


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def catalog_revision(songs: list[dict[str, Any]]) -> str:
    """Content hash of the public catalog; changes on any add, edit, delete or audio-state change."""
    blob = json.dumps(songs, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


def normalize_song(song: dict[str, Any]) -> dict[str, Any]:
    s = dict(song)
    if "id" in s and (s.get("file") == "" or "file" not in s):
        s["file"] = f"{s['id']}.m4a"
    if "sources" in s:
        s["sources"] = clean_sources(s["sources"])
    if isinstance(s.get("bpm"), (int, float)) and not isinstance(s["bpm"], bool):
        s["bpm"] = round(s["bpm"])
    if isinstance(s.get("source_url"), str):
        s["source_url"] = urlclean.clean_url(s["source_url"])
    for key in ("wikipedia_song", "wikipedia_artist"):
        s[key] = wiki_lookup.clean_link(s.get(key))
    normalize_tags(s)
    return s


def normalize_tags(s: dict[str, Any]) -> None:
    genre = s.pop("genre", None)
    tags = list(s.get("tags") or [])
    if isinstance(genre, str) and genre.strip():
        tags.append(f"genre:{genre}")
    if "tags" in s or genre:
        s["tags"] = clean_tags(tags)
    if decade_tag(s.get("year")):
        s["tags"] = with_decade(s.get("tags") or [], s["year"])


def normalize(raw: Any) -> dict[str, Any]:
    """Accept the old bare {songs:[...]} shape and return {settings, songs}."""
    if isinstance(raw, list):
        raw = {"songs": raw}
    raw = raw if isinstance(raw, dict) else {}
    settings = dict(raw.get("settings") or {})
    songs = [normalize_song(s) for s in raw.get("songs") or []]
    return {"settings": settings, "songs": songs}


def decade_tag(year: Any) -> str | None:
    """`decade:90s` for 1950-2029, else None."""
    if isinstance(year, bool) or not isinstance(year, int) or not DECADE_MIN <= year <= DECADE_MAX:
        return None
    return f"decade:{year % 100 // 10 * 10:02d}s"


def with_decade(tags: list[str], year: Any) -> list[str]:
    """Replace every `decade:*` tag by the one derived from `year`; untouched when the year gives none."""
    derived = decade_tag(year)
    if derived is None:
        return list(tags)
    out: list[str] = []
    placed = False
    for t in tags:
        if t.casefold().startswith("decade:"):
            if not placed:
                out.append(derived)
                placed = True
        else:
            out.append(t)
    if not placed:
        out.append(derived)
    return out


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
        elif key == "decade" and not _DECADE_RE.match(value):
            value = value.replace(" ", "")
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
