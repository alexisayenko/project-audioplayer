"""One-off, idempotent: folds the v1 genre vocabulary into server/data/genres_v2.json (ADR-0045, task-0096).

Curated v2 genres stay byte for byte. Every v1 genre with no v2 counterpart (matched by the `v1` field, id, name or synonym) is added with `legacy: true`, `v1` = its exact v1 name, its v1 parents mapped to the matching curated or added genre (none left: a child of the grey `legacy` genre), `legacyParents` for dropped parents. Run from server/: python ../scripts/migrate_genres_v2_legacy.py"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

from app import genre_vocab as gv  # noqa: E402

FILE = ROOT / "server" / "data" / "genres_v2.json"
CLUSTER = {"id": "legacy", "name": "Legacy", "colour": "#8A8A8A", "note": "Holding area for genres not yet curated: every v1 vocabulary genre without a v2 counterpart, flagged legacy. Move them into the curated clusters over time."}
LEGACY = {"id": "legacy", "name": "Legacy", "level": 1, "cluster": "legacy", "parents": [], "legacy": True, "description": "Holding area for genres not yet curated."}


def slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name.casefold().replace("&", " and "))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def display(name: str) -> str:
    return " ".join(w[:1].upper() + w[1:] for w in name.split(" "))


def line(row: dict) -> str:
    return "  " + json.dumps(row, ensure_ascii=False)


def vocab_rows() -> dict[str, dict]:
    raw = json.loads(gv.LEVELS_FILE.read_text(encoding="utf-8"))
    levels, forms, fam_syn, _ = gv.parse_all(raw)
    v = gv.load()
    rows = {}
    for name, e in v.entries.items():
        if name in levels:
            syn, shown = levels[name]["synonyms"], levels[name]["display"]
        elif name in forms:
            syn, shown = forms[name]["synonyms"], forms[name].get("display")
        else:
            syn, shown = fam_syn.get(e.family, []), e.family
        parents = []
        for p in e.parents:
            t = v.by_key.get(gv.vkey(p))
            if t and t in v.entries and t not in parents:
                parents.append(t)
        rows[name] = {"name": shown if shown and len(shown) <= 60 else display(name), "synonyms": list(syn), "parents": parents, "raw_parents": list(e.parents)}
    return rows


def split(text: str):
    lines = text.split("\n")
    g0 = next(i for i, l in enumerate(lines) if l.strip() == '"genres": [')
    g1 = next(i for i in range(len(lines) - 1, -1, -1) if lines[i] == " ]")
    c0 = next(i for i, l in enumerate(lines) if l.strip() == '"clusters": [')
    c1 = next(i for i in range(c0, g0) if lines[i] == " ],")
    return lines, c0, c1, g0, g1


def main() -> None:
    lines, c0, c1, g0, g1 = split(FILE.read_text(encoding="utf-8"))
    clines = [l.rstrip(",") for l in lines[c0 + 1 : c1] if '"id": "legacy"' not in l]
    glines = [l.rstrip(",") for l in lines[g0 + 1 : g1] if '"legacy": true' not in l]
    curated = [json.loads(l) for l in glines]
    cur_by_id = {g["id"]: g for g in curated}
    tmap, norm = {}, {}
    for g in curated:
        if g.get("v1"):
            tmap[g["v1"]] = g["id"]
        for k in (g["id"], g["name"], g.get("v1"), *g.get("synonyms", [])):
            if k:
                norm.setdefault(gv.vkey(k.replace("-", " ")), g["id"])
    rows = vocab_rows()
    folded = {}
    for name in rows:
        hit = tmap.get(name) or norm.get(gv.vkey(name.replace("-", " "))) or norm.get(gv.vkey(slug(name)))
        if hit:
            folded[name] = hit
    added = sorted((n for n in rows if n not in folded), key=lambda n: (rows[n]["name"].casefold(), n))
    used = set(cur_by_id) | {"legacy"}
    ids = {}
    for n in added:
        base = slug(rows[n]["name"]) or slug(n) or "genre"
        cand, i = base, 2
        while cand in used:
            cand, i = (f"{base}-legacy" if i == 2 else f"{base}-legacy-{i}"), i + 1
        used.add(cand)
        ids[n] = cand
    ref = {**folded, **ids}
    out, state = {}, {}

    def build(n: str) -> dict:
        if n in out:
            return out[n]
        if state.get(n) == 1:
            raise SystemExit(f"cycle in v1 data at {n!r}")
        state[n] = 1
        kept, dropped = [], []
        for p in rows[n]["parents"]:
            t = ref.get(p)
            if t and t not in kept:
                kept.append(t)
        for p in rows[n]["raw_parents"]:
            if gv.vkey(p) not in {gv.vkey(x) for x in rows} and p not in dropped:
                dropped.append(p)
        pl = [cur_by_id[t]["level"] if t in cur_by_id else build(next(k for k, v in ids.items() if v == t))["level"] for t in kept]
        if kept:
            first = kept[0]
            cluster = cur_by_id[first]["cluster"] if first in cur_by_id else out[next(k for k, v in ids.items() if v == first)]["cluster"]
        else:
            kept, pl, cluster = ["legacy"], [1], "legacy"
        row = {"id": ids[n], "name": rows[n]["name"], "level": 1 + min(pl), "cluster": cluster, "parents": kept, "v1": n}
        if rows[n]["synonyms"]:
            row["synonyms"] = rows[n]["synonyms"]
        if dropped:
            row["legacyParents"] = dropped
        row["legacy"] = True
        out[n] = row
        state[n] = 2
        return row

    for n in added:
        build(n)
    cl = clines + [line(CLUSTER)[:0] + "  " + json.dumps(CLUSTER, ensure_ascii=False)]
    gl = glines + [line(LEGACY)] + [line(out[n]) for n in added]
    new = lines[: c0 + 1] + [l + "," for l in cl[:-1]] + [cl[-1]] + lines[c1 : g0 + 1] + [l + "," for l in gl[:-1]] + [gl[-1]] + lines[g1:]
    FILE.write_text("\n".join(new), encoding="utf-8", newline="")
    print(f"folded {len(folded)}, added {len(added)} (+ legacy)")


main()
