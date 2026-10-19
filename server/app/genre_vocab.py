"""The canonical `genre:` vocabulary (TAG-077, TAG-078, ADR-0023, ADR-0030): the families (level 1), the Discogs genres and the reviewed extras, loaded once from `server/data`.

Every name below the families has `parents`: a list of family names and genre names; `parents[0]` is the primary parent and decides the level and the family."""

from __future__ import annotations

import difflib
import json
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DISCOGS_FILE = DATA_DIR / "genre_discogs.json"
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
    parents: tuple[str, ...]
    extra: bool


@dataclass(frozen=True)
class Vocabulary:
    families: tuple[str, ...]
    entries: dict[str, Entry]
    by_key: dict[str, str]


_lock = threading.Lock()
_vocab: Vocabulary | None = None
_payload: dict[str, Any] | None = None


def _read(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: not an object")
    return data


def _parent_list(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(dict.fromkeys(p for p in value if isinstance(p, str) and p))


def _resolve_family(name: str, parents: dict[str, tuple[str, ...]], families: tuple[str, ...]) -> str | None:
    """The family of a genre: the first parent when it is a family, else the family of that parent; None on a missing parent or a cycle."""
    seen: set[str] = set()
    cur = name
    while cur not in seen:
        seen.add(cur)
        first = (parents.get(cur) or (None,))[0]
        if first is None:
            return None
        if first in families:
            return first
        cur = first
    return None


def build(discogs_doc: dict[str, Any], extras_doc: dict[str, Any]) -> Vocabulary:
    """Entries by canonical name: the families (level "family"), the Discogs genres and the extras (level "genre", `extra` true for the extras). An extra may carry `family` to override the family derived from `parents[0]`."""
    families = tuple(g for g in discogs_doc.get("families") or [] if isinstance(g, str))
    entries: dict[str, Entry] = {g.lower(): Entry(g.lower(), g, "family", (), False) for g in families}
    parents: dict[str, tuple[str, ...]] = {}
    for name, plist in (discogs_doc.get("genres") or {}).items():
        ps = _parent_list(plist)
        if name not in entries and ps and ps[0] in families:
            parents[name] = tuple(p for p in ps if p in families)
            entries[name] = Entry(name, ps[0], "genre", parents[name], False)
    extras = {n: s for n, s in (extras_doc.get("extras") or {}).items() if n not in entries and isinstance(s, dict) and _parent_list(s.get("parents"))}
    for n, spec in extras.items():
        parents[n] = _parent_list(spec["parents"])
    for n, spec in extras.items():
        family = spec.get("family") or _resolve_family(n, parents, families)
        if family in families:
            entries[n] = Entry(n, family, "genre", parents[n], True)
    by_key: dict[str, str] = {}
    for name in entries:
        by_key.setdefault(vkey(name), name)
    return Vocabulary(families, entries, by_key)


def load() -> Vocabulary:
    global _vocab
    with _lock:
        if _vocab is None:
            try:
                _vocab = build(_read(DISCOGS_FILE), _read(EXTRAS_FILE))
            except (OSError, ValueError):
                _vocab = Vocabulary((), {}, {})
        return _vocab


def check() -> int:
    """Load the vocabulary at start and refuse to run without it (every `genre:` write would be rejected); returns the number of names."""
    n = len(load().entries)
    if not n:
        raise RuntimeError("genre vocabulary missing or unreadable: server/data/genre_discogs.json and genre_extras.json")
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


def is_below_family(value: str) -> bool:
    """True for a Discogs genre or an extras entry (not for a family name)."""
    e = entry(value)
    return e is not None and e.level == "genre"


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


def _parse_synonyms(doc: Any, name: str) -> dict[str, list[str]]:
    if not isinstance(doc, dict) or not isinstance(doc.get("families"), dict) or not doc["families"]:
        raise ValueError(f"{name}: missing the 'families' object")
    synonyms = {}
    for g, spec in doc["families"].items():
        if not isinstance(spec, dict):
            raise ValueError(f"{name}: family {g!r} is not an object")
        synonyms[g] = _strings(spec.get("synonyms", []), f"family {g!r} synonyms")
    return synonyms


def _parse_flavours(doc: dict[str, Any], name: str) -> dict[str, dict[str, str]]:
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
    return flavours


def _parse_entry(k: str, v: Any, name: str, families: dict[str, list[str]], flavours: dict[str, dict[str, str]]) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise ValueError(f"{name}: entry {k!r} is not an object")
    parents = _strings(v.get("parents"), f"entry {k!r} parents")
    if not parents or len(set(parents)) != len(parents) or k in parents:
        raise ValueError(f"{name}: entry {k!r} parents {parents!r} must be a non-empty list of unique names other than the entry")
    family = v.get("family")
    if family is not None and family not in families:
        raise ValueError(f"{name}: entry {k!r} has an unknown family {family!r}")
    if not isinstance(v.get("discogs"), bool):
        raise ValueError(f"{name}: entry {k!r} needs a boolean 'discogs'")
    status = v.get("status")
    if status not in (None, "approved", "question"):
        raise ValueError(f"{name}: entry {k!r} has an invalid status {status!r} (approved, question or absent)")
    display = v.get("display")
    if display is not None and (not isinstance(display, str) or not display.strip()):
        raise ValueError(f"{name}: entry {k!r} display must be a non-empty string")
    entry = {
        "family": family,
        "parents": parents,
        "discogs": v["discogs"],
        "synonyms": _strings(v.get("synonyms", []), f"entry {k!r} synonyms"),
        "provisional": v.get("provisional") is True,
        "status": status,
        "display": display,
        "flavours": _strings(v.get("flavours", []), f"entry {k!r} flavours"),
    }
    unknown = [f for f in entry["flavours"] if f not in flavours]
    if unknown:
        raise ValueError(f"{name}: entry {k!r} has unknown flavours {unknown!r}")
    return entry


def _check_parents(levels: dict[str, dict[str, Any]], families: dict[str, list[str]], name: str) -> None:
    """Every parent is a family or an entry; no cycle through any parent edge (so no extra parent is a descendant)."""
    for k, v in levels.items():
        for p in v["parents"]:
            if p not in families and p not in levels:
                raise ValueError(f"{name}: entry {k!r} parent {p!r} is not a family or an entry")
    state: dict[str, int] = {}

    def visit(k: str) -> None:
        if state.get(k) == 2:
            return
        if state.get(k) == 1:
            raise ValueError(f"{name}: entry {k!r} is its own ancestor through its parents")
        state[k] = 1
        for p in levels[k]["parents"]:
            if p in levels:
                visit(p)
        state[k] = 2

    for k in levels:
        visit(k)


def _resolve(levels: dict[str, dict[str, Any]], families: dict[str, list[str]], name: str) -> None:
    """Fill `level` (2 when `parents[0]` is a family, else 1 + the level of that parent; at most 3) and `family` (default: the family of `parents[0]`; an explicit one must be one of that parent's families)."""
    done: set[str] = set()

    def fill(k: str) -> None:
        if k in done:
            return
        v = levels[k]
        first = v["parents"][0]
        if first in families:
            v["level"], choices = 2, [first]
        else:
            fill(first)
            parent = levels[first]
            v["level"] = 1 + parent["level"]
            choices = [parent["family"], *[p for p in parent["parents"][1:] if p in families]]
        if v["level"] > 3:
            raise ValueError(f"{name}: entry {k!r} would be level {v['level']} (hard cap three levels)")
        if v["family"] is None:
            v["family"] = choices[0]
        elif v["family"] not in choices:
            raise ValueError(f"{name}: entry {k!r} family {v['family']!r} is not reachable through parent {first!r}")
        done.add(k)

    for k in levels:
        fill(k)


def parse_levels(doc: Any) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]], dict[str, dict[str, str]]]:
    """Validate the three-level genre data (GEN-051): returns (`levels` per genre, `family_synonyms` per family, `flavours` block). Raises ValueError naming the file and the bad entry."""
    name = LEVELS_FILE.name
    synonyms = _parse_synonyms(doc, name)
    flavours = _parse_flavours(doc, name)
    entries = {k: v for k, v in doc.items() if k not in ("_meta", "families", "flavours")}
    levels = {k: _parse_entry(k, v, name, synonyms, flavours) for k, v in entries.items()}
    for k, v in levels.items():
        if v["display"] and v["display"].lower() != k and v["display"].lower() in levels:
            raise ValueError(f"{name}: entry {k!r} display {v['display']!r} collides with another entry")
    _check_parents(levels, synonyms, name)
    _resolve(levels, synonyms, name)
    return levels, synonyms, flavours


def load_levels() -> tuple[dict[str, dict[str, Any]], dict[str, list[str]], dict[str, dict[str, str]]]:
    try:
        return parse_levels(_read(LEVELS_FILE))
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"{LEVELS_FILE.name}: unreadable ({e})") from e


def vocabulary() -> dict[str, Any]:
    """Payload of `GET /genres/vocabulary`: every canonical name with family, level and parents, plus `aliases`, the three-level `levels` per genre and `family_synonyms` per family (GEN-051); built once. Raises ValueError when genre_levels.json is malformed."""
    global _payload
    v = load()
    with _lock:
        if _payload is None:
            rows = sorted(
                ({"name": e.name, "family": e.family, "level": e.level, "parents": list(e.parents), "extra": e.extra} for e in v.entries.values()),
                key=lambda r: r["name"],
            )
            levels, family_synonyms, flavours = load_levels()
            _payload = {"families": list(v.families), "genres": rows, "count": len(rows), "aliases": _aliases(v), "levels": levels, "family_synonyms": family_synonyms, "flavours": flavours}
        return _payload
