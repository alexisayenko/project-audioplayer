import os
import random
from datetime import datetime, timezone

import pytest

from app import limits, timeutil
from app.problems import Problem

T0 = 1_800_000_000.0


def stamp(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def raises(fn, status, code):
    with pytest.raises(Problem) as ei:
        fn()
    assert (ei.value.status, ei.value.code) == (status, code)
    return ei.value


@pytest.fixture
def dirs(tmp_path):
    audio, pool = tmp_path / "u1", tmp_path
    audio.mkdir()
    return audio, pool


def songs(n):
    return [{"id": f"s{i}", "added_at": "2000-01-01T00:00:00Z"} for i in range(n)]


@pytest.mark.parametrize("raw,expected", [("", 500), ("abc", 500), ("  7 ", 7), ("1.5", 500), ("-3", -3), ("0", 0)])
def test_env_int_parsing_falls_back_on_garbage(monkeypatch, raw, expected):
    monkeypatch.setenv("USER_MAX_SONGS", raw)
    assert limits.max_songs() == expected


def test_concurrency_never_below_one(monkeypatch):
    monkeypatch.setenv("USER_MAX_CONCURRENT_DOWNLOADS", "0")
    monkeypatch.setenv("GLOBAL_MAX_CONCURRENT_DOWNLOADS", "-5")
    assert limits.user_concurrency() == 1 and limits.global_concurrency() == 1
    monkeypatch.setenv("USER_MAX_CONCURRENT_DOWNLOADS", "x")
    assert limits.user_concurrency() == 1


def test_dir_bytes_counts_nested_files_and_ignores_vanished(tmp_path, monkeypatch):
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "x").write_bytes(b"12345")
    (tmp_path / "y").write_bytes(b"123")
    assert limits.dir_bytes(tmp_path) == 8
    assert limits.dir_bytes(tmp_path / "nope") == 0
    real = os.stat

    def flaky(path, *a, **k):
        if str(path).endswith("x"):
            raise FileNotFoundError(path)
        return real(path, *a, **k)

    monkeypatch.setattr(limits.os, "stat", flaky)
    assert limits.dir_bytes(tmp_path) == 3


@pytest.mark.parametrize("bad", [None, "", "yesterday", "2020-01-01", "2020-01-01T00:00:00+02:00", 5])
def test_epoch_rejects_malformed_stamps(bad):
    assert timeutil.epoch_of(bad) is None


def test_epoch_parses_utc_z():
    assert timeutil.epoch_of("1970-01-02T00:00:00Z") == 86400


def test_song_count_boundary(monkeypatch, dirs):
    monkeypatch.setenv("USER_MAX_SONGS", "3")
    audio, pool = dirs
    limits.check_add("u", False, songs(2), audio, pool)
    raises(lambda: limits.check_add("u", False, songs(3), audio, pool), 403, "library_full_songs")
    limits.check_add("u", False, songs(1), audio, pool, inflight=1)
    raises(lambda: limits.check_add("u", False, songs(1), audio, pool, inflight=2), 403, "library_full_songs")


def test_owner_skips_user_limits_but_not_pool(monkeypatch, dirs):
    monkeypatch.setenv("USER_MAX_SONGS", "1")
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "1")
    monkeypatch.setenv("USER_MAX_BYTES", "1")
    audio, pool = dirs
    (audio / "f").write_bytes(b"xx")
    big = songs(50)
    limits.check_add("o", True, big, audio, pool)
    limits.check_fetch("o", True, big, audio, pool)
    monkeypatch.setenv("POOL_MAX_BYTES", "2")
    raises(lambda: limits.check_add("o", True, big, audio, pool), 503, "server_full")
    raises(lambda: limits.check_fetch("o", True, big, audio, pool), 503, "server_full")


def test_metadata_only_add_skips_storage_checks(monkeypatch, dirs):
    monkeypatch.setenv("USER_MAX_BYTES", "1")
    monkeypatch.setenv("POOL_MAX_BYTES", "1")
    audio, pool = dirs
    (audio / "f").write_bytes(b"xxxx")
    limits.check_add("u", False, [], audio, pool, with_audio=False)


def test_byte_quota_exact_limit_and_one_below(monkeypatch, dirs):
    monkeypatch.setenv("USER_MAX_BYTES", "10")
    audio, pool = dirs
    (audio / "f").write_bytes(b"x" * 9)
    limits.check_capacity(False, audio, pool)
    (audio / "g").write_bytes(b"x")
    err = raises(lambda: limits.check_capacity(False, audio, pool), 403, "library_full_bytes")
    assert "GB" in err.detail


def test_pool_boundary(monkeypatch, dirs):
    audio, pool = dirs
    (audio / "f").write_bytes(b"x" * 9)
    monkeypatch.setenv("POOL_MAX_BYTES", "10")
    limits.check_pool(pool)
    monkeypatch.setenv("POOL_MAX_BYTES", "9")
    raises(lambda: limits.check_pool(pool), 503, "server_full")


def test_hourly_limit_exact_and_window_rollover(monkeypatch, dirs):
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "3")
    audio, pool = dirs
    r = limits.AddRate()
    monkeypatch.setattr(limits, "RATE", r)
    for dt in (0, 10, 20):
        r.record("u", [], T0 + dt)
    monkeypatch.setattr(limits.time, "time", lambda: T0 + 30)
    err = raises(lambda: limits.check_add("u", False, [], audio, pool, with_audio=False), 429, "hourly_limit")
    assert err.headers["Retry-After"] == str(60 * 60)
    assert r.count("u", [], T0 + 3599) == 3
    assert r.count("u", [], T0 + 3600) == 2
    assert r.count("u", [], T0 + 3620) == 0
    monkeypatch.setattr(limits.time, "time", lambda: T0 + 3601)
    limits.check_add("u", False, [], audio, pool, with_audio=False)


def test_retry_minutes_rounds_up_and_is_at_least_one():
    r = limits.AddRate()
    assert r.retry_minutes("u", [], T0) == 1
    r.record("u", [], T0)
    assert r.retry_minutes("u", [], T0 + 1) == 60
    assert r.retry_minutes("u", [], T0 + 3540) == 1
    assert r.retry_minutes("u", [], T0 + 3599) == 1
    assert r.retry_minutes("u", [], T0 + 3600) == 1


def test_rate_relearns_from_added_at_after_restart_and_ignores_bad_stamps():
    r = limits.AddRate()
    s = [{"added_at": stamp(T0 - 60)}, {"added_at": stamp(T0 - 7200)}, {"added_at": "garbage"}, {}]
    assert r.count("u", s, T0) == 1
    r.record("u", s, T0)
    assert r.count("u", s, T0) == 2
    r.reset()
    assert r.count("u", s, T0) == 1


def test_rate_is_per_user():
    r = limits.AddRate()
    r.record("a", [], T0)
    assert r.count("a", [], T0) == 1 and r.count("b", [], T0) == 0


def test_check_fetch_has_no_song_count_but_has_rate_and_bytes(monkeypatch, dirs):
    monkeypatch.setenv("USER_MAX_SONGS", "1")
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "1")
    audio, pool = dirs
    limits.check_fetch("u", False, songs(5), audio, pool)
    limits.RATE.record("u", [])
    raises(lambda: limits.check_fetch("u", False, songs(5), audio, pool), 429, "hourly_limit")


def test_usage_reports_none_limits_for_owner(monkeypatch, dirs):
    audio, _ = dirs
    (audio / "f").write_bytes(b"abc")
    u = limits.usage("o", True, songs(2), audio)
    assert u["max_songs"] is None and u["max_bytes"] is None and u["max_adds"] is None
    assert (u["songs"], u["bytes"]) == (2, 3)
    assert limits.usage("u", False, [], audio)["max_songs"] == 500


def test_seeded_rate_never_exceeds_limit_within_window():
    rng = random.Random(1234)
    r = limits.AddRate()
    t, accepted = T0, []
    for _ in range(300):
        t += rng.uniform(0, 120)
        if r.count("u", [], t) < 5:
            r.record("u", [], t)
            accepted.append(t)
        assert r.count("u", [], t) <= 5
    for t0 in accepted:
        assert sum(1 for x in accepted if t0 <= x < t0 + limits.WINDOW) <= 5
