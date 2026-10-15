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
    assert body["cover"] == f"covers/{VID}.jpg" and len(body["cover_v"]) == 10
    got = client.get(f"/covers/{VID}", headers=H)
    assert got.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(got.content)) as img:
        assert img.format == "JPEG" and max(img.size) == 1024
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
    put(client, image())
    assert client.delete(f"/songs/{VID}/cover", headers=H).status_code == 204
    assert client.delete(f"/songs/{VID}/cover", headers=H).status_code == 204
    assert client.get(f"/covers/{VID}", headers=H).status_code == 404
    rec = stored(tmp_path)
    assert rec["cover"] is None and rec["cover_v"] is None and rec["cover_off"] is True
    assert put(client, image()).json()["cover_off"] is None


def test_bad_inputs(client, song):
    assert put(client, image(), "text/plain").status_code == 415
    assert put(client, image("GIF"), "image/png").json()["error"] == "cover_bad_type"
    bad = put(client, b"not an image at all")
    assert bad.status_code == 422 and bad.json()["error"] == "cover_bad_image"
    assert put(client, b"<svg xmlns='http://www.w3.org/2000/svg'/>").status_code == 422
    assert put(client, image(), vid="aaaaaaaaaaa").status_code == 404
    assert put(client, image(), vid="bad id").status_code in (404, 422)


def test_too_large_is_refused_by_header_and_by_stream(client, song, monkeypatch):
    monkeypatch.setattr(coverimg, "MAX_BYTES", 1000)
    big = image("PNG", (200, 200))
    assert len(big) > 0
    noisy = b"\x89PNG" + bytes(2000)
    r = put(client, noisy)
    assert r.status_code == 413 and r.json()["error"] == "cover_too_large"

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
    assert r.status_code == 200 and r.json()["cover_v"]
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
    assert r.status_code == 422 and r.json()["error"] == "cover_url_refused"
    assert web.calls == []


def test_redirect_to_private_address_is_refused(client, song, web):
    web.pages[("img.example", "/a.png")] = reply(302, location="http://169.254.169.254/latest/meta-data")
    r = from_url(client, "http://img.example/a.png")
    assert r.status_code == 422 and r.json()["error"] == "cover_url_refused"
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
    assert r.status_code == 422 and "redirects" in r.json()["detail"]
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
    assert r.status_code == 502 and r.json()["error"] == "cover_url_unreachable"
    assert from_url(client, "http://nohost.example/a").status_code == 502


def test_from_url_too_large(client, song, web, monkeypatch):
    monkeypatch.setattr(coverimg, "MAX_BYTES", 100)
    web.pages[("img.example", "/big")] = reply(body=bytes(101))
    r = from_url(client, "http://img.example/big")
    assert r.status_code == 413 and r.json()["error"] == "cover_too_large"


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
    with pytest.raises(Exception) as exc:
        coverimg.resolve_public("x.example", 80)
    assert exc.value.code == "cover_url_refused"
