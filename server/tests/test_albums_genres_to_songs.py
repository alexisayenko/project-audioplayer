import pytest

from app import album_song_genres, deps, library
from tests.test_albums import discogs, link, made_album, preview  # noqa: F401
from tests.test_library import H, OWNER_UID, VID, VID2, add, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who  # noqa: F401

VID3 = "aaaaaaaaaaa"
ALBUM_GENRES = {"rock", "breakbeat"}


def url(album):
    return f"/albums/{album['id']}/genres/to-songs"


def song_of(vid):
    return library.find_song(library.load(deps.library_path(OWNER_UID)), vid)


def genres_of(vid):
    return set(library.genre_names(library.tag_list(song_of(vid))))


def linked_album(client, vids, tags=None):
    """Linking fills a song's EMPTY genres from the album, so the wanted tags are written after the links."""
    for v in (*vids, VID3):
        add(client, v)
    album = made_album(client)
    for no, v in enumerate(vids, 1):
        assert link(client, album, no, v).status_code == 200
    songs = library.load(deps.library_path(OWNER_UID))
    for song in songs:
        song["tags"] = library.clean_tags((tags or {}).get(song["id"], ["80s"]))
        song.pop("genres", None)
    deps.save_songs(OWNER_UID, songs)
    return album


def test_songs_without_genres_get_the_album_genres_and_keep_their_other_tags(client, discogs):
    album = linked_album(client, (VID, VID2))
    r = client.post(url(album), json={}, headers=H)
    assert r.status_code == 200
    assert r.json() == {"linked": 2, "applied": 2, "unchanged": 0, "skipped": 0, "failed": 0}
    for vid in (VID, VID2):
        assert genres_of(vid) == ALBUM_GENRES
        assert "80s" in song_of(vid)["tags"]
    assert genres_of(VID3) == set()
    assert song_of(VID3)["tags"] == ["80s"]
    again = client.post(url(album), json={}, headers=H).json()
    assert again == {"linked": 2, "applied": 0, "unchanged": 2, "skipped": 0, "failed": 0}


def test_none_same_and_different_are_counted_each_honestly(client, discogs):
    album = linked_album(client, (VID, VID2, VID3), {VID: ["80s"], VID2: ["genre:Breakbeat", "genre:ROCK"], VID3: ["genre:house"]})
    assert genres_of(VID2) == ALBUM_GENRES
    r = client.post(url(album), json={"overwrite": False}, headers=H).json()
    assert r == {"linked": 3, "applied": 1, "unchanged": 1, "skipped": 1, "failed": 0}
    assert genres_of(VID) == ALBUM_GENRES
    assert genres_of(VID3) == {"house"}


def test_the_confirmed_click_replaces_the_genres_and_keeps_other_tags(client, discogs):
    album = linked_album(client, (VID, VID2), {VID: ["genre:house", "genre:techno", "80s"], VID2: ["genre:rock"]})
    first = client.post(url(album), json={}, headers=H).json()
    assert first == {"linked": 2, "applied": 0, "unchanged": 0, "skipped": 2, "failed": 0}
    assert genres_of(VID) == {"house", "techno"}
    second = client.post(url(album), json={"overwrite": True}, headers=H).json()
    assert second == {"linked": 2, "applied": 2, "unchanged": 0, "skipped": 0, "failed": 0}
    for vid in (VID, VID2):
        assert genres_of(vid) == ALBUM_GENRES
    assert "80s" in song_of(VID)["tags"]
    assert "genres" not in song_of(VID)
    third = client.post(url(album), json={"overwrite": True}, headers=H).json()
    assert third == {"linked": 2, "applied": 0, "unchanged": 2, "skipped": 0, "failed": 0}


def test_a_song_that_is_not_in_the_library_or_not_linked_is_not_touched(client, discogs):
    album = linked_album(client, (VID,))
    before = song_of(VID3)
    assert client.post(url(album), json={"overwrite": True}, headers=H).json()["linked"] == 1
    assert song_of(VID3) == before
    client.delete(f"/songs/{VID}", headers=H)
    assert client.post(url(album), json={}, headers=H).json() == {"linked": 0, "applied": 0, "unchanged": 0, "skipped": 0, "failed": 0}


def test_an_album_without_genres_is_a_409(client, discogs):
    album = linked_album(client, (VID,))
    assert client.patch(f"/albums/{album['id']}", json={"genres": []}, headers=H).status_code == 200
    r = client.post(url(album), json={}, headers=H)
    assert (r.status_code, r.json()["detail"]) == (409, "no_genres")
    assert genres_of(VID) == set()


def test_genres_outside_the_tree_do_not_count_as_genres(client, discogs):
    album = linked_album(client, (VID,))
    assert client.patch(f"/albums/{album['id']}", json={"genres": ["Not A Real Genre Zzz"]}, headers=H).status_code == 200
    assert client.post(url(album), json={}, headers=H).status_code == 409


def test_one_failing_song_is_counted_and_the_others_are_saved(client, discogs, monkeypatch):
    album = linked_album(client, (VID, VID2))
    real = album_song_genres._set_genres

    def flaky(song, tags):
        if song["id"] == VID:
            raise ValueError("boom")
        real(song, tags)

    monkeypatch.setattr(album_song_genres, "_set_genres", flaky)
    r = client.post(url(album), json={}, headers=H).json()
    assert (r["applied"], r["failed"]) == (1, 1)
    assert genres_of(VID) == set()
    assert genres_of(VID2) == ALBUM_GENRES


def test_one_library_write_per_request(client, discogs, monkeypatch):
    album = linked_album(client, (VID, VID2))
    saves = []
    real = deps.save_songs
    monkeypatch.setattr(album_song_genres.deps, "save_songs", lambda uid, songs: (saves.append(uid), real(uid, songs))[1])
    client.post(url(album), json={}, headers=H)
    assert saves == [OWNER_UID]
    client.post(url(album), json={}, headers=H)
    assert saves == [OWNER_UID]


@pytest.mark.parametrize("album_id", ["alb_nope", "BAD!"])
def test_unknown_album_is_a_404_bad_body_a_422_and_no_token_a_401(client, discogs, album_id):
    album = linked_album(client, (VID,))
    assert client.post(f"/albums/{album_id}/genres/to-songs", json={}, headers=H).status_code == 404
    assert client.post(url(album), json={"overwrite": "maybe"}, headers=H).status_code == 422
    assert client.post(url(album), json={}).status_code == 401


def test_it_is_per_user(multi, discogs):
    c = multi
    a, b = who(c, ALICE), who(c, BOB)
    album = c.post("/albums", json=preview(c, headers=a).json(), headers=a).json()
    assert c.post(url(album), json={}, headers=b).status_code == 404
    assert c.post(url(album), json={}, headers=a).status_code == 200
