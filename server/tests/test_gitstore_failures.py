import os
import subprocess
import threading
import time

import pytest

from app import gitstore


def git(cwd, *args):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
                          cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture(autouse=True)
def ident(monkeypatch):
    for k, v in (("NAME", "t"), ("EMAIL", "t@t")):
        monkeypatch.setenv(f"GIT_AUTHOR_{k}", v)
        monkeypatch.setenv(f"GIT_COMMITTER_{k}", v)


def remote(tmp_path, name):
    bare = tmp_path / f"{name}.git"
    git(tmp_path, "init", "--bare", "-b", "main", str(bare))
    seed = tmp_path / f"{name}-seed"
    git(tmp_path, "clone", str(bare), str(seed))
    git(seed, "checkout", "-b", "main")
    (seed / "README").write_text(name)
    git(seed, "add", "README")
    git(seed, "commit", "-m", "init")
    git(seed, "push", "-u", "origin", "main")
    clone = tmp_path / name
    git(tmp_path, "clone", str(bare), str(clone))
    return bare, clone


@pytest.fixture
def sync(tmp_path):
    bare, clone = remote(tmp_path, "data")
    s = gitstore.GitSync(clone, backoff=(0.01, 0.02), mode="request")
    yield s, bare, clone
    s.stop()


def write(clone, rel, text):
    p = clone / "audioplayer" / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def fail_in_transaction(s, clone, text, exc):
    with s.transaction():
        write(clone, "a.json", text)
        raise exc


def heads(bare):
    return git(bare, "log", "--format=%s", "main").splitlines()


def wait(cond, secs=5):
    end = time.time() + secs
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


def test_roots_follow_the_repos(tmp_path):
    a = gitstore.GitSync(tmp_path / "d", tmp_path / "c")
    assert a.data_root == tmp_path / "d" / "audioplayer"
    assert a.covers_root == tmp_path / "c" / "audioplayer"
    assert gitstore.GitSync(tmp_path / "d").covers_root is None


def test_ssh_key_goes_into_git_ssh_command_and_identity_defaults(tmp_path, monkeypatch):
    for n in ("GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_SSH_COMMAND"):
        monkeypatch.delenv(n, raising=False)
    env = gitstore.GitSync(tmp_path, ssh_key="/k/id")._env()
    assert '-i "/k/id"' in env["GIT_SSH_COMMAND"]
    assert "BatchMode=yes" in env["GIT_SSH_COMMAND"]
    assert env["GIT_TERMINAL_PROMPT"] == "0"
    assert env["GIT_AUTHOR_NAME"] == env["GIT_COMMITTER_NAME"] == "audioplayer-server"
    assert "GIT_SSH_COMMAND" not in gitstore.GitSync(tmp_path)._env()


def test_error_messages_never_contain_the_ssh_key_path(tmp_path):
    key = str(tmp_path)
    s = gitstore.GitSync(tmp_path, ssh_key=key)
    with pytest.raises(gitstore.GitError) as ei:
        s._git(tmp_path, "checkout", key)
    assert key not in str(ei.value)
    assert len(str(ei.value)) < 400


def test_commit_pushes_and_status_ok(sync):
    s, bare, clone = sync
    with s.transaction():
        write(clone, "users/u/library.json", "{}")
        s.commit("first")
    assert heads(bare)[0] == "first"
    assert s.status() == "ok"


def test_commit_with_no_changes_makes_no_commit(sync):
    s, bare, clone = sync
    s.commit("nothing")
    assert heads(bare) == ["init"]
    assert s.status() == "ok"


def test_transaction_rolls_back_tracked_changes_when_body_raises(sync):
    s, bare, clone = sync
    with s.transaction():
        write(clone, "a.json", "one")
        s.commit("add a")
    boom = RuntimeError("boom")
    with pytest.raises(RuntimeError):
        fail_in_transaction(s, clone, "two", boom)
    assert (clone / "audioplayer" / "a.json").read_text() == "one"


def test_transaction_rollback_also_on_keyboard_interrupt(sync):
    s, bare, clone = sync
    with s.transaction():
        write(clone, "a.json", "one")
        s.commit("add a")
    interrupt = KeyboardInterrupt()
    with pytest.raises(KeyboardInterrupt):
        fail_in_transaction(s, clone, "x", interrupt)
    assert (clone / "audioplayer" / "a.json").read_text() == "one"


def test_git_add_failure_raises_giterror(sync, monkeypatch):
    s, bare, clone = sync
    real = s._git

    def fake(repo, *args, check=True):
        if args[0] == "add":
            return subprocess.CompletedProcess(args, 128, "", "fatal: unable to write index")
        return real(repo, *args, check=check)

    monkeypatch.setattr(s, "_git", fake)
    with pytest.raises(gitstore.GitError, match="git add failed"):
        s.commit("x")


def test_push_failure_stays_pending_then_goes_error_then_recovers(sync, tmp_path):
    s, bare, clone = sync
    git(clone, "remote", "set-url", "origin", str(tmp_path / "gone.git"))
    s._backoff = (3600, 3600)
    with s.transaction():
        write(clone, "a.json", "1")
        s.commit("offline")
    assert s.status() == "pending"
    for _ in range(gitstore.FAILS_BEFORE_ERROR):
        s._push_all()
    assert s.status() == "error"
    git(clone, "remote", "set-url", "origin", str(bare))
    assert s._push_all() is True
    assert s.status() == "ok"
    assert heads(bare)[0] == "offline"


def test_retry_backoff_doubles_up_to_cap_and_stops_after_success(sync, monkeypatch):
    s, bare, clone = sync
    waits = []
    outcomes = iter([False, False, False, True])
    monkeypatch.setattr(s._stop, "wait", lambda d: waits.append(d) or False)
    monkeypatch.setattr(s, "pull", lambda: None)
    monkeypatch.setattr(s, "_push_all", lambda: next(outcomes))
    s._backoff = (1.0, 3.0)
    s._retry_loop()
    assert waits == [1.0, 2.0, 3.0, 3.0]


def test_retry_loop_exits_when_stopped(sync, monkeypatch):
    s, *_ = sync
    s._stop.set()
    called = []
    monkeypatch.setattr(s, "_push_all", lambda: called.append(1))
    s._retry_loop()
    assert called == []


def test_retry_thread_pushes_after_remote_returns(sync, tmp_path):
    s, bare, clone = sync
    git(clone, "remote", "set-url", "origin", str(tmp_path / "gone.git"))
    with s.transaction():
        write(clone, "a.json", "1")
        s.commit("later")
    assert s.status() == "pending"
    git(clone, "remote", "set-url", "origin", str(bare))
    assert wait(lambda: s.status() == "ok")
    assert heads(bare)[0] == "later"


def test_ensure_retry_does_not_start_a_second_thread(sync, monkeypatch):
    s, *_ = sync
    gate = threading.Event()
    monkeypatch.setattr(s, "_retry_loop", gate.wait)
    s._ensure_retry()
    first = s._retry
    s._ensure_retry()
    assert s._retry is first
    gate.set()
    first.join(2)


def test_pull_failure_is_not_fatal_and_aborts_rebase(sync, monkeypatch):
    s, bare, clone = sync
    calls = []
    real = s._git

    def fake(repo, *args, check=True):
        calls.append(args[:2])
        if args[0] == "pull":
            raise gitstore.GitError("offline")
        return real(repo, *args, check=check)

    monkeypatch.setattr(s, "_git", fake)
    s.pull()
    assert ("rebase", "--abort") in calls


def test_resync_marks_unpushed_repo_dirty_and_pushes(sync):
    s, bare, clone = sync
    write(clone, "a.json", "1")
    git(clone, "add", "-A")
    git(clone, "commit", "-m", "left over")
    s.resync()
    assert wait(lambda: s.status() == "ok")
    assert heads(bare)[0] == "left over"


def test_resync_noop_when_nothing_ahead_or_no_upstream(sync, tmp_path):
    s, bare, clone = sync
    s.resync()
    assert s.status() == "ok"
    assert s._retry is None
    lone = tmp_path / "lone"
    git(tmp_path, "init", "-b", "main", str(lone))
    t = gitstore.GitSync(lone, mode="request")
    t.resync()
    assert t.status() == "ok"


def test_stop_without_thread_is_safe(tmp_path):
    gitstore.GitSync(tmp_path).stop()


def test_from_env(tmp_path, monkeypatch):
    monkeypatch.delenv("AUDIO_DATA_REPO", raising=False)
    assert gitstore.from_env() is None
    monkeypatch.setenv("AUDIO_DATA_REPO", "  ")
    assert gitstore.from_env() is None
    monkeypatch.setenv("AUDIO_DATA_REPO", str(tmp_path / "d"))
    monkeypatch.delenv("AUDIO_COVERS_REPO", raising=False)
    monkeypatch.delenv("AUDIO_GIT_SSH_KEY", raising=False)
    g = gitstore.from_env()
    assert g.covers_repo is None
    assert g._ssh_key is None
    monkeypatch.setenv("AUDIO_COVERS_REPO", str(tmp_path / "c"))
    monkeypatch.setenv("AUDIO_GIT_SSH_KEY", "/k")
    g = gitstore.from_env()
    assert g.covers_repo == tmp_path / "c"
    assert g._ssh_key == "/k"
    assert os.environ["AUDIO_GIT_SSH_KEY"] == "/k"


def test_rollback_keeps_untracked_files_that_existed_before_the_transaction(sync):
    s, _, clone = sync
    write(clone, "covers/kept.jpg", "cover")
    boom = RuntimeError("boom")
    with pytest.raises(RuntimeError):
        fail_in_transaction(s, clone, "x", boom)
    assert (clone / "audioplayer" / "covers" / "kept.jpg").read_text() == "cover"
    assert not (clone / "audioplayer" / "a.json").exists()
