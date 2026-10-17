import time

import pytest
from fastapi.testclient import TestClient

from app import deps, gitstore, main, session, users
from gitrepo import clock, commit_at, make_sync, save

OWNER_FIELDS = {"state", "unpushed", "oldest_unpushed_age_s", "last_push_at", "stale_after_s", "mode",
                "timer_seen", "last_run_at", "last_error", "inbound", "repos"}
REPO_FIELDS = {"name", "state", "unpushed", "oldest_unpushed_age_s", "rejected", "failures"}


@pytest.fixture(autouse=True)
def ident(monkeypatch):
    for k, v in (("NAME", "t"), ("EMAIL", "t@t")):
        monkeypatch.setenv(f"GIT_AUTHOR_{k}", v)
        monkeypatch.setenv(f"GIT_COMMITTER_{k}", v)


def aged(tmp_path, age, **kw):
    now = clock()
    s, bare, clone, *_ = make_sync(tmp_path, clock=now, **kw)
    s.cache_ttl_s = 0
    save(s, clone, "a.json", "1", "x")
    commit_at(clone, now() - age)
    return s


@pytest.mark.parametrize("age,state", [(89, "pending"), (90, "pending"), (91, "stale")])
def test_stale_boundaries(tmp_path, age, state):
    s = aged(tmp_path, age)
    st = s.sync_status(True)
    assert st["state"] == state and st["oldest_unpushed_age_s"] == age and st["stale_after_s"] == 90


def test_custom_interval_and_grace(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    s = aged(tmp_path / "a", 31, interval_s=10, grace_s=20)
    assert s.sync_status(True)["state"] == "stale" and s.stale_after_s == 30
    assert aged(tmp_path / "b", 30, interval_s=10, grace_s=20).sync_status(True)["state"] == "pending"


def test_idle_server_stays_ok_and_age_uses_commit_time_not_last_push(tmp_path):
    now = clock()
    s, bare, clone, *_ = make_sync(tmp_path, clock=now)
    s.cache_ttl_s = 0
    s.push_pass()
    now.box["t"] += 86400
    assert s.sync_status(True)["state"] == "ok"
    save(s, clone, "a.json", "1", "x")
    commit_at(clone, now())
    assert s.sync_status(True)["state"] == "pending"
    now.box["t"] += 100
    assert s.sync_status(True)["state"] == "stale"
    s.push_pass()
    st = s.sync_status(True)
    assert st["state"] == "ok" and st["oldest_unpushed_age_s"] is None and st["last_push_at"]


def test_heartbeat_timer_seen(tmp_path):
    now = clock()
    s, bare, clone, *_ = make_sync(tmp_path, clock=now)
    assert s.sync_status(True)["timer_seen"] is False
    s.push_pass()
    assert s.sync_status(True)["timer_seen"] is True
    now.box["t"] += 180
    assert s.sync_status(True)["timer_seen"] is True
    now.box["t"] += 1
    assert s.sync_status(True)["timer_seen"] is False


def test_no_upstream_is_an_error(tmp_path):
    import subprocess
    lone = tmp_path / "lone"
    subprocess.run(["git", "init", "-q", "-b", "main", str(lone)], check=True)
    s = gitstore.GitSync(lone, state_file=tmp_path / "st.json")
    st = s.sync_status(True)
    assert st["state"] == "error" and "no upstream" in st["last_error"]


@pytest.fixture
def api(tmp_path, monkeypatch):
    s, bare, clone, *_ = make_sync(tmp_path)
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(deps, "SYNC", s)
    save(s, clone, "a.json", "1", "x")
    return TestClient(main.app, base_url="https://testserver"), s


def test_only_the_owner_sees_counts(api):
    client, s = api
    owner = client.get("/health", headers={"X-API-Token": "secret"}).json()
    assert set(owner["sync"]) == OWNER_FIELDS and all(set(r) == REPO_FIELDS for r in owner["sync"]["repos"])
    assert owner["sync"]["unpushed"] == 1 and owner["sync"]["mode"] == "timer" and owner["sync"]["timer_seen"] is False
    assert isinstance(owner["sync"]["stale_after_s"], int)
    assert client.get("/health").json() == {"status": "ok", "sync": {"state": "ok"}}
    assert client.get("/health", headers={"X-API-Token": "wrong"}).json()["sync"] == {"state": "ok"}
    assert client.get("/health", headers={"Authorization": "Bearer junk"}).json()["sync"] == {"state": "ok"}
    guest = TestClient(main.app)
    assert guest.get("/health").json()["sync"] == {"state": "ok"}


def test_owner_by_session_and_non_owner_session(api):
    client, s = api
    s.cache_ttl_s = 0
    mine = {"provider": "google", "email": users.owner_email(), "uid": ""}
    client.headers["Cookie"] = f"__Host-session={session.issue(mine)}"
    assert set(client.get("/health").json()["sync"]) == OWNER_FIELDS
    other = {"provider": "google", "email": "bob@example.com", "uid": ""}
    client.headers["Cookie"] = f"__Host-session={session.issue(other)}"
    assert client.get("/health").json()["sync"] == {"state": "ok"}
    assert users.read_profile(deps.profile_path(users.uid_for_email("bob@example.com"))) is None


def test_degraded_for_everyone_else_when_stale_or_error(api):
    client, s = api
    s.cache_ttl_s = 0
    s.interval_s, s.grace_s = 0, 0
    s.clock = lambda: time.time() + 5
    assert client.get("/health").json()["sync"] == {"state": "degraded"}
    s.interval_s, s.grace_s = 60, 30
    assert client.get("/health").json()["sync"] == {"state": "ok"}


def test_no_store_and_default_mode(monkeypatch):
    monkeypatch.setattr(deps, "SYNC", None)
    c = TestClient(main.app)
    assert c.get("/health").json() == {"status": "ok", "sync": {"state": "ok"}}
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    owner = c.get("/health", headers={"X-API-Token": "secret"}).json()["sync"]
    assert owner["unpushed"] == 0 and owner["mode"] == "none" and owner["state"] == "ok"
    monkeypatch.delenv("GIT_SYNC_MODE", raising=False)
    monkeypatch.setenv("AUDIO_DATA_REPO", "/x")
    assert gitstore.from_env().mode == "timer"
    monkeypatch.setenv("GIT_SYNC_MODE", "request")
    assert gitstore.from_env().mode == "request"
    monkeypatch.setenv("GIT_SYNC_MODE", "bogus")
    assert gitstore.from_env().mode == "timer"
    monkeypatch.setenv("GIT_SYNC_INTERVAL_S", "30")
    monkeypatch.setenv("GIT_SYNC_STALE_GRACE_S", "x")
    g = gitstore.from_env()
    assert (g.interval_s, g.grace_s, g.stale_after_s) == (30, 30, 60)
