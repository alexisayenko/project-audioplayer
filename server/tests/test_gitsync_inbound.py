import json
import logging
import threading
import time

import pytest

from app import gitstore, gitsync, library
from gitrepo import git, make_sync, save, subjects

LIB = "users/u/library.json"
GOOD = json.dumps({"settings": {}, "songs": [{"id": "abcdefghijk", "title": "T", "artist": "A"}]})
MSG = "data diverged: GitHub and the server both have new commits; resolve by hand"


@pytest.fixture(autouse=True)
def ident(monkeypatch):
    for k, v in (("NAME", "t"), ("EMAIL", "t@t")):
        monkeypatch.setenv(f"GIT_AUTHOR_{k}", v)
        monkeypatch.setenv(f"GIT_COMMITTER_{k}", v)


def remote_commit(tmp_path, bare, rel, text, msg="from github", name="other"):
    other = tmp_path / name
    if not other.exists():
        git(tmp_path, "clone", str(bare), str(other))
    else:
        git(other, "pull", "-q", "--ff-only")
    p = other / "audioplayer" / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    git(other, "add", "-A")
    git(other, "commit", "-m", msg)
    git(other, "push", "-q")
    return other


def timer_of(s, **kw):
    return gitstore.GitSync(s.data_repo, s.covers_repo, state_file=s.state_file, clock=s.clock, **kw)


def test_fast_forward_is_applied_and_visible_without_a_restart(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    remote_commit(tmp_path, bare, LIB, GOOD)
    assert not (clone / "audioplayer" / LIB).exists()
    assert s.push_pass() == 0
    assert git(clone, "rev-parse", "HEAD") == git(bare, "rev-parse", "main")
    assert git(clone, "rev-list", "--merges", "--count", "HEAD") == "0"
    assert library.load(clone / "audioplayer" / LIB)[0]["title"] == "T"
    st = s.sync_status(True)
    assert st["state"] == "ok" and st["inbound"] == {"enabled": True, "last_pull_at": st["inbound"]["last_pull_at"], "behind": 0}
    assert st["inbound"]["last_pull_at"] and st["last_error"] is None
    assert gitstore.load_state(s.state_file)["repos"]["data"]["last_pull_at"]


def test_nothing_ahead_changes_nothing(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    head = git(clone, "rev-parse", "HEAD")
    assert s.push_pass() == 0
    assert git(clone, "rev-parse", "HEAD") == head
    st = s.sync_status(True)
    assert st["inbound"]["last_pull_at"] is None and st["inbound"]["behind"] == 0 and st["state"] == "ok"


def test_local_ahead_only_still_pushes(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, "a.json", "1", "mine")
    assert s.push_pass() == 0
    assert subjects(bare)[0] == "mine"


def test_diverged_changes_nothing_and_shows_as_error(tmp_path, caplog):
    s, bare, clone, *_ = make_sync(tmp_path)
    remote_commit(tmp_path, bare, "x.json", "{}", "remote")
    save(s, clone, "a.json", "1", "mine")
    head, remote_head = git(clone, "rev-parse", "HEAD"), git(bare, "rev-parse", "main")
    with caplog.at_level(logging.ERROR):
        assert s.push_pass() == 2
    assert git(clone, "rev-parse", "HEAD") == head and git(bare, "rev-parse", "main") == remote_head
    assert not (clone / "audioplayer" / "x.json").exists()
    assert any(MSG in r.getMessage() and r.levelno == logging.ERROR for r in caplog.records)
    st = s.sync_status(True)
    assert st["state"] == "error" and st["last_error"] == MSG and st["inbound"]["behind"] == 1
    assert s.sync_status(False) == {"state": "degraded"}
    assert not gitstore.load_state(s.state_file)["repos"]["data"]["rejected"]
    assert s.push_pass() == 2


def test_diverged_clears_itself_once_resolved_by_hand(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    remote_commit(tmp_path, bare, "x.json", "{}", "remote")
    save(s, clone, "a.json", "1", "mine")
    assert s.push_pass() == 2
    git(clone, "pull", "--rebase")
    s.cache_ttl_s = 0
    assert s.push_pass() == 0
    assert subjects(bare)[:2] == ["mine", "remote"]
    st = s.sync_status(True)
    assert st["state"] == "ok" and st["last_error"] is None


def test_push_rejected_after_the_fetch_becomes_diverged_not_sticky_rejected(tmp_path, monkeypatch):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, "a.json", "1", "mine")
    remote_commit(tmp_path, bare, "x.json", "{}", "remote")
    monkeypatch.setattr(s, "inbound_repo", lambda *a, **k: gitstore.Inbound("none"))
    assert s.push_pass() == 2
    st = s.sync_status(True)
    assert st["state"] == "error" and st["last_error"] == MSG
    assert not gitstore.load_state(s.state_file)["repos"]["data"]["rejected"]


@pytest.mark.parametrize("bad", ["{not json", json.dumps({"songs": 5}), "[1", json.dumps("text")])
def test_invalid_inbound_library_is_not_applied(tmp_path, caplog, bad):
    s, bare, clone, *_ = make_sync(tmp_path)
    remote_commit(tmp_path, bare, LIB, bad)
    head = git(clone, "rev-parse", "HEAD")
    with caplog.at_level(logging.ERROR):
        assert s.push_pass() == 1
    assert git(clone, "rev-parse", "HEAD") == head and not (clone / "audioplayer" / LIB).exists()
    assert any(LIB in r.getMessage() for r in caplog.records)
    st = s.sync_status(True)
    assert st["state"] == "error" and "inbound change invalid" in st["last_error"]
    remote_commit(tmp_path, bare, LIB, GOOD, "fixed")
    assert s.push_pass() == 0
    assert library.load(clone / "audioplayer" / LIB)[0]["id"] == "abcdefghijk"
    assert s.sync_status(True)["state"] == "ok"


def test_invalid_profile_json_is_not_applied(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    remote_commit(tmp_path, bare, "users/u/profile.json", "[]")
    assert s.push_pass() == 1
    assert not (clone / "audioplayer" / "users").exists()


def test_a_file_that_goes_bad_after_the_merge_is_rolled_back(tmp_path, monkeypatch, caplog):
    s, bare, clone, *_ = make_sync(tmp_path)
    remote_commit(tmp_path, bare, LIB, GOOD)
    head = git(clone, "rev-parse", "HEAD")
    calls = []

    def first_ok_then_broken(rel, text):
        calls.append(rel)
        return None if len(calls) == 1 else "broken"

    monkeypatch.setattr(gitstore, "check_inbound_json", first_ok_then_broken)
    with caplog.at_level(logging.ERROR):
        assert s.push_pass() == 1
    assert git(clone, "rev-parse", "HEAD") == head and not (clone / "audioplayer" / LIB).exists()
    assert git(clone, "status", "--porcelain") == ""
    assert any("rolled back" in r.getMessage() and LIB in r.getMessage() for r in caplog.records)
    assert "inbound change invalid" in s.sync_status(True)["last_error"]


def test_a_busy_write_lock_skips_the_pull_and_never_delays_the_save(tmp_path):
    server, bare, clone, *_ = make_sync(tmp_path)
    timer = timer_of(server)
    remote_commit(tmp_path, bare, LIB, GOOD)
    inside, release = threading.Event(), threading.Event()

    def saving():
        with server.transaction():
            inside.set()
            release.wait(5)

    t = threading.Thread(target=saving)
    t.start()
    assert inside.wait(5)
    t0 = time.monotonic()
    assert timer.push_pass() == 0
    assert time.monotonic() - t0 < 3
    assert not (clone / "audioplayer" / LIB).exists()
    release.set()
    t.join()
    assert timer.push_pass() == 0
    assert (clone / "audioplayer" / LIB).exists()


def test_a_save_during_a_pull_waits_for_it_and_lands_on_top(tmp_path, monkeypatch):
    server, bare, clone, *_ = make_sync(tmp_path)
    timer = timer_of(server)
    remote_commit(tmp_path, bare, LIB, GOOD)
    inside = threading.Event()
    real = gitstore.check_inbound_json
    pulled_at = []

    def slow(rel, text):
        inside.set()
        time.sleep(0.6)
        pulled_at.append(time.monotonic())
        return real(rel, text)

    monkeypatch.setattr(gitstore, "check_inbound_json", slow)
    t = threading.Thread(target=timer.push_pass)
    t.start()
    assert inside.wait(5)
    t0 = time.monotonic()
    save(server, clone, "a.json", "mine", "save during pull")
    done = time.monotonic()
    t.join()
    assert pulled_at and done >= pulled_at[0] - 0.05
    assert done - t0 < 5
    assert git(clone, "log", "--format=%s", "-2") == "save during pull\nfrom github"
    assert library.load(clone / "audioplayer" / LIB)[0]["title"] == "T"
    assert git(clone, "status", "--porcelain") == ""


def test_the_write_lock_is_reentrant_and_released(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    with s.exclusive():
        with s.transaction():
            pass
    other = timer_of(s)
    with other.try_exclusive(0.2) as got:
        assert got
    with s.try_exclusive(0.2) as got:
        assert got
        with other.try_exclusive(0.1) as busy:
            assert not busy


def test_covers_repo_is_pulled_and_diverges_on_its_own(tmp_path):
    s, bare, clone, cbare, cov = make_sync(tmp_path, covers=True)
    remote_commit(tmp_path, cbare, "users/u/covers/a.jpg", "img", "cover from github", name="cother")
    assert s.push_pass() == 0
    assert (cov / "audioplayer" / "users/u/covers/a.jpg").read_text() == "img"
    remote_commit(tmp_path, cbare, "users/u/covers/b.jpg", "img2", "again", name="cother")
    save(s, cov, "users/u/covers/c.jpg", "mine", "my cover")
    assert s.push_pass() == 2
    st = s.sync_status(True)
    assert st["last_error"] == MSG.replace("data", "covers", 1)
    assert [r["state"] for r in st["repos"]] == ["ok", "error"]


def test_inbound_switch_off_keeps_the_old_behaviour(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_DATA_REPO", "/x")
    monkeypatch.setenv("GIT_SYNC_INBOUND", "0")
    assert gitstore.from_env().inbound is False
    monkeypatch.setenv("GIT_SYNC_INBOUND", "1")
    assert gitstore.from_env().inbound is True
    monkeypatch.delenv("GIT_SYNC_INBOUND")
    assert gitstore.from_env().inbound is True
    s, bare, clone, *_ = make_sync(tmp_path, inbound=False)
    remote_commit(tmp_path, bare, LIB, GOOD)
    assert s.push_pass() == 0
    assert not (clone / "audioplayer" / LIB).exists()
    assert s.sync_status(True)["inbound"]["enabled"] is False
    save(s, clone, "a.json", "1", "mine")
    assert s.push_pass() == 2
    assert gitstore.load_state(s.state_file)["repos"]["data"]["rejected"]
    assert s.sync_status(True)["last_error"] == "data: push rejected"


def test_startup_applies_valid_inbound_and_refuses_invalid(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    remote_commit(tmp_path, bare, LIB, "{bad")
    head = git(clone, "rev-parse", "HEAD")
    s.recover_on_startup()
    assert git(clone, "rev-parse", "HEAD") == head and not (clone / "audioplayer" / LIB).exists()
    remote_commit(tmp_path, bare, LIB, GOOD, "fixed")
    s.recover_on_startup()
    assert (clone / "audioplayer" / LIB).exists()


def test_startup_divergence_is_an_error_but_not_sticky(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    remote_commit(tmp_path, bare, "x.json", "{}", "remote")
    save(s, clone, "a.json", "1", "mine")
    s.recover_on_startup()
    assert s.sync_status(True)["state"] == "error"
    assert not gitstore.load_state(s.state_file)["repos"]["data"]["rejected"]
    assert subjects(bare)[0] == "remote"


def test_cli_exit_codes_and_status_shape(tmp_path, monkeypatch, capsys):
    s, bare, clone, *_ = make_sync(tmp_path)
    monkeypatch.setenv("AUDIO_DATA_REPO", str(clone))
    monkeypatch.setenv("GIT_SYNC_STATE_FILE", str(s.state_file))
    remote_commit(tmp_path, bare, LIB, GOOD)
    assert gitsync.main([]) == 0
    capsys.readouterr()
    assert gitsync.main(["--status"]) == 0
    assert json.loads(capsys.readouterr().out)["inbound"]["last_pull_at"]


@pytest.mark.parametrize("rel,text,ok", [
    ("a/library.json", GOOD, True),
    ("a/library.json", "[]", True),
    ("a/library.json", "{}", True),
    ("a/library.json", '{"songs": "x"}', False),
    ("a/library.json", "nope", False),
    ("a/profile.json", '{"email": "a@b"}', True),
    ("a/profile.json", "[]", False),
])
def test_check_inbound_json(rel, text, ok):
    assert (gitstore.check_inbound_json(rel, text) is None) is ok
