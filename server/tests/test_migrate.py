import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app import extractor, gitstore, library, main, migrate, oauth, users
from tests.test_gitstore import git, log, repos  # noqa: F401
from tests.test_library import H, VID, VID2
from tests.test_users import AUD, ALICE, BOB, VID3, VID4, key, multi, token, uid, who  # noqa: F401
from tests.test_library import client  # noqa: F401

OWNER = "alex.isayenko@gmail.com"
OUID = users.uid_for_email(OWNER)
MSG = "audioplayer: migrate legacy library to per-user layout"


def song(vid, file=True, **kw):
    return {"id": vid, "title": vid, "file": f"{vid}.m4a" if file else None, "cover": f"covers/{vid}.jpg", **kw}


def seed_legacy(repos, tmp_path, vids=(VID, VID2), meta_only=()):
    """Legacy single-user layout committed in both bare repos, audio loose in the music dir."""
    data_bare, data, cov_bare, cov = repos
    (data / "audioplayer").mkdir()
    doc = {"settings": {"music_root": "x"}, "songs": [song(v) for v in vids] + [song(v, file=False) for v in meta_only]}
    (data / "audioplayer" / "library.json").write_text(json.dumps(doc))
    (cov / "audioplayer" / "covers").mkdir(parents=True)
    music = tmp_path / "music"
    music.mkdir()
    for v in (*vids, *meta_only):
        (cov / "audioplayer" / "covers" / f"{v}.jpg").write_bytes(b"jpg-" + v.encode())
    for v in vids:
        (music / f"{v}.m4a").write_bytes(b"audio-" + v.encode())
    for repo, msg in ((data, "legacy data"), (cov, "legacy covers")):
        git(repo, "add", "-A")
        git(repo, "commit", "-m", msg)
        git(repo, "push")
    return music


def run(repos, music, sync=True, owner=OWNER):
    _, data, _, cov = repos
    s = gitstore.GitSync(data, cov, backoff=(0.05, 0.1)) if sync else None
    try:
        return migrate.run(data_root=data / "audioplayer", covers_root=cov / "audioplayer", music_dir=music,
                           owner_email=owner, sync=s), s
    finally:
        if s:
            s.stop()


def tree(*roots):
    out = {}
    for root in roots:
        for p in sorted(root.rglob("*")):
            if p.is_file() and ".git" not in p.parts:
                out[str(p)] = p.read_bytes()
    return out


def test_migrates_library_covers_and_audio_and_commits_both_repos(repos, tmp_path):
    data_bare, data, cov_bare, cov = repos
    music = seed_legacy(repos, tmp_path, meta_only=(VID3,))
    (music / "notes.txt").write_text("not mine")
    result, _ = run(repos, music)
    assert result == "migrated"
    ud = data / "audioplayer" / "users" / OUID
    assert not (data / "audioplayer" / "library.json").exists()
    assert [s["id"] for s in library.load(ud / "library.json")] == [VID, VID2, VID3]
    assert library.load_doc(ud / "library.json")["settings"] == {"music_root": "x"}
    profile = json.loads((ud / "profile.json").read_text())
    assert profile["email"] == OWNER and profile["provider"] == "migrated"
    assert not list((cov / "audioplayer" / "covers").glob("*"))
    cd = cov / "audioplayer" / "users" / OUID / "covers"
    assert sorted(p.name for p in cd.iterdir()) == sorted(f"{v}.jpg" for v in (VID, VID2, VID3))
    assert (cd / f"{VID}.jpg").read_bytes() == b"jpg-" + VID.encode()
    ad = music / "users" / OUID
    assert sorted(p.name for p in ad.iterdir()) == sorted([f"{VID}.m4a", f"{VID2}.m4a"])
    assert (ad / f"{VID}.m4a").read_bytes() == b"audio-" + VID.encode()
    assert [p.name for p in music.iterdir() if p.is_file()] == ["notes.txt"]
    assert log(data_bare)[0] == MSG and log(cov_bare)[0] == MSG
    assert "migrations/legacy-to-per-user.json" in git(data_bare, "ls-tree", "-r", "--name-only", "main")
    assert git(data, "status", "--porcelain") == "" and git(cov, "status", "--porcelain") == ""
    assert git(data_bare, "show", f"main:audioplayer/users/{OUID}/library.json")


def test_second_run_does_nothing(repos, tmp_path):
    data_bare, data, cov_bare, cov = repos
    music = seed_legacy(repos, tmp_path)
    assert run(repos, music)[0] == "migrated"
    before = (log(data_bare), log(cov_bare), tree(data, cov, music))
    assert run(repos, music)[0] == "done"
    assert (log(data_bare), log(cov_bare), tree(data, cov, music)) == before


def test_marker_stops_a_rerun_even_if_legacy_files_reappear(repos, tmp_path):
    _, data, _, _ = repos
    music = seed_legacy(repos, tmp_path)
    run(repos, music)
    (music / f"{VID3}.m4a").write_bytes(b"late")
    (data / "audioplayer" / "library.json").write_text("{}")
    assert run(repos, music)[0] == "done"
    assert (music / f"{VID3}.m4a").read_bytes() == b"late"


def test_nothing_to_migrate_on_a_fresh_install(repos, tmp_path):
    data_bare, data, cov_bare, _ = repos
    music = tmp_path / "music"
    music.mkdir()
    before = (log(data_bare), log(cov_bare))
    assert run(repos, music)[0] == "nothing"
    assert (log(data_bare), log(cov_bare)) == before
    assert not (data / "audioplayer").exists()


def test_new_layout_without_legacy_is_left_alone(repos, tmp_path):
    _, data, _, _ = repos
    music = tmp_path / "music"
    music.mkdir()
    (data / "audioplayer" / "users" / OUID).mkdir(parents=True)
    (data / "audioplayer" / "users" / OUID / "library.json").write_text("{}")
    assert run(repos, music)[0] == "nothing"
    assert not (data / "audioplayer" / migrate.MARKER).exists()


def test_aborts_without_changes_when_both_libraries_exist(repos, tmp_path):
    data_bare, data, cov_bare, cov = repos
    music = seed_legacy(repos, tmp_path)
    (data / "audioplayer" / "users" / OUID).mkdir(parents=True)
    (data / "audioplayer" / "users" / OUID / "library.json").write_text("{}")
    before = (tree(data, cov, music), log(data_bare), log(cov_bare))
    result, _ = run(repos, music)
    assert result.startswith("aborted") and "both exist" in result
    assert (tree(data, cov, music), log(data_bare), log(cov_bare)) == before


def test_aborts_without_changes_on_a_conflicting_file(repos, tmp_path):
    data_bare, data, cov_bare, cov = repos
    music = seed_legacy(repos, tmp_path)
    (music / "users" / OUID).mkdir(parents=True)
    (music / "users" / OUID / f"{VID}.m4a").write_bytes(b"different")
    before = (tree(data, cov, music), log(data_bare), log(cov_bare))
    assert run(repos, music)[0].startswith("aborted")
    assert (tree(data, cov, music), log(data_bare), log(cov_bare)) == before
    assert (music / f"{VID}.m4a").is_file()


def test_aborts_on_a_corrupt_legacy_library(repos, tmp_path):
    _, data, _, cov = repos
    music = seed_legacy(repos, tmp_path)
    (data / "audioplayer" / "library.json").write_text("{not json")
    before = tree(data, cov, music)
    assert run(repos, music)[0].startswith("aborted")
    assert tree(data, cov, music) == before


def test_resumes_after_audio_was_moved_but_nothing_committed(repos, tmp_path):
    data_bare, data, _, cov = repos
    music = seed_legacy(repos, tmp_path)
    (music / "users" / OUID).mkdir(parents=True)
    (music / f"{VID}.m4a").rename(music / "users" / OUID / f"{VID}.m4a")
    assert run(repos, music)[0] == "migrated"
    assert sorted(p.name for p in (music / "users" / OUID).iterdir()) == sorted([f"{VID}.m4a", f"{VID2}.m4a"])
    assert log(data_bare)[0] == MSG


def test_resumes_after_library_moved_but_covers_and_audio_not(repos, tmp_path):
    data_bare, data, _, cov = repos
    music = seed_legacy(repos, tmp_path)
    ud = data / "audioplayer" / "users" / OUID
    ud.mkdir(parents=True)
    (data / "audioplayer" / "library.json").rename(ud / "library.json")
    assert run(repos, music)[0] == "migrated"
    assert (cov / "audioplayer" / "users" / OUID / "covers" / f"{VID}.jpg").is_file()
    assert (music / "users" / OUID / f"{VID2}.m4a").is_file()
    assert log(data_bare)[0] == MSG
    assert run(repos, music)[0] == "done"


def test_failed_commit_rolls_everything_back_and_a_retry_succeeds(repos, tmp_path, monkeypatch):
    data_bare, data, cov_bare, cov = repos
    music = seed_legacy(repos, tmp_path)
    before = tree(data, cov, music)
    sync = gitstore.GitSync(data, cov, backoff=(0.05, 0.1))
    monkeypatch.setattr(sync, "commit", lambda message: (_ for _ in ()).throw(gitstore.GitError("disk full")))
    result = migrate.run(data_root=data / "audioplayer", covers_root=cov / "audioplayer", music_dir=music,
                         owner_email=OWNER, sync=sync)
    assert result.startswith("aborted") and "disk full" in result
    assert tree(data, cov, music) == before
    assert not (data / "audioplayer" / migrate.MARKER).exists()
    assert run(repos, music)[0] == "migrated"


def test_plain_file_mode_without_git(tmp_path):
    root, music = tmp_path / "data", tmp_path / "music"
    (root / "covers").mkdir(parents=True)
    music.mkdir()
    (root / "library.json").write_text(json.dumps({"songs": [song(VID)]}))
    (root / "covers" / f"{VID}.jpg").write_bytes(b"jpg")
    (music / f"{VID}.m4a").write_bytes(b"audio")
    kw = dict(data_root=root, covers_root=None, music_dir=music, owner_email=OWNER)
    assert migrate.run(**kw) == "migrated"
    assert (root / "users" / OUID / "library.json").is_file()
    assert (root / "users" / OUID / "covers" / f"{VID}.jpg").read_bytes() == b"jpg"
    assert (music / "users" / OUID / f"{VID}.m4a").read_bytes() == b"audio"
    assert not (root / "library.json").exists() and not (root / "covers" / f"{VID}.jpg").exists()
    assert migrate.run(**kw) == "done"


def test_other_owner_email_gets_its_own_uid(repos, tmp_path):
    music = seed_legacy(repos, tmp_path)
    assert run(repos, music, owner="Boss@Example.com")[0] == "migrated"
    assert (music / "users" / users.uid_for_email("boss@example.com") / f"{VID}.m4a").is_file()


def test_server_serves_the_migrated_library_to_the_owner_only(repos, tmp_path, monkeypatch, multi):
    data_bare, data, cov_bare, cov = repos
    music = tmp_path / "ignored"
    music.mkdir()
    seeded = seed_legacy(repos, tmp_path)
    sync = gitstore.GitSync(data, cov, backoff=(0.05, 0.1))
    monkeypatch.setattr(main, "SYNC", sync)
    monkeypatch.setenv("AUDIO_MUSIC_ROOT", str(seeded))
    assert main.migrate_legacy() == "migrated"
    assert main.migrate_legacy() == "done"
    lib = multi.get("/library", headers=H).json()["songs"]
    assert [(s["id"], s["audio_state"]) for s in lib] == [(VID, "server"), (VID2, "server")]
    assert multi.get(f"/files/{VID}", headers=H).content == b"audio-" + VID.encode()
    assert multi.get(f"/covers/{VID}", headers=H).content == b"jpg-" + VID.encode()
    assert multi.get(f"/files/{VID}", headers=who(multi, ALICE)).status_code == 404
    assert multi.get("/library", headers=who(multi, ALICE)).json() == {"songs": []}
    sync.stop()


def test_two_users_write_concurrently_to_the_same_repos(repos, tmp_path, monkeypatch, multi):
    data_bare, data, cov_bare, cov = repos
    sync = gitstore.GitSync(data, cov, backoff=(0.05, 0.1))
    monkeypatch.setattr(main, "SYNC", sync)
    monkeypatch.setenv("AUDIO_MUSIC_ROOT", str(tmp_path / "music"))
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "50")
    vids = {ALICE: (VID, VID2, VID3), BOB: (VID4, "ccccccccccc", "ddddddddddd")}
    errors = []

    def work(email):
        c = TestClient(main.app)
        c.key = multi.key
        h = who(c, email)
        for v in vids[email]:
            body = {"url": f"https://youtu.be/{v}", "metadata": {"title": "S"}, "tags": []}
            r = c.post("/songs", json=body, headers=h)
            if r.status_code != 202:
                errors.append((email, v, r.status_code, r.text))
        r = c.patch(f"/songs/{vids[email][0]}", json={"title": "edited"}, headers=h)
        if r.status_code != 200:
            errors.append((email, "patch", r.status_code))

    threads = [threading.Thread(target=work, args=(e,)) for e in (ALICE, BOB)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert not errors
    end = time.time() + 10
    while time.time() < end and sync.status() != "ok":
        time.sleep(0.05)
    assert sync.status() == "ok"
    for email in (ALICE, BOB):
        doc = json.loads(git(data_bare, "show", f"main:audioplayer/users/{uid(email)}/library.json"))
        assert sorted(s["id"] for s in doc["songs"]) == sorted(vids[email])
        assert doc["songs"][0]["title"] == "edited"
        profile = json.loads(git(data_bare, "show", f"main:audioplayer/users/{uid(email)}/profile.json"))
        assert profile["email"] == email
        for v in vids[email]:
            assert git(cov_bare, "show", f"main:audioplayer/users/{uid(email)}/covers/{v}.jpg") == "jpg"
    subjects = log(data_bare)
    for email in (ALICE, BOB):
        p = f"audioplayer: {uid(email)[:8]} "
        assert sum(s.startswith(p + "add ") for s in subjects) == 3
        assert p + "signup" in subjects and p + f"edit {vids[email][0]}" in subjects
    assert git(data, "status", "--porcelain") == ""
    sync.stop()
