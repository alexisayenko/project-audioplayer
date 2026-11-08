import io
import random

import pytest
from PIL import Image

from app import deps, thumbs
from tests.test_covers import put, song  # noqa: F401
from tests.test_library import H, ODIR, VID, add, client  # noqa: F401, E402

IMMUTABLE = "private, max-age=31536000, immutable"
HOUR = "private, max-age=3600, stale-while-revalidate=86400"


def photo(size=(480, 360), seed=1):
    rnd = random.Random(seed)
    img = Image.new("RGB", size)
    px = img.load()
    for x in range(size[0]):
        for y in range(size[1]):
            px[x, y] = ((x * 255) // size[0] + rnd.randint(-12, 12) & 255, (y * 255) // size[1] + rnd.randint(-12, 12) & 255, (x + y + rnd.randint(-12, 12)) & 255)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return buf.getvalue()


def dims(content):
    with Image.open(io.BytesIO(content)) as img:
        assert img.format == "JPEG"
        return img.size


def thumb_files(tmp_path):
    return sorted((tmp_path / "downloads" / ".cache" / "thumbs").rglob("*.jpg"))


def test_sizes_are_square_and_smaller_than_the_original(client, song, tmp_path, capsys):
    original = put(client, photo(), "image/jpeg").status_code == 200 and client.get(f"/covers/{VID}", headers=H).content
    sizes = {}
    for size in (96, 192, 320):
        r = client.get(f"/covers/{VID}?size={size}", headers=H)
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/jpeg"
        assert dims(r.content) == (size, size)
        sizes[size] = len(r.content)
    assert sizes[96] < sizes[192] < sizes[320] < len(original)
    with capsys.disabled():
        print(f"\nTHUMB BYTES original={len(original)} {sizes}")


def test_without_size_the_original_bytes_are_unchanged_but_now_cacheable(client, song):
    original = client.get(f"/covers/{VID}", headers=H)
    assert original.content == b"jpg"
    assert original.headers["cache-control"] == HOUR
    assert original.headers["etag"] and original.headers["last-modified"]
    versioned = client.get(f"/covers/{VID}?v=abc&r=3", headers=H)
    assert versioned.content == b"jpg"
    assert versioned.headers["cache-control"] == IMMUTABLE
    assert versioned.headers["vary"] == "Cookie, Authorization"


def test_original_answers_conditional_requests_with_304(client, song):
    first = client.get(f"/covers/{VID}", headers=H)
    etag, modified = first.headers["etag"], first.headers["last-modified"]
    by_tag = client.get(f"/covers/{VID}", headers={**H, "If-None-Match": etag})
    assert by_tag.status_code == 304 and by_tag.content == b""
    assert by_tag.headers["cache-control"] == HOUR and by_tag.headers["etag"] == etag
    assert client.get(f"/covers/{VID}", headers={**H, "If-None-Match": '"other"'}).status_code == 200
    assert client.get(f"/covers/{VID}", headers={**H, "If-Modified-Since": modified}).status_code == 304
    assert client.get(f"/covers/{VID}", headers={**H, "If-Modified-Since": "Mon, 01 Jan 2001 00:00:00 GMT"}).status_code == 200
    assert client.get(f"/covers/{VID}", headers={**H, "If-Modified-Since": "garbage"}).status_code == 200
    assert client.get(f"/covers/{VID}", headers={**H, "If-None-Match": '"other"', "If-Modified-Since": modified}).status_code == 200


def test_a_replaced_cover_changes_the_validator(client, song):
    before = client.get(f"/covers/{VID}", headers=H).headers["etag"]
    put(client, photo(), "image/jpeg")
    after = client.get(f"/covers/{VID}", headers=H)
    assert after.headers["etag"] != before
    assert client.get(f"/covers/{VID}", headers={**H, "If-None-Match": before}).status_code == 200


def test_other_sizes_snap_to_the_nearest_allowed(client, song):
    put(client, photo(), "image/jpeg")
    for asked, got in ((1, 96), (100, 96), (150, 192), (260, 320), (5000, 320)):
        assert dims(client.get(f"/covers/{VID}?size={asked}", headers=H).content) == (got, got)
    assert client.get(f"/covers/{VID}?size=0", headers=H).status_code == 400
    assert client.get(f"/covers/{VID}?size=-5", headers=H).status_code == 400
    assert client.get(f"/covers/{VID}?size=big", headers=H).status_code == 422


def test_centre_crop_keeps_the_middle(client, song):
    wide = Image.new("RGB", (400, 200), (255, 0, 0))
    wide.paste((0, 0, 255), (100, 0, 300, 200))
    buf = io.BytesIO()
    wide.save(buf, "PNG")
    put(client, buf.getvalue())
    img = Image.open(io.BytesIO(client.get(f"/covers/{VID}?size=96", headers=H).content)).convert("RGB")
    for x in (2, 48, 93):
        r, g, b = img.getpixel((x, 48))
        assert b > 200 and r < 60


def test_a_small_original_is_cropped_but_not_enlarged(client, song):
    put(client, photo((120, 80)), "image/jpeg")
    assert dims(client.get(f"/covers/{VID}?size=320", headers=H).content) == (80, 80)


def test_caching_headers_depend_on_the_version_query(client, song):
    put(client, photo(), "image/jpeg")
    plain = client.get(f"/covers/{VID}?size=192", headers=H)
    assert plain.headers["cache-control"] == HOUR
    assert plain.headers["etag"]
    assert client.get(f"/covers/{VID}?size=192", headers={**H, "If-None-Match": plain.headers["etag"]}).status_code == 304
    versioned = client.get(f"/covers/{VID}?size=192&v=abc&r=2", headers=H)
    assert versioned.headers["cache-control"] == IMMUTABLE
    assert versioned.content == plain.content


def test_second_request_is_a_cache_hit(client, song, tmp_path, monkeypatch):
    put(client, photo(), "image/jpeg")
    first = client.get(f"/covers/{VID}?size=96", headers=H).content
    assert len(thumb_files(tmp_path)) == 1
    monkeypatch.setattr(thumbs, "render", lambda *a: pytest.fail("rendered again"))
    assert client.get(f"/covers/{VID}?size=96", headers=H).content == first
    assert len(thumb_files(tmp_path)) == 1


def test_a_new_cover_drops_the_cached_thumbnails(client, song, tmp_path):
    put(client, photo(seed=1), "image/jpeg")
    before = client.get(f"/covers/{VID}?size=96", headers=H).content
    client.get(f"/covers/{VID}?size=320", headers=H)
    assert len(thumb_files(tmp_path)) == 2
    put(client, photo(seed=2), "image/jpeg")
    assert thumb_files(tmp_path) == []
    after = client.get(f"/covers/{VID}?size=96", headers=H).content
    assert after != before
    assert len(thumb_files(tmp_path)) == 1


def test_delete_and_default_drop_the_thumbnails(client, song, tmp_path):
    put(client, photo(), "image/jpeg")
    client.get(f"/covers/{VID}?size=96", headers=H)
    assert client.delete(f"/songs/{VID}/cover", headers=H).status_code == 204
    assert thumb_files(tmp_path) == []
    assert client.get(f"/covers/{VID}?size=96", headers=H).content == b"jpg"
    put(client, photo(), "image/jpeg")
    client.get(f"/covers/{VID}?size=96", headers=H)
    r = client.put(f"/songs/{VID}/cover", json={"default": True}, headers=H)
    assert r.status_code == 200
    assert thumb_files(tmp_path) == []
    assert client.get(f"/covers/{VID}?size=96", headers=H).status_code == 404


def test_changed_original_is_rebuilt_even_without_the_drop(client, song, tmp_path):
    put(client, photo(seed=1), "image/jpeg")
    before = client.get(f"/covers/{VID}?size=96", headers=H).content
    path = deps.covers_dir(next(p.name for p in (tmp_path / "users").iterdir())) / f"{VID}.jpg"
    path.write_bytes(photo(seed=3))
    assert client.get(f"/covers/{VID}?size=96", headers=H).content != before
    assert len(thumb_files(tmp_path)) == 1


def test_unreadable_or_huge_originals_fall_back_to_the_original(client, song, monkeypatch):
    assert client.get(f"/covers/{VID}?size=96", headers=H).content == b"jpg"
    put(client, photo(), "image/jpeg")
    monkeypatch.setattr(thumbs, "MAX_SOURCE_BYTES", 10)
    big = client.get(f"/covers/{VID}?size=96", headers=H)
    assert big.content == client.get(f"/covers/{VID}", headers=H).content
    assert big.headers["cache-control"] == HOUR


def test_unwritable_cache_still_answers(client, song, tmp_path, monkeypatch):
    put(client, photo(), "image/jpeg")
    blocker = tmp_path / "blocker"
    blocker.write_text("x")
    monkeypatch.setenv("AUDIO_CACHE_DIR", str(blocker))
    r = client.get(f"/covers/{VID}?size=96", headers=H)
    assert r.status_code == 200 and r.content == client.get(f"/covers/{VID}", headers=H).content


def test_auth_and_ids_are_checked_as_for_the_original(client, song):
    put(client, photo(), "image/jpeg")
    assert client.get(f"/covers/{VID}?size=96").status_code == 401
    assert client.get(f"/covers/{VID}?size=96&token=secret").status_code == 200
    assert client.get("/covers/aaaaaaaaaaa?size=96", headers=H).status_code == 404
    assert client.get("/covers/..%2F..%2Fetc?size=96", headers=H).status_code in (404, 422)
    assert client.get("/covers/bad%20id?size=96", headers=H).status_code == 422


def test_cache_dir_is_outside_the_synced_trees(tmp_path, monkeypatch):
    monkeypatch.setattr(deps, "DOWNLOAD_DIR", tmp_path / "dl")
    monkeypatch.delenv("AUDIO_CACHE_DIR", raising=False)
    assert thumbs.cache_root() == tmp_path / "dl" / ".cache" / "thumbs"
    monkeypatch.setenv("AUDIO_CACHE_DIR", str(tmp_path / "c"))
    assert thumbs.cache_root() == tmp_path / "c" / "thumbs"
    assert thumbs.thumbnail("../x", VID, tmp_path, 96) is None
