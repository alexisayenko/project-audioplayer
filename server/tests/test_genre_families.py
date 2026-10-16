import json
from pathlib import Path

import pytest

from app import genre_graph as gg, genre_vocab

FIXTURE = Path(__file__).parent / "fixtures" / "genre_graph_live.json"


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


def test_families_come_from_the_vocabulary_files():
    table = gg.families()
    assert table
    for name, family in table.items():
        assert name == name.lower().strip() and name, name
        assert family in gg.FAMILIES, (name, family)
    assert table == {n: e.family for n, e in genre_vocab.load().entries.items()}
    assert len(gg.FAMILIES) == 15
    assert not (Path(gg.__file__).resolve().parent.parent / "data" / "genre_families.json").exists()


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


@pytest.mark.parametrize("label,family", [("disco", "Funk / Soul"), ("new wave", "Rock"), ("acid jazz", "Jazz"), ("trip hop", "Electronic")])
def test_reviewed_overrides_win_over_the_order_rule(label, family):
    assert gg.table_family(label) == family


KEPT = {
    "neurofunk": "Electronic", "liquid funk": "Electronic", "techstep": "Electronic", "melodic techno": "Electronic", "melodic house": "Electronic",
    "big room house": "Electronic", "darksynth": "Electronic", "dreamwave": "Electronic", "raggacore": "Electronic", "dance-rock": "Rock",
    "psybient": "Electronic", "electronica": "Electronic", "electronic": "Electronic", "dance": "Electronic", "experimental": "Electronic",
    "singer-songwriter": "Folk, World, & Country", "estrada": "Pop", "shock rock": "Rock", "dark metal": "Rock", "epic": "Stage & Screen",
    "trailer": "Stage & Screen", "chillwave": "Electronic", "darkwave": "Electronic", "nu-nrg": "Electronic", "uplifting trance": "Electronic",
}


@pytest.mark.parametrize("tag,family", sorted(KEPT.items()))
def test_kept_subgenres_have_a_family_entry(tag, family):
    from app import genre_filter as gf

    assert gf.canonical(tag) == tag
    assert gg.table_family(tag) == family
    assert gg.table_family(f"{tag} music", [tag]) == family


def test_alias_and_retag_targets_have_a_family():
    from app import genre_filter as gf

    want = {"drum and bass": "Electronic", "electronic dance": "Electronic", "europop": "Pop", "euro disco": "Electronic", "euro house": "Electronic",
            "electropop": "Electronic", "progressive house": "Electronic", "trap": "Hip Hop", "disco": "Funk / Soul", "folk": "Folk, World, & Country",
            "swing": "Jazz", "classical": "Classical", "psychedelic rock": "Rock", "pop": "Pop", "modern classical": "Classical",
            "alternative rock": "Rock", "indie rock": "Rock", "progressive rock": "Rock"}
    targets = {*gf.ALIASES.values(), *gf.RETAGS.values(), gf.PROGRESSIVE_ELECTRONIC}
    assert set(want) <= targets
    for target in targets:
        assert gg.table_family(target) is not None, target
    for target, family in want.items():
        assert gg.table_family(target) == family, target


def test_kept_subgenres_in_the_live_graph_have_wikidata_parents():
    nodes = json.loads(FIXTURE.read_text(encoding="utf-8"))["nodes"]
    by_tag = {t: n for n in nodes for t in n["tags"]}
    roots = {"electronic", "dance", "experimental"}
    for tag in KEPT:
        node = by_tag.get(tag)
        if tag in {"darkwave", "nu-nrg"}:
            continue
        assert node is not None, tag
        assert bool(node["parents"]) == (tag not in roots), tag
    assert gg.validate_manual(gg._json_table()) == []


def test_nu_nrg_and_uplifting_trance_have_manual_parents():
    gg._manual = None
    table = gg.manual_parents()
    assert table["nu-nrg"] == ["hard trance"] and table["uplifting trance"] == ["trance"]
    assert gg.table_family("nu-nrg") == "Electronic" == gg.table_family("uplifting trance")
