import pytest

from app import deps, extractor
from tests.test_library import ADIR, H, VID, VID2, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who, add as add_as, uid  # noqa: F401


def add_meta(client, headers, vid=VID):
    r = add_as(client, headers, vid, audio=False)
    assert r.status_code == 201
    return r


def state(client, headers, vid=VID):
    songs = client.get("/library", headers=headers).json()["songs"]
    return next(s for s in songs if s["id"] == vid)["audio_state"]


def test_fetch_attaches_audio_to_a_catalog_song(multi):
    a = who(multi, ALICE)
    add_meta(multi, a)
    assert state(multi, a) == "none"
    r = multi.post(f"/songs/{VID}/audio", headers=a)
    assert r.status_code == 202
    assert multi.get(f"/songs/{VID}/status", headers=a).json()["status"] == "done"
    assert state(multi, a) == "server"
    assert multi.get(f"/files/{VID}", headers=a).status_code == 200


def test_fetch_is_idempotent_once_audio_exists(multi):
    a = who(multi, ALICE)
    add_meta(multi, a)
    multi.post(f"/songs/{VID}/audio", headers=a)
    r = multi.post(f"/songs/{VID}/audio", headers=a)
    assert r.status_code == 200 and r.json()["status"] == "done"


def test_unknown_song_is_404_and_other_users_cannot_fetch(multi):
    a, b = who(multi, ALICE), who(multi, BOB)
    assert multi.post(f"/songs/{VID}/audio", headers=a).status_code == 404
    add_meta(multi, a)
    assert multi.post(f"/songs/{VID}/audio", headers=b).status_code == 404
    assert state(multi, a) == "none"


def test_fetch_counts_against_the_hourly_limit(multi, monkeypatch):
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "3")
    a = who(multi, ALICE)
    add_meta(multi, a, VID)
    add_meta(multi, a, VID2)
    assert multi.post(f"/songs/{VID}/audio", headers=a).status_code == 202
    r = multi.post(f"/songs/{VID2}/audio", headers=a)
    assert r.status_code == 429
    body = r.json()
    assert body["error"] == "hourly_limit" and body["retry_after_minutes"] >= 1
    assert state(multi, a, VID2) == "none"


def test_owner_is_exempt_from_the_hourly_limit(client, monkeypatch):
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "1")
    for vid in (VID, VID2):
        r = client.post("/songs", json={"url": f"https://youtu.be/{vid}", "metadata": {"title": "S"}, "tags": [], "audio": False}, headers=H)
        assert r.status_code == 201
    assert client.post(f"/songs/{VID}/audio", headers=H).status_code == 202
    assert client.post(f"/songs/{VID2}/audio", headers=H).status_code == 202


def test_fetch_respects_the_storage_cap(multi, monkeypatch):
    monkeypatch.setenv("USER_MAX_BYTES", "1")
    a = who(multi, ALICE)
    add_meta(multi, a)
    audio = deps.audio_dir(uid(ALICE))
    audio.mkdir(parents=True, exist_ok=True)
    (audio / "other.m4a").write_bytes(b"xx")
    r = multi.post(f"/songs/{VID}/audio", headers=a)
    assert r.status_code == 403 and r.json()["error"] == "library_full_bytes"


def test_failed_fetch_reports_error_and_can_retry(multi, monkeypatch):
    a = who(multi, ALICE)
    add_meta(multi, a)
    good = extractor.download_audio

    def boom(*args, **kwargs):
        raise RuntimeError("blocked")

    monkeypatch.setattr(extractor, "download_audio", boom)
    assert multi.post(f"/songs/{VID}/audio", headers=a).status_code == 202
    job = multi.get(f"/songs/{VID}/status", headers=a).json()
    assert job["status"] == "error" and "blocked" in job["error"]
    assert state(multi, a) == "none"
    monkeypatch.setattr(extractor, "download_audio", good)
    assert multi.post(f"/songs/{VID}/audio", headers=a).status_code == 202
    assert state(multi, a) == "server"
