#!/usr/bin/env python3
"""Reviewable data operations on the genre tree (task-0066): promote a genre to level 1, move a genre, report before/after.

Run from the repo root with the server's Python (stdlib only plus the app's own parser):

  python scripts/genre-ops.py promote house techno trance      # level 1 genres; their children rise one level
  python scripts/genre-ops.py move "psychedelic trance" --to trance            # Others (or --from Z) replaced by trance
  python scripts/genre-ops.py parents "acid" "techno,house"                    # set the full parents list
  python scripts/genre-ops.py unparent synthpop disco --from Others            # drop one parent (never the last one) from each genre
  python scripts/genre-ops.py report                                           # review of the working tree against git HEAD

Every mutating command validates the result with the app's parser, rewrites server/data/genre_levels.json (and drops a promoted genre from genre_discogs.json and genre_extras.json), refreshes the `_meta` counts and prints the review: changed genres (old parents/level -> new), level and family counts, checks. `--dry-run` prints without writing; `--base REV` compares with another git revision (default HEAD), `--base-dir DIR` with a directory holding an old genre_levels.json; `--out FILE` also saves the review.
"""
from __future__ import annotations

import argparse
import collections
import copy
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "server" / "data"
sys.path.insert(0, str(ROOT / "server"))
from app import genre_vocab as gv  # noqa: E402

FILES = ("genre_levels.json", "genre_discogs.json", "genre_extras.json")


def load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def dump(doc: dict) -> str:
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def from_git(rev: str, name: str) -> dict:
    out = subprocess.run(["git", "-C", str(ROOT), "show", f"{rev}:server/data/{name}"], capture_output=True, text=True, encoding="utf-8")
    if out.returncode:
        raise SystemExit(f"cannot read {name} at {rev}: {out.stderr.strip()}")
    return json.loads(out.stdout)


def groups_of(doc: dict) -> list[str]:
    return [n for n, s in doc["families"].items() if isinstance(s, dict) and s.get("group")]


def is_entry(doc: dict, name: str) -> bool:
    return name not in ("_meta", "families", "modifiers", "subfamilies") and isinstance(doc.get(name), dict)


def promote(levels: dict, discogs: dict, extras: dict, name: str, colour: str | None) -> None:
    """Move the genre entry `name` into the families block: a level 1 node keyed by the same name (children keep their `parents` text), keeping every parent that is not a group."""
    if name in levels["families"]:
        raise SystemExit(f"{name}: already level 1")
    if not is_entry(levels, name):
        raise SystemExit(f"{name}: not a genre entry of genre_levels.json")
    e = levels[name]
    groups = groups_of(levels)
    left = [p for p in e["parents"] if p in groups]
    keep = [p for p in e["parents"] if p not in groups]
    node: dict = {"name": name, "synonyms": e.get("synonyms", [])}
    if keep:
        node["parents"] = keep
    for f in ("related", "modifiers", "display", "subfamily"):
        if e.get(f):
            node[f] = e[f]
    if e.get("fusion"):
        node["fusion"] = True
    node["discogs"] = e["discogs"]
    inherit = colour or (left[0] if left else None)
    if inherit:
        node["colour"] = inherit
    for f in ("provisional", "status"):
        if e.get(f):
            print(f"note: {name} had {f}={e[f]!r}; a level 1 node carries neither", file=sys.stderr)
    fams = collections.OrderedDict()
    placed = False
    for k, v in levels["families"].items():
        if not placed and isinstance(v, dict) and v.get("group"):
            fams[name] = node
            placed = True
        fams[k] = v
    if not placed:
        fams[name] = node
    levels["families"] = fams
    del levels[name]
    discogs["genres"].pop(name, None)
    extras["extras"].pop(name, None)


def reparent(levels: dict, name: str, new_parents: list[str]) -> None:
    if name in levels["families"] and isinstance(levels["families"][name], dict) and "discogs" in levels["families"][name]:
        spec = levels["families"][name]
        if new_parents:
            spec["parents"] = new_parents
        else:
            spec.pop("parents", None)
    elif is_entry(levels, name):
        if not new_parents:
            raise SystemExit(f"{name}: a genre needs at least one parent")
        levels[name]["parents"] = new_parents
    else:
        raise SystemExit(f"{name}: not a genre or a promoted genre")


def unparent(levels: dict, name: str, parent: str) -> None:
    """Remove the single parent `parent` from `name`, keeping its other parents; the last parent of a genre cannot be removed."""
    spec = levels["families"].get(name) if name in levels["families"] else levels.get(name)
    if not isinstance(spec, dict) or name in ("_meta", "modifiers", "subfamilies"):
        raise SystemExit(f"{name}: unknown genre")
    cur = list(spec.get("parents", []))
    if parent not in cur:
        raise SystemExit(f"{name}: parents are {cur}; {parent} is not one of them")
    left = [p for p in cur if p != parent]
    if not left and name not in levels["families"]:
        raise SystemExit(f"{name}: {parent} is its only parent; use move or promote")
    reparent(levels, name, left)


def refresh_meta(levels: dict) -> None:
    """Recompute `_meta.counts`, `total` and `non_discogs` from the data (genres below level 1 counted under every family they descend from)."""
    entries, forms, synonyms, _ = gv.parse_all(levels)
    counts, non = {}, {}
    for f in synonyms:
        mine = [v for v in entries.values() if f in v["families"] and v is not entries.get(f)]
        counts[f] = {"total": len(mine), "level2": sum(v["level"] == 2 for v in mine), "level3": sum(v["level"] == 3 for v in mine), "level4": sum(v["level"] == 4 for v in mine)}
        non[f] = sum(not v["discogs"] for v in mine)
    levels["_meta"]["counts"], levels["_meta"]["non_discogs"], levels["_meta"]["total"] = counts, non, len(entries)


def review(base: dict, new: dict, base_name: str) -> str:
    out: list[str] = []
    P = out.append
    old_e, old_f, _, _ = gv.parse_all(base)
    new_e, new_f, _, _ = gv.parse_all(new)
    old_all, new_all = {**old_e, **old_f}, {**new_e, **new_f}
    old_groups, new_groups = gv.parse_groups(base), gv.parse_groups(new)
    P(f"# Genre data review: working tree against {base_name}\n")
    P(f"- genres below level 1: {len(old_e)} -> {len(new_e)}; promoted level 1 genres: {len(old_f)} -> {len(new_f)} ({', '.join(new_f) or '-'}); groups: {', '.join(new_groups) or '-'}")
    gone = sorted(set(old_all) - set(new_all))
    P(f"- CHECK every genre still exists exactly once (as a genre or a promoted genre): {'OK' if not gone else 'FAIL missing ' + ', '.join(gone)}")
    lost = sorted(k for k, v in new_all.items() if not v["families"])
    P(f"- CHECK no genre lost its place (every genre has at least one level 1 ancestor): {'OK' if not lost else 'FAIL ' + ', '.join(lost)}")
    bad = sorted(k for k in new_all if k in {g.lower() for g in new_groups} or k in {s.lower() for g in new_groups.values() for s in g["synonyms"]})
    P(f"- CHECK no group (or group synonym) is a genre: {'OK' if not bad else 'FAIL ' + ', '.join(bad)}")
    oc = collections.Counter(v["level"] for v in old_all.values())
    nc = collections.Counter(v["level"] for v in new_all.values())
    P("\n## Level distribution (every genre, promoted ones are level 1)\n\n| level | before | after |\n|---|---|---|")
    for lvl in sorted(set(oc) | set(nc)):
        P(f"| {lvl} | {oc.get(lvl, 0)} | {nc.get(lvl, 0)} |")

    def famcount(entries: dict) -> collections.Counter:
        c: collections.Counter = collections.Counter()
        for v in entries.values():
            for f in v["families"]:
                c[f] += 1
        return c

    fo, fn = famcount(old_e), famcount(new_e)
    P("\n## Genres below each level 1 name (a genre under several is counted in each)\n\n| level 1 name | before | after |\n|---|---|---|")
    for f in dict.fromkeys([*fo, *fn]):
        P(f"| {f} | {fo.get(f, '-')} | {fn.get(f, '-')} |")
    P("\n## Changed genres (old parents / level -> new parents / level)\n\n| genre | before | after | notes |\n|---|---|---|---|")
    n = 0
    for k in dict.fromkeys([*old_all, *new_all]):
        o, w = old_all.get(k), new_all.get(k)
        if o is None or w is None:
            P(f"| {k} | {'-' if o is None else '[%s] L%s' % (', '.join(o['parents']) or '-', o['level'])} | {'-' if w is None else '[%s] L%s' % (', '.join(w['parents']) or '-', w['level'])} | {'new' if o is None else 'removed'} |")
            n += 1
            continue
        notes = []
        if bool(o.get("form")) != bool(w.get("form")):
            notes.append("promoted to level 1" if w.get("form") else "no longer level 1")
        if o["families"] != w["families"]:
            notes.append(f"level 1 names {o['families']} -> {w['families']}")
        for f in ("related", "synonyms"):
            if o.get(f) != w.get(f):
                notes.append(f"{f} {o.get(f) or '-'} -> {w.get(f) or '-'}")
        if o["parents"] != w["parents"] or o["level"] != w["level"] or notes:
            n += 1
            P(f"| {k} | [{', '.join(o['parents']) or '-'}] L{o['level']} | [{', '.join(w['parents']) or '-'}] L{w['level']} | {'; '.join(notes)} |")
    P(f"\nChanged rows: {n}.")
    moved = collections.Counter((old_all[k]["level"], new_all[k]["level"]) for k in old_all if k in new_all and old_all[k]["level"] != new_all[k]["level"])
    P("Level moves (old -> new: genres): " + (", ".join(f"L{a}->L{b}: {c}" for (a, b), c in sorted(moved.items())) or "none"))
    multi = sorted(k for k, v in new_all.items() if len(v["families"]) >= 2)
    P(f"\nGenres under two or more level 1 names (equal parents): {len(multi)}")
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["promote", "move", "parents", "unparent", "report"])
    ap.add_argument("names", nargs="*")
    ap.add_argument("--to")
    ap.add_argument("--from", dest="frm")
    ap.add_argument("--colour")
    ap.add_argument("--base", default="HEAD")
    ap.add_argument("--base-dir", help="read the base genre_levels.json from this directory instead of git")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args()
    levels, discogs, extras = (load(f) for f in FILES)
    if a.command == "promote":
        if not a.names:
            raise SystemExit("promote: give one or more genre names")
        for name in a.names:
            promote(levels, discogs, extras, name, a.colour)
    elif a.command == "move":
        if len(a.names) != 1 or not a.to:
            raise SystemExit('move: move "<genre>" --to <parent> [--from <parent>]')
        name = a.names[0]
        spec = levels["families"].get(name) if name in levels["families"] else levels.get(name)
        if spec is None:
            raise SystemExit(f"{name}: unknown genre")
        cur = list(spec.get("parents", []))
        frm = a.frm or next((p for p in cur if p in groups_of(levels)), None)
        if frm not in cur:
            raise SystemExit(f"{name}: parents are {cur}; say which to replace with --from")
        reparent(levels, name, [a.to if p == frm else p for p in cur if not (p == a.to and p != frm)])
    elif a.command == "parents":
        if len(a.names) != 2:
            raise SystemExit('parents: parents "<genre>" "A,B"')
        reparent(levels, a.names[0], [p.strip() for p in a.names[1].split(",") if p.strip()])
    elif a.command == "unparent":
        if not a.names or not a.frm:
            raise SystemExit("unparent: unparent <genre> [<genre> ...] --from <parent>")
        for name in a.names:
            unparent(levels, name, a.frm)
    if a.command != "report":
        try:
            gv.parse_all(levels)
        except ValueError as e:
            raise SystemExit(f"INVALID, nothing written: {e}")
        refresh_meta(levels)
        gv.parse_all(levels)
        if not a.dry_run:
            (DATA / "genre_levels.json").write_text(dump(levels), encoding="utf-8", newline="\n")
            (DATA / "genre_discogs.json").write_text(dump(discogs), encoding="utf-8", newline="\n")
            (DATA / "genre_extras.json").write_text(dump(extras), encoding="utf-8", newline="\n")
    base = json.loads((Path(a.base_dir) / "genre_levels.json").read_text(encoding="utf-8")) if a.base_dir else from_git(a.base, "genre_levels.json")
    text = review(base, levels, a.base_dir or a.base)
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
    sys.stdout.write(text)
    if a.command != "report" and not a.dry_run:
        print("\nwritten: server/data/genre_levels.json, genre_discogs.json, genre_extras.json. Next: run the server tests (tests/test_genre_*.py).")


if __name__ == "__main__":
    main()
