import json
import urllib.error
from pathlib import Path

import pytest

from app import album_youtube, deps, discogs_lookup, extractor, playlist_import
from tests.test_albums import RELEASE, URL as DISCOGS_URL, discogs, preview  # noqa: F401
from tests.test_library import H, OWNER_UID, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who  # noqa: F401

FIX = Path(__file__).parent / "fixtures"
PLAYLIST = json.loads((FIX / "youtube_playlist_album.json").read_text(encoding="utf-8"))
SEARCH = json.loads((FIX / "discogs_search_derango.json").read_text(encoding="utf-8"))
LIST = "OLAK5uy_abcdefghijklmnop"
PL_URL = f"https://music.youtube.com/playlist?list={LIST}"
A, B, C, D, E = "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd", "eeeeeeeeeee"


@pytest.fixture
def yt(monkeypatch):
    state = {"data": PLAYLIST, "calls": []}

    def playlist(list_id, limit):
        state["calls"].append(list_id)
        data = state["data"]
        if isinstance(data, Exception):
            raise data
        return {"title": data["title"], "uploader": data["uploader"], "total": len(data["entries"]), "entries": data["entries"]}

    monkeypatch.setattr(extractor, "playlist", playlist)
    playlist_import.reset_limits()
    return state


def start(client, url=PL_URL, headers=H):
    return client.post("/albums/youtube/start", json={"url": url}, headers=headers)


def library_ids(client):
    return {s["id"]: s for s in client.get("/library", headers=H).json()["songs"]}


@pytest.mark.parametrize("title,uploader,expected", [
    ("Derango - Tumult (Full Album)", "Chan", ("Derango", "Tumult")),
    ("Derango - Tumult [Full Album]", None, ("Derango", "Tumult")),
    ("Derango – Tumult - Full Album", None, ("Derango", "Tumult")),
    ("Tumult (Album)", "Derango - Topic", ("Derango", "Tumult")),
    ("Tumult", "Some Channel", (None, "Tumult")),
    ("", "", (None, None)),
])
def test_guess(title, uploader, expected):
    assert tuple(album_youtube.guess(title, uploader).values()) == expected


def test_start_creates_metadata_only_songs_and_reports_the_rest(client, yt):
    r = start(client)
    assert r.status_code == 200
    body = r.json()
    assert body["playlist"] == {"title": "Derango - Tumult (Full Album)", "uploader": "Derango - Topic", "count": 4}
    assert body["guess"] == {"artist": "Derango", "album": "Tumult"}
    assert [(s["songId"], s["durationS"], s["position"]) for s in body["songs"]] == [(A, 60, 1), (B, 245, 2), (D, 3723, 4), (E, 100, 5)]
    assert body["skipped"] == [{"title": "[Private video]", "reason": "Private"}]
    lib = library_ids(client)
    assert set(lib) == {A, B, D, E} and all(s["file"] is None for s in lib.values())
    assert lib[A]["title"] == "Intro" and lib[A]["mainArtists"] == ["Derango"]
    again = start(client)
    assert again.status_code == 200 and set(library_ids(client)) == {A, B, D, E}


def test_start_reuses_songs_already_in_the_library(client, yt):
    start(client)
    before = library_ids(client)
    r = start(client)
    assert [s["songId"] for s in r.json()["songs"]] == [A, B, D, E]
    assert {k: v["added_at"] for k, v in library_ids(client).items()} == {k: v["added_at"] for k, v in before.items()}


@pytest.mark.parametrize("url", ["https://example.com/playlist?list=PLabcdef", "https://www.youtube.com/watch?v=aaaaaaaaaaa", "http://www.youtube.com/playlist?list=PLabcdef", "https://www.youtube.com/playlist?list=RDabcdef", "nope"])
def test_start_bad_urls(client, yt, url):
    r = start(client, url)
    assert (r.status_code, r.json()["detail"]) == (400, "bad_url")
    assert yt["calls"] == []


def test_start_accepts_watch_and_youtube_com_playlist_links(client, yt):
    for url in (f"https://www.youtube.com/playlist?list={LIST}", f"https://www.youtube.com/watch?v={A}&list={LIST}"):
        assert start(client, url).status_code == 200


def test_start_not_found_and_failures(client, yt):
    yt["data"] = RuntimeError("ERROR: [youtube:tab] x: The playlist does not exist.")
    assert (start(client).status_code, start(client).json()["detail"]) == (404, "not_found")
    yt["data"] = RuntimeError("ERROR: HTTP Error 500")
    r = start(client)
    assert (r.status_code, r.json()["detail"]) == (502, "youtube_failed")
    yt["data"] = {"title": "t", "uploader": "u", "entries": []}
    assert start(client).status_code == 404
    yt["data"] = {"title": "t", "uploader": "u", "entries": [PLAYLIST["entries"][2]]}
    assert start(client).json()["detail"] == "not_found"
    assert start(client, "https://www.youtube.com/playlist?list=WL").json()["detail"] == "not_found"


def test_start_over_the_cap_creates_nothing(multi, yt, monkeypatch):
    monkeypatch.setenv("USER_MAX_SONGS", "3")
    c, a = multi, who(multi, ALICE)
    r = c.post("/albums/youtube/start", json={"url": PL_URL}, headers=a)
    assert (r.status_code, r.json()["detail"]) == (409, "library_full_songs")
    assert c.get("/library", headers=a).json()["songs"] == []
    assert c.post("/albums/youtube/start", json={"url": PL_URL}).status_code == 401


def test_discogs_search_ranks_candidates(client, discogs):
    discogs["data"]["database/search"] = SEARCH
    discogs["data"]["releases/222"] = {"id": 222, "title": "Tumult (Remixes)", "year": 2005, "artists": [{"name": "Derango"}], "tracklist": [{"type_": "track", "title": "x", "duration": "1:00"}]}
    discogs["data"]["releases/111"] = {"id": 111, "title": "Tumult", "year": 1999, "artists": [{"name": "Someone Else"}], "tracklist": [{"type_": "track", "title": "x", "duration": "1:00"}] * 9}
    r = client.post("/albums/discogs-search", json={"artist": "Derango", "album": "Tumult", "trackCount": 5, "durationsS": [None, 245, 3723, 59, 5]}, headers=H)
    assert r.status_code == 200
    got = r.json()["candidates"]
    assert [c["discogsId"] for c in got] == [545650, 222, 111]
    top = got[0]
    assert (top["url"], top["title"], top["artist"], top["year"], top["trackCount"]) == ("https://www.discogs.com/release/545650", "Tumult", "Derango", 2004, 5)
    assert top["score"] > got[1]["score"] > got[2]["score"] and 0 < top["score"] <= 1


def test_discogs_search_edges(client, discogs, monkeypatch):
    assert client.post("/albums/discogs-search", json={}, headers=H).json() == {"candidates": []}
    discogs["data"]["database/search"] = {"results": []}
    assert client.post("/albums/discogs-search", json={"album": "x"}, headers=H).json() == {"candidates": []}
    discogs["data"]["database/search"] = {"results": [{"id": i, "type": "release", "title": f"A - B{i}"} for i in range(20, 40)]}
    assert len(client.post("/albums/discogs-search", json={"album": "B"}, headers=H).json()["candidates"]) == 8
    monkeypatch.setattr(discogs_lookup, "_get", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    assert client.post("/albums/discogs-search", json={"album": "B"}, headers=H).status_code == 502
    monkeypatch.delenv("DISCOGS_TOKEN")
    r = client.post("/albums/discogs-search", json={"album": "B"}, headers=H)
    assert (r.status_code, r.json()["detail"]) == (503, "discogs_unavailable")
    assert client.post("/albums/discogs-search", json={"album": "B"}).status_code == 401


def test_create_auto_links_imported_songs(client, discogs, yt):
    start(client)
    payload = preview(client).json()
    r = client.post("/albums", json={**payload, "songIds": [A, B, D, E, "zzzzzzzzzzz", A]}, headers=H)
    assert r.status_code == 201
    body = r.json()
    ids = [t["songId"] for t in body["tracks"]]
    assert ids == [A, B, None, None, None]
    assert (body["linked"], body["unlinked"]) == (2, 3)
    assert client.get(f"/albums/{body['id']}", headers=H).json()["tracks"][1]["songId"] == B


def test_create_without_song_ids_has_no_link_counts(client, discogs):
    body = client.post("/albums", json=preview(client).json(), headers=H).json()
    assert "linked" not in body and all(t["songId"] is None for t in body["tracks"])


def test_versions_are_not_ignored_but_remasters_and_features_are():
    assert album_youtube.track_key("Tumult Part I") == album_youtube.track_key("Tumult Part I (2011 Remaster)") == album_youtube.track_key("Tumult Part I [Remastered]")
    assert album_youtube.track_key("Song (feat. X)") == album_youtube.track_key("Song")
    assert album_youtube.track_key("Song (Live)") != album_youtube.track_key("Song")
    assert album_youtube.track_key("Song (Remix)") != album_youtube.track_key("Song")
    song = {"id": "s", "title": "Song", "version": {"type": "live", "name": "Live"}}
    assert album_youtube.track_key("Song (Live)") in album_youtube.song_keys(song)
    assert album_youtube.track_key("Song") not in album_youtube.song_keys(song)


def test_each_song_and_track_is_used_once():
    album = {"tracks": [{"title": "Same", "songId": None}, {"title": "Same", "songId": None}]}
    songs = [{"id": "s1", "title": "Same"}, {"id": "s2", "title": "Same"}, {"id": "s3", "title": "Same"}]
    assert album_youtube.auto_link(album, ["s1", "s2", "s3", "s1"], songs) == 2
    assert [t["songId"] for t in album["tracks"]] == ["s1", "s2"]
    assert album_youtube.auto_link(album, "nope", songs) == 0


def test_auto_link_only_uses_the_callers_songs(multi, discogs, yt):
    c = multi
    a, b = who(c, ALICE), who(c, BOB)
    c.post("/albums/youtube/start", json={"url": PL_URL}, headers=a)
    payload = c.post("/albums/preview", json={"url": DISCOGS_URL}, headers=b).json()
    body = c.post("/albums", json={**payload, "songIds": [A, B]}, headers=b).json()
    assert (body["linked"], body["unlinked"]) == (0, 5)


def test_candidates_carry_format_label_country_catno_thumb_and_best(client, discogs):
    discogs["data"]["database/search"] = SEARCH
    discogs["data"]["releases/222"] = {"id": 222, "title": "Tumult (Remixes)", "year": 2005, "artists": [{"name": "Derango"}], "tracklist": [{"type_": "track", "title": "x", "duration": "1:00"}]}
    discogs["data"]["releases/111"] = {"id": 111, "title": "Tumult", "year": 1999, "artists": [{"name": "Someone Else"}], "tracklist": [{"type_": "track", "title": "x", "duration": "1:00"}] * 9}
    got = client.post("/albums/discogs-search", json={"artist": "Derango", "album": "Tumult", "trackCount": 5}, headers=H).json()["candidates"]
    top, second, third = got
    assert top["formats"] == ["Vinyl", "LP", "Album", "Limited Edition"] and top["labels"] == ["Subsonic", "Subsonic Records", "Third"]
    assert (top["country"], top["catno"], top["thumb"]) == ("Germany", "SUB 001", "https://i.discogs.com/thumb545650.jpg")
    assert second["formats"] == [] and second["labels"] == [] and second["country"] is None and second["catno"] is None and second["thumb"] is None
    assert third["thumb"] is None and third["year"] == 1999
    assert [c["best"] for c in got] == [True, False, False]


def test_best_needs_a_clear_margin_and_a_good_score(monkeypatch):
    def cand(score, i):
        return {"discogsId": i, "score": score, "best": False}

    def run(scores):
        items = [cand(s, i) for i, s in enumerate(scores)]
        monkeypatch.setattr(album_youtube, "_candidate", lambda item, *a: items[item["id"]])
        monkeypatch.setenv("DISCOGS_TOKEN", "t")
        monkeypatch.setattr(discogs_lookup, "_get", lambda *a, **k: {"results": [{"id": i, "type": "release"} for i in range(len(items))]})
        return [c["best"] for c in album_youtube.search("a", "b", None, None)["candidates"]]

    assert run([0.95, 0.6]) == [True, False]
    assert run([0.95, 0.9]) == [False, False]
    assert run([0.5, 0.2]) == [False, False]
    assert run([0.8]) == [True]
    assert run([]) == []
