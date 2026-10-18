"""The two shapes older than data model v2, read-only: the flat legacy keys (`artist`, `remixer`, `year`, `remix_year`) and the ADR-0024 structure (`artists`, `featured`, `released`, `version.kind/by/year/of`, `album`, `raw`).

Used to convert a loaded song to v2 in memory and as the oracle of the model-2 migration check (`project_v1`); nothing here is ever written back."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from .tokens import split_tokens

LEGACY_KEYS = ("artist", "remixer", "remix_year", "year")
V1_KEYS = ("artists", "featured", "released", "album", "raw")
ORIGINAL_TYPES = ("cover", "mashup")
_MIXED_BY = re.compile(r"\bmixed\s+by\b", re.I)
_REMIX_OR_MASHUP = re.compile(r"\bremix\b|\bmashup\b", re.I)


def text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def int_year(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit() and len(value.strip()) <= 6:
        return int(value.strip())
    return None


def join_names(names: list[str]) -> str:
    names = [n for n in names if n]
    if len(names) <= 2:
        return " & ".join(names)
    return ", ".join(names[:-1]) + " & " + names[-1]


def kind_for(value: str | None) -> str:
    """Type guessed for legacy remixer text: `other` for "mixed by" without remix or mashup, else `remix`."""
    t = value or ""
    return "other" if _MIXED_BY.search(t) and not _REMIX_OR_MASHUP.search(t) else "remix"


def pills(value: Any) -> list[str]:
    """One entry per pill of a legacy artist string; a string with no pill in it is kept whole."""
    if not isinstance(value, str):
        return []
    return split_tokens(value) or ([value.strip()] if value.strip() else [])


def names_of(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, (list, tuple)):
        return [n.strip() for n in value if isinstance(n, str) and n.strip()]
    return []


def is_v2(song: dict[str, Any]) -> bool:
    return isinstance(song.get("mainArtists"), list)


def is_v1(song: dict[str, Any]) -> bool:
    return not is_v2(song) and isinstance(song.get("artists"), list)


def is_flat(song: dict[str, Any]) -> bool:
    return not is_v2(song) and not isinstance(song.get("artists"), list)


def version_text_v1(version: dict[str, Any] | None) -> str | None:
    if not isinstance(version, dict):
        return None
    name = text(version.get("name"))
    if name:
        return name
    by = names_of(version.get("by"))
    if by:
        return join_names(by)
    kind = version.get("kind")
    if isinstance(kind, str) and kind and kind != "other":
        return kind.capitalize()
    return None


def project_v1(song: dict[str, Any]) -> dict[str, Any]:
    """`{artist, remixer, year, remix_year, album}` of a flat or ADR-0024 song, as the deployed server derived them (the migration oracle)."""
    album = text(song.get("album"))
    if not isinstance(song.get("artists"), list):
        return {"artist": text(song.get("artist")), "remixer": text(song.get("remixer")),
                "year": int_year(song.get("year")), "remix_year": int_year(song.get("remix_year")), "album": album}
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
    return {"artist": artist, "remixer": version_text_v1(version), "year": int_year(song.get("released")),
            "remix_year": int_year(version.get("year")) if version else None, "album": album}


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


def _flat_version(remixer: str | None, remix_year: int | None) -> dict[str, Any] | None:
    if remixer:
        return {"kind": kind_for(remixer), "name": remixer, "by": [], "year": remix_year}
    if remix_year is not None:
        return {"kind": "other", "name": None, "by": [], "year": remix_year}
    return None


def _refill(song: dict[str, Any], items: list[tuple[str, Any]], fields: dict[str, Any]) -> None:
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


def flat_to_v1(song: dict[str, Any]) -> None:
    """Rewrite the flat legacy keys of one song in place into the ADR-0024 structure; nothing is split beyond the pill separators."""
    raw = dict(song["raw"]) if isinstance(song.get("raw"), dict) else {}
    for key, value in _raw_of(song).items():
        raw.setdefault(key, value)
    remixer = text(song.get("remixer"))
    remix_year = int_year(song.get("remix_year"))
    year = int_year(song["year"]) if "year" in song else int_year(song.get("released"))
    version = _flat_version(remixer, remix_year)
    fields: dict[str, Any] = {"artists": pills(song.get("artist")), "featured": [], "released": year}
    if version is not None:
        fields["version"] = version
    if raw:
        fields["raw"] = raw
    _refill(song, list(song.items()), fields)


def version_v2(version: dict[str, Any]) -> dict[str, Any]:
    kind = version.get("kind")
    out: dict[str, Any] = {"type": kind, "name": text(version.get("name")), "artists": names_of(version.get("by")),
                           "releaseYear": int_year(version.get("year"))}
    original = names_of(version.get("of"))
    if original and kind in ORIGINAL_TYPES:
        out["originalArtists"] = original
    return out


def keeps_raw(song: dict[str, Any]) -> bool:
    """True when dropping `raw` would change the derived `artist` of this ADR-0024 song (the original text differs from the joined names)."""
    raw = song.get("raw") if isinstance(song.get("raw"), dict) else None
    if not raw:
        return False
    after = {**song, "raw": None}
    return project_v1(song)["artist"] != project_v1(after)["artist"]


def _name_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _album_list(value: Any) -> list[str]:
    album = text(value)
    return [album] if album else []


_V2_RENAMES: dict[str, tuple[str, Callable[[Any], Any]]] = {
    "artists": ("mainArtists", _name_list),
    "featured": ("featuredArtists", _name_list),
    "released": ("releaseYear", int_year),
    "album": ("albums", _album_list),
}


def _raw_entries(value: Any, raw: dict[str, Any] | None, keep_raw: bool) -> list[tuple[str, Any]]:
    entries: list[tuple[str, Any]] = []
    title = text(raw.get("title")) if raw else None
    if title:
        entries.append(("rawTitle", title))
    if keep_raw:
        entries.append(("raw", value))
    return entries


def _v2_entries(key: str, value: Any, raw: dict[str, Any] | None, keep_raw: bool) -> list[tuple[str, Any]]:
    if key in _V2_RENAMES:
        new_key, convert = _V2_RENAMES[key]
        return [(new_key, convert(value))]
    if key == "version":
        return [("version", version_v2(value))] if isinstance(value, dict) else []
    if key == "raw":
        return _raw_entries(value, raw, keep_raw)
    return [(key, value)]


def v1_to_v2(song: dict[str, Any]) -> None:
    """Rename the keys of one ADR-0024 song in place; the values are untouched except `album`, `version` and `raw`."""
    keep_raw = keeps_raw(song)
    raw = song.get("raw") if isinstance(song.get("raw"), dict) else None
    items = list(song.items())
    song.clear()
    for key, value in items:
        for new_key, new_value in _v2_entries(key, value, raw, keep_raw):
            song[new_key] = new_value
    song.setdefault("featuredArtists", [])
    song.setdefault("albums", [])
    song.setdefault("releaseYear", None)


def to_v2(song: dict[str, Any]) -> bool:
    """Bring a flat or ADR-0024 song to the v2 key names in place; True when it changed."""
    if is_v2(song):
        return False
    if is_flat(song):
        flat_to_v1(song)
    v1_to_v2(song)
    return True
