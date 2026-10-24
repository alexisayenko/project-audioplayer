"""Per-user flat playlists (PLS-110..PLS-120, API-229..API-238, DATA-199): named, ordered lists of song ids. Stored in users/<uid>/playlists.json, never in library.json."""

from __future__ import annotations

import copy
import json
import math
import re
import secrets
import string
from pathlib import Path
from typing import Any

from . import credits, library
from .jsonio import write_json_atomic
from .problems import Problem
from .timeutil import now_utc

MAX_PLAYLISTS = 200
MAX_SONGS = 2000
MAX_REQUEST_IDS = 20000
NAME_MAX = 120
DESCRIPTION_MAX = 1000
FILE_STEM_MAX = 100
SOURCE_FALLBACK_NAME = "YouTube playlist"
ID_RE = re.compile(r"^pl_[0-9a-z]{8}$")
_ID_CHARS = string.ascii_lowercase + string.digits
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


# --- storage --------------------------------------------------------------------------------

def _stamp(value: Any) -> str:
    return value if isinstance(value, str) and value else now_utc()


def _clean(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not ID_RE.fullmatch(raw["id"]):
        return None
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        return None
    songs = raw.get("songs")
    description = raw.get("description")
    item = {
        "id": raw["id"],
        "name": name.strip(),
        "description": description.strip() if isinstance(description, str) else "",
        "created": _stamp(raw.get("created")),
        "updated": _stamp(raw.get("updated")),
        "songs": list(dict.fromkeys(s for s in songs if isinstance(s, str) and s)) if isinstance(songs, list) else [],
    }
    source = _clean_source(raw.get("source"))
    if source is not None:
        item["source"] = source
    return item


def _clean_source(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or raw.get("type") != "youtube" or not isinstance(raw.get("id"), str) or not raw["id"]:
        return None
    positions = raw.get("positions")
    return {
        "type": "youtube",
        "id": raw["id"],
        "url": raw["url"] if isinstance(raw.get("url"), str) else "",
        "positions": {k: v for k, v in positions.items() if isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool)} if isinstance(positions, dict) else {},
    }


def load(path: Path) -> list[dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError, OSError):
        return []
    found = raw.get("playlists") if isinstance(raw, dict) else None
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in found if isinstance(found, list) else ():
        item = _clean(entry)
        if item is not None and item["id"] not in seen:
            seen.add(item["id"])
            out.append(item)
    return out


def save(path: Path, items: list[dict[str, Any]]) -> None:
    write_json_atomic(path, {"version": 1, "playlists": items})


def find(items: list[dict[str, Any]], playlist_id: str) -> dict[str, Any] | None:
    if not ID_RE.fullmatch(playlist_id):
        return None
    return next((p for p in items if p["id"] == playlist_id), None)


def new_id(items: list[dict[str, Any]]) -> str:
    taken = {p["id"] for p in items}
    while True:
        candidate = "pl_" + "".join(secrets.choice(_ID_CHARS) for _ in range(8))
        if candidate not in taken:
            return candidate


# --- validation -----------------------------------------------------------------------------

def clean_name(raw: Any) -> str:
    name = str(raw or "").strip()
    if not name or len(name) > NAME_MAX or _CONTROL.search(name):
        raise Problem(422, "bad_name", f"A playlist name needs 1 to {NAME_MAX} characters, without control characters.")
    return name


def clean_description(raw: Any) -> str:
    text = str(raw or "").strip()
    if len(text) > DESCRIPTION_MAX:
        raise Problem(422, "bad_description", f"A description has at most {DESCRIPTION_MAX} characters.")
    return text


def check_name_free(items: list[dict[str, Any]], name: str, own_id: str | None = None) -> None:
    key = name.casefold()
    if any(p["name"].casefold() == key and p["id"] != own_id for p in items):
        raise Problem(409, "playlist_name_taken", "You already have a playlist with this name.")


def check_room(items: list[dict[str, Any]], owner: bool) -> None:
    if not owner and len(items) >= MAX_PLAYLISTS:
        raise Problem(422, "too_many_playlists", f"You can have at most {MAX_PLAYLISTS} playlists.")


# --- songs of one playlist ------------------------------------------------------------------

def prune(item: dict[str, Any], known: set[str]) -> None:
    """Drop the ids that are not in the library any more."""
    item["songs"] = [s for s in item["songs"] if s in known]


def add_songs(item: dict[str, Any], song_ids: list[str], known: set[str], owner: bool) -> tuple[int, list[str]]:
    """Append the ids in the given order; an id already in the playlist or not in the library is skipped. Returns `(added, skipped)`."""
    have = set(item["songs"])
    fresh: list[str] = []
    skipped: list[str] = []
    for sid in song_ids:
        if sid in have or sid not in known:
            skipped.append(sid)
        else:
            have.add(sid)
            fresh.append(sid)
    if not owner and len(item["songs"]) + len(fresh) > MAX_SONGS:
        raise Problem(422, "too_many_songs", f"A playlist holds at most {MAX_SONGS} songs.")
    item["songs"] = [*item["songs"], *fresh]
    return len(fresh), skipped


def find_source(items: list[dict[str, Any]], source_id: str) -> dict[str, Any] | None:
    return next((p for p in items if (p.get("source") or {}).get("id") == source_id), None)


def free_name(items: list[dict[str, Any]], wanted: Any) -> str:
    """The wanted name, or "Name (2)", "Name (3)", ... when a playlist of the user already has it (a missing title becomes "YouTube playlist")."""
    base = " ".join(_CONTROL.sub(" ", str(wanted or "")).split())[:NAME_MAX].strip() or SOURCE_FALLBACK_NAME
    taken = {p["name"].casefold() for p in items}
    if base.casefold() not in taken:
        return base
    number = 2
    while True:
        suffix = f" ({number})"
        name = f"{base[: NAME_MAX - len(suffix)].rstrip()}{suffix}"
        if name.casefold() not in taken:
            return name
        number += 1


def insert_by_position(item: dict[str, Any], picks: list[tuple[str, int]], known: set[str], owner: bool) -> tuple[int, list[str]]:
    """Put `(song_id, position)` picks of a source playlist into `item`, each before the first song whose recorded position is higher (after all when none is), so the YouTube order holds across batches and songs the user placed by hand stay put. A song already there or not in the library is skipped; its position is still recorded. Returns `(added, skipped)`."""
    positions = item["source"]["positions"]
    have = set(item["songs"])
    fresh: list[tuple[str, int]] = []
    skipped: list[str] = []
    for sid, pos in sorted(picks, key=lambda p: p[1]):
        if sid not in known or sid in have:
            skipped.append(sid)
            if sid in have:
                positions.setdefault(sid, pos)
        else:
            have.add(sid)
            fresh.append((sid, pos))
    if not owner and len(item["songs"]) + len(fresh) > MAX_SONGS:
        raise Problem(422, "too_many_songs", f"A playlist holds at most {MAX_SONGS} songs.")
    for sid, pos in fresh:
        songs = item["songs"]
        at = next((i for i, s in enumerate(songs) if positions.get(s) is not None and positions[s] > pos), len(songs))
        songs.insert(at, sid)
        positions[sid] = pos
    return len(fresh), skipped


def upsert_source(items: list[dict[str, Any]], owner: bool, *, source_id: str, url: str, title: Any, picks: list[tuple[str, int]], known: set[str]) -> tuple[dict[str, Any], bool, int, list[str]]:
    """The playlist of a YouTube playlist (matched by `source.id`, created named after `title` when there is none) with the picks put in. Returns `(playlist, created, added, skipped)`; `items` gets the new playlist appended."""
    item = find_source(items, source_id)
    created = item is None
    if item is None:
        check_room(items, owner)
        now = now_utc()
        item = {"id": new_id(items), "name": free_name(items, title), "description": "", "created": now, "updated": now, "songs": [],
                "source": {"type": "youtube", "id": source_id, "url": url, "positions": {}}}
        items.append(item)
    prune(item, known)
    added, skipped = insert_by_position(item, picks, known, owner)
    if added:
        item["updated"] = now_utc()
    return item, created, added, skipped


def set_order(item: dict[str, Any], song_ids: list[str]) -> None:
    if sorted(song_ids) != sorted(item["songs"]):
        raise Problem(422, "bad_order", "The order must list exactly the songs of the playlist, each once.")
    item["songs"] = list(song_ids)


def remove_song(path: Path, song_id: str) -> bool:
    """Take a deleted library song out of every playlist of the user; writes only when something changed."""
    items = load(path)
    changed = False
    for item in items:
        if song_id in item["songs"]:
            item["songs"] = [s for s in item["songs"] if s != song_id]
            item["updated"] = now_utc()
            changed = True
    if changed:
        save(path, items)
    return changed


# --- output ---------------------------------------------------------------------------------

def summary(item: dict[str, Any]) -> dict[str, Any]:
    songs = item["songs"]
    return {"id": item["id"], "name": item["name"], "description": item["description"], "count": len(songs),
            "first_song_id": songs[0] if songs else None, "updated": item["updated"]}


def detail(item: dict[str, Any]) -> dict[str, Any]:
    return {"id": item["id"], "name": item["name"], "description": item["description"], "created": item["created"],
            "updated": item["updated"], "songs": list(item["songs"])}


def by_name(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda p: (p["name"].casefold(), p["id"]))


# --- text export ----------------------------------------------------------------------------

def length_text(seconds: Any) -> str:
    """`m:ss`, or `h:mm:ss` from one hour; empty when the length is unknown."""
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds):
        return ""
    whole = int(seconds)
    if whole <= 0:
        return ""
    hours, rest = divmod(whole, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def export_line(song: dict[str, Any]) -> str:
    """`Artists - Title (Version) - m:ss`: main artists joined with ', ', the version only when the song has one, the length only when known."""
    shaped = copy.deepcopy(song)
    credits.ensure(shaped)
    artists = ", ".join(credits.main_artists(shaped)) or credits.artist_string(shaped)
    title = str(shaped.get("title") or "")
    version = credits.version_text(shaped.get("version")) if credits.has_version(shaped) else None
    head = f"{title} ({version})" if version else title
    text = f"{artists} - {head}" if artists else head
    stamp = length_text(shaped.get("duration"))
    if stamp:
        text = f"{text} - {stamp}"
    return " ".join(text.split())


def export_text(item: dict[str, Any], songs: list[dict[str, Any]]) -> str:
    """One line per song in the playlist's order, each ending in a newline; songs no longer in the library are skipped."""
    by_id = {s["id"]: s for s in songs}
    return "".join(f"{export_line(by_id[sid])}\n" for sid in item["songs"] if sid in by_id)


def file_name(name: str) -> str:
    stem = " ".join(library._BAD_NAME.sub(" ", name).split()).strip(" .")[:FILE_STEM_MAX].strip(" .")
    return f"{stem or 'playlist'}.txt"
