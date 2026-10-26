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
    assert len(lines) == 2
    assert lines[1].endswith(f",{VID},7.0")


def test_repeated_batch_key_appends_nothing(lib, tmp_path):
    post(lib, "k1", play())
    r = post(lib, "k1", play())
    assert r.json()["duplicate"] is True
    assert r.json()["appended"] == 0
    assert len((tmp_path / "plays" / uid() / "play-history.csv").read_text().splitlines()) == 2


def test_unknown_song_and_long_play_are_handled(lib, tmp_path):
    r = post(lib, "k1", play(song=VID2), play(seconds=99999))
    assert r.json()["appended"] == 1
    assert r.json()["ignored"] == 1
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
    assert not plays.user_dir(uid()).exists()
    assert not plays.repo_copy(uid()).exists()


def lines_of(tmp_path):
    return (tmp_path / "plays" / uid() / "play-history.csv").read_text().splitlines()


def test_cont_merges_into_previous_record(lib, tmp_path):
    post(lib, "k1", play(seconds=5, delta=timedelta(seconds=60)))
    r = post(lib, "k2", {**play(seconds=2, delta=timedelta(seconds=55)), "cont": True})
    assert r.json() == {"ok": True, "appended": 1, "duplicate": False, "ignored": 0}
    lines = lines_of(tmp_path)
    assert len(lines) == 2
    assert lines[1].endswith(f",{VID},7.0")
    assert lib.get("/stats/listening", headers=H).json()["songs"][VID]["listened"]["all"] == 1


def test_cont_without_match_appends_or_drops(lib, tmp_path):
    r = post(lib, "k1", {**play(seconds=6), "cont": True}, {**play(seconds=1, delta=timedelta(hours=3)), "cont": True})
    assert r.json()["appended"] == 1
    assert r.json()["ignored"] == 1
    assert len(lines_of(tmp_path)) == 2


def test_cont_far_gap_starts_new_record(lib, tmp_path):
    post(lib, "k1", play(seconds=5, delta=timedelta(hours=2)))
    post(lib, "k2", {**play(seconds=5), "cont": True})
    assert len(lines_of(tmp_path)) == 3


def test_cont_pieces_in_one_batch_merge(lib, tmp_path):
    r = post(
        lib, "k1",
        play(seconds=5, delta=timedelta(seconds=60)),
        {**play(seconds=1, delta=timedelta(seconds=55)), "cont": True},
        {**play(seconds=1, delta=timedelta(seconds=54)), "cont": True},
    )
    assert r.json()["appended"] == 3
    lines = lines_of(tmp_path)
    assert len(lines) == 2
    assert lines[1].endswith(f",{VID},7.0")


def day(seconds):
    return datetime(2026, 10, 20, 12, 0, 0, tzinfo=UTC) + timedelta(seconds=seconds)


def test_merge_fragments_joins_alexs_three_pieces():
    rows = [(day(0), "s", 80.0), (day(80), "s", 80.0), (day(160), "s", 80.0)]
    assert plays.merge_fragments(rows, {"s": 293.0}) == [(day(0), "s", 240.0)]
    assert 240.0 < plays.LISTENED_THRESHOLD * 293.0


def test_merge_fragments_keeps_skip_then_later_replay_apart():
    rows = [(day(0), "s", 30.0), (day(30 + 121), "s", 200.0)]
    assert plays.merge_fragments(rows, {"s": 293.0}) == rows


def test_merge_fragments_keeps_finished_play_and_repeat_apart():
    rows = [(day(0), "s", 280.0), (day(281), "s", 280.0)]
    assert plays.merge_fragments(rows, {"s": 293.0}) == rows


def test_merge_fragments_other_song_unknown_duration_and_order():
    rows = [(day(0), "a", 50.0), (day(50), "b", 50.0), (day(100), "a", 50.0)]
    assert plays.merge_fragments(rows, {"a": 293.0, "b": 293.0}) == rows
    same = [(day(0), "u", 50.0), (day(50), "u", 50.0)]
    assert plays.merge_fragments(same, {}) == same
    back = [(day(100), "s", 50.0), (day(0), "s", 50.0)]
    assert plays.merge_fragments(back, {"s": 293.0}) == back


def test_merge_fragments_caps_the_sum():
    rows = [(day(0), "s", 250.0), (day(250), "s", 250.0)]
    assert plays.merge_fragments(rows, {"s": 293.0}) == [(day(0), "s", 322.3)]
