import json

import pytest

from app import genre_vocab, genres_v2
from tests.test_library import H, client  # noqa: F401

NAMES = {"house", "techno", "trance", "drum and bass", "breakbeat", "hardcore techno"}
SIX = ["Breakbeat", "Drum 'n' Bass", "Hardcore", "House", "Techno", "Trance"]
PSY_CHILDREN = ["Dark Psytrance", "Progressive Psytrance", "Forest Psytrance", "Full-On Psytrance", "Hi-Tech Psytrance"]
ALL = SIX + ["Psytrance", "Goa Trance"] + PSY_CHILDREN + ["Psycore"]


def doc(**over):
    base = {
        "version": 2,
        "clusters": [{"id": "edm", "name": "EDM / Dance", "colour": "#D52633"}],
        "genres": [{"id": "house", "name": "House", "level": 1, "cluster": "edm", "parents": [], "v1": "house"}],
    }
    return {**base, **over}


def genre(**over):
    return {"id": "a", "name": "A", "level": 1, "cluster": "edm", "parents": [], **over}


def test_the_shipped_file_has_the_six_super_genres_psytrance_and_its_six_children():
    out = genres_v2.parse(json.loads(genres_v2.FILE.read_text(encoding="utf-8")), set(genre_vocab.load().entries))
    assert [g["name"] for g in out["genres"]] == ALL
    by = {g["id"]: g for g in out["genres"]}
    assert [g["level"] for g in out["genres"]] == [1] * 6 + [2] + [3] * 5 + [4] * 2
    assert all(g["parents"] == [] for g in out["genres"][:6]) and all(g["cluster"] == "edm-dance" for g in out["genres"])
    assert by["psytrance"]["parents"] == ["trance"] and by["goa-trance"]["parents"] == ["psytrance"]
    assert all(by[i]["parents"] == ["psytrance"] for i in ["dark-psytrance", "progressive-psytrance", "forest-psytrance", "full-on-psytrance"])
    assert by["dark-psytrance"]["synonyms"] == ["darkpsy", "dark psychedelic trance", "horror trance"] and by["psycore"]["parents"] == ["dark-psytrance"] and by["hi-tech-psytrance"]["parents"] == ["dark-psytrance"]
    assert by["psytrance"]["synonyms"] == ["psychedelic trance", "psy-trance"] and by["goa-trance"]["synonyms"] == ["goa"]
    assert [c["name"] for c in out["clusters"]] == ["EDM / Dance"]
    assert out["clusters"][0]["colour"] == "#D52633"
    assert {g["v1"] for g in out["genres"]} == NAMES | {"psytrance", "goa trance", "dark psytrance", "progressive psytrance", "forest psytrance", "full-on psytrance", "hi-tech psytrance", "psycore"}


def test_a_valid_document_parses():
    out = genres_v2.parse(doc(), NAMES)
    assert out["version"] == 2 and out["genres"][0]["v1"] == "house" and out["genres"][0]["description"] is None


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


def test_the_route_needs_a_sign_in(client):
    assert client.get("/genres/v2").status_code == 401


def test_the_route_serves_the_six_with_v1_descriptions_and_links(client):
    r = client.get("/genres/v2", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"version", "clusters", "genres"}
    by = {g["name"]: g for g in body["genres"]}
    assert list(by) == ALL
    house = by["House"]
    assert house["description"] == genre_vocab.load_descriptions()["house"]
    assert house["v1"] == "house" and house["source_links"]
    assert by["Drum 'n' Bass"]["v1"] == "drum and bass" and by["Hardcore"]["v1"] == "hardcore techno"
    assert by["Hardcore"]["description"] is None


def test_v1_routes_are_unchanged(client):
    body = client.get("/genres/vocabulary", headers=H).json()
    assert "Drum 'n' Bass" not in {g["name"] for g in body["genres"]}
