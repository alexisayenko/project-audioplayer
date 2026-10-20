import subprocess
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app import buildinfo, deps, main

SHA = "68df2bf" + "0" * 33
START = datetime(2026, 10, 17, 12, 0, tzinfo=UTC)


def git_repo(path, date="2026-10-17T10:00:00+02:00"):
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x.y", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@x.y",
           "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date, "PATH": __import__("os").environ["PATH"]}
    for args in (["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "x"]):
        subprocess.run(["git", "-C", str(path), *args], check=True, env=env, capture_output=True)
    return subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()


def write_build(path, sha=SHA, committed="2026-10-17T09:00:00Z", deployed="2026-10-17T12:00:05Z"):
    (path / "BUILD").write_text(f"sha={sha}\ncommitted_at={committed}\ndeployed_at={deployed}\n")


def test_git_gives_sha_and_commit_date_and_start_time(tmp_path):
    sha = git_repo(tmp_path)
    assert buildinfo.BuildInfo(tmp_path, START).current() == {
        "sha": sha, "committed_at": "2026-10-17T08:00:00Z", "deployed_at": "2026-10-17T12:00:00Z"}


def test_fresh_build_file_sets_the_deploy_time(tmp_path):
    sha = git_repo(tmp_path)
    write_build(tmp_path, sha=sha)
    assert buildinfo.BuildInfo(tmp_path, START).current()["deployed_at"] == "2026-10-17T12:00:05Z"


def test_stale_or_foreign_build_file_is_ignored(tmp_path):
    sha = git_repo(tmp_path)
    write_build(tmp_path, sha=sha, deployed="2026-10-16T12:00:00Z")
    assert buildinfo.BuildInfo(tmp_path, START).current()["deployed_at"] == "2026-10-17T12:00:00Z"
    write_build(tmp_path, sha=SHA)
    assert buildinfo.BuildInfo(tmp_path, START).current()["sha"] == sha
    assert buildinfo.BuildInfo(tmp_path, START).current()["deployed_at"] == "2026-10-17T12:00:00Z"


def test_build_file_written_after_start_is_picked_up_without_restart(tmp_path):
    sha = git_repo(tmp_path)
    info = buildinfo.BuildInfo(tmp_path, START)
    assert info.current()["deployed_at"] == "2026-10-17T12:00:00Z"
    write_build(tmp_path, sha=sha, deployed="2026-10-17T12:00:09Z")
    assert info.current()["deployed_at"] == "2026-10-17T12:00:09Z"


def test_without_git_the_build_file_supplies_everything(tmp_path):
    write_build(tmp_path)
    assert buildinfo.BuildInfo(tmp_path, START).current() == {
        "sha": SHA, "committed_at": "2026-10-17T09:00:00Z", "deployed_at": "2026-10-17T12:00:05Z"}


def test_git_failure_and_garbage_fall_back_to_null(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise OSError("no git")
    monkeypatch.setattr(buildinfo.subprocess, "run", boom)
    assert buildinfo.BuildInfo(tmp_path, START).current() is None
    (tmp_path / "BUILD").write_text("sha=nope\ndeployed_at=garbage\n")
    assert buildinfo.BuildInfo(tmp_path, START).current() is None
    (tmp_path / "BUILD").write_bytes(b"\xff\xfe\x00")
    assert buildinfo.BuildInfo(tmp_path, START).current() is None


def test_dubious_ownership_does_not_block_git(tmp_path, monkeypatch):
    seen = {}
    real = subprocess.run

    def spy(cmd, **kw):
        seen["cmd"] = cmd
        return real(cmd, **kw)
    sha = git_repo(tmp_path)
    monkeypatch.setattr(buildinfo.subprocess, "run", spy)
    assert buildinfo.BuildInfo(tmp_path, START).current()["sha"] == sha
    assert f"safe.directory={tmp_path}" in seen["cmd"]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(deps, "DOWNLOAD_DIR", tmp_path)
    monkeypatch.setattr(deps, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(buildinfo, "_info", buildinfo.BuildInfo(tmp_path / "none", START))
    monkeypatch.setattr(buildinfo._info, "git", (SHA, "2026-10-17T09:00:00Z"))
    return TestClient(main.app)


def test_health_build_is_owner_only(client):
    expected = {"sha": SHA, "committed_at": "2026-10-17T09:00:00Z", "deployed_at": "2026-10-17T12:00:00Z"}
    assert client.get("/health", headers={"X-API-Token": "secret"}).json()["build"] == expected
    assert client.get("/health").json() == {"status": "ok", "sync": {"state": "ok"}, "ready": True, "startup": {"state": "ready", "step": None}}
    assert "build" not in client.get("/health", headers={"X-API-Token": "wrong"}).json()


def test_health_build_is_null_when_unknown(client, monkeypatch):
    monkeypatch.setattr(buildinfo._info, "git", None)
    assert client.get("/health", headers={"X-API-Token": "secret"}).json()["build"] is None
