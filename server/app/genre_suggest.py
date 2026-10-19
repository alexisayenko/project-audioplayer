"""The genre suggestion rule (TAG-099 to TAG-108, decision EH1, variant B): which of the genres the lookups found are APPLIED to a song and which are only SUGGESTED.

The input is, per independent source group, the genres that group named. A genre is applied when two independent groups agree on it (a child counts for every ancestor above it, through all its parents), or when the Wikipedia song page alone names it, it is not an ambiguous name and it shares a family (any of its families) with a genre applied by agreement. Everything else is a suggestion with its source badges; nothing is applied by a single source."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any

from . import genre_filter, genre_vocab

MUSICBRAINZ = "musicbrainz"
WIKIPEDIA_SONG = "wikipedia_song"
WIKIPEDIA_ARTIST = "wikipedia_artist"
DISCOGS = "discogs"
YOUTUBE = "youtube"
GROUPS = (MUSICBRAINZ, WIKIPEDIA_SONG, WIKIPEDIA_ARTIST, DISCOGS, YOUTUBE)

ORIGINAL = "original"
REMIXER = "remixer"

APPLY_WEIGHT = 2.0
DISCOGS_SEARCH_WEIGHT = 0.5
MAX_APPLIED = 5
MAX_SUGGESTED = 12

AMBIGUOUS: frozenset[str] = frozenset({"freestyle", "hardcore", "soul", "garage"})
YOUTUBE_IGNORED: frozenset[str] = frozenset({"acoustic", "instrumental", "live", "remix"})

SINGLE_SOURCE = "single_source"
INSUFFICIENT = "insufficient_agreement"
AMBIGUOUS_NAME = "ambiguous_name"
NO_FAMILY = "no_shared_family"
OVER_CAP = "over_cap"
FROM_ORIGINAL = "original"
FROM_REMIXER = "remixer"


@dataclass(frozen=True)
class Tree:
    parents: dict[str, tuple[str, ...]]
    family: dict[str, frozenset[str]]
    depth: dict[str, int]
    families: frozenset[str]


_lock = threading.Lock()
_cache: tuple[Any, Tree] | None = None


def _build_tree() -> Tree:
    vocab = genre_vocab.load()
    families = frozenset(f.lower() for f in vocab.families)
    parents: dict[str, tuple[str, ...]] = {}
    family: dict[str, frozenset[str]] = {}
    depth: dict[str, int] = {}
    try:
        levels = genre_vocab.load_levels()[0]
    except ValueError:
        levels = {}
    for name, e in vocab.entries.items():
        if name in families:
            family[name] = frozenset({name})
            depth[name] = 1
            continue
        lv = levels.get(name)
        ps = (lv or {}).get("parents") or e.parents
        if ps:
            parents[name] = tuple(str(p).lower() for p in ps)
        family[name] = frozenset(str(f).lower() for f in ((lv or {}).get("families") or e.families))
        if lv:
            depth[name] = int(lv["level"])
    return Tree(parents, family, depth, families)


def get_tree() -> Tree:
    """Every parent of each vocabulary name, all its families and its level (the tree of `genre_levels.json`, else the Discogs/extras parents); rebuilt when the vocabulary is reloaded. All parents are equal."""
    global _cache
    vocab = genre_vocab.load()
    with _lock:
        if _cache is None or _cache[0] is not vocab:
            _cache = (vocab, _build_tree())
        return _cache[1]


def ancestors(name: str, tree: Tree | None = None) -> list[str]:
    """Every name above `name` through all its parents (nearest first, breadth first; families included)."""
    tree = tree or get_tree()
    out: list[str] = []
    seen = {name}
    frontier = [name]
    while frontier:
        nxt: list[str] = []
        for cur in frontier:
            for p in tree.parents.get(cur, ()):
                if p not in seen:
                    seen.add(p)
                    out.append(p)
                    nxt.append(p)
        frontier = nxt
    return out


def _depth(name: str, tree: Tree) -> int:
    """The shortest path depth to a family root (family 1, a genre under a family 2)."""
    return tree.depth.get(name) or 1 + len(ancestors(name, tree))


def _normalise(values: list[str]) -> list[str]:
    """Vocabulary names (aliases, synonyms and spelling folded by `genre_filter`), in order and unique; non-genre tags are dropped."""
    tags = [v if ":" in str(v) else f"genre:{v}" for v in values or []]
    names = [t.partition(":")[2] for t in genre_filter.filter_tags([t for t in tags if str(t).partition(":")[0].strip().casefold() == "genre"])]
    return list(dict.fromkeys(names))


@dataclass
class Decision:
    applied: list[str] = field(default_factory=list)
    suggestions: list[dict[str, Any]] = field(default_factory=list)
    sources: dict[str, list[str]] = field(default_factory=dict)


def _order(sources: list[str]) -> list[str]:
    return sorted(set(sources), key=lambda s: GROUPS.index(s) if s in GROUPS else len(GROUPS))


def decide(groups: dict[str, list[str]], *, weights: dict[str, float] | None = None, versioned: bool = False, origin: dict[str, str] | None = None) -> Decision:
    """Apply the rule to the genres each source group named.

    `groups` maps a group (`GROUPS`) to the genres it listed (`genre:x` or bare names). `weights` overrides a group's weight (default 1; a Discogs search hit is `DISCOGS_SEARCH_WEIGHT`). With `versioned` only the `youtube` group (the version's own link) is applied; every other found genre is a suggestion marked `original` (or the label `origin` gives for its group, for example `remixer`)."""
    tree = get_tree()
    weight = {g: 1.0 for g in GROUPS}
    weight.update(weights or {})
    listed: dict[str, list[str]] = {}
    for g, values in groups.items():
        names = _normalise(values)
        if g == YOUTUBE:
            names = [n for n in names if n not in YOUTUBE_IGNORED]
        listed[g] = names
    direct: dict[str, set[str]] = {}
    support: dict[str, float] = {}
    for g, names in listed.items():
        reach: set[str] = set()
        for n in names:
            direct.setdefault(n, set()).add(g)
            reach.add(n)
            reach.update(ancestors(n, tree))
        for n in reach:
            support[n] = support.get(n, 0.0) + weight.get(g, 1.0)
    if versioned:
        return _versioned(listed, direct, support, tree, origin or {})
    consensus = [n for n in direct if support[n] >= APPLY_WEIGHT]
    consensus_families = set().union(*(tree.family.get(n, frozenset()) for n in consensus)) if consensus else set()
    eligible = list(consensus)
    declined: dict[str, str] = {}
    for n in direct:
        if n in consensus:
            continue
        if WIKIPEDIA_SONG in direct[n]:
            if n in AMBIGUOUS:
                declined[n] = AMBIGUOUS_NAME
            elif tree.family.get(n, frozenset()) & consensus_families:
                eligible.append(n)
            else:
                declined[n] = NO_FAMILY
    return _finish(eligible, direct, support, tree, declined)


def _versioned(listed: dict[str, list[str]], direct: dict[str, set[str]], support: dict[str, float], tree: Tree, origin: dict[str, str]) -> Decision:
    own = [n for n in listed.get(YOUTUBE, []) if n in direct]
    out = _finish(own, direct, support, tree, {}, suggest=False)
    applied = set(out.applied)
    suggestions: list[dict[str, Any]] = []
    for n in sorted((n for n in direct if n not in applied), key=lambda n: _suggest_key(n, direct, support)):
        lookup = [g for g in direct[n] if g != YOUTUBE]
        if not lookup and n in listed.get(YOUTUBE, []):
            continue
        labels = list(dict.fromkeys(origin.get(g, ORIGINAL) for g in _order(lookup))) or [ORIGINAL]
        sources = [*labels, *_order(lookup)]
        suggestions.append({"genre": n, "sources": sources, "reason": FROM_REMIXER if labels[0] == REMIXER else FROM_ORIGINAL})
    out.suggestions = _drop_ancestors(suggestions, applied, tree)[:MAX_SUGGESTED]
    return out


def _suggest_key(n: str, direct: dict[str, set[str]], support: dict[str, float]) -> tuple[Any, ...]:
    first = min((GROUPS.index(g) for g in direct[n] if g in GROUPS), default=len(GROUPS))
    return (-support.get(n, 0.0), -len(direct[n]), first, n)


def _drop_ancestors(suggestions: list[dict[str, Any]], applied: set[str], tree: Tree) -> list[dict[str, Any]]:
    """A non-family genre that is an ancestor of an applied genre is redundant beside it and is not suggested."""
    above = {a for n in applied for a in ancestors(n, tree) if a not in tree.families}
    return [s for s in suggestions if s["genre"] not in above]


def _select(eligible: list[str], direct: dict[str, set[str]], support: dict[str, float], tree: Tree) -> tuple[list[str], list[str], set[str]]:
    """(applied, over the cap, pruned ancestors): deepest first, then most support, then most sources; a non-family ancestor of an applied genre is pruned, families stay."""
    ranked = sorted(eligible, key=lambda n: (-_depth(n, tree), -support.get(n, 0.0), -len(direct[n]), WIKIPEDIA_SONG not in direct[n], n))
    applied: list[str] = []
    over: list[str] = []
    pruned: set[str] = set()
    blocked: set[str] = set()
    for n in ranked:
        if n in blocked:
            pruned.add(n)
        elif len(applied) < MAX_APPLIED:
            applied.append(n)
            blocked.update(a for a in ancestors(n, tree) if a not in tree.families)
        else:
            over.append(n)
    return applied, over, pruned


def _finish(eligible: list[str], direct: dict[str, set[str]], support: dict[str, float], tree: Tree, declined: dict[str, str], suggest: bool = True) -> Decision:
    applied, over, pruned = _select(eligible, direct, support, tree)
    decision = Decision(applied=applied, sources={n: _order(list(direct[n])) for n in applied})
    if not suggest:
        return decision
    reasons = {**declined, **{n: OVER_CAP for n in over}}
    suggestions = []
    for n in sorted((n for n in direct if n not in applied and n not in pruned), key=lambda n: _suggest_key(n, direct, support)):
        single = len(direct[n]) == 1 and support[n] <= 1.0
        suggestions.append({"genre": n, "sources": _order(list(direct[n])), "reason": reasons.get(n) or (SINGLE_SOURCE if single else INSUFFICIENT)})
    decision.suggestions = _drop_ancestors(suggestions, set(applied), tree)[:MAX_SUGGESTED]
    return decision
