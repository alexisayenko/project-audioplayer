import io
import json

import pytest
from PIL import Image

from app import coverimg, deps
from tests.test_library import H, ODIR, VID, add, client  # noqa: F401


def image(fmt="PNG", size=(40, 30), mode="RGB"):
    buf = io.BytesIO()
    Image.new(mode, size, "red").save(buf, fmt)
    return buf.getvalue()


def put(client, data, kind="image/png", vid=VID):
    return client.put(f"/songs/{vid}/cover", content=data, headers={**H, "Content-Type": kind})


def stored(tmp_path):
    return json.loads((ODIR(tmp_path) / "library.json").read_text())["songs"][0]


@pytest.fixture
def song(client):
    assert add(client, audio=False).status_code == 201


def test_upload_png_is_stored_as_jpeg_with_a_version(client, song, tmp_path):
    r = put(client, image("PNG", (3000, 1000)))
    assert r.status_code == 200
    body = r.json()
    assert body["cover"] == f"covers/{VID}.jpg"
    assert len(body["cover_v"]) == 10
    got = client.get(f"/covers/{VID}", headers=H)
    assert got.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(got.content)) as img:
        assert img.format == "JPEG"
        assert max(img.size) == 1024
    assert stored(tmp_path)["cover_v"] == body["cover_v"]
    assert client.get("/library", headers=H).json()["songs"][0]["cover_v"] == body["cover_v"]


def test_version_changes_with_the_image(client, song):
    a = put(client, image("PNG")).json()["cover_v"]
    b = put(client, image("WEBP", (60, 60))).json()["cover_v"]
    assert a != b


def test_transparent_png_and_webp_decode(client, song):
    assert put(client, image("PNG", mode="RGBA")).status_code == 200
    assert put(client, image("WEBP"), "image/webp").status_code == 200


def test_delete_clears_the_cover_and_is_idempotent(client, song, tmp_path):
    assert client.delete(f"/songs/{VID}/cover", headers=H).status_code == 204
    assert client.delete(f"/songs/{VID}/cover", headers=H).status_code == 204
    assert client.get(f"/covers/{VID}", headers=H).status_code == 404
    rec = stored(tmp_path)
    assert rec["cover"] is None
    assert rec["cover_v"] is None
    assert rec["cover_off"] is True
    assert put(client, image()).json()["cover_off"] is None


def test_bad_inputs(client, song):
    assert put(client, image(), "text/plain").status_code == 415
    assert put(client, image("GIF"), "image/png").json()["error"] == "cover_bad_type"
    bad = put(client, b"not an image at all")
    assert bad.status_code == 422
    assert bad.json()["error"] == "cover_bad_image"
    assert put(client, b"<svg xmlns='http://www.w3.org/2000/svg'/>").status_code == 422
    assert put(client, image(), vid="aaaaaaaaaaa").status_code == 404
    assert put(client, image(), vid="bad id").status_code in (404, 422)


def test_too_large_is_refused_by_header_and_by_stream(client, song, monkeypatch):
    monkeypatch.setattr(coverimg, "MAX_BYTES", 1000)
    big = image("PNG", (200, 200))
    assert len(big) > 0
    noisy = b"\x89PNG" + bytes(2000)
    r = put(client, noisy)
    assert r.status_code == 413
    assert r.json()["error"] == "cover_too_large"

    def chunks():
        yield bytes(600)
        yield bytes(600)

    r = client.put(f"/songs/{VID}/cover", content=chunks(), headers={**H, "Content-Type": "image/png"})
    assert r.status_code == 413


def test_requires_auth(client, song):
    assert client.put(f"/songs/{VID}/cover", content=image(), headers={"Content-Type": "image/png"}).status_code == 401
    assert client.delete(f"/songs/{VID}/cover").status_code == 401
    assert client.post(f"/songs/{VID}/cover/from-url", json={"url": "http://x.example/a.png"}).status_code == 401


def test_cover_changes_do_not_touch_audio_quota(client, song):
    before = client.get("/me/usage", headers=H).json()["bytes"]
    put(client, image())
    assert client.get("/me/usage", headers=H).json()["bytes"] == before


# --- from-url -----------------------------------------------------------------------------

def reply(status=200, body=b"", ctype="image/png", location=""):
    return coverimg.Reply(status, location, ctype, body)


@pytest.fixture
def web(monkeypatch):
    """Pretend DNS and HTTP: `hosts` maps names to IPs, `pages` maps URL paths to replies; records every connection."""
    calls = []
    hosts = {"img.example": "93.184.216.34", "evil.example": "10.0.0.5", "meta.example": "169.254.169.254", "localhost": "127.0.0.1"}
    pages = {}

    def getaddrinfo(host, port, type=0):
        if host not in hosts:
            raise OSError("no such host")
        return [(2, 1, 6, "", (hosts[host], port))]

    def http_get(scheme, host, port, path, ip):
        calls.append((scheme, host, port, path, ip))
        return pages[(host, path)]

    monkeypatch.setattr(coverimg.socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(coverimg, "http_get", http_get)
    return type("Web", (), {"calls": calls, "pages": pages, "hosts": hosts})


def from_url(client, url):
    return client.post(f"/songs/{VID}/cover/from-url", json={"url": url}, headers=H)


def test_from_url_stores_the_image_and_connects_to_the_checked_ip(client, song, web):
    web.pages[("img.example", "/a.png?x=1")] = reply(body=image())
    r = from_url(client, "https://img.example/a.png?x=1")
    assert r.status_code == 200
    assert r.json()["cover_v"]
    assert web.calls == [("https", "img.example", 443, "/a.png?x=1", "93.184.216.34")]
    assert client.get(f"/covers/{VID}", headers=H).status_code == 200


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/a.png", "http://localhost:80/a.png", "http://[::1]/a.png", "http://169.254.169.254/latest/meta-data",
    "http://10.1.2.3/a.png", "http://192.168.1.1/a.png", "http://172.16.0.9/a.png", "http://0.0.0.0/a.png",
    "http://[::ffff:127.0.0.1]/a.png", "http://100.64.0.1/a.png", "http://evil.example/a.png", "http://meta.example/a.png",
    "file:///etc/passwd", "ftp://img.example/a.png", "gopher://img.example/", "javascript:alert(1)", "img.example/a.png", "",
    "http://user:pw@img.example/a.png", "http://img.example:22/a.png", "http://img.example:8080/a.png",
])
def test_ssrf_refusals_never_connect(client, song, web, url):
    r = from_url(client, url)
    assert r.status_code == 422
    assert r.json()["error"] == "cover_url_refused"
    assert web.calls == []


def test_redirect_to_private_address_is_refused(client, song, web):
    web.pages[("img.example", "/a.png")] = reply(302, location="http://169.254.169.254/latest/meta-data")
    r = from_url(client, "http://img.example/a.png")
    assert r.status_code == 422
    assert r.json()["error"] == "cover_url_refused"
    assert len(web.calls) == 1


def test_redirect_to_private_host_name_is_refused(client, song, web):
    web.pages[("img.example", "/a.png")] = reply(301, location="http://evil.example/x.png")
    assert from_url(client, "http://img.example/a.png").status_code == 422
    assert len(web.calls) == 1


def test_relative_redirect_is_followed_and_loops_are_cut(client, song, web):
    web.pages[("img.example", "/a")] = reply(302, location="/b.png")
    web.pages[("img.example", "/b.png")] = reply(body=image())
    assert from_url(client, "http://img.example/a").status_code == 200
    web.pages[("img.example", "/loop")] = reply(302, location="/loop")
    r = from_url(client, "http://img.example/loop")
    assert r.status_code == 422
    assert "redirects" in r.json()["detail"]
    assert len(web.calls) == 2 + coverimg.MAX_REDIRECTS + 1


def test_from_url_errors(client, song, web):
    web.pages[("img.example", "/html")] = reply(body=b"<html>", ctype="text/html")
    assert from_url(client, "http://img.example/html").json()["error"] == "cover_bad_type"
    web.pages[("img.example", "/svg")] = reply(body=b"<svg/>", ctype="image/svg+xml")
    assert from_url(client, "http://img.example/svg").status_code == 415
    web.pages[("img.example", "/fake")] = reply(body=b"junk junk", ctype="image/png")
    assert from_url(client, "http://img.example/fake").json()["error"] == "cover_bad_image"
    web.pages[("img.example", "/404")] = reply(404)
    r = from_url(client, "http://img.example/404")
    assert r.status_code == 502
    assert r.json()["error"] == "cover_url_unreachable"
    assert from_url(client, "http://nohost.example/a").status_code == 502


def test_from_url_too_large(client, song, web, monkeypatch):
    monkeypatch.setattr(coverimg, "MAX_BYTES", 100)
    web.pages[("img.example", "/big")] = reply(body=bytes(101))
    r = from_url(client, "http://img.example/big")
    assert r.status_code == 413
    assert r.json()["error"] == "cover_too_large"


def test_connection_failure_is_unreachable(client, song, web, monkeypatch):
    def boom(*a):
        raise OSError("refused")

    monkeypatch.setattr(coverimg, "http_get", boom)
    assert from_url(client, "http://img.example/a.png").json()["error"] == "cover_url_unreachable"


def test_from_url_unknown_song_and_bad_body(client, web):
    assert from_url(client, "http://img.example/a.png").status_code == 404
    assert client.post(f"/songs/{VID}/cover/from-url", json={}, headers=H).status_code == 422


def test_http_get_reads_a_real_local_server(monkeypatch):
    import http.server
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "image/png; charset=x")
            self.end_headers()
            self.wfile.write(b"abc")

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        got = coverimg.http_get("http", "x.example", srv.server_address[1], "/", "127.0.0.1")
    finally:
        srv.shutdown()
    assert (got.status, got.content_type, got.body) == (200, "image/png", b"abc")


def test_resolve_public_rejects_mixed_answers(monkeypatch):
    monkeypatch.setattr(coverimg.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 80)), (2, 1, 6, "", ("10.0.0.1", 80))])
    with pytest.raises(coverimg.Problem) as exc:
        coverimg.resolve_public("x.example", 80)
    assert exc.value.code == "cover_url_refused"


# --- cover_source, JSON / multipart PUT, suggestions, rate limit ------------------------------

import urllib.parse  # noqa: E402

from app import downloads, wiki_lookup  # noqa: E402
from app.routes import covers as covers_route  # noqa: E402


def put_json(client, body, vid=VID):
    return client.put(f"/songs/{vid}/cover", json=body, headers=H)


def multipart(data, name="file", kind="image/png"):
    boundary = "XBOUNDARYX"
    head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="a.png"\r\nContent-Type: {kind}\r\n\r\n'.encode()
    body = head + data + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def put_multipart(client, data, **kw):
    body, ctype = multipart(data, **kw)
    return client.put(f"/songs/{VID}/cover", content=body, headers={**H, "Content-Type": ctype})


def test_upload_marks_the_cover_custom(client, song, tmp_path):
    assert put(client, image()).json()["cover_source"] == "custom"
    assert stored(tmp_path)["cover_source"] == "custom"


def test_multipart_upload_is_stored(client, song):
    r = put_multipart(client, image("PNG", (50, 50)))
    assert r.status_code == 200
    assert r.json()["cover_source"] == "custom"
    assert len(r.json()["cover_v"]) == 10


def test_multipart_without_file_part_or_with_bad_image(client, song):
    assert put_multipart(client, image(), name="other").json()["error"] == "cover_no_file"
    assert put_multipart(client, b"not an image").json()["error"] == "cover_bad_image"
    assert put_multipart(client, image("GIF")).json()["error"] == "cover_bad_type"


def test_multipart_too_large(client, song, monkeypatch):
    monkeypatch.setattr(coverimg, "MAX_BYTES", 1000)
    monkeypatch.setattr(covers_route, "MULTIPART_OVERHEAD", 200)
    assert put_multipart(client, bytes(5000)).status_code == 413


def test_json_url_downloads_and_stores(client, song, web):
    web.pages[("img.example", "/a.png")] = reply(body=image())
    r = put_json(client, {"url": "https://img.example/a.png"})
    assert r.status_code == 200
    assert r.json()["cover_source"] == "custom"
    assert web.calls == [("https", "img.example", 443, "/a.png", "93.184.216.34")]


@pytest.mark.parametrize("url", ["http://127.0.0.1/a.png", "http://meta.example/x", "file:///etc/passwd", "http://10.0.0.1/a.png"])
def test_json_url_ssrf_refused(client, song, web, url):
    r = put_json(client, {"url": url})
    assert r.status_code == 422
    assert r.json()["error"] == "cover_url_refused"
    assert web.calls == []


def test_json_url_non_image_and_oversize(client, song, web, monkeypatch):
    web.pages[("img.example", "/p")] = reply(body=b"<html>", ctype="text/html")
    assert put_json(client, {"url": "https://img.example/p"}).status_code == 415
    monkeypatch.setattr(coverimg, "MAX_BYTES", 10)
    web.pages[("img.example", "/big")] = reply(body=bytes(11))
    assert put_json(client, {"url": "https://img.example/big"}).status_code == 413


def test_json_bad_bodies(client, song):
    assert put_json(client, {}).status_code == 422
    assert put_json(client, {"url": 5}).status_code == 422
    assert put_json(client, {"default": False}).status_code == 422
    assert put_json(client, [1]).status_code == 422
    r = client.put(f"/songs/{VID}/cover", content=b"{oops", headers={**H, "Content-Type": "application/json"})
    assert r.status_code == 400
    assert r.json()["error"] == "cover_bad_body"
    assert put_json(client, {"default": True}, vid="aaaaaaaaaaa").status_code == 404


def test_default_pin_removes_the_file_and_survives_audio_fetch(client, song, tmp_path, monkeypatch):
    put(client, image())
    r = put_json(client, {"default": True})
    assert r.status_code == 200
    body = r.json()
    assert body["cover_source"] == "default"
    assert body["cover"] is None
    assert body["cover_v"] is None
    assert client.get(f"/covers/{VID}", headers=H).status_code == 404
    fetched = []
    monkeypatch.setattr(downloads, "_fetch_cover", lambda uid, vid, thumb: fetched.append(vid) or f"covers/{vid}.jpg")
    assert client.post(f"/songs/{VID}/audio", headers=H).status_code == 202
    rec = stored(tmp_path)
    assert rec["cover_source"] == "default"
    assert not rec.get("cover")
    assert fetched == []


def test_custom_cover_survives_audio_fetch(client, song, tmp_path):
    cv = put(client, image()).json()["cover_v"]
    assert client.post(f"/songs/{VID}/audio", headers=H).status_code == 202
    rec = stored(tmp_path)
    assert rec["cover_source"] == "custom"
    assert rec["cover_v"] == cv


def test_delete_resets_custom_to_automatic_and_bumps_the_version(client, song, tmp_path):
    custom = put(client, image()).json()["cover_v"]
    assert client.delete(f"/songs/{VID}/cover", headers=H).status_code == 204
    rec = stored(tmp_path)
    assert "cover_source" not in rec
    assert rec["cover"] == f"covers/{VID}.jpg"
    assert rec["cover_v"] and rec["cover_v"] != custom
    assert not rec.get("cover_off")
    assert client.get(f"/covers/{VID}", headers=H).content == b"jpg"


def test_delete_resets_default_to_automatic(client, song, tmp_path):
    put_json(client, {"default": True})
    assert client.delete(f"/songs/{VID}/cover", headers=H).status_code == 204
    rec = stored(tmp_path)
    assert "cover_source" not in rec
    assert rec["cover"] == f"covers/{VID}.jpg"


def test_delete_reset_without_an_automatic_cover_leaves_none(client, song, tmp_path, monkeypatch):
    put(client, image())
    monkeypatch.setattr(downloads, "fetch_cover_bytes", lambda uid, vid: None)
    assert client.delete(f"/songs/{VID}/cover", headers=H).status_code == 204
    rec = stored(tmp_path)
    assert rec["cover"] is None
    assert rec["cover_v"] is None
    assert not rec.get("cover_off")
    assert "cover_source" not in rec
    assert client.get(f"/covers/{VID}", headers=H).status_code == 404


def test_delete_unknown_song_is_404(client, song):
    assert client.delete("/songs/aaaaaaaaaaa/cover", headers=H).status_code == 404


def wiki_api(pages):
    def fetch(url):
        for key, found in pages.items():
            if url.endswith("titles=" + urllib.parse.quote(key, safe="")):
                return {"query": {"pages": [found]}}
        return {"query": {"pages": [{"title": "x", "missing": True}]}}
    return fetch


def page(title, name, width=1024, height=1024):
    return {"title": title, "fullurl": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
            "thumbnail": {"source": f"https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/{name}/1024px-{name}", "width": width, "height": height}}


def link(client, **fields):
    assert client.patch(f"/songs/{VID}", json=fields, headers=H).status_code == 200


def test_suggestions_empty_without_links(client, song):
    r = client.get(f"/songs/{VID}/cover/suggestions", headers=H)
    assert r.status_code == 200
    assert r.json() == {"suggestions": []}


def test_suggestions_from_song_and_album_pages(client, song, monkeypatch):
    link(client, wikipedia_song="https://en.wikipedia.org/wiki/Some_Song", wikipedia_album="https://en.wikipedia.org/wiki/Some_Album")
    wiki_lookup._cover_cache.clear()
    monkeypatch.setattr(wiki_lookup, "_fetch_json", wiki_api({"Some_Song": page("Some Song", "Song.jpg"), "Some_Album": page("Some Album", "Album.jpg", 800, None)}))
    got = client.get(f"/songs/{VID}/cover/suggestions", headers=H).json()["suggestions"]
    assert [s["title"] for s in got] == ["Some Song", "Some Album"]
    first = got[0]
    assert first["url"].startswith("https://upload.wikimedia.org/") and "/1024px-" in first["url"]
    assert "/240px-" in first["thumb"]
    assert first["source"] == "wikipedia"
    assert first["page"] == "https://en.wikipedia.org/wiki/Some_Song"
    assert (first["width"], first["height"]) == (1024, 1024)
    assert (got[1]["width"], got[1]["height"]) == (800, None)


def test_suggestions_dedupe_skip_failures_and_cache(client, song, monkeypatch):
    link(client, wikipedia_song="https://en.wikipedia.org/wiki/Same", wikipedia_album="https://en.wikipedia.org/wiki/Same_Too")
    wiki_lookup._cover_cache.clear()
    calls = []
    same = page("Same", "Cover.jpg")

    def fetch(url):
        calls.append(url)
        return {"query": {"pages": [same]}}

    monkeypatch.setattr(wiki_lookup, "_fetch_json", fetch)
    assert len(client.get(f"/songs/{VID}/cover/suggestions", headers=H).json()["suggestions"]) == 1
    n = len(calls)
    client.get(f"/songs/{VID}/cover/suggestions", headers=H)
    assert len(calls) == n

    wiki_lookup._cover_cache.clear()

    def boom(url):
        raise OSError("down")

    monkeypatch.setattr(wiki_lookup, "_fetch_json", boom)
    assert client.get(f"/songs/{VID}/cover/suggestions", headers=H).json() == {"suggestions": []}


def test_suggestions_ignore_non_https_images_and_missing_thumbnails(client, song, monkeypatch):
    link(client, wikipedia_song="https://en.wikipedia.org/wiki/A", wikipedia_album="https://en.wikipedia.org/wiki/B")
    wiki_lookup._cover_cache.clear()
    plain = {"title": "A"}
    insecure = {"title": "B", "thumbnail": {"source": "http://upload.wikimedia.org/x.jpg", "width": 1, "height": 1}}
    monkeypatch.setattr(wiki_lookup, "_fetch_json", wiki_api({"A": plain, "B": insecure}))
    assert client.get(f"/songs/{VID}/cover/suggestions", headers=H).json() == {"suggestions": []}


def test_suggestions_are_capped_at_four(client, song, monkeypatch):
    link(client, wikipedia_song="https://en.wikipedia.org/wiki/A")
    monkeypatch.setattr(wiki_lookup, "cover_candidates", lambda links: [{"url": f"https://u/{i}"} for i in range(9)])
    assert len(client.get(f"/songs/{VID}/cover/suggestions", headers=H).json()["suggestions"]) == 4


def test_suggestions_unknown_song_and_auth(client, song):
    assert client.get("/songs/aaaaaaaaaaa/cover/suggestions", headers=H).status_code == 404
    assert client.get(f"/songs/{VID}/cover/suggestions").status_code == 401


def test_put_json_requires_auth(client, song):
    assert client.put(f"/songs/{VID}/cover", json={"default": True}).status_code == 401


def test_non_owner_fetches_are_rate_limited():
    covers_route.reset_limits()
    user = {"uid": "u1", "owner": False}
    for _ in range(30):
        covers_route._charge(covers_route._fetches, user)
    with pytest.raises(covers_route.Problem) as exc:
        covers_route._charge(covers_route._fetches, user)
    assert exc.value.status == 429
    assert exc.value.code == "cover_limit"
    covers_route._charge(covers_route._fetches, {"uid": "u1", "owner": True})
    covers_route.reset_limits()


SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/"


def routed(routes, calls=None):
    def fetch(url):
        if calls is not None:
            calls.append(url)
        for marker, answer in routes:
            if marker in url:
                if isinstance(answer, Exception):
                    raise answer
                return answer
        return {"query": {"pages": [{"title": "x", "missing": True}]}}
    return fetch


def summary(title, thumb=None, original=None):
    doc = {"title": title, "content_urls": {"desktop": {"page": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"}}}
    if thumb:
        doc["thumbnail"] = {"source": thumb[0], "width": thumb[1], "height": thumb[2]}
    if original:
        doc["originalimage"] = {"source": original[0], "width": original[1], "height": original[2]}
    return doc


NONFREE = "https://upload.wikimedia.org/wikipedia/en/b/b7/Birdy-Wings.png"
NONFREE_THUMB = "https://upload.wikimedia.org/wikipedia/en/thumb/b/b7/Birdy-Wings.png/250px-Birdy-Wings.png"


def test_api_202_summary_gives_non_free_cover_with_parenthesised_title(monkeypatch):
    wiki_lookup._cover_cache.clear()
    calls = []
    doc = summary("Wings (Birdy song)", (NONFREE_THUMB, 250, 250), (NONFREE, 300, 300))
    monkeypatch.setattr(wiki_lookup, "_fetch_json", routed([("rest_v1/page/summary/Wings_%28Birdy_song%29", doc)], calls))
    got = wiki_lookup.cover_candidates(["https://en.wikipedia.org/wiki/Wings_(Birdy_song)#Background"])
    assert len(got) == 1
    assert got[0]["url"] == NONFREE and got[0]["thumb"] == NONFREE_THUMB
    assert got[0]["title"] == "Wings (Birdy song)" and got[0]["page"] == "https://en.wikipedia.org/wiki/Wings_(Birdy_song)"
    assert (got[0]["width"], got[0]["height"]) == (300, 300)
    assert len(calls) == 1


def test_api_202_summary_large_original_is_rescaled_from_the_thumbnail(monkeypatch):
    wiki_lookup._cover_cache.clear()
    big = "https://upload.wikimedia.org/wikipedia/en/c/cd/Big.jpg"
    thumb = "https://upload.wikimedia.org/wikipedia/en/thumb/c/cd/Big.jpg/320px-Big.jpg"
    monkeypatch.setattr(wiki_lookup, "_fetch_json", routed([("rest_v1/page/summary/", summary("Big", (thumb, 320, 320), (big, 3000, 3000)))]))
    got = wiki_lookup.cover_candidates(["https://de.wikipedia.org/wiki/Big"])
    assert got[0]["url"].endswith("/1024px-Big.jpg") and got[0]["thumb"] == thumb
    assert (got[0]["width"], got[0]["height"]) == (1024, 1024)


def test_api_202_pageimages_used_when_summary_has_no_image(monkeypatch):
    wiki_lookup._cover_cache.clear()
    monkeypatch.setattr(wiki_lookup, "_fetch_json", routed([
        ("rest_v1/page/summary/", {"title": "Some Song"}),
        ("prop=pageimages", {"query": {"pages": [page("Some Song", "Song.jpg")]}}),
    ]))
    got = wiki_lookup.cover_candidates(["https://en.wikipedia.org/wiki/Some_Song"])
    assert got[0]["url"].endswith("/1024px-Song.jpg") and "/240px-" in got[0]["thumb"]


def test_api_202_summary_failure_falls_through_to_pageimages(monkeypatch):
    wiki_lookup._cover_cache.clear()
    monkeypatch.setattr(wiki_lookup, "_fetch_json", routed([
        ("rest_v1/page/summary/", OSError("404")),
        ("prop=pageimages", {"query": {"pages": [page("Some Song", "Song.jpg")]}}),
    ]))
    assert len(wiki_lookup.cover_candidates(["https://en.wikipedia.org/wiki/Some_Song"])) == 1


def test_api_202_file_list_fallback_skips_icons_and_resolves_the_cover(monkeypatch):
    wiki_lookup._cover_cache.clear()
    images = [{"ns": 6, "title": t} for t in ("File:Commons-logo.svg", "File:Flag of Ireland.svg", "File:Edit-clear.svg", "File:Question book-new.svg", "File:Birdy-Wings.png")]
    info = {"imageinfo": [{"url": NONFREE, "width": 300, "height": 300, "thumburl": NONFREE, "thumbwidth": 300, "thumbheight": 300}]}
    monkeypatch.setattr(wiki_lookup, "_fetch_json", routed([
        ("rest_v1/page/summary/", {"title": "Wings (Birdy song)"}),
        ("prop=pageimages", {"query": {"pages": [{"title": "Wings (Birdy song)"}]}}),
        ("prop=images", {"query": {"pages": [{"title": "Wings (Birdy song)", "images": images}]}}),
        ("prop=imageinfo", {"query": {"pages": [info]}}),
    ]))
    got = wiki_lookup.cover_candidates(["https://en.wikipedia.org/wiki/Wings_(Birdy_song)"])
    assert [g["url"] for g in got] == [NONFREE] and (got[0]["width"], got[0]["height"]) == (300, 300)


def test_api_202_no_image_anywhere_is_an_empty_list(monkeypatch):
    wiki_lookup._cover_cache.clear()
    images = [{"ns": 6, "title": "File:Commons-logo.svg"}, {"ns": 6, "title": "File:Unrelated photo.jpg"}]
    monkeypatch.setattr(wiki_lookup, "_fetch_json", routed([
        ("rest_v1/page/summary/", {"title": "Plain"}),
        ("prop=images", {"query": {"pages": [{"title": "Plain", "images": images}]}}),
    ]))
    assert wiki_lookup.cover_candidates(["https://en.wikipedia.org/wiki/Plain"]) == []


def test_api_202_tracking_params_are_stripped_from_image_urls(monkeypatch):
    wiki_lookup._cover_cache.clear()
    tracked = NONFREE + "?utm_source=x&keep=1"
    monkeypatch.setattr(wiki_lookup, "_fetch_json", routed([("rest_v1/page/summary/", summary("T", None, (tracked, 300, 300)))]))
    assert wiki_lookup.cover_candidates(["https://en.wikipedia.org/wiki/T"])[0]["url"] == NONFREE + "?keep=1"


def test_wikimedia_hosts_get_the_descriptive_user_agent(monkeypatch):
    seen = {}

    def fake(url, timeout, params=None, form=None, headers=None):
        seen[url] = headers
        return {}

    monkeypatch.setattr(wiki_lookup.httpjson, "http_json", fake)
    wiki_lookup._fetch_json("https://en.wikipedia.org/api/rest_v1/page/summary/X")
    wiki_lookup._fetch_json("https://www.wikidata.org/w/api.php")
    wiki_lookup._fetch_json("https://example.com/x")
    assert seen["https://en.wikipedia.org/api/rest_v1/page/summary/X"] == {"User-Agent": "Electrophone/1.0 (https://electrophone.cc)"}
    assert seen["https://www.wikidata.org/w/api.php"]["User-Agent"].startswith("Electrophone/")
    assert seen["https://example.com/x"] is None


def test_cover_fetch_uses_wikimedia_user_agent_and_drops_utm():
    assert coverimg.user_agent_for("upload.wikimedia.org") == "Electrophone/1.0 (https://electrophone.cc)"
    assert coverimg.user_agent_for("thumb.wikimedia.org") == "Electrophone/1.0 (https://electrophone.cc)"
    assert coverimg.user_agent_for("example.com") == coverimg.USER_AGENT
    assert coverimg.parse_url(NONFREE + "?utm_medium=a&x=1")[3].endswith("Birdy-Wings.png?x=1")
    assert coverimg.parse_url(NONFREE + "?utm_medium=a")[3].endswith("Birdy-Wings.png")
