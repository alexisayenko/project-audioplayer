"""Structured credits and versions of a song, data model v2 (DATA-144..155): the stored shape, the legacy compatibility projection and the one place that turns requests into structure.

Stored: `title`, `mainArtists`, `featuredArtists`, `releaseYear`, `albums`, optional `version {type, name, artists, releaseYear, originalArtists?}`, `rawTitle`.
Requests may still use the ADR-0024 names (`artists`, `featured`, `released`, `version.kind/by/year/of`) and the flat legacy ones (`artist`, `remixer`, `remix_year`, `year`, `album`) for one release."""

from __future__ import annotations

import copy
import logging
from typing import Any

from . import credits_v1, timeutil
from .credits_v1 import int_year as _int_year
from .credits_v1 import join_names, kind_for
from .credits_v1 import text as _text
from .tokens import split_tokens

log = logging.getLogger(__name__)

SCHEMA = 2
TYPES = ("remix", "cover", "mashup", "live", "acoustic", "extended", "instrumental", "remaster", "edit", "other")
KINDS = TYPES
MAX_NAMES = 30
MAX_NAME = 200
MAX_VERSION_NAME = 300
MAX_RAW = 500
ORIGINAL_TYPES = credits_v1.ORIGINAL_TYPES
LEGACY_KEYS = credits_v1.LEGACY_KEYS
OLD_NAME_KEYS = credits_v1.V1_KEYS
STRUCTURE_ORDER = ("mainArtists", "featuredArtists", "releaseYear", "albums", "version", "rawTitle")
_VERSION_KEYS = frozenset({"type", "name", "artists", "releaseYear", "originalArtists"})
_OLD_VERSION_KEYS = {"kind": "type", "by": "artists", "year": "releaseYear", "of": "originalArtists"}


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


def of_names(value: Any) -> list[str]:
    """`originalArtists` as a list of names: a request string becomes a one-element list, anything else unusable an empty one."""
    return credits_v1.names_of(value)


def _clean_original(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    return clean_names(value, "version.originalArtists")


def _year_checked(value: Any, label: str, stored: Any) -> int | None:
    if value is None:
        return None
    year = _int_year(value)
    if year is not None and (timeutil.valid_year(year) is not None or (stored is not None and year == stored)):
        return year
    raise ValueError(f"{label} must be {timeutil.year_range_text()}")


def canon_version(value: dict[str, Any]) -> dict[str, Any]:
    """A request `version` object with the ADR-0024 keys renamed to the v2 ones (a v2 key wins when both are sent)."""
    unknown = set(value) - _VERSION_KEYS - set(_OLD_VERSION_KEYS)
    if unknown:
        raise ValueError(f"version has unknown keys: {', '.join(sorted(unknown))}")
    out = {k: v for k, v in value.items() if k in _VERSION_KEYS}
    for old, new in _OLD_VERSION_KEYS.items():
        if old in value and new not in out:
            out[new] = value[old]
    return out


def _clean_version(value: Any, stored: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("version must be an object or null")
    value = canon_version(value)
    vtype = value.get("type")
    if vtype not in TYPES:
        raise ValueError(f"version.type must be one of {', '.join(TYPES)}")
    name = _text(value.get("name"))
    if name is not None and len(name) > MAX_VERSION_NAME:
        raise ValueError(f"version.name must be at most {MAX_VERSION_NAME} characters")
    artists = clean_names(value.get("artists"), "version.artists")
    year = _year_checked(value.get("releaseYear"), "version.releaseYear", (stored or {}).get("releaseYear"))
    original = _clean_original(value.get("originalArtists"))
    if original and vtype not in ORIGINAL_TYPES:
        raise ValueError("version.originalArtists is only for covers and mashups")
    if vtype == "other" and not (name or artists or year or original):
        return None
    out: dict[str, Any] = {"type": vtype, "name": name, "artists": artists, "releaseYear": year}
    if original:
        out["originalArtists"] = original
    return out


def version_text(version: dict[str, Any] | None) -> str | None:
    """The legacy `remixer` text of a version: its name, else its artists, else the capitalised type (not for `other`)."""
    if not isinstance(version, dict):
        return None
    name = _text(version.get("name"))
    if name:
        return name
    artists = credits_v1.names_of(version.get("artists"))
    if artists:
        return join_names(artists)
    vtype = version.get("type")
    if isinstance(vtype, str) and vtype and vtype != "other":
        return vtype.capitalize()
    return None


def _structured(song: dict[str, Any]) -> bool:
    return credits_v1.is_v2(song)


def release_year(song: dict[str, Any]) -> int | None:
    if _structured(song):
        return _int_year(song.get("releaseYear"))
    return _int_year(song.get("released") if isinstance(song.get("artists"), list) else song.get("year"))


def main_artists(song: dict[str, Any]) -> list[str]:
    return credits_v1.names_of(song.get("mainArtists"))


def albums(song: dict[str, Any]) -> list[str]:
    return credits_v1.names_of(song.get("albums"))


def first_album(song: dict[str, Any]) -> str | None:
    found = albums(song)
    return found[0] if found else None


def project(song: dict[str, Any]) -> dict[str, Any]:
    """Legacy compatibility values `{artist, remixer, year, remix_year, album}` derived from the structure (DATA-149)."""
    if not _structured(song):
        return credits_v1.project_v1(song)
    main = [str(a) for a in song["mainArtists"]]
    featured = [str(f) for f in song.get("featuredArtists") or []]
    raw = song.get("raw") if isinstance(song.get("raw"), dict) else {}
    raw_artist = raw.get("artist")
    if not main and not featured:
        artist = None
    elif not featured and isinstance(raw_artist, str) and raw_artist.strip() and split_tokens(raw_artist) == main:
        artist = raw_artist.strip()
    else:
        line = join_names(main)
        if featured:
            line = f"{line} feat. {join_names(featured)}" if line else f"feat. {join_names(featured)}"
        artist = line
    version = song.get("version") if isinstance(song.get("version"), dict) else None
    return {
        "artist": artist,
        "remixer": version_text(version),
        "year": _int_year(song.get("releaseYear")),
        "remix_year": _int_year(version.get("releaseYear")) if version else None,
        "album": first_album(song),
    }


def artist_string(song: dict[str, Any]) -> str:
    return project(song)["artist"] or ""


def lookup_artist(song: dict[str, Any]) -> str:
    """The artist external lookups ask for: the original artist of a cover, else the credited artists."""
    version = song.get("version") if isinstance(song.get("version"), dict) else None
    if version and version.get("type") == "cover" and of_names(version.get("originalArtists")):
        return join_names(of_names(version.get("originalArtists")))
    return artist_string(song)


def has_version(song: dict[str, Any]) -> bool:
    return isinstance(song.get("version"), dict)


def version_type(song: dict[str, Any]) -> str | None:
    version = song.get("version")
    return version.get("type") if isinstance(version, dict) else None


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


def ensure(song: dict[str, Any]) -> bool:
    """Bring one loaded song to the v2 shape in place (lazy migration, DATA-025); True when it changed."""
    changed = credits_v1.to_v2(song)
    if not isinstance(song.get("featuredArtists"), list):
        _place(song, "featuredArtists", [])
        changed = True
    if "releaseYear" not in song:
        _place(song, "releaseYear", None)
        changed = True
    if not isinstance(song.get("albums"), list):
        _place(song, "albums", [])
        changed = True
    version = song.get("version")
    if isinstance(version, dict):
        fixed = _version_in_shape(version)
        if fixed != version:
            song["version"] = fixed
            changed = True
    return absorb(song) or changed


def _version_in_shape(version: dict[str, Any]) -> dict[str, Any]:
    if any(k in version for k in _OLD_VERSION_KEYS):
        version = credits_v1.version_v2(version) if "kind" in version else canon_version(version)
    out = dict(version)
    if not isinstance(out.get("artists"), list):
        out["artists"] = credits_v1.names_of(out.get("artists"))
    if "originalArtists" in out and not isinstance(out["originalArtists"], list):
        out["originalArtists"] = of_names(out["originalArtists"])
    if "originalArtists" in out and not out["originalArtists"]:
        del out["originalArtists"]
    for key in ("name", "releaseYear"):
        out.setdefault(key, None)
    return out


def new_fields(meta: dict[str, Any], raw: dict[str, Any] | None = None) -> dict[str, Any]:
    """The structure fields of a new song record from request-shaped `meta` (any naming) and the source strings (`raw`)."""
    resolved = clean_changes(meta)
    fields: dict[str, Any] = {
        "mainArtists": resolved.get("mainArtists", []),
        "featuredArtists": resolved.get("featuredArtists", []),
        "releaseYear": resolved.get("releaseYear"),
        "albums": resolved.get("albums", []),
    }
    if resolved.get("version"):
        fields["version"] = resolved["version"]
    title = _text(raw.get("title")) if isinstance(raw, dict) else None
    title = title or _text(meta.get("title"))
    if title:
        fields["rawTitle"] = title[:MAX_RAW]
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


def canon_request(changes: dict[str, Any]) -> dict[str, Any]:
    """The credit keys of a request under their v2 names; the v2 name wins over the ADR-0024 one, flat legacy keys pass through."""
    out: dict[str, Any] = {}
    for new, old in (("mainArtists", "artists"), ("featuredArtists", "featured"), ("releaseYear", "released")):
        if new in changes:
            out[new] = changes[new]
        elif old in changes:
            out[new] = changes[old]
    if "version" in changes:
        out["version"] = changes["version"]
    if "albums" in changes:
        out["albums"] = changes["albums"]
    for key in (*LEGACY_KEYS, "album"):
        if key in changes:
            out[key] = changes[key]
    return out


def clean_changes(changes: dict[str, Any], current: dict[str, Any] | None = None) -> dict[str, Any]:
    """Validate the credit keys of a request and resolve them into structure changes `{mainArtists?, featuredArtists?, version?, releaseYear?, albums?}`.

    Structure keys shadow the legacy keys of their group; a legacy value equal to the projection of `current` is a no-op (DATA-130). Raises ValueError (HTTP 422) with the message to show."""
    changes = canon_request(changes)
    cur: dict[str, Any] = {}
    if current is not None:
        cur = current
        if not _structured(cur):
            cur = dict(current)
            ensure(cur)
    proj = project(cur) if cur else {"artist": None, "remixer": None, "year": None, "remix_year": None, "album": None}
    out: dict[str, Any] = {}

    if "mainArtists" in changes or "featuredArtists" in changes:
        if "mainArtists" in changes:
            out["mainArtists"] = clean_names(changes["mainArtists"], "mainArtists")
        if "featuredArtists" in changes:
            out["featuredArtists"] = clean_names(changes["featuredArtists"], "featuredArtists")
    elif "artist" in changes:
        text = _legacy_text(changes, "artist")
        if text != _norm(proj["artist"]):
            out["mainArtists"] = clean_names(credits_v1.pills(text), "mainArtists")
            out["featuredArtists"] = []

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
                    version = {"type": kind_for(text), "name": text, "artists": [], "releaseYear": None}
        if "remix_year" in changes:
            year = _year_checked(changes["remix_year"], "remix_year", proj["remix_year"])
            if year != proj["remix_year"]:
                touched = True
                if version is None:
                    if year is not None:
                        version = {"type": "other", "name": None, "artists": [], "releaseYear": year}
                else:
                    version["releaseYear"] = year
        if touched:
            out["version"] = _clean_version(version, stored) if version is not None else None

    if "releaseYear" in changes:
        out["releaseYear"] = _year_checked(changes["releaseYear"], "releaseYear", cur.get("releaseYear"))
    elif "year" in changes:
        value = changes["year"]
        if value is not None and _int_year(value) is None:
            raise ValueError(f"year must be {timeutil.year_range_text()}")
        year = _int_year(value) if value is not None else None
        if year != proj["year"]:
            out["releaseYear"] = _year_checked(year, "year", cur.get("releaseYear"))

    if "albums" in changes:
        out["albums"] = clean_names(changes["albums"], "albums")
    elif "album" in changes:
        text = _legacy_text(changes, "album")
        if text != _norm(proj["album"]):
            out["albums"] = [text] if text else []
    return out


def apply_changes(song: dict[str, Any], changes: dict[str, Any]) -> None:
    """Write the resolved credit changes of a request into the stored `song` in place."""
    if not _structured(song):
        ensure(song)
    resolved = clean_changes(changes, song)
    for key in ("mainArtists", "featuredArtists", "releaseYear", "albums"):
        if key in resolved:
            _place(song, key, resolved[key])
    if "version" in resolved:
        if resolved["version"] is None:
            song.pop("version", None)
        else:
            _place(song, "version", resolved["version"])


def absorb(song: dict[str, Any]) -> bool:
    """Convert flat legacy and ADR-0024 keys left on a v2 song by code that still assigns them (a safety net, DATA-124); True when it changed."""
    present = [k for k in (*LEGACY_KEYS, *OLD_NAME_KEYS) if k in song and k != "raw"]
    if not present:
        return False
    if not _structured(song):
        credits_v1.to_v2(song)
        return True
    log.warning("song %s carries old keys %s; converting", song.get("id"), present)
    changes = {k: song.pop(k) for k in present}
    try:
        apply_changes(song, changes)
    except ValueError as exc:
        raw = song["raw"] if isinstance(song.get("raw"), dict) else {}
        raw["rejected"] = {**(raw["rejected"] if isinstance(raw.get("rejected"), dict) else {}), **changes}
        song["raw"] = raw
        log.warning("song %s: old value kept in raw.rejected: %s", song.get("id"), exc)
    return True


def suggestion(found: dict[str, Any]) -> dict[str, Any]:
    """A `credits_split.suggest` result under the v2 names (`mainArtists`, `featuredArtists`, `version.type/artists/originalArtists`); a suggestion only, never stored as is."""
    out = {("mainArtists" if k == "artists" else "featuredArtists" if k == "featured" else k): v for k, v in found.items() if k != "version"}
    version = found.get("version")
    if isinstance(version, dict):
        renamed = {"kind": "type", "by": "artists", "of": "originalArtists"}
        out["version"] = {renamed.get(k, k): v for k, v in version.items()}
    else:
        out["version"] = None
    return out
