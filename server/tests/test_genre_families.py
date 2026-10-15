import json
from pathlib import Path

import pytest

from app import genre_graph as gg

FIXTURE = Path(__file__).parent / "fixtures" / "genre_graph_live.json"
TABLE = Path(gg.__file__).resolve().parent.parent / "data" / "genre_families.json"


def _reach(parents):
    kids = {}
    for c, ps in parents.items():
        for p in ps:
            kids.setdefault(p, []).append(c)
    memo = {}

    def go(nid, own):
        if nid not in memo:
            memo[nid] = set(own[nid]) | {s for k in kids.get(nid, []) for s in go(k, own)}
        return memo[nid]

    return go


def test_table_is_valid():
    data = json.loads(TABLE.read_text(encoding="utf-8"))
    labels = data["labels"]
    assert labels
    for key, family in labels.items():
        assert key == key.lower().strip() and key, key
        assert family in gg.FAMILIES, (key, family)
    assert gg.families() == labels
    assert len(gg.FAMILIES) == 15


def test_every_family_has_entries():
    assert set(gg.families().values()) == set(gg.FAMILIES)


def test_live_graph_has_few_songs_in_other():
    nodes = json.loads(FIXTURE.read_text(encoding="utf-8"))["nodes"]
    parents = {n["id"]: list(n["parents"]) for n in nodes}
    own = {n["id"]: {(n["id"], i) for i in range(n["ownCount"])} for n in nodes}
    go = _reach(parents)
    reach = {nid: go(nid, own) for nid in parents}
    explicit = {n["id"]: gg.table_family(n["label"], n["tags"]) for n in nodes}
    fams = gg.umbrella_families(gg.resolve_families(explicit, parents, reach), parents, reach)
    assert all(f in (*gg.FAMILIES, "Other") for f in fams.values())
    total = sum(n["ownCount"] for n in nodes)
    other = sum(n["ownCount"] for n in nodes if fams[n["id"]] == "Other")
    assert other / total < 0.05, [(n["label"], n["ownCount"]) for n in nodes if fams[n["id"]] == "Other" and n["ownCount"]]


@pytest.mark.parametrize(
    "explicit,parents,reach,expect",
    [
        ({"a": "Rock", "b": "Pop"}, {}, {"a": {1}, "b": {2}}, {"a": "Rock", "b": "Pop"}),
        ({"a": None, "p": "Rock"}, {"a": ["p"]}, {"a": {1}, "p": {1, 2}}, {"a": "Rock", "p": "Rock"}),
        ({"a": "Jazz", "p": "Rock"}, {"a": ["p"]}, {"a": {1}, "p": {1, 2}}, {"a": "Jazz", "p": "Rock"}),
        ({"a": None, "p": "Rock", "q": "Pop"}, {"a": ["p", "q"]}, {"a": {1}, "p": {1}, "q": {1, 2, 3}}, {"a": "Pop"}),
        ({"a": None, "m": None, "p": "Blues"}, {"a": ["m"], "m": ["p"]}, {"a": {1}, "m": {1}, "p": {1}}, {"a": "Blues", "m": "Blues"}),
        ({"a": None}, {}, {"a": {1}}, {"a": "Other"}),
        ({"a": None, "b": None}, {"a": ["b"], "b": ["a"]}, {"a": {1}, "b": {1}}, {"a": "Other"}),
    ],
)
def test_resolution_order(explicit, parents, reach, expect):
    got = gg.resolve_families(explicit, parents, reach)
    for k, v in expect.items():
        assert got[k] == v


def test_table_lookup_by_label_then_tag():
    assert gg.table_family("House music") == "Electronic"
    assert gg.table_family("Zorbo", ["techno"]) == "Electronic"
    assert gg.table_family("Zorbo") is None
