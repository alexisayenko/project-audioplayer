import pytest

from app import album_covers, discogs_lookup, extractor, playlist_import
from tests.test_albums import discogs  # noqa: F401
from tests.test_albums_youtube import LIST, PL_URL, pv  # noqa: F401
from tests.test_albums_youtube_flow import HALLU, HALLU_RELEASE, HID, library_ids, post_commit  # noqa: F401
from tests.test_library import H, client  # noqa: F401

WIKI = "https://en.wikipedia.org/wiki/Twisted_(Hallucinogen_album)"
MASTER = {"id": 3001, "type": "master", "title": "Hallucinogen - Twisted", "year": "1995"}
MAIN = {**HALLU_RELEASE, "formats": [{"name": "CD", "descriptions": ["Album"]}], "images": [{"type": "primary", "uri": "https://i.discogs.com/twisted.jpg"}]}


def entry(i, title, channel="Hallucinogen - Topic", duration=400):
    return {"id": f"pppppppp{i:03d}", "title": title, "uploader": channel, "channel": channel, "duration": duration}


@pytest.fixture
def playlist(monkeypatch):
    state = {"title": "Hallucinogen - Twisted (1995) [Dragonfly Records]", "uploader": "Hallucinogen - Topic", "description": "", "entries": HALLU["entries"]}

    def read(list_id, limit):
        return {"title": state["title"], "uploader": state["uploader"], "description": state["description"], "total": len(state["entries"]), "entries": state["entries"]}

    monkeypatch.setattr(extractor, "playlist", read)
    playlist_import.reset_limits()
    return state


@pytest.fixture
def no_discogs(monkeypatch):
    monkeypatch.delenv("DISCOGS_TOKEN", raising=False)


def fake_discogs(monkeypatch, masters):
    monkeypatch.setenv("DISCOGS_TOKEN", "t")

    def get(path, params=None):
        if path == "database/search":
            return {"results": masters if params["type"] == "master" else []}
        if path == "masters/3001":
            return {"main_release": 77001}
        if path == "releases/77001":
            return MAIN
        return {}

    monkeypatch.setattr(discogs_lookup, "_get", get)


def test_preview_has_the_video_contract_with_track_artists_and_cleaned_titles(client, playlist, no_discogs):
    playlist["entries"] = [
        entry(1, "Hallucinogen - LSD", duration=450),
        entry(2, "Hallucinogen - Orphic Thrench (Foo Remix)", duration=500),
        entry(3, "Alpha Centauri (Official Video)", duration=420),
    ]
    playlist["description"] = f"Provided to YouTube. See {WIKI} and https://example.com/x"
    body = pv(client).json()
    assert body["guess"] == {"artist": "Hallucinogen", "album": "Twisted", "year": 1995, "type": "album"}
    assert body["album"] == {"title": "Twisted", "albumArtist": "Hallucinogen", "type": "album", "year": 1995, "coverUrl": body["thumbnail"]}
    assert body["thumbnail"] and "pppppppp001" in body["thumbnail"]
    assert body["links"] == {"discogs": None, "wikipedia": WIKI, "rateyourmusic": None}
    assert (body["discogsMatch"], body["discogsCandidates"]) == (None, [])
    first, second, third = body["tracks"]
    assert (first["artists"], first["artist"], first["title"]) == (["Hallucinogen"], "Hallucinogen", "LSD")
    assert (second["artists"], second["title"]) == (["Hallucinogen"], "Orphic Thrench")
    assert "Foo Remix" in second["version"]
    assert (third["artists"], third["artist"], third["title"], third["version"]) == (["Hallucinogen"], "Hallucinogen", "Alpha Centauri", None)
    assert {"position", "videoId", "durationS", "url", "songId"} <= set(first)
    assert "candidates" in body and "searchError" in body and "genres" in body


def test_the_uploader_channel_is_the_artist_only_when_it_is_the_only_source(client, playlist, no_discogs):
    playlist["title"] = "Night Drive"
    playlist["uploader"] = "Some Channel"
    playlist["entries"] = [entry(1, "First", "Some Channel"), entry(2, "Second", "Some Channel")]
    body = pv(client).json()
    assert body["album"]["albumArtist"] == "Some Channel"
    assert [t["artists"] for t in body["tracks"]] == [["Some Channel"], ["Some Channel"]]
    playlist["entries"] = [entry(1, "Alpha - First", "Some Channel"), entry(2, "Beta - Second", "Some Channel")]
    body = pv(client).json()
    assert body["album"]["albumArtist"] == "Various Artists"
    assert [t["artists"] for t in body["tracks"]] == [["Alpha"], ["Beta"]]


def test_preview_auto_matches_the_one_discogs_master_like_the_video(client, playlist, monkeypatch):
    fake_discogs(monkeypatch, [MASTER, {"id": 9, "type": "master", "title": "Hallucinogen - Other", "year": "1995"}])
    body = pv(client).json()
    assert body["discogsMatch"] == "https://www.discogs.com/master/3001"
    assert body["links"]["discogs"] == "https://www.discogs.com/master/3001"
    assert (body["album"]["title"], body["album"]["albumArtist"], body["album"]["year"], body["album"]["coverUrl"]) == ("Twisted", "Hallucinogen", 1995, "https://i.discogs.com/twisted.jpg")
    assert body["genres"] and body["discogsCandidates"] == []


def test_ambiguous_masters_give_candidates_and_the_youtube_cover(client, playlist, monkeypatch):
    fake_discogs(monkeypatch, [MASTER, {**MASTER, "id": 3002}])
    body = pv(client).json()
    assert body["discogsMatch"] is None and body["links"]["discogs"] is None
    assert body["album"]["coverUrl"] == body["thumbnail"]


def test_a_discogs_link_in_the_description_prefills_from_that_release(client, playlist, monkeypatch):
    fake_discogs(monkeypatch, [])
    playlist["description"] = "Buy https://www.discogs.com/release/77001-Hallucinogen-Twisted"
    body = pv(client).json()
    assert body["links"]["discogs"] == "https://www.discogs.com/release/77001"
    assert body["discogsMatch"] is None
    assert body["album"]["coverUrl"] == "https://i.discogs.com/twisted.jpg"


@pytest.fixture
def covers(monkeypatch):
    seen = []
    monkeypatch.setattr(album_covers, "fetch_jpeg", lambda url: seen.append(url) or b"jpeg")
    monkeypatch.setattr(album_covers, "store", lambda uid, aid, jpeg, src, url: seen.append(("stored", src, url)))
    monkeypatch.setattr(album_covers, "auto", lambda uid, album: album)
    return seen


def album_body(selected, **album):
    base = {"title": "Twisted", "albumArtist": "Hallucinogen", "type": "EP", "year": 1995, "genres": ["Psy-Trance", "Not A Genre"], "coverUrl": "https://i.discogs.com/twisted.jpg",
            "links": {"discogs": "https://www.discogs.com/master/3001", "wikipedia": WIKI, "rateyourmusic": "nope", "youtube": "https://evil.example/x"}}
    return {"playlistUrl": PL_URL, "album": {**base, **album}, "selected": selected}


def chosen(*numbers, **extra):
    return [{"position": n, "videoId": HID[n - 1], "title": f"Track {n}", "durationS": 100 + n, **extra.get(str(n), {})} for n in numbers]


def test_commit_applies_album_fields_links_cover_and_track_fields(client, playlist, covers, no_discogs):
    selected = chosen(1, 2, 3, **{"1": {"artists": ["Hallucinogen"]}, "2": {"artists": ["A", "B"], "version": "Foo Remix"}})
    r = post_commit(client, album_body(selected))
    assert r.status_code == 201, r.text
    out = r.json()
    album = out["album"]
    assert (album["title"], album["artist"], album["year"], album["type"], album["genres"]) == ("Twisted", "Hallucinogen", 1995, "EP", ["Psy-Trance", "Not A Genre"])
    assert album["links"] == {"discogs": "https://www.discogs.com/master/3001", "wikipedia": WIKI, "rateyourmusic": None, "youtube": PL_URL}
    assert [t["title"] for t in album["tracks"]] == ["Track 1", "Track 2", "Track 3"]
    assert [t["songId"] for t in album["tracks"]] == [HID[0], HID[1], HID[2]]
    assert (out["linked"], out["unlinked"]) == (3, 0)
    assert ("stored", "url", "https://i.discogs.com/twisted.jpg") in covers
    songs = library_ids(client)
    one, two, three = (songs[HID[i]] for i in range(3))
    assert one["title"] == "Track 1" and two["title"] == "Track 2"
    assert (one["albums"], one["releaseYear"]) == (["Twisted"], 1995)
    assert [a for a in two["mainArtists"]] == ["A", "B"]
    assert three["mainArtists"] == ["Hallucinogen"]
    assert [t for t in one["tags"] if t.startswith("genre:")] == ["genre:psytrance"]
    assert two["version"]["name"]


def test_commit_without_a_cover_url_falls_back_to_the_automatic_cover(client, playlist, covers, no_discogs):
    r = post_commit(client, album_body(chosen(1), coverUrl=None))
    assert r.status_code == 201
    assert not any(isinstance(c, tuple) for c in covers)


def test_commit_keeps_existing_songs_and_fills_only_their_empty_fields(client, playlist, covers, no_discogs):
    assert post_commit(client, {"playlistUrl": PL_URL, "selected": chosen(1), "fallback": {"title": "Seed", "year": 2001}}).status_code == 201
    before = library_ids(client)[HID[0]]
    other = "https://www.youtube.com/playlist?list=PLsecond12345"
    r = post_commit(client, {**album_body(chosen(1, 2, **{"1": {"artists": ["Someone"]}}), title="Second"), "playlistUrl": other})
    assert r.status_code == 201, r.text
    songs = library_ids(client)
    assert songs[HID[0]]["albums"] == before["albums"] == ["Seed"]
    assert songs[HID[0]]["mainArtists"] == before["mainArtists"]
    assert songs[HID[0]]["title"] == before["title"]
    assert songs[HID[1]]["albums"] == ["Second"]
    assert [t["songId"] for t in r.json()["album"]["tracks"]] == [HID[0], HID[1]]


def test_commit_validation(client, playlist, covers, no_discogs):
    assert post_commit(client, album_body(chosen(1), title="")).json()["detail"] == "bad_album"
    assert post_commit(client, album_body(chosen(1), albumArtist=" ")).json()["detail"] == "bad_album"
    assert post_commit(client, album_body(chosen(1), type="Opera")).json()["detail"] == "bad_album"
    assert post_commit(client, album_body(chosen(1, **{"1": {"artists": [1]}}))).json()["detail"] == "bad_selection"
    assert post_commit(client, album_body(chosen(1, **{"1": {"version": 5}}))).json()["detail"] == "bad_selection"
    assert library_ids(client) == {}


def test_commit_twice_is_a_conflict(client, playlist, covers, no_discogs):
    assert post_commit(client, album_body(chosen(1, 2))).status_code == 201
    again = post_commit(client, album_body(chosen(1, 2)))
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_exists"


@pytest.fixture
def real_covers(monkeypatch):
    monkeypatch.setattr(album_covers, "fetch_jpeg", lambda url: b"jpeg-bytes")
    monkeypatch.setattr(album_covers, "auto", lambda uid, album: album)


def stored_songs():
    from app import deps, library
    from tests.test_library import OWNER_UID
    return {s["id"]: s for s in library.load(deps.library_path(OWNER_UID))}


def test_cover_to_songs_covers_only_the_songs_this_commit_created(client, playlist, real_covers, no_discogs):
    assert post_commit(client, {"playlistUrl": PL_URL, "selected": chosen(1), "fallback": {"title": "Seed"}}).status_code == 201
    other = "https://www.youtube.com/playlist?list=PLsecond12345"
    r = post_commit(client, {**album_body(chosen(1, 2, 3), title="Second"), "playlistUrl": other, "coverToSongs": True})
    assert r.status_code == 201, r.text
    songs = stored_songs()
    for n in (2, 3):
        assert (songs[HID[n - 1]].get("cover"), songs[HID[n - 1]].get("cover_source")) == (f"covers/{HID[n - 1]}.jpg", "custom")
    assert songs[HID[0]].get("cover_source") != "custom"


def test_cover_to_songs_leaves_a_custom_song_cover_of_a_reused_song(client, playlist, real_covers, no_discogs):
    from app import deps, library
    from tests.test_library import OWNER_UID
    assert post_commit(client, {"playlistUrl": PL_URL, "selected": chosen(1), "fallback": {"title": "Seed"}}).status_code == 201
    songs = library.load(deps.library_path(OWNER_UID))
    songs[0].update(cover=f"covers/{HID[0]}.jpg", cover_v="mine", cover_source="custom")
    deps.save_songs(OWNER_UID, songs)
    other = "https://www.youtube.com/playlist?list=PLsecond12345"
    assert post_commit(client, {**album_body(chosen(1, 2), title="Second"), "playlistUrl": other, "coverToSongs": True}).status_code == 201
    assert stored_songs()[HID[0]]["cover_v"] == "mine"


@pytest.mark.parametrize("extra", [{}, {"coverToSongs": False}])
def test_cover_to_songs_off_leaves_song_covers_alone(client, playlist, real_covers, no_discogs, extra):
    assert post_commit(client, {**album_body(chosen(1, 2)), **extra}).status_code == 201
    assert "custom" not in {s.get("cover_source") for s in stored_songs().values()}


def test_cover_to_songs_without_an_album_cover_does_not_fail(client, playlist, real_covers, no_discogs):
    r = post_commit(client, {**album_body(chosen(1, 2), coverUrl=None), "coverToSongs": True})
    assert r.status_code == 201, r.text
    assert "custom" not in {s.get("cover_source") for s in stored_songs().values()}


def test_track_numbers_on_all_selected_items_number_the_album_tracks(client, playlist, covers, no_discogs):
    selected = chosen(1, 2, 3, **{"1": {"trackNo": 5}, "2": {"trackNo": 2}, "3": {"trackNo": 9}})
    r = post_commit(client, album_body(selected))
    assert r.status_code == 201, r.text
    album = r.json()["album"]
    assert [(t["no"], t["title"], t["songId"]) for t in album["tracks"]] == [(2, "Track 2", HID[1]), (5, "Track 1", HID[0]), (9, "Track 3", HID[2])]
    assert (r.json()["linked"], r.json()["unlinked"]) == (3, 0)


def test_track_numbers_on_only_some_items_are_ignored(client, playlist, covers, no_discogs):
    r = post_commit(client, album_body(chosen(1, 2, 3, **{"1": {"trackNo": 5}})))
    assert r.status_code == 201, r.text
    assert [(t["no"], t["songId"]) for t in r.json()["album"]["tracks"]] == [(1, HID[0]), (2, HID[1]), (3, HID[2])]


@pytest.mark.parametrize("numbers", [(1, 1), (0, 1), (1000, 1), (True, 2), ("1", 2), (1.5, 2)])
def test_bad_track_numbers_are_refused_and_create_nothing(client, playlist, covers, no_discogs, numbers):
    selected = chosen(1, 2, **{"1": {"trackNo": numbers[0]}, "2": {"trackNo": numbers[1]}})
    assert post_commit(client, album_body(selected)).json()["detail"] == "bad_selection"
    assert library_ids(client) == {}
