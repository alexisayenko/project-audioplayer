"""The canonical `genre:` vocabulary (TAG-077, TAG-078, ADR-0023, ADR-0030): the families (level 1), the Discogs genres and the reviewed extras, loaded once from `server/data`.

Every name below the families has `parents`: an unordered set (kept as a list) of family names and genre names; all parents are equal, there is no primary parent (ADR-0037). The families of a genre are all the level 1 ancestors it descends from; its level is the shortest path depth to a family root (family 1, a genre under a family 2; no depth cap). A genre may also carry `related` (associations and influences; no effect on the tree, levels, families or counts)."""

from __future__ import annotations

import difflib
import json
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import genre_sources

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
    families: tuple[str, ...] = ()


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


def _resolve_families(name: str, parents: dict[str, tuple[str, ...]], families: tuple[str, ...]) -> tuple[str, ...]:
    """Every family a genre descends from through any parent, in the fixed family order; empty on a missing parent or a cycle."""
    found: set[str] = set()
    seen: set[str] = set()
    stack = [name]
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        for p in parents.get(cur, ()):
            if p in families:
                found.add(p)
            else:
                stack.append(p)
    return tuple(f for f in families if f in found)


def build(discogs_doc: dict[str, Any], extras_doc: dict[str, Any], tree_families: dict[str, list[str]] | None = None, tree_parents: dict[str, list[str]] | None = None) -> Vocabulary:
    """Entries by canonical name: the families (level "family"), the Discogs genres and the extras (level "genre", `extra` true for the extras). `families` of a genre are every family it descends from (the tree's `families` when `tree_families` has the name, else the Discogs families or the descent through the extras' parents); `family` is the first of them in the fixed family order, kept for old clients only. `parents` are the full unordered parent set of the tree (`tree_parents` when it has the name, else the Discogs/extras parents)."""
    families = tuple(g for g in discogs_doc.get("families") or [] if isinstance(g, str))
    entries: dict[str, Entry] = {g.lower(): Entry(g.lower(), g, "family", (), False, (g,)) for g in families}
    parents: dict[str, tuple[str, ...]] = {}
    own: dict[str, tuple[str, ...]] = {}
    for name, plist in (discogs_doc.get("genres") or {}).items():
        ps = _parent_list(plist)
        if name not in entries and any(p in families for p in ps):
            parents[name] = tuple(p for p in ps if p in families)
            own[name] = tuple(f for f in families if f in parents[name])
    extras = {n: s for n, s in (extras_doc.get("extras") or {}).items() if n not in entries and isinstance(s, dict) and _parent_list(s.get("parents"))}
    for n, spec in extras.items():
        parents[n] = _parent_list(spec["parents"])
    for n in extras:
        own[n] = _resolve_families(n, parents, families)
    for n, fams in own.items():
        fams = tuple((tree_families or {}).get(n) or fams)
        if fams:
            entries[n] = Entry(n, fams[0], "genre", tuple((tree_parents or {}).get(n) or parents[n]), n in extras, fams)
    by_key: dict[str, str] = {}
    for name in entries:
        by_key.setdefault(vkey(name), name)
    return Vocabulary(families, entries, by_key)


def load() -> Vocabulary:
    global _vocab
    with _lock:
        if _vocab is None:
            try:
                try:
                    tree = load_levels()[0]
                    tree_families = {k: v["families"] for k, v in tree.items()}
                    tree_parents = {k: v["parents"] for k, v in tree.items()}
                except ValueError:
                    tree_families = tree_parents = None
                _vocab = build(_read(DISCOGS_FILE), _read(EXTRAS_FILE), tree_families, tree_parents)
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
    genre_sources.reset()


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


def _entry_or_music(value: str) -> Entry | None:
    e = entry(value)
    if e is None and value.lower().rstrip().endswith(" music"):
        e = entry(value.rstrip()[: -len(" music")])
    return e


def families_of(value: str) -> tuple[str, ...]:
    """Every family a name belongs to (all its level 1 ancestors, in the fixed family order), also in its "<name> music" form; empty when unknown."""
    e = _entry_or_music(value)
    return e.families if e else ()


def family_of(value: str) -> str | None:
    """The first of `families_of` (the old single family, kept for old clients); None when unknown."""
    e = _entry_or_music(value)
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


def _parse_entry(k: str, v: Any, name: str, families: dict[str, list[str]], flavours: dict[str, dict[str, str]], subfamilies: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise ValueError(f"{name}: entry {k!r} is not an object")
    parents = _strings(v.get("parents"), f"entry {k!r} parents")
    if not parents or len(set(parents)) != len(parents) or k in parents:
        raise ValueError(f"{name}: entry {k!r} parents {parents!r} must be a non-empty list of unique names other than the entry")
    if "family" in v:
        raise ValueError(f"{name}: entry {k!r} has a 'family' override; families are derived from all parents")
    if not isinstance(v.get("discogs"), bool):
        raise ValueError(f"{name}: entry {k!r} needs a boolean 'discogs'")
    status = v.get("status")
    if status not in (None, "approved", "question"):
        raise ValueError(f"{name}: entry {k!r} has an invalid status {status!r} (approved, question or absent)")
    fusion = v.get("fusion")
    if fusion is not None and not isinstance(fusion, bool):
        raise ValueError(f"{name}: entry {k!r} fusion must be a boolean")
    display = v.get("display")
    if display is not None and (not isinstance(display, str) or not display.strip()):
        raise ValueError(f"{name}: entry {k!r} display must be a non-empty string")
    subfamily = v.get("subfamily")
    if subfamily is not None and subfamily not in subfamilies:
        raise ValueError(f"{name}: entry {k!r} has an unknown subfamily {subfamily!r}")
    entry = {
        "parents": parents,
        "discogs": v["discogs"],
        "synonyms": _strings(v.get("synonyms", []), f"entry {k!r} synonyms"),
        "provisional": v.get("provisional") is True,
        "status": status,
        "display": display,
        "flavours": _strings(v.get("flavours", []), f"entry {k!r} flavours"),
    }
    if fusion:
        entry["fusion"] = True
    if subfamily is not None:
        entry["subfamily"] = subfamily
    if "related" in v:
        related = _strings(v["related"], f"entry {k!r} related")
        if len(set(related)) != len(related) or k in related or any(r in parents for r in related):
            raise ValueError(f"{name}: entry {k!r} related {related!r} must be unique names other than the entry and its parents")
        if related:
            entry["related"] = related
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


def parse_subfamilies(doc: Any) -> dict[str, dict[str, Any]]:
    """The declared subfamilies of `genre_levels.json` (`subfamilies`: name to `{family, order}`; optional, empty when absent), sorted by order."""
    name = LEVELS_FILE.name
    block = doc.get("subfamilies", {}) if isinstance(doc, dict) else {}
    if not isinstance(block, dict):
        raise ValueError(f"{name}: 'subfamilies' is not an object")
    out: dict[str, dict[str, Any]] = {}
    for sk, spec in block.items():
        if not isinstance(spec, dict) or not isinstance(spec.get("family"), str) or not isinstance(spec.get("order"), int) or isinstance(spec.get("order"), bool):
            raise ValueError(f"{name}: subfamily {sk!r} needs a family and an integer order")
        out[sk] = {"name": sk, "family": spec["family"], "order": spec["order"]}
    return dict(sorted(out.items(), key=lambda kv: (kv[1]["order"], kv[0])))


def _resolve_subfamilies(levels: dict[str, dict[str, Any]], families: dict[str, list[str]], subfamilies: dict[str, dict[str, Any]], name: str) -> None:
    """A genre's `subfamily`: its own (the declared family of that subfamily must be one of the genre's families), else the first one a parent has (in `parents` order, only used to break a tie) whose declared family is one of the genre's families; absent when none. Runs after `_resolve`."""
    for sk, sp in subfamilies.items():
        if sp["family"] not in families:
            raise ValueError(f"{name}: subfamily {sk!r} has an unknown family {sp['family']!r}")
    for k, v in levels.items():
        own = v.get("subfamily")
        if own is not None and subfamilies[own]["family"] not in v["families"]:
            raise ValueError(f"{name}: entry {k!r} subfamily {own!r} belongs to {subfamilies[own]['family']!r}, which is not one of the families of the entry")
    done: set[str] = set()

    def fill(k: str) -> str | None:
        v = levels[k]
        if k not in done:
            done.add(k)
            if v.get("subfamily") is None:
                for p in v["parents"]:
                    got = fill(p) if p in levels else None
                    if got is not None and subfamilies[got]["family"] in v["families"]:
                        v["subfamily"] = got
                        break
        return v.get("subfamily")

    for k in levels:
        fill(k)


def _check_related(levels: dict[str, dict[str, Any]], families: dict[str, list[str]], name: str) -> None:
    """Every `related` name is a family or an entry and not a descendant of the entry (related is no tree edge, so it never creates a cycle)."""
    children: dict[str, list[str]] = {}
    for k, v in levels.items():
        for p in v["parents"]:
            children.setdefault(p, []).append(k)
    for k, v in levels.items():
        if not v.get("related"):
            continue
        for r in v["related"]:
            if r not in families and r not in levels:
                raise ValueError(f"{name}: entry {k!r} related {r!r} is not a family or an entry")
        seen: set[str] = set()
        stack = [k]
        while stack:
            for c in children.get(stack.pop(), []):
                if c not in seen:
                    seen.add(c)
                    stack.append(c)
        bad = [r for r in v["related"] if r in seen]
        if bad:
            raise ValueError(f"{name}: entry {k!r} related {bad!r} is a descendant of the entry")


MAX_LEVEL = 12


def _resolve(levels: dict[str, dict[str, Any]], families: dict[str, list[str]], name: str) -> None:
    """Fill `level` (the shortest path depth to a family root: 2 under a family, else 1 + the smallest level among the parents; no depth cap, only the sanity bound `MAX_LEVEL`) and `families` (every family the genre descends from, in the fixed family order); `family` is the first of them, kept for old clients. A `fusion` genre needs at least two families."""
    done: set[str] = set()
    order = list(families)

    def fill(k: str) -> None:
        if k in done:
            return
        v = levels[k]
        level = 99
        found: set[str] = set()
        for p in v["parents"]:
            if p in families:
                level, found = min(level, 2), found | {p}
            else:
                fill(p)
                level, found = min(level, 1 + levels[p]["level"]), found | set(levels[p]["families"])
        if level > MAX_LEVEL:
            raise ValueError(f"{name}: entry {k!r} would be level {level} (sanity bound {MAX_LEVEL} levels)")
        v["level"] = level
        v["families"] = [f for f in order if f in found]
        v["family"] = v["families"][0]
        if v.get("fusion") and len(v["families"]) < 2:
            raise ValueError(f"{name}: entry {k!r} has 'fusion' but fewer than two families")
        done.add(k)

    for k in levels:
        fill(k)


def parse_levels(doc: Any) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]], dict[str, dict[str, str]]]:
    """Validate the genre tree data (GEN-051): returns (`levels` per genre, `family_synonyms` per family, `flavours` block). Raises ValueError naming the file and the bad entry."""
    name = LEVELS_FILE.name
    synonyms = _parse_synonyms(doc, name)
    flavours = _parse_flavours(doc, name)
    entries = {k: v for k, v in doc.items() if k not in ("_meta", "families", "flavours", "subfamilies")}
    subfamilies = parse_subfamilies(doc)
    levels = {k: _parse_entry(k, v, name, synonyms, flavours, subfamilies) for k, v in entries.items()}
    for k, v in levels.items():
        if v["display"] and v["display"].lower() != k and v["display"].lower() in levels:
            raise ValueError(f"{name}: entry {k!r} display {v['display']!r} collides with another entry")
    _check_parents(levels, synonyms, name)
    _check_related(levels, synonyms, name)
    _resolve(levels, synonyms, name)
    _resolve_subfamilies(levels, synonyms, subfamilies, name)
    return levels, synonyms, flavours


def load_levels() -> tuple[dict[str, dict[str, Any]], dict[str, list[str]], dict[str, dict[str, str]]]:
    try:
        return parse_levels(_read(LEVELS_FILE))
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"{LEVELS_FILE.name}: unreadable ({e})") from e


def vocabulary() -> dict[str, Any]:
    """Payload of `GET /genres/vocabulary`: every canonical name with family (the first of `families`), `families`, level and parents, plus `aliases`, the `levels` per genre (any depth) and `family_synonyms` per family (GEN-051); built once. Raises ValueError when genre_levels.json is malformed."""
    global _payload
    v = load()
    with _lock:
        if _payload is None:
            rows = sorted(
                ({"name": e.name, "family": e.family, "families": list(e.families), "level": e.level, "parents": list(e.parents), "extra": e.extra, **genre_sources.payload_fields(e.name, e.level == "family")} for e in v.entries.values()),
                key=lambda r: r["name"],
            )
            levels, family_synonyms, flavours = load_levels()
            subfamilies = list(parse_subfamilies(_read(LEVELS_FILE)).values())
            _payload = {"families": list(v.families), "genres": rows, "count": len(rows), "aliases": _aliases(v), "levels": levels, "family_synonyms": family_synonyms, "flavours": flavours, "subfamilies": subfamilies}
        return _payload
