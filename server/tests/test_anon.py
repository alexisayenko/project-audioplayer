import hashlib
import logging
import os

import pytest
from fastapi.testclient import TestClient

from app import anon, deps, extractor, main
from tests.test_library import VID, VID2, client  # noqa: F401

SC_URL = "https://soundcloud.com/some-artist/some-track"
AUDIO = bytes(range(256)) * 40
ENV = (
    "ANON_DOWNLOADS_ENABLED", "ANON_TOKEN_TTL_S", "ANON_SESSIONS_PER_IP_HOUR", "ANON_DEVICE_PER_HOUR", "ANON_IP_PER_DAY",
    "ANON_MAX_CONCURRENT_PER_DEVICE", "ANON_MAX_DURATION_S", "ANON_MAX_FILE_MB", "ANON_READY_TTL_S", "ANON_FAILED_TTL_S",
    "ANON_MIN_FREE_MB", "ANON_MAX_QUEUE", "ANON_SWEEP_INTERVAL_S",
)


class Clock:
    def __init__(self):
        self.now = 1_800_000_000.0

    def __call__(self):
        return self.now


def from_peer(host):
    async def app(scope, receive, send):
        if scope["type"] == "http":
            scope["client"] = (host, 1234)
        await main.app(scope, receive, send)

    return app


def at(host="203.0.113.5"):
    return TestClient(from_peer(host))


def token_of(c):
    return {"X-Anon-Token": c.post("/anon/session").json()["token"]}


@pytest.fixture
def env(client, tmp_path, monkeypatch):
    for name in ENV:
        monkeypatch.delenv(name, raising=False)
    clock = Clock()
    state = {"size": len(AUDIO), "duration": 200, "fail": None, "calls": 0}

    def fake_download(video_id, out_dir, progress=None, source_url=None):
        state["calls"] += 1
        if state["fail"]:
            raise state["fail"]
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes((AUDIO * (state["size"] // len(AUDIO) + 1))[: state["size"]])
        if progress:
            progress(0.5)
        return {"id": video_id, "title": "Yt Title", "artist": "Yt Artist", "duration": 200}

    def fake_cover(video_id, dest, artwork=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"jpegbytes")

    def fake_preview(vid):
        return {"id": vid, "title": "P", "artist": "A", "duration": state["duration"], "published_year": 2019, "thumbnail": None}

    def fake_probe(url):
        return {"id": "soundcloud-123", "source_url": url, "title": "Sc", "artist": "Sa", "duration": state["duration"],
                "published_year": None, "thumbnail": "https://i1.sndcdn.com/a-t500x500.jpg", "preview_only": False}

    monkeypatch.setattr(extractor, "download_audio", fake_download)
    monkeypatch.setattr(extractor, "fetch_cover", fake_cover)
    monkeypatch.setattr(extractor, "preview", fake_preview)
    monkeypatch.setattr(extractor, "soundcloud_probe", fake_probe)
    monkeypatch.setattr(anon, "clock", clock)
    monkeypatch.setattr(anon, "free_bytes", lambda path: 10 * 1024 ** 3)
    anon.reset()
    state["clock"] = clock
    state["root"] = tmp_path / "downloads" / ".anon"
    yield state
    anon.reset()


def start(c, headers, url=VID):
    return c.post("/anon/downloads", json={"url": url}, headers=headers)


def ready(c, headers, url=VID):
    r = start(c, headers, url)
    assert r.status_code == 202, r.text
    job = r.json()["id"]
    body = c.get(f"/anon/downloads/{job}", headers=headers).json()
    assert body["status"] == "ready", body
    return job, body


def test_session_issues_a_signed_token_and_bad_ones_are_refused(env):
    c = at()
    r = c.post("/anon/session")
    assert r.status_code == 200
    assert set(r.json()) == {"token", "expires_in"} and r.json()["expires_in"] == 30 * 24 * 3600
    token = r.json()["token"]
    assert anon.read(token) is not None
    for bad in ("", "x", token[:-2] + "AA", token + "a", token.split(".")[0], "a.b"):
        assert c.post("/anon/downloads", json={"url": VID}, headers={"X-Anon-Token": bad}).status_code == 401
    assert c.post("/anon/downloads", json={"url": VID}).status_code == 401


def test_a_token_expires_and_renewing_keeps_the_device(env, monkeypatch):
    monkeypatch.setenv("ANON_TOKEN_TTL_S", "100")
    c = at()
    first = c.post("/anon/session").json()["token"]
    renewed = c.post("/anon/session", headers={"X-Anon-Token": first}).json()["token"]
    assert anon.read(first) == anon.read(renewed)
    assert anon.read(c.post("/anon/session").json()["token"]) != anon.read(first)
    env["clock"].now += 101
    assert anon.read(first) is None
    assert start(c, {"X-Anon-Token": first}).status_code == 401
    fresh = c.post("/anon/session", headers={"X-Anon-Token": first}).json()["token"]
    assert anon.read(fresh) != anon.read(first)


def test_a_token_signed_with_another_secret_is_refused(env, monkeypatch):
    c = at()
    token = c.post("/anon/session").json()["token"]
    monkeypatch.setenv("AUDIO_API_TOKEN", "another")
    assert anon.read(token) is None


def test_without_a_server_secret_the_session_is_not_configured(env, monkeypatch):
    monkeypatch.delenv("AUDIO_API_TOKEN", raising=False)
    r = at().post("/anon/session")
    assert r.status_code == 503 and r.json()["error"] == "not_configured"


def test_session_requests_are_limited_per_ip(env, monkeypatch):
    monkeypatch.setenv("ANON_SESSIONS_PER_IP_HOUR", "2")
    c = at("198.51.100.7")
    assert c.post("/anon/session").status_code == 200
    assert c.post("/anon/session").status_code == 200
    r = c.post("/anon/session")
    assert r.status_code == 429 and r.json()["error"] == "limit_ip" and int(r.headers["retry-after"]) > 0
    assert at("198.51.100.8").post("/anon/session").status_code == 200
    env["clock"].now += 3601
    assert c.post("/anon/session").status_code == 200


def test_a_download_is_staged_fetched_and_deleted_on_ack(env):
    c = at()
    h = token_of(c)
    r = start(c, h, f"https://youtu.be/{VID}?si=abc&list=PLxyz")
    assert r.status_code == 202 and r.json()["status"] == "queued" and r.json()["id"]
    job = r.json()["id"]
    body = c.get(f"/anon/downloads/{job}", headers=h).json()
    assert body["status"] == "ready" and body["progress"] == 1.0 and body["error_code"] is None
    assert body["meta"] == {
        "title": "Yt Title", "artist": "Yt Artist", "duration": 200, "source_url": f"https://www.youtube.com/watch?v={VID}",
        "platform": "youtube", "year": 2019, "video_id": VID,
    }
    assert body["size"] == len(AUDIO) and body["sha256"] == hashlib.sha256(AUDIO).hexdigest()
    assert body["expires_at"].endswith("Z")
    staged = env["root"] / job
    assert (staged / f"{VID}.m4a").is_file()
    f = c.get(f"/anon/downloads/{job}/file", headers=h)
    assert f.status_code == 200 and f.content == AUDIO and f.headers["content-type"] == "audio/mp4"
    assert c.get(f"/anon/downloads/{job}/cover", headers=h).content == b"jpegbytes"
    ack = c.post(f"/anon/downloads/{job}/ack", json={"sha256": body["sha256"].upper()}, headers=h)
    assert ack.status_code == 204 and ack.content == b""
    assert not staged.exists()
    assert c.post(f"/anon/downloads/{job}/ack", json={"sha256": body["sha256"]}, headers=h).status_code == 204
    for path in ("", "/file", "/cover"):
        assert c.get(f"/anon/downloads/{job}{path}", headers=h).status_code == 404


def test_a_soundcloud_track_is_staged_with_its_cover_and_no_year(env):
    c = at()
    h = token_of(c)
    job, body = ready(c, h, SC_URL + "?si=tracking")
    assert body["meta"]["platform"] == "soundcloud" and body["meta"]["video_id"] == "soundcloud-123"
    assert body["meta"]["source_url"] == SC_URL and body["meta"]["year"] is None
    assert c.get(f"/anon/downloads/{job}/cover", headers=h).status_code == 200


def test_the_cover_is_optional(env, monkeypatch):
    def broken(*args, **kwargs):
        raise OSError("no cover")

    monkeypatch.setattr(extractor, "fetch_cover", broken)
    c = at()
    h = token_of(c)
    job, _ = ready(c, h)
    r = c.get(f"/anon/downloads/{job}/cover", headers=h)
    assert r.status_code == 404 and r.json()["error"] == "no_cover"


def test_another_device_sees_nothing_of_a_download(env):
    c = at()
    a, b = token_of(c), token_of(c)
    job, body = ready(c, a)
    for method, path in (("GET", ""), ("GET", "/file"), ("GET", "/cover")):
        assert c.request(method, f"/anon/downloads/{job}{path}", headers=b).status_code == 404, path
    assert c.post(f"/anon/downloads/{job}/ack", json={"sha256": body["sha256"]}, headers=b).status_code == 404
    assert (env["root"] / job / f"{VID}.m4a").is_file()
    assert c.get(f"/anon/downloads/{job}/file", headers=a).status_code == 200
    assert c.get("/anon/downloads/nope", headers=a).status_code == 404


@pytest.mark.parametrize("url", [
    "", "   ", "nonsense", "https://example.com/watch?v=" + VID,
    "https://www.youtube.com/playlist?list=PL1234567890",
    "https://www.youtube.com/@somechannel", "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    "https://soundcloud.com/some-artist", "https://soundcloud.com/some-artist/sets/an-album",
    "https://soundcloud.com/discover/x", "https://on.soundcloud.com/a/b", "https://spotify.com/track/1", "x" * 3000,
])
def test_only_single_youtube_and_soundcloud_tracks_are_accepted(env, url):
    c = at()
    r = start(c, token_of(c), url)
    assert r.status_code == 422 and r.json()["error"] == "unsupported_url"
    assert env["calls"] == 0


def test_the_hourly_limit_is_per_device_and_refills(env):
    c = at()
    h = token_of(c)
    other = token_of(c)
    for _ in range(5):
        assert start(c, h).status_code == 202
        env["clock"].now += 10
    r = start(c, h)
    assert r.status_code == 429 and r.json()["error"] == "limit_hour" and int(r.headers["retry-after"]) > 0
    assert start(c, other).status_code == 202
    env["clock"].now += 3600
    assert start(c, h).status_code == 202


def test_the_hourly_limit_is_configurable(env, monkeypatch):
    monkeypatch.setenv("ANON_DEVICE_PER_HOUR", "1")
    c = at()
    h = token_of(c)
    assert start(c, h).status_code == 202
    assert start(c, h, VID2).json()["error"] == "limit_hour"


def test_the_daily_limit_is_per_ip_across_devices(env, monkeypatch):
    monkeypatch.setenv("ANON_IP_PER_DAY", "3")
    c = at("198.51.100.20")
    for _ in range(3):
        assert start(c, token_of(c)).status_code == 202
    r = start(c, token_of(c))
    assert r.status_code == 429 and r.json()["error"] == "limit_ip"
    assert start(at("198.51.100.21"), token_of(at("198.51.100.21"))).status_code == 202
    env["clock"].now += 86401
    assert start(c, token_of(c)).status_code == 202


def test_ipv6_clients_share_a_limit_per_64():
    assert anon.ip_key("2001:db8:1:2:aaaa:bbbb:cccc:dddd") == anon.ip_key("2001:db8:1:2::1") == "2001:db8:1:2::/64"
    assert anon.ip_key("203.0.113.5") == "203.0.113.5"
    assert anon.ip_key("::1") == "::1"


def test_one_download_at_a_time_per_device(env, monkeypatch):
    monkeypatch.setattr(deps.SCHED, "submit", lambda *a, **k: False)
    c = at()
    a, b = token_of(c), token_of(c)
    assert start(c, a).status_code == 202
    r = start(c, a, VID2)
    assert r.status_code == 429 and r.json()["error"] == "limit_concurrent"
    assert start(c, b, VID2).status_code == 202


def test_the_global_anonymous_queue_is_capped(env, monkeypatch):
    monkeypatch.setenv("ANON_MAX_QUEUE", "2")
    monkeypatch.setattr(deps.SCHED, "submit", lambda *a, **k: False)
    c = at()
    assert start(c, token_of(c)).status_code == 202
    assert start(c, token_of(c)).status_code == 202
    r = start(c, token_of(c))
    assert r.status_code == 503 and r.json()["error"] == "busy"


def test_anonymous_jobs_go_through_the_shared_scheduler(env, monkeypatch):
    seen = []
    monkeypatch.setattr(deps.SCHED, "submit", lambda uid, exempt, run, started: seen.append((uid, exempt)) or False)
    c = at()
    h = token_of(c)
    start(c, h)
    assert len(seen) == 1 and seen[0][0].startswith("anon:") and seen[0][1] is False
    assert c.get(f"/anon/downloads/{next(iter(anon._jobs))}", headers=h).json()["status"] == "queued"


def test_too_long_is_refused_before_anything_is_downloaded(env):
    env["duration"] = 901
    c = at()
    h = token_of(c)
    job = start(c, h).json()["id"]
    body = c.get(f"/anon/downloads/{job}", headers=h).json()
    assert body["status"] == "failed" and body["error_code"] == "too_long" and body["meta"] is None
    assert env["calls"] == 0
    assert c.get(f"/anon/downloads/{job}/file", headers=h).status_code == 409


def test_a_live_stream_without_a_duration_counts_as_too_long(env):
    env["duration"] = None
    c = at()
    h = token_of(c)
    body = c.get(f"/anon/downloads/{start(c, h).json()['id']}", headers=h).json()
    assert body["error_code"] == "too_long"


def test_too_big_files_are_deleted(env, monkeypatch):
    monkeypatch.setenv("ANON_MAX_FILE_MB", "1")
    env["size"] = 1024 * 1024 + 1
    c = at()
    h = token_of(c)
    job = start(c, h).json()["id"]
    body = c.get(f"/anon/downloads/{job}", headers=h).json()
    assert body["status"] == "failed" and body["error_code"] == "too_big" and body["size"] is None
    assert not (env["root"] / job).exists()


def test_a_low_disk_refuses_new_jobs(env, monkeypatch):
    monkeypatch.setattr(anon, "free_bytes", lambda path: 100 * 1024 ** 2)
    c = at()
    r = start(c, token_of(c))
    assert r.status_code == 503 and r.json()["error"] == "disk_low"
    monkeypatch.setenv("ANON_MIN_FREE_MB", "50")
    assert start(c, token_of(c)).status_code == 202


@pytest.mark.parametrize(("error", "code"), [
    (RuntimeError("ERROR: [youtube] x: Video unavailable"), "extractor_failed"),
    (RuntimeError("HTTP Error 404: Not Found"), "not_found"),
    (RuntimeError("HTTP Error 403: Forbidden"), "private"),
    (extractor.PreviewOnly(), "preview_only"),
])
def test_extractor_failures_carry_a_clear_code_and_leave_no_files(env, error, code):
    env["fail"] = error
    c = at()
    h = token_of(c)
    job = start(c, h).json()["id"]
    body = c.get(f"/anon/downloads/{job}", headers=h).json()
    assert body["status"] == "failed" and body["error_code"] == code
    assert not (env["root"] / job).exists()


def test_a_failed_preview_lookup_is_an_extractor_failure(env, monkeypatch):
    def boom(vid):
        raise RuntimeError("blocked")

    monkeypatch.setattr(extractor, "preview", boom)
    c = at()
    h = token_of(c)
    assert c.get(f"/anon/downloads/{start(c, h).json()['id']}", headers=h).json()["error_code"] == "extractor_failed"


def test_the_file_supports_range_and_etag(env):
    c = at()
    h = token_of(c)
    job, _ = ready(c, h)
    url = f"/anon/downloads/{job}/file"
    full = c.get(url, headers=h)
    assert full.headers["accept-ranges"] == "bytes" and int(full.headers["content-length"]) == len(AUDIO)
    assert full.headers["etag"]
    part = c.get(url, headers={**h, "Range": "bytes=100-199"})
    assert part.status_code == 206 and part.content == AUDIO[100:200]
    assert part.headers["content-range"] == f"bytes 100-199/{len(AUDIO)}"
    tail = c.get(url, headers={**h, "Range": "bytes=10000-"})
    assert tail.status_code == 206 and tail.content == AUDIO[10000:]
    assert c.get(url, headers={**h, "Range": "bytes=999999-"}).status_code == 416
    same = c.get(url, headers={**h, "If-None-Match": full.headers["etag"]})
    assert same.status_code == 304 and same.content == b""
    assert c.head(url, headers=h).headers["accept-ranges"] == "bytes"
    assert c.get(url, headers={**h, "If-None-Match": '"other"'}).status_code == 200


def test_the_file_is_not_served_before_it_is_ready(env, monkeypatch):
    monkeypatch.setattr(deps.SCHED, "submit", lambda *a, **k: False)
    c = at()
    h = token_of(c)
    job = start(c, h).json()["id"]
    r = c.get(f"/anon/downloads/{job}/file", headers=h)
    assert r.status_code == 409 and r.json()["error"] == "not_ready"
    assert c.get(f"/anon/downloads/{job}/cover", headers=h).status_code == 404
    assert c.post(f"/anon/downloads/{job}/ack", json={"sha256": "0" * 64}, headers=h).status_code == 409


def test_a_wrong_or_malformed_hash_keeps_the_file(env):
    c = at()
    h = token_of(c)
    job, body = ready(c, h)
    url = f"/anon/downloads/{job}/ack"
    r = c.post(url, json={"sha256": "0" * 64}, headers=h)
    assert r.status_code == 422 and r.json()["error"] == "hash_mismatch"
    for bad in ("", "abc", "g" * 64, body["sha256"] + "0"):
        r = c.post(url, json={"sha256": bad}, headers=h)
        assert r.status_code == 422 and r.json()["error"] == "bad_hash", bad
    assert c.post(url, json={}, headers=h).status_code == 422
    assert (env["root"] / job / f"{VID}.m4a").is_file()
    assert c.get(f"/anon/downloads/{job}/file", headers=h).status_code == 200


def test_ready_jobs_are_swept_one_hour_after_ready(env):
    c = at()
    h = token_of(c)
    job, _ = ready(c, h)
    env["clock"].now += 3599
    assert anon.sweep() == 0 and (env["root"] / job).exists()
    assert c.get(f"/anon/downloads/{job}", headers=h).status_code == 200
    env["clock"].now += 1
    assert anon.sweep() == 1 and not (env["root"] / job).exists()
    assert c.get(f"/anon/downloads/{job}", headers=h).status_code == 404


def test_failed_queued_and_acked_jobs_are_swept_after_fifteen_minutes(env, monkeypatch):
    c = at()
    h = token_of(c)
    env["fail"] = RuntimeError("x")
    failed = start(c, h).json()["id"]
    env["fail"] = None
    acked, body = ready(c, h, VID2)
    c.post(f"/anon/downloads/{acked}/ack", json={"sha256": body["sha256"]}, headers=h)
    monkeypatch.setattr(deps.SCHED, "submit", lambda *a, **k: False)
    queued = start(c, token_of(c)).json()["id"]
    env["clock"].now += 899
    assert anon.sweep() == 0
    env["clock"].now += 1
    assert anon.sweep() == 3
    for job in (failed, acked, queued):
        assert c.get(f"/anon/downloads/{job}", headers=h).status_code == 404
    assert anon._jobs == {}


def test_a_stuck_running_job_is_swept_after_thirty_minutes(env, monkeypatch):
    monkeypatch.setattr(deps.SCHED, "submit", lambda *a, **k: False)
    c = at()
    h = token_of(c)
    job = start(c, h).json()["id"]
    anon._start(anon._jobs[job])
    env["clock"].now += 1799
    assert anon.sweep() == 0
    env["clock"].now += 1
    assert anon.sweep() == 1


def test_a_swept_running_job_leaves_nothing_behind(env):
    job = {"id": "x" * 22, "did": "d" * 32, "state": anon.RUNNING, "created": anon.clock(), "dir": env["root"] / ("x" * 22), "cancelled": False}
    anon._jobs[job["id"]] = job
    env["clock"].now += 1800
    anon.sweep()
    assert job["cancelled"] is True


def test_unknown_directories_are_swept_as_orphans(env):
    env["root"].mkdir(parents=True)
    old, new = env["root"] / "old-orphan", env["root"] / "new-orphan"
    for d in (old, new):
        d.mkdir()
        (d / "x.m4a").write_bytes(b"a")
    stamp = anon.clock()
    os.utime(old, (stamp - 901, stamp - 901))
    os.utime(new, (stamp - 10, stamp - 10))
    anon.sweep()
    assert not old.exists() and new.exists()


def test_everything_staged_before_a_restart_is_removed_on_start(env):
    c = at()
    h = token_of(c)
    job, _ = ready(c, h)
    (env["root"] / "stray.tmp").write_bytes(b"x")
    anon.stop()
    anon.start()
    anon.stop()
    assert list(env["root"].iterdir()) == []
    assert job


def test_the_audit_log_never_holds_the_token_the_url_query_or_raw_ids(env, caplog):
    caplog.set_level(logging.INFO, logger="app.anon")
    c = at("198.51.100.99")
    token = c.post("/anon/session").json()["token"]
    h = {"X-Anon-Token": token}
    job, body = ready(c, h, f"https://www.youtube.com/watch?v={VID}&si=SECRETQUERY")
    c.post(f"/anon/downloads/{job}/ack", json={"sha256": body["sha256"]}, headers=h)
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "anon job queued" in text and "anon job ready" in text and "anon ack" in text
    did = anon.read(token)
    for secret in (token, token.split(".")[0], did, "SECRETQUERY", "198.51.100.99", job):
        assert secret not in text
    assert anon.short(did) in text


def test_turning_the_feature_off_closes_every_route(env, monkeypatch):
    c = at()
    h = token_of(c)
    monkeypatch.setenv("ANON_DOWNLOADS_ENABLED", "0")
    assert c.post("/anon/session").json()["error"] == "anon_disabled"
    r = start(c, h)
    assert r.status_code == 403 and r.json()["error"] == "anon_disabled"


def test_the_staging_folder_is_outside_the_user_pool(env, tmp_path):
    c = at()
    ready(c, token_of(c))
    assert env["root"] == tmp_path / "downloads" / ".anon"
    assert not any(deps.pool_dir().glob("**/*.m4a")) if deps.pool_dir().exists() else True


def test_anonymous_requests_do_not_touch_any_library(env, tmp_path):
    c = at()
    ready(c, token_of(c))
    assert not (tmp_path / "users").exists()
    assert not list((tmp_path / "downloads").glob("users/*"))
