"""Genres structure v2 (GEN-102): a separate, hand-curated top-level structure after Musicmap's method, served by `GET /genres/v2`. It never touches the v1 vocabulary (`genre_levels.json`); a genre's optional `v1` names the v1 vocabulary genre whose description, source links and reference tracks it shows."""

from __future__ import annotations

import json
import re
import threading
from typing import Any

from . import genre_sources, genre_vocab

FILE = genre_vocab.DATA_DIR / "genres_v2.json"
SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
HEX = re.compile(r"^#[0-9A-F]{6}$")
NAME_MAX = 60
TEXT_MAX = 600

_lock = threading.Lock()
_payload: dict[str, Any] | None = None


def _text(row: dict[str, Any], key: str, where: str, limit: int, required: bool = False) -> str | None:
    v = row.get(key)
    if v is None and not required:
        return None
    if not isinstance(v, str) or not v.strip() or len(v.strip()) > limit:
        raise ValueError(f"{where}: {key} must be a non-empty string of at most {limit} characters")
    return v.strip()


def _clusters(doc: dict[str, Any]) -> list[dict[str, Any]]:
    rows = doc.get("clusters", [])
    if not isinstance(rows, list):
        raise ValueError(f"{FILE.name}: clusters must be a list")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, row in enumerate(rows):
        where = f"{FILE.name}: cluster {i}"
        if not isinstance(row, dict):
            raise ValueError(f"{where}: not an object")
        cid = _text(row, "id", where, NAME_MAX, True)
        if not SLUG.match(cid):
            raise ValueError(f"{where}: id {cid!r} is not a slug")
        if cid in seen:
            raise ValueError(f"{where}: duplicate id {cid!r}")
        seen.add(cid)
        note = _text(row, "note", where, TEXT_MAX)
        colour = row.get("colour")
        if colour is not None and not (isinstance(colour, str) and HEX.match(colour)):
            raise ValueError(f"{where}: colour must be #RRGGBB in uppercase")
        out.append({"id": cid, "name": _text(row, "name", where, NAME_MAX, True), **({"colour": colour} if colour else {}), **({"note": note} if note else {})})
    return out


def _check_parents(rows: dict[str, dict[str, Any]]) -> None:
    for gid, row in rows.items():
        for p in row["parents"]:
            if p == gid:
                raise ValueError(f"{FILE.name}: genre {gid!r} is its own parent")
            if p not in rows:
                raise ValueError(f"{FILE.name}: genre {gid!r} has unknown parent {p!r}")
    state: dict[str, int] = {}

    def visit(gid: str) -> None:
        if state.get(gid) == 2:
            return
        if state.get(gid) == 1:
            raise ValueError(f"{FILE.name}: cycle through genre {gid!r}")
        state[gid] = 1
        for p in rows[gid]["parents"]:
            visit(p)
        state[gid] = 2

    for gid in rows:
        visit(gid)
    for gid, row in rows.items():
        if row["level"] != (1 if not row["parents"] else 1 + min(rows[p]["level"] for p in row["parents"])):
            raise ValueError(f"{FILE.name}: genre {gid!r} has level {row['level']} that does not match its parents")


def parse(doc: Any, v1_names: set[str]) -> dict[str, Any]:
    """Validate the document: unique slug ids, known clusters, `v1` names that exist in the v1 vocabulary, existing parents without cycles, level 1 exactly when there are no parents."""
    if not isinstance(doc, dict):
        raise ValueError(f"{FILE.name}: not a JSON object")
    if doc.get("version") != 2:
        raise ValueError(f"{FILE.name}: version must be 2")
    clusters = _clusters(doc)
    known = {c["id"] for c in clusters}
    raw = doc.get("genres", [])
    if not isinstance(raw, list):
        raise ValueError(f"{FILE.name}: genres must be a list")
    rows: dict[str, dict[str, Any]] = {}
    for i, row in enumerate(raw):
        where = f"{FILE.name}: genre {i}"
        if not isinstance(row, dict):
            raise ValueError(f"{where}: not an object")
        gid = _text(row, "id", where, NAME_MAX, True)
        if not SLUG.match(gid):
            raise ValueError(f"{where}: id {gid!r} is not a slug")
        if gid in rows:
            raise ValueError(f"{where}: duplicate id {gid!r}")
        cluster = row.get("cluster")
        if cluster not in known:
            raise ValueError(f"{where}: unknown cluster {cluster!r}")
        parents = row.get("parents", [])
        if not isinstance(parents, list) or not all(isinstance(p, str) for p in parents) or len(set(parents)) != len(parents):
            raise ValueError(f"{where}: parents must be a list of unique ids")
        level = row.get("level")
        if isinstance(level, bool) or not isinstance(level, int) or level < 1:
            raise ValueError(f"{where}: level must be a whole number from 1")
        v1 = _text(row, "v1", where, NAME_MAX)
        if v1 is not None and v1 not in v1_names:
            raise ValueError(f"{where}: v1 name {v1!r} is not in the v1 vocabulary")
        syn = row.get("synonyms", [])
        if not isinstance(syn, list) or not all(isinstance(x, str) and x.strip() and len(x.strip()) <= NAME_MAX for x in syn):
            raise ValueError(f"{where}: synonyms must be a list of non-empty strings")
        url = _text(row, "musicmap_url", where, 300)
        if url is not None and not url.startswith("https://"):
            raise ValueError(f"{where}: musicmap_url must be an https URL")
        rows[gid] = {"id": gid, "name": _text(row, "name", where, NAME_MAX, True), "level": level, "cluster": cluster, "parents": list(parents), "v1": v1, "description": _text(row, "description", where, TEXT_MAX), "synonyms": [x.strip() for x in syn], "details": _text(row, "details", where, TEXT_MAX), "musicmap_url": url}
    _check_parents(rows)
    return {"version": 2, "clusters": clusters, "genres": list(rows.values())}


def _read() -> dict[str, Any]:
    try:
        with open(FILE, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"version": 2, "clusters": [], "genres": []}
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"{FILE.name}: unreadable ({e})") from e


def _enrich(g: dict[str, Any], v: genre_vocab.Vocabulary, descriptions: dict[str, str]) -> dict[str, Any]:
    v1 = g["v1"]
    entry = v.entries.get(v1) if v1 else None
    links = genre_sources.payload_fields(v1, entry.level == "family" and not entry.form)["source_links"] if entry else []
    return {**g, "description": g["description"] or (descriptions.get(v1) if v1 else None), "source_links": links}


def payload() -> dict[str, Any]:
    """Payload of `GET /genres/v2`: `{version, clusters, genres}`; each genre also carries `description` (own text, else the v1 description of its `v1` genre, else null) and the `source_links` of its `v1` genre. Built once; a missing file is an empty structure; a malformed one raises ValueError."""
    global _payload
    with _lock:
        if _payload is None:
            v = genre_vocab.load()
            doc = parse(_read(), set(v.entries))
            descriptions = genre_vocab.load_descriptions()
            _payload = {**doc, "genres": [_enrich(g, v, descriptions) for g in doc["genres"]]}
        return _payload


def reset() -> None:
    global _payload
    with _lock:
        _payload = None
