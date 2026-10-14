import pytest

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
    assert tail.status_code == 206 and len(tail.content) == 100
    probe = client.get(f"/files/{VID}", headers={**kw.get("headers", {}), "Range": "bytes=0-1"})
    assert probe.status_code == 206 and len(probe.content) == 2


def test_owner_audio_supports_range(lib):
    assert_ranged(lib, headers=H)


def test_guest_audio_supports_range(lib):
    assert_ranged(web())


@pytest.mark.parametrize("who", ["owner", "guest"])
def test_head_advertises_ranges(lib, who):
    head = lib.head(f"/files/{VID}", headers=H) if who == "owner" else web().head(f"/files/{VID}")
    assert head.status_code == 200
    assert head.headers["accept-ranges"] == "bytes"
    assert int(head.headers["content-length"]) == SIZE
