import pytest

from app import album_youtube
from tests.test_albums import discogs, preview  # noqa: F401
from tests.test_albums_youtube import A, B, commit_body, pv, sel, seed, yt  # noqa: F401
from tests.test_albums_youtube_flow import HALLU_RELEASE, hallu, library_ids, post_commit  # noqa: F401
from tests.test_library import H, client  # noqa: F401


def genres_of(song):
    return sorted({*song.get("genres", []), *(t[6:] for t in song.get("tags", []) if t.startswith("genre:"))})


@pytest.mark.parametrize("title,desc,expected", [
    ("Astral Projection – For All Mankind (2025) [FULL ALBUM]", None, "album"),
    ("Artist - Thing (EP)", None, "EP"),
    ("Artist - Thing [Single]", None, "single"),
    ("Various Artists - Hits Compilation", None, "compilation"),
    ("Artist - Film (Original Soundtrack)", None, "soundtrack"),
    ("Artist - Live at Glastonbury", None, "live"),
    ("Artist - Night DJ Mix", None, "mix"),
    ("Artist - Night (Mixed by Someone)", None, "mix"),
    ("Artist - Night", "A continuous mix of tracks", "mix"),
    ("Artist - Night", "Mixed by Y, mastered by Z", "album"),
    ("Artist - Remix Collection", "", "album"),
])
def test_guess_type(title, desc, expected):
    assert album_youtube.guess_type(title, desc) == expected


def test_guess_example_from_the_brief():
    got = album_youtube.guess("Astral Projection – For All Mankind (2025) [FULL ALBUM]", "Banjankri")
    assert got == {"artist": "Astral Projection", "album": "For All Mankind", "year": 2025, "type": "album"}


def test_guess_falls_back_to_the_channel_only_without_an_artist_part():
    assert album_youtube.guess("For All Mankind", "Banjankri")["artist"] == "Banjankri"
    assert album_youtube.guess("Someone - For All Mankind", "Banjankri")["artist"] == "Someone"


def test_track_artist_defaults_to_the_album_artist_not_the_channel():
    channel = {"mainArtists": ["Banjankri"], "title": "t"}
    assert album_youtube._with_album_artist(channel, "Astral Projection", "Banjankri")["mainArtists"] == ["Astral Projection"]
    assert album_youtube._with_album_artist({"mainArtists": ["Own"], "title": "t"}, "Astral Projection", "Banjankri")["mainArtists"] == ["Own"]
    assert album_youtube._with_album_artist(channel, "Various Artists", "Banjankri") is channel
    assert album_youtube._with_album_artist({"mainArtists": ["Banjankri"]}, "Banjankri", "Banjankri")["mainArtists"] == ["Banjankri"]


def test_vocab_genres_maps_dedupes_caps_and_drops_unknown():
    assert album_youtube.vocab_genres(["Psytrance", "psytrance", "zzz not a genre", "Trance"]) == ["psytrance", "trance"]
    assert len(album_youtube.vocab_genres(["psytrance", "trance", "techno", "house", "ambient"], 4)) == 4
    assert album_youtube.vocab_genres(None) == []


def test_fill_song_only_touches_empty_fields():
    album = {"title": "T", "year": 2004, "artist": "Derango", "genres": ["Psytrance", "zzz"]}
    empty = {"albums": [], "releaseYear": None, "mainArtists": [], "tags": []}
    assert album_youtube.fill_song(empty, album) is True
    assert (empty["albums"], empty["releaseYear"], empty["mainArtists"], empty["tags"]) == (["T"], 2004, ["Derango"], ["genre:psytrance"])
    full = {"albums": ["X"], "releaseYear": 1990, "mainArtists": ["Own"], "tags": ["genre:techno"]}
    assert album_youtube.fill_song(full, album) is False
    assert full == {"albums": ["X"], "releaseYear": 1990, "mainArtists": ["Own"], "tags": ["genre:techno"]}
    various = {"mainArtists": []}
    album_youtube.fill_song(various, {**album, "artist": "Various Artists"}, None)
    assert various["mainArtists"] == []
    own = {"mainArtists": []}
    album_youtube.fill_song(own, album, "Track Artist")
    assert own["mainArtists"] == ["Track Artist"]


def test_commit_fills_new_songs_from_the_album(client, yt, monkeypatch):
    monkeypatch.setattr(album_youtube, "_views", lambda *a: ({}, ""))
    fallback = {"title": "My Album", "artist": "Derango", "year": 2004, "genres": ["Psytrance", "zzz not a genre"], "type": "ep"}
    r = post_commit(client, commit_body(sel((1, A, "Intro", 60)), fallback=fallback))
    assert r.status_code == 201
    assert r.json()["album"]["type"] == "EP"
    assert r.json()["album"]["genres"] == ["psytrance"]
    song = library_ids(client)[A]
    assert (song["albums"], song["releaseYear"], song["mainArtists"], genres_of(song)) == (["My Album"], 2004, ["Derango"], ["psytrance"])


def test_commit_fills_only_empty_fields_of_existing_songs(client, yt):
    album_id = seed(client)["album"]["id"]
    assert client.patch(f"/songs/{A}", json={"releaseYear": 1999}, headers=H).status_code == 200
    assert client.delete(f"/albums/{album_id}", headers=H).status_code == 200
    before = library_ids(client)
    assert before[A]["albums"] == ["Seed"] and before[B]["releaseYear"] is None
    fallback = {"title": "Second", "artist": "Derango", "year": 2004, "genres": ["psytrance"]}
    r = post_commit(client, commit_body(sel((1, A, "Intro", 60), (2, B, "Tumult Part I", 245)), fallback=fallback))
    assert r.status_code == 201, r.text
    after = library_ids(client)
    assert after[A]["albums"] == ["Seed"] and after[A]["releaseYear"] == 1999
    assert after[B]["albums"] == ["Seed"] and after[B]["releaseYear"] == 2004
    assert genres_of(after[A]) == genres_of(after[B]) == ["psytrance"]


def test_link_song_fills_empty_fields_and_never_overwrites(client, discogs, yt):
    seed(client)
    client.patch(f"/songs/{B}", json={"releaseYear": 1990}, headers=H)
    album = client.post("/albums", json=preview(client).json(), headers=H).json()
    expected = album_youtube.vocab_genres(album["genres"])
    assert expected
    assert client.put(f"/albums/{album['id']}/tracks/1/song", json={"songId": A}, headers=H).status_code == 200
    assert client.put(f"/albums/{album['id']}/tracks/2/song", json={"songId": B}, headers=H).status_code == 200
    songs = library_ids(client)
    assert songs[A]["releaseYear"] == 2004 and songs[B]["releaseYear"] == 1990
    assert songs[A]["albums"] == ["Seed"]
    assert genres_of(songs[A]) == sorted(expected)


def test_link_song_fills_the_artist_only_when_empty(client, discogs, yt):
    seed(client)
    album = client.post("/albums", json=preview(client).json(), headers=H).json()
    client.put(f"/albums/{album['id']}/tracks/1/song", json={"songId": A}, headers=H)
    assert library_ids(client)[A]["mainArtists"] == ["Derango"]
    client.patch(f"/songs/{B}", json={"mainArtists": ["Other"]}, headers=H)
    client.put(f"/albums/{album['id']}/tracks/2/song", json={"songId": B}, headers=H)
    assert library_ids(client)[B]["mainArtists"] == ["Other"]


def test_discogs_album_with_song_ids_fills_the_linked_songs(client, discogs, yt):
    seed(client)
    body = {**preview(client).json(), "songIds": [B]}
    assert client.post("/albums", json=body, headers=H).status_code == 201
    assert library_ids(client)[B]["releaseYear"] == 2004


def test_preview_genres_come_from_the_best_candidate(client, hallu, discogs):
    discogs["data"]["releases/77001"] = {**HALLU_RELEASE, "styles": ["Psy-Trance", "Nonsense Style", "Goa Trance"], "genres": ["Electronic"]}
    body = pv(client).json()
    want = album_youtube.vocab_genres(["Psy-Trance", "Nonsense Style", "Goa Trance", "Electronic"], 4)
    assert want and body["genres"] == want
    assert "nonsense style" not in body["genres"]
    assert body["guess"]["type"] == "album"


def test_preview_genres_fall_back_to_musicbrainz_and_survive_failures(client, hallu, discogs, monkeypatch):
    discogs["data"]["releases/77001"] = {**HALLU_RELEASE, "styles": ["Nonsense Style"], "genres": []}
    monkeypatch.setattr(album_youtube.genre_lookup, "suggest_tags", lambda artist, title: ["genre:psytrance", "genre:zzz not a genre", "country:gb"])
    assert pv(client).json()["genres"] == ["psytrance"]

    def boom(artist, title):
        raise RuntimeError("down")

    monkeypatch.setattr(album_youtube.genre_lookup, "suggest_tags", boom)
    r = pv(client)
    assert r.status_code == 200 and r.json()["genres"] == []
