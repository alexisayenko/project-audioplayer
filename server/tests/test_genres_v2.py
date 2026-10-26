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
