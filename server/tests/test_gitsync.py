import json
import os
import subprocess
import threading
import time

import pytest

from app import gitstore, gitsync, jsonio
from gitrepo import clock, commit_at, git, make_sync, save, slow_hook, subjects, wait, write


@pytest.fixture(autouse=True)
def ident(monkeypatch):
    for k, v in (("NAME", "t"), ("EMAIL", "t@t")):
        monkeypatch.setenv(f"GIT_AUTHOR_{k}", v)
        monkeypatch.setenv(f"GIT_COMMITTER_{k}", v)


def test_saves_are_fast_and_never_touch_the_network_even_with_a_slow_remote(tmp_path, monkeypatch):
    s, bare, clone, *_ = make_sync(tmp_path)
    slow_hook(bare, 3)
    names = []
    real = subprocess.run
    monkeypatch.setattr(gitstore.subprocess, "run", lambda cmd, *a, **k: names.append(cmd[1]) or real(cmd, *a, **k))
    for i in range(10):
        t0 = time.monotonic()
        save(s, clone, "a.json", str(i), f"save {i}")
        assert time.monotonic() - t0 < 1
    assert not {"push", "pull", "fetch"} & set(names)
    assert subjects(bare) == ["init"]
    assert s.probe(clone, fresh=True).count == 10


def test_a_save_leaves_one_local_commit_and_pending(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, "users/u/library.json", "{}", "audioplayer: 1a2b3c4d edit abc")
    assert git(clone, "log", "--format=%s", "-1") == "audioplayer: 1a2b3c4d edit abc"
    assert s.unpushed(clone)[0] == 1
    assert s.sync_status(True)["state"] == "pending"
    assert subjects(bare) == ["init"]


def test_a_save_during_a_push_returns_at_once_and_the_history_stays_linear(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, "a.json", "1", "first")
    slow_hook(bare, 2)
    result = {}
    pusher = threading.Thread(target=lambda: result.update(r=s.push_repo(clone)))
    pusher.start()
    time.sleep(0.5)
    t0 = time.monotonic()
    save(s, clone, "a.json", "2", "second")
    assert time.monotonic() - t0 < 1
    pusher.join()
    assert result["r"].status == "ok"
    assert s.unpushed(clone)[0] == 1
    assert s.push_repo(clone).status == "ok"
    assert subjects(bare) == ["second", "first", "init"]
    assert git(bare, "rev-list", "--merges", "--count", "main") == "0"


def test_push_failure_counts_up_to_error_logs_and_recovers(tmp_path, caplog):
    now = clock()
    s, bare, clone, *_ = make_sync(tmp_path, clock=now)
    git(clone, "remote", "set-url", "origin", str(tmp_path / "gone.git"))
    save(s, clone, "a.json", "1", "offline")
    commit_at(clone, now())
    seen = []
    for i in range(5):
        assert s.push_pass() == 1
        state = gitstore.load_state(s.state_file)
        assert state["repos"]["data"]["failures"] == i + 1
        seen.append(s.sync_status(True)["state"])
        now.box["t"] += 40
    assert seen == ["pending", "pending", "pending", "stale", "error"]
    assert any(r.levelname == "ERROR" and "5 in a row" in r.getMessage() for r in caplog.records)
    git(clone, "remote", "set-url", "origin", str(bare))
    assert s.push_pass() == 0
    status = s.sync_status(True)
    assert status["state"] == "ok"
    assert status["repos"][0]["failures"] == 0
    assert status["last_error"] is None
    assert subjects(bare)[0] == "offline"


def test_a_rejected_push_stops_that_repo_and_never_merges(tmp_path):
    s, bare, clone, cbare, cov = make_sync(tmp_path, covers=True, inbound=False)
    other = tmp_path / "other"
    git(tmp_path, "clone", str(bare), str(other))
    (other / "x").write_text("x")
    git(other, "add", "x")
    git(other, "commit", "-m", "intruder")
    git(other, "push")
    save(s, clone, "a.json", "1", "mine")
    save(s, cov, "c.json", "1", "cover")
    head, tree = git(clone, "rev-parse", "HEAD"), git(clone, "status", "--porcelain")
    assert s.push_pass() == 2
    st = s.sync_status(True)
    assert st["state"] == "error"
    assert st["repos"][0]["rejected"] is True
    assert "rejected" in st["last_error"]
    assert git(clone, "rev-parse", "HEAD") == head
    assert git(clone, "status", "--porcelain") == tree
    assert subjects(cbare)[0] == "cover"
    before = git(bare, "rev-parse", "main")
    assert s.push_pass() == 2
    assert git(bare, "rev-parse", "main") == before
    git(clone, "pull", "--rebase")
    git(clone, "push")
    assert s.push_pass() == 0
    assert s.sync_status(True)["state"] == "ok"
    assert not gitstore.load_state(s.state_file)["repos"]["data"]["rejected"]


def test_clear_rejected_via_the_cli(tmp_path, monkeypatch, capsys):
    s, bare, clone, *_ = make_sync(tmp_path)
    s.set_repo_state("data", rejected=True, failures=3)
    cli_env(monkeypatch, s)
    assert gitsync.main(["--clear-rejected", "data"]) == 0
    assert gitstore.load_state(s.state_file)["repos"]["data"] == {"failures": 0, "rejected": False, "last_ok_at": None}


def test_a_concurrent_push_of_the_same_commits_is_not_a_rejection(tmp_path, monkeypatch):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, "a.json", "1", "mine")
    real = s._call
    first = []

    def fake(repo, *args, timeout=120):
        if args[0] == "push" and not first:
            first.append(1)
            return subprocess.CompletedProcess(args, 1, "", " ! [rejected]        main -> main (fetch first)\n")
        return real(repo, *args, timeout=timeout)

    monkeypatch.setattr(s, "_call", fake)
    assert s.push_repo(clone).status == "ok"


def test_pushes_touch_only_the_repo_that_has_commits(tmp_path):
    s, bare, clone, cbare, cov = make_sync(tmp_path, covers=True)
    save(s, clone, "a.json", "1", "data only")
    assert s.sync_status(True)["repos"][1]["unpushed"] == 0
    cref = git(cbare, "rev-parse", "main")
    assert s.push_pass() == 0
    assert git(cbare, "rev-parse", "main") == cref
    assert subjects(bare)[0] == "data only"
    save(s, cov, "u/c.jpg", "img", "cover")
    dref = git(bare, "rev-parse", "main")
    assert s.push_pass() == 0
    assert subjects(cbare)[0] == "cover"
    assert git(bare, "rev-parse", "main") == dref


def test_startup_pushes_leftovers_before_anything_else(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, "a.json", "1", "left over")
    gitstore.GitSync(clone, state_file=s.state_file).recover_on_startup()
    assert subjects(bare)[0] == "left over"


def test_startup_commits_a_dirty_tree_and_sweeps_tmp_files(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    write(clone, "users/u/library.json", "{}")
    write(clone, "users/u/.json-abc.tmp", "half")
    s.recover_on_startup()
    assert subjects(bare)[0] == "audioplayer: recover uncommitted changes"
    assert not (clone / "audioplayer" / "users" / "u" / ".json-abc.tmp").exists()
    assert git(clone, "status", "--porcelain") == ""


def test_startup_fast_forwards_when_only_the_remote_moved(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    other = tmp_path / "other"
    git(tmp_path, "clone", str(bare), str(other))
    (other / "x").write_text("x")
    git(other, "add", "x")
    git(other, "commit", "-m", "remote")
    git(other, "push")
    s.recover_on_startup()
    assert (clone / "x").read_text() == "x"


def test_startup_marks_a_diverged_repo_rejected_and_leaves_the_tree_alone(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    other = tmp_path / "other"
    git(tmp_path, "clone", str(bare), str(other))
    (other / "audioplayer").mkdir(exist_ok=True); (other / "audioplayer" / "x").write_text("x")
    git(other, "add", "-A")
    git(other, "commit", "-m", "remote")
    git(other, "push")
    save(s, clone, "a.json", "1", "mine")
    head = git(clone, "rev-parse", "HEAD")
    s.recover_on_startup()
    assert git(clone, "rev-parse", "HEAD") == head
    assert not (clone / "audioplayer" / "x").exists()
    assert s.sync_status(True)["state"] == "error"
    assert subjects(bare)[0] == "remote"


def test_startup_with_an_unreachable_remote_still_starts_pending(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, "a.json", "1", "mine")
    git(clone, "remote", "set-url", "origin", str(tmp_path / "gone.git"))
    s.recover_on_startup()
    assert s.sync_status(True)["state"] == "pending"


def test_an_interrupted_atomic_write_leaves_the_target_and_no_temp_file(tmp_path, monkeypatch):
    target = tmp_path / "d" / "x.json"
    jsonio.write_json_atomic(target, {"a": 1})
    for write_fn, arg in ((jsonio.write_json_atomic, {"a": 2}), (jsonio.write_bytes_atomic, b"new")):
        monkeypatch.setattr(os, "replace", lambda *a: (_ for _ in ()).throw(OSError("boom")))
        with pytest.raises(OSError):
            write_fn(target, arg)
        monkeypatch.undo()
        assert json.loads(target.read_text()) == {"a": 1}
        assert [p.name for p in target.parent.iterdir()] == ["x.json"]
    jsonio.write_bytes_atomic(target, b"bytes")
    assert target.read_bytes() == b"bytes"


def test_tmp_files_are_not_staged_and_a_failed_save_leaves_a_clean_tree(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, "a.json", "one", "add")
    write(clone, ".json-left.tmp", "x")
    save(s, clone, "b.json", "b", "more")
    assert ".json-left.tmp" not in git(clone, "ls-files")
    (clone / "audioplayer" / ".json-left.tmp").unlink()
    def failing_save():
        with s.transaction():
            write(clone, "a.json", "two")
            write(clone, "new.json", "n")
            raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        failing_save()
    assert git(clone, "status", "--porcelain") == ""
    assert (clone / "audioplayer" / "a.json").read_text() == "one"


def test_two_users_saving_concurrently_make_two_consistent_commits(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    ts = [threading.Thread(target=save, args=(s, clone, f"users/{u}/library.json", u, f"audioplayer: {u} edit")) for u in "ab"]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(git(clone, "log", "--format=%s", "-2").splitlines()) == ["audioplayer: a edit", "audioplayer: b edit"]
    assert git(clone, "status", "--porcelain") == ""


# --- CLI ---------------------------------------------------------------------------------------

def cli_env(monkeypatch, s):
    monkeypatch.setenv("AUDIO_DATA_REPO", str(s.data_repo))
    monkeypatch.setenv("AUDIO_COVERS_REPO", str(s.covers_repo or ""))
    monkeypatch.setenv("GIT_SYNC_STATE_FILE", str(s.state_file))


def test_cli_exit_codes(tmp_path, monkeypatch, capsys):
    s, bare, clone, *_ = make_sync(tmp_path)
    cli_env(monkeypatch, s)
    assert gitsync.main([]) == 0
    save(s, clone, "a.json", "1", "mine")
    git(clone, "remote", "set-url", "origin", str(tmp_path / "gone.git"))
    assert gitsync.main([]) == 1
    git(clone, "remote", "set-url", "origin", str(bare))
    assert gitsync.main([]) == 0
    assert subjects(bare)[0] == "mine"
    other = tmp_path / "other"
    git(tmp_path, "clone", str(bare), str(other))
    (other / "audioplayer").mkdir(exist_ok=True); (other / "audioplayer" / "x").write_text("x")
    git(other, "add", "-A")
    git(other, "commit", "-m", "intruder")
    git(other, "push")
    save(s, clone, "a.json", "2", "mine2")
    assert gitsync.main([]) == 2
    s.state_file.write_text("{broken")
    assert gitsync.main([]) == 3


def test_cli_without_a_store_exits_zero(monkeypatch, capsys):
    monkeypatch.delenv("AUDIO_DATA_REPO", raising=False)
    assert gitsync.main([]) == 0
    assert "no git store" in capsys.readouterr().out


def test_cli_status_is_read_only_and_busy_lock_skips(tmp_path, monkeypatch, capsys):
    s, bare, clone, *_ = make_sync(tmp_path)
    cli_env(monkeypatch, s)
    save(s, clone, "a.json", "1", "mine")
    assert gitsync.main(["--status"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["state"] == "pending"
    assert out["unpushed"] == 1
    assert not s.state_file.exists()
    assert subjects(bare) == ["init"]
    with s.pusher_lock() as got:
        assert got
        assert gitsync.main([]) == 0
        assert "busy" in capsys.readouterr().out
    assert subjects(bare) == ["init"]


def test_two_simultaneous_runs_push_once(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, "a.json", "1", "mine")
    slow_hook(bare, 1)
    codes = []
    ts = [threading.Thread(target=lambda: codes.append(s.push_pass())) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(codes, key=lambda c: (c is None, c))[0] == 0
    assert subjects(bare) == ["mine", "init"]


def test_flush_pushes_on_shutdown(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, "a.json", "1", "mine")
    s.flush()
    assert subjects(bare)[0] == "mine"
    assert wait(lambda: s.sync_status(True)["state"] == "ok")
