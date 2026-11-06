import pytest

from app import audio_range

from tests.test_guest import lib, web  # noqa: F401
from tests.test_library import H, VID, client  # noqa: F401

SIZE = 10_000


def assert_ranged(client, **kw):
    full = client.get(f"/files/{VID}", **kw)
    assert full.status_code == 200
    assert full.headers["accept-ranges"] == "bytes"
    assert full.headers["content-type"] == "audio/mp4"
    assert "content-encoding" not in full.headers
    assert int(full.headers["content-length"]) == SIZE
    part = client.get(f"/files/{VID}", headers={**kw.get("headers", {}), "Range": "bytes=100-199"})
    assert part.status_code == 206
    assert part.headers["content-range"] == f"bytes 100-199/{SIZE}"
    assert part.headers["accept-ranges"] == "bytes"
    assert len(part.content) == 100
    tail = client.get(f"/files/{VID}", headers={**kw.get("headers", {}), "Range": "bytes=9900-"})
    assert tail.status_code == 206
    assert len(tail.content) == 100
    probe = client.get(f"/files/{VID}", headers={**kw.get("headers", {}), "Range": "bytes=0-1"})
    assert probe.status_code == 206
    assert len(probe.content) == 2


def test_owner_audio_supports_range(lib):
    assert_ranged(lib, headers=H)


def test_guest_audio_supports_range(lib, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    assert_ranged(web())


@pytest.mark.parametrize("who", ["owner", "guest"])
def test_head_advertises_ranges(lib, who, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    head = lib.head(f"/files/{VID}", headers=H) if who == "owner" else web().head(f"/files/{VID}")
    assert head.status_code == 200
    assert head.headers["accept-ranges"] == "bytes"
    assert int(head.headers["content-length"]) == SIZE


K = 1024
T1, T2, T3 = 128 * K, 512 * K, 2048 * K


@pytest.fixture(autouse=True)
def _fresh_runs(monkeypatch):
    monkeypatch.setenv("AUDIO_RANGE_RAMP", "1")
    audio_range.reset()
    yield
    audio_range.reset()


def put_audio(tmp_path, size):
    from tests.test_guest import audio_file

    audio_file(tmp_path, size)


def get_range(c, rng, vid=VID, **kw):
    return c.get(f"/files/{vid}", headers={**H, "Range": rng}, **kw)


def test_constants_are_the_three_ramp_steps():
    assert audio_range.RANGE_CHUNK_BYTES == (T1, T2, T3)


def test_open_range_ramps_128k_512k_2m_then_stays(lib, tmp_path):
    total = T1 + T2 + 2 * T3 + 1000
    put_audio(tmp_path, total)
    pos = 0
    for size in (T1, T2, T3, T3):
        r = get_range(lib, f"bytes={pos}-")
        assert r.status_code == 206
        assert len(r.content) == size
        assert r.headers["content-range"] == f"bytes {pos}-{pos + size - 1}/{total}"
        assert r.headers["content-length"] == str(size)
        assert r.headers["accept-ranges"] == "bytes"
        assert r.headers["content-type"] == "audio/mp4"
        assert r.headers["cache-control"] == "private, no-cache"
        pos += size
    last = get_range(lib, f"bytes={pos}-")
    assert len(last.content) == 1000
    assert last.headers["content-range"] == f"bytes {pos}-{total - 1}/{total}"


def test_seek_restarts_the_ramp(lib, tmp_path):
    put_audio(tmp_path, 4 * T3)
    get_range(lib, "bytes=0-")
    get_range(lib, f"bytes={T1}-")
    assert len(get_range(lib, f"bytes={T1 + T2}-").content) == T3
    assert len(get_range(lib, f"bytes={T3 * 3}-").content) == T1
    assert len(get_range(lib, f"bytes={T3 * 3 + T1}-").content) == T2


def test_each_file_has_its_own_run():
    big = 4 * T3
    audio_range.capped_range("bytes=0-", big, ("u", "one"))
    assert audio_range.capped_range(f"bytes={T1}-", big, ("u", "one")) == f"bytes={T1}-{T1 + T2 - 1}"
    assert audio_range.capped_range(f"bytes={T1}-", big, ("u", "two")) == f"bytes={T1}-{2 * T1 - 1}"
    assert audio_range.capped_range(f"bytes={T1 + T2}-", big, ("v", "one")) == f"bytes={T1 + T2}-{T1 + T2 + T1 - 1}"


def test_runs_expire(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(audio_range, "_clock", lambda: now[0])
    key = ("u", "v")
    assert audio_range.capped_range("bytes=0-", 10 * T3, key) == f"bytes=0-{T1 - 1}"
    assert audio_range.capped_range(f"bytes={T1}-", 10 * T3, key) == f"bytes={T1}-{T1 + T2 - 1}"
    now[0] += audio_range.RUNS_TTL_S + 1
    assert audio_range.capped_range(f"bytes={T1 + T2}-", 10 * T3, key) == f"bytes={T1 + T2}-{T1 + T2 + T1 - 1}"


def test_runs_are_evicted_least_recently_used_first(monkeypatch):
    monkeypatch.setattr(audio_range, "RUNS_MAX", 2)
    for v in ("a", "b", "c"):
        audio_range.capped_range("bytes=0-", 10 * T3, ("u", v))
    assert list(audio_range._runs) == [("u", "b"), ("u", "c")]
    assert audio_range.capped_range(f"bytes={T1}-", 10 * T3, ("u", "a")) == f"bytes={T1}-{T1 + T1 - 1}"


def test_oversized_bounded_range_is_capped_to_the_step(lib, tmp_path):
    put_audio(tmp_path, 4 * T3)
    assert len(get_range(lib, f"bytes=0-{T3}").content) == T1
    assert len(get_range(lib, f"bytes={T1}-{T1 + 99}").content) == 100


def test_no_range_header_is_the_whole_file(lib, tmp_path):
    put_audio(tmp_path, T2 + 5000)
    r = lib.get(f"/files/{VID}", headers=H)
    assert r.status_code == 200
    assert len(r.content) == T2 + 5000
    assert "content-range" not in r.headers


def test_download_keeps_open_ranges_whole(lib, tmp_path):
    put_audio(tmp_path, T2 + 5000)
    r = get_range(lib, "bytes=100-", params={"download": 1})
    assert r.status_code == 206
    assert len(r.content) == T2 + 5000 - 100


def test_head_does_not_advance_the_run(lib, tmp_path):
    put_audio(tmp_path, 4 * T3)
    lib.head(f"/files/{VID}", headers={**H, "Range": "bytes=0-"})
    assert len(get_range(lib, "bytes=0-").content) == T1


def test_small_file_open_range_is_whole_206(lib):
    r = get_range(lib, "bytes=0-")
    assert r.status_code == 206
    assert len(r.content) == SIZE
    assert r.headers["content-range"] == f"bytes 0-{SIZE - 1}/{SIZE}"


def test_suffix_range_unchanged_and_not_a_run(lib, tmp_path):
    total = T3 + T2
    put_audio(tmp_path, total)
    tail = get_range(lib, "bytes=-2000000")
    assert tail.status_code == 206
    assert tail.headers["content-range"] == f"bytes {total - 2_000_000}-{total - 1}/{total}"
    assert len(get_range(lib, "bytes=0-").content) == T1


def test_multi_range_and_unsatisfiable_fall_back(lib, tmp_path):
    put_audio(tmp_path, T2 + 5000)
    multi = get_range(lib, "bytes=0-9,20-29")
    assert multi.status_code == 206
    assert multi.headers["content-range"].startswith("multipart/byteranges")
    assert get_range(lib, f"bytes={T2 + 5000}-").status_code == 416


def test_env_overrides_chunk_sizes(lib, monkeypatch):
    for n, v in zip(audio_range.RANGE_CHUNK_ENVS, ("1000", "2000", "3000")):
        monkeypatch.setenv(n, v)
    assert [len(get_range(lib, f"bytes={p}-").content) for p in (0, 1000, 3000)] == [1000, 2000, 3000]


def test_guest_open_range_is_charged_for_the_step_only(lib, tmp_path, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    put_audio(tmp_path, T3)
    seen = []
    from app import guest

    monkeypatch.setattr(guest, "charge_audio", lambda ip, size: seen.append(size))
    r = web().get(f"/files/{VID}", headers={"Range": "bytes=0-"})
    assert r.status_code == 206
    assert seen == [T1]


@pytest.mark.parametrize("value", [None, "", "0", "true"])
def test_ramp_is_off_unless_switched_on(lib, tmp_path, monkeypatch, value):
    if value is None:
        monkeypatch.delenv("AUDIO_RANGE_RAMP")
    else:
        monkeypatch.setenv("AUDIO_RANGE_RAMP", value)
    total = 4 * T3
    put_audio(tmp_path, total)
    r = get_range(lib, "bytes=0-")
    assert r.status_code == 206
    assert len(r.content) == total
    assert r.headers["content-range"] == f"bytes 0-{total - 1}/{total}"
    assert r.headers["content-length"] == str(total)
    assert r.headers["accept-ranges"] == "bytes"
    assert audio_range._runs == {}


def test_ramp_off_serves_oversized_and_mid_ranges_untouched(lib, tmp_path, monkeypatch):
    monkeypatch.delenv("AUDIO_RANGE_RAMP")
    total = 4 * T3
    put_audio(tmp_path, total)
    assert len(get_range(lib, f"bytes=0-{T3}").content) == T3 + 1
    assert len(get_range(lib, f"bytes={T1}-").content) == total - T1
    assert audio_range._runs == {}


def test_ramp_switch_is_read_per_request(lib, tmp_path, monkeypatch):
    put_audio(tmp_path, 4 * T3)
    monkeypatch.delenv("AUDIO_RANGE_RAMP")
    assert len(get_range(lib, "bytes=0-").content) == 4 * T3
    monkeypatch.setenv("AUDIO_RANGE_RAMP", "1")
    assert len(get_range(lib, "bytes=0-").content) == T1
