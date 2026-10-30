"""Idempotent: regenerates the Legacy section of server/data/genres_v2.json (ADR-0045, task-0096).

Curated v2 genres (no `legacy` flag) stay byte for byte. Legacy is one level 1 genre holding a COMPLETE copy of the v1 vocabulary: every v1 genre, including those that also exist as curated v2 genres, gets a `legacy: true` row with id `legacy-<slug>`, its plain v1 name, `v1` = its exact v1 name and its v1 parents among the copies (v1 top-level genres are level 2 children of `legacy`); `legacyParents` lists v1 parents outside the vocabulary. Nothing is folded into curated genres, except the v1 names in MIGRATED (owner decision 2026-10-30: curated under Trance, no Legacy copy; their v1 children hang under their other parents or under Legacy, `legacyParents` keeps the name). Previous legacy rows are removed first. Run from server/: python ../scripts/migrate_genres_v2_legacy.py"""

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
CLUSTER = {"id": "legacy", "name": "Legacy", "colour": "#8A8A8A", "note": "Holding area: a complete copy of the v1 vocabulary hierarchy, duplicates of curated genres included, every row flagged legacy. Curated genres live in their own clusters."}
LEGACY = {"id": "legacy", "name": "Legacy", "level": 1, "cluster": "legacy", "parents": [], "legacy": True, "description": "Holding area for genres not yet curated."}


MIGRATED = {"acid trance", "dream trance", "euro trance", "hands up", "hard trance", "progressive trance", "tech trance", "uplifting trance", "vocal trance"}


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
        if name in MIGRATED:
            continue
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
    rows = vocab_rows()
    names = sorted(rows, key=lambda n: (rows[n]["name"].casefold(), n))
    used = {g["id"] for g in curated} | {"legacy"}
    ids = {}
    for n in names:
        base = "legacy-" + (slug(rows[n]["name"]) or slug(n) or "genre")
        cand, i = base, 2
        while cand in used:
            cand, i = f"{base}-{i}", i + 1
        used.add(cand)
        ids[n] = cand
    out, state = {}, {}

    def build(n: str) -> dict:
        if n in out:
            return out[n]
        if state.get(n) == 1:
            raise SystemExit(f"cycle in v1 data at {n!r}")
        state[n] = 1
        kept = [ids[p] for p in dict.fromkeys(rows[n]["parents"]) if p in ids and p != n]
        known = {gv.vkey(x) for x in rows}
        dropped = [p for p in dict.fromkeys(rows[n]["raw_parents"]) if gv.vkey(p) not in known]
        levels = [build(p)["level"] for p in rows[n]["parents"] if p in ids and p != n]
        if not kept:
            kept, levels = ["legacy"], [1]
        row = {"id": ids[n], "name": rows[n]["name"], "level": 1 + min(levels), "cluster": "legacy", "parents": kept, "v1": n}
        if rows[n]["synonyms"]:
            row["synonyms"] = rows[n]["synonyms"]
        if dropped:
            row["legacyParents"] = dropped
        row["legacy"] = True
        out[n] = row
        state[n] = 2
        return row

    for n in names:
        build(n)
    cl = clines + ["  " + json.dumps(CLUSTER, ensure_ascii=False)]
    gl = glines + [line(LEGACY)] + [line(out[n]) for n in names]
    new = lines[: c0 + 1] + [l + "," for l in cl[:-1]] + [cl[-1]] + lines[c1 : g0 + 1] + [l + "," for l in gl[:-1]] + [gl[-1]] + lines[g1:]
    FILE.write_text("\n".join(new), encoding="utf-8", newline="")
    print(f"curated {len(curated)}, legacy copies {len(names)} (+ legacy)")


main()
