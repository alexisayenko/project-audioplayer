import time

import pytest

from app import genre_graph as gg
from tests.test_library import H, VID, client  # noqa: F401
from tests.test_users import ALICE, BOB, add, key, multi, who  # noqa: F401

GENRE = "Q188451"

# qid -> (label, genre?, parents, related)
WD = {
    "Q100": ("electronic music", True, ["Q500"], []),
    "Q500": ("music", False, [], []),
    "Q102": ("pop music", True, [], []),
    "Q101": ("synthpop", True, ["Q100", "Q102"], ["Q105"]),
    "Q103": ("darksynth", True, ["Q101"], []),
    "Q104": ("chillsynth", True, ["Q101"], []),
    "Q105": ("new wave", True, ["Q102"], []),
    "Q110": ("a-genre", True, ["Q111"], []),
    "Q111": ("b-genre", True, ["Q110", "Q100"], []),
    "Q300": ("house", False, [], []),
    "Q301": ("house music", True, ["Q100"], []),
    "Q401": ("lvl0", True, ["Q402"], []),
    "Q402": ("lvl1", True, ["Q403"], []),
    "Q403": ("lvl2", True, ["Q404"], []),
    "Q404": ("lvl3", True, ["Q405"], []),
    "Q405": ("lvl4", True, ["Q406"], []),
    "Q406": ("lvl5", True, ["Q407"], []),
    "Q407": ("lvl6", True, [], []),
}
ALIASES = {"house": ["Q300", "Q301"]}


def claim(qid):
    return {"mainsnak": {"datavalue": {"value": {"id": qid}}}}


def entity(qid):
    label, genre, parents, related = WD[qid]
    claims = {"P279": [claim(p) for p in parents], "P737": [claim(r) for r in related]}
    if genre:
        claims["P31"] = [claim(GENRE)]
    sl = {"enwiki": {"title": "Dark synth"}} if qid == "Q103" else {}
    return {"sitelinks": sl, "labels": {"en": {"value": label}}, "descriptions": {"en": {"value": "a thing"}}, "claims": claims}


@pytest.fixture
def wd(tmp_path, monkeypatch):
    calls = []

    def fake(params):
        calls.append(params)
        if params["action"] == "wbsearchentities":
            term = params["search"]
            hits = [{"id": q, "label": v[0], "match": {"type": "label", "text": v[0]}} for q, v in WD.items() if v[0] == term]
            hits += [{"id": q, "label": WD[q][0], "match": {"type": "alias", "text": term}} for q in ALIASES.get(term, [])]
            return {"search": hits}
        ids = params["ids"].split("|")
        assert len(ids) <= gg.BATCH
        return {"entities": {i: entity(i) for i in ids if i in WD}}

    monkeypatch.setattr(gg, "_api", fake)
    monkeypatch.setattr(gg, "INLINE", True)
    monkeypatch.setattr(gg, "_down_until", 0.0)
    monkeypatch.setattr(gg, "_running", False)
    gg._mem.clear()
    fake.calls = calls
    fake.path = tmp_path / "ontology.json"
    return fake


def songs(*pairs):
    return [{"id": sid, "tags": [f"genre:{g}" for g in genres]} for sid, genres in pairs]


def by_label(g):
    return {n["label"]: n for n in g["nodes"]}


def boom(params):
    raise OSError("offline")


def test_multi_parent_family_and_edges(wd):
    g = gg.graph(songs(("s1", ["Synthpop"])), wd.path)
    n = by_label(g)
    assert set(n) == {"synthpop", "electronic music", "pop music"}
    sp = n["synthpop"]
    assert sorted(sp["parents"]) == sorted([n["electronic music"]["id"], n["pop music"]["id"]])
    assert sp["family"] == "Electronic"
    assert sp["qid"] == "Q101"
    assert n["pop music"]["family"] == "Pop"
    assert {"source": sp["id"], "target": n["pop music"]["id"], "kind": "parent"} in g["edges"]
    assert g["ontology"] is True
    assert g["pending"] is False


def test_related_edge_only_between_present_nodes(wd):
    g = gg.graph(songs(("s1", ["synthpop"]), ("s2", ["new wave"])), wd.path)
    n = by_label(g)
    pair = {n["synthpop"]["id"], n["new wave"]["id"]}
    assert [e["kind"] for e in g["edges"] if {e["source"], e["target"]} == pair] == ["related"]
    solo = gg.graph(songs(("s1", ["synthpop"])), wd.path)
    assert not [e for e in solo["edges"] if e["kind"] == "related"]


def test_counts_do_not_double_count(wd):
    g = gg.graph(songs(("s1", ["darksynth", "chillsynth"]), ("s2", ["darksynth"]), ("s3", ["house music"])), wd.path)
    n = by_label(g)
    assert n["darksynth"]["count"] == 2
    assert n["chillsynth"]["count"] == 1
    assert n["synthpop"]["count"] == 2
    assert n["synthpop"]["ownCount"] == 0
    assert n["electronic music"]["count"] == 3
    assert n["pop music"]["count"] == 2


def test_cycle_is_broken(wd):
    g = gg.graph(songs(("s1", ["a-genre"])), wd.path)
    ids = {n["id"]: n["parents"] for n in g["nodes"]}
    assert len(ids) == 3

    def walk(i, path):
        assert i not in path
        for p in ids[i]:
            walk(p, path | {i})

    for i in ids:
        walk(i, frozenset())


def test_unresolved_tag_is_a_loose_node(wd):
    g = gg.graph(songs(("s1", ["zzz nothing"]), ("s2", ["synthpop"])), wd.path)
    z = by_label(g)["zzz nothing"]
    assert z["qid"] is None
    assert z["family"] == "Other"
    assert z["parents"] == []
    assert z["count"] == 1
    assert g["ontology"] is True


def test_alias_resolves_and_non_genre_is_rejected(wd):
    g = gg.graph(songs(("s1", ["house"])), wd.path)
    assert by_label(g)["house music"]["qid"] == "Q301"
    assert "house" not in by_label(g)


def test_levels_and_node_cap(wd, monkeypatch):
    g = gg.graph(songs(("s1", ["lvl0"])), wd.path)
    assert sorted(n["label"] for n in g["nodes"]) == ["lvl0", "lvl1", "lvl2", "lvl3", "lvl4"]
    monkeypatch.setattr(gg, "MAX_NODES", 3)
    g = gg.graph(songs(("s1", ["lvl0"])), wd.path)
    assert sorted(n["label"] for n in g["nodes"]) == ["lvl0", "lvl1", "lvl2"]
    ids = {n["id"] for n in g["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in g["edges"])
    assert all(p in ids for n in g["nodes"] for p in n["parents"])


def test_cache_reuse_offline_and_persistence(wd, monkeypatch):
    first = gg.graph(songs(("s1", ["synthpop"])), wd.path)
    assert wd.calls
    n = len(wd.calls)
    assert gg.graph(songs(("s1", ["synthpop"])), wd.path) == first
    assert len(wd.calls) == n
    gg._mem.clear()
    assert wd.path.exists()
    monkeypatch.setattr(gg, "_api", boom)
    assert gg.graph(songs(("s1", ["synthpop"])), wd.path) == first


def test_stale_entries_refresh_but_failure_keeps_cache(wd, monkeypatch):
    first = gg.graph(songs(("s1", ["synthpop"])), wd.path)
    real = time.time
    monkeypatch.setattr(gg.time, "time", lambda: real() + gg.TTL + 10)
    monkeypatch.setattr(gg, "_api", boom)
    again = gg.graph(songs(("s1", ["synthpop"])), wd.path)
    assert (again["nodes"], again["edges"]) == (first["nodes"], first["edges"])
    assert again["pending"] is False


def test_network_failure_degrades_to_loose_nodes(wd, monkeypatch):
    monkeypatch.setattr(gg, "_api", boom)
    g = gg.graph(songs(("s1", ["synthpop"])), wd.path)
    assert [n["qid"] for n in g["nodes"]] == [None]
    assert g["ontology"] is False
    assert g["pending"] is False


def test_pending_while_fetching_in_background(wd, monkeypatch):
    started = []

    class FakeThread:
        def __init__(self, target, args, daemon):
            started.append((target, args))

        def start(self):
            pass

    monkeypatch.setattr(gg, "INLINE", False)
    monkeypatch.setattr(gg.threading, "Thread", FakeThread)
    g = gg.graph(songs(("s1", ["synthpop"])), wd.path)
    assert started
    assert g["pending"] is True
    assert g["ontology"] is False
    gg.graph(songs(("s1", ["synthpop"])), wd.path)
    assert len(started) == 1


def test_batches_of_fifty(wd):
    names = [f"Q{9000 + i}" for i in range(120)]
    for q in names:
        WD[q] = (f"g{q}", True, [], [])
    try:
        gg._fetch_entities(gg.load_cache(wd.path), names)
        sizes = [len(c["ids"].split("|")) for c in wd.calls if c["action"] == "wbgetentities"]
        assert sizes == [50, 50, 20]
    finally:
        for q in names:
            del WD[q]


def test_endpoint_isolated_per_user_and_cache_has_no_user_data(multi, wd, monkeypatch, tmp_path):
    a, b = who(multi, ALICE), who(multi, BOB)
    body = {"url": f"https://youtu.be/{VID}", "metadata": {"title": "Private Title"}, "tags": ["genre:synthpop"]}
    assert multi.post("/songs", json=body, headers=a).status_code == 202
    ga = multi.get("/genres/graph", headers=a).json()
    gb = multi.get("/genres/graph", headers=b).json()
    assert {n["label"] for n in ga["nodes"]} >= {"synthpop", "electronic music"}
    assert gb["nodes"] == []
    assert gb["edges"] == []
    cache_text = (tmp_path / "genre-ontology.json").read_text(encoding="utf-8")
    assert VID not in cache_text
    assert "Private Title" not in cache_text
    assert "alice" not in cache_text
    assert multi.get("/genres/graph").status_code == 401


def test_nodes_carry_the_user_tags_that_resolve_to_them(wd):
    g = gg.graph(songs(("s1", ["House"]), ("s2", ["house music"])), wd.path)
    n = by_label(g)
    assert n["house music"]["tags"] == ["house"]
    assert n["electronic music"]["tags"] == []


# None: a Wikidata label outside the vocabulary, its family comes from its ancestors (GEN-038)
ROOT_CASES = [
    ("electronic dance music", "Electronic"), ("house music", "Electronic"), ("dance music", "Electronic"), ("club/dance music", None),
    ("progressive house", "Electronic"), ("drum and bass", "Electronic"), ("tech house", "Electronic"), ("future garage", None),
    ("rock music", "Rock"), ("pop rock", "Rock"), ("alternative rock", "Rock"), ("pop music", "Pop"), ("dance-pop", "Pop"), ("indie pop", "Pop"),
    ("k-pop", "Pop"), ("hip hop music", "Hip Hop"), ("trip hop", "Electronic"), ("fusion", "Jazz"), ("northern soul", None),
    ("baroque music", "Classical"), ("romantic music", "Classical"), ("ska punk", None), ("latin pop", "Latin"), ("mambo", "Latin"),
    ("delta blues", "Blues"), ("country rock", "Folk, World, & Country"), ("film score", "Stage & Screen"), ("spoken word", "Non-Music"),
    ("lullaby", "Children's"), ("marches", "Brass & Military"), ("music of europe", None), ("regional music", None),
    ("alternative music", "Rock"),
]


@pytest.mark.parametrize("label,family", ROOT_CASES)
def test_common_roots_resolve_to_discogs_families(label, family):
    assert gg.table_family(label) == family


def test_user_genres_merge_aliases():
    songs = [{"id": "a", "tags": ["genre:electronic"]}, {"id": "b", "tags": ["genre:electronic music"]}, {"id": "c", "tags": ["genre:house music"]}]
    own = gg.user_genres(songs)
    assert own == {"electronic": {"a", "b"}, "house": {"c"}}


def test_user_genres_apply_retags_with_the_song_context():
    songs = [{"id": "a", "tags": ["genre:progressive", "genre:house"]}, {"id": "b", "tags": ["genre:progressive"]}, {"id": "c", "tags": ["genre:dnb", "genre:drum & bass"]}]
    assert gg.user_genres(songs) == {"progressive house": {"a"}, "house": {"a"}, "progressive rock": {"b"}, "drum and bass": {"c"}}


def test_bare_and_music_tags_make_one_connected_node(wd):
    g = gg.graph(songs(("s1", ["electronic"]), ("s2", ["electronic music"]), ("s3", ["house"]), ("s4", ["house music"])), wd.path)
    n = by_label(g)
    assert n["electronic music"]["qid"] == "Q100"
    assert n["electronic music"]["ownCount"] == 2
    assert "electronic" not in n and "house" not in n
    assert n["house music"]["ownCount"] == 2
    assert n["house music"]["parents"] == [n["electronic music"]["id"]]


def test_euroda_merges_into_the_eurodance_node(wd):
    g = gg.graph(songs(("s1", ["euroda"]), ("s2", ["Eurodance"]), ("s3", ["russian eurodance"])), wd.path)
    nodes = [n for n in g["nodes"] if "eurodance" in n["label"].lower() or "euroda" in n["label"].lower()]
    assert len(nodes) == 1
    assert nodes[0]["tags"] == ["eurodance"]
    assert nodes[0]["count"] == 3


def test_umbrella_root_takes_majority_child_family():
    fam = {"u": "Other", "a": "Pop", "b": "Pop", "c": "Rock"}
    parents = {"u": [], "a": ["u"], "b": ["u"], "c": ["u"]}
    reach = {"u": {1, 2, 3, 4}, "a": {1, 2}, "b": {2, 3}, "c": {4}}
    assert gg.umbrella_families(fam, parents, reach)["u"] == "Pop"


def test_umbrella_root_without_clear_majority_or_with_parent_stays_other():
    fam = {"u": "Other", "a": "Pop", "c": "Rock", "x": "Other", "y": "Pop"}
    parents = {"u": [], "a": ["u"], "c": ["u"], "x": ["u"], "y": ["x"]}
    reach = {"u": {1, 2, 3, 4}, "a": {1}, "c": {2}, "x": {3, 4}, "y": {3}}
    assert gg.umbrella_families(fam, parents, reach) == fam


def test_wikipedia_url_from_enwiki_sitelink(wd):
    g = gg.graph(songs(("a", ["darksynth"]), ("b", ["chillsynth"])), wd.path)
    n = by_label(g)
    assert n["darksynth"]["wikipedia"] == "https://en.wikipedia.org/wiki/Dark_synth"
    assert n["chillsynth"]["wikipedia"] is None


def test_entity_cached_without_wp_is_refetched(wd):
    gg.graph(songs(("a", ["darksynth"])), wd.path)
    assert any("sitelinks" in c.get("props", "") for c in wd.calls if c["action"] == "wbgetentities")
    assert gg._ent_fresh({"at": time.time(), "wp": ""})
    assert not gg._ent_fresh({"at": time.time()})


def manual(monkeypatch, table):
    monkeypatch.setattr(gg, "_manual", table)


def parents_of(g, label):
    ids = {n["id"]: n["label"] for n in g["nodes"]}
    return sorted(ids[p] for p in by_label(g)[label]["parents"])


def test_manual_parent_edge_added_and_marked(wd, monkeypatch):
    manual(monkeypatch, {"chillsynth": ["house music"], "darksynth": ["pop music"]})
    g = gg.graph(songs(("s1", ["chillsynth", "darksynth", "house music", "pop music"])), wd.path)
    assert "house music" in parents_of(g, "chillsynth")
    assert "pop music" in parents_of(g, "darksynth")
    man = [e for e in g["edges"] if e.get("origin") == "manual"]
    assert len(man) == 2 and all(e["kind"] == "parent" for e in man)
    assert not any(e.get("origin") for e in g["edges"] if e not in man)


def test_manual_parent_skipped_when_a_node_is_missing(wd, monkeypatch):
    manual(monkeypatch, {"chillsynth": ["house music"], "nothing here": ["pop music"]})
    g = gg.graph(songs(("s1", ["chillsynth"])), wd.path)
    assert "house music" not in parents_of(g, "chillsynth")
    assert not any(e.get("origin") for e in g["edges"])


def test_manual_parent_skipped_when_it_would_make_a_cycle(wd, monkeypatch):
    manual(monkeypatch, {"electronic music": ["chillsynth"], "chillsynth": ["chillsynth"]})
    g = gg.graph(songs(("s1", ["chillsynth"])), wd.path)
    assert "chillsynth" not in parents_of(g, "electronic music")
    assert "chillsynth" not in parents_of(g, "chillsynth")


def test_shipped_manual_table_is_valid():
    gg._manual = None
    assert gg.validate_manual(gg._json_table()) == []
    assert "pop punk" in gg.manual_parents()


def test_validate_manual_flags_problems():
    bad = gg.validate_manual({"_c": "x", "A": ["b"], "b": ["b"], "c": ["d"], "d": ["c"], "e": "f"})
    text = " ".join(bad)
    assert "not a lowercase" in text and "parent of itself" in text and "cycle" in text and "must be a list" in text


def test_missing_manual_file_is_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(gg, "_manual", None)
    monkeypatch.setattr(gg, "_PARENTS_FILE", tmp_path / "none.json")
    assert gg.manual_parents() == {}
    monkeypatch.setattr(gg, "_manual", None)
