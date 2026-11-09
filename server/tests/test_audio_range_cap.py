import pytest

from app import audio_range

from tests.test_guest import audio_file, lib, web  # noqa: F401
from tests.test_library import H, VID, client  # noqa: F401

K = 1024
CAP = 768 * K
TOTAL = 3 * CAP + 1000


@pytest.fixture(autouse=True)
def _cap_defaults(monkeypatch):
    monkeypatch.delenv("AUDIO_RANGE_RAMP", raising=False)
    monkeypatch.setenv("AUDIO_RANGE_CAP_BYTES", str(CAP))
    audio_range.reset()


@pytest.fixture
def big(lib, tmp_path):
    audio_file(tmp_path, TOTAL)
    return lib


def get(c, rng=None, **kw):
    headers = dict(H, **kw.pop("headers", {}))
    if rng is not None:
        headers["Range"] = rng
    return c.get(f"/files/{VID}", headers=headers, **kw)


def test_default_cap_is_off(monkeypatch):
    monkeypatch.delenv("AUDIO_RANGE_CAP_BYTES", raising=False)
    assert audio_range.cap_bytes() == 0
    assert audio_range.first_chunk("bytes=0-", 10 * CAP) == "bytes=0-"


def test_open_range_from_zero_is_the_first_chunk(big):
    r = get(big, "bytes=0-")
    assert r.status_code == 206
    assert len(r.content) == CAP
    assert r.headers["content-range"] == f"bytes 0-{CAP - 1}/{TOTAL}"
    assert r.headers["content-length"] == str(CAP)
    assert r.headers["accept-ranges"] == "bytes"
    assert r.headers["content-type"] == "audio/mp4"
    assert r.headers["cache-control"] == "private, no-cache"
    assert r.headers.get("etag")


def test_whole_file_range_is_capped_and_content_is_the_file_prefix(big):
    r = get(big, f"bytes=0-{TOTAL - 1}")
    assert r.status_code == 206
    assert r.content == b"a" * CAP
    assert r.headers["content-range"] == f"bytes 0-{CAP - 1}/{TOTAL}"


def test_mid_file_open_range_is_capped_from_its_start(big):
    start = CAP + 5
    r = get(big, f"bytes={start}-")
    assert r.status_code == 206
    assert len(r.content) == CAP
    assert r.headers["content-range"] == f"bytes {start}-{start + CAP - 1}/{TOTAL}"


def test_client_that_continues_gets_every_byte(big):
    pos, got = 0, 0
    while pos < TOTAL:
        r = get(big, f"bytes={pos}-")
        assert r.status_code == 206
        got += len(r.content)
        pos += len(r.content)
    assert got == TOTAL


def test_last_chunk_is_served_to_the_end(big):
    start = TOTAL - 1000
    r = get(big, f"bytes={start}-")
    assert r.status_code == 206
    assert len(r.content) == 1000
    assert r.headers["content-range"] == f"bytes {start}-{TOTAL - 1}/{TOTAL}"


def test_remainder_just_over_the_cap_is_capped_exactly(big):
    start = TOTAL - CAP - 1
    r = get(big, f"bytes={start}-")
    assert len(r.content) == CAP
    assert r.headers["content-range"] == f"bytes {start}-{start + CAP - 1}/{TOTAL}"


@pytest.mark.parametrize("rng,length", [("bytes=0-1", 2), ("bytes=0-0", 1), (f"bytes=10-{CAP + 9}", CAP), (f"bytes=0-{CAP - 1}", CAP)])
def test_small_ranges_are_untouched(big, rng, length):
    r = get(big, rng)
    assert r.status_code == 206
    assert len(r.content) == length


def test_suffix_range_keeps_its_meaning(big):
    r = get(big, "bytes=-500")
    assert r.status_code == 206
    assert len(r.content) == 500
    assert r.headers["content-range"] == f"bytes {TOTAL - 500}-{TOTAL - 1}/{TOTAL}"


def test_big_suffix_range_is_not_capped(big):
    r = get(big, f"bytes=-{TOTAL - 10}")
    assert r.status_code == 206
    assert len(r.content) == TOTAL - 10


def test_unsatisfiable_range_is_416(big):
    r = get(big, f"bytes={TOTAL}-")
    assert r.status_code == 416
    assert r.headers["content-range"] == f"*/{TOTAL}"


def test_malformed_range_is_not_a_partial_answer(big):
    r = get(big, "bytes=abc-")
    assert r.status_code in (200, 400, 416)


def test_plain_get_is_the_whole_file(big):
    r = get(big)
    assert r.status_code == 200
    assert len(r.content) == TOTAL
    assert r.headers["accept-ranges"] == "bytes"


def test_download_with_a_range_is_not_capped(big):
    r = get(big, "bytes=0-", params={"download": "1"})
    assert r.status_code == 206
    assert len(r.content) == TOTAL


def test_head_advertises_the_capped_range(big):
    plain = big.head(f"/files/{VID}", headers=H)
    assert plain.status_code == 200
    assert plain.headers["content-length"] == str(TOTAL)
    ranged = big.head(f"/files/{VID}", headers={**H, "Range": "bytes=0-"})
    assert ranged.status_code == 206
    assert ranged.headers["content-length"] == str(CAP)
    assert ranged.headers["content-range"] == f"bytes 0-{CAP - 1}/{TOTAL}"


def test_urlsession_clients_get_the_range_they_asked_for(big):
    r = get(big, "bytes=0-", headers={"User-Agent": "AudioPlayer/1 CFNetwork/1568 Darwin/24.0"})
    assert r.status_code == 206
    assert len(r.content) == TOTAL


def test_avplayer_and_browsers_are_capped(big):
    for agent in ("AppleCoreMedia/1.0.0.22A (iPhone; U; CPU OS 18_0 like Mac OS X; en_us) CFNetwork/1568", "Mozilla/5.0 (Macintosh) AppleWebKit/605 Safari/605"):
        r = get(big, "bytes=0-", headers={"User-Agent": agent})
        assert len(r.content) == CAP


def test_cap_is_configurable_and_zero_turns_it_off(big, monkeypatch):
    monkeypatch.setenv("AUDIO_RANGE_CAP_BYTES", "1000")
    assert len(get(big, "bytes=0-").content) == 1000
    monkeypatch.setenv("AUDIO_RANGE_CAP_BYTES", "0")
    assert len(get(big, "bytes=0-").content) == TOTAL
    monkeypatch.setenv("AUDIO_RANGE_CAP_BYTES", "nonsense")
    assert audio_range.cap_bytes() == 0


def test_guest_range_is_capped_and_charged_for_the_chunk(lib, tmp_path, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    audio_file(tmp_path, TOTAL)
    seen = []
    from app import guest

    monkeypatch.setattr(guest, "charge_audio", lambda ip, n: seen.append(n))
    r = web().get(f"/files/{VID}", headers={"Range": "bytes=0-"})
    assert r.status_code == 206
    assert len(r.content) == CAP
    assert seen == [CAP]


def test_first_chunk_unit():
    assert audio_range.first_chunk("bytes=0-", 10 * CAP) == f"bytes=0-{CAP - 1}"
    assert audio_range.first_chunk("bytes=5-9", 10 * CAP) == "bytes=5-9"
    assert audio_range.first_chunk("bytes=-500", 10 * CAP) == "bytes=-500"
    assert audio_range.first_chunk("bytes=0-1,5-9", 10 * CAP) == "bytes=0-1,5-9"
    assert audio_range.first_chunk("bytes=0-", 100) == "bytes=0-"
