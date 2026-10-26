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


def pv(client, url=PL_URL, headers=H):
    return client.post("/albums/youtube/preview", json={"url": url}, headers=headers)


def sel(*entries):
    return [{"position": p, "videoId": v, "title": t, "durationS": d, "url": f"https://www.youtube.com/watch?v={v}"} for p, v, t, d in entries]


def commit_body(selected, **extra):
    return {"playlistUrl": PL_URL, "selected": selected, **extra}


def seed(client, headers=H):
    """Metadata-only songs for the four playable fixture videos (an album from the videos themselves)."""
    selected = sel((1, A, "Intro", 60), (2, B, "Tumult Part I", 245), (4, D, "Suite (Live)", 3723), (5, E, "Unrelated Bonus", 100))
    r = client.post("/albums/youtube/commit", json=commit_body(selected, fallback={"title": "Seed"}), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def library_ids(client):
    return {s["id"]: s for s in client.get("/library", headers=H).json()["songs"]}


@pytest.mark.parametrize("title,uploader,expected", [
    ("Derango - Tumult (Full Album)", "Chan", ("Derango", "Tumult")),
    ("Derango - Tumult [Full Album]", None, ("Derango", "Tumult")),
    ("Derango – Tumult - Full Album", None, ("Derango", "Tumult")),
    ("Tumult (Album)", "Derango - Topic", ("Derango", "Tumult")),
    ("Tumult", "Some Channel", (None, "Tumult")),
    ("", "", (None, None)),
    ("Hallucinogen - Twisted (1995) [Dragonfly Records]", "Hallucinogen - Topic", ("Hallucinogen", "Twisted")),
    ("Hallucinogen - Twisted [Dragonfly] (Full Album)", None, ("Hallucinogen", "Twisted")),
    ("Hallucinogen - Twisted 1995", None, ("Hallucinogen", "Twisted")),
    ("Prince - 1999", None, ("Prince", "1999")),
    ("Twisted (1995)", "Hallucinogen - Topic", ("Hallucinogen", "Twisted")),
    ("Artist - Album (Part 2)", None, ("Artist", "Album (Part 2)")),
])
def test_guess(title, uploader, expected):
    got = album_youtube.guess(title, uploader)
    assert expected == (got["artist"], got["album"])


@pytest.mark.parametrize("title,desc,expected", [
    ("Hallucinogen - Twisted (1995)", None, 1995), ("Twisted [2001 reissue]", "", 2001), ("Twisted", "Released 1995 on Dragonfly", 1995),
    ("Twisted", "uploaded in 2020 for fun", None), ("Twisted 19955", None, None), ("", None, None),
])
def test_guess_year(title, desc, expected):
    assert album_youtube.guess(title, "x", desc)["year"] == expected


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
    assert top["score"] > got[1]["score"] > got[2]["score"]
    assert 0 < top["score"] <= 1
    assert [t["title"] for t in top["tracks"]][:2] == ["Intro", "Tumult Part I"]
    assert "matches" not in top


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
    seed(client)
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
    assert "linked" not in body
    assert all(t["songId"] is None for t in body["tracks"])


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
    seed(c, a)
    payload = c.post("/albums/preview", json={"url": DISCOGS_URL}, headers=b).json()
    body = c.post("/albums", json={**payload, "songIds": [A, B]}, headers=b).json()
    assert (body["linked"], body["unlinked"]) == (0, 5)


def test_candidates_carry_format_label_country_catno_thumb_and_best(client, discogs):
    discogs["data"]["database/search"] = SEARCH
    discogs["data"]["releases/222"] = {"id": 222, "title": "Tumult (Remixes)", "year": 2005, "artists": [{"name": "Derango"}], "tracklist": [{"type_": "track", "title": "x", "duration": "1:00"}]}
    discogs["data"]["releases/111"] = {"id": 111, "title": "Tumult", "year": 1999, "artists": [{"name": "Someone Else"}], "tracklist": [{"type_": "track", "title": "x", "duration": "1:00"}] * 9}
    got = client.post("/albums/discogs-search", json={"artist": "Derango", "album": "Tumult", "trackCount": 5}, headers=H).json()["candidates"]
    top, second, third = got
    assert top["formats"] == ["Vinyl", "LP", "Album", "Limited Edition"]
    assert top["labels"] == ["Subsonic", "Subsonic Records", "Third"]
    assert (top["country"], top["catno"], top["thumb"]) == ("Germany", "SUB 001", "https://i.discogs.com/thumb545650.jpg")
    assert second["formats"] == []
    assert second["labels"] == []
    assert second["country"] is None
    assert second["catno"] is None
    assert second["thumb"] is None
    assert third["thumb"] is None
    assert third["year"] == 1999
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
