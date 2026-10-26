import json
import urllib.error
from pathlib import Path

import pytest

from app import albums, discogs_lookup, gitstore
from tests.test_library import H, OWNER_UID, VID, VID2, add, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who  # noqa: F401

RELEASE = json.loads((Path(__file__).parent / "fixtures" / "discogs_release_545650.json").read_text(encoding="utf-8"))
URL = "https://www.discogs.com/release/545650-Derango-Tumult"


@pytest.fixture
def discogs(monkeypatch):
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    state = {"calls": [], "data": {"releases/545650": RELEASE, "masters/77": {"main_release": 545650}}}

    def get(path, params=None):
        state["calls"].append(path)
        if path not in state["data"]:
            raise urllib.error.HTTPError(path, 404, "nf", {}, None)
        return state["data"][path]

    monkeypatch.setattr(discogs_lookup, "_get", get)
    return state


def preview(client, url=URL, headers=H):
    return client.post("/albums/preview", json={"url": url}, headers=headers)


def stored(tmp_path, uid=OWNER_UID):
    return json.loads((tmp_path / "users" / uid / "albums.json").read_text(encoding="utf-8"))["albums"]


def test_preview_parses_tracks_durations_and_skips_headings(client, discogs, tmp_path):
    body = preview(client).json()
    assert (body["title"], body["artist"], body["year"]) == ("Tumult", "Derango", 2004)
    assert body["genres"] == ["Electronic", "Rock", "Hardcore", "Breakbeat"]
    assert body["source"] == {"type": "discogs", "id": "545650", "url": "https://www.discogs.com/release/545650"}
    assert [(t["no"], t["title"], t["durationS"]) for t in body["tracks"]] == [
        (1, "Intro", None), (2, "Tumult Part I", 245), (3, "Suite I", 3723), (4, "Suite II", None), (5, "Disc Two Opener", 59)]
    assert not (tmp_path / "users" / OWNER_UID / "albums.json").exists()


def test_master_resolves_to_main_release(client, discogs):
    body = preview(client, "https://www.discogs.com/master/77-Tumult").json()
    assert body["source"]["id"] == "545650"
    assert discogs["calls"] == ["masters/77", "releases/545650"]


def test_preview_errors(client, discogs, monkeypatch):
    assert preview(client, "https://example.com/release/1").status_code == 400
    assert preview(client, "https://www.discogs.com/artist/1").json()["detail"] == "bad_url"
    assert preview(client, "https://www.discogs.com/release/999").json()["detail"] == "not_found"
    discogs["data"]["masters/5"] = {}
    assert preview(client, "https://www.discogs.com/master/5").status_code == 400
    monkeypatch.delenv("DISCOGS_TOKEN")
    r = preview(client)
    assert (r.status_code, r.json()["detail"]) == (503, "discogs_unavailable")


def test_preview_upstream_failure_is_502(client, discogs, monkeypatch):
    def boom(path, params=None):
        raise OSError("down")

    monkeypatch.setattr(discogs_lookup, "_get", boom)
    assert preview(client).status_code == 502


def test_create_list_get_delete_roundtrip(client, discogs, tmp_path):
    base = preview(client).json()
    payload = {**base, "extra": 1, "id": "alb_evil", "tracks": [{**t, "songId": "x", "junk": 1} for t in base["tracks"]]}
    r = client.post("/albums", json=payload, headers=H)
    assert r.status_code == 201
    album = r.json()
    assert album["id"].startswith("alb_") and album["id"] != "alb_evil" and "extra" not in album
    assert album["genres"] == ["Electronic", "Rock", "Hardcore", "Breakbeat"]
    assert all(t["songId"] is None and "junk" not in t for t in album["tracks"])
    assert album["created_at"]
    assert stored(tmp_path)[0]["id"] == album["id"]
    assert client.get("/albums", headers=H).json() == [
        {"id": album["id"], "title": "Tumult", "artist": "Derango", "year": 2004, "genres": ["Electronic", "Rock", "Hardcore", "Breakbeat"], "trackCount": 5, "created_at": album["created_at"]}]
    assert client.get(f"/albums/{album['id']}", headers=H).json() == album
    assert client.delete(f"/albums/{album['id']}", headers=H).status_code == 200
    assert client.get("/albums", headers=H).json() == []
    assert client.get(f"/albums/{album['id']}", headers=H).status_code == 404
    assert client.delete(f"/albums/{album['id']}", headers=H).status_code == 404


def test_duplicate_source_is_409_with_existing_id(client, discogs):
    first = client.post("/albums", json=preview(client).json(), headers=H).json()
    r = client.post("/albums", json=preview(client).json(), headers=H)
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "already_exists", "id": first["id"]}


@pytest.mark.parametrize("patch", [
    {"title": ""}, {"tracks": []}, {"source": {"type": "mb", "id": "1"}}, {"source": {"type": "discogs", "id": "x"}},
    {"tracks": [{"title": ""}]}, {"tracks": "no"},
])
def test_create_revalidates(client, discogs, patch):
    r = client.post("/albums", json={**preview(client).json(), **patch}, headers=H)
    assert r.status_code == 422


def test_create_clamps_genres(client, discogs):
    body = {**preview(client).json(), "genres": ["a", "A", " b ", 5] + [str(i) for i in range(20)]}
    got = client.post("/albums", json=body, headers=H).json()["genres"]
    assert got[:3] == ["a", "b", "5"] and len(got) == 20


def test_bad_durations_and_year_are_nulled(client, discogs):
    body = {**preview(client).json(), "year": "x", "tracks": [{"title": "A", "durationS": -3}, {"title": "B", "durationS": True}]}
    album = client.post("/albums", json=body, headers=H).json()
    assert album["year"] is None and [t["durationS"] for t in album["tracks"]] == [None, None]
    assert [t["no"] for t in album["tracks"]] == [1, 2]


def test_albums_are_per_user_and_need_a_login(multi, discogs):
    c = multi
    a, b = who(c, ALICE), who(c, BOB)
    payload = c.post("/albums/preview", json={"url": URL}, headers=a).json()
    made = c.post("/albums", json=payload, headers=a).json()
    assert c.get("/albums", headers=b).json() == []
    assert c.get(f"/albums/{made['id']}", headers=b).status_code == 404
    assert c.delete(f"/albums/{made['id']}", headers=b).status_code == 404
    assert c.post("/albums", json=payload, headers=b).status_code == 201
    for method, path in (("get", "/albums"), ("post", "/albums/preview"), ("get", "/albums/alb_00000000")):
        assert getattr(c, method)(path).status_code == 401


def test_tolerant_reader(tmp_path):
    path = tmp_path / "albums.json"
    assert albums.load(path) == []
    for text in ("{", "[]", '{"albums": 3}'):
        path.write_text(text, encoding="utf-8")
        assert albums.load(path) == []
    path.write_text('{"albums": [{"id": "alb_00000002", "tracks": [], "genres": "x"}]}', encoding="utf-8")
    assert albums.load(path)[0]["genres"] == []
    path.write_text('{"albums": [1, {"id": 2}, {"id": "alb_00000001", "tracks": []}]}', encoding="utf-8")
    assert [a["id"] for a in albums.load(path)] == ["alb_00000001"]


@pytest.mark.parametrize("value,expected", [("3:07", 187), ("1:02:03", 3723), ("", None), (None, None), ("0:00", None), ("12", None), ("a:b", None)])
def test_parse_duration(value, expected):
    assert albums.parse_duration(value) == expected


def test_sync_loader_check_and_watch_list():
    check = gitstore.check_inbound_json
    rel = "audioplayer/users/x/albums.json"
    assert "albums.json" in gitstore.WATCHED_JSON
    assert check(rel, json.dumps({"albums": []})) is None
    assert check(rel, json.dumps({"albums": {}})) == "not an album list"
    assert check(rel, "[]") == "not an object"
    assert check(rel, "{") == "not valid JSON"


def made_album(client):
    return client.post("/albums", json=preview(client).json(), headers=H).json()


def link(client, album, no, song, headers=H):
    return client.put(f"/albums/{album['id']}/tracks/{no}/song", json={"songId": song}, headers=headers)


def test_link_and_unlink_a_song(client, discogs, tmp_path):
    assert add(client).status_code == 202
    album = made_album(client)
    r = link(client, album, 2, VID)
    assert r.status_code == 200 and r.json()["tracks"][1]["songId"] == VID
    assert client.get(f"/albums/{album['id']}", headers=H).json()["tracks"][1]["songId"] == VID
    assert stored(tmp_path)[0]["tracks"][1]["songId"] == VID
    assert link(client, album, 2, VID).status_code == 200
    r = client.delete(f"/albums/{album['id']}/tracks/2/song", headers=H)
    assert r.status_code == 200 and r.json()["tracks"][1]["songId"] is None


def test_link_errors(client, discogs):
    add(client)
    add(client, VID2)
    album = made_album(client)
    assert link(client, album, 1, "zzzzzzzzzzz").json()["detail"] == "song_not_found"
    assert link(client, album, 9, VID).json()["detail"] == "track_not_found"
    assert client.delete(f"/albums/{album['id']}/tracks/9/song", headers=H).json()["detail"] == "track_not_found"
    assert link(client, {"id": "alb_00000000"}, 1, VID).status_code == 404
    assert link(client, album, 1, VID).status_code == 200
    r = link(client, album, 3, VID)
    assert (r.status_code, r.json()["detail"]) == (409, {"code": "already_linked", "no": 1})
    assert link(client, album, 3, VID2).status_code == 200
    assert client.put(f"/albums/{album['id']}/tracks/1/song", json={}, headers=H).status_code == 422


def test_deleted_songs_read_as_unlinked(client, discogs, tmp_path):
    add(client)
    album = made_album(client)
    link(client, album, 1, VID)
    assert client.delete(f"/songs/{VID}", headers=H).status_code == 204
    assert client.get(f"/albums/{album['id']}", headers=H).json()["tracks"][0]["songId"] is None
    assert stored(tmp_path)[0]["tracks"][0]["songId"] == VID
    assert link(client, album, 2, VID).status_code == 404


def test_link_is_per_user_and_needs_a_login(multi, discogs):
    c = multi
    a, b = who(c, ALICE), who(c, BOB)
    album = c.post("/albums", json=c.post("/albums/preview", json={"url": URL}, headers=a).json(), headers=a).json()
    assert link(c, album, 1, VID, b).status_code == 404
    assert c.delete(f"/albums/{album['id']}/tracks/1/song", headers=b).status_code == 404
    assert link(c, album, 1, VID, {}).status_code == 401
    assert c.delete(f"/albums/{album['id']}/tracks/1/song").status_code == 401
