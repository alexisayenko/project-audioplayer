import json
from pathlib import Path

import pytest

from app import album_youtube, discogs_lookup, extractor, playlist_import
from tests.test_albums import discogs, preview, stored  # noqa: F401
from tests.test_albums_youtube import A, B, D, E, LIST, PL_URL, SEARCH, commit_body, pv, sel, seed, yt  # noqa: F401
from tests.test_library import H, OWNER_UID, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who  # noqa: F401

FIX = Path(__file__).parent / "fixtures"
HALLU = json.loads((FIX / "youtube_playlist_hallucinogen.json").read_text(encoding="utf-8"))
HALLU_RELEASE = json.loads((FIX / "discogs_release_hallucinogen.json").read_text(encoding="utf-8"))
HALLU_SEARCH = {"results": [{"id": 77001, "type": "release", "title": "Hallucinogen - Twisted", "year": "1995", "country": "UK", "catno": "DRAGON 1",
                             "format": ["CD", "Album"], "label": ["Dragonfly Records"], "thumb": "https://i.discogs.com/t.jpg"}]}
HID = [f"hhhhhhhhh{i:02d}" for i in range(1, 12)]


def library_ids(client, headers=H):
    return {s["id"]: s for s in client.get("/library", headers=headers).json()["songs"]}


def post_commit(client, body, headers=H):
    return client.post("/albums/youtube/commit", json=body, headers=headers)


@pytest.fixture
def hallu(yt, discogs):
    yt["data"] = HALLU
    discogs["data"]["database/search"] = HALLU_SEARCH
    discogs["data"]["releases/77001"] = HALLU_RELEASE
    return yt


def test_preview_creates_nothing_and_returns_tracks_guess_and_matches(client, hallu, tmp_path):
    r = pv(client)
    assert r.status_code == 200
    body = r.json()
    assert body["playlist"] == {"title": HALLU["title"], "uploader": "Hallucinogen - Topic", "count": 11, "url": f"https://www.youtube.com/playlist?list={LIST}"}
    assert body["guess"] == {"artist": "Hallucinogen", "album": "Twisted", "year": 1995, "type": "album"}
    assert [(t["position"], t["videoId"], t["songId"]) for t in body["tracks"]] == [(i, HID[i - 1], None) for i in range(1, 12)]
    assert body["tracks"][0]["title"] == "LSD"
    assert body["tracks"][0]["durationS"] == 450
    assert body["tracks"][0]["url"].endswith(HID[0])
    assert body["searchError"] is None
    assert len(body["candidates"]) == 1
    cand = body["candidates"][0]
    assert (cand["url"], cand["discogsId"], cand["year"], cand["trackCount"], cand["best"]) == ("https://www.discogs.com/release/77001", 77001, 1995, 9, True)
    assert (cand["formats"], cand["labels"], cand["country"], cand["catno"]) == (["CD", "Album"], ["Dragonfly Records"], "UK", "DRAGON 1")
    assert [t["no"] for t in cand["tracks"]] == list(range(1, 10))
    assert cand["matches"] == {"1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": None, "11": None}
    assert library_ids(client) == {}
    assert client.get("/albums", headers=H).json() == []


def test_preview_shows_existing_songs_and_survives_discogs_failures(client, hallu, monkeypatch):
    seed_body = commit_body(sel((1, HID[0], "LSD", 450)), fallback={"title": "Mine"})
    assert post_commit(client, seed_body).status_code == 201
    assert pv(client).json()["tracks"][0]["songId"] == HID[0]
    monkeypatch.delenv("DISCOGS_TOKEN")
    body = pv(client).json()
    assert (body["candidates"], body["searchError"]) == ([], "discogs_unavailable")
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    monkeypatch.setattr(discogs_lookup, "_get", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    body = pv(client).json()
    assert (body["candidates"], body["searchError"]) == ([], "discogs_failed")
    assert len(body["tracks"]) == 11


def test_preview_without_a_guess_skips_the_search(client, yt, discogs):
    yt["data"] = {"title": "", "uploader": "", "entries": HALLU["entries"][:2]}
    body = pv(client).json()
    assert body["guess"] == {"artist": None, "album": None, "year": None, "type": "album"}
    assert body["candidates"] == []
    assert body["searchError"] is None


@pytest.mark.parametrize("url", ["https://example.com/playlist?list=PLabcdef", "http://www.youtube.com/playlist?list=PLabcdef", "https://www.youtube.com/playlist?list=RDabcdef", "nope"])
def test_preview_bad_urls(client, yt, url):
    r = pv(client, url)
    assert (r.status_code, r.json()["detail"]) == (400, "bad_url")
    assert yt["calls"] == []


def test_preview_errors_and_auth(client, yt, multi):
    yt["data"] = RuntimeError("ERROR: [youtube:tab] x: The playlist does not exist.")
    assert (pv(client).status_code, pv(client).json()["detail"]) == (404, "not_found")
    yt["data"] = RuntimeError("ERROR: HTTP Error 500")
    assert (pv(client).status_code, pv(client).json()["detail"]) == (502, "youtube_failed")
    yt["data"] = {"title": "t", "uploader": "u", "entries": [{"id": "ccccccccccc", "title": "[Private video]", "duration": None}]}
    assert pv(client).json()["detail"] == "not_found"
    assert pv(client, headers={}).status_code == 401
    assert client.post("/albums/youtube/commit", json={}).status_code == 401


def test_the_old_start_route_is_gone(client, yt):
    assert client.post("/albums/youtube/start", json={"url": PL_URL}, headers=H).status_code in (404, 405)


def test_matches_prefer_the_original_over_a_remaster():
    disc = [{"no": 1, "title": "Orphic Thrench"}, {"no": 2, "title": "Snarling Black Mabel"}, {"no": 3, "title": "Mix (Live)"}]
    pl = [{"position": 1, "title": "Orphic Thrench (Remastered)"}, {"position": 2, "title": "Orphic Thrench"}, {"position": 3, "title": "Snarling Black Mabel [2011 Remaster]"},
          {"position": 4, "title": "Snarling Black Mabel"}, {"position": 5, "title": "Mix"}, {"position": 6, "title": "Mix (Live)"}, {"position": 7, "title": "Nope (feat. X)"}]
    assert album_youtube.match_tracks(pl, disc) == {"1": None, "2": 1, "3": None, "4": 2, "5": None, "6": 3, "7": None}


def test_substring_titles_score_below_exact_ones():
    assert album_youtube._sim("Tumult", "Tumult") == 1.0
    assert album_youtube._sim("Tumult", "Tumult (Remixes)") == 0.6
    assert album_youtube._sim("", "x") == 0.0


def test_discogs_search_returns_tracks_and_matches_for_playlist_tracks(client, discogs):
    discogs["data"]["database/search"] = HALLU_SEARCH
    discogs["data"]["releases/77001"] = HALLU_RELEASE
    pl = [{"position": 3, "title": "Alpha Centauri", "durationS": 420}, {"position": 9, "title": "Solstice"}, {"position": 12, "title": "Other"}]
    got = client.post("/albums/discogs-search", json={"artist": "Hallucinogen", "album": "Twisted", "playlistTracks": pl}, headers=H).json()["candidates"][0]
    assert got["matches"] == {"3": 3, "9": 8, "12": None}
    assert len(got["tracks"]) == 9
    plain = client.post("/albums/discogs-search", json={"artist": "Hallucinogen", "album": "Twisted"}, headers=H).json()["candidates"][0]
    assert "matches" not in plain
    assert len(plain["tracks"]) == 9


def test_commit_with_a_candidate_creates_selected_songs_and_links_by_mapping(client, hallu):
    cand = pv(client).json()["candidates"][0]
    chosen = [(i, HID[i - 1], t, 100) for i, t in ((1, "LSD"), (2, "Orphic Thrench"), (9, "Angelic Particles RMX"), (10, "Orphic Thrench (Remastered)"))]
    body = commit_body(sel(*chosen), candidate={**cand, "genres": ["Psy-Trance"], "extra": 1}, mapping={"1": 1, "2": 2, "9": 9, "10": None})
    r = post_commit(client, {**body, "playlistUrl": f"https://www.youtube.com/watch?v={HID[0]}&list={LIST}&index=3"})
    assert r.status_code == 201
    out = r.json()
    assert (out["linked"], out["unlinked"]) == (3, 6)
    assert out["songs"] == [{"position": p, "songId": HID[p - 1]} for p in (1, 2, 9, 10)]
    album = out["album"]
    assert album["links"]["youtube"] == f"https://www.youtube.com/watch?v={HID[0]}&list={LIST}"
    assert album["links"]["discogs"] == "https://www.discogs.com/release/77001"
    assert album["genres"] == ["Psy-Trance"]
    assert [t["songId"] for t in album["tracks"]] == [HID[0], HID[1], None, None, None, None, None, None, HID[8]]
    assert set(library_ids(client)) == {HID[0], HID[1], HID[8], HID[9]}
    assert all(s["file"] is None for s in library_ids(client).values())
    assert client.get(f"/albums/{album['id']}", headers=H).json() == album
    again = post_commit(client, body)
    assert (again.status_code, again.json()["detail"]) == (409, {"code": "already_exists", "id": album["id"]})


def test_commit_reuses_existing_songs_without_duplicating(client, hallu):
    seed_body = commit_body(sel((1, HID[0], "LSD", 450)), fallback={"title": "First"})
    assert post_commit(client, seed_body).status_code == 201
    cand = pv(client).json()["candidates"][0]
    out = post_commit(client, commit_body(sel((1, HID[0], "LSD", 450), (2, HID[1], "Orphic Thrench", 500)), candidate=cand, mapping={"1": 1, "2": 2})).json()
    assert [t["songId"] for t in out["album"]["tracks"]][:2] == [HID[0], HID[1]]
    assert len(library_ids(client)) == 2


def test_commit_without_a_candidate_builds_the_album_from_the_selection(client, yt):
    selected = sel((4, D, "Suite (Live)", 3723), (1, A, "Intro", 60))
    out = post_commit(client, commit_body(selected, fallback={"title": "  My Album ", "artist": "Derango", "year": 2004})).json()
    album = out["album"]
    assert (album["title"], album["artist"], album["year"]) == ("My Album", "Derango", 2004)
    assert [(t["no"], t["title"], t["durationS"], t["songId"]) for t in album["tracks"]] == [(1, "Intro", 60, A), (2, "Suite (Live)", 3723, D)]
    assert album["source"] == {"type": "youtube", "id": LIST, "url": f"https://www.youtube.com/playlist?list={LIST}"}
    assert album["links"]["youtube"] == PL_URL
    assert album["links"]["discogs"] is None
    assert (out["linked"], out["unlinked"]) == (2, 0)
    assert [s["position"] for s in out["songs"]] == [1, 4]
    assert post_commit(client, commit_body(selected, fallback={"title": "x"})).status_code == 409


@pytest.mark.parametrize("patch", [
    {"selected": []}, {"selected": "x"}, {"selected": [{"position": 1, "videoId": "bad", "title": "t"}]},
    {"selected": [{"position": 1, "videoId": A, "title": ""}]}, {"selected": [{"position": 1, "videoId": A, "title": "t"}, {"position": 1, "videoId": B, "title": "u"}]},
    {"selected": [{"position": 1, "videoId": A, "title": "t"}, {"position": 2, "videoId": A, "title": "u"}]},
    {"fallback": {"title": ""}}, {"fallback": None},
])
def test_commit_validates_the_selection_and_fallback(client, yt, patch):
    body = {**commit_body(sel((1, A, "Intro", 60)), fallback={"title": "T"}), **patch}
    r = post_commit(client, body)
    assert r.status_code == 422
    assert library_ids(client) == {}


@pytest.mark.parametrize("mapping", [{"7": 1}, {"1": 99}, {"1": 1, "2": 1}, {"x": 1}, {"1": True}, {"1": "1"}, [1]])
def test_commit_validates_the_mapping_and_creates_nothing(client, hallu, mapping):
    cand = pv(client).json()["candidates"][0]
    r = post_commit(client, commit_body(sel((1, HID[0], "LSD", 1), (2, HID[1], "Orphic Thrench", 1)), candidate=cand, mapping=mapping))
    assert (r.status_code, r.json()["detail"]) == (422, "bad_mapping")
    assert library_ids(client) == {}
    assert client.get("/albums", headers=H).json() == []


def test_commit_bad_candidate_and_url(client, hallu):
    sl = sel((1, HID[0], "LSD", 1))
    assert post_commit(client, commit_body(sl, candidate={"title": ""})).json()["detail"] == "bad_album"
    r = post_commit(client, {**commit_body(sl, fallback={"title": "T"}), "playlistUrl": "https://example.com/x"})
    assert (r.status_code, r.json()["detail"]) == (400, "bad_url")
    assert library_ids(client) == {}


def test_commit_over_the_cap_creates_nothing(multi, yt, monkeypatch):
    monkeypatch.setenv("USER_MAX_SONGS", "1")
    c, a = multi, who(multi, ALICE)
    r = c.post("/albums/youtube/commit", json=commit_body(sel((1, A, "Intro", 1), (2, B, "Two", 1)), fallback={"title": "T"}), headers=a)
    assert (r.status_code, r.json()["detail"]) == (409, "library_full_songs")
    assert c.get("/library", headers=a).json()["songs"] == []
    assert c.get("/albums", headers=a).json() == []


def test_a_playlist_youtube_link_survives_patch_and_get(client, discogs):
    album = client.post("/albums", json=preview(client).json(), headers=H).json()
    url = f"https://www.youtube.com/watch?v=aaaaaaaaaaa&list={LIST}&index=2&t=9#x"
    got = client.patch(f"/albums/{album['id']}", json={"links": {"youtube": url}}, headers=H).json()
    want = f"https://www.youtube.com/watch?v=aaaaaaaaaaa&list={LIST}"
    assert got["links"]["youtube"] == want
    assert client.get(f"/albums/{album['id']}", headers=H).json()["links"]["youtube"] == want
    assert client.get("/albums", headers=H).json()[0]["links"]["youtube"] == want
    for link in (PL_URL, f"https://www.youtube.com/playlist?list={LIST}&v=aaaaaaaaaaa", f"https://www.youtube.com/watch?list={LIST}"):
        client.patch(f"/albums/{album['id']}", json={"links": {"youtube": link}}, headers=H)
        assert client.get(f"/albums/{album['id']}", headers=H).json()["links"]["youtube"].startswith("https://")
    assert client.patch(f"/albums/{album['id']}", json={"links": {"youtube": "https://www.youtube.com/watch?t=5"}}, headers=H).status_code == 422


def test_commit_gives_songs_without_an_artist_the_album_artist(client, yt, monkeypatch):
    monkeypatch.setattr(album_youtube, "_views", lambda *a: ({}, ""))
    post_commit(client, commit_body(sel((1, A, "Intro", 60), (2, B, "Outro", 90)), fallback={"title": "My Album", "artist": "Derango"}))
    songs = library_ids(client)
    assert songs[A]["mainArtists"] == ["Derango"]
    assert songs[B]["mainArtists"] == ["Derango"]


@pytest.mark.parametrize("fallback", [{"title": "Comp", "artist": "Various Artists"}, {"title": "Solo"}])
def test_commit_leaves_songs_artistless_for_various_artists_or_no_album_artist(client, yt, monkeypatch, fallback):
    monkeypatch.setattr(album_youtube, "_views", lambda *a: ({}, ""))
    post_commit(client, commit_body(sel((1, A, "Intro", 60)), fallback=fallback))
    assert library_ids(client)[A]["mainArtists"] == []


def test_with_album_artist_keeps_a_track_artist():
    entry = {"mainArtists": ["Own"], "title": "t"}
    assert album_youtube._with_album_artist(entry, "Album Artist") is entry


def test_discogs_find_lists_releases_with_type_and_year_first(client, hallu, discogs):
    discogs["data"]["database/search"] = {"results": [
        {"id": 77002, "type": "release", "title": "Hallucinogen - Twisted", "year": "2005", "country": "EU", "format": ["CD", "Compilation"], "label": ["Other"]},
        *HALLU_SEARCH["results"]]}
    r = client.post("/albums/discogs/search", json={"artist": "Hallucinogen", "title": "Twisted", "year": 1995, "all": True}, headers=H)
    data = r.json()
    assert (r.status_code, data["searchError"], data["candidates"][0]["id"], data["candidates"][0]["year"], data["candidates"][0]["type"]) == (200, None, 77001, 1995, "album")
    assert {"id", "url", "title", "artist", "year", "country", "label", "trackCount", "cover", "genres", "type", "kind", "styles", "masterId", "releaseId", "links"} == set(data["candidates"][0])
    assert data["candidates"][0]["label"] == "Dragonfly Records" and data["candidates"][1]["type"] == "compilation"


def test_discogs_find_without_a_token_or_on_failure_is_an_empty_list(client, hallu, discogs, monkeypatch):
    monkeypatch.delenv("DISCOGS_TOKEN")
    r = client.post("/albums/discogs/search", json={"artist": "A", "title": "B"}, headers=H)
    assert (r.status_code, r.json()) == (200, {"candidates": [], "searchError": "discogs_unavailable"})
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    discogs["data"].pop("database/search", None)
    assert client.post("/albums/discogs/search", json={"artist": "A", "title": "B"}, headers=H).json()["candidates"] == []
