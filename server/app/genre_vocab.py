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


def vocabulary() -> dict[str, Any]:
    """Payload of `GET /genres/vocabulary`: every canonical name with family, level and parent; built once."""
    global _payload
    v = load()
    with _lock:
        if _payload is None:
            rows = sorted(
                ({"name": e.name, "family": e.family, "level": e.level, "parent": e.parent, "extra": e.extra,
                  "also_under": list(v.also_under.get(e.name, ()))} for e in v.entries.values()),
                key=lambda r: r["name"],
            )
            _payload = {"families": list(v.families), "genres": rows, "count": len(rows)}
        return _payload
