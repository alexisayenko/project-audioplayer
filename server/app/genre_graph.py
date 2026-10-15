"""Genre graph for `GET /genres/graph`: the user's `genre:` tags placed in a Wikidata ontology slice (ADR-0014)."""

from __future__ import annotations

from urllib.parse import quote
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
from .genre_filter import canonical
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

_FAMILIES_FILE = Path(__file__).resolve().parent.parent / "data" / "genre_families.json"
FAMILIES = (
    "Blues", "Brass & Military", "Children's", "Classical", "Electronic", "Folk, World, & Country", "Funk / Soul", "Hip Hop", "Jazz",
    "Latin", "Non-Music", "Pop", "Reggae", "Rock", "Stage & Screen",
)
OTHER = "Other"
_GENRE_DESC = re.compile(r"\b(music|musical)\b.*\b(genre|style)\b|\bgenre\b.*\bmusic\b|\bsubgenre\b", re.I)
_PARENTS_FILE = Path(__file__).with_name("data") / "genre_parents.json"
_QID = re.compile(r"^Q[1-9]\d*$")

_lock = threading.RLock()
_work = threading.Lock()
_running = False
_down_until = 0.0
_limiter = RateLimiter(MIN_INTERVAL)
_mem: dict[str, dict[str, Any]] = {}
_families: dict[str, str] | None = None
_manual: dict[str, list[str]] | None = None


def families() -> dict[str, str]:
    """The reviewed label to Discogs family table (GEN-038); a missing or broken file is empty."""
    global _families
    if _families is None:
        try:
            with open(_FAMILIES_FILE, encoding="utf-8") as f:
                data = json.load(f)
            labels = data.get("labels", {}) if isinstance(data, dict) else {}
        except (OSError, ValueError):
            labels = {}
        _families = {k: v for k, v in labels.items() if isinstance(v, str)}
    return _families


def manual_parents() -> dict[str, list[str]]:
    """The reviewed child label to parent labels table (GEN-045); a missing or broken file is empty."""
    global _manual
    if _manual is None:
        try:
            with open(_PARENTS_FILE, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        _manual = {k: v for k, v in data.items() if not k.startswith("_") and isinstance(v, list)} if isinstance(data, dict) else {}
    return _manual


def validate_manual(table: dict[str, Any]) -> list[str]:
    """Problems in a manual table: non-lowercase or non-string labels, self-parents and cycles within the table."""
    bad: list[str] = []
    graph: dict[str, list[str]] = {}
    for child, ps in table.items():
        if child.startswith("_"):
            continue
        if not isinstance(ps, list) or not all(isinstance(p, str) for p in ps):
            bad.append(f"{child}: parents must be a list of strings")
            continue
        for label in (child, *ps):
            if label != norm(label) or not label:
                bad.append(f"{label!r}: not a lowercase label")
        if child in ps:
            bad.append(f"{child}: parent of itself")
        graph[child] = list(ps)
    for child in graph:
        if _reaches(graph, child, child):
            bad.append(f"{child}: cycle")
    return bad


def _reaches(parents: dict[str, list[str]], start: str, goal: str) -> bool:
    seen: set[str] = set()
    stack = list(parents.get(start, []))
    while stack:
        n = stack.pop()
        if n == goal:
            return True
        if n not in seen:
            seen.add(n)
            stack.extend(parents.get(n, []))
    return False


def _apply_manual(nodes: dict[str, dict[str, Any]], parents: dict[str, list[str]]) -> set[tuple[str, str]]:
    """Adds the manual parent edges whose two nodes exist and that close no cycle; returns the edges added."""
    index: dict[str, str] = {}
    for nid, n in sorted(nodes.items(), reverse=True):
        for k in n["keys"]:
            index[k] = nid
    for nid, n in sorted(nodes.items(), reverse=True):
        index[norm(n["label"])] = nid
    added: set[tuple[str, str]] = set()
    for child, ps in manual_parents().items():
        c = index.get(norm(child))
        for label in ps:
            p = index.get(norm(label))
            if c is None or p is None or c == p or p in parents[c]:
                continue
            if _reaches(parents, p, c):
                log.warning("manual genre parent skipped (cycle): %s -> %s", child, label)
                continue
            parents[c].append(p)
            added.add((c, p))
    return added


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


def _label_fresh(entry: dict[str, Any] | None) -> bool:
    """A cached miss counts only when it was made by the "<label> music" fallback lookup (v 2)."""
    return _fresh(entry) and bool(entry.get("qid") or entry.get("v") == 2)


def _ent_fresh(entry: dict[str, Any] | None) -> bool:
    """An entity entry cached before the Wikipedia title was stored (no "wp" key) counts as stale and is refetched."""
    return _fresh(entry) and "wp" in entry


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
        "wp": ((entity.get("sitelinks") or {}).get("enwiki") or {}).get("title") or "",
        "at": time.time(),
    }


def _fetch_entities(cache: dict[str, Any], qids: list[str]) -> None:
    for i in range(0, len(qids), BATCH):
        chunk = qids[i:i + BATCH]
        data = _api({"action": "wbgetentities", "ids": "|".join(chunk), "props": "labels|claims|descriptions|sitelinks", "languages": "en"})
        for qid, ent in (data.get("entities") or {}).items():
            if isinstance(ent, dict) and "missing" not in ent:
                with _lock:
                    cache["entities"][qid] = _slim(ent)


def resolve_label(cache: dict[str, Any], key: str) -> str | None:
    """The Wikidata music-genre item for a label: exact English label (or alias) match, else that of "<label> music" (so a bare tag joins the resolved "X music" node); None when there is none."""
    qid = _search(cache, key)
    if qid is None and not key.endswith(" music"):
        qid = _search(cache, f"{key} music")
    return qid


def _search(cache: dict[str, Any], key: str) -> str | None:
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
                own.setdefault(norm(canonical(value)), set()).add(s["id"])
    return own


def _missing(cache: dict[str, Any], keys: list[str]) -> bool:
    """True when any label, or any entity within FETCH_LEVELS above a resolved one, is absent or stale."""
    frontier: set[str] = set()
    for k in keys:
        e = cache["labels"].get(k)
        if not _label_fresh(e):
            return True
        if e.get("qid"):
            frontier.add(e["qid"])
    seen: set[str] = set()
    for _ in range(FETCH_LEVELS):
        nxt: set[str] = set()
        for q in frontier - seen:
            ent = cache["entities"].get(q)
            if not _ent_fresh(ent):
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
            if not _label_fresh(cache["labels"].get(k)):
                qid = resolve_label(cache, k)
                with _lock:
                    cache["labels"][k] = {"qid": qid, "at": time.time(), "v": 2}
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


def _wikipedia(cache: dict[str, Any], qid: str | None) -> str | None:
    title = ((cache["entities"].get(qid) or {}).get("wp") or "") if qid else ""
    return "https://en.wikipedia.org/wiki/" + quote(title.replace(" ", "_"), safe="_(),:'!*~-.") if title else None


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


def resolve_families(
    explicit: dict[str, str | None], parents: dict[str, list[str]], reach: dict[str, set[Any]]
) -> dict[str, str]:
    """GEN-038: the explicit table family, else the song-weighted majority of the parents' families, else Other (umbrella rule follows)."""
    out: dict[str, str] = {}

    def of(nid: str, stack: frozenset[str] = frozenset()) -> str:
        if nid in out:
            return out[nid]
        fam = explicit.get(nid)
        if not fam:
            weight: dict[str, int] = {}
            for p in parents.get(nid, []):
                if p in stack or p == nid:
                    continue
                pf = of(p, stack | {nid})
                if pf != OTHER:
                    weight[pf] = weight.get(pf, 0) + max(1, len(reach.get(p, ())))
            fam = max(sorted(weight), key=lambda f: weight[f]) if weight else OTHER
        out[nid] = fam
        return fam

    for nid in explicit:
        of(nid)
    return out


def table_family(label: str, keys: Any = ()) -> str | None:
    table = families()
    return table.get(norm(label)) or next((table[k] for k in sorted(keys) if k in table), None)


UMBRELLA_SHARE = 0.5


def umbrella_families(
    family: dict[str, str], parents: dict[str, list[str]], reach: dict[str, set[Any]], share: float = UMBRELLA_SHARE
) -> dict[str, str]:
    """Roots left in "Other" take the family of the children whose songs cover at least `share` of theirs."""
    kids: dict[str, list[str]] = {}
    for c, ps in parents.items():
        for p in ps:
            kids.setdefault(p, []).append(c)
    out = dict(family)
    for nid, fam in family.items():
        if fam != "Other" or parents.get(nid) or not reach[nid]:
            continue
        songs: dict[str, set[Any]] = {}
        for c in kids.get(nid, []):
            if family[c] != "Other":
                songs.setdefault(family[c], set()).update(reach[c])
        if not songs:
            continue
        best = max(sorted(songs), key=lambda f: len(songs[f]))
        if len(songs[best] & reach[nid]) / len(reach[nid]) >= share:
            out[nid] = best
    return out


def build(songs: list[dict[str, Any]], cache: dict[str, Any]) -> dict[str, Any]:
    nodes = _own_nodes(user_genres(songs), cache)
    ontology = any(n["qid"] for n in nodes.values())
    _add_ancestors(nodes, cache)

    parents = {
        nid: [p for p in (cache["entities"].get(n["qid"]) or {}).get("parents", []) if p in nodes and p != nid] if n["qid"] else []
        for nid, n in nodes.items()
    }
    _break_cycles(parents)
    manual = _apply_manual(nodes, parents)
    reach = _reach(nodes, parents)
    _trim(nodes, parents, reach)
    ids = _slugs(nodes)
    fams = umbrella_families(
        resolve_families({nid: table_family(n["label"], n["keys"]) for nid, n in nodes.items()}, parents, reach), parents, reach
    )

    out_nodes = [
        {
            "id": ids[nid], "label": n["label"], "qid": n["qid"], "wikipedia": _wikipedia(cache, n["qid"]), "family": fams[nid],
            "count": len(reach[nid]), "ownCount": len(n["own"]), "parents": sorted(ids[p] for p in parents[nid]),
            "tags": sorted(n["keys"]),
        }
        for nid, n in sorted(nodes.items(), key=lambda kv: ids[kv[0]])
    ]
    edges = [{"source": ids[c], "target": ids[p], "kind": "parent", **({"origin": "manual"} if (c, p) in manual else {})} for c in sorted(nodes, key=lambda i: ids[i]) for p in sorted(parents[c], key=lambda i: ids[i])]
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


def _json_table() -> dict[str, Any]:
    return json.loads(_PARENTS_FILE.read_text(encoding="utf-8"))


if __name__ == "__main__":
    problems = validate_manual(_json_table())
    print("\n".join(problems) or "genre_parents.json ok")
    raise SystemExit(1 if problems else 0)
