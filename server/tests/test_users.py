import json
import threading
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import deps, downloads, extractor, limits, main, oauth, session, users
from tests.test_library import ADIR, H, ODIR, OWNER_UID, VID, VID2, client  # noqa: F401

AUD = "client.apps.googleusercontent.com"
VID3 = "aaaaaaaaaaa"
VID4 = "bbbbbbbbbbb"
CSRF = {"X-Requested-With": "audioplayer"}


@pytest.fixture(scope="module")
def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def multi(client, key, monkeypatch):
    """The plain-file API client plus Google sign-in for any email."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", AUD)
    fake = SimpleNamespace(get_signing_key_from_jwt=lambda t: SimpleNamespace(key=key.public_key()))
    monkeypatch.setattr(oauth, "_jwks", lambda provider: fake)
    client.key = key
    return client


def token(key, addr, provider="google", **over):
    claims = {
        "iss": "https://accounts.google.com" if provider == "google" else "https://appleid.apple.com",
        "aud": AUD if provider == "google" else "com.example.app",
        "sub": "sub-" + addr, "email": addr, "email_verified": True, "exp": int(time.time()) + 600,
    }
    claims.update(over)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "k1"})


def who(client, addr, **over):
    return {"Authorization": f"Bearer {token(client.key, addr, **over)}"}


def uid(email):
    return users.uid_for_email(email)


def add(client, headers, vid=VID, **kw):
    body = {"url": f"https://youtu.be/{vid}", "metadata": {"title": "Song"}, "tags": [], **kw}
    return client.post("/songs", json=body, headers=headers)


ALICE, BOB = "alice@example.com", "bob@example.com"


def test_uid_is_a_hash_of_the_lowercased_email():
    assert len(uid(ALICE)) == 16
    assert uid(ALICE) == uid(" Alice@Example.com ")
    assert uid(ALICE) != uid(BOB)
    assert "alice" not in uid(ALICE)


def test_isolation_between_users(multi, tmp_path):
    a, b = who(multi, ALICE), who(multi, BOB)
    assert add(multi, a).status_code == 202
    assert multi.get("/library", headers=b).json() == {"songs": []}
    assert [s["id"] for s in multi.get("/library", headers=a).json()["songs"]] == [VID]
    for path in (f"/files/{VID}", f"/covers/{VID}"):
        assert multi.get(path, headers=a).status_code == 200
        assert multi.get(path, headers=b).status_code == 404
    assert multi.get(f"/songs/{VID}/status", headers=a).json()["status"] == "done"
    assert multi.get(f"/songs/{VID}/status", headers=b).status_code == 404
    assert multi.patch(f"/songs/{VID}", json={"title": "x"}, headers=b).status_code == 404
    assert multi.post(f"/songs/{VID}/bpm/detect", headers=b).status_code == 404
    assert multi.delete(f"/songs/{VID}/audio", headers=b).status_code == 404
    assert multi.delete(f"/songs/{VID}", headers=b).status_code == 404
    assert multi.post("/preview", json={"url": VID}, headers=b).json()["in_library"] is False
    assert multi.get("/tags", headers=b).json() == []
    assert multi.get("/catalog", headers=b).json()["total"] == 0
    assert multi.get(f"/files/{VID}", headers=a).content == b"audio"
    assert multi.get("/library", headers=H).json() == {"songs": []}
    assert multi.get(f"/files/{VID}", params={"token": "secret"}).status_code == 404


def test_same_song_in_two_libraries_is_independent(multi, tmp_path):
    a, b = who(multi, ALICE), who(multi, BOB)
    assert add(multi, a).status_code == 202
    assert add(multi, b).status_code == 202
    ua, ub = tmp_path / "downloads" / "users" / uid(ALICE), tmp_path / "downloads" / "users" / uid(BOB)
    assert (ua / f"{VID}.m4a").is_file()
    assert (ub / f"{VID}.m4a").is_file()
    assert multi.delete(f"/songs/{VID}", headers=b).status_code == 204
    assert not (ub / f"{VID}.m4a").exists()
    assert (ua / f"{VID}.m4a").is_file()
    assert multi.get(f"/files/{VID}", headers=a).status_code == 200
    assert add(multi, a).status_code == 409


def test_client_cannot_name_a_user(multi, tmp_path):
    a, b = who(multi, ALICE), who(multi, BOB)
    add(multi, b)
    for extra in ({"uid": uid(BOB)}, {"user": uid(BOB)}):
        assert multi.get(f"/files/{VID}", params=extra, headers=a).status_code == 404
        assert multi.get("/library", params=extra, headers=a).json() == {"songs": []}
    spoof = {**a, "X-User": uid(BOB), "X-Uid": uid(BOB)}
    assert multi.get(f"/files/{VID}", headers=spoof).status_code == 404
    assert multi.get("/me", headers=spoof).json()["email"] == ALICE


def test_path_traversal_and_tampered_ids(multi, tmp_path):
    a, b = who(multi, ALICE), who(multi, BOB)
    add(multi, b)
    assert multi.get(f"/files/../users/{uid(BOB)}/{VID}.m4a", headers=a).status_code in (404, 422)
    for bad in ("..%2F..%2Fx", f"{uid(BOB)}", "a%2Fb", "x" * 40):
        for method, path in (("get", "/files/"), ("get", "/covers/"), ("delete", "/songs/"), ("patch", "/songs/")):
            r = getattr(multi, method)(path + bad, headers=a, **({"json": {}} if method == "patch" else {}))
            assert r.status_code in (404, 405, 422), (method, path, bad)
    alice = tmp_path / "users" / uid(ALICE)
    alice.mkdir(parents=True, exist_ok=True)
    (alice / "library.json").write_text(json.dumps({"songs": [
        {"id": VID, "file": f"../{uid(BOB)}/{VID}.m4a", "title": "evil"}]}))
    assert multi.get(f"/files/{VID}", headers=a).status_code == 404


def test_cookie_sessions_are_per_user(key, multi, monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_WEB_CLIENT_ID", AUD)
    ca = TestClient(main.app, base_url="https://testserver")
    cb = TestClient(main.app, base_url="https://testserver")
    for c, email in ((ca, ALICE), (cb, BOB)):
        res = c.post("/auth/session", json={"id_token": token(key, email)}, headers=CSRF)
        assert res.status_code == 200
        assert res.json()["email"] == email
    assert ca.post("/songs", json={"url": VID, "metadata": {"title": "S"}}, headers=CSRF).status_code == 202
    assert ca.get(f"/files/{VID}").status_code == 200
    assert cb.get(f"/files/{VID}").status_code == 404
    assert cb.get("/library").json() == {"songs": []}
    forged = session.issue({"provider": "google", "email": BOB, "uid": uid(ALICE)})
    assert forged
    cb.cookies.clear()
    cb.cookies.set("__Host-session", forged[:-3] + "AAA", domain="testserver")
    assert cb.get("/library").status_code == 401


def test_open_signup_creates_profile_without_email_in_paths(multi, tmp_path):
    h = who(multi, ALICE)
    me = multi.get("/me", headers=h).json()
    assert me["email"] == ALICE
    assert me["provider"] == "google"
    assert me["owner"] is False
    profile = json.loads((tmp_path / "users" / uid(ALICE) / "profile.json").read_text())
    assert profile["email"] == ALICE
    assert profile["provider"] == "google"
    assert profile["created_at"].endswith("Z")
    add(multi, h)
    names = [str(p.relative_to(tmp_path)).lower() for p in tmp_path.rglob("*")]
    assert names
    assert not any("alice" in n or "@" in n for n in names)


def test_signup_closed_blocks_new_users_not_existing_or_owner(multi, monkeypatch):
    assert multi.get("/me", headers=who(multi, ALICE)).status_code == 200
    monkeypatch.setenv("SIGNUP_OPEN", "0")
    r = multi.get("/library", headers=who(multi, BOB))
    assert r.status_code == 403
    assert r.json()["error"] == "signup_closed"
    assert multi.get("/library", headers=who(multi, ALICE)).status_code == 200
    assert multi.get("/library", headers=who(multi, "alex.isayenko@gmail.com")).status_code == 200
    assert multi.get("/library", headers=H).status_code == 200


def test_unverified_email_and_missing_email_refused(multi):
    assert multi.get("/me", headers=who(multi, ALICE, email_verified=False)).status_code == 403
    assert multi.get("/me", headers=who(multi, ALICE, email=None)).status_code == 403


def test_apple_without_email_uses_the_sub(multi, tmp_path, monkeypatch):
    monkeypatch.setenv("APPLE_AUDIENCE", "com.example.app")
    tok = token(multi.key, "", "apple", email=None, sub="001.xyz")
    h = {"Authorization": f"Bearer {tok}"}
    assert multi.get("/me", headers=h).status_code == 200
    expected = users.uid_for_sub("001.xyz")
    assert (tmp_path / "users" / expected / "profile.json").is_file()
    again = {"Authorization": f"Bearer {token(multi.key, 'later@privaterelay.appleid.com', 'apple', sub='001.xyz')}"}
    assert multi.get("/me", headers=again).status_code == 200


def test_apple_sub_found_again_after_email_disappears(multi, tmp_path, monkeypatch):
    monkeypatch.setenv("APPLE_AUDIENCE", "com.example.app")
    first = {"Authorization": f"Bearer {token(multi.key, 'r@privaterelay.appleid.com', 'apple', sub='001.q')}"}
    add(multi, first)
    deps.SUBS.clear()
    bare = {"Authorization": f"Bearer {token(multi.key, '', 'apple', email=None, sub='001.q')}"}
    assert [s["id"] for s in multi.get("/library", headers=bare).json()["songs"]] == [VID]


def test_owner_is_exempt_from_user_limits_but_users_are_not(multi, monkeypatch):
    monkeypatch.setenv("USER_MAX_SONGS", "1")
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "1")
    assert add(multi, H, VID).status_code == 202
    assert add(multi, H, VID2).status_code == 202
    a = who(multi, ALICE)
    assert add(multi, a, VID).status_code == 202
    r = add(multi, a, VID2)
    assert r.status_code == 403
    assert r.json()["error"] == "library_full_songs"
    assert multi.get("/me", headers=H).json()["owner"] is True


def test_hourly_limit_429_with_retry_minutes(multi, monkeypatch):
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "2")
    a, b = who(multi, ALICE), who(multi, BOB)
    assert add(multi, a, VID).status_code == 202
    assert add(multi, a, VID2).status_code == 202
    r = add(multi, a, VID3)
    body = r.json()
    assert r.status_code == 429
    assert body["error"] == "hourly_limit"
    assert 1 <= body["retry_after_minutes"] <= 60
    assert "min" in body["detail"]
    assert r.headers["retry-after"] == str(body["retry_after_minutes"] * 60)
    assert add(multi, b, VID3).status_code == 202
    assert add(multi, H, VID3).status_code == 202
    assert add(multi, H, VID4).status_code == 202


def test_hourly_window_slides(multi, monkeypatch):
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "1")
    a = who(multi, ALICE)
    now = time.time()
    limits.RATE.record(uid(ALICE), [], now=now - 3600 + 150)
    r = add(multi, a, VID)
    assert r.status_code == 429
    assert r.json()["retry_after_minutes"] == 3
    limits.RATE.reset()
    limits.RATE.record(uid(ALICE), [], now=now - 3601)
    assert add(multi, a, VID).status_code == 202


def test_hourly_limit_survives_restart_through_added_at(multi, monkeypatch):
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "1")
    a = who(multi, ALICE)
    assert add(multi, a, VID).status_code == 202
    limits.RATE.reset()
    assert add(multi, a, VID2).status_code == 429


def test_library_full_by_bytes_and_metadata_only_still_allowed(multi, monkeypatch):
    monkeypatch.setenv("USER_MAX_BYTES", "8")
    a = who(multi, ALICE)
    assert add(multi, a, VID).status_code == 202
    assert add(multi, a, VID2).status_code == 202
    r = add(multi, a, VID3)
    assert r.status_code == 403
    assert r.json()["error"] == "library_full_bytes"
    assert add(multi, a, VID3, audio=False).status_code == 201
    assert add(multi, H, VID4).status_code == 202


def test_server_full_503_applies_to_owner_too(multi, monkeypatch):
    monkeypatch.setenv("POOL_MAX_BYTES", "5")
    assert add(multi, H, VID).status_code == 202
    for headers in (H, who(multi, ALICE)):
        r = add(multi, headers, VID2)
        assert r.status_code == 503
        assert r.json()["error"] == "server_full"
    assert add(multi, H, VID2, audio=False).status_code == 201
    assert multi.post("/download", json={"video_id": VID3}, headers=H).status_code == 503


def test_queued_job_rechecks_capacity_when_it_starts(multi, monkeypatch):
    monkeypatch.setenv("POOL_MAX_BYTES", "5")
    key = (uid(ALICE), VID)
    deps.JOBS[key] = {"status": "downloading", "progress": 0.0, "error": None}
    downloads.run_download(uid(ALICE), False, VID, {}, [], None)
    st = deps.JOBS[key]
    assert st["status"] == "done"
    deps.JOBS[(uid(ALICE), VID2)] = {"status": "downloading", "progress": 0.0, "error": None}
    downloads.run_download(uid(ALICE), False, VID2, {}, [], None)
    assert deps.JOBS[(uid(ALICE), VID2)]["status"] == "error"
    assert deps.JOBS[(uid(ALICE), VID2)]["code"] == "server_full"


def test_delete_frees_quota_and_usage_reports_it(multi, monkeypatch):
    monkeypatch.setenv("USER_MAX_SONGS", "2")
    monkeypatch.setenv("USER_MAX_BYTES", "100")
    a = who(multi, ALICE)
    assert multi.get("/me/usage", headers=a).json() == {
        "songs": 0, "max_songs": 2, "bytes": 0, "max_bytes": 100, "adds_last_hour": 0, "max_adds": 20}
    add(multi, a, VID)
    add(multi, a, VID2)
    use = multi.get("/me/usage", headers=a).json()
    assert use["songs"] == 2
    assert use["bytes"] == 10
    assert use["adds_last_hour"] == 2
    assert add(multi, a, VID3).json()["error"] == "library_full_songs"
    assert multi.delete(f"/songs/{VID}", headers=a).status_code == 204
    use = multi.get("/me/usage", headers=a).json()
    assert use["songs"] == 1
    assert use["bytes"] == 5
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "50")
    assert add(multi, a, VID3).status_code == 202
    assert multi.delete(f"/songs/{VID2}/audio", headers=a).status_code == 204
    assert multi.get("/me/usage", headers=a).json()["bytes"] == 5
    assert multi.get("/me/usage", headers=who(multi, BOB)).json()["songs"] == 0


def test_usage_counts_real_files_not_the_library(multi, tmp_path, monkeypatch):
    a = who(multi, ALICE)
    add(multi, a)
    (tmp_path / "downloads" / "users" / uid(ALICE) / f"{VID}.m4a").write_bytes(b"x" * 1000)
    assert multi.get("/me/usage", headers=a).json()["bytes"] == 1000


def test_usage_for_owner_has_no_limits(multi):
    use = multi.get("/me/usage", headers=H).json()
    assert use["max_songs"] is None
    assert use["max_bytes"] is None
    assert use["max_adds"] is None
    assert set(use) == {"songs", "max_songs", "bytes", "max_bytes", "adds_last_hour", "max_adds"}
    assert multi.get("/me/usage").status_code == 401


def test_every_data_endpoint_needs_a_user(multi):
    for method, path in [
        ("get", "/me"), ("get", "/me/usage"), ("get", "/library"), ("get", "/catalog"), ("get", "/tags"),
        ("get", f"/files/{VID}"), ("get", f"/covers/{VID}"), ("get", f"/songs/{VID}/status"),
        ("post", "/songs"), ("patch", f"/songs/{VID}"), ("delete", f"/songs/{VID}"),
        ("delete", f"/songs/{VID}/audio"), ("post", f"/songs/{VID}/bpm/detect"), ("post", "/download"),
    ]:
        assert getattr(multi, method)(path).status_code == 401, path


def test_legacy_download_endpoint_is_per_user(multi, monkeypatch, tmp_path):
    def fake(vid, out):
        (out / f"{vid}.m4a").write_bytes(b"dl")
        return {"id": vid, "title": "t", "artist": "a", "duration": 1}

    monkeypatch.setattr(extractor, "download", fake)
    a, b = who(multi, ALICE), who(multi, BOB)
    assert multi.post("/download", json={"video_id": VID}, headers=a).status_code == 200
    assert multi.get(f"/files/{VID}", headers=a).content == b"dl"
    assert multi.get(f"/files/{VID}", headers=b).status_code == 404


def test_default_limits():
    assert (limits.max_songs(), limits.max_bytes(), limits.max_adds()) == (500, 5 * 1024 ** 3, 20)
    assert (limits.user_concurrency(), limits.global_concurrency(), limits.pool_max_bytes()) == (1, 2, 150 * 1024 ** 3)
    assert users.signup_open() is True


def test_owner_env_and_deprecated_alias(monkeypatch):
    assert users.owner_email() == "alex.isayenko@gmail.com"
    monkeypatch.setenv("ALLOWED_EMAIL", "Old@Example.com")
    assert users.owner_email() == "old@example.com"
    monkeypatch.setenv("OWNER_EMAIL", "new@example.com")
    assert users.owner_email() == "new@example.com"
    assert users.is_owner(uid("new@example.com"))


def wait_for(client, headers, vid, status, secs=10):
    end = time.time() + secs
    while time.time() < end:
        r = client.get(f"/songs/{vid}/status", headers=headers)
        if r.status_code == 200 and r.json()["status"] == status:
            return r.json()
        time.sleep(0.02)
    raise AssertionError(f"{vid} never became {status}: {r.text}")


@pytest.fixture
def slow(multi, monkeypatch):
    """Real worker threads; each download waits for its own gate."""
    monkeypatch.setattr(deps.SCHED, "inline", False)
    gates: dict[str, threading.Event] = {}
    started: list[tuple[str, str]] = []

    def fake_download(video_id, out_dir, progress=None, source_url=None):
        started.append((out_dir.name, video_id))
        gates.setdefault(video_id, threading.Event()).wait(10)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"audio")
        return {"id": video_id, "title": "t", "artist": "a", "duration": 1}

    monkeypatch.setattr(extractor, "download_audio", fake_download)
    multi.gates, multi.started = gates, started
    yield multi
    for gate in gates.values():
        gate.set()
    time.sleep(0.2)


def open_gate(c, vid):
    c.gates.setdefault(vid, threading.Event()).set()


def test_extra_adds_queue_per_user(slow):
    a = who(slow, ALICE)
    assert add(slow, a, VID).json() == {"id": VID, "status": "downloading"}
    r = add(slow, a, VID2)
    assert r.status_code == 202
    assert r.json() == {"id": VID2, "status": "queued"}
    assert slow.get(f"/songs/{VID2}/status", headers=a).json()["status"] == "queued"
    assert add(slow, a, VID2).status_code == 409
    time.sleep(0.2)
    assert slow.started == [(uid(ALICE), VID)]
    open_gate(slow, VID)
    wait_for(slow, a, VID, "done")
    wait_for(slow, a, VID2, "downloading")
    assert slow.started[-1] == (uid(ALICE), VID2)
    open_gate(slow, VID2)
    wait_for(slow, a, VID2, "done")
    assert len(slow.get("/library", headers=a).json()["songs"]) == 2


def test_other_user_is_not_blocked_by_a_queue_and_global_cap_holds(slow, monkeypatch):
    monkeypatch.setenv("GLOBAL_MAX_CONCURRENT_DOWNLOADS", "2")
    a, b, c = who(slow, ALICE), who(slow, BOB), who(slow, "carol@example.com")
    assert add(slow, a, VID).json()["status"] == "downloading"
    assert add(slow, a, VID2).json()["status"] == "queued"
    assert add(slow, b, VID3).json()["status"] == "downloading"
    assert add(slow, c, VID4).json()["status"] == "queued"
    time.sleep(0.2)
    assert {v for _, v in slow.started} == {VID, VID3}
    open_gate(slow, VID3)
    wait_for(slow, b, VID3, "done")
    wait_for(slow, c, VID4, "downloading")
    open_gate(slow, VID)
    open_gate(slow, VID2)
    open_gate(slow, VID4)
    wait_for(slow, a, VID2, "done")
    wait_for(slow, c, VID4, "done")


def test_user_concurrency_is_configurable_and_owner_exempt(slow, monkeypatch):
    monkeypatch.setenv("GLOBAL_MAX_CONCURRENT_DOWNLOADS", "5")
    monkeypatch.setenv("USER_MAX_CONCURRENT_DOWNLOADS", "2")
    a = who(slow, ALICE)
    assert [add(slow, a, v).json()["status"] for v in (VID, VID2, VID3)] == ["downloading", "downloading", "queued"]
    assert [add(slow, H, v).json()["status"] for v in (VID, VID2, VID3)] == ["downloading"] * 3
    wait_for(slow, H, VID3, "downloading")


def test_queued_adds_count_against_the_songs_quota(slow, monkeypatch):
    monkeypatch.setenv("USER_MAX_SONGS", "2")
    a = who(slow, ALICE)
    add(slow, a, VID)
    add(slow, a, VID2)
    r = add(slow, a, VID3)
    assert r.status_code == 403
    assert r.json()["error"] == "library_full_songs"


def test_download_headers_and_names(multi, tmp_path):
    a, b = who(multi, ALICE), who(multi, BOB)
    assert add(multi, a).status_code == 202
    plain = multi.get(f"/files/{VID}", headers=a)
    assert plain.status_code == 200
    r = multi.get(f"/files/{VID}", params={"download": 1}, headers=a)
    assert r.content == b"audio"
    assert r.headers["content-disposition"].startswith('attachment; filename="')
    assert r.headers["content-disposition"].endswith(".m4a")
    ranged = multi.get(f"/files/{VID}", params={"download": 1}, headers={**a, "Range": "bytes=1-2"})
    assert ranged.status_code == 206
    assert ranged.content == b"ud"
    assert multi.get(f"/files/{VID}", headers={**a, "Range": "bytes=0-1"}).status_code == 206
    r = multi.get(f"/files/{VID}", params={"download": 1}, headers=b)
    assert r.status_code == 404
    assert "content-disposition" not in r.headers


def test_download_missing_audio_code(multi):
    a = who(multi, ALICE)
    assert add(multi, a).status_code == 202
    assert multi.delete(f"/songs/{VID}/audio", headers=a).status_code == 204
    r = multi.get(f"/files/{VID}", params={"download": 1}, headers=a)
    assert r.status_code == 404
    assert r.json()["error"] == "audio_not_downloaded"


def test_download_name_sanitising():
    from urllib.parse import unquote

    from app import library as lib

    name = lib.download_name({"artist": "AC/DC", "title": 'Back "In" Black?\x00'}, VID)
    assert name == "AC DC - Back In Black.m4a"
    assert lib.download_name({"artist": "", "title": ""}, VID) == f"{VID}.m4a"
    assert lib.download_name({"artist": "Кино", "title": "Группа крови 🎸"}, VID) == "Кино - Группа крови 🎸.m4a"
    assert lib.download_name(None, VID) == f"{VID}.m4a"
    assert len(lib.download_name({"title": "x" * 500}, VID)) <= 124
    assert lib.download_name({"title": "..BS..BSetc".replace("BS", chr(92))}, VID) == "etc.m4a"
    cd = lib.content_disposition("Кино - Группа.m4a")
    assert cd.startswith('attachment; filename="download.m4a"')
    assert unquote(cd.split("UTF-8''")[1]) == "Кино - Группа.m4a"
    cd = lib.content_disposition("Beyoncé - Halo.m4a")
    assert 'filename="Beyonce - Halo.m4a"' in cd
    assert "%C3%A9" in cd
    assert '"' not in lib.content_disposition('a"b.m4a').split("filename=", 1)[1].split(";")[0][1:-1]
