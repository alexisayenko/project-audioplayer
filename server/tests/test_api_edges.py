import json
import logging
import threading
import time
from types import SimpleNamespace
from urllib.parse import unquote

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app import bpm, deps, downloads, extractor, identify, jobs, library, limits, links, main, session, users
from app.routes import analyze, lookup
from fastapi import HTTPException
from app.problems import Problem
from tests.test_library import ADIR, H, ODIR, OWNER_UID, VID, VID2, client  # noqa: F401
from tests.test_users import ALICE, BOB, CSRF, VID3, VID4, add, key, multi, token, uid, who  # noqa: F401

SC_URL = "https://soundcloud.com/some-artist/some-track"
PUBLIC = {"/auth/config", "/auth/session", "/auth/logout", "/health", "/legal", "/robots.txt", "/", "/index.html", "/_v/{version}/{path:path}"}


def owner_add(client, vid=VID, **kw):
    return add(client, H, vid, **kw)


# ---- auth on every route, at runtime ---------------------------------------------------------

def test_every_protected_route_answers_401_without_credentials(client):
    seen = 0
    for route in main.app.routes:
        if not isinstance(route, APIRoute) or route.path in PUBLIC:
            continue
        path = route.path.replace("{video_id}", VID)
        for method in route.methods - {"HEAD"}:
            r = client.request(method, path, json={} if method in ("POST", "PATCH", "PUT") else None)
            assert r.status_code == 401, (method, route.path, r.status_code)
            seen += 1
    assert seen >= 20


def test_every_protected_route_rejects_a_wrong_token_and_garbage_bearer(client):
    for headers in ({"X-API-Token": "nope"}, {"Authorization": "Bearer junk"}, {"Authorization": "Basic Zm9vOmJhcg=="}, {"Authorization": "Bearer "}):
        assert client.get("/library", headers=headers).status_code == 401, headers
        assert client.get("/me/usage", headers=headers).status_code == 401, headers


def test_api_token_header_wins_over_a_valid_bearer_and_is_not_bypassed(multi):
    r = multi.get("/me", headers={**who(multi, ALICE), "X-API-Token": "wrong"})
    assert r.status_code == 401
    r = multi.get("/me", headers={**who(multi, ALICE), **H})
    assert r.json()["owner"] is True


def test_query_token_is_accepted_for_files_only(client, tmp_path):
    ADIR(tmp_path).mkdir(parents=True)
    (ADIR(tmp_path) / f"{VID}.m4a").write_bytes(b"audio")
    assert client.get(f"/files/{VID}", params={"token": "secret"}).status_code == 200
    assert client.get(f"/files/{VID}", params={"token": "wrong"}).status_code == 401
    assert client.get("/library", params={"token": "secret"}).status_code == 401
    assert client.get("/me", params={"token": "secret"}).status_code == 401


def test_unconfigured_api_token_gives_503_not_open_access(client, monkeypatch):
    monkeypatch.delenv("AUDIO_API_TOKEN")
    assert client.get("/library").status_code == 503
    assert client.get("/library", headers={"X-API-Token": ""}).status_code == 503
    assert client.get("/library", headers={"X-API-Token": "anything"}).status_code == 503


# ---- sessions --------------------------------------------------------------------------------

def test_session_endpoint_needs_csrf_then_a_secret_then_a_valid_token(multi, monkeypatch):
    body = {"id_token": token(multi.key, ALICE)}
    assert multi.post("/auth/session", json=body).status_code == 403
    assert multi.post("/auth/session", json=body, headers={"X-Requested-With": "other"}).status_code == 403
    assert multi.post("/auth/session", json=body, headers={**CSRF, "Origin": "https://evil.example"}).status_code == 403
    monkeypatch.delenv("AUDIO_API_TOKEN")
    assert multi.post("/auth/session", json=body, headers=CSRF).status_code == 503
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    assert multi.post("/auth/session", json={"id_token": "junk"}, headers=CSRF).status_code == 401
    assert multi.post("/auth/session", json={"id_token": ""}, headers=CSRF).status_code == 422
    assert multi.post("/auth/session", json={"id_token": "x" * 8193}, headers=CSRF).status_code == 422
    assert multi.post("/auth/session", json={}, headers=CSRF).status_code == 422


def test_session_cookie_flags(multi):
    r = multi.post("/auth/session", json={"id_token": token(multi.key, ALICE)}, headers=CSRF)
    assert r.status_code == 200
    cookie = r.headers["set-cookie"]
    assert cookie.startswith("__Host-session=")
    for flag in ("HttpOnly", "Secure", "SameSite=strict", "Path=/"):
        assert flag.lower() in cookie.lower()
    assert f"Max-Age={session.LIFETIME}" in cookie
    assert "Domain" not in cookie


def test_unverified_google_email_cannot_open_a_session(multi):
    r = multi.post("/auth/session", json={"id_token": token(multi.key, ALICE, email_verified=False)}, headers=CSRF)
    assert r.status_code == 403
    assert r.json()["error"] == "unverified_email"
    assert "set-cookie" not in r.headers


def test_logout_needs_csrf_and_clears_the_cookie(multi):
    assert multi.post("/auth/logout").status_code == 403
    r = multi.post("/auth/logout", headers=CSRF)
    assert r.status_code == 204
    assert "__Host-session" in r.headers["set-cookie"]
    assert "Max-Age=0" in r.headers["set-cookie"]


@pytest.fixture
def https(multi):
    return TestClient(main.app, base_url="https://testserver")


def cookie_for(https, value):
    https.headers["Cookie"] = f"__Host-session={value}"


def test_expired_and_tampered_session_cookies_are_refused(https, multi):
    ident = {"provider": "google", "email": ALICE, "uid": uid(ALICE)}
    cookie_for(https, session.issue(ident))
    assert https.get("/me").json()["email"] == ALICE
    cookie_for(https, session.issue(ident, now=time.time() - session.LIFETIME - 5))
    assert https.get("/me").status_code == 401
    body, sig = session.issue(ident).split(".")
    for bad in (f"{body}.{sig[::-1]}", f"{body}x.{sig}", body, "", "a.b.c"):
        cookie_for(https, bad)
        assert https.get("/me").status_code == 401, bad


def test_cookie_authenticated_writes_need_csrf_header_and_same_origin(https, multi):
    cookie_for(https, session.issue({"provider": "google", "email": ALICE, "uid": uid(ALICE)}))
    body = {"url": VID, "metadata": {"title": "S"}, "audio": False}
    assert https.post("/songs", json=body).status_code == 403
    assert https.post("/songs", json=body, headers={"X-Requested-With": "x"}).status_code == 403
    assert https.post("/songs", json=body, headers={**CSRF, "Origin": "https://evil.example"}).status_code == 403
    assert https.post("/songs", json=body, headers={**CSRF, "Origin": "https://testserver"}).status_code == 201
    assert https.delete(f"/songs/{VID}").status_code == 403
    assert https.get("/library").status_code == 200
    assert https.delete(f"/songs/{VID}", headers=CSRF).status_code == 204


def test_cookie_for_a_closed_signup_user_is_refused_but_owner_cookie_works(https, multi, monkeypatch):
    monkeypatch.setenv("SIGNUP_OPEN", "0")
    cookie_for(https, session.issue({"provider": "google", "email": "new@example.com", "uid": ""}))
    r = https.get("/library")
    assert r.status_code == 403
    assert r.json()["error"] == "signup_closed"
    cookie_for(https, session.issue({"provider": "google", "email": users.owner_email(), "uid": ""}))
    assert https.get("/me").json()["owner"] is True


def test_find_uid_by_sub_scans_profiles_then_caches(multi, tmp_path):
    users.write_profile(tmp_path / "users" / "abc123" / "profile.json", {"subs": {"apple": "SUB.1"}})
    assert deps.find_uid_by_sub("apple", "SUB.1") == "abc123"
    (tmp_path / "users" / "abc123" / "profile.json").unlink()
    assert deps.find_uid_by_sub("apple", "SUB.1") == "abc123"
    assert deps.find_uid_by_sub("apple", "OTHER") is None
    assert deps.find_uid_by_sub("google", "SUB.1") is None


def test_startup_recovers_git_only_when_configured(monkeypatch):
    calls = []
    monkeypatch.setattr(main.migrate_tags, "run", lambda: 0)
    monkeypatch.setattr(main.migrate_credits, "run", lambda: 0)
    monkeypatch.setattr(deps, "SYNC", SimpleNamespace(recover_on_startup=lambda: calls.append(1)))
    main._startup()
    monkeypatch.setattr(deps, "SYNC", None)
    main._startup()
    assert calls == [1]


# ---- identifiers and per-user file paths ----------------------------------------------------

BAD_IDS = ["..%2F..%2Fetc%2Fpasswd", "%2e%2e", "a%00b", "%5C..%5Cwin", "x" * 11 + "%2F", "dQw4w9WgXc", "dQw4w9WgXcQQ", "soundcloud-abc", "spotify-", "%E2%80%AE" + "x" * 8]


@pytest.mark.parametrize("bad", BAD_IDS)
def test_malformed_song_ids_are_rejected_everywhere_without_a_500(client, bad):
    for method, path in (("get", f"/files/{bad}"), ("get", f"/covers/{bad}"), ("get", f"/songs/{bad}/status"), ("delete", f"/songs/{bad}"),
                         ("delete", f"/songs/{bad}/audio"), ("post", f"/songs/{bad}/audio"), ("post", f"/songs/{bad}/bpm/detect"),
                         ("get", f"/songs/{bad}/identify"), ("post", f"/songs/{bad}/identify"), ("patch", f"/songs/{bad}")):
        r = getattr(client, method)(path, headers=H, **({"json": {"title": "x"}} if method == "patch" else {}))
        assert r.status_code in (404, 405, 422), (method, path, r.status_code)


def test_symlink_escaping_the_user_audio_dir_is_not_served(client, tmp_path):
    secret = tmp_path / "secret.m4a"
    secret.write_bytes(b"TOP SECRET")
    ADIR(tmp_path).mkdir(parents=True)
    try:
        (ADIR(tmp_path) / f"{VID}.m4a").symlink_to(secret)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unavailable")
    r = client.get(f"/files/{VID}", headers=H)
    assert r.status_code == 404
    assert b"SECRET" not in r.content
    assert client.get(f"/files/{VID}", params={"download": 1}, headers=H).json()["error"] == "audio_not_downloaded"


def test_file_field_with_path_components_never_leaves_the_user_dir(client, tmp_path):
    ODIR(tmp_path).mkdir(parents=True)
    (tmp_path / "outside.m4a").write_bytes(b"x")
    (ODIR(tmp_path) / "library.json").write_text(json.dumps({"songs": [
        {"id": VID, "file": "../../../outside.m4a", "title": "evil"}, {"id": VID2, "file": "/etc/passwd", "title": "abs"}]}))
    assert client.get(f"/files/{VID}", headers=H).status_code == 404
    assert client.get(f"/files/{VID2}", headers=H).status_code == 404
    assert library.file_name({"id": VID, "file": "../../../outside.m4a"}) == "outside.m4a"


def test_covers_are_per_user_and_traversal_safe(multi, tmp_path):
    a, b = who(multi, ALICE), who(multi, BOB)
    assert add(multi, a).status_code == 202
    assert multi.get(f"/covers/{VID}", headers=a).status_code == 200
    assert multi.get(f"/covers/{VID}", headers=b).status_code == 404
    assert multi.get(f"/covers/{VID}", params={"token": "secret"}).status_code == 404
    assert multi.get("/covers/..%2F..%2Fusers", headers=a).status_code in (404, 422)


def test_range_requests_and_headers_on_files(client):
    owner_add(client)
    r = client.get(f"/files/{VID}", headers={**H, "Range": "bytes=1-3"})
    assert r.status_code == 206
    assert r.content == b"udi"
    assert r.headers["content-range"] == "bytes 1-3/5"
    assert client.get(f"/files/{VID}", headers={**H, "Range": "bytes=2-"}).content == b"dio"
    assert client.get(f"/files/{VID}", headers={**H, "Range": "bytes=-2"}).content == b"io"
    assert client.get(f"/files/{VID}", headers={**H, "Range": "bytes=99-"}).status_code == 416
    full = client.get(f"/files/{VID}", headers=H)
    assert full.headers["accept-ranges"] == "bytes"
    assert full.headers["content-type"] == "audio/mp4"
    assert full.headers["cache-control"] == "private, no-cache"
    assert client.head(f"/files/{VID}", headers=H).status_code == 200


def test_download_name_cyrillic_uses_rfc5987_and_ascii_fallback(client):
    owner_add(client, metadata={"title": "Группа крови", "artist": "Кино"})
    header = client.get(f"/files/{VID}", params={"download": 1}, headers=H).headers["content-disposition"]
    assert header.startswith("attachment; filename=\"")
    assert "filename*=UTF-8''" in header
    star = header.split("filename*=UTF-8''")[1]
    assert unquote(star) == "Кино - Группа крови.m4a"
    header.encode("ascii")
    fallback = header.split('filename="')[1].split('"')[0]
    assert fallback.isascii()
    assert "/" not in fallback
    assert fallback.endswith(".m4a")


def test_download_name_cannot_inject_headers_or_paths(client):
    owner_add(client, metadata={"title": 'a"; evil=1\r\nX-Injected: 1/../..\\x', "artist": "%0d%0a"})
    r = client.get(f"/files/{VID}", params={"download": 1}, headers=H)
    header = r.headers["content-disposition"]
    assert "x-injected" not in r.headers
    assert "\r" not in header
    assert "\n" not in header
    star = unquote(header.split("filename*=UTF-8''")[1])
    assert not any(c in star for c in '/\\"\r\n')


def test_download_of_a_metadata_only_song_is_a_structured_404(client):
    owner_add(client, audio=False)
    r = client.get(f"/files/{VID}", params={"download": 1}, headers=H)
    assert r.status_code == 404
    assert r.json()["error"] == "audio_not_downloaded"
    r = client.get(f"/files/{VID}", headers=H)
    assert r.status_code == 404
    assert r.json() == {"detail": "not downloaded"}


# ---- catalog ETag ----------------------------------------------------------------------------

def test_catalog_etag_revalidation_forms(client):
    owner_add(client)
    first = client.get("/catalog", headers=H)
    etag = first.headers["etag"]
    assert first.status_code == 200
    assert first.headers["cache-control"] == "private, no-cache"
    for sent in (etag, f"W/{etag}", "*", f'"zzz", {etag}'):
        r = client.get("/catalog", headers={**H, "If-None-Match": sent})
        assert r.status_code == 304, sent
        assert r.content == b"", sent
        assert r.headers["etag"] == etag, sent
    assert client.get("/catalog", headers={**H, "If-None-Match": '"other"'}).status_code == 200
    owner_add(client, VID2)
    assert client.get("/catalog", headers={**H, "If-None-Match": etag}).status_code == 200


def test_catalog_since_is_validated_and_filters(client):
    owner_add(client)
    for bad in ("yesterday", "2020-01-01", "2020-01-01T00:00:00", "2020-01-01 00:00:00Z", "2020-01-01T00:00:00+01:00", "' OR 1=1"):
        assert client.get("/catalog", params={"since": bad}, headers=H).status_code == 422, bad
    future = client.get("/catalog", params={"since": "2999-01-01T00:00:00Z"}, headers=H).json()
    assert future["songs"] == []
    assert future["total"] == 1
    assert future["ids"] == [VID]
    past = client.get("/catalog", params={"since": "2000-01-01T00:00:00Z"}, headers=H)
    assert len(past.json()["songs"]) == 1
    assert past.headers["etag"] != client.get("/catalog", headers=H).headers["etag"]


# ---- quotas through the API with an injected clock -------------------------------------------

def test_song_quota_exact_limit_and_delete_frees_a_slot(multi, monkeypatch):
    monkeypatch.setenv("USER_MAX_SONGS", "2")
    a = who(multi, ALICE)
    assert add(multi, a, VID).status_code == 202
    assert add(multi, a, VID2).status_code == 202
    r = add(multi, a, VID3)
    assert (r.status_code, r.json()["error"]) == (403, "library_full_songs")
    assert add(multi, a, VID3, audio=False).status_code == 403
    assert multi.delete(f"/songs/{VID}", headers=a).status_code == 204
    assert add(multi, a, VID3).status_code == 202


def test_hourly_window_rolls_over_with_an_injected_clock(multi, monkeypatch):
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "2")
    now = {"t": time.time()}
    monkeypatch.setattr(limits.time, "time", lambda: now["t"])
    a = who(multi, ALICE)
    assert add(multi, a, VID).status_code == 202
    now["t"] += 1800
    assert add(multi, a, VID2).status_code == 202
    r = add(multi, a, VID3)
    assert r.status_code == 429
    assert r.json()["retry_after_minutes"] == 30
    assert r.headers["retry-after"] == "1800"
    now["t"] += 1800
    assert add(multi, a, VID3).status_code == 202
    r = add(multi, a, VID4)
    assert r.status_code == 429
    assert r.json()["retry_after_minutes"] == 30
    now["t"] += 3600
    assert add(multi, a, VID4).status_code == 202


def test_owner_has_no_quota_and_a_full_pool_blocks_everyone(multi, monkeypatch):
    monkeypatch.setenv("USER_MAX_SONGS", "1")
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "1")
    for v in (VID, VID2, VID3):
        assert add(multi, H, v).status_code == 202
    monkeypatch.setenv("POOL_MAX_BYTES", "1")
    r = add(multi, H, VID4)
    assert (r.status_code, r.json()["error"]) == (503, "server_full")
    assert add(multi, H, VID4, audio=False).status_code == 201


def test_usage_endpoint_boundaries(multi, monkeypatch):
    monkeypatch.setenv("USER_MAX_SONGS", "3")
    a = who(multi, ALICE)
    add(multi, a, VID)
    u = multi.get("/me/usage", headers=a).json()
    assert (u["songs"], u["max_songs"], u["adds_last_hour"], u["bytes"]) == (1, 3, 1, 5)
    o = multi.get("/me/usage", headers=H).json()
    assert o["max_songs"] is None
    assert o["max_bytes"] is None
    assert o["max_adds"] is None


# ---- scheduler: caps under real threads ------------------------------------------------------

class Gate:
    def __init__(self):
        self.running, self.order, self.lock = [], [], threading.Lock()
        self.events = {}

    def job(self, name):
        ev = self.events.setdefault(name, threading.Event())

        def run():
            with self.lock:
                self.running.append(name)
                self.order.append(name)
            ev.wait(5)
            with self.lock:
                self.running.remove(name)

        return run

    def release(self, name):
        self.events.setdefault(name, threading.Event()).set()


def wait_until(cond, secs=3):
    end = time.time() + secs
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.005)
    return False


def test_scheduler_per_user_global_caps_fifo_and_owner_exemption(monkeypatch):
    monkeypatch.setenv("USER_MAX_CONCURRENT_DOWNLOADS", "1")
    monkeypatch.setenv("GLOBAL_MAX_CONCURRENT_DOWNLOADS", "2")
    s, g, started = jobs.Scheduler(), Gate(), []
    sub = lambda uid, ex, n: s.submit(uid, ex, g.job(n), lambda: started.append(n))  # noqa: E731
    assert sub("a", False, "a1") is True
    assert sub("a", False, "a2") is False
    assert sub("b", False, "b1") is True
    assert sub("c", False, "c1") is False
    assert wait_until(lambda: set(g.running) == {"a1", "b1"})
    assert sub("o", True, "o1") is False
    g.release("b1")
    assert wait_until(lambda: "c1" in g.running)
    assert "a2" not in g.running
    assert "o1" not in g.running
    g.release("a1")
    assert wait_until(lambda: "a2" in g.running or "o1" in g.running)
    for n in ("a2", "c1", "o1"):
        g.release(n)
    assert wait_until(lambda: len(g.order) == 5 and not g.running)
    assert g.order == ["a1", "b1", "c1", "a2", "o1"]
    assert wait_until(lambda: s._running == 0)
    assert s._running == 0
    assert all(v == 0 for v in s._by_user.values())


def test_scheduler_exempt_owner_ignores_user_cap_but_not_global(monkeypatch):
    monkeypatch.setenv("USER_MAX_CONCURRENT_DOWNLOADS", "1")
    monkeypatch.setenv("GLOBAL_MAX_CONCURRENT_DOWNLOADS", "3")
    s, g = jobs.Scheduler(), Gate()
    results = [s.submit("owner", True, g.job(f"o{i}"), lambda: None) for i in range(4)]
    assert results == [True, True, True, False]
    assert wait_until(lambda: len(g.running) == 3)
    g.release("o0")
    assert wait_until(lambda: "o3" in g.running)
    for i in range(4):
        g.release(f"o{i}")
    assert wait_until(lambda: not g.running and s._running == 0)


def test_scheduler_survives_a_crashing_job_and_frees_its_slot(monkeypatch, caplog):
    monkeypatch.setenv("GLOBAL_MAX_CONCURRENT_DOWNLOADS", "1")
    s, g = jobs.Scheduler(), Gate()

    def crash():
        raise RuntimeError("boom")

    with caplog.at_level(logging.ERROR):
        s.submit("a", False, crash, lambda: None)
        s.submit("b", False, g.job("b1"), lambda: None)
        assert wait_until(lambda: "b1" in g.running)
    g.release("b1")
    assert wait_until(lambda: s._running == 0)
    assert "download job crashed" in caplog.text


def test_scheduled_waits_for_result_and_reraises_errors(monkeypatch):
    assert downloads.run_scheduled("u", False, lambda: 7) == 7
    with pytest.raises(ValueError, match="bad"):
        downloads.run_scheduled("u", False, lambda: (_ for _ in ()).throw(ValueError("bad")))

    def swallow(uid, exempt, run, started):
        try:
            run()
        except BaseException:
            pass

    monkeypatch.setattr(deps.SCHED, "submit", swallow)
    with pytest.raises(RuntimeError, match="stopped"):
        downloads.run_scheduled("u", False, lambda: (_ for _ in ()).throw(SystemExit()))


# ---- legacy /download, preview, metadata, add ------------------------------------------------

def test_legacy_download_failure_is_502_and_soundcloud_is_422(client, monkeypatch):
    monkeypatch.setattr(extractor, "download", lambda v, d: (_ for _ in ()).throw(RuntimeError("yt blew up")))
    r = client.post("/download", json={"video_id": VID}, headers=H)
    assert r.status_code == 502
    assert "yt blew up" in r.json()["detail"]
    assert client.post("/download", json={"video_id": "soundcloud-123"}, headers=H).status_code == 422
    assert client.post("/download", json={}, headers=H).status_code == 422


def test_preview_failure_is_502_with_short_message(client, monkeypatch):
    monkeypatch.setattr(extractor, "preview", lambda v: (_ for _ in ()).throw(RuntimeError("ERROR: x. Use --cookies for auth")))
    r = client.post("/preview", json={"url": VID}, headers=H)
    assert r.status_code == 502
    assert "--cookies" not in r.json()["detail"]
    for bad in ("", "not a url", "https://example.com/watch?v=" + VID, "https://soundcloud.com/discover/x"):
        r = client.post("/preview", json={"url": bad}, headers=H)
        assert r.status_code == 422, bad
        assert r.json()["error"] == "unsupported", bad


def test_metadata_with_a_soundcloud_source_uses_the_probe(client, monkeypatch):
    probe = {"id": "soundcloud-1", "source_url": SC_URL, "title": "T", "artist": "A", "album": "Alb", "year": 2020, "tags": ["genre:techno"],
             "preview_only": False}
    monkeypatch.setattr(extractor, "soundcloud_probe", lambda url: probe)
    r = client.post("/metadata", json={"title": "T", "artist": "A", "sources": [{"url": SC_URL}, {"url": "  "}]}, headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["album"] == "Alb"
    assert body["year"] is None
    assert lookup.source_info(SC_URL) is probe


def test_add_rejects_unknown_country_and_unsupported_links(client):
    r = owner_add(client, tags=["country:Atlantis"])
    assert r.status_code == 422
    assert r.json()["error"] == "unknown_country"
    assert r.json()["value"] == "atlantis"
    assert owner_add(client, tags=["country:Neverland"]).status_code == 422
    assert owner_add(client, tags=["country:germany"]).status_code == 202
    r = client.post("/songs", json={"url": "https://example.com/x", "metadata": {"title": "t"}}, headers=H)
    assert r.status_code == 422
    assert client.post("/songs", json={"metadata": {}}, headers=H).status_code == 422
    assert client.post("/songs", json={"url": VID, "metadata": {"year": 99999}}, headers=H).status_code == 422
    assert client.post("/songs", json={"url": VID, "metadata": {"bpm": 5}}, headers=H).status_code == 422


def test_add_twice_is_409_and_patch_validations(client):
    assert owner_add(client).status_code == 202
    assert owner_add(client).status_code == 409
    assert client.patch(f"/songs/{VID}", json={"title": "  "}, headers=H).status_code == 422
    assert client.patch(f"/songs/{VID}", json={"tags": ["country:Narnia"]}, headers=H).json()["error"] == "unknown_country"
    assert client.patch(f"/songs/{VID2}", json={"title": "x"}, headers=H).status_code == 404
    assert client.patch(f"/songs/{VID}", json={"year": 1994}, headers=H).json()["tags"].count("decade:90s") == 1
    assert client.patch(f"/songs/{VID}", json={"year": 1999}, headers=H).json()["tags"].count("decade:90s") == 1
    assert "decade:00s" in client.patch(f"/songs/{VID}", json={"year": 2000}, headers=H).json()["tags"]
    assert not any(t.startswith("decade:") for t in client.patch(f"/songs/{VID}", json={"year": 1949, "tags": []}, headers=H).json()["tags"])


def test_patch_keeps_a_legacy_unknown_country_the_song_already_has(client, tmp_path):
    ODIR(tmp_path).mkdir(parents=True)
    (ODIR(tmp_path) / "library.json").write_text(json.dumps({"songs": [{"id": VID, "title": "t", "file": None, "tags": ["country:Atlantis"]}]}))
    r = client.patch(f"/songs/{VID}", json={"tags": ["country:Atlantis", "rock"]}, headers=H)
    assert r.status_code == 200
    assert client.patch(f"/songs/{VID}", json={"tags": ["country:Mordor"]}, headers=H).status_code == 422


# ---- metadata-only add and fetch-audio branches ----------------------------------------------

def test_metadata_only_add_survives_preview_and_cover_failures(client, monkeypatch):
    monkeypatch.setattr(extractor, "preview", lambda v: (_ for _ in ()).throw(RuntimeError("no net")))
    monkeypatch.setattr(extractor, "fetch_cover", lambda *a, **k: (_ for _ in ()).throw(OSError("no cover")))
    r = owner_add(client, audio=False, metadata={"title": "Only Title"})
    assert r.status_code == 201
    song = r.json()["song"]
    assert song["title"] == "Only Title"
    assert song["audio_state"] == "none"
    assert not song.get("cover")
    assert client.get(f"/covers/{VID}", headers=H).status_code == 404


def test_metadata_only_add_conflict_when_the_song_appears_meanwhile(client):
    uid_ = OWNER_UID
    assert owner_add(client, audio=False).status_code == 201
    link = links.Resolved(VID, extractor.watch_url(VID))
    deps.JOBS[(uid_, VID)] = {"status": "queued"}
    with pytest.raises(HTTPException) as ei:
        downloads.add_metadata_only(uid_, VID, link, {"title": "again"}, [])
    assert ei.value.status_code == 409
    assert (uid_, VID) not in deps.JOBS


@pytest.fixture
def catalog_song(client, monkeypatch):
    monkeypatch.setattr(extractor, "preview", lambda v: (_ for _ in ()).throw(RuntimeError("no net")))
    monkeypatch.setattr(extractor, "fetch_cover", lambda *a, **k: (_ for _ in ()).throw(OSError("no cover")))
    assert owner_add(client, audio=False, metadata={"title": "Cat"}).status_code == 201
    return client


def job_state(client):
    return client.get(f"/songs/{VID}/status", headers=H).json()


def test_fetch_audio_bpm_failure_and_missing_cover_are_tolerated(catalog_song, monkeypatch, tmp_path):
    client = catalog_song
    monkeypatch.setattr(bpm, "detect_bpm", lambda p: (_ for _ in ()).throw(RuntimeError("aubio")))
    covers = []
    monkeypatch.setattr(extractor, "fetch_cover", lambda v, d, a=None: covers.append(d) or d.parent.mkdir(parents=True, exist_ok=True) or d.write_bytes(b"j"))
    monkeypatch.setattr(extractor, "download_audio", lambda v, out, progress=None, source_url=None: (out.mkdir(parents=True, exist_ok=True), (out / f"{v}.m4a").write_bytes(b"aud"), {"duration": 33, "thumbnail": "t"})[2])
    assert client.post(f"/songs/{VID}/audio", headers=H).status_code == 202
    song = client.get("/library", headers=H).json()["songs"][0]
    assert song["audio_state"] == "server"
    assert song["duration"] == 33
    assert song["bpm"] is None
    assert song["cover"] == f"covers/{VID}.jpg"
    assert len(covers) == 1


def test_fetch_audio_cover_failure_leaves_cover_unset_and_bpm_is_stored(catalog_song, monkeypatch):
    client = catalog_song
    monkeypatch.setattr(bpm, "detect_bpm", lambda p: 127.6)
    monkeypatch.setattr(extractor, "fetch_cover", lambda *a, **k: (_ for _ in ()).throw(OSError("x")))
    assert client.post(f"/songs/{VID}/audio", headers=H).status_code == 202
    song = client.get("/library", headers=H).json()["songs"][0]
    assert song["bpm"] == 128
    assert not song["cover"]


def test_fetch_audio_when_the_song_disappears_marks_the_job_failed_and_drops_the_file(catalog_song, monkeypatch, tmp_path):
    client = catalog_song

    def vanishing(v, out, progress=None, source_url=None):
        out.mkdir(parents=True, exist_ok=True)
        (out / f"{v}.m4a").write_bytes(b"aud")
        library.save(deps.library_path(OWNER_UID), [])
        return {}

    monkeypatch.setattr(extractor, "download_audio", vanishing)
    assert client.post(f"/songs/{VID}/audio", headers=H).status_code == 202
    assert deps.JOBS[(OWNER_UID, VID)]["code"] == "unknown_song"
    assert not (ADIR(tmp_path) / f"{VID}.m4a").exists()


def test_fetch_audio_preview_only_and_generic_errors_become_job_errors(catalog_song, monkeypatch):
    client = catalog_song
    monkeypatch.setattr(extractor, "download_audio", lambda *a, **k: (_ for _ in ()).throw(extractor.PreviewOnly()))
    client.post(f"/songs/{VID}/audio", headers=H)
    assert job_state(client)["error_code"] == "preview_only"
    monkeypatch.setattr(extractor, "download_audio", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("ERROR: gone. Use --cookies x")))
    deps.JOBS.clear()
    client.post(f"/songs/{VID}/audio", headers=H)
    body = job_state(client)
    assert body["state"] == "failed"
    assert "--cookies" not in body["error"]


def test_fetch_audio_is_idempotent_while_a_job_is_active(catalog_song):
    deps.JOBS[(OWNER_UID, VID)] = {"status": "downloading", "progress": 0.3, "error": None}
    r = catalog_song.post(f"/songs/{VID}/audio", headers=H)
    assert r.status_code == 202
    assert r.json() == {"id": VID, "status": "downloading"}


def test_status_of_unknown_and_known_songs(client):
    assert client.get(f"/songs/{VID}/status", headers=H).status_code == 404
    owner_add(client, audio=False)
    body = client.get(f"/songs/{VID}/status", headers=H).json()
    assert body["state"] == "done"
    assert body["percent"] == 100


def test_bpm_detect_error_shapes(client, monkeypatch):
    assert client.post(f"/songs/{VID}/bpm/detect", headers=H).status_code == 404
    owner_add(client, audio=False)
    r = client.post(f"/songs/{VID}/bpm/detect", headers=H)
    assert r.status_code == 404
    assert r.json()["detail"] == "not downloaded"
    owner_add(client, VID2)
    monkeypatch.setattr(bpm, "detect_bpm", lambda p: None)
    assert client.post(f"/songs/{VID2}/bpm/detect", headers=H).status_code == 422
    monkeypatch.setattr(bpm, "detect_bpm", lambda p: 99.5)
    assert client.post(f"/songs/{VID2}/bpm/detect", headers=H).json()["bpm"] == 100


def test_store_bpm_for_a_song_deleted_meanwhile_is_404(client):
    with pytest.raises(HTTPException) as ei:
        analyze.store_bpm(OWNER_UID, VID, 120.0)
    assert ei.value.status_code == 404


def test_delete_song_when_the_music_root_is_gone_still_deletes_the_record(client, tmp_path, monkeypatch):
    owner_add(client)
    calls = []

    def gone(uid_):
        calls.append(uid_)
        raise deps.MusicRootUnavailable("music root offline")

    monkeypatch.setattr(deps, "audio_dir", gone)
    assert client.delete(f"/songs/{VID}", headers=H).status_code == 204
    assert client.get("/library", headers=H).json()["songs"] == []
    assert calls


def test_unavailable_music_root_is_503_not_500(client, tmp_path, monkeypatch):
    owner_add(client)
    monkeypatch.setenv("AUDIO_MUSIC_ROOT", "nas://music/")
    monkeypatch.delenv("AUDIO_HOSTS", raising=False)
    r = client.get(f"/files/{VID}", headers=H)
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"]


def test_auto_identify_is_best_effort(monkeypatch, caplog):
    monkeypatch.setattr(identify, "configured", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    with caplog.at_level(logging.WARNING):
        downloads.auto_identify("u", VID)
    assert "auto identify skipped" in caplog.text
    monkeypatch.setattr(identify, "configured", lambda: False)
    downloads.auto_identify("u", VID)


@pytest.mark.parametrize("msg,expected", [
    ("xUse --cookies later", "xUse --cookies later"),
    ("a See b See https://x.y", "a See b"),
    ("See\thttps://x.y", "See\thttps://x.y"),
    ("Seeing https://x.y", "Seeing https://x.y"),
    ("", ""),
])
def test_short_hint_cutting_edges(msg, expected):
    assert links.short_error(Exception(msg)) == expected


def test_problem_error_shape_and_music_root_503(client):
    r = client.get("/songs/" + VID + "/status", headers=H)
    assert r.status_code == 404
    assert "detail" in r.json()
    p = Problem(429, "hourly_limit", "slow down", headers={"Retry-After": "60"}, retry_after_minutes=1)
    assert p.body() == {"error": "hourly_limit", "detail": "slow down", "retry_after_minutes": 1}


def test_head_files_matches_get_without_a_body(client):
    owner_add(client)
    got = client.get(f"/files/{VID}", headers=H)
    head = client.head(f"/files/{VID}", headers=H)
    assert head.status_code == 200
    assert head.content == b""
    for name in ("content-length", "content-type", "accept-ranges", "cache-control", "etag"):
        assert head.headers.get(name) == got.headers.get(name)
    assert head.headers["content-length"] == "5"
    assert head.headers["accept-ranges"] == "bytes"
    part = client.head(f"/files/{VID}", headers={**H, "Range": "bytes=1-3"})
    assert part.status_code == 206
    assert part.content == b""
    assert part.headers["content-range"] == "bytes 1-3/5"
    assert part.headers["content-length"] == "3"
    assert client.head(f"/files/{VID}", headers={**H, "Range": "bytes=99-"}).status_code == 416
    assert client.head(f"/files/{VID}", params={"token": "secret"}).status_code == 200


def test_head_files_requires_auth_and_hides_missing_files(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "0")
    owner_add(client)
    assert client.head(f"/files/{VID}").status_code == 401
    assert client.head(f"/files/{VID}", headers={"X-API-Token": "bad"}).status_code == 401
    assert client.head(f"/files/{VID2}", headers=H).status_code == 404
    assert client.head("/files/not-an-id", headers=H).status_code == 422
    assert client.head(f"/files/{VID}", params={"download": 1}, headers=H).headers["content-disposition"].startswith("attachment")


def test_patch_wikipedia_album_link(client):
    assert owner_add(client).status_code == 202
    r = client.patch(f"/songs/{VID}", json={"wikipedia_album": "http://en.wikipedia.org/wiki/Discovery_(album)"}, headers=H)
    assert r.json()["wikipedia_album"] == "https://en.wikipedia.org/wiki/Discovery_(album)"
    assert client.patch(f"/songs/{VID}", json={"wikipedia_album": "https://evil.example/wiki/X"}, headers=H).json()["wikipedia_album"] is None
