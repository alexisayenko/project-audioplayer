import threading
import time

import pytest

from app import deps, main, migrations, readiness as rd
from app.readiness import Readiness, allowed_while_starting, readiness
from tests.test_library import H, client  # noqa: F401

DATA_ROUTES = [("GET", "/library"), ("GET", "/me"), ("GET", "/genres/graph"), ("GET", "/files/dQw4w9WgXcQ"), ("GET", "/covers/dQw4w9WgXcQ"),
               ("GET", "/auth/me"), ("POST", "/songs"), ("GET", "/features/data"), ("GET", "/catalog"), ("GET", "/tags"), ("DELETE", "/songs/dQw4w9WgXcQ")]
STEPS = ("migrate_model2", "migrate_model3", "migrate_tags", "migrate_removals", "migrate_renames", "migrate_retired", "migrate_version_norm")


class Gate:
    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()

    def wait(self):
        self.entered.set()
        assert self.release.wait(10)
        return 0


def _threaded(monkeypatch):
    monkeypatch.delenv("AUDIO_STARTUP_SYNC", raising=False)
    monkeypatch.setattr(deps, "SYNC", None)
    for name in STEPS:
        monkeypatch.setattr(getattr(migrations, name), "run", lambda: 0)


@pytest.fixture
def background(monkeypatch):
    """Startup in a real thread: the first migration blocks until the test sets `release`."""
    _threaded(monkeypatch)
    gate = Gate()
    monkeypatch.setattr(migrations.migrate_model2, "run", gate.wait)
    return gate


def wait_ready(c, seconds=5):
    end = time.time() + seconds
    while time.time() < end:
        if c.get("/health").json()["ready"]:
            return True
        time.sleep(0.02)
    return False


def test_data_routes_wait_while_the_worker_runs(client, background):
    with client as c:
        assert background.entered.wait(5)
        for method, path in DATA_ROUTES:
            r = c.request(method, path, headers=H)
            assert r.status_code == 503, (method, path)
            assert r.headers["retry-after"] == "3"
            assert r.headers["cache-control"] == "no-store"
            assert r.json() == {"detail": "starting", "step": "migrate model 2"}
            assert "noindex" in r.headers["x-robots-tag"]
        background.release.set()
        assert wait_ready(c)
        assert c.get("/library", headers=H).status_code == 200
        assert c.get("/library", headers=H).headers["cache-control"] == "private, no-cache"


def test_static_files_and_health_are_served_while_starting(client, background):
    with client as c:
        assert background.entered.wait(5)
        assert c.get("/").status_code == 200
        assert c.get("/js/api.js").status_code == 200
        assert c.get("/style.css").status_code == 200
        assert c.get("/robots.txt").status_code == 200
        assert c.head("/health").status_code == 200
        h = c.get("/health").json()
        assert h["status"] == "ok"
        assert h["ready"] is False
        assert h["startup"] == {"state": "starting", "step": "migrate model 2"}
        assert h["sync"] == {"state": "pending"}
        owner = c.get("/health", headers=H).json()
        assert owner["ready"] is False
        assert owner["startup"]["error"] is None
        assert "elapsed_s" in owner["startup"]
        background.release.set()
        assert wait_ready(c)
        assert c.get("/health").json()["startup"] == {"state": "ready", "step": None}


def test_head_and_writes_to_page_paths_are_not_allowed_through(client, background):
    with client as c:
        assert background.entered.wait(5)
        assert c.head("/library").status_code == 503
        assert c.post("/", headers=H).status_code == 503
        background.release.set()
        assert wait_ready(c)


def test_503_comes_before_auth_csrf_and_the_guest_allow_list(client, background):
    with client as c:
        assert background.entered.wait(5)
        assert c.get("/library").status_code == 503
        assert c.post("/songs", json={}).status_code == 503
        assert c.post("/auth/session", json={}).status_code == 503
        background.release.set()
        assert wait_ready(c)
        assert c.post("/songs", json={}).status_code in (401, 403)


def test_the_canonical_host_redirect_still_wraps_the_gate(client, background, monkeypatch):
    monkeypatch.setenv("PUBLIC_HOSTS", "new.example.net,old.example.net")
    monkeypatch.setenv("CANONICAL_HOST", "new.example.net")
    with client as c:
        assert background.entered.wait(5)
        r = c.get("/health", headers={"host": "old.example.net"}, follow_redirects=False)
        assert r.status_code == 200
        background.release.set()
        assert wait_ready(c)


def test_a_failing_migration_is_logged_and_the_server_still_becomes_ready(client, monkeypatch, caplog):
    _threaded(monkeypatch)
    ran = []
    for name in STEPS:
        monkeypatch.setattr(getattr(migrations, name), "run", lambda n=name: ran.append(n) or 0)

    def boom():
        raise RuntimeError("migration exploded")

    monkeypatch.setattr(migrations.migrate_tags, "run", boom)
    with client as c:
        assert wait_ready(c)
        assert c.get("/library", headers=H).status_code == 200
        assert c.get("/health").json()["startup"]["state"] == "ready"
    assert "startup step migrate tags failed" in caplog.text
    assert ran == ["migrate_model2", "migrate_model3", "migrate_removals", "migrate_renames", "migrate_retired", "migrate_version_norm"]


def test_a_crashed_worker_marks_failed_and_stops_blocking(caplog):
    state = Readiness()
    state.begin()

    class Fatal(BaseException):
        pass

    def crash():
        raise Fatal("worker died")

    rd.run_worker([("boom", crash)], state)
    snap = state.snapshot(owner=True)
    assert snap["ready"] is True
    assert snap["startup"]["state"] == "failed"
    assert "worker died" in snap["startup"]["error"]
    assert state.snapshot()["startup"] == {"state": "failed", "step": None}
    assert "worker crashed" in caplog.text


def test_the_cap_unblocks_the_app_and_warns_once(client, background, monkeypatch, caplog):
    monkeypatch.setenv("AUDIO_STARTUP_MAX_S", "0.2")
    with client as c:
        assert background.entered.wait(5)
        assert c.get("/library", headers=H).status_code == 503
        threading.Event().wait(0.3)
        r = c.get("/library", headers=H)
        assert r.status_code == 200, r.text
        h = c.get("/health").json()
        assert h["ready"] is True
        assert h["startup"]["state"] == "overdue"
        background.release.set()
        end = time.time() + 5
        while time.time() < end and c.get("/health").json()["startup"]["state"] != "ready":
            time.sleep(0.02)
        assert c.get("/health").json()["startup"]["state"] == "ready"
    assert caplog.text.count("serving requests anyway") == 1


def test_the_cap_reads_the_environment(monkeypatch):
    assert rd.max_seconds() == 300.0
    monkeypatch.setenv("AUDIO_STARTUP_MAX_S", "12")
    assert rd.max_seconds() == 12.0
    monkeypatch.setenv("AUDIO_STARTUP_MAX_S", "nope")
    assert rd.max_seconds() == 300.0


def test_sync_switch_runs_the_worker_before_startup_returns(monkeypatch):
    order = []
    for name in STEPS:
        monkeypatch.setattr(getattr(migrations, name), "run", lambda n=name: order.append(n) or 0)
    monkeypatch.setattr(main.features, "record_startup", lambda: order.append("record_startup"))
    monkeypatch.setattr(deps, "SYNC", type("S", (), {"recover_on_startup": staticmethod(lambda: order.append("git"))})())
    main._startup()
    assert order == ["git", *STEPS, "record_startup"]
    assert readiness.snapshot()["startup"]["state"] == "ready"


def test_without_the_switch_startup_returns_while_the_worker_still_runs(monkeypatch):
    _threaded(monkeypatch)
    gate = Gate()
    monkeypatch.setattr(migrations.migrate_model2, "run", gate.wait)
    main._startup()
    assert gate.entered.wait(5)
    assert readiness.blocking()
    gate.release.set()
    end = time.time() + 5
    while time.time() < end and readiness.blocking():
        time.sleep(0.01)
    assert not readiness.blocking()


def test_idle_state_never_blocks_and_reports_ready():
    state = Readiness()
    assert state.blocking() is False
    assert state.snapshot() == {"ready": True, "startup": {"state": "ready", "step": None}}


@pytest.mark.parametrize("method,path,ok", [
    ("GET", "/health", True), ("HEAD", "/health", True), ("POST", "/health", True),
    ("GET", "/", True), ("GET", "/index.html", True), ("GET", "/js/app.js", True), ("GET", "/_v/abc/js/app.js", True),
    ("GET", "/style.css", True), ("GET", "/favicon.svg", True), ("GET", "/robots.txt", True), ("GET", "/legal", True),
    ("POST", "/", False), ("GET", "/library", False), ("GET", "/files/x", False), ("GET", "/covers/x", False), ("GET", "/me", False),
    ("GET", "/auth/me", False), ("GET", "/genres/graph", False), ("GET", "/features/data", False), ("GET", "/users/x/library.json", False),
])
def test_the_allow_list(method, path, ok):
    assert allowed_while_starting(method, path) is ok
