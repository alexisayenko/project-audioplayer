"""Genre graph for `GET /genres/graph`: the user's `genre:` tags placed in a Wikidata ontology slice (ADR-0014)."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from . import httpjson
from .jsonio import write_json_atomic
from .ratelimit import RateLimiter
from .tags import namespaced_values

log = logging.getLogger(__name__)

API = "https://www.wikidata.org/w/api.php"
MUSIC_GENRE = "Q188451"
P_INSTANCE, P_PARENT, P_RELATED = "P31", "P279", "P737"
TTL = 30 * 86400
SHOWN_LEVELS = 4
FETCH_LEVELS = 6
BATCH = 50
MAX_NODES = 400
MIN_INTERVAL = 0.3
TIMEOUT = 8
RETRY_AFTER = 300
INLINE = False

_FAMILIES_FILE = Path(__file__).with_name("data") / "discogs-families.json"
_GENRE_DESC = re.compile(r"\b(music|musical)\b.*\b(genre|style)\b|\bgenre\b.*\bmusic\b|\bsubgenre\b", re.I)
_QID = re.compile(r"^Q[1-9]\d*$")

_lock = threading.RLock()
_work = threading.Lock()
_running = False
_down_until = 0.0
_limiter = RateLimiter(MIN_INTERVAL)
_mem: dict[str, dict[str, Any]] = {}
_families: dict[str, Any] | None = None


def families() -> dict[str, Any]:
    global _families
    if _families is None:
        with open(_FAMILIES_FILE, encoding="utf-8") as f:
            _families = json.load(f)
    return _families


def norm(label: str) -> str:
    return " ".join(label.lower().split())


def slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") or "genre"


def _empty() -> dict[str, Any]:
    return {"version": 1, "labels": {}, "entities": {}}


def load_cache(path: Path) -> dict[str, Any]:
    key = str(path)
    with _lock:
        if key not in _mem:
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                ok = isinstance(data, dict) and isinstance(data.get("labels"), dict) and isinstance(data.get("entities"), dict)
                _mem[key] = data if ok else _empty()
            except (OSError, ValueError):
                _mem[key] = _empty()
        return _mem[key]


def save_cache(path: Path) -> None:
    with _lock:
        data = _mem.get(str(path))
        if data is None:
            return
        try:
            write_json_atomic(path, data, compact=True)
        except OSError as e:
            log.warning("genre cache not saved: %s", e)


def _fresh(entry: dict[str, Any] | None) -> bool:
    return bool(entry) and time.time() - float(entry.get("at", 0)) < TTL


def _api(params: dict[str, str]) -> dict[str, Any]:
    _limiter.reserve()
    return httpjson.http_json(API, TIMEOUT, params={**params, "format": "json"})


def _ids(entity: dict[str, Any], prop: str) -> list[str]:
    out: list[str] = []
    for c in (entity.get("claims") or {}).get(prop, []):
        v = ((c.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        qid = v.get("id") if isinstance(v, dict) else None
        if isinstance(qid, str) and _QID.match(qid) and qid not in out:
            out.append(qid)
    return out


def _slim(entity: dict[str, Any]) -> dict[str, Any]:
    label = ((entity.get("labels") or {}).get("en") or {}).get("value") or ""
    desc = ((entity.get("descriptions") or {}).get("en") or {}).get("value") or ""
    types = _ids(entity, P_INSTANCE) + _ids(entity, P_PARENT)
    return {
        "label": label,
        "parents": _ids(entity, P_PARENT),
        "related": _ids(entity, P_RELATED),
        "genre": MUSIC_GENRE in types or bool(_GENRE_DESC.search(desc)),
        "at": time.time(),
    }


def _fetch_entities(cache: dict[str, Any], qids: list[str]) -> None:
    for i in range(0, len(qids), BATCH):
        chunk = qids[i:i + BATCH]
        data = _api({"action": "wbgetentities", "ids": "|".join(chunk), "props": "labels|claims|descriptions", "languages": "en"})
        for qid, ent in (data.get("entities") or {}).items():
            if isinstance(ent, dict) and "missing" not in ent:
                with _lock:
                    cache["entities"][qid] = _slim(ent)


def resolve_label(cache: dict[str, Any], key: str) -> str | None:
    """The Wikidata music-genre item for a label: exact English label (or alias) match; None when there is none."""
    data = _api({"action": "wbsearchentities", "search": key, "language": "en", "type": "item", "limit": "10"})
    hits = [h for h in data.get("search") or [] if isinstance(h, dict) and _QID.match(str(h.get("id", "")))]
    need = [h["id"] for h in hits if not _fresh(cache["entities"].get(h["id"]))]
    if need:
        _fetch_entities(cache, need)
    scores = [s for rank, h in enumerate(hits) if (s := _hit_score(cache["entities"].get(h["id"]), h, rank, key))]
    return min(scores)[2] if scores else None


def _hit_score(ent: dict[str, Any] | None, h: dict[str, Any], rank: int, key: str) -> tuple[int, int, str] | None:
    if not ent or not ent.get("genre"):
        return None
    match = h.get("match") or {}
    if norm(str(match.get("text") or h.get("label") or "")) != key and norm(ent.get("label", "")) != key:
        return None
    return (0 if match.get("type") == "label" else 1, rank, h["id"])


def user_genres(songs: list[dict[str, Any]]) -> dict[str, set[str]]:
    own: dict[str, set[str]] = {}
    for s in songs:
        for value in namespaced_values(s.get("tags") or [], "genre"):
            if norm(value):
                own.setdefault(norm(value), set()).add(s["id"])
    return own


def _missing(cache: dict[str, Any], keys: list[str]) -> bool:
    """True when any label, or any entity within FETCH_LEVELS above a resolved one, is absent or stale."""
    frontier: set[str] = set()
    for k in keys:
        e = cache["labels"].get(k)
        if not _fresh(e):
            return True
        if e.get("qid"):
            frontier.add(e["qid"])
    seen: set[str] = set()
    for _ in range(FETCH_LEVELS):
        nxt: set[str] = set()
        for q in frontier - seen:
            ent = cache["entities"].get(q)
            if not _fresh(ent):
                return True
            nxt.update(ent["parents"])
        seen |= frontier
        frontier = nxt
        if not frontier:
            break
    return False


def ensure(path: Path, keys: list[str]) -> bool:
    """Fetches what the cache lacks for these labels; False after a network failure (the cache keeps what arrived)."""
    global _down_until
    cache = load_cache(path)
    try:
        for k in keys:
            if not _fresh(cache["labels"].get(k)):
                qid = resolve_label(cache, k)
                with _lock:
                    cache["labels"][k] = {"qid": qid, "at": time.time()}
        frontier = {cache["labels"][k]["qid"] for k in keys if cache["labels"].get(k, {}).get("qid")}
        seen: set[str] = set()
        for _ in range(FETCH_LEVELS):
            frontier -= seen
            if not frontier:
                break
            todo = sorted(q for q in frontier if not _fresh(cache["entities"].get(q)))
            if todo:
                _fetch_entities(cache, todo)
            seen |= frontier
            frontier = {p for q in frontier for p in (cache["entities"].get(q) or {}).get("parents", [])}
        return True
    except Exception as e:
        log.warning("genre ontology fetch failed: %s", e)
        _down_until = time.time() + RETRY_AFTER
        return False
    finally:
        save_cache(path)


def _background(path: Path, keys: list[str]) -> None:
    global _running
    try:
        with _work:
            ensure(path, keys)
    finally:
        _running = False


def _kick(path: Path, keys: list[str]) -> None:
    global _running
    with _lock:
        if _running or time.time() < _down_until:
            return
        _running = True
    if INLINE:
        _background(path, keys)
    else:
        threading.Thread(target=_background, args=(path, keys), daemon=True).start()


_WORD = re.compile(r"[a-z0-9&'/\-]+")


def _by_keyword(label: str) -> str | None:
    """Last-resort family for a label: a known phrase, else the first keyword scanning words from the head noun backwards."""
    fam = families()
    text = " ".join(label.lower().split())
    for phrase, family in fam.get("phrases", {}).items():
        if phrase in text:
            return family
    index = fam.get("_kw_index")
    if index is None:
        index = {w: f for f, words in fam.get("keywords", {}).items() for w in words}
        fam["_kw_index"] = index
    for word in reversed([w for t in _WORD.findall(text) for w in (t, *re.split(r"[/\-]", t))]):
        if word in index:
            return index[word]
    return None


def _family(cache: dict[str, Any], qid: str | None, label: str) -> str:
    fam = families()
    by_label = fam["labels"]
    own = by_label.get(label.lower())
    if not qid:
        return own or _by_keyword(label) or "Other"
    queue = deque([qid])
    seen = {qid}
    while queue:
        q = queue.popleft()
        ent = cache["entities"].get(q) or {}
        name = str(ent.get("label", ""))
        hit = fam["qids"].get(q) or by_label.get(name.lower()) or (_by_keyword(name) if name else None)
        if hit:
            return hit
        for p in ent.get("parents", []):
            if p not in seen:
                seen.add(p)
                queue.append(p)
    return own or _by_keyword(label) or "Other"


def _break_cycles(parents: dict[str, list[str]]) -> None:
    """Drops the back edges of a depth-first walk so the graph is a DAG."""
    state: dict[str, int] = {}
    for root in sorted(parents):
        if state.get(root):
            continue
        state[root] = 1
        stack = [(root, iter(list(parents[root])))]
        while stack:
            node, it = stack[-1]
            for p in it:
                if state.get(p) == 1:
                    parents[node].remove(p)
                elif not state.get(p):
                    state[p] = 1
                    stack.append((p, iter(list(parents[p]))))
                    break
            else:
                state[node] = 2
                stack.pop()


def _own_nodes(own_by_label: dict[str, set[str]], cache: dict[str, Any]) -> dict[str, dict[str, Any]]:
    nodes: dict[str, dict[str, Any]] = {}
    for key in sorted(own_by_label):
        entry = cache["labels"].get(key) or {}
        qid = entry.get("qid")
        ent = cache["entities"].get(qid) if qid else None
        nid = qid or f"l:{key}"
        node = nodes.setdefault(nid, {"qid": qid, "label": (ent or {}).get("label") or key, "own": set(), "keys": set(), "level": 0})
        node["own"] |= own_by_label[key]
        node["keys"].add(key)
    return nodes


def _add_ancestors(nodes: dict[str, dict[str, Any]], cache: dict[str, Any]) -> None:
    level = {nid: 0 for nid, n in nodes.items() if n["qid"]}
    queue = deque(level)
    while queue:
        q = queue.popleft()
        if level[q] >= SHOWN_LEVELS:
            continue
        for p in (cache["entities"].get(q) or {}).get("parents", []):
            if p not in level and (cache["entities"].get(p) or {}).get("genre"):
                level[p] = level[q] + 1
                queue.append(p)
                nodes[p] = {"qid": p, "label": cache["entities"][p]["label"] or p, "own": set(), "keys": set(), "level": level[p]}


def _reach(nodes: dict[str, dict[str, Any]], parents: dict[str, list[str]]) -> dict[str, set[str]]:
    """For every node the songs of its own genre and of all its descendants."""
    children: dict[str, list[str]] = {nid: [] for nid in nodes}
    for nid, ps in parents.items():
        for p in ps:
            children[p].append(nid)
    reach = {nid: set(n["own"]) for nid, n in nodes.items()}
    remaining = {nid: len(children[nid]) for nid in nodes}
    ready = deque(sorted(nid for nid, c in remaining.items() if c == 0))
    while ready:
        nid = ready.popleft()
        for p in parents[nid]:
            reach[p] |= reach[nid]
            remaining[p] -= 1
            if remaining[p] == 0:
                ready.append(p)
    return reach


def _trim(nodes: dict[str, dict[str, Any]], parents: dict[str, list[str]], reach: dict[str, set[str]]) -> None:
    """Drop the least relevant nodes beyond MAX_NODES (ancestors first, user genres last)."""
    if len(nodes) <= MAX_NODES:
        return
    order = sorted(nodes, key=lambda i: (len(nodes[i]["own"]) > 0, -nodes[i]["level"], len(reach[i]), i))
    for nid in order[:len(nodes) - MAX_NODES]:
        del nodes[nid]
    for nid in nodes:
        parents[nid] = [p for p in parents[nid] if p in nodes]


def _slugs(nodes: dict[str, dict[str, Any]]) -> dict[str, str]:
    ids: dict[str, str] = {}
    used: set[str] = set()
    for nid in sorted(nodes, key=lambda i: (nodes[i]["label"].lower(), i)):
        base = slug(nodes[nid]["label"])
        sid = base if base not in used else f"{base}-{(nodes[nid]['qid'] or 'x').lower()}"
        while sid in used:
            sid += "-2"
        used.add(sid)
        ids[nid] = sid
    return ids


def _related_edges(nodes: dict[str, dict[str, Any]], parents: dict[str, list[str]], ids: dict[str, str],
                   cache: dict[str, Any]) -> list[dict[str, str]]:
    edges: list[dict[str, str]] = []
    linked = {frozenset((c, p)) for c in nodes for p in parents[c]}
    related: set[frozenset[str]] = set()
    for nid, n in nodes.items():
        for r in (cache["entities"].get(n["qid"]) or {}).get("related", []) if n["qid"] else []:
            pair = frozenset((nid, r))
            if r in nodes and r != nid and pair not in linked and pair not in related:
                related.add(pair)
                a, b = sorted(pair, key=lambda i: ids[i])
                edges.append({"source": ids[a], "target": ids[b], "kind": "related"})
    return edges


def build(songs: list[dict[str, Any]], cache: dict[str, Any]) -> dict[str, Any]:
    nodes = _own_nodes(user_genres(songs), cache)
    ontology = any(n["qid"] for n in nodes.values())
    _add_ancestors(nodes, cache)

    parents = {
        nid: [p for p in (cache["entities"].get(n["qid"]) or {}).get("parents", []) if p in nodes and p != nid] if n["qid"] else []
        for nid, n in nodes.items()
    }
    _break_cycles(parents)
    reach = _reach(nodes, parents)
    _trim(nodes, parents, reach)
    ids = _slugs(nodes)

    out_nodes = [
        {
            "id": ids[nid], "label": n["label"], "qid": n["qid"], "family": _family(cache, n["qid"], n["label"]),
            "count": len(reach[nid]), "ownCount": len(n["own"]), "parents": sorted(ids[p] for p in parents[nid]),
            "tags": sorted(n["keys"]),
        }
        for nid, n in sorted(nodes.items(), key=lambda kv: ids[kv[0]])
    ]
    edges = [{"source": ids[c], "target": ids[p], "kind": "parent"} for c in sorted(nodes, key=lambda i: ids[i]) for p in sorted(parents[c], key=lambda i: ids[i])]
    edges += _related_edges(nodes, parents, ids, cache)
    return {"nodes": out_nodes, "edges": edges, "ontology": ontology}


def graph(songs: list[dict[str, Any]], path: Path) -> dict[str, Any]:
    """The user's graph from the cache; unresolved labels and missing ancestors are fetched in the background (`pending`)."""
    keys = sorted(user_genres(songs))
    cache = load_cache(path)
    with _lock:
        missing = bool(keys) and _missing(cache, keys)
    if missing:
        _kick(path, keys)
    with _lock:
        out = build(songs, cache)
        again = bool(keys) and _missing(cache, keys)
    out["pending"] = bool(_running or (again and time.time() >= _down_until))
    return out
