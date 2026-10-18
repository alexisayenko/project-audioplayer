import json
import logging
import threading

import pytest

from app import gitstore
from gitrepo import git, make_sync, save, subjects
from test_gitsync_inbound import GOOD, LIB, MSG, remote_commit, timer_of

MOOD = "moodtracker/users/7/entries.json"


@pytest.fixture(autouse=True)
def ident(monkeypatch):
    for k, v in (("NAME", "t"), ("EMAIL", "t@t")):
        monkeypatch.setenv(f"GIT_AUTHOR_{k}", v)
        monkeypatch.setenv(f"GIT_COMMITTER_{k}", v)


def foreign(tmp_path, bare, rel, text, msg="mood entry", name="mood"):
    other = tmp_path / name
    if not other.exists():
        git(tmp_path, "clone", str(bare), str(other))
    else:
        git(other, "pull", "-q", "--ff-only")
    p = other / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    git(other, "add", "-A")
    git(other, "commit", "-m", msg)
    git(other, "push", "-q")
    return other




def test_foreign_push_between_passes_is_rebased_and_pushed(tmp_path, caplog):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, LIB, GOOD, "mine 1")
    save(s, clone, "users/u/profile.json", "{}", "mine 2")
    mine = (clone / "audioplayer" / LIB).read_text()
    foreign(tmp_path, bare, MOOD, "[1]", "mood 1")
    foreign(tmp_path, bare, "moodtracker/users/8/e.json", "[2]", "mood 2")
    with caplog.at_level(logging.INFO, logger="audioplayer.gitsync"):
        assert s.push_pass() == 0
    assert subjects(bare)[:4] == ["mine 2", "mine 1", "mood 2", "mood 1"]
    assert git(clone, "rev-parse", "HEAD") == git(bare, "rev-parse", "main")
    assert git(clone, "rev-list", "--merges", "--count", "HEAD") == "0"
    assert (clone / "audioplayer" / LIB).read_text() == mine
    assert (clone / MOOD).read_text() == "[1]"
    assert any("rebased 2 local commits over 2 foreign commits (paths outside audioplayer/)" in r.getMessage() for r in caplog.records)
    st = s.sync_status(True)
    assert st["state"] == "ok"
    assert st["last_error"] is None
    assert st["inbound"]["foreign_commits"] == 2
    assert st["inbound"]["last_rebase_at"]
    assert git(clone, "status", "--porcelain") == ""


def test_incident_replay_two_local_commits_four_foreign_commits(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, LIB, GOOD, "edit: a - b")
    save(s, clone, LIB, GOOD.replace('"T"', '"T2"'), "edit: a - c")
    for i in range(4):
        foreign(tmp_path, bare, f"moodtracker/users/{i}/day.json", json.dumps({"mood": i}), f"mood {i}")
    assert s.push_pass() == 0
    assert subjects(bare) == ["edit: a - c", "edit: a - b", "mood 3", "mood 2", "mood 1", "mood 0", "init"]
    assert json.loads((clone / "audioplayer" / LIB).read_text())["songs"][0]["title"] == "T2"
    st = s.sync_status(True)
    assert st["state"] == "ok"
    assert st["inbound"]["foreign_commits"] == 4
    assert s.push_pass() == 0
    assert s.sync_status(True)["inbound"]["foreign_commits"] == 4


def test_foreign_commit_touching_the_owned_prefix_is_still_an_error(tmp_path, caplog):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, LIB, GOOD, "mine")
    foreign(tmp_path, bare, MOOD, "[1]", "mood")
    remote_commit(tmp_path, bare, "users/u/other.json", "{}", "edit ours", name="mood")
    head, remote_head = git(clone, "rev-parse", "HEAD"), git(bare, "rev-parse", "main")
    with caplog.at_level(logging.ERROR):
        assert s.push_pass() == 2
    assert git(clone, "rev-parse", "HEAD") == head
    assert git(bare, "rev-parse", "main") == remote_head
    assert not (clone / MOOD).exists()
    st = s.sync_status(True)
    assert st["state"] == "error"
    assert st["last_error"] == MSG
    assert st["inbound"]["foreign_commits"] == 0
    assert s.push_pass() == 2


def test_a_foreign_commit_on_a_path_the_local_commits_also_touch_is_an_error(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    (clone / "shared.txt").write_text("a")
    git(clone, "add", "shared.txt")
    git(clone, "commit", "-m", "local outside")
    foreign(tmp_path, bare, "shared.txt", "b", "mood edits shared")
    head = git(clone, "rev-parse", "HEAD")
    assert s.push_pass() == 2
    assert git(clone, "rev-parse", "HEAD") == head


def test_a_rebase_conflict_is_aborted_and_head_restored(tmp_path, monkeypatch, caplog):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, LIB, GOOD, "mine")
    remote_commit(tmp_path, bare, LIB, GOOD.replace('"T"', '"THEIRS"'), "theirs")
    monkeypatch.setattr(s, "_foreign_overlap", lambda repo: None)
    head, remote_head = git(clone, "rev-parse", "HEAD"), git(bare, "rev-parse", "main")
    with caplog.at_level(logging.ERROR):
        assert s.push_pass() == 2
    assert git(clone, "rev-parse", "HEAD") == head
    assert git(bare, "rev-parse", "main") == remote_head
    assert git(clone, "status", "--porcelain") == ""
    assert not (clone / ".git" / "rebase-merge").exists()
    assert not (clone / ".git" / "rebase-apply").exists()
    assert (clone / "audioplayer" / LIB).read_text() == GOOD
    assert s.sync_status(True)["last_error"] == MSG
    assert any("rebase failed, restored" in r.getMessage() for r in caplog.records)


def test_a_rebased_tree_with_an_invalid_library_is_aborted(tmp_path, caplog):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, LIB, "{not json", "mine, broken")
    foreign(tmp_path, bare, MOOD, "[1]", "mood")
    head = git(clone, "rev-parse", "HEAD")
    with caplog.at_level(logging.ERROR):
        assert s.push_pass() == 1
    assert git(clone, "rev-parse", "HEAD") == head
    assert not (clone / MOOD).exists()
    assert (clone / "audioplayer" / LIB).read_text() == "{not json"
    assert git(clone, "status", "--porcelain") == ""
    assert "inbound change invalid after rebase" in s.sync_status(True)["last_error"]
    assert subjects(bare)[0] == "mood"


def test_foreign_only_ahead_fast_forwards_without_validation(tmp_path, monkeypatch):
    s, bare, clone, *_ = make_sync(tmp_path)
    foreign(tmp_path, bare, "moodtracker/users/7/library.json", "{not json at all", "mood lib")

    def boom(rel, text):
        raise AssertionError("validated")

    monkeypatch.setattr(gitstore, "check_inbound_json", boom)
    assert s.push_pass() == 0
    assert (clone / "moodtracker/users/7/library.json").read_text() == "{not json at all"
    assert git(clone, "rev-parse", "HEAD") == git(bare, "rev-parse", "main")
    assert s.sync_status(True)["state"] == "ok"


def test_a_busy_write_lock_skips_the_rebase_and_retries_next_run(tmp_path):
    server, bare, clone, *_ = make_sync(tmp_path)
    timer = timer_of(server)
    save(server, clone, LIB, GOOD, "mine")
    foreign(tmp_path, bare, MOOD, "[1]", "mood")
    head = git(clone, "rev-parse", "HEAD")
    inside, release = threading.Event(), threading.Event()

    def saving():
        with server.transaction():
            inside.set()
            release.wait(5)

    t = threading.Thread(target=saving)
    t.start()
    assert inside.wait(5)
    assert timer.push_pass() == 1
    assert git(clone, "rev-parse", "HEAD") == head
    assert git(timer.data_repo, "log", "-1", "--format=%s", "@{u}") == "mood"
    st = timer.sync_status(True)
    assert st["state"] == "pending"
    release.set()
    t.join()
    assert timer.push_pass() == 0
    assert subjects(bare)[:2] == ["mine", "mood"]
    assert timer.sync_status(True)["state"] == "ok"


def test_the_switch_off_keeps_the_old_diverged_behaviour(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_DATA_REPO", "/x")
    monkeypatch.setenv("GIT_SYNC_REBASE_FOREIGN", "0")
    assert gitstore.from_env().rebase_foreign is False
    monkeypatch.delenv("GIT_SYNC_REBASE_FOREIGN")
    assert gitstore.from_env().rebase_foreign is True
    s, bare, clone, *_ = make_sync(tmp_path, rebase_foreign=False)
    save(s, clone, LIB, GOOD, "mine")
    foreign(tmp_path, bare, MOOD, "[1]", "mood")
    head = git(clone, "rev-parse", "HEAD")
    assert s.push_pass() == 2
    assert git(clone, "rev-parse", "HEAD") == head
    assert s.sync_status(True)["last_error"] == MSG
    assert subjects(bare)[0] == "mood"


def test_inbound_switch_off_wins_over_rebase(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path, inbound=False)
    save(s, clone, LIB, GOOD, "mine")
    foreign(tmp_path, bare, MOOD, "[1]", "mood")
    assert s.push_pass() == 2
    assert gitstore.load_state(s.state_file)["repos"]["data"]["rejected"]


def test_a_sticky_rejected_state_clears_after_the_rebase_and_push(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, LIB, GOOD, "mine")
    foreign(tmp_path, bare, MOOD, "[1]", "mood")
    s.set_repo_state("data", rejected=True)
    assert s.push_pass() == 0
    assert not gitstore.load_state(s.state_file)["repos"]["data"]["rejected"]
    assert s.sync_status(True)["state"] == "ok"


def test_a_push_that_loses_a_second_race_retries_and_is_an_error_only_after_five(tmp_path, monkeypatch):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, LIB, GOOD, "mine")
    foreign(tmp_path, bare, MOOD, "[1]", "mood 1")
    real, n = s.push_repo, {"i": 0}

    def racing(repo, timeout=120):
        n["i"] += 1
        foreign(tmp_path, bare, f"moodtracker/users/9/{n['i']}.json", "[]", f"mood race {n['i']}")
        return real(repo, timeout=timeout)

    monkeypatch.setattr(s, "push_repo", racing)
    for i in range(1, 5):
        assert s.push_pass() == 1
        st = s.sync_status(True)
        assert st["state"] == "pending", i
        assert gitstore.load_state(s.state_file)["repos"]["data"]["failures"] == i
    assert s.push_pass() == 1
    st = s.sync_status(True)
    assert st["state"] == "error"
    assert st["last_error"] == "data: not reaching git"
    monkeypatch.setattr(s, "push_repo", real)
    assert s.push_pass() == 0
    assert subjects(bare)[0] == "mine"
    st = s.sync_status(True)
    assert st["state"] == "ok"
    assert st["last_error"] is None
    assert gitstore.load_state(s.state_file)["repos"]["data"]["failures"] == 0


def test_a_rejected_push_with_an_owned_foreign_change_is_the_diverged_error(tmp_path, monkeypatch):
    s, bare, clone, *_ = make_sync(tmp_path)
    save(s, clone, LIB, GOOD, "mine")
    remote_commit(tmp_path, bare, "users/u/other.json", "{}", "edit ours")
    monkeypatch.setattr(s, "inbound_repo", lambda *a, **k: gitstore.Inbound("none"))
    assert s.push_pass() == 2
    assert s.sync_status(True)["last_error"] == MSG


def test_covers_repo_is_rebased_too(tmp_path):
    s, bare, clone, cbare, cov = make_sync(tmp_path, covers=True)
    save(s, cov, "users/u/covers/a.jpg", "img", "my cover")
    foreign(tmp_path, cbare, "moodtracker/photo.jpg", "x", "mood photo", name="cmood")
    assert s.push_pass() == 0
    assert subjects(cbare)[:2] == ["my cover", "mood photo"]
    assert (cov / "audioplayer/users/u/covers/a.jpg").read_text() == "img"
    assert s.sync_status(True)["inbound"]["foreign_commits"] == 1


def test_custom_owned_prefixes(tmp_path):
    s, bare, clone, *_ = make_sync(tmp_path, owned_prefixes=("audioplayer/covers", "extra"))
    assert s.owned_prefixes == ("audioplayer/covers/", "extra/")
    assert s.is_owned("extra/x")
    assert not s.is_owned("audioplayer/users/x")
    save(s, clone, "users/u/a.json", "1", "mine")
    foreign(tmp_path, bare, "extra/y.json", "{}", "touches extra")
    assert s.push_pass() == 2


@pytest.mark.parametrize("raw,want", [
    (None, ("audioplayer/",)), ("", ("audioplayer/",)), (" , ,", ("audioplayer/",)),
    ("audioplayer", ("audioplayer/",)), ("/a/b/, c ,a/b", ("a/b/", "c/")),
])
def test_normalize_prefixes(raw, want):
    assert gitstore.normalize_prefixes(raw) == want


def test_owned_prefixes_come_from_the_environment(monkeypatch):
    monkeypatch.setenv("AUDIO_DATA_REPO", "/x")
    monkeypatch.setenv("GIT_SYNC_OWNED_PREFIXES", "audioplayer/, other")
    assert gitstore.from_env().owned_prefixes == ("audioplayer/", "other/")
    monkeypatch.delenv("GIT_SYNC_OWNED_PREFIXES")
    assert gitstore.from_env().owned_prefixes == ("audioplayer/",)


def test_rehearsal_timing_with_many_users(tmp_path, capsys):
    import time

    s, bare, clone, *_ = make_sync(tmp_path)
    for i in range(200):
        p = clone / "audioplayer" / f"users/u{i:03d}/library.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(GOOD)
    save(s, clone, "users/u000/profile.json", "{}", "seed users")
    assert s.push_pass() == 0
    save(s, clone, LIB, GOOD, "mine 1")
    save(s, clone, LIB, GOOD.replace('"T"', '"T3"'), "mine 2")
    for i in range(4):
        foreign(tmp_path, bare, f"moodtracker/users/{i}/d.json", "[]", f"mood {i}")
    t0 = time.monotonic()
    assert s.push_pass() == 0
    took = time.monotonic() - t0
    print(f"rehearsal: rebase+validate+push of 2 over 4 with 200 users: {took:.2f}s")
    assert took < 15
