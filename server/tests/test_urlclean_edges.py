import http.server
import random
import string
import threading
from types import SimpleNamespace

import pytest

from app import urlclean

VID = "dQw4w9WgXcQ"


@pytest.mark.parametrize("sid,ok", [
    (VID, True), ("soundcloud-123", True), ("spotify-4uLU6hMCjMI75M1A2tKUQC", True), ("applemusic-1", True), ("shazam-x_y", True),
    ("", False), ("short", False), (VID + "x", False), ("../etc/passwd", False), ("..%2Fetc%2Fpasswd", False),
    ("soundcloud-12a", False), ("soundcloud-", False), ("soundcloud-x", False), ("soundcloud-" + "1" * 21, False), ("soundcloud-١٢", False),
    ("spotify-", False), ("spotify-" + "a" * 65, False), ("deezer-123", False), ("a/b/c/d/e/f", False),
    (VID + "\n", False), ("dQw4w9WgXcé", False), ("dQw4w9Wg\x00cQ", False),
])
def test_is_valid_video_id(sid, ok):
    assert urlclean.is_valid_video_id(sid) is ok


def test_source_of_variants():
    assert urlclean.source_of(VID) == "youtube"
    assert urlclean.source_of("soundcloud-9") == "soundcloud"
    assert urlclean.source_of("applemusic-abc") == "applemusic"
    assert urlclean.source_of("shazam-abc") == "shazam"
    assert urlclean.source_of("spotify-abc") == "spotify"


@pytest.mark.parametrize("url", [
    "https://soundcloud.com/discover/foo", "https://soundcloud.com/artist/tracks", "https://soundcloud.com/artist/sets",
    "https://soundcloud.com/ar tist/track", "https://soundcloud.com/artist/tr%20ack", "https://soundcloud.com/artist/track/notsecret",
    "https://soundcloud.com/artist/track/s-", "https://soundcloud.com/a", "https://soundcloud.com/a/b/c/d",
    "https://on.soundcloud.com/ab", "https://on.soundcloud.com/abc/def", "https://on.soundcloud.com/",
])
def test_soundcloud_non_tracks_are_unsupported(url):
    assert urlclean.classify_soundcloud(url)[0] == "unsupported"


@pytest.mark.parametrize("url", ["https://example.com/a/b", "https://notsoundcloud.com/a/b", "https://soundcloud.com.evil.io/a/b", "ftp://x", "", "   "])
def test_soundcloud_foreign_hosts_are_not_soundcloud(url):
    assert urlclean.classify_soundcloud(url) is None


def test_soundcloud_track_drops_query_fragment_and_keeps_secret():
    assert urlclean.classify_soundcloud("  HTTPS://m.soundcloud.com/a-b/c_d?si=1#t=2 ") == ("track", "https://soundcloud.com/a-b/c_d")
    assert urlclean.classify_soundcloud("soundcloud.com/a/b/s-Ab12")[1] == "https://soundcloud.com/a/b/s-Ab12"


def test_find_soundcloud_url_in_text():
    assert urlclean.find_soundcloud_url("listen https://soundcloud.com/a/b now") == "https://soundcloud.com/a/b"
    assert urlclean.find_soundcloud_url("see on.soundcloud.com/AbC123>") == "on.soundcloud.com/AbC123"
    assert urlclean.find_soundcloud_url("https://youtube.com/watch?v=" + VID) is None
    assert urlclean.find_soundcloud_url("") is None


@pytest.mark.parametrize("text", [
    "https://www.youtube.com/watch?v=" + VID, "youtube.com/watch?feature=x&v=" + VID, "https://youtu.be/" + VID + "?t=3",
    "https://music.youtube.com/watch?v=" + VID + "&list=PL1", "https://m.youtube.com/shorts/" + VID, "https://www.youtube.com/embed/" + VID, VID,
])
def test_parse_video_id_accepts(text):
    assert urlclean.parse_video_id(text) == VID


@pytest.mark.parametrize("text", [
    "", "https://evilyoutube.com/watch?v=" + VID, "https://youtube.com.evil.io/watch?v=" + VID, "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?x=" + VID, "https://www.youtube.com/playlist?list=PL1", "https://youtu.be/", "javascript:alert(1)",
])
def test_parse_video_id_rejects(text):
    assert urlclean.parse_video_id(text) is None


def test_watch_url_per_source():
    assert urlclean.watch_url(VID) == f"https://www.youtube.com/watch?v={VID}"
    assert urlclean.watch_url("soundcloud-5") == "https://api.soundcloud.com/tracks/5"
    assert urlclean.watch_url("soundcloud-5", "https://soundcloud.com/a/b?si=1") == "https://soundcloud.com/a/b"
    assert urlclean.watch_url("soundcloud-5", "https://evil.example/a/b") == "https://api.soundcloud.com/tracks/5"
    assert urlclean.watch_url("spotify-abc", "https://open.spotify.com/track/abc") == "https://open.spotify.com/track/abc"
    assert urlclean.watch_url("spotify-abc") == ""


def test_clean_url_strips_tracking_but_keeps_other_params_and_blanks():
    assert urlclean.clean_url("https://example.com/p?utm_source=x&id=7&fbclid=z&Q=&UTM_x=1&gclid=1&si=2&pp=3&feature=4") == "https://example.com/p?id=7&Q="
    assert urlclean.clean_url("https://example.com/p?a=1") == "https://example.com/p?a=1"
    assert urlclean.clean_url("  not a url  ") == "not a url"
    assert urlclean.clean_url("ftp://h/p?utm_a=1") == "ftp://h/p?utm_a=1"
    assert urlclean.clean_url("https://on.soundcloud.com/AbC123?si=1") == "https://on.soundcloud.com/AbC123"
    assert urlclean.clean_url("https://youtu.be/" + VID + "?si=abc") == f"https://www.youtube.com/watch?v={VID}"


def test_short_link_must_be_a_short_link():
    with pytest.raises(ValueError, match="single tracks"):
        urlclean.resolve_soundcloud_short("https://soundcloud.com/a/b")
    with pytest.raises(ValueError, match="single tracks"):
        urlclean.resolve_soundcloud_short("https://example.com/")


@pytest.mark.parametrize("location", [
    "http://soundcloud.com/a/b", "https://evil.example/a/b", "https://soundcloud.com.evil.io/a/b", "", "//soundcloud.com/a/b",
])
def test_short_link_redirect_target_is_validated(monkeypatch, location):
    monkeypatch.setattr(urlclean, "_open_no_redirect", lambda u: SimpleNamespace(headers={"Location": location}))
    with pytest.raises(ValueError, match="could not resolve"):
        urlclean.resolve_soundcloud_short("https://on.soundcloud.com/AbC123")


def test_short_link_pointing_to_a_profile_or_playlist_is_unsupported(monkeypatch):
    monkeypatch.setattr(urlclean, "_open_no_redirect", lambda u: SimpleNamespace(headers={"Location": "https://soundcloud.com/artist"}))
    with pytest.raises(ValueError, match="single tracks"):
        urlclean.resolve_soundcloud_short("https://on.soundcloud.com/AbC123")


def test_short_link_response_without_headers(monkeypatch):
    monkeypatch.setattr(urlclean, "_open_no_redirect", lambda u: SimpleNamespace())
    with pytest.raises(ValueError, match="could not resolve"):
        urlclean.resolve_soundcloud_short("https://on.soundcloud.com/AbC123")


class _Redirector(http.server.BaseHTTPRequestHandler):
    seen: list[str] = []

    def do_HEAD(self):
        _Redirector.seen.append(self.path)
        if self.path == "/ok":
            self.send_response(200)
        else:
            self.send_response(302)
            self.send_header("Location", "https://soundcloud.com/a/b")
        self.end_headers()

    def log_message(self, *a):
        pass


@pytest.fixture
def local_server():
    try:
        srv = http.server.HTTPServer(("127.0.0.1", 0), _Redirector)
    except PermissionError:
        pytest.skip("environment blocks loopback TCP listeners")
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_open_no_redirect_returns_the_redirect_instead_of_following_it(local_server):
    resp = urlclean._open_no_redirect(local_server + "/short")
    assert resp.code == 302
    assert resp.headers["Location"] == "https://soundcloud.com/a/b"
    assert urlclean._open_no_redirect(local_server + "/ok").status == 200
    assert _Redirector.seen == ["/short", "/ok"]


def test_seeded_valid_ids_round_trip_and_mutations_break_them():
    rng = random.Random(42)
    alphabet = string.ascii_letters + string.digits + "_-"
    for _ in range(200):
        vid = "".join(rng.choice(alphabet) for _ in range(11))
        assert urlclean.is_valid_video_id(vid)
        assert urlclean.parse_video_id(f"https://www.youtube.com/watch?v={vid}&t=1") == vid
        assert urlclean.parse_video_id(f"https://youtu.be/{vid}") == vid
        bad = vid[:rng.randrange(11)] + rng.choice("/.\\ %:;\x00\n") + vid[rng.randrange(11):]
        assert not urlclean.is_valid_video_id(bad)
