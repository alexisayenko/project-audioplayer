"""Reference tracks per genre (ADR-0044, task-0093): one shared, owner-curated catalogue `genre_references.json` beside `users/` in the data root (`audioplayer/` of the data repo, so it is git-synced like the libraries), `{genre: [entry]}`, an entry being `{id, artist, title, year?, role, note?, sources?: [{type, url, note?}], song_id?, reviewed}`. Entries are only changed under `deps.tx` by the owner."""

from __future__ import annotations

import json
import re
import secrets
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from . import deps, genre_filter, genre_vocab
from .jsonio import write_json_atomic
from .problems import Problem

FILE_NAME = "genre_references.json"
ROLES = ("archetype", "origin", "landmark", "breakthrough")
MAX_ENTRIES_PER_GENRE = 500
MAX_ARTIST = 200
MAX_TITLE = 200
MAX_NOTE = 1000
MAX_URL = 500
MAX_SOURCES = 8
MAX_SOURCE_NOTE = 200
SOURCE_TYPES = ("wikipedia", "musicbrainz", "discogs", "rym", "allmusic", "chart", "critic", "compilation", "other")
MIN_YEAR = 1850
MAX_YEAR = 2100
ID_BYTES = 4
_NON_WORD = re.compile(r"[\W_]+")


def path() -> Path:
    return deps.data_root() / FILE_NAME


def load() -> dict[str, list[dict[str, Any]]]:
    """The catalogue; a missing, unreadable or malformed file is an empty one and malformed entries are skipped."""
    try:
        raw = json.loads(path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[dict[str, Any]]] = {}
    for genre, rows in raw.items():
        if not isinstance(genre, str) or not isinstance(rows, list):
            continue
        kept = [_upgrade(r) for r in rows if isinstance(r, dict) and isinstance(r.get("id"), str) and isinstance(r.get("artist"), str) and isinstance(r.get("title"), str) and r.get("role") in ROLES]
        if kept:
            out[genre] = kept
    return out


def _upgrade(row: dict[str, Any]) -> dict[str, Any]:
    """Read the old single `source_url` as one source of type `other`."""
    legacy = row.pop("source_url", None)
    if isinstance(legacy, str) and legacy.strip() and not row.get("sources"):
        row["sources"] = [{"type": "other", "url": legacy.strip()}]
    return row


def save(doc: dict[str, list[dict[str, Any]]]) -> None:
    write_json_atomic(path(), {g: rows for g, rows in sorted(doc.items()) if rows})


def resolve_genre(name: str) -> str | None:
    """The canonical vocabulary name for a spelling, an alias or a synonym; None for anything else (a group or family-only name included only when it is an entry)."""
    value = " ".join(str(name).split())
    if not value:
        return None
    found = genre_vocab.lookup(value) or genre_filter.vocabulary_name(value)
    if found:
        return found
    k = genre_vocab.vkey(value)
    levels, _, _ = genre_vocab.load_levels()
    for table in (levels, genre_vocab.load_forms()):
        for gname, spec in table.items():
            if any(genre_vocab.vkey(s) == k for s in spec.get("synonyms", [])) and genre_vocab.is_canonical(gname):
                return gname
    return None


def norm_key(artist: str, title: str) -> str:
    return _NON_WORD.sub("", genre_vocab.key(artist)) + "|" + _NON_WORD.sub("", genre_vocab.key(title))


def _text(value: Any, label: str, limit: int, required: bool = False) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise Problem(422, "bad_reference", f"{label} is required.")
        return None
    if not isinstance(value, str):
        raise Problem(422, "bad_reference", f"{label} must be text.")
    text = " ".join(value.split())
    if len(text) > limit:
        raise Problem(422, "bad_reference", f"{label} is at most {limit} characters.")
    return text


def clean_role(value: Any) -> str:
    if value not in ROLES:
        raise Problem(422, "bad_role", f"role must be one of {', '.join(ROLES)}.")
    return str(value)


def clean_year(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not MIN_YEAR <= value <= MAX_YEAR:
        raise Problem(422, "bad_reference", f"year must be a whole number from {MIN_YEAR} to {MAX_YEAR}.")
    return value


def clean_url(value: Any) -> str | None:
    text = _text(value, "source_url", MAX_URL)
    if text is None:
        return None
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or " " in text:
        raise Problem(422, "bad_reference", "source_url must be an http or https address.")
    return text


def clean_sources(value: Any) -> list[dict[str, str]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise Problem(422, "bad_sources", "sources must be a list.")
    if len(value) > MAX_SOURCES:
        raise Problem(422, "bad_sources", f"At most {MAX_SOURCES} sources.")
    out: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            raise Problem(422, "bad_sources", "Each source is {type, url, note?}.")
        stype = item.get("type")
        if stype not in SOURCE_TYPES:
            raise Problem(422, "bad_sources", f"source type must be one of {', '.join(SOURCE_TYPES)}.")
        url = clean_url(item.get("url"))
        if url is None:
            raise Problem(422, "bad_sources", "Each source needs a url.")
        note = _text(item.get("note"), "source note", MAX_SOURCE_NOTE)
        if all(o["url"] != url for o in out):
            out.append({"type": stype, "url": url, **({"note": note} if note else {})})
    return out


def sources_from(fields: dict[str, Any]) -> list[dict[str, str]]:
    """`sources` as sent; a lone legacy `source_url` (input only) becomes the first source of type `other`."""
    if fields.get("sources") is not None:
        return clean_sources(fields["sources"])
    legacy = clean_url(fields.get("source_url"))
    return [{"type": "other", "url": legacy}] if legacy else []


def clean_note(value: Any) -> str | None:
    if isinstance(value, str) and len(value.strip()) > MAX_NOTE:
        raise Problem(422, "bad_reference", f"note is at most {MAX_NOTE} characters.")
    return _text(value, "note", MAX_NOTE)


def new_id(doc: dict[str, list[dict[str, Any]]]) -> str:
    taken = {r["id"] for rows in doc.values() for r in rows}
    while True:
        rid = secrets.token_hex(ID_BYTES)
        if rid not in taken:
            return rid


def song_facts(song: dict[str, Any]) -> dict[str, Any]:
    """artist, title and year of a working library song, as a reference entry takes them."""
    from . import credits

    work = dict(song)
    credits.ensure(work)
    artist = credits.project(work).get("artist") or ""
    return {"artist": artist, "title": str(song.get("title") or ""), "year": credits.display_year(work)}


def make_entry(doc: dict[str, list[dict[str, Any]]], genre: str, fields: dict[str, Any], reviewed: bool = True) -> dict[str, Any]:
    """Validate and build a new entry; raises Problem 422 for a bad field and 409 `reference_exists` for a duplicate in the genre."""
    entry: dict[str, Any] = {
        "id": new_id(doc),
        "artist": _text(fields.get("artist"), "artist", MAX_ARTIST, required=True),
        "title": _text(fields.get("title"), "title", MAX_TITLE, required=True),
        "role": clean_role(fields.get("role")),
        "reviewed": reviewed,
    }
    for name, value in (("year", clean_year(fields.get("year"))), ("note", clean_note(fields.get("note"))), ("song_id", fields.get("song_id") or None)):
        if value is not None:
            entry[name] = value
    sources = sources_from(fields)
    if sources:
        entry["sources"] = sources
    rows = doc.get(genre, [])
    if len(rows) >= MAX_ENTRIES_PER_GENRE:
        raise Problem(422, "too_many_references", f"A genre holds at most {MAX_ENTRIES_PER_GENRE} reference tracks.")
    key = norm_key(entry["artist"], entry["title"])
    if any(norm_key(r["artist"], r["title"]) == key for r in rows):
        raise Problem(409, "reference_exists", "That track is already a reference for this genre.")
    return entry


def by_song(doc: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, str]]]:
    out: dict[str, list[dict[str, str]]] = {}
    for genre in sorted(doc):
        for r in doc[genre]:
            if r.get("song_id"):
                out.setdefault(str(r["song_id"]), []).append({"genre": genre, "role": r["role"]})
    return out


def public(entry: dict[str, Any]) -> dict[str, Any]:
    """The entry as the API returns it: `sources` always a list, plus `source_count` (distinct urls)."""
    out = {k: v for k, v in entry.items() if k != "source_url"}
    sources = out.get("sources") or []
    out["sources"] = sources
    out["source_count"] = len({s["url"] for s in sources})
    return out


def summary(entry: dict[str, Any]) -> dict[str, Any]:
    out = {k: entry[k] for k in ("id", "artist", "title", "year", "role", "song_id", "reviewed") if k in entry}
    out["source_count"] = public(entry)["source_count"]
    return out
