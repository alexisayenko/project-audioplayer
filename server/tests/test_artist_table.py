import json

import pytest

from app import artist_table as at
from tests.test_credits_api import ODIR, on_disk, post, song
from tests.test_guest import web
from tests.test_library import H, VID, VID2, client  # noqa: F401


def test_parse_keeps_one_clean_entry_per_name():
    raw = [{"name": " Solo  Artist ", "countries": ["US", "usa", "Atlantis", "gb"]}, {"name": "solo artist"}, {"name": ""}, "x", {"countries": ["us"]}, {"name": 5}]
    assert at.parse(raw) == [{"name": "Solo Artist", "countries": ["us", "gb"]}]
    assert at.parse(None) == [] and at.parse("x") == []


def test_countries_are_capped():
    assert len(at.clean_countries(["us", "gb", "fr", "de", "it", "es", "nl"])) == at.MAX_COUNTRIES


def test_countries_for_unions_in_name_order():
    table = [{"name": "A", "countries": ["us"]}, {"name": "B", "countries": ["gb", "us"]}, {"name": "C", "countries": []}]
    assert at.countries_for(table, ["b", "A", "C", "Nobody"]) == ["gb", "us"]
    assert at.countries_for(at.index(table), ["A"]) == ["us"]


def test_set_replaces_and_fill_only_fills_empty_ones():
    table = [{"name": "A", "countries": ["us"]}]
    assert at.fill_countries(table, "a", ["de"]) is False
    assert at.fill_countries(table, "New", ["de", "xx"]) is True
    assert at.fill_countries(table, "Empty", ["xx"]) is False
    assert at.set_countries(table, "A", ["fr"])["countries"] == ["fr"]
    assert {e["name"]: e["countries"] for e in table} == {"A": ["fr"], "New": ["de"]}


def test_sync_names_adds_used_names_sorts_and_drops_unused_empty_entries():
    table = [{"name": "Gone", "countries": []}, {"name": "Kept", "countries": ["us"]}, {"name": "Zed", "countries": []}]
    songs = [{"mainArtists": ["Zed", "alpha"]}, {"mainArtists": ["ALPHA", " "]}, {"mainArtists": None}]
    at.sync_names(table, songs)
    assert [e["name"] for e in table] == ["alpha", "Kept", "Zed"]


def test_the_artist_table_follows_adds_edits_and_the_library_response(client, tmp_path):
    assert post(client, {"artist": "Solo"}, tags=["country:us"]).status_code == 201
    assert client.get("/artists", headers=H).json() == [{"name": "Solo", "countries": ["us"]}]
    lib = client.get("/library", headers=H).json()
    assert lib["artists"] == [{"name": "Solo", "countries": ["us"]}]
    assert "country:us" in lib["songs"][0]["tags"]
    assert on_disk(tmp_path)["tags"] == []
    assert json.loads((ODIR(tmp_path) / "library.json").read_text(encoding="utf-8"))["artists"] == [{"name": "Solo", "countries": ["us"]}]


def test_patch_artist_replaces_countries_and_validates(client):
    post(client, {"artist": "Solo"})
    r = client.patch("/artists/Solo", json={"countries": ["Germany", "FR", "de"]}, headers=H)
    assert r.status_code == 200 and r.json() == {"name": "Solo", "countries": ["de", "fr"]}
    assert song(client)["tags"].count("country:de") == 1
    assert client.patch("/artists/Solo", json={"countries": []}, headers=H).json()["countries"] == []
    assert client.patch("/artists/solo", json={"countries": ["us"]}, headers=H).json()["name"] == "Solo"
    bad = client.patch("/artists/Solo", json={"countries": ["Atlantis"]}, headers=H)
    assert bad.status_code == 422 and "Atlantis" in bad.json()["detail"]
    many = client.patch("/artists/Solo", json={"countries": ["us", "gb", "fr", "de", "it", "es"]}, headers=H)
    assert many.status_code == 422
    assert client.patch("/artists/Nobody", json={"countries": ["us"]}, headers=H).status_code == 404
    assert client.patch("/artists/Solo", json={"countries": ["us"]}).status_code == 401


def test_guests_read_the_artist_table_and_cannot_edit_it(client):
    post(client, {"artist": "Solo"}, tags=["country:fr"])
    guest = web()
    assert guest.get("/artists").json() == [{"name": "Solo", "countries": ["fr"]}]
    assert guest.get("/library").json()["artists"] == [{"name": "Solo", "countries": ["fr"]}]
    assert guest.patch("/artists/Solo", json={"countries": ["us"]}).status_code in (401, 403)


def test_a_country_chip_edit_on_a_song_with_two_main_artists_is_ignored(client):
    post(client, {"mainArtists": ["P", "Q"]})
    r = client.patch(f"/songs/{VID}", json={"tags": ["country:de"]}, headers=H)
    assert r.status_code == 200 and not [t for t in r.json()["tags"] if t.startswith("country:")]
    assert client.get("/artists", headers=H).json() == [{"name": "P", "countries": []}, {"name": "Q", "countries": []}]


def test_renaming_the_only_main_artist_keeps_the_old_entry_only_while_it_has_countries(client):
    post(client, {"artist": "Old"}, tags=["country:us"])
    client.patch(f"/songs/{VID}", json={"mainArtists": ["New"]}, headers=H)
    assert client.get("/artists", headers=H).json() == [{"name": "New", "countries": []}, {"name": "Old", "countries": ["us"]}]
    post(client, {"artist": "Plain"}, vid=VID2)
    client.patch(f"/songs/{VID2}", json={"mainArtists": ["Other"]}, headers=H)
    assert [e["name"] for e in client.get("/artists", headers=H).json()] == ["New", "Old", "Other"]


@pytest.mark.parametrize("vid", [VID])
def test_legacy_edit_echo_does_not_touch_albums_countries_or_decade(client, vid):
    post(client, {"mainArtists": ["Solo"], "albums": ["First", "Second"], "releaseYear": 1994}, tags=["country:us", "genre:house"])
    current = song(client)
    assert current["album"] == "First" and current["albums"] == ["First", "Second"] and "decade:90s" in current["tags"]
    echo = {"title": current["title"], "artist": current["artist"], "album": current["album"], "remixer": current["remixer"], "year": current["year"], "tags": current["tags"]}
    after = client.patch(f"/songs/{vid}", json=echo, headers=H).json()
    assert after["albums"] == ["First", "Second"] and after["releaseYear"] == 1994
    assert sorted(after["tags"]) == sorted(current["tags"])
    assert client.get("/artists", headers=H).json() == [{"name": "Solo", "countries": ["us"]}]
    changed = client.patch(f"/songs/{vid}", json={**echo, "album": "Third"}, headers=H).json()
    assert changed["albums"] == ["Third"] and changed["album"] == "Third"
    cleared = client.patch(f"/songs/{vid}", json={"album": ""}, headers=H).json()
    assert cleared["albums"] == [] and cleared["album"] is None
