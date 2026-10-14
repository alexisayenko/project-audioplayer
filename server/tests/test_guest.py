from collections import deque
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import deps, guest, main, users
from app.ratelimit import KeyedWindow
from tests.test_library import ADIR, H, VID, VID2, client  # noqa: F401
from tests.test_users import ALICE, CSRF, add, key, multi, uid, who  # noqa: F401

OWNER_KEYS = {"email", "uid", "usage", "provider", "owner", "created_at"}
CACHE = "private, no-cache"


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def from_peer(host):
    async def app(scope, receive, send):
        if scope["type"] == "http":
            scope["client"] = (host, 1234)
        await main.app(scope, receive, send)

    return app


def web(host="203.0.113.5", **kw):
    return TestClient(from_peer(host), **kw)


def audio_file(tmp_path, size=10_000):
    d = ADIR(tmp_path)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{VID}.m4a").write_bytes(b"a" * size)


@pytest.fixture
def lib(client, tmp_path):
    assert add(client, H, VID, tags=["genre:house"]).status_code == 202
    audio_file(tmp_path)
    return client


def test_guest_sees_the_owners_library_and_nothing_sensitive(lib):
    owner = lib.get("/library", headers=H).json()["songs"]
    seen = web().get("/library")
    assert seen.status_code == 200
    songs = seen.json()["songs"]
    assert [s["id"] for s in songs] == [s["id"] for s in owner]
    assert songs[0]["title"] == owner[0]["title"]
    assert set(songs[0]) <= guest.SONG_KEYS | {"audio"}
    assert set(songs[0].get("audio", {})) <= set(guest.AUDIO_KEYS)
    assert "@" not in seen.text and uid("alex.isayenko@gmail.com") not in seen.text


def test_scrub_drops_unknown_fields_and_the_audio_file_name():
    out = guest.scrub_song({"id": "x", "title": "t", "secret": 1, "added_by": "a@b.c",
                            "audio": {"file": "x.m4a", "format": "m4a", "size": 3, "duration": 1, "path": "/srv"}})
    assert out == {"id": "x", "title": "t", "audio": {"format": "m4a", "size": 3, "duration": 1}}
    assert guest.scrub_song({"id": "x"}) == {"id": "x"}


def test_guest_reads_tags_graph_catalog_cover_and_health(lib):
    g = web()
    assert g.get("/tags").status_code == 200
    assert g.get("/genres/graph").status_code == 200
    cat = g.get("/catalog")
    assert cat.status_code == 200 and cat.json()["total"] == 1
    assert g.get("/catalog", params={"since": "2020-01-01T00:00:00Z"}).status_code == 200
    assert g.get(f"/covers/{VID2}").status_code == 404
    cdir = deps.covers_dir(users.owner_uid())
    cdir.mkdir(parents=True, exist_ok=True)
    (cdir / f"{VID}.jpg").write_bytes(b"jpg")
    assert g.get(f"/covers/{VID}").content == b"jpg"
    assert g.get("/health").status_code == 200


def test_guest_me_payload_has_exact_keys(lib):
    r = web().get("/me")
    assert r.status_code == 200
    assert r.json() == {"guest": True, "public_view": True, "audio": True, "owner_label": "Alex"}
    assert OWNER_KEYS.isdisjoint(r.json())


def test_me_reports_audio_flag(lib, monkeypatch):
    monkeypatch.setenv("PUBLIC_AUDIO", "0")
    assert web().get("/me").json()["audio"] is False


def test_signed_in_me_is_unchanged(lib):
    body = lib.get("/me", headers=H).json()
    assert body["owner"] is True and "guest" not in body


def test_guest_cannot_write_or_reach_other_routes(lib):
    g = web()
    for method, path in [("POST", "/songs"), ("PATCH", f"/songs/{VID}"), ("DELETE", f"/songs/{VID}"),
                         ("POST", "/preview"), ("GET", "/me/usage"), ("GET", f"/songs/{VID}/status"),
                         ("GET", "/genres"), ("GET", "/auth/me"), ("GET", f"/songs/{VID}/identify")]:
        r = g.request(method, path, json={} if method in ("POST", "PATCH") else None, headers=CSRF)
        assert r.status_code == 401, (method, path, r.status_code)
    assert len(lib.get("/library", headers=H).json()["songs"]) == 1


def test_public_view_off_behaves_like_before(lib, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "0")
    g = web()
    for path in ("/library", "/tags", "/genres/graph", "/catalog", "/me", f"/files/{VID}", f"/covers/{VID}"):
        assert g.get(path).status_code == 401, path
    assert g.get("/health").status_code == 200


def test_no_owner_data_yet_means_401(client):
    assert web().get("/library").status_code == 401


def test_authenticated_non_owner_never_sees_the_owner(multi, tmp_path):
    assert add(multi, H, VID).status_code == 202
    audio_file(tmp_path)
    alice = who(multi, ALICE)
    assert multi.get("/library", headers=alice).json()["songs"] == []
    assert web().get(f"/files/{VID}", headers=alice).status_code == 404
    assert multi.get("/me", headers=alice).json()["email"] == ALICE
    assert multi.get("/catalog", headers=alice).json()["total"] == 0
    assert not multi.get("/tags", headers=alice).json()


def test_bad_credentials_are_not_downgraded_to_guest(lib):
    g = web()
    assert g.get("/library", headers={"X-API-Token": "nope"}).status_code == 401
    assert g.get("/library", headers={"Authorization": "Bearer junk"}).status_code == 401
    assert g.get("/library", params={"token": "x"}).status_code == 401
    assert g.get(f"/files/{VID}", params={"token": "x"}).status_code == 401
    assert g.get(f"/files/{VID}", params={"token": "secret"}).status_code == 200


def test_stale_session_cookie_falls_back_to_guest(lib):
    g = web(cookies={"ap_session": "garbage.value"})
    assert g.get("/me").json()["guest"] is True


def test_public_view_email_selects_another_profile(multi, monkeypatch):
    assert add(multi, who(multi, ALICE), VID2).status_code == 202
    monkeypatch.setenv("PUBLIC_VIEW_EMAIL", ALICE)
    songs = web().get("/library").json()["songs"]
    assert [s["id"] for s in songs] == [VID2]


def test_guest_streams_with_range_and_head(lib):
    g = web()
    full = g.get(f"/files/{VID}")
    assert full.status_code == 200 and len(full.content) == 10_000
    part = g.get(f"/files/{VID}", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    head = g.head(f"/files/{VID}")
    assert head.status_code == 200
    assert head.headers["cache-control"] == CACHE


def test_guest_download_is_blocked_and_audio_flag(lib, monkeypatch):
    g = web()
    r = g.get(f"/files/{VID}", params={"download": 1})
    assert r.status_code == 403 and r.json()["error"] == "guest_download_disabled"
    monkeypatch.setenv("PUBLIC_AUDIO", "0")
    r = g.get(f"/files/{VID}")
    assert r.status_code == 403 and r.json()["error"] == "guest_audio_disabled"
    assert g.head(f"/files/{VID}").status_code == 403
    assert g.get("/library").status_code == 200


def test_owner_may_still_download(lib):
    assert lib.get(f"/files/{VID}", params={"download": 1}, headers=H).status_code == 200


def test_path_traversal_ids_are_rejected(lib):
    g = web()
    assert g.get("/files/..%2F..%2Fetc%2Fpasswd").status_code in (404, 422)
    assert g.get("/files/not-an-id!!").status_code == 422
    assert g.get("/covers/..%2Fx").status_code in (404, 422)
    assert g.get("/files/abcdefghijk").status_code == 404


def test_cache_headers_and_etag(lib):
    g = web()
    for path in ("/library", "/tags", "/genres/graph", "/catalog", "/me", f"/files/{VID}"):
        r = g.get(path)
        assert r.headers["cache-control"] == CACHE, path
        assert r.headers["vary"] == "Cookie, Authorization", path
    first = g.get("/catalog")
    again = g.get("/catalog", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304
    assert again.headers["cache-control"] == CACHE
    assert "public" not in lib.get("/library", headers=H).headers["cache-control"]


def test_request_limit_per_ip_with_rollover(lib, monkeypatch):
    clock = Clock()
    guest.reset(clock)
    monkeypatch.setenv("GUEST_REQ_PER_MIN", "3")
    a, b = web("203.0.113.5"), web("203.0.113.6")
    assert [a.get("/me").status_code for _ in range(3)] == [200, 200, 200]
    r = a.get("/me")
    assert r.status_code == 429 and r.json()["error"] == "guest_limit"
    assert r.json()["retry_after_minutes"] == 1 and int(r.headers["retry-after"]) >= 1
    assert b.get("/me").status_code == 200
    assert lib.get("/me", headers=H).status_code == 200
    clock.now += 61
    assert a.get("/me").status_code == 200


def test_audio_budget_counts_range_bytes_and_rolls_over(lib, monkeypatch):
    clock = Clock()
    guest.reset(clock)
    monkeypatch.setattr(guest, "MB", 1000)
    monkeypatch.setenv("GUEST_AUDIO_MB_PER_HOUR", "10")
    g = web()
    assert g.get(f"/files/{VID}", headers={"Range": "bytes=0-5999"}).status_code == 206
    assert g.get(f"/files/{VID}", headers={"Range": "bytes=6000-9999"}).status_code == 206
    r = g.get(f"/files/{VID}", headers={"Range": "bytes=0-0"})
    assert r.status_code == 429 and r.json()["error"] == "guest_limit"
    assert g.head(f"/files/{VID}").status_code == 200
    assert web("203.0.113.9").get(f"/files/{VID}", headers={"Range": "bytes=0-9"}).status_code == 206
    clock.now += 3601
    assert g.get(f"/files/{VID}").status_code == 200


def test_concurrent_stream_cap(lib, monkeypatch):
    monkeypatch.setenv("GUEST_MAX_STREAMS", "2")
    guest.open_stream("203.0.113.5")
    guest.open_stream("203.0.113.5")
    g = web()
    r = g.get(f"/files/{VID}")
    assert r.status_code == 429 and r.json()["error"] == "guest_limit"
    guest.close_stream("203.0.113.5")
    assert g.get(f"/files/{VID}").status_code == 200
    assert g.get(f"/files/{VID}").status_code == 200
    guest.close_stream("203.0.113.5")
    assert guest._streams == {}


def test_failed_charge_releases_the_stream_slot(lib, monkeypatch):
    monkeypatch.setenv("GUEST_AUDIO_MB_PER_HOUR", "0")
    assert web().get(f"/files/{VID}").status_code == 429
    assert guest._streams == {}


def test_range_bytes_variants():
    assert guest.range_bytes("", 100) == 100
    assert guest.range_bytes("items=1-2", 100) == 100
    assert guest.range_bytes("bytes=0-9", 100) == 10
    assert guest.range_bytes("bytes=90-", 100) == 10
    assert guest.range_bytes("bytes=-20", 100) == 20
    assert guest.range_bytes("bytes=0-9,20-29", 100) == 20
    assert guest.range_bytes("bytes=50-500", 100) == 50
    assert guest.range_bytes("bytes=200-300", 100) == 0
    assert guest.range_bytes("bytes=a-b", 100) == 100


def test_bad_env_numbers_fall_back_to_defaults(monkeypatch):
    monkeypatch.setenv("GUEST_MAX_STREAMS", "many")
    assert guest._number("GUEST_MAX_STREAMS", 3) == 3
    assert guest._number("GUEST_UNSET", 7) == 7


def fake_request(peer, cf=None):
    headers = {"cf-connecting-ip": cf} if cf else {}
    return SimpleNamespace(client=SimpleNamespace(host=peer) if peer is not None else None, headers=headers)


def test_cf_connecting_ip_is_trusted_only_from_loopback_or_lan():
    assert guest.client_ip(fake_request("127.0.0.1", "198.51.100.7")) == "198.51.100.7"
    assert guest.client_ip(fake_request("::1", "198.51.100.7")) == "198.51.100.7"
    assert guest.client_ip(fake_request("192.168.1.10", "198.51.100.7")) == "198.51.100.7"
    assert guest.client_ip(fake_request("10.0.0.2", "2001:db8::1")) == "2001:db8::1"
    assert guest.client_ip(fake_request("203.0.113.5", "198.51.100.7")) == "203.0.113.5"
    assert guest.client_ip(fake_request("127.0.0.1", "not-an-ip")) == "127.0.0.1"
    assert guest.client_ip(fake_request("127.0.0.1")) == "127.0.0.1"
    assert guest.client_ip(fake_request("testclient", "198.51.100.7")) == "testclient"
    assert guest.client_ip(fake_request(None)) == "unknown"


def test_limits_key_on_the_forwarded_ip_through_the_tunnel(lib, monkeypatch):
    monkeypatch.setenv("GUEST_REQ_PER_MIN", "1")
    tunnel = web("127.0.0.1")
    assert tunnel.get("/me", headers={"CF-Connecting-IP": "198.51.100.1"}).status_code == 200
    assert tunnel.get("/me", headers={"CF-Connecting-IP": "198.51.100.1"}).status_code == 429
    assert tunnel.get("/me", headers={"CF-Connecting-IP": "198.51.100.2"}).status_code == 200
    direct = web("203.0.113.5")
    assert direct.get("/me", headers={"CF-Connecting-IP": "198.51.100.3"}).status_code == 200
    assert direct.get("/me", headers={"CF-Connecting-IP": "198.51.100.4"}).status_code == 429


def test_keyed_window_edge_cases():
    now = [0.0]
    w = KeyedWindow(10, 100.0, clock=lambda: now[0])
    assert w.charge("a", 11) == 100.0
    assert w.charge("a", 4) == 0 and w.charge("a", 4) == 0
    assert w.charge("a", 4) == 100.0
    now[0] = 30
    assert w.charge("a", 4) == 70.0
    assert w.charge("a", 2) == 0
    now[0] = 500
    assert w.charge("a", 10) == 0
    for i in range(10001):
        w.hits[f"k{i}"] = deque()
    assert w.charge("z", 1) == 0 and len(w.hits) < 10001
