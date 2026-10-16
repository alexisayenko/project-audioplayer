"""Structured credits and versions of a song (DATA-120..139): the stored shape, the legacy compatibility projection and the one place that turns requests into structure."""

from __future__ import annotations

import copy
import logging
import re
from typing import Any

from . import timeutil
from .tokens import split_tokens

log = logging.getLogger(__name__)

SCHEMA = 1
KINDS = ("remix", "live", "acoustic", "extended", "instrumental", "remaster", "edit", "cover", "other")
MAX_NAMES = 30
MAX_NAME = 200
MAX_VERSION_NAME = 300
MAX_RAW = 500
LEGACY_KEYS = ("artist", "remixer", "remix_year", "year")
STRUCTURE_ORDER = ("artists", "featured", "released", "version", "raw")
_VERSION_KEYS = frozenset({"kind", "name", "by", "year", "of"})
_MIXED_BY = re.compile(r"\bmixed\s+by\b", re.I)
_REMIX_OR_MASHUP = re.compile(r"\bremix\b|\bmashup\b", re.I)


def join_names(names: list[str]) -> str:
    names = [n for n in names if n]
    if len(names) <= 2:
        return " & ".join(names)
    return ", ".join(names[:-1]) + " & " + names[-1]


def kind_for(text: str | None) -> str:
    """Kind guessed for legacy remixer text: `other` for "mixed by" without remix or mashup, else `remix`."""
    t = text or ""
    return "other" if _MIXED_BY.search(t) and not _REMIX_OR_MASHUP.search(t) else "remix"


def _text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _int_year(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit() and len(value.strip()) <= 6:
        return int(value.strip())
    return None


def _names_error(label: str) -> ValueError:
    return ValueError(f"{label} must be a list of at most {MAX_NAMES} names")


def clean_names(value: Any, label: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, (list, tuple)):
        raise _names_error(label)
    out: list[str] = []
    seen: set[str] = set()
    for n in value:
        if not isinstance(n, str):
            raise _names_error(label)
        n = n.strip()
        if not n:
            continue
        if len(n) > MAX_NAME:
            raise ValueError(f"{label} names must be at most {MAX_NAME} characters")
        key = n.casefold()
        if key not in seen:
            seen.add(key)
            out.append(n)
    if len(out) > MAX_NAMES:
        raise _names_error(label)
    return out


def _year_checked(value: Any, label: str, stored: Any) -> int | None:
    if value is None:
        return None
    year = _int_year(value)
    if year is not None and (timeutil.valid_year(year) is not None or (stored is not None and year == stored)):
        return year
    raise ValueError(f"{label} must be {timeutil.year_range_text()}")


def _clean_version(value: Any, stored: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("version must be an object or null")
    unknown = set(value) - _VERSION_KEYS
    if unknown:
        raise ValueError(f"version has unknown keys: {', '.join(sorted(unknown))}")
    kind = value.get("kind")
    if kind not in KINDS:
        raise ValueError(f"version.kind must be one of {', '.join(KINDS)}")
    name = _text(value.get("name"))
    if name is not None and len(name) > MAX_VERSION_NAME:
        raise ValueError(f"version.name must be at most {MAX_VERSION_NAME} characters")
    by = clean_names(value.get("by"), "version.by")
    year = _year_checked(value.get("year"), "version.year", (stored or {}).get("year"))
    of = _text(value.get("of"))
    if of is not None and len(of) > MAX_NAME:
        raise ValueError(f"version.of must be at most {MAX_NAME} characters")
    if of and kind != "cover":
        raise ValueError("version.of is only for covers")
    if kind == "other" and not (name or by or year or of):
        return None
    out: dict[str, Any] = {"kind": kind, "name": name, "by": by, "year": year}
    if kind == "cover":
        out["of"] = of
    return out


def version_text(version: dict[str, Any] | None) -> str | None:
    """The legacy `remixer` text of a version: its name, else its by-names, else the capitalised kind (not for `other`)."""
    if not isinstance(version, dict):
        return None
    name = _text(version.get("name"))
    if name:
        return name
    by = [n for n in version.get("by") or [] if isinstance(n, str) and n.strip()]
    if by:
        return join_names(by)
    kind = version.get("kind")
    if isinstance(kind, str) and kind and kind != "other":
        return kind.capitalize()
    return None


def _structured(song: dict[str, Any]) -> bool:
    return isinstance(song.get("artists"), list)


def released(song: dict[str, Any]) -> int | None:
    return _int_year(song.get("released") if _structured(song) else song.get("year"))


def project(song: dict[str, Any]) -> dict[str, Any]:
    """Legacy compatibility values `{artist, remixer, year, remix_year}` derived from the structure (DATA-123)."""
    if not _structured(song):
        return {"artist": _text(song.get("artist")), "remixer": _text(song.get("remixer")),
                "year": _int_year(song.get("year")), "remix_year": _int_year(song.get("remix_year"))}
    artists = [str(a) for a in song["artists"]]
    featured = [str(f) for f in song.get("featured") or []]
    raw = song.get("raw") if isinstance(song.get("raw"), dict) else {}
    raw_artist = raw.get("artist")
    if not artists and not featured:
        artist = None
    elif not featured and isinstance(raw_artist, str) and raw_artist.strip() and split_tokens(raw_artist) == artists:
        artist = raw_artist.strip()
    else:
        line = join_names(artists)
        if featured:
            line = f"{line} feat. {join_names(featured)}" if line else f"feat. {join_names(featured)}"
        artist = line
    version = song.get("version") if isinstance(song.get("version"), dict) else None
    return {
        "artist": artist,
        "remixer": version_text(version),
        "year": _int_year(song.get("released")),
        "remix_year": _int_year(version.get("year")) if version else None,
    }


def artist_string(song: dict[str, Any]) -> str:
    return project(song)["artist"] or ""


def lookup_artist(song: dict[str, Any]) -> str:
    """The artist external lookups ask for: the original artist of a cover, else the credited artists."""
    version = song.get("version") if isinstance(song.get("version"), dict) else None
    if version and version.get("kind") == "cover" and _text(version.get("of")):
        return _text(version.get("of")) or ""
    return artist_string(song)


def has_version(song: dict[str, Any]) -> bool:
    return isinstance(song.get("version"), dict)


def _pills(text: Any) -> list[str]:
    """One entry per pill of a legacy artist string; a string with no pill in it is kept whole."""
    if not isinstance(text, str):
        return []
    return split_tokens(text) or ([text.strip()] if text.strip() else [])


def _raw_of(song: dict[str, Any]) -> dict[str, Any]:
    raw: dict[str, Any] = {}
    for key in ("title", "artist", "remixer"):
        if isinstance(song.get(key), str) and song[key].strip():
            raw[key] = song[key]
    for key in ("year", "remix_year"):
        value = song.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int) or (isinstance(value, str) and value.strip()):
            raw[key] = value
    return raw


def _place(song: dict[str, Any], key: str, value: Any) -> None:
    if key in song:
        song[key] = value
        return
    before = [k for k in STRUCTURE_ORDER[: STRUCTURE_ORDER.index(key)] if k in song]
    if not before:
        song[key] = value
        return
    anchor = before[-1]
    items = list(song.items())
    song.clear()
    for k, v in items:
        song[k] = v
        if k == anchor:
            song[key] = value


def migrate_fields(song: dict[str, Any]) -> None:
    """Rewrite the legacy keys of one song in place into the structure (DATA-125); nothing is split beyond the pill separators."""
    raw = dict(song["raw"]) if isinstance(song.get("raw"), dict) else {}
    for key, value in _raw_of(song).items():
        raw.setdefault(key, value)
    artist = song.get("artist")
    remixer = _text(song.get("remixer"))
    remix_year = _int_year(song.get("remix_year"))
    year = _int_year(song["year"]) if "year" in song else _int_year(song.get("released"))
    version: dict[str, Any] | None = None
    if remixer:
        version = {"kind": kind_for(remixer), "name": remixer, "by": [], "year": remix_year}
    elif remix_year is not None:
        version = {"kind": "other", "name": None, "by": [], "year": remix_year}
    fields: dict[str, Any] = {
        "artists": _pills(artist),
        "featured": [],
        "released": year,
    }
    if version is not None:
        fields["version"] = version
    if raw:
        fields["raw"] = raw
    items = list(song.items())
    anchor = next((k for k, _ in items if k == "artist"), None)
    if anchor is None:
        anchor = next((k for k, _ in items if k in LEGACY_KEYS), None)
    song.clear()
    placed = False
    for k, v in items:
        if k in LEGACY_KEYS or k in fields:
            if k == anchor and not placed:
                song.update(fields)
                placed = True
            continue
        song[k] = v
    if not placed:
        song.update(fields)


def ensure(song: dict[str, Any]) -> bool:
    """Bring one loaded song to the structured shape in place (lazy migration, DATA-025); True when it changed."""
    if _structured(song):
        changed = False
        if not isinstance(song.get("featured"), list):
            _place(song, "featured", [])
            changed = True
        if "released" not in song:
            _place(song, "released", None)
            changed = True
        return absorb(song) or changed
    migrate_fields(song)
    return True


def new_fields(meta: dict[str, Any], raw: dict[str, Any] | None = None) -> dict[str, Any]:
    """The structure fields of a new song record from request-shaped `meta` (legacy keys, structure keys or both) and the source strings (`raw`)."""
    resolved = clean_changes(meta)
    fields: dict[str, Any] = {
        "artists": resolved.get("artists", []),
        "featured": resolved.get("featured", []),
        "released": resolved.get("released"),
    }
    if resolved.get("version"):
        fields["version"] = resolved["version"]
    source: dict[str, Any] = {}
    if isinstance(raw, dict) and raw:
        for key in ("title", "artist", "remixer"):
            text = _text(raw.get(key))
            if text:
                source[key] = text[:MAX_RAW]
    else:
        for key in ("title", "artist", "remixer"):
            text = _text(meta.get(key))
            if text:
                source[key] = text[:MAX_RAW]
    if "title" not in source and _text(meta.get("title")):
        source["title"] = str(_text(meta.get("title")))[:MAX_RAW]
    if source:
        fields["raw"] = source
    return fields


def _norm(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip() or None
    return value


def _legacy_text(changes: dict[str, Any], key: str) -> str | None:
    value = changes[key]
    if value is not None and not isinstance(value, str):
        raise ValueError(f"{key} must be a string")
    return _norm(value)


def clean_changes(changes: dict[str, Any], current: dict[str, Any] | None = None) -> dict[str, Any]:
    """Validate the credit keys of a request and resolve them into structure changes `{artists?, featured?, version?, released?}`.

    Structure keys shadow the legacy keys of their group; a legacy value equal to the projection of `current` is a no-op (DATA-124). Raises ValueError (HTTP 422) with the message to show."""
    cur: dict[str, Any] = {}
    if current is not None:
        cur = current
        if not _structured(cur):
            cur = dict(current)
            ensure(cur)
    proj = project(cur) if cur else {"artist": None, "remixer": None, "year": None, "remix_year": None}
    out: dict[str, Any] = {}

    if "artists" in changes or "featured" in changes:
        if "artists" in changes:
            out["artists"] = clean_names(changes["artists"], "artists")
        if "featured" in changes:
            out["featured"] = clean_names(changes["featured"], "featured")
    elif "artist" in changes:
        text = _legacy_text(changes, "artist")
        if text != _norm(proj["artist"]):
            out["artists"] = clean_names(_pills(text), "artists")
            out["featured"] = []

    stored = cur.get("version") if isinstance(cur.get("version"), dict) else None
    if "version" in changes:
        out["version"] = _clean_version(changes["version"], stored)
    elif "remixer" in changes or "remix_year" in changes:
        version = copy.deepcopy(stored)
        touched = False
        if "remixer" in changes:
            text = _legacy_text(changes, "remixer")
            if text != _norm(proj["remixer"]):
                touched = True
                if text is None:
                    version = None
                elif version is not None:
                    version["name"] = text
                else:
                    version = {"kind": kind_for(text), "name": text, "by": [], "year": None}
        if "remix_year" in changes:
            value = changes["remix_year"]
            year = _year_checked(value, "remix_year", proj["remix_year"])
            if year != proj["remix_year"]:
                touched = True
                if version is None:
                    if year is not None:
                        version = {"kind": "other", "name": None, "by": [], "year": year}
                else:
                    version["year"] = year
        if touched:
            checked = _clean_version(version, stored) if version is not None else None
            out["version"] = checked

    if "released" in changes:
        out["released"] = _year_checked(changes["released"], "released", cur.get("released"))
    elif "year" in changes:
        value = changes["year"]
        if value is not None and _int_year(value) is None:
            raise ValueError(f"year must be {timeutil.year_range_text()}")
        year = _int_year(value) if value is not None else None
        if year != proj["year"]:
            out["released"] = _year_checked(year, "year", cur.get("released"))
    return out


def apply_changes(song: dict[str, Any], changes: dict[str, Any]) -> None:
    """Write the resolved credit changes of a request into the stored `song` in place."""
    if not _structured(song):
        ensure(song)
    resolved = clean_changes(changes, song)
    for key in ("artists", "featured", "released"):
        if key in resolved:
            _place(song, key, resolved[key])
    if "version" in resolved:
        if resolved["version"] is None:
            song.pop("version", None)
        else:
            _place(song, "version", resolved["version"])


def absorb(song: dict[str, Any]) -> bool:
    """Convert legacy keys left on a structured song by code that still assigns them (a safety net, DATA-124); True when it changed."""
    present = [k for k in LEGACY_KEYS if k in song]
    if not present:
        return False
    if not _structured(song):
        migrate_fields(song)
        return True
    log.warning("song %s carries legacy keys %s; converting", song.get("id"), present)
    changes = {k: song.pop(k) for k in present}
    try:
        apply_changes(song, changes)
    except ValueError as exc:
        raw = song["raw"] if isinstance(song.get("raw"), dict) else {}
        raw["rejected"] = {**(raw["rejected"] if isinstance(raw.get("rejected"), dict) else {}), **changes}
        song["raw"] = raw
        log.warning("song %s: legacy value kept in raw.rejected: %s", song.get("id"), exc)
    return True
