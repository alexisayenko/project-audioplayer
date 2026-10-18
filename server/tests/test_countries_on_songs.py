import json

from app import metafill
from tests.test_credits_api import ODIR, on_disk, post, song
from tests.test_guest import web
from tests.test_library import H, VID, VID2, client  # noqa: F401


def countries(tags):
    return [t for t in tags if t.startswith("country:")]


def stored(tmp_path):
    return json.loads((ODIR(tmp_path) / "library.json").read_text(encoding="utf-8"))


def test_country_tags_are_stored_on_the_song_and_there_is_no_artist_table(client, tmp_path):
    assert post(client, {"artist": "Solo"}, tags=["country:us", "country:Germany"]).status_code == 201
    assert on_disk(tmp_path)["tags"] == ["country:us", "country:de"]
    doc = stored(tmp_path)
    assert "artists" not in doc
    assert doc["settings"]["credits_schema"] == 3
    lib = client.get("/library", headers=H).json()
    assert "artists" not in lib
    assert lib["credits_schema"] == 3
    assert countries(lib["songs"][0]["tags"]) == ["country:us", "country:de"]


def test_the_artist_endpoints_are_gone(client):
    post(client, {"artist": "Solo"})
    assert client.get("/artists", headers=H).status_code == 404
    assert client.patch("/artists/Solo", json={"countries": ["us"]}, headers=H).status_code in (404, 405)


def test_guests_see_the_country_tags_of_songs_and_no_artist_table(client):
    post(client, {"artist": "Solo"}, tags=["country:fr"])
    body = web().get("/library").json()
    assert "artists" not in body
    assert "country:fr" in body["songs"][0]["tags"]
    assert web().get("/artists").status_code in (401, 403, 404)


def test_a_song_keeps_as_many_countries_as_it_has_and_more_can_be_added(client):
    many = ["country:us", "country:gb", "country:fr", "country:de", "country:it", "country:es", "country:nl"]
    post(client, {"artist": "Solo"}, tags=many)
    assert countries(song(client)["tags"]) == many
    r = client.patch(f"/songs/{VID}", json={"tags": [*many, "country:jp", "country:su"]}, headers=H)
    assert r.status_code == 200
    assert countries(r.json()["tags"]) == [*many, "country:jp", "country:su"]


def test_a_song_with_several_main_artists_takes_country_tags_like_any_tag(client):
    post(client, {"mainArtists": ["P", "Q"]})
    r = client.patch(f"/songs/{VID}", json={"tags": ["country:de", "country:fr"]}, headers=H)
    assert r.status_code == 200
    assert countries(r.json()["tags"]) == ["country:de", "country:fr"]
    r = client.patch(f"/songs/{VID}", json={"tags": []}, headers=H)
    assert r.status_code == 200
    assert countries(r.json()["tags"]) == []


def test_patch_replaces_the_countries_and_the_echo_changes_nothing(client):
    post(client, {"artist": "Solo"}, tags=["country:us"])
    echo = song(client)["tags"]
    assert client.patch(f"/songs/{VID}", json={"tags": echo}, headers=H).status_code == 200
    assert countries(song(client)["tags"]) == ["country:us"]
    kept = [t for t in echo if not t.startswith("country:")]
    r = client.patch(f"/songs/{VID}", json={"tags": [*kept, "country:gb", "country:fr"]}, headers=H)
    assert countries(r.json()["tags"]) == ["country:gb", "country:fr"]
    assert countries(client.patch(f"/songs/{VID}", json={"tags": kept}, headers=H).json()["tags"]) == []


def test_split_merge_and_rename_keep_the_tags_the_client_sent(client):
    post(client, {"mainArtists": ["Mason Vs. Princess Superstar"]}, tags=["country:nl", "country:us"])
    shown = song(client)["tags"]
    r = client.patch(f"/songs/{VID}", json={"mainArtists": ["Mason", "Princess Superstar"], "tags": shown}, headers=H)
    assert r.status_code == 200
    assert r.json()["mainArtists"] == ["Mason", "Princess Superstar"]
    assert countries(r.json()["tags"]) == ["country:nl", "country:us"]
    r = client.patch(f"/songs/{VID}", json={"mainArtists": ["Merged"], "tags": r.json()["tags"]}, headers=H)
    assert r.status_code == 200
    assert countries(r.json()["tags"]) == ["country:nl", "country:us"]
    r = client.patch(f"/songs/{VID}", json={"mainArtists": ["Renamed"], "tags": [*r.json()["tags"], "country:it"]}, headers=H)
    assert countries(r.json()["tags"]) == ["country:nl", "country:us", "country:it"]
    assert countries(song(client)["tags"]) == ["country:nl", "country:us", "country:it"]


def test_a_title_edit_without_tags_keeps_the_countries(client):
    post(client, {"mainArtists": ["P", "Q"]}, tags=["country:fr"])
    r = client.patch(f"/songs/{VID}", json={"title": "Renamed"}, headers=H)
    assert r.status_code == 200
    assert countries(r.json()["tags"]) == ["country:fr"]


def test_legacy_edit_echo_does_not_touch_albums_countries_or_decade(client, tmp_path):
    post(client, {"mainArtists": ["Solo"], "albums": ["First", "Second"], "releaseYear": 1994}, tags=["country:us", "genre:house"])
    current = song(client)
    assert current["album"] == "First"
    assert current["albums"] == ["First", "Second"]
    assert "decade:90s" in current["tags"]
    echo = {"title": current["title"], "artist": current["artist"], "album": current["album"], "remixer": current["remixer"], "year": current["year"], "tags": current["tags"]}
    after = client.patch(f"/songs/{VID}", json=echo, headers=H).json()
    assert after["albums"] == ["First", "Second"]
    assert after["releaseYear"] == 1994
    assert sorted(after["tags"]) == sorted(current["tags"])
    assert on_disk(tmp_path)["tags"] == ["country:us"]


def test_decade_and_lang_are_never_stored(client, tmp_path):
    post(client, {"artist": "Solo", "releaseYear": 1994}, tags=["country:us", "decade:80s", "lang:en", "x"])
    assert on_disk(tmp_path)["tags"] == ["country:us", "x"]
    assert "decade:90s" in song(client)["tags"]


def test_unknown_countries_are_still_refused_and_the_historical_su_is_accepted(client):
    assert post(client, {"artist": "Solo"}, tags=["country:Atlantis"]).status_code == 422
    assert post(client, {"artist": "Solo"}, tags=["country:USSR"]).status_code == 201
    assert countries(song(client)["tags"]) == ["country:su"]
    assert client.patch(f"/songs/{VID}", json={"tags": ["country:Atlantis"]}, headers=H).status_code == 422


def test_the_tag_counts_include_country_tags(client):
    post(client, {"artist": "Solo"}, tags=["country:us"])
    post(client, {"artist": "Other"}, vid=VID2, tags=["country:us", "country:gb"])
    counts = {e["tag"]: e["count"] for e in client.get("/tags", headers=H).json()}
    assert counts["country:us"] == 2
    assert counts["country:gb"] == 1


def test_an_unmigrated_artist_table_is_carried_along_untouched_and_keeps_the_old_stamp(client, tmp_path):
    post(client, {"artist": "Solo"})
    path = ODIR(tmp_path) / "library.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["settings"]["credits_schema"] = 2
    doc["artists"] = [{"name": "Solo", "countries": ["de"]}]
    path.write_text(json.dumps(doc), encoding="utf-8")
    assert client.patch(f"/songs/{VID}", json={"title": "Changed"}, headers=H).status_code == 200
    after = json.loads(path.read_text(encoding="utf-8"))
    assert after["artists"] == [{"name": "Solo", "countries": ["de"]}]
    assert after["settings"]["credits_schema"] == 2
    assert "artists" not in client.get("/library", headers=H).json()


class TestBackfill:
    def song(self, tags=None):
        return {"id": "a", "title": "T", "mainArtists": ["Solo"], "tags": tags or []}

    def test_a_song_without_a_country_gets_the_one_the_lookup_found(self):
        s = self.song()
        assert metafill.apply(s, {"tags": ["country:us", "country:gb", "genre:house"]}) is True
        assert [t for t in s["tags"] if t.startswith("country:")] == ["country:us"]

    def test_a_song_with_countries_keeps_all_of_them_and_gets_no_more(self):
        s = self.song(["country:us", "country:gb"])
        assert metafill.apply(s, {"tags": ["country:fr"]}) is False
        assert s["tags"] == ["country:us", "country:gb"]
