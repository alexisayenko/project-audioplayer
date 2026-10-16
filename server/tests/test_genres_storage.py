import json

import pytest

from app import library, migrate_model2
from tests.test_credits_api import ODIR, on_disk, post, song
from tests.test_library import H, VID, client  # noqa: F401


def test_genres_are_stored_bare_and_the_prefixed_view_is_derived(client, tmp_path):
    post(client, {"artist": "Solo"}, genres=["house", "Techno"], tags=["x", "country:us", "decade:90s", "lang:en"])
    stored = on_disk(tmp_path)
    assert stored["genres"] == ["house", "techno"] and stored["tags"] == ["x"]
    got = song(client)
    assert got["genres"] == ["house", "techno"]
    assert got["tags"] == ["genre:house", "genre:techno", "x", "decade:80s", "country:us"]


def test_a_song_without_leftover_tags_stores_no_tags_key(client, tmp_path):
    post(client, genres=["house"])
    assert "tags" not in on_disk(tmp_path) and on_disk(tmp_path)["genres"] == ["house"]


def test_patch_accepts_genres_and_keeps_other_tags_and_countries(client, tmp_path):
    post(client, {"artist": "Solo"}, tags=["genre:house", "x", "country:us"])
    got = client.patch(f"/songs/{VID}", json={"genres": ["trance", "Techno"]}, headers=H).json()
    assert got["genres"] == ["trance", "techno"]
    assert got["tags"] == ["genre:trance", "genre:techno", "x", "decade:80s", "country:us"]
    assert on_disk(tmp_path)["genres"] == ["trance", "techno"]
    legacy = client.patch(f"/songs/{VID}", json={"tags": ["genre:house", "x", "country:us"]}, headers=H).json()
    assert legacy["genres"] == ["house"] and "country:us" in legacy["tags"]


def test_patch_genres_win_over_the_genre_tags_of_the_same_request(client):
    post(client, {"artist": "Solo"})
    got = client.patch(f"/songs/{VID}", json={"genres": ["house"], "tags": ["genre:trance", "y"]}, headers=H).json()
    assert got["genres"] == ["house"] and "y" in got["tags"]


def test_an_unknown_genre_in_genres_is_refused(client):
    post(client, {"artist": "Solo"})
    r = client.patch(f"/songs/{VID}", json={"genres": ["housee"]}, headers=H)
    assert r.status_code == 422 and r.json()["error"] == "unknown_genre"


def test_the_loader_reads_both_forms_and_save_writes_the_bare_one(tmp_path):
    path = tmp_path / "library.json"
    path.write_text(json.dumps({"songs": [
        {"id": "a", "title": "A", "genres": ["house"], "tags": ["x"]},
        {"id": "b", "title": "B", "tags": ["genre:trance", "x"]},
    ]}))
    songs = library.load(path)
    assert [s["tags"] for s in songs] == [["genre:house", "x"], ["genre:trance", "x"]]
    library.save(path, songs)
    saved = json.loads(path.read_text())["songs"]
    assert [(s["genres"], s["tags"]) for s in saved] == [(["house"], ["x"]), (["trance"], ["x"])]
    assert songs[0]["tags"] == ["genre:house", "x"]


@pytest.mark.parametrize("raw, expect", [
    ({"id": "a", "mainArtists": [], "genres": ["house"]}, True),
    ({"id": "a", "mainArtists": [], "tags": ["genre:house"]}, False),
    ({"id": "a", "mainArtists": [], "tags": ["x"]}, True),
])
def test_a_file_with_prefixed_stored_tags_is_not_yet_model_2(raw, expect):
    assert migrate_model2.is_model2({"settings": {"credits_schema": 2}, "songs": [raw]}) is expect


def test_the_migration_stores_bare_genres_and_lists_leftovers():
    old = {"songs": [
        {"id": "a", "title": "A", "artists": ["X"], "featured": [], "released": 2000, "tags": ["genre:house", "decade:00s", "80s", "genre:Deep House"]},
        {"id": "b", "title": "B", "artists": ["X"], "featured": [], "released": 2000, "tags": ["genre:trance"]},
        {"id": "c", "title": "C", "artists": ["X"], "featured": [], "released": 2000},
    ]}
    doc, report = migrate_model2.convert(old)
    a, b, c = doc["songs"]
    assert (a["genres"], a["tags"]) == (["house", "Deep House"], ["80s"])
    assert b["genres"] == ["trance"] and "tags" not in b
    assert "genres" not in c and "tags" not in c
    assert report["review"]["leftover_tags"] == [{"id": "a", "tags": ["80s"]}]
    assert report["ok"] is True
    again, _ = migrate_model2.convert(doc)
    assert again["songs"] == doc["songs"]
