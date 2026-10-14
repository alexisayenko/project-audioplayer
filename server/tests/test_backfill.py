import threading
from contextlib import contextmanager

import pytest

from app import backfill, bpm, deps, library, users
from tests.test_library import ADIR, H, OWNER_UID, VID, VID2, add, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who  # noqa: F401
from tests.test_users import add as add_as

URL = "/me/backfill/bpm"
THIRD = "AAAAAAAAAAA"


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    monkeypatch.setenv("AUDIO_BACKFILL_SLEEP", "0")
    backfill.reset()
    yield
    backfill.reset()


def clear_bpm(uid, *ids):
    songs = library.load(deps.library_path(uid))
    for s in songs:
        if s["id"] in ids:
            s["bpm"] = None
    deps.save_songs(uid, songs)


def bpms(uid):
    return {s["id"]: s.get("bpm") for s in library.load(deps.library_path(uid))}


def wait(uid):
    job = backfill._jobs[uid]
    job.thread.join(10)
    assert not job.thread.is_alive()
    return job


def blocker(monkeypatch, value=100):
    gate, seen = threading.Event(), threading.Event()

    def slow(path):
        seen.set()
        gate.wait(5)
        return value

    monkeypatch.setattr(bpm, "detect_bpm", slow)
    return gate, seen


def test_anonymous_is_refused(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL).status_code == 401
    assert client.delete(URL).status_code == 401


def test_idle_and_nothing_to_do(client):
    assert client.get(URL, headers=H).json()["state"] == "idle"
    add(client)
    r = client.post(URL, headers=H)
    assert r.status_code == 200
    assert r.json()["state"] == "idle"
    assert r.json()["candidates"] == 0


def test_candidates_only_null_bpm_with_audio(client, tmp_path):
    for v in (VID, VID2, THIRD):
        add(client, v)
    clear_bpm(OWNER_UID, VID, THIRD)
    (ADIR(tmp_path) / f"{THIRD}.m4a").unlink()
    assert client.get(URL, headers=H).json()["candidates"] == 1
    assert backfill.candidates(OWNER_UID) == [VID]


def test_catalog_only_song_is_not_a_candidate(client):
    add(client, VID, audio=False)
    assert client.get(URL, headers=H).json()["candidates"] == 0


def test_run_fills_null_and_keeps_existing(client, monkeypatch):
    add(client, VID)
    add(client, VID2)
    clear_bpm(OWNER_UID, VID)
    monkeypatch.setattr(bpm, "detect_bpm", lambda path: 99)
    r = client.post(URL, headers=H)
    assert r.status_code == 202
    assert r.json()["state"] == "running"
    assert r.json()["total"] == 1
    wait(OWNER_UID)
    s = client.get(URL, headers=H).json()
    assert (s["state"], s["done"], s["failed"], s["skipped"], s["candidates"]) == ("done", 1, 0, 0, 0)
    assert s["finished_at"]
    assert bpms(OWNER_UID) == {VID: 99, VID2: 123}


def test_failures_are_counted_and_do_not_abort(client, monkeypatch):
    add(client, VID)
    add(client, VID2)
    clear_bpm(OWNER_UID, VID, VID2)
    monkeypatch.setattr(bpm, "detect_bpm", lambda path: None if path.stem == VID else 140)
    client.post(URL, headers=H)
    wait(OWNER_UID)
    s = client.get(URL, headers=H).json()
    assert (s["done"], s["failed"], s["candidates"]) == (1, 1, 1)
    assert bpms(OWNER_UID) == {VID: None, VID2: 140}


def test_detector_exception_counts_as_failed(client, monkeypatch):
    add(client)
    clear_bpm(OWNER_UID, VID)

    def boom(path):
        raise RuntimeError("x")

    monkeypatch.setattr(bpm, "detect_bpm", boom)
    client.post(URL, headers=H)
    assert wait(OWNER_UID).failed == 1


def test_per_song_timeout(client, monkeypatch):
    add(client, VID)
    add(client, VID2)
    clear_bpm(OWNER_UID, VID, VID2)
    release = threading.Event()

    def detect(path):
        if path.stem == VID:
            release.wait(2)
            return 80
        return 150

    monkeypatch.setattr(backfill, "SONG_TIMEOUT", 0.05)
    monkeypatch.setattr(bpm, "detect_bpm", detect)
    client.post(URL, headers=H)
    job = wait(OWNER_UID)
    release.set()
    assert (job.state, job.failed, job.done) == ("done", 1, 1)
    assert bpms(OWNER_UID)[VID2] == 150
    assert bpms(OWNER_UID)[VID] is None


def test_conflict_while_running_and_cancel(client, monkeypatch):
    for v in (VID, VID2):
        add(client, v)
    clear_bpm(OWNER_UID, VID, VID2)
    gate, seen = blocker(monkeypatch)
    assert client.post(URL, headers=H).status_code == 202
    assert seen.wait(5)
    again = client.post(URL, headers=H)
    assert again.status_code == 409
    assert again.json()["error"] == "backfill_running"
    assert client.get(URL, headers=H).json()["state"] == "running"
    assert client.delete(URL, headers=H).status_code == 200
    gate.set()
    job = wait(OWNER_UID)
    assert (job.state, job.done) == ("cancelled", 1)
    assert list(bpms(OWNER_UID).values()).count(100) == 1
    assert client.get(URL, headers=H).json()["state"] == "cancelled"


def test_cancel_when_idle_is_harmless(client):
    r = client.delete(URL, headers=H)
    assert r.status_code == 200
    assert r.json()["state"] == "idle"


def test_batches_commit_once_per_batch(client, monkeypatch):
    ids = [VID, VID2, "BBBBBBBBBBB", "CCCCCCCCCCC", "DDDDDDDDDDD"]
    for v in ids:
        add(client, v)
    clear_bpm(OWNER_UID, *ids)
    monkeypatch.setenv("AUDIO_BACKFILL_BATCH", "2")
    verbs = []
    real = deps.tx

    @contextmanager
    def counting(uid, verb):
        verbs.append(verb)
        with real(uid, verb):
            yield

    monkeypatch.setattr(deps, "tx", counting)
    monkeypatch.setattr(bpm, "detect_bpm", lambda path: 120)
    client.post(URL, headers=H)
    wait(OWNER_UID)
    assert verbs == ["detect bpm for 2 songs", "detect bpm for 2 songs", "detect bpm for 1 songs"]
    assert set(bpms(OWNER_UID).values()) == {120}


def test_value_set_meanwhile_is_kept(client, monkeypatch):
    add(client, VID)
    clear_bpm(OWNER_UID, VID)

    def detect(path):
        songs = library.load(deps.library_path(OWNER_UID))
        songs[0]["bpm"] = 77
        deps.save_songs(OWNER_UID, songs)
        return 130

    monkeypatch.setattr(bpm, "detect_bpm", detect)
    client.post(URL, headers=H)
    wait(OWNER_UID)
    assert bpms(OWNER_UID) == {VID: 77}


def test_audio_vanished_is_skipped(client, monkeypatch, tmp_path):
    add(client, VID)
    add(client, VID2)
    clear_bpm(OWNER_UID, VID, VID2)
    calls = []

    def detect(path):
        calls.append(path.stem)
        (ADIR(tmp_path) / f"{VID2}.m4a").unlink(missing_ok=True)
        return 90

    monkeypatch.setattr(bpm, "detect_bpm", detect)
    client.post(URL, headers=H)
    job = wait(OWNER_UID)
    assert (job.done, job.skipped) == (1, 1)
    assert calls == [VID]


def test_users_are_isolated_and_server_is_serial(multi, monkeypatch):
    a, b = who(multi, ALICE), who(multi, BOB)
    add_as(multi, a, VID)
    add_as(multi, b, VID2)
    ua, ub = users.uid_for_email(ALICE), users.uid_for_email(BOB)
    clear_bpm(ua, VID)
    clear_bpm(ub, VID2)
    assert multi.get(URL, headers=a).json()["candidates"] == 1
    assert multi.get(URL, headers=b).json()["candidates"] == 1
    gate, seen = blocker(monkeypatch, 111)
    assert multi.post(URL, headers=a).status_code == 202
    assert seen.wait(5)
    busy = multi.post(URL, headers=b)
    assert busy.status_code == 409
    assert busy.json()["error"] == "backfill_busy"
    assert multi.get(URL, headers=b).json()["state"] == "idle"
    gate.set()
    wait(ua)
    assert bpms(ua) == {VID: 111}
    assert bpms(ub) == {VID2: None}
    monkeypatch.setattr(bpm, "detect_bpm", lambda path: 95)
    assert multi.post(URL, headers=b).status_code == 202
    wait(ub)
    assert bpms(ub) == {VID2: 95}


def test_crash_sets_error_state(client, monkeypatch):
    add(client)
    clear_bpm(OWNER_UID, VID)
    monkeypatch.setattr(bpm, "detect_bpm", lambda path: 100)

    def broken(job, results):
        raise OSError("disk")

    monkeypatch.setattr(backfill, "_flush", broken)
    client.post(URL, headers=H)
    job = wait(OWNER_UID)
    assert job.state == "error"
    s = client.get(URL, headers=H).json()
    assert s["state"] == "error"
    assert s["last_error"] == "disk"
