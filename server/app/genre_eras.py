"""Eras per genre (ADR-0044, decision GF1): `genre_eras.json` beside `genre_references.json` in the data root, `{genre: [era]}`, an era being `{id, name, start?, end?, note?, sources?: [{type, url, note?}]}`. Reference entries point at an era by `era` (its id). Only changed under `deps.tx` by the owner."""

from __future__ import annotations

import json
import secrets
from pathlib import Path
from typing import Any

from . import deps, genre_references as refs
from .jsonio import write_json_atomic
from .problems import Problem

FILE_NAME = "genre_eras.json"
MAX_ERAS = 12
MAX_NAME = 60
MAX_NOTE = 300
MIN_YEAR = 1900
MAX_YEAR = 2100
ID_BYTES = 4


def path() -> Path:
    return deps.data_root() / FILE_NAME


def load() -> dict[str, list[dict[str, Any]]]:
    """A missing, unreadable or malformed file is an empty one and malformed eras are skipped."""
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
        kept = [r for r in rows if isinstance(r, dict) and isinstance(r.get("id"), str) and isinstance(r.get("name"), str)]
        if kept:
            out[genre] = kept
    return out


def save(doc: dict[str, list[dict[str, Any]]]) -> None:
    write_json_atomic(path(), {g: rows for g, rows in sorted(doc.items()) if rows})


def sort_key(era: dict[str, Any]) -> tuple[int, int, str]:
    start = era.get("start")
    return (0, start, era["name"].casefold()) if isinstance(start, int) else (1, 0, era["name"].casefold())


def ordered(eras: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(eras, key=sort_key)


def _year(value: Any, label: str) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not MIN_YEAR <= value <= MAX_YEAR:
        raise Problem(422, "bad_era", f"{label} must be a whole year from {MIN_YEAR} to {MAX_YEAR}.")
    return value


def _era_text(value: Any, label: str, limit: int, required: bool = False) -> str | None:
    if isinstance(value, str) and len(" ".join(value.split())) > limit:
        raise Problem(422, "bad_era", f"{label} is at most {limit} characters.")
    if value is not None and not isinstance(value, str):
        raise Problem(422, "bad_era", f"{label} must be text.")
    text = " ".join(value.split()) if isinstance(value, str) else ""
    if not text:
        if required:
            raise Problem(422, "bad_era", f"{label} is required.")
        return None
    return text


def clean_all(values: Any) -> list[dict[str, Any]]:
    """Validate a whole eras list; ids kept when given (8 hex, unique), new ones generated."""
    if not isinstance(values, list):
        raise Problem(422, "bad_era", "eras must be a list.")
    if len(values) > MAX_ERAS:
        raise Problem(422, "too_many_eras", f"A genre holds at most {MAX_ERAS} eras.")
    out: list[dict[str, Any]] = []
    taken: set[str] = set()
    for item in values:
        if not isinstance(item, dict):
            raise Problem(422, "bad_era", "Each era is {name, start?, end?, note?, sources?}.")
        given = item.get("id")
        if given is not None and (not isinstance(given, str) or len(given) != 8 or any(c not in "0123456789abcdef" for c in given)):
            raise Problem(422, "bad_era", "An era id is 8 hex characters.")
        if given in taken:
            raise Problem(422, "bad_era", "Era ids must be unique.")
        era: dict[str, Any] = {"id": given or "", "name": _era_text(item.get("name"), "name", MAX_NAME, required=True)}
        start = _year(item.get("start"), "start")
        end = _year(item.get("end"), "end")
        if start is not None and end is not None and end < start:
            raise Problem(422, "bad_era", "end must not be before start.")
        for key, value in (("start", start), ("end", end), ("note", _era_text(item.get("note"), "note", MAX_NOTE)), ("sources", refs.clean_sources(item.get("sources")) or None)):
            if value is not None:
                era[key] = value
        if given:
            taken.add(given)
        out.append(era)
    for era in out:
        if not era["id"]:
            while True:
                rid = secrets.token_hex(ID_BYTES)
                if rid not in taken:
                    break
            taken.add(rid)
            era["id"] = rid
    return out


def public(era: dict[str, Any]) -> dict[str, Any]:
    out = dict(era)
    out["sources"] = era.get("sources") or []
    out.setdefault("start", None)
    out.setdefault("end", None)
    out.setdefault("note", None)
    return out
