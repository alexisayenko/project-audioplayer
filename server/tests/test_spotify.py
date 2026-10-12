"""Spotify lookups (task-0007): URL forms, token cache, errors, mapping, oEmbed fallback. No network."""

import io
import json
import urllib.error
import urllib.request

import pytest
from fastapi.testclient import TestClient

from app import main, spotify, urlclean

H = {"X-API-Token": "secret"}
TID = "4cOdK2wGLETKBW3PvgPWqT"
SID = f"spotify-{TID}"
CANON = f"https://open.spotify.com/track/{TID}"

TRACK = {
    "id": TID,
    "name": "Blue Monday",
    "duration_ms": 449_000,
    "external_ids": {"isrc": "GBAYE0400563"},
    "artists": [{"id": "a1", "name": "New Order"}, {"id": "a2", "name": "Someone Else"}],
    "album": {
        "name": "Power, Corruption & Lies",
        "release_date": "1983-05-02",
        "images": [
            {"url": "https://i.scdn.co/image/small", "width": 64, "height": 64},
            {"url": "https://i.scdn.co/image/big", "width": 640, "height": 640},
            {"url": "https://i.scdn.co/image/mid", "width": 300, "height": 300},
        ],
    },
}
ARTIST = {"id": "a1", "name": "New Order", "genres": ["new wave", "synth-pop", "post-punk", "dance rock"]}


class _Resp(io.BytesIO):
    def __init__(self, body, headers=None):
        super().__init__(json.dumps(body).encode())
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _http_error(url, code, headers=None):
    return urllib.error.HTTPError(url, code, "err", headers or {}, io.BytesIO(b""))


class FakeSpotify:
    """A scripted urlopen: counts token requests, serves /tracks, /artists and oembed."""

    def __init__(self, track=TRACK, artist=ARTIST, fail=None):
        self.track, self.artist, self.fail = track, artist, fail or {}
        self.tokens = 0
        self.calls = []
        self.token_value = "tok-1"

    def __call__(self, req, timeout=0):
        url = req.full_url
        self.calls.append(url)
        if url == spotify.TOKEN_URL:
            assert req.get_method() == "POST"
            assert req.headers["Authorization"].startswith("Basic ")
            self.tokens += 1
            if "token" in self.fail:
                raise _http_error(url, self.fail["token"])
            return _Resp({"access_token": f"{self.token_value}-{self.tokens}", "expires_in": 3600})
        if url.startswith(spotify.OEMBED_URL):
            if "oembed" in self.fail:
                raise _http_error(url, self.fail["oembed"])
            return _Resp({"title": "Blue Monday", "thumbnail_url": "https://i.scdn.co/image/oembed"})
        auth = req.headers.get("Authorization", "")
        assert auth.startswith("Bearer ")
        if "/tracks/" in url:
            if "track" in self.fail:
                code = self.fail["track"]
                if isinstance(code, tuple):
                    code, headers = code
                    raise _http_error(url, code, headers)
                if code == "401-once":
                    self.fail["track"] = None
                    raise _http_error(url, 401)
                if code:
                    raise _http_error(url, code)
            return _Resp(self.track)
        if "/artists/" in url:
            if "artist" in self.fail:
                raise _http_error(url, self.fail["artist"])
            return _Resp(self.artist)
        raise AssertionError(f"unexpected url {url}")


@pytest.fixture
def creds(monkeypatch):
    monkeypatch.setenv("SPOTIFY_CLIENT_ID", "cid")
    monkeypatch.setenv("SPOTIFY_CLIENT_SECRET", "sec")
    spotify.clear_token()
    yield
    spotify.clear_token()


@pytest.fixture
def no_creds(monkeypatch):
    monkeypatch.delenv("SPOTIFY_CLIENT_ID", raising=False)
    monkeypatch.delenv("SPOTIFY_CLIENT_SECRET", raising=False)
    spotify.clear_token()


@pytest.fixture
def fake(monkeypatch):
    f = FakeSpotify()
    monkeypatch.setattr(spotify.urllib.request, "urlopen", f)
    return f


# --- URL cleaning ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw",
    [
        CANON,
        f"http://open.spotify.com/track/{TID}",
        f"open.spotify.com/track/{TID}",
        f"https://open.spotify.com/track/{TID}?si=AbC123xyz",
        f"https://open.spotify.com/track/{TID}?si=AbC123xyz&utm_source=copy-link#x",
        f"https://open.spotify.com/intl-de/track/{TID}?si=1",
        f"https://open.spotify.com/intl-pt-br/track/{TID}",
        f"https://play.spotify.com/track/{TID}",
        f"spotify:track:{TID}",
        f"  {CANON}  ",
    ],
)
def test_spotify_track_forms_become_canonical(raw):
    assert urlclean.classify_spotify(raw) == ("track", CANON)
    assert urlclean.clean_url(raw) == CANON


@pytest.mark.parametrize(
    "raw",
    [
        "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3",
        "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
        "https://open.spotify.com/artist/0q5WvBK5P3cPqBzfKJTVz5",
        "https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk",
        "https://open.spotify.com/intl-de/album/1DFixLWuPkv3KT3TnV35m3",
        "spotify:album:1DFixLWuPkv3KT3TnV35m3",
        "https://open.spotify.com/track/short",
        "https://open.spotify.com/",
        "https://spotify.link/",
    ],
)
def test_other_spotify_links_are_unsupported(raw):
    assert urlclean.classify_spotify(raw) == ("unsupported", "")


def test_not_spotify_is_none():
    assert urlclean.classify_spotify("https://example.com/track/x") is None
    assert urlclean.classify_spotify("https://youtu.be/jNQXAC9IVRw") is None


def test_short_links_and_ids():
    assert urlclean.classify_spotify("https://spotify.link/AbC123?si=x") == ("short", "https://spotify.link/AbC123")
    assert urlclean.clean_url("spotify.link/AbC123") == "https://spotify.link/AbC123"
    assert urlclean.is_valid_video_id(SID)
    assert not urlclean.is_valid_video_id("spotify-short")
    assert urlclean.source_of(SID) == "spotify"
    assert urlclean.source_of("jNQXAC9IVRw") == "youtube"
    assert urlclean.watch_url(SID) == CANON
    assert urlclean.spotify_track_id(SID) == TID
    assert urlclean.spotify_track_id_of(f"spotify:track:{TID}") == TID
    assert urlclean.find_spotify_url(f"listen {CANON}?si=1 now") == f"{CANON}?si=1"


def test_short_link_resolves_one_https_redirect(monkeypatch):
    class R:
        headers = {"Location": f"{CANON}?si=zzz"}

    monkeypatch.setattr(urlclean, "_open_no_redirect", lambda url: R())
    assert urlclean.resolve_spotify_short("https://spotify.link/AbC123") == CANON
    R.headers = {"Location": "http://open.spotify.com/track/" + TID}
    with pytest.raises(ValueError):
        urlclean.resolve_spotify_short("https://spotify.link/AbC123")
    R.headers = {"Location": "https://evil.example/track/" + TID}
    with pytest.raises(ValueError):
        urlclean.resolve_spotify_short("https://spotify.link/AbC123")
    R.headers = {"Location": "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3"}
    with pytest.raises(ValueError, match="Only single tracks"):
        urlclean.resolve_spotify_short("https://spotify.link/AbC123")


# --- token and API ------------------------------------------------------------------------------


def test_token_is_cached_until_expiry(creds, fake, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(spotify.time, "time", lambda: now[0])
    assert spotify.access_token() == "tok-1-1"
    assert spotify.access_token() == "tok-1-1"
    assert fake.tokens == 1
    now[0] += 3600 - 30  # inside the 60 s skew
    assert spotify.access_token() == "tok-1-2"
    assert fake.tokens == 2


def test_401_refreshes_token_once(creds, fake):
    fake.fail["track"] = "401-once"
    meta = spotify.lookup(TID)
    assert meta["title"] == "Blue Monday"
    assert fake.tokens == 2


def test_persistent_401_is_unauthorized(creds, fake):
    fake.fail["track"] = 401
    with pytest.raises(spotify.SpotifyError) as exc:
        spotify.lookup(TID)
    assert exc.value.code == "unauthorized"


def test_bad_credentials(creds, fake):
    fake.fail["token"] = 400
    with pytest.raises(spotify.SpotifyError) as exc:
        spotify.lookup(TID)
    assert exc.value.code == "unauthorized"


def test_404_and_429(creds, fake):
    fake.fail["track"] = 404
    with pytest.raises(spotify.SpotifyError) as exc:
        spotify.lookup(TID)
    assert exc.value.code == "not_found"
    fake.fail["track"] = (429, {"Retry-After": "7"})
    with pytest.raises(spotify.SpotifyError) as exc:
        spotify.lookup(TID)
    assert exc.value.code == "rate_limited" and exc.value.retry_after == 7
    assert "7 s" in str(exc.value)


def test_secret_never_in_errors_or_urls(creds, fake):
    fake.fail["track"] = 500
    with pytest.raises(spotify.SpotifyError) as exc:
        spotify.lookup(TID)
    assert "sec" not in str(exc.value) and "cid" not in str(exc.value)
    assert all("sec" not in u for u in fake.calls)


# --- mapping ------------------------------------------------------------------------------------


def test_mapping_full(creds, fake):
    meta = spotify.lookup(TID)
    assert meta["id"] == SID and meta["source"] == "spotify" and meta["audio"] == "none"
    assert meta["source_url"] == CANON
    assert meta["title"] == "Blue Monday"
    assert meta["artist"] == "New Order, Someone Else"
    assert meta["album"] == "Power, Corruption & Lies"
    assert meta["year"] == 1983
    assert meta["duration"] == 449.0
    assert meta["thumbnail"] == "https://i.scdn.co/image/big"
    assert meta["isrc"] == "GBAYE0400563"
    assert meta["tags"] == ["genre:new wave", "genre:synth-pop", "genre:post-punk", "decade:80s"]
    assert meta["partial"] is False
    assert [u for u in fake.calls if "/artists/a1" in u]  # primary artist only


def test_mapping_missing_genres_year_album_and_artist_error(creds, fake):
    fake.track = {**TRACK, "album": {"name": "", "release_date": "", "images": []}, "external_ids": {}}
    fake.fail["artist"] = 500
    meta = spotify.lookup(TID)
    assert meta["year"] is None and meta["album"] is None and meta["thumbnail"] is None and meta["isrc"] is None
    assert meta["tags"] == []
    assert meta["artist"] == "New Order, Someone Else"


def test_artist_rate_limit_propagates(creds, fake):
    fake.fail["artist"] = 429
    with pytest.raises(spotify.SpotifyError) as exc:
        spotify.lookup(TID)
    assert exc.value.code == "rate_limited"


def test_oembed_fallback_without_credentials(no_creds, fake):
    assert not spotify.enabled()
    meta = spotify.probe(CANON)
    assert meta["partial"] is True and meta["audio"] == "none" and meta["id"] == SID
    assert meta["title"] == "Blue Monday" and meta["thumbnail"] == "https://i.scdn.co/image/oembed"
    assert meta["artist"] == "" and meta["tags"] == []
    assert fake.tokens == 0
    fake.fail["oembed"] = 404
    with pytest.raises(spotify.SpotifyError) as exc:
        spotify.probe(CANON)
    assert exc.value.code == "not_found"


# --- API ------------------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    (tmp_path / "library.json").write_text("[]")
    return TestClient(main.app)


def test_preview_spotify(client, creds, fake):
    r = client.post("/preview", json={"url": f"https://open.spotify.com/intl-de/track/{TID}?si=abc"}, headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == SID and body["source"] == "spotify" and body["audio"] == "none"
    assert body["source_url"] == CANON and body["title"] == "Blue Monday" and body["in_library"] is False
    assert "genre:new wave" in body["tags"]


def test_preview_spotify_errors(client, creds, fake):
    r = client.post("/preview", json={"url": "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3"}, headers=H)
    assert r.status_code == 422 and r.json() == {"error": "unsupported", "detail": "Only single tracks are supported"}
    fake.fail["track"] = 404
    r = client.post("/preview", json={"url": CANON}, headers=H)
    assert r.status_code == 404 and r.json()["error"] == "not_found"
    fake.fail["track"] = (429, {"Retry-After": "3"})
    r = client.post("/preview", json={"url": CANON}, headers=H)
    assert r.status_code == 429 and r.json()["error"] == "rate_limited" and r.headers["retry-after"] == "3"
    fake.fail["track"] = 403
    r = client.post("/preview", json={"url": CANON}, headers=H)
    assert r.status_code == 403 and r.json()["error"] == "private"


def test_preview_spotify_without_credentials_is_partial(client, no_creds, fake):
    r = client.post("/preview", json={"url": CANON}, headers=H)
    assert r.status_code == 200
    assert r.json()["partial"] is True and r.json()["artist"] == ""


def test_songs_refuses_metadata_only_until_task_0006(client, creds, fake):
    r = client.post("/songs", json={"url": CANON, "metadata": {"title": "Blue Monday"}, "tags": []}, headers=H)
    assert r.status_code == 422 and r.json()["error"] == "no_audio"
    assert "task-0006" in r.json()["detail"]
