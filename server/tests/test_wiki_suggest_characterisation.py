import pytest

from app import genre_lookup as gl, wiki_lookup as wl

MB = {
    "year": 1997,
    "song_rels": ["song-rel"],
    "artist_rels": ["artist-rel"],
    "album_rels": ["album-rel"],
    "album": "Homework",
}
PICKS = {
    "song-rel": ("https://en.wikipedia.org/wiki/Around_the_World_(Daft_Punk_song)", "Q1"),
    "artist-rel": ("https://en.wikipedia.org/wiki/Daft_Punk", "Q2"),
    "album-rel": ("https://en.wikipedia.org/wiki/Homework_(album)", "Q3"),
}
SONG = PICKS["song-rel"][0]
ARTIST = PICKS["artist-rel"][0]
EMPTY_OUT = {
    "wikipedia_song": None, "wikipedia_artist": None, "wikipedia_album": None, "tags": [], "song_genres": [], "year": None,
    "infobox_album": None, "infobox_year": None, "infobox_suggest": None,
}


@pytest.fixture
def calls(monkeypatch):
    log = []
    monkeypatch.setattr(gl, "enabled", lambda: True)
    monkeypatch.setattr(wl, "artist_candidates", lambda a: [a] if " & " not in a else [a, a.split(" & ")[0]])
    monkeypatch.setattr(wl, "_pick", lambda rels: PICKS.get(rels[0] if rels else "", (None, None)))
    monkeypatch.setattr(wl, "infobox", lambda url: {"artist": None, **BOXES.get(url, {})})
    monkeypatch.setattr(wl, "find_song", lambda artist, title, names: log.append(("find_song", title, tuple(names))) or FOUND.get("song"))
    monkeypatch.setattr(wl, "find_artist", lambda name: log.append(("find_artist", name)) or FOUND.get("artist"))
    monkeypatch.setattr(wl, "find_album", lambda artist, album, names: log.append(("find_album", album)) or FOUND.get(album))
    monkeypatch.setattr(wl, "qid_of_page", lambda url: log.append(("qid_of_page", url)) or QIDS.get(url))
    monkeypatch.setattr(wl, "facts", lambda s, a: log.append(("facts", s, a)) or {"tags": ["genre:house"], "song_genres": ["genre:house"], "year": 1997})
    monkeypatch.setattr(wl, "_with_infobox", lambda out, s, a: log.append(("with_infobox", s, a)) or out.update(infobox_album=ALBUM_BOX[0]))
    BOXES.clear()
    FOUND.clear()
    QIDS.clear()
    ALBUM_BOX[0] = None
    return log


BOXES: dict = {}
FOUND: dict = {}
QIDS: dict = {}
ALBUM_BOX = [None]


def test_disabled_returns_empty(monkeypatch):
    monkeypatch.setattr(gl, "enabled", lambda: False)
    assert wl.suggest("Daft Punk", "Around the World", MB) == EMPTY_OUT


def test_full_musicbrainz_links(calls):
    out = wl.suggest("Daft Punk", "Around the World", MB)
    assert out == {
        **EMPTY_OUT,
        "wikipedia_song": SONG, "wikipedia_artist": ARTIST, "wikipedia_album": PICKS["album-rel"][0],
        "tags": ["genre:house"], "song_genres": ["genre:house"], "year": 1997,
    }
    assert calls == [("facts", "Q1", "Q2"), ("with_infobox", SONG, ARTIST)]


def test_no_album_in_musicbrainz_skips_album_relation(calls):
    out = wl.suggest("Daft Punk", "Around the World", {**MB, "album": None})
    assert out["wikipedia_album"] is None
    assert ("find_album", "Homework") not in calls


def test_infobox_artist_mismatch_drops_song_and_searches(calls):
    BOXES[SONG] = {"artist": "Someone Else"}
    FOUND["song"] = "https://en.wikipedia.org/wiki/Found_song"
    QIDS[FOUND["song"]] = "Q77"
    out = wl.suggest("Daft Punk", "Around the World", MB)
    assert out["wikipedia_song"] == FOUND["song"]
    assert calls == [("find_song", "Around the World", ("Daft Punk",)), ("qid_of_page", FOUND["song"]), ("facts", "Q77", "Q2"), ("with_infobox", FOUND["song"], ARTIST)]


def test_infobox_artist_mismatch_with_nothing_found(calls):
    BOXES[SONG] = {"artist": "Someone Else"}
    out = wl.suggest("Daft Punk", "Around the World", MB)
    assert out["wikipedia_song"] is None
    assert calls == [("find_song", "Around the World", ("Daft Punk",)), ("qid_of_page", ""), ("facts", None, "Q2"), ("with_infobox", None, ARTIST)]


def test_infobox_artist_match_keeps_song(calls):
    BOXES[SONG] = {"artist": "Daft Punk"}
    out = wl.suggest("Daft Punk", "Around the World", MB)
    assert out["wikipedia_song"] == SONG
    assert ("find_song", "Around the World", ("Daft Punk",)) not in calls


def test_missing_links_are_searched_for_every_name(calls):
    mb = {"year": None, "song_rels": [], "artist_rels": []}
    FOUND["artist"] = "https://en.wikipedia.org/wiki/Found_artist"
    out = wl.suggest("Daft Punk & Friends", "Around the World", mb)
    assert out["wikipedia_artist"] == FOUND["artist"]
    assert out["wikipedia_song"] is None
    assert out["year"] == 1997
    assert calls[:4] == [
        ("find_song", "Around the World", ("Daft Punk & Friends", "Daft Punk")),
        ("find_artist", "Daft Punk & Friends"),
        ("qid_of_page", ""),
        ("qid_of_page", FOUND["artist"]),
    ]


def test_no_title_skips_song_search(calls):
    mb = {"year": 2001, "song_rels": [], "artist_rels": ["artist-rel"]}
    out = wl.suggest("Daft Punk", "", mb)
    assert out["wikipedia_song"] is None
    assert not any(c[0] == "find_song" for c in calls)
    assert out["year"] == 1997


def test_album_search_tries_infobox_album_then_musicbrainz_album(calls):
    mb = {"year": None, "song_rels": ["song-rel"], "artist_rels": ["artist-rel"], "album": "Homework"}
    ALBUM_BOX[0] = "Discovery"
    FOUND["Homework"] = "https://en.wikipedia.org/wiki/Homework_(album)"
    out = wl.suggest("Daft Punk", "Around the World", mb)
    assert out["wikipedia_album"] == FOUND["Homework"]
    assert [c for c in calls if c[0] == "find_album"] == [("find_album", "Discovery"), ("find_album", "Homework")]


def test_album_search_stops_at_first_hit_and_dedupes(calls):
    mb = {"year": None, "song_rels": ["song-rel"], "artist_rels": ["artist-rel"], "album": "Homework"}
    ALBUM_BOX[0] = "Homework"
    FOUND["Homework"] = "https://en.wikipedia.org/wiki/Homework_(album)"
    wl.suggest("Daft Punk", "Around the World", mb)
    assert [c for c in calls if c[0] == "find_album"] == [("find_album", "Homework")]


def test_album_search_found_nothing(calls):
    mb = {"year": None, "song_rels": ["song-rel"], "artist_rels": ["artist-rel"], "album": "Homework"}
    out = wl.suggest("Daft Punk", "Around the World", mb)
    assert out["wikipedia_album"] is None
    assert [c for c in calls if c[0] == "find_album"] == [("find_album", "Homework")]


def test_failure_keeps_what_was_found_so_far(calls, monkeypatch):
    def boom(s, a):
        raise RuntimeError("down")

    monkeypatch.setattr(wl, "facts", boom)
    out = wl.suggest("Daft Punk", "Around the World", MB)
    assert out == {**EMPTY_OUT, "year": 1997, "wikipedia_song": SONG, "wikipedia_artist": ARTIST, "wikipedia_album": PICKS["album-rel"][0]}


def test_musicbrainz_lookup_used_without_mb(calls, monkeypatch):
    monkeypatch.setattr(gl, "lookup", lambda artist, title: MB)
    assert wl.suggest("Daft Punk", "Around the World")["wikipedia_song"] == SONG
