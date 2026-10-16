import json
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from app import deps, extractor, gitstore, library, main, users

VID = "dQw4w9WgXcQ"
VID2 = "9bZkp7q19f0"
H = {"X-API-Token": "secret"}
OWNER_UID = users.uid_for_email("alex.isayenko@gmail.com")
U8 = OWNER_UID[:8]
LIBP = f"main:audioplayer/users/{OWNER_UID}/library.json"


def git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd, check=True, capture_output=True, text=True,
    ).stdout.strip()


def make_remote(tmp_path, name):
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
def repos(tmp_path, monkeypatch):
    monkeypatch.setenv("GIT_AUTHOR_NAME", "t")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "t@t")
    monkeypatch.setenv("GIT_COMMITTER_NAME", "t")
    monkeypatch.setenv("GIT_COMMITTER_EMAIL", "t@t")
    data_bare, data = make_remote(tmp_path, "data")
    cov_bare, cov = make_remote(tmp_path, "covers")
    return data_bare, data, cov_bare, cov


@pytest.fixture
def client(tmp_path, repos, monkeypatch):
    _, data, _, cov = repos
    sync = gitstore.GitSync(data, cov, backoff=(0.05, 0.1), mode="request")
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(deps, "SYNC", sync)
    monkeypatch.setattr(deps, "DOWNLOAD_DIR", tmp_path / "music")
    monkeypatch.setattr(deps, "JOBS", {})

    def fake_download(video_id, out_dir, progress=None, source_url=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"audio")
        return {"id": video_id, "title": "Yt", "artist": "A", "duration": 7}

    def fake_cover(video_id, dest, artwork=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"jpg")

    monkeypatch.setattr(extractor, "download_audio", fake_download)
    monkeypatch.setattr(extractor, "fetch_cover", fake_cover)
    yield TestClient(main.app)
    sync.stop()


def add(client, vid=VID):
    body = {"url": f"https://youtu.be/{vid}", "metadata": {"title": "Song"}, "tags": ["a"]}
    assert client.post("/songs", json=body, headers=H).status_code == 202


def log(bare):
    return git(bare, "log", "main", "--format=%s").splitlines()


def wait_ok(client, secs=5):
    end = time.time() + secs
    while time.time() < end:
        if client.get("/health", headers=H).json()["sync"]["state"] == "ok":
            return True
        time.sleep(0.05)
    return False


def test_add_edit_delete_commit_and_push(client, repos):
    data_bare, _, cov_bare, _ = repos
    add(client)
    assert client.patch(f"/songs/{VID}", json={"title": "New"}, headers=H).status_code == 200
    assert log(data_bare)[:2] == [f"audioplayer: {U8} edit {VID}", f"audioplayer: {U8} add {VID}"]
    assert log(cov_bare)[0] == f"audioplayer: {U8} add {VID}"
    doc = json.loads(git(data_bare, "show", LIBP))
    assert doc["songs"][0]["title"] == "New"
    assert doc["songs"][0]["file"] == f"{VID}.m4a"
    assert doc["settings"]["music_root"]
    assert git(cov_bare, "show", f"main:audioplayer/users/{OWNER_UID}/covers/{VID}.jpg") == "jpg"
    assert client.delete(f"/songs/{VID}", headers=H).status_code == 204
    assert log(data_bare)[0] == f"audioplayer: {U8} delete {VID}"
    assert log(cov_bare)[0] == f"audioplayer: {U8} delete {VID}"
    assert json.loads(git(data_bare, "show", LIBP))["songs"] == []
    assert client.get("/health").json() == {"status": "ok", "sync": {"state": "ok"}}
    assert client.get("/health", headers=H).json()["sync"]["state"] == "ok"


def test_pull_rebase_picks_up_remote_changes(client, repos, tmp_path):
    data_bare, _, _, _ = repos
    other = tmp_path / "other"
    git(tmp_path, "clone", str(data_bare), str(other))
    (other / "audioplayer" / "users" / OWNER_UID).mkdir(parents=True)
    (other / "audioplayer" / "users" / OWNER_UID / "library.json").write_text(
        json.dumps({"settings": {}, "songs": [{"id": VID2, "title": "Remote"}]})
    )
    git(other, "add", "-A")
    git(other, "commit", "-m", "remote")
    git(other, "push")
    add(client)
    ids = {s["id"] for s in client.get("/library", headers=H).json()["songs"]}
    assert ids == {VID, VID2}


def test_push_failure_then_recovery(client, repos, tmp_path):
    data_bare, data, _, _ = repos
    git(data, "remote", "set-url", "origin", str(tmp_path / "missing.git"))
    add(client)
    assert client.get("/health", headers=H).json()["sync"]["state"] in ("pending", "error")
    assert [s["id"] for s in client.get("/library", headers=H).json()["songs"]] == [VID]
    assert git(data, "log", "--format=%s", "-1") == f"audioplayer: {U8} add {VID}"
    git(data, "remote", "set-url", "origin", str(data_bare))
    assert wait_ok(client)
    assert log(data_bare)[0] == f"audioplayer: {U8} add {VID}"


def test_persistent_failure_reports_error(client, repos, tmp_path):
    _, data, _, _ = repos
    git(data, "remote", "set-url", "origin", str(tmp_path / "missing.git"))
    add(client)
    end = time.time() + 10
    while time.time() < end and client.get("/health", headers=H).json()["sync"]["state"] != "error":
        time.sleep(0.05)
    assert client.get("/health", headers=H).json()["sync"]["state"] == "error"


def test_resync_pushes_leftover_commits(repos):
    data_bare, data, _, cov = repos
    (data / "audioplayer").mkdir()
    (data / "audioplayer" / "library.json").write_text("{}")
    git(data, "add", "-A")
    git(data, "commit", "-m", "left over")
    sync = gitstore.GitSync(data, cov, backoff=(0.05, 0.1), mode="request")
    sync.resync()
    end = time.time() + 5
    while time.time() < end and sync.status() != "ok":
        time.sleep(0.05)
    sync.stop()
    assert log(data_bare)[0] == "left over"


def test_migrates_old_bare_format(tmp_path):
    p = tmp_path / "library.json"
    p.write_text(json.dumps({"songs": [{"id": VID, "title": "Old"}]}))
    doc = library.load_doc(p)
    assert doc["settings"] == {}
    assert doc["songs"][0]["file"] == f"{VID}.m4a"
    library.save(p, doc["songs"], default_music_root="perkunas://data/music/")
    saved = json.loads(p.read_text())
    assert saved["settings"] == {"music_root": "perkunas://data/music/", "credits_schema": 2}
    assert saved["songs"][0]["file"] == f"{VID}.m4a"


def test_music_root_resolution(tmp_path, monkeypatch):
    r = library.resolve_music_root
    assert r("perkunas://data/music/", {"perkunas": "/mnt/p"}).as_posix() == "/mnt/p/data/music"
    assert r(str(tmp_path)) == tmp_path
    with pytest.raises(LookupError):
        r("nope://x/", {})
    monkeypatch.setenv("AUDIO_HOSTS", "a=/one;b=/two")
    assert library.load_hosts() == {"a": "/one", "b": "/two"}
    f = tmp_path / "h.json"
    f.write_text('{"c": "/three"}')
    monkeypatch.setenv("AUDIO_HOSTS_FILE", str(f))
    assert library.load_hosts()["c"] == "/three"


def test_audio_served_via_music_root_host(client, tmp_path, monkeypatch):
    mount = tmp_path / "mount"
    (mount / "data" / "music" / "users" / OWNER_UID).mkdir(parents=True)
    (mount / "data" / "music" / "users" / OWNER_UID / f"{VID}.m4a").write_bytes(b"x")
    monkeypatch.setenv("AUDIO_HOSTS", f"perkunas={mount.as_posix()}")
    monkeypatch.setenv("AUDIO_MUSIC_ROOT", "perkunas://data/music/")
    assert client.get(f"/files/{VID}", headers=H).content == b"x"
    monkeypatch.setenv("AUDIO_MUSIC_ROOT", "unknown://a/")
    assert client.get(f"/files/{VID}", headers=H).status_code == 503


def test_metadata_only_and_audio_removal_round_trip_through_git(client, repos):
    data_bare, _, cov_bare, _ = repos
    body = {"url": f"https://youtu.be/{VID}", "metadata": {"title": "Song"}, "audio": False}
    assert client.post("/songs", json=body, headers=H).status_code == 201
    assert log(data_bare)[0] == f"audioplayer: {U8} add {VID}"
    doc = json.loads(git(data_bare, "show", LIBP))
    assert doc["songs"][0]["file"] is None
    assert "audio_state" not in doc["songs"][0]
    assert client.get("/library", headers=H).json()["songs"][0]["audio_state"] == "none"
    add(client, VID2)
    assert client.delete(f"/songs/{VID2}/audio", headers=H).status_code == 204
    assert log(data_bare)[0] == f"audioplayer: {U8} delete audio {VID2}"
    doc = json.loads(git(data_bare, "show", LIBP))
    assert [s["file"] for s in doc["songs"]] == [None, None]
    assert len(json.dumps(doc)) < 5000
    assert client.get("/catalog", headers=H).json()["total"] == 2
