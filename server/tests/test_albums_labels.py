import json

import pytest

from app import album_masters, albums, deps, library
from tests.test_album_video_flow import TEXT, URL, create_body, flow  # noqa: F401
from tests.test_albums import discogs, made_album, preview, stored  # noqa: F401
from tests.test_albums_masters import MAIN, MASTER, MASTER_HIT, fake, pressing, resolve  # noqa: F401
from tests.test_albums_youtube import PL_URL
from tests.test_albums_youtube_album_form import album_body, chosen, covers, no_discogs, playlist  # noqa: F401
from tests.test_albums_youtube_flow import HID, library_ids, post_commit
from tests.test_library import H, OWNER_UID, VID, VID2, add, client  # noqa: F401


def patch(client, album, **body):
    return client.patch(f"/albums/{album['id']}", json=body, headers=H)


def test_a_new_album_has_no_labels_and_lists_the_key(client, discogs):
    album = made_album(client)
    assert album["labels"] == []
    assert client.get("/albums", headers=H).json()[0]["labels"] == []
    assert client.get(f"/albums/{album['id']}", headers=H).json()["labels"] == []


def test_patch_sets_normalises_and_clears_the_albums_labels(client, discogs, tmp_path):
    album = made_album(client)
    r = patch(client, album, labels=["  Blue   Room Released", "blue room released", "Phonokol"])
    assert r.status_code == 200
    assert r.json()["labels"] == ["Blue Room Released", "Phonokol"]
    assert stored(tmp_path)[0]["labels"] == ["Blue Room Released", "Phonokol"]
    assert client.get("/albums", headers=H).json()[0]["labels"] == ["Blue Room Released", "Phonokol"]
    assert patch(client, album, title="Other").json()["labels"] == ["Blue Room Released", "Phonokol"]
    assert patch(client, album, labels=[]).json()["labels"] == []
    assert stored(tmp_path)[0]["labels"] == []


@pytest.mark.parametrize("bad", ["Parvati", [1], ["x" * 101], [f"L{i}" for i in range(11)], ["a\x00b"], {"a": 1}])
def test_patch_rejects_bad_labels_with_the_field_key(client, discogs, bad):
    album = patch(client, made_album(client), labels=["Keep"]).json()
    r = patch(client, album, labels=bad)
    assert r.status_code == 422
    assert r.json()["detail"] == {"code": "bad_field", "key": "labels"}
    assert client.get(f"/albums/{album['id']}", headers=H).json()["labels"] == ["Keep"]


def test_old_albums_without_the_key_read_as_empty(tmp_path):
    path = tmp_path / "albums.json"
    path.write_text(json.dumps({"albums": [{"id": "alb_00000001", "tracks": []}, {"id": "alb_00000002", "tracks": [], "labels": [" A ", "a", 3]}]}), encoding="utf-8")
    first, second = albums.load(path)
    assert first["labels"] == [] and second["labels"] == ["A"]
    assert albums.summary(first)["labels"] == []


def test_discogs_address_create_takes_the_labels_from_the_release(client, discogs):
    discogs["data"]["releases/545650"] = {**discogs["data"]["releases/545650"], "labels": [{"name": "Phonokol (2)"}, {"name": "Not On Label"}, {"name": "Blue Room Released"}]}
    body = preview(client).json()
    assert body["labels"] == ["Phonokol", "Blue Room Released"]
    sent = {**body, "labels": ["Edited", "edited", "Other"]}
    assert client.post("/albums", json=sent, headers=H).json()["labels"] == ["Edited", "Other"]


def test_playlist_commit_gives_the_album_labels_to_new_songs_and_fills_existing_empty_ones(client, playlist, covers, no_discogs):
    assert post_commit(client, {"playlistUrl": PL_URL, "selected": chosen(1), "fallback": {"title": "Seed", "year": 2001}}).status_code == 201
    assert "labels" not in library_ids(client)[HID[0]]
    other = "https://www.youtube.com/playlist?list=PLsecond12345"
    r = post_commit(client, {**album_body(chosen(1, 2), title="Second", labels=["Parvati Records", " iono   music ", "parvati records"]), "playlistUrl": other})
    assert r.status_code == 201, r.text
    assert r.json()["album"]["labels"] == ["Parvati Records", "iono music"]
    songs = library_ids(client)
    assert songs[HID[1]]["labels"] == ["Parvati Records", "iono music"]
    assert songs[HID[0]]["labels"] == ["Parvati Records", "iono music"]


def test_an_existing_song_with_its_own_labels_keeps_them(client, playlist, covers, no_discogs):
    assert post_commit(client, {"playlistUrl": PL_URL, "selected": chosen(1), "fallback": {"title": "Seed"}}).status_code == 201
    assert client.patch(f"/songs/{HID[0]}", json={"labels": ["Mine"]}, headers=H).status_code == 200
    other = "https://www.youtube.com/playlist?list=PLsecond12345"
    r = post_commit(client, {**album_body(chosen(1, 2), title="Second", labels=["Album Label"]), "playlistUrl": other})
    assert r.status_code == 201
    songs = library_ids(client)
    assert songs[HID[0]]["labels"] == ["Mine"]
    assert songs[HID[1]]["labels"] == ["Album Label"]


def test_playlist_commit_without_labels_adds_none(client, playlist, covers, no_discogs):
    r = post_commit(client, album_body(chosen(1, 2)))
    assert r.status_code == 201
    assert r.json()["album"]["labels"] == []
    assert all("labels" not in s for s in library_ids(client).values())


@pytest.mark.parametrize("bad", ["Parvati", [1], ["x" * 101], [f"L{i}" for i in range(11)]])
def test_playlist_commit_rejects_malformed_labels_and_creates_nothing(client, playlist, covers, no_discogs, bad):
    r = post_commit(client, album_body(chosen(1), labels=bad))
    assert (r.status_code, r.json()["detail"]) == (422, "bad_album")
    assert library_ids(client) == {}


def test_the_old_candidate_commit_keeps_labels_too(client, playlist, covers, no_discogs):
    body = {"playlistUrl": PL_URL, "selected": chosen(1), "fallback": {"title": "Seed", "labels": ["Fallback Label", "fallback label"]}}
    r = post_commit(client, body)
    assert r.status_code == 201
    assert r.json()["album"]["labels"] == ["Fallback Label"]
    assert library_ids(client)[HID[0]]["labels"] == ["Fallback Label"]


def test_video_create_gives_the_album_labels_to_every_new_song(client, flow):
    preview_body = client.post("/albums/from-video/preview-text", json={"url": URL, "text": TEXT}, headers=H).json()
    body = create_body(preview_body)
    body["album"] = {**body["album"], "labels": ["Parvati Records", "Iono Music"]}
    made = client.post("/albums/from-video", json=body, headers=H)
    assert made.status_code == 202, made.text
    data = made.json()
    songs = {s["id"]: s for s in client.get("/library", headers=H).json()["songs"]}
    assert [songs[i]["labels"] for i in data["songIds"]] == [["Parvati Records", "Iono Music"]] * 3
    assert client.get(f"/albums/{data['albumId']}", headers=H).json()["labels"] == ["Parvati Records", "Iono Music"]
    again = client.post("/albums/from-video", json=body, headers=H)
    assert (again.status_code, again.json()) == (202, data)
    other = client.post("/albums/from-video", json={**body, "album": {**body["album"], "labels": ["Different"]}}, headers=H)
    assert other.status_code == 409


def test_video_create_without_labels_has_the_old_request_key_and_no_label_keys(client, flow):
    preview_body = client.post("/albums/from-video/preview-text", json={"url": URL, "text": TEXT}, headers=H).json()
    data = client.post("/albums/from-video", json=create_body(preview_body), headers=H).json()
    songs = client.get("/library", headers=H).json()["songs"]
    assert all("labels" not in s for s in songs)
    assert client.get(f"/albums/{data['albumId']}", headers=H).json()["labels"] == []


def test_video_create_rejects_malformed_labels(client, flow):
    preview_body = client.post("/albums/from-video/preview-text", json={"url": URL, "text": TEXT}, headers=H).json()
    body = create_body(preview_body)
    r = client.post("/albums/from-video", json={**body, "album": {**body["album"], "labels": "Parvati"}}, headers=H)
    assert (r.status_code, r.json()["detail"]) == (422, "bad_album")
    assert client.get("/library", headers=H).json()["songs"] == []


def test_a_song_edited_by_hand_keeps_its_own_labels_over_the_albums(client, discogs):
    album = patch(client, made_album(client), labels=["Album Label"]).json()
    add(client, VID)
    assert client.patch(f"/songs/{VID}", json={"labels": ["Own Label"]}, headers=H).status_code == 200
    assert client.put(f"/albums/{album['id']}/tracks/1/song", json={"songId": VID}, headers=H).status_code == 200
    song = library.find_song(library.load(deps.library_path(OWNER_UID)), VID)
    assert song["labels"] == ["Own Label"]
    assert client.patch(f"/songs/{VID}", json={"labels": []}, headers=H).status_code == 200
    assert "labels" not in library.find_song(library.load(deps.library_path(OWNER_UID)), VID)


def test_discogs_search_rows_carry_cleaned_labels_and_masters_none_until_resolved(client, fake):
    fake["releases"] = [pressing(9001, 1996, label=["Blue Room Released", "Phonokol (2)", "Not On Label"])]
    fake["data"]["releases/9001"] = {**MAIN, "year": 1996}
    fake["masters"] = []
    rows = client.post("/albums/discogs/search", json={"artist": "Delta Aquarids", "title": "Total Eclipse"}, headers=H).json()["candidates"]
    assert rows and rows[0]["kind"] == "release"
    assert rows[0]["labels"] == ["Blue Room Released", "Phonokol"]
    assert rows[0]["label"] == "Blue Room Released"
    fake["masters"] = [MASTER_HIT]
    album_masters._cache.clear()
    master = client.post("/albums/discogs/search", json={"artist": "Delta Aquarids", "title": "Total Eclipse"}, headers=H).json()["candidates"][0]
    assert (master["kind"], master["label"], master["labels"]) == ("master", None, [])


def test_resolve_a_release_cleans_its_labels(client, fake):
    fake["data"]["releases/9001"] = {**MAIN, "labels": [{"name": "Blue Room Released"}, {"name": "Phonokol (2)"}, {"name": "Not On Label (Delta Aquarids Self-released)"}, {"name": "Self-released"}]}
    row = client.post("/albums/discogs/resolve", json={"kind": "release", "id": 9001}, headers=H).json()["candidate"]
    assert row["labels"] == ["Blue Room Released", "Phonokol"]
    assert row["label"] == "Blue Room Released"


def test_resolve_a_release_with_only_placeholders_has_no_label(client, fake):
    fake["data"]["releases/9001"] = {**MAIN, "labels": [{"name": "Not On Label"}]}
    row = client.post("/albums/discogs/resolve", json={"kind": "release", "id": 9001}, headers=H).json()["candidate"]
    assert (row["label"], row["labels"]) == (None, [])


def test_resolve_a_master_reads_the_labels_of_its_main_release(client, fake):
    fake["data"]["releases/7001"] = {**MAIN, "labels": [{"name": "Parvati Records"}, {"name": "Iono Music (3)"}]}
    row = resolve(client).json()["candidate"]
    assert row["labels"] == ["Parvati Records", "Iono Music"]
    assert row["label"] == "Parvati Records"
    fake["data"]["releases/7001"] = MAIN
    album_masters._cache.clear()
    row = resolve(client).json()["candidate"]
    assert (row["label"], row["labels"]) == (None, [])
