import json

import pytest

from app import genre_vocab, genres_v2
from tests.test_library import H, client  # noqa: F401

NAMES = {"house", "techno", "trance", "drum and bass", "breakbeat", "hardcore techno"}


def shipped():
    return json.loads(genres_v2.FILE.read_text(encoding="utf-8"))


def doc(**over):
    base = {
        "version": 2,
        "clusters": [{"id": "edm", "name": "EDM / Dance", "colour": "#D52633"}],
        "genres": [{"id": "house", "name": "House", "level": 1, "cluster": "edm", "parents": [], "v1": "house"}],
    }
    return {**base, **over}


def genre(**over):
    return {"id": "a", "name": "A", "level": 1, "cluster": "edm", "parents": [], **over}


def test_the_shipped_file_parses_and_keeps_its_tree_invariants():
    raw = shipped()
    out = genres_v2.parse(raw, set(genre_vocab.load().entries))
    by = {g["id"]: g for g in out["genres"]}
    clusters = {c["id"] for c in out["clusters"]}
    assert len(by) == len(out["genres"]) >= 6
    assert [g["name"] for g in out["genres"]] == [g["name"] for g in raw["genres"]]
    for g in out["genres"]:
        assert g["cluster"] in clusters, g["id"]
        assert all(p in by for p in g["parents"]), g["id"]
        assert g["level"] == 1 + min((by[p]["level"] for p in g["parents"]), default=0), g["id"]
        assert g["v1"] is None or g["v1"] in genre_vocab.load().entries, g["id"]
    assert [g for g in out["genres"] if g["level"] == 1 and g["parents"]] == []
    assert all(len(c["colour"]) == 7 for c in out["clusters"])


def test_a_valid_document_parses():
    out = genres_v2.parse(doc(), NAMES)
    assert out["version"] == 2
    assert out["genres"][0]["v1"] == "house"
    assert out["genres"][0]["description"] is None


@pytest.mark.parametrize("bad, message", [
    (doc(genres=[genre(cluster="nope")]), "unknown cluster"),
    (doc(genres=[genre(v1="not a genre")]), "not in the v1 vocabulary"),
    (doc(genres=[genre(), genre()]), "duplicate id"),
    (doc(clusters=[{"id": "edm", "name": "A"}, {"id": "edm", "name": "B"}]), "duplicate id"),
    (doc(genres=[genre(parents=["missing"], level=2)]), "unknown parent"),
    (doc(genres=[genre(parents=["a"], level=2)]), "own parent"),
    (doc(genres=[genre(id="a", parents=["b"], level=2), genre(id="b", parents=["a"], level=2)]), "cycle"),
    (doc(genres=[genre(level=2)]), "does not match its parents"),
    (doc(genres=[genre(id="a"), genre(id="b", parents=["a"], level=1)]), "does not match its parents"),
    (doc(genres=[genre(id="Bad Id")]), "not a slug"),
    (doc(genres=[genre(parents="a")]), "list of unique ids"),
    (doc(genres=[genre(musicmap_url="http://x")]), "https"),
    (doc(clusters=[{"id": "edm", "name": "A", "colour": "#d52633"}]), "colour"),
    (doc(clusters=[{"id": "edm", "name": "A", "colour": "red"}]), "colour"),
    (doc(version=1), "version"),
    ([], "not a JSON object"),
])
def test_parse_rejects_bad_data(bad, message):
    with pytest.raises(ValueError, match=message):
        genres_v2.parse(bad, NAMES)


def test_a_child_with_a_matching_level_is_accepted():
    out = genres_v2.parse(doc(genres=[genre(id="a"), genre(id="b", parents=["a"], level=2)]), NAMES)
    assert [g["level"] for g in out["genres"]] == [1, 2]


def test_a_missing_file_is_an_empty_structure(tmp_path, monkeypatch):
    monkeypatch.setattr(genres_v2, "FILE", tmp_path / "none.json")
    genres_v2.reset()
    try:
        assert genres_v2.payload() == {"version": 2, "clusters": [], "genres": []}
    finally:
        genres_v2.reset()


def test_a_broken_file_raises(tmp_path, monkeypatch):
    p = tmp_path / "genres_v2.json"
    p.write_text("{nope", encoding="utf-8")
    monkeypatch.setattr(genres_v2, "FILE", p)
    genres_v2.reset()
    try:
        with pytest.raises(ValueError, match="unreadable"):
            genres_v2.payload()
    finally:
        genres_v2.reset()


def test_the_route_serves_the_shipped_genres_with_v1_descriptions_and_links(client):
    r = client.get("/genres/v2", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"version", "clusters", "genres"}
    assert [g["name"] for g in body["genres"]] == [g["name"] for g in shipped()["genres"]]
    descriptions = genre_vocab.load_descriptions()
    linked = [g for g in body["genres"] if g["v1"] in descriptions]
    assert linked
    for g in linked:
        assert g["description"] == descriptions[g["v1"]], g["name"]
    assert any(g["source_links"] for g in body["genres"])


def test_v1_routes_are_unchanged(client):
    body = client.get("/genres/vocabulary", headers=H).json()
    assert "Drum 'n' Bass" not in {g["name"] for g in body["genres"]}


CURATED = ["breakbeat", "drum-n-bass", "hardcore", "house", "techno", "trance", "psytrance", "goa-trance", "dark-psytrance", "progressive-psytrance", "forest-psytrance", "full-on-psytrance", "hi-tech-psytrance", "psycore", "nitzhonot", "suomisaundi", "zenonesque", "synthwave", "vaporwave", "chillsynth", "darksynth", "dreamwave", "outrun", "sovietwave"]


def _split():
    rows = shipped()["genres"]
    return rows, [g for g in rows if not g.get("legacy")], {g["id"]: g for g in rows}


def test_curated_genres_are_unchanged_and_unflagged():
    rows, curated, by = _split()
    assert [g["id"] for g in curated] == CURATED
    assert all("legacyParents" not in g and g["cluster"] != "legacy" for g in curated)
    assert by["goa-trance"]["parents"] == ["psytrance"] and by["trance"]["level"] == 1


def test_legacy_holding_area_covers_the_v1_vocabulary_once():
    rows, curated, by = _split()
    clusters = {c["id"]: c for c in shipped()["clusters"]}
    assert clusters["legacy"]["colour"] == "#8A8A8A"
    assert by["legacy"]["legacy"] and by["legacy"]["level"] == 1 and by["legacy"]["parents"] == []
    mapped = [g["v1"] for g in rows if g.get("v1")]
    assert len(mapped) == len(set(mapped)), "a v1 genre is mapped twice"
    assert len({g["id"] for g in rows}) == len(rows)
    v1 = genre_vocab.load().entries
    assert set(mapped) <= set(v1)
    folded = {g["v1"] for g in curated if g.get("v1")}
    missing = set(v1) - set(mapped)
    assert not missing, sorted(missing)[:10]
    added = [g for g in rows if g.get("legacy") and g["id"] != "legacy"]
    assert {g["v1"] for g in added} == set(v1) - folded
    for g in added:
        assert g["parents"] and all(p in by for p in g["parents"]), g["id"]
        assert not ("legacy" in g["parents"] and len(g["parents"]) > 1), g["id"]


def test_added_children_attach_to_their_curated_v1_parents():
    _, _, by = _split()
    entries = genre_vocab.load().entries
    by_v1 = {g["v1"]: g for g in by.values() if g.get("v1")}
    for g in by.values():
        if not g.get("legacy") or g["id"] == "legacy" or g["v1"] not in entries:
            continue
        for p in entries[g["v1"]].parents:
            target = by_v1.get(genre_vocab.lookup(p) or "")
            if target is not None and not target.get("legacy"):
                assert target["id"] in g["parents"], (g["id"], p)
    assert "trance" in by_v1["acid trance"]["parents"]


def test_v1_data_is_acyclic():
    entries = genre_vocab.load().entries

    def depth(n, seen=()):
        assert n not in seen, f"cycle at {n}"
        return 1 + max((depth(t, seen + (n,)) for p in entries[n].parents if (t := genre_vocab.lookup(p)) in entries and t != n), default=0)

    for n in entries:
        depth(n)


def test_parse_accepts_and_validates_the_legacy_fields():
    ok = doc(genres=[genre(id="a", legacy=True, legacyParents=["Others"])])
    g = genres_v2.parse(ok, NAMES)["genres"][0]
    assert g["legacy"] is True and g["legacyParents"] == ["Others"]
    assert "legacy" not in genres_v2.parse(doc(), NAMES)["genres"][0]
    for bad in ({"legacy": False}, {"legacyParents": []}, {"legacyParents": "x"}):
        with pytest.raises(ValueError):
            genres_v2.parse(doc(genres=[genre(**bad)]), NAMES)
