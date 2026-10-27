import pytest

from tests.test_albums import discogs  # noqa: F401
from tests.test_albums_youtube import PL_URL, pv  # noqa: F401
from tests.test_albums_youtube_album_form import album_body, chosen, covers, no_discogs, playlist  # noqa: F401
from tests.test_albums_youtube_flow import HID, library_ids, post_commit
from tests.test_library import H, client  # noqa: F401

OTHER = "https://www.youtube.com/playlist?list=PLsecond12345"


def seed_first(client):
    assert post_commit(client, {"playlistUrl": PL_URL, "selected": chosen(1), "fallback": {"title": "Seed"}}).status_code == 201
    return library_ids(client)[HID[0]]


def test_a_track_can_link_a_library_song_and_no_new_song_is_created(client, playlist, covers, no_discogs):
    before = seed_first(client)
    selected = chosen(2, 3, **{"3": {"useExistingSongId": HID[0]}})
    r = post_commit(client, {**album_body(selected, title="Second"), "playlistUrl": OTHER})
    assert r.status_code == 201, r.text
    out = r.json()
    assert [t["songId"] for t in out["album"]["tracks"]] == [HID[1], HID[0]]
    assert out["songs"] == [{"position": 2, "songId": HID[1]}, {"position": 3, "songId": HID[0]}]
    assert (out["linked"], out["unlinked"]) == (2, 0)
    songs = library_ids(client)
    assert set(songs) == {HID[0], HID[1]}
    assert songs[HID[0]] == before


def test_a_linked_song_is_not_filled_or_covered_by_the_commit(client, playlist, covers, no_discogs):
    before = seed_first(client)
    selected = chosen(2, 3, **{"3": {"useExistingSongId": HID[0], "artists": ["Someone"]}})
    r = post_commit(client, {**album_body(selected, title="Second"), "playlistUrl": OTHER, "coverToSongs": True})
    assert r.status_code == 201, r.text
    now = library_ids(client)[HID[0]]
    assert (now["albums"], now["mainArtists"], now["title"]) == (before["albums"], before["mainArtists"], before["title"])


def test_an_unknown_linked_song_is_refused_and_creates_nothing(client, playlist, covers, no_discogs):
    selected = chosen(1, 2, **{"2": {"useExistingSongId": "zzzzzzzzzzz"}})
    r = post_commit(client, album_body(selected))
    assert (r.status_code, r.json()["detail"]) == (422, "unknown_song")
    assert library_ids(client) == {}
    assert client.get("/albums", headers=H).json() == []


@pytest.mark.parametrize("bad", [5, "short", "", ["x"]])
def test_a_malformed_linked_song_id_is_refused(client, playlist, covers, no_discogs, bad):
    r = post_commit(client, album_body(chosen(1, **{"1": {"useExistingSongId": bad}})))
    assert (r.status_code, r.json()["detail"]) == (422, "bad_selection")
    assert library_ids(client) == {}


def test_one_song_cannot_be_linked_from_two_tracks(client, playlist, covers, no_discogs):
    seed_first(client)
    link = {"useExistingSongId": HID[0]}
    r = post_commit(client, {**album_body(chosen(2, 3, **{"2": link, "3": link}), title="Second"), "playlistUrl": OTHER})
    assert (r.status_code, r.json()["detail"]) == (422, "bad_selection")
    assert set(library_ids(client)) == {HID[0]}


def test_a_link_to_the_song_another_track_already_uses_is_refused(client, playlist, covers, no_discogs):
    seed_first(client)
    selected = chosen(1, 2, **{"2": {"useExistingSongId": HID[0]}})
    r = post_commit(client, {**album_body(selected, title="Second"), "playlistUrl": OTHER})
    assert (r.status_code, r.json()["detail"]) == (422, "bad_selection")
    assert set(library_ids(client)) == {HID[0]}


def test_a_link_on_a_track_already_in_the_library_is_ignored(client, playlist, covers, no_discogs):
    seed_first(client)
    assert post_commit(client, {"playlistUrl": OTHER, "selected": chosen(2), "fallback": {"title": "Seed 2"}}).status_code == 201
    third = "https://www.youtube.com/playlist?list=PLthird1234567"
    r = post_commit(client, {**album_body(chosen(1, **{"1": {"useExistingSongId": HID[1]}}), title="Third"), "playlistUrl": third})
    assert r.status_code == 201, r.text
    assert [t["songId"] for t in r.json()["album"]["tracks"]] == [HID[0]]
