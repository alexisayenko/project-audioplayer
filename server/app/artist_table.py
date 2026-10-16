"""The Artist table of data model v2 (DATA-148): `[{name, countries[]}]` kept in `library.json` beside the songs, keyed by name (case-insensitive).

No type, members or ids. Countries are lowercase ISO 3166-1 alpha-2 codes, the same values the `country:` tags used to hold."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from . import countrycodes

MAX_COUNTRIES = 5
MAX_ARTISTS = 20000


def key(name: Any) -> str:
    return " ".join(str(name or "").split()).casefold()


def clean_countries(values: Any) -> list[str]:
    """Canonical, deduplicated codes in the given order; unknown values are dropped."""
    out: list[str] = []
    for v in values if isinstance(values, (list, tuple)) else []:
        code = countrycodes.canonical_country(str(v))
        if code and code not in out:
            out.append(code)
    return out[:MAX_COUNTRIES]


def parse(raw: Any) -> list[dict[str, Any]]:
    """The stored list as a clean list: entries with a name, one per key (first spelling kept), countries canonical."""
    out: dict[str, dict[str, Any]] = {}
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict) or not isinstance(e.get("name"), str):
            continue
        name = " ".join(e["name"].split())
        if not name or key(name) in out:
            continue
        out[key(name)] = {"name": name, "countries": clean_countries(e.get("countries"))}
    return list(out.values())[:MAX_ARTISTS]


def index(table: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {key(e["name"]): e for e in table}


def countries_for(table: list[dict[str, Any]] | dict[str, dict[str, Any]], names: Iterable[str]) -> list[str]:
    """Union of the countries of the given artists, in name order."""
    idx = table if isinstance(table, dict) else index(table)
    out: list[str] = []
    for n in names:
        for c in (idx.get(key(n)) or {}).get("countries") or []:
            if c not in out:
                out.append(c)
    return out


def find(table: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    k = key(name)
    return next((e for e in table if key(e["name"]) == k), None)


def set_countries(table: list[dict[str, Any]], name: str, countries: Iterable[str]) -> dict[str, Any]:
    """Replace the countries of one artist, adding the entry when it is new."""
    entry = find(table, name)
    if entry is None:
        entry = {"name": " ".join(name.split()), "countries": []}
        table.append(entry)
    entry["countries"] = clean_countries(list(countries))
    return entry


def fill_countries(table: list[dict[str, Any]], name: str, countries: Iterable[str]) -> bool:
    """Set the countries of an artist that has none yet; True when it changed."""
    entry = find(table, name)
    if entry is not None and entry["countries"]:
        return False
    found = clean_countries(list(countries))
    if not found:
        return False
    set_countries(table, name, found)
    return True


def sync_names(table: list[dict[str, Any]], songs: list[dict[str, Any]]) -> None:
    """One entry per main-artist name in use; entries nobody uses and without countries are dropped."""
    used: dict[str, str] = {}
    for s in songs:
        for n in s.get("mainArtists") or []:
            if isinstance(n, str) and key(n):
                used.setdefault(key(n), " ".join(n.split()))
    have = index(table)
    table[:] = [e for e in table if e["countries"] or key(e["name"]) in used]
    for k, name in used.items():
        if k not in have:
            table.append({"name": name, "countries": []})
    table.sort(key=lambda e: key(e["name"]))
