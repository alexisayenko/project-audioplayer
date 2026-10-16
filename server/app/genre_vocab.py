"""The canonical `genre:` vocabulary (TAG-077, TAG-078, ADR-0023): Discogs genres and styles plus the reviewed extras, loaded once from `server/data`."""

from __future__ import annotations

import difflib
import json
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
STYLES_FILE = DATA_DIR / "genre_styles.json"
EXTRAS_FILE = DATA_DIR / "genre_extras.json"
LEVELS_FILE = DATA_DIR / "genre_levels.json"
SUGGESTIONS = 5
MIN_CUTOFF = 0.6


def key(name: str) -> str:
    """Lowercase, accents folded, spaces and hyphens collapsed away."""
    folded = unicodedata.normalize("NFKD", name.casefold())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    return "".join(c for c in folded if c not in " -_\t")


def vkey(name: str) -> str:
    """`key` with "&" read as "and", so "rhythm & blues" and "rhythm and blues" are one genre."""
    return key(name.replace("&", " and "))


@dataclass(frozen=True)
class Entry:
    name: str
    family: str
    level: str
    parent: str | None
    extra: bool


@dataclass(frozen=True)
class Vocabulary:
    families: tuple[str, ...]
    entries: dict[str, Entry]
    by_key: dict[str, str]
    also_under: dict[str, tuple[str, ...]]


_lock = threading.Lock()
_vocab: Vocabulary | None = None
_payload: dict[str, Any] | None = None


def _read(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: not an object")
    return data


def build(styles_doc: dict[str, Any], extras_doc: dict[str, Any]) -> Vocabulary:
    """Entries by canonical name: the 15 genres (level "genre"), the Discogs styles and the extras (level "style", `extra` true for the extras)."""
    genres = tuple(g for g in styles_doc.get("genres") or [] if isinstance(g, str))
    entries: dict[str, Entry] = {g.lower(): Entry(g.lower(), g, "genre", None, False) for g in genres}
    for style, genre in (styles_doc.get("styles") or {}).items():
        if style not in entries and genre in genres:
            entries[style] = Entry(style, genre, "style", genre.lower(), False)
    for name, spec in (extras_doc.get("extras") or {}).items():
        if name not in entries and isinstance(spec, dict) and spec.get("family") in genres:
            entries[name] = Entry(name, spec["family"], "style", spec.get("parent"), True)
    by_key: dict[str, str] = {}
    for name in entries:
        by_key.setdefault(vkey(name), name)
    also = {s: tuple(g for g in gs if g in genres) for s, gs in (styles_doc.get("also_under") or {}).items() if isinstance(gs, list)}
    return Vocabulary(genres, entries, by_key, also)


def load() -> Vocabulary:
    global _vocab
    with _lock:
        if _vocab is None:
            try:
                _vocab = build(_read(STYLES_FILE), _read(EXTRAS_FILE))
            except (OSError, ValueError):
                _vocab = Vocabulary((), {}, {}, {})
        return _vocab


def check() -> int:
    """Load the vocabulary at start and refuse to run without it (every `genre:` write would be rejected); returns the number of names."""
    n = len(load().entries)
    if not n:
        raise RuntimeError("genre vocabulary missing or unreadable: server/data/genre_styles.json and genre_extras.json")
    try:
        load_levels()
    except ValueError as e:
        raise RuntimeError(f"genre levels invalid: {e}") from e
    return n


def reset() -> None:
    global _vocab, _payload
    with _lock:
        _vocab = None
        _payload = None


def lookup(value: str) -> str | None:
    """The canonical name for a spelling that is the name or differs from it only by case, spaces, hyphens or "&"/"and"; None when it is not in the vocabulary."""
    v = load()
    name = " ".join(value.lower().split())
    if name in v.entries:
        return name
    return v.by_key.get(vkey(value))


def is_canonical(value: str) -> bool:
    return value in load().entries


def entry(value: str) -> Entry | None:
    name = lookup(value)
    return load().entries.get(name) if name else None


def family_of(value: str) -> str | None:
    """The family (a Discogs genre) of a name, also in its "<name> music" form; None when unknown."""
    e = entry(value)
    if e is None and value.lower().rstrip().endswith(" music"):
        e = entry(value.rstrip()[: -len(" music")])
    return e.family if e else None


def is_style(value: str) -> bool:
    """True for a Discogs style or an extras entry (not for one of the 15 genre names)."""
    e = entry(value)
    return e is not None and e.level == "style"


def suggest(value: str, extra_names: dict[str, str] | None = None, limit: int = SUGGESTIONS) -> list[str]:
    """Up to `limit` canonical names close to `value`: prefix and substring matches first, then difflib ratios. `extra_names` maps aliases to their canonical name."""
    names = list(load().entries)
    wk = vkey(value)
    if not wk:
        return []
    pool: dict[str, str] = {n: n for n in names}
    for alias, target in (extra_names or {}).items():
        if target in pool:
            pool.setdefault(alias.lower(), target)
    scored: dict[str, float] = {}
    for label, target in pool.items():
        lk = vkey(label)
        if not lk:
            continue
        ratio = difflib.SequenceMatcher(None, wk, lk).ratio()
        if lk.startswith(wk) or (wk.startswith(lk) and len(lk) >= 4):
            score = 2.0 + ratio
        elif wk in lk:
            score = 1.5 + ratio
        elif ratio >= MIN_CUTOFF:
            score = ratio
        else:
            continue
        scored[target] = max(scored.get(target, 0.0), score)
    return [n for n, _ in sorted(scored.items(), key=lambda kv: (-kv[1], len(kv[0]), kv[0]))][:limit]


def _aliases(v: Vocabulary) -> dict[str, str]:
    """Loose spelling to canonical name (ALIASES and RETAGS whose target is in the vocabulary), so a picker can resolve what a user types."""
    from . import genre_filter

    out: dict[str, str] = {}
    for table in (genre_filter.ALIASES, genre_filter.RETAGS):
        for loose, target in table.items():
            name = target if target in v.entries else v.by_key.get(vkey(target))
            if loose != genre_filter.PROGRESSIVE and name:
                out[" ".join(loose.lower().split())] = name
    return dict(sorted(out.items()))


def _strings(value: Any, where: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(s, str) and s for s in value):
        raise ValueError(f"{LEVELS_FILE.name}: {where} must be a list of non-empty strings")
    return list(value)


FLAVOUR_KINDS = ("sound", "scene")


def parse_levels(doc: Any) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]], dict[str, dict[str, str]]]:
    """Validate the three-level genre data (GEN-051): returns (`levels` per style, `genre_synonyms` per genre, `flavours` block). Raises ValueError naming the file and the bad entry."""
    name = LEVELS_FILE.name
    if not isinstance(doc, dict) or not isinstance(doc.get("genres"), dict) or not doc["genres"]:
        raise ValueError(f"{name}: missing the 'genres' object")
    synonyms = {}
    for g, spec in doc["genres"].items():
        if not isinstance(spec, dict):
            raise ValueError(f"{name}: genre {g!r} is not an object")
        synonyms[g] = _strings(spec.get("synonyms", []), f"genre {g!r} synonyms")
    flavours: dict[str, dict[str, str]] = {}
    block = doc.get("flavours", {})
    if not isinstance(block, dict):
        raise ValueError(f"{name}: 'flavours' is not an object")
    for fk, spec in block.items():
        if not isinstance(spec, dict) or not isinstance(spec.get("name"), str) or not spec["name"] or spec.get("kind") not in FLAVOUR_KINDS:
            raise ValueError(f"{name}: flavour {fk!r} needs a name and a kind of {' or '.join(FLAVOUR_KINDS)}")
        desc = spec.get("description", "")
        if not isinstance(desc, str):
            raise ValueError(f"{name}: flavour {fk!r} description must be a string")
        flavours[fk] = {"name": spec["name"], "kind": spec["kind"], "description": desc}
    entries = {k: v for k, v in doc.items() if k not in ("_meta", "genres", "flavours")}
    levels: dict[str, dict[str, Any]] = {}
    for k, v in entries.items():
        if not isinstance(v, dict):
            raise ValueError(f"{name}: entry {k!r} is not an object")
        if v.get("genre") not in synonyms:
            raise ValueError(f"{name}: entry {k!r} has an unknown genre {v.get('genre')!r}")
        parent = v.get("parent")
        if parent is not None and (not isinstance(parent, str) or parent == k):
            raise ValueError(f"{name}: entry {k!r} has an invalid parent {parent!r}")
        if not isinstance(v.get("discogs"), bool):
            raise ValueError(f"{name}: entry {k!r} needs a boolean 'discogs'")
        status = v.get("status")
        if status not in (None, "approved", "question"):
            raise ValueError(f"{name}: entry {k!r} has an invalid status {status!r} (approved, question or absent)")
        display = v.get("display")
        if display is not None and (not isinstance(display, str) or not display.strip()):
            raise ValueError(f"{name}: entry {k!r} display must be a non-empty string")
        levels[k] = {
            "genre": v["genre"],
            "parent": parent,
            "also_under": _strings(v.get("also_under", []), f"entry {k!r} also_under"),
            "discogs": v["discogs"],
            "synonyms": _strings(v.get("synonyms", []), f"entry {k!r} synonyms"),
            "provisional": v.get("provisional") is True,
            "status": status,
            "display": display,
            "flavours": _strings(v.get("flavours", []), f"entry {k!r} flavours"),
            "also_in_genres": _strings(v.get("also_in_genres", []), f"entry {k!r} also_in_genres"),
        }
        bad_genres = [g for g in levels[k]["also_in_genres"] if g not in synonyms or g == v["genre"]]
        if bad_genres:
            raise ValueError(f"{name}: entry {k!r} also_in_genres {bad_genres!r} is not another genre")
        unknown = [f for f in levels[k]["flavours"] if f not in flavours]
        if unknown:
            raise ValueError(f"{name}: entry {k!r} has unknown flavours {unknown!r}")
    for k, v in levels.items():
        if v["display"] and v["display"].lower() != k and v["display"].lower() in levels:
            raise ValueError(f"{name}: entry {k!r} display {v['display']!r} collides with another entry")
        p = v["parent"]
        if p is not None and (p not in levels or levels[p]["parent"] is not None or (levels[p]["genre"] != v["genre"] and v["genre"] not in levels[p]["also_in_genres"])):
            raise ValueError(f"{name}: entry {k!r} parent {p!r} is not a level 2 entry of {v['genre']!r}")
        for a in v["also_under"]:
            if a not in levels or a == p or a == k:
                raise ValueError(f"{name}: entry {k!r} also_under {a!r} is not another entry")
    return levels, synonyms, flavours


def load_levels() -> tuple[dict[str, dict[str, Any]], dict[str, list[str]], dict[str, dict[str, str]]]:
    try:
        return parse_levels(_read(LEVELS_FILE))
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"{LEVELS_FILE.name}: unreadable ({e})") from e


def vocabulary() -> dict[str, Any]:
    """Payload of `GET /genres/vocabulary`: every canonical name with family, level and parent, plus `aliases`, the three-level `levels` per style and `genre_synonyms` per genre (GEN-051); built once. Raises ValueError when genre_levels.json is malformed."""
    global _payload
    v = load()
    with _lock:
        if _payload is None:
            rows = sorted(
                ({"name": e.name, "family": e.family, "level": e.level, "parent": e.parent, "extra": e.extra,
                  "also_under": list(v.also_under.get(e.name, ()))} for e in v.entries.values()),
                key=lambda r: r["name"],
            )
            levels, genre_synonyms, flavours = load_levels()
            _payload = {"families": list(v.families), "genres": rows, "count": len(rows), "aliases": _aliases(v), "levels": levels, "genre_synonyms": genre_synonyms, "flavours": flavours}
        return _payload
