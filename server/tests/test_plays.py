from datetime import UTC, datetime, timedelta

import pytest

from app import deps, plays
from tests.test_guest import web  # noqa: F401
from tests.test_library import H, VID, VID2, client  # noqa: F401
from tests.test_users import add


@pytest.fixture
def lib(client, tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_PLAYS_DIR", str(tmp_path / "plays"))
    assert add(client, H, VID).status_code == 202
    return client


def stamp(delta=timedelta()):
    return (datetime.now(UTC) - delta).strftime("%Y-%m-%dT%H:%M:%SZ")


def post(client, key, *items):
    return client.post("/plays", headers=H, json={"batch_key": key, "plays": list(items)})


def play(song=VID, seconds=7.0, delta=timedelta()):
    return {"timestamp": stamp(delta), "song_id": song, "listened_s": seconds}


def uid():
    from app import users
    return users.owner_uid()


def test_append_writes_header_and_rows(lib, tmp_path):
    r = post(lib, "k1", play(seconds=7.04), play(seconds=3))
    assert r.json() == {"ok": True, "appended": 1, "duplicate": False, "ignored": 1}
    lines = (tmp_path / "plays" / uid() / "play-history.csv").read_text().splitlines()
    assert lines[0] == "timestamp,song_id,listened_s"
    assert len(lines) == 2 and lines[1].endswith(f",{VID},7.0")


def test_repeated_batch_key_appends_nothing(lib, tmp_path):
    post(lib, "k1", play())
    r = post(lib, "k1", play())
    assert r.json()["duplicate"] is True and r.json()["appended"] == 0
    assert len((tmp_path / "plays" / uid() / "play-history.csv").read_text().splitlines()) == 2


def test_unknown_song_and_long_play_are_handled(lib, tmp_path):
    r = post(lib, "k1", play(song=VID2), play(seconds=99999))
    assert r.json()["appended"] == 1 and r.json()["ignored"] == 1
    assert (tmp_path / "plays" / uid() / "play-history.csv").read_text().splitlines()[1].endswith(",7.7")


def test_batch_cap(lib):
    assert post(lib, "k1", *[play() for _ in range(501)]).status_code == 422


def test_guests_and_anonymous_cannot_write_or_read(lib):
    assert lib.post("/plays", json={"batch_key": "k", "plays": []}).status_code in (401, 403, 503)
    assert lib.get("/stats/listening").status_code in (401, 403, 503)


def test_listening_windows_and_outcome(lib):
    post(lib, "k1", play(seconds=7), play(seconds=5), play(seconds=7, delta=timedelta(days=10)), play(seconds=7, delta=timedelta(days=40)))
    song = lib.get("/stats/listening", headers=H).json()["songs"][VID]
    assert song["listened"] == {"today": 1, "d7": 1, "d30": 2, "all": 3}
    assert song["skipped"] == {"today": 1, "d7": 1, "d30": 1, "all": 1}
    assert song["total_listened_s"] == 26.0
    assert song["last_listened"] is not None


def test_stats_cache_follows_appends(lib):
    post(lib, "k1", play())
    assert lib.get("/stats/listening", headers=H).json()["songs"][VID]["listened"]["all"] == 1
    post(lib, "k2", play())
    assert lib.get("/stats/listening", headers=H).json()["songs"][VID]["listened"]["all"] == 2


def test_daily_sync_copies_once_when_changed(lib, tmp_path):
    (deps.data_root() / "users" / uid()).mkdir(parents=True, exist_ok=True)
    post(lib, "k1", play())
    assert plays.sync_once() == 1
    assert plays.repo_copy(uid()).read_bytes() == plays.csv_path(uid()).read_bytes()
    assert plays.sync_once() == 0
    post(lib, "k2", play())
    assert plays.sync_once() == 1


def test_delete_user_removes_both(lib):
    (deps.data_root() / "users" / uid()).mkdir(parents=True, exist_ok=True)
    post(lib, "k1", play())
    plays.sync_once()
    plays.delete_user(uid())
    assert not plays.user_dir(uid()).exists() and not plays.repo_copy(uid()).exists()
