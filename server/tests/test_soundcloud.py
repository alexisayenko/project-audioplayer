import json
import urllib.error

import pytest
from fastapi.testclient import TestClient

from app import bpm, extractor, library, main, urlclean

H = {"X-API-Token": "secret"}
YT = "dQw4w9WgXcQ"
SC_ID = "soundcloud-1234567890"
SC_URL = "https://soundcloud.com/some-artist/some-track"
ART = "https://i1.sndcdn.com/artworks-abc-large.jpg"


@pytest.mark.parametrize(
    "raw",
    [
        SC_URL,
        "http://soundcloud.com/some-artist/some-track",
        "https://www.soundcloud.com/some-artist/some-track",
        "https://m.soundcloud.com/some-artist/some-track",
        "soundcloud.com/some-artist/some-track",
        "  https://soundcloud.com/some-artist/some-track?si=abc&utm_source=clipboard&utm_medium=text  ",
        "https://soundcloud.com/some-artist/some-track/?ref=x#t=10",
    ],
)
def test_soundcloud_track_forms_become_canonical(raw):
    assert urlclean.clean_url(raw) == SC_URL
    assert urlclean.classify_soundcloud(raw) == ("track", SC_URL)


def test_private_link_keeps_secret_token_only():
    raw = "https://soundcloud.com/some-artist/some-track/s-AbC123?si=zzz"
    assert urlclean.clean_url(raw) == f"{SC_URL}/s-AbC123"
    assert urlclean.classify_soundcloud(f"{SC_URL}/albums") == ("unsupported", "")
    assert urlclean.classify_soundcloud(f"{SC_URL}/whatever") == ("unsupported", "")


@pytest.mark.parametrize(
    "raw",
    [
        "https://soundcloud.com/some-artist",
        "https://soundcloud.com/some-artist/sets/my-set",
        "https://soundcloud.com/some-artist/sets/my-set/s-AbC",
        "https://soundcloud.com/some-artist/likes",
        "https://soundcloud.com/some-artist/albums",
        "https://soundcloud.com/discover/sets/personalized-tracks",
        "https://soundcloud.com/",
        "https://on.soundcloud.com/a/b",
    ],
)
def test_sets_profiles_rejected(raw):
    assert urlclean.classify_soundcloud(raw) == ("unsupported", "")


def test_other_hosts_are_not_soundcloud():
    for raw in ["https://evilsoundcloud.com/a/b", "https://soundcloud.com.evil.example/a/b", "https://example.com/a/b", "nonsense"]:
        assert urlclean.classify_soundcloud(raw) is None


def test_short_link_cleaned_and_resolved(monkeypatch):
    assert urlclean.clean_url("https://on.soundcloud.com/AbC123?si=x") == "https://on.soundcloud.com/AbC123"

    class Resp:
        headers = {"Location": f"{SC_URL}?utm_source=app"}

    seen = []
    monkeypatch.setattr(urlclean, "_open_no_redirect", lambda u: seen.append(u) or Resp())
    assert urlclean.resolve_soundcloud_short("https://on.soundcloud.com/AbC123") == SC_URL
    assert seen == ["https://on.soundcloud.com/AbC123"]


@pytest.mark.parametrize(
    "location",
    ["http://soundcloud.com/a/b", "https://evil.example/a/b", "https://soundcloud.com.evil.example/a/b", "", "https://soundcloud.com/a/sets/x"],
)
def test_short_link_redirect_validated(monkeypatch, location):
    class Resp:
        headers = {"Location": location}

    monkeypatch.setattr(urlclean, "_open_no_redirect", lambda u: Resp())
    with pytest.raises(ValueError):
        urlclean.resolve_soundcloud_short("https://on.soundcloud.com/AbC123")


def test_short_link_network_error(monkeypatch):
    def boom(u):
        raise urllib.error.URLError("down")

    monkeypatch.setattr(urlclean, "_open_no_redirect", boom)
    with pytest.raises(ValueError):
        urlclean.resolve_soundcloud_short("https://on.soundcloud.com/AbC123")


def test_id_validation_and_source():
    ok = [YT, SC_ID, "soundcloud-1"]
    bad = ["soundcloud-abc", "soundcloud-12x", "SoundCloud-1", "soundcloud_1", "../etc", "soundcloud-1/../x", "--exec=rm", "", "a" * 12]
    assert all(urlclean.is_valid_video_id(i) for i in ok)
    assert not any(urlclean.is_valid_video_id(i) for i in bad)
    assert urlclean.source_of(YT) == "youtube" and urlclean.source_of(SC_ID) == "soundcloud"
    assert urlclean.soundcloud_song_id(42) == "soundcloud-42"
    assert len(SC_ID) > 11


def test_watch_url_by_source():
    assert urlclean.watch_url(YT) == f"https://www.youtube.com/watch?v={YT}"
    assert urlclean.watch_url(SC_ID, SC_URL + "?si=1") == SC_URL
    assert urlclean.watch_url(SC_ID) == "https://api.soundcloud.com/tracks/1234567890"


def test_large_artwork_and_cover_url():
    assert extractor.large_artwork(ART) == "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"
    assert extractor.large_artwork("https://i1.sndcdn.com/artworks-abc-original.png") == "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"
    assert extractor.large_artwork("https://evil.example/artworks-abc-large.jpg") is None
    assert extractor.large_artwork("http://i1.sndcdn.com/x-large.jpg") is None
    assert extractor.cover_url(SC_ID, ART).endswith("-t500x500.jpg")
    assert extractor.cover_url(SC_ID) is None
    assert extractor.cover_url(YT) == f"https://i.ytimg.com/vi/{YT}/hqdefault.jpg"


class FakeYDL:
    info: dict = {}
    calls: list = []

    def __init__(self, opts):
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=False):
        FakeYDL.calls.append((url, download, self.opts))
        return dict(FakeYDL.info)


def sc_info(**over):
    info = {
        "id": "1234567890",
        "title": "Some Track",
        "uploader": "Some Label",
        "artists": ["Some Artist"],
        "duration": 215.5,
        "genres": ["Dance & EDM"],
        "thumbnails": [{"id": "large", "url": ART}, {"id": "t500x500", "url": "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"}],
        "formats": [{"format_id": "http_mp3_128"}, {"format_id": "hls_aac_160k_preview"}],
        "release_year": 2019,
    }
    info.update(over)
    return info


@pytest.fixture()
def ydl(monkeypatch):
    FakeYDL.calls = []
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    return FakeYDL


def test_soundcloud_probe_fields(ydl):
    ydl.info = sc_info()
    p = extractor.soundcloud_probe(SC_URL)
    assert p["id"] == SC_ID and p["source"] == "soundcloud" and p["source_url"] == SC_URL
    assert p["title"] == "Some Track" and p["artist"] == "Some Artist"
    assert p["year"] == 2019 and p["duration"] == 215.5
    assert p["tags"] == ["genre:dance & edm"]
    assert p["thumbnail"] == "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"
    assert p["preview_only"] is False
    url, download, opts = ydl.calls[0]
    assert url == SC_URL and download is False and opts["skip_download"] is True


def test_soundcloud_probe_uploader_fallback_and_no_upload_year(ydl):
    ydl.info = sc_info(artists=None, release_year=None, upload_date="20240101", thumbnails=[], thumbnail=ART)
    p = extractor.soundcloud_probe(SC_URL)
    assert p["artist"] == "Some Label" and p["year"] is None
    assert p["thumbnail"].endswith("-t500x500.jpg")


def test_soundcloud_probe_playlist_refused(ydl):
    ydl.info = {"_type": "playlist", "entries": [{}], "id": "9"}
    with pytest.raises(ValueError, match="single tracks"):
        extractor.soundcloud_probe(SC_URL)


def test_preview_only_detected_from_formats(ydl):
    ydl.info = sc_info(formats=[{"format_id": "hls_aac_160k_preview"}, {"format_id": "http_mp3_128_preview"}])
    assert extractor.soundcloud_probe(SC_URL)["preview_only"] is True


def test_download_soundcloud_reencodes_to_m4a_and_names_by_id(ydl, tmp_path, monkeypatch):
    ydl.info = sc_info(format_id="http_mp3_128")
    monkeypatch.setattr(extractor, "_file_seconds", lambda p: 215.0)
    seen = []
    out = extractor.download_audio(SC_ID, tmp_path, seen.append, SC_URL)
    url, download, opts = ydl.calls[0]
    assert url == SC_URL and download is True
    assert opts["outtmpl"] == str(tmp_path / f"{SC_ID}.%(ext)s")
    assert opts["postprocessors"][0]["preferredcodec"] == "m4a"
    assert out["artist"] == "Some Artist" and out["thumbnail"].endswith("-t500x500.jpg")


def test_download_refuses_preview_format_and_removes_file(ydl, tmp_path):
    (tmp_path / f"{SC_ID}.m4a").write_bytes(b"x")
    ydl.info = sc_info(format_id="hls_aac_160k_preview")
    with pytest.raises(extractor.PreviewOnly):
        extractor.download_audio(SC_ID, tmp_path, None, SC_URL)
    assert not (tmp_path / f"{SC_ID}.m4a").exists()


def test_download_refuses_short_file_for_long_track(ydl, tmp_path, monkeypatch):
    (tmp_path / f"{SC_ID}.m4a").write_bytes(b"x")
    ydl.info = sc_info(format_id="http_mp3_128", duration=240)
    monkeypatch.setattr(extractor, "_file_seconds", lambda p: 30.0)
    with pytest.raises(extractor.PreviewOnly):
        extractor.download_audio(SC_ID, tmp_path, None, SC_URL)
    assert not (tmp_path / f"{SC_ID}.m4a").exists()


def test_genuinely_short_track_is_not_preview(ydl, tmp_path, monkeypatch):
    ydl.info = sc_info(format_id="http_mp3_128", duration=20)
    monkeypatch.setattr(extractor, "_file_seconds", lambda p: 20.0)
    assert extractor.download_audio(SC_ID, tmp_path, None, SC_URL)["id"] == SC_ID


def test_fetch_cover_soundcloud_fixed_host(tmp_path, monkeypatch):
    import urllib.request

    asked = []

    class R:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"jpg"

    monkeypatch.setattr(urllib.request, "urlopen", lambda u, timeout: asked.append(u) or R())
    extractor.fetch_cover(SC_ID, tmp_path / "c" / f"{SC_ID}.jpg", ART)
    assert asked == ["https://i1.sndcdn.com/artworks-abc-t500x500.jpg"]
    assert (tmp_path / "c" / f"{SC_ID}.jpg").read_bytes() == b"jpg"
    with pytest.raises(ValueError):
        extractor.fetch_cover(SC_ID, tmp_path / "x.jpg", "https://evil.example/a-large.jpg")
    assert asked[-1:] == ["https://i1.sndcdn.com/artworks-abc-t500x500.jpg"]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(main, "DOWNLOAD_DIR", tmp_path / "downloads")
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "JOBS", {})
    state = {"probe": {**{
        "id": SC_ID, "source": "soundcloud", "source_url": SC_URL, "title": "Some Track", "artist": "Some Label",
        "album": None, "year": None, "tags": ["genre:house"], "duration": 215.5,
        "thumbnail": "https://i1.sndcdn.com/artworks-abc-t500x500.jpg", "preview_only": False}}}

    def fake_download(video_id, out_dir, progress=None, source_url=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"audio")
        state["source_url"] = source_url
        if video_id.startswith("soundcloud-"):
            return {"id": video_id, "title": "Some Track", "artist": "Some Label", "duration": 215, "thumbnail": ART}
        return {"id": video_id, "title": "Yt", "artist": "Yt A", "duration": 7}

    def fake_cover(video_id, dest, artwork=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"jpg")
        state["artwork"] = artwork

    monkeypatch.setattr(extractor, "soundcloud_probe", lambda url: dict(state["probe"]))
    monkeypatch.setattr(extractor, "download_audio", fake_download)
    monkeypatch.setattr(extractor, "fetch_cover", fake_cover)
    monkeypatch.setattr(bpm, "detect_bpm", lambda path: 100.0)
    monkeypatch.setattr(
        extractor, "preview",
        lambda vid: {"id": vid, "source_url": extractor.watch_url(vid), "title": "T", "artist": "A", "album": None,
                     "year": None, "tags": [], "duration": 9, "thumbnail": extractor.cover_url(vid)},
    )
    c = TestClient(main.app)
    c.state = state
    return c


def test_preview_soundcloud(client):
    r = client.post("/preview", json={"url": f"{SC_URL}?si=abc"}, headers=H)
    assert r.status_code == 200
    j = r.json()
    assert j["id"] == SC_ID and j["source"] == "soundcloud" and j["source_url"] == SC_URL
    assert "preview_only" not in j and j["in_library"] is False
    assert j["tags"] == ["genre:house"]


def test_preview_short_link_resolved(client, monkeypatch):
    monkeypatch.setattr(urlclean, "resolve_soundcloud_short", lambda u: SC_URL)
    r = client.post("/preview", json={"url": "https://on.soundcloud.com/AbC123"}, headers=H)
    assert r.status_code == 200 and r.json()["id"] == SC_ID


def test_preview_short_link_failure_is_unsupported(client, monkeypatch):
    def boom(u):
        raise ValueError("could not resolve the SoundCloud short link")

    monkeypatch.setattr(urlclean, "resolve_soundcloud_short", boom)
    r = client.post("/preview", json={"url": "https://on.soundcloud.com/AbC123"}, headers=H)
    assert r.status_code == 422 and r.json()["error"] == "unsupported"


def test_preview_set_is_refused(client):
    r = client.post("/preview", json={"url": "https://soundcloud.com/a/sets/b"}, headers=H)
    assert r.status_code == 422
    assert r.json() == {"error": "unsupported", "detail": "Only single tracks are supported"}
    assert client.post("/preview", json={"url": "https://soundcloud.com/a"}, headers=H).json()["error"] == "unsupported"
    r = client.post("/preview", json={"url": "http://x.y"}, headers=H)
    assert r.status_code == 422 and r.json()["error"] == "unsupported"


def test_preview_only_is_422_structured(client):
    client.state["probe"]["preview_only"] = True
    r = client.post("/preview", json={"url": SC_URL}, headers=H)
    assert r.status_code == 422 and r.json()["error"] == "preview_only"
    assert "Go+" in r.json()["detail"]
    r = client.post("/songs", json={"url": SC_URL}, headers=H)
    assert r.status_code == 422 and r.json()["error"] == "preview_only"
    assert client.get("/library", headers=H).json() == {"songs": []}


@pytest.mark.parametrize(
    "message,status,code",
    [("HTTP Error 404: Not Found", 404, "not_found"), ("HTTP Error 403: Forbidden", 403, "private"), ("boom", 502, "failed")],
)
def test_preview_extractor_errors(client, monkeypatch, message, status, code):
    def boom(url):
        raise RuntimeError(message)

    monkeypatch.setattr(extractor, "soundcloud_probe", boom)
    r = client.post("/preview", json={"url": SC_URL}, headers=H)
    assert r.status_code == status and r.json()["error"] == code


def test_save_soundcloud_song_and_mixed_library(client, tmp_path):
    r = client.post("/songs", json={"url": SC_URL, "metadata": {"title": "Mine", "artist": "Me"}, "tags": ["genre:house"]}, headers=H)
    assert r.status_code == 202 and r.json()["id"] == SC_ID
    assert client.get(f"/songs/{SC_ID}/status", headers=H).json()["status"] == "done"
    assert client.state["source_url"] == SC_URL and client.state["artwork"] == ART
    assert client.post("/songs", json={"url": f"{SC_URL}?si=x"}, headers=H).status_code == 409
    assert client.post("/songs", json={"url": f"https://youtu.be/{YT}"}, headers=H).status_code == 202
    songs = {s["id"]: s for s in client.get("/library", headers=H).json()["songs"]}
    sc, yt = songs[SC_ID], songs[YT]
    assert sc["source"] == "soundcloud" and sc["source_url"] == SC_URL and sc["file"] == f"{SC_ID}.m4a"
    assert sc["title"] == "Mine" and sc["cover"] == f"covers/{SC_ID}.jpg"
    assert "source" not in yt and yt["file"] == f"{YT}.m4a"
    on_disk = json.loads((tmp_path / "library.json").read_text())["songs"]
    assert {s["id"] for s in on_disk} == {SC_ID, YT}
    assert library.load(tmp_path / "library.json")[0]["id"] in (SC_ID, YT)
    assert client.get(f"/files/{SC_ID}", headers=H).content == b"audio"
    assert client.get(f"/covers/{SC_ID}", headers=H).content == b"jpg"
    assert client.patch(f"/songs/{SC_ID}", json={"title": "New"}, headers=H).json()["title"] == "New"
    assert client.delete(f"/songs/{SC_ID}", headers=H).status_code == 204
    assert not (tmp_path / "covers" / f"{SC_ID}.jpg").exists()
    assert client.get(f"/files/{SC_ID}", headers=H).status_code == 404


def test_download_time_preview_only_reports_code(client, monkeypatch):
    def boom(*a, **k):
        raise extractor.PreviewOnly()

    monkeypatch.setattr(extractor, "download_audio", boom)
    assert client.post("/songs", json={"url": SC_URL}, headers=H).status_code == 202
    st = client.get(f"/songs/{SC_ID}/status", headers=H).json()
    assert st["status"] == "error" and st["code"] == "preview_only" and "Go+" in st["error"]
    assert client.get("/library", headers=H).json() == {"songs": []}


def test_id_validators_in_paths(client):
    for bad in ["soundcloud-abc", "soundcloud-1%2F..%2Fx"]:
        assert client.get(f"/files/{bad}", headers=H).status_code in (404, 422)
        assert client.get(f"/covers/{bad}", headers=H).status_code in (404, 422)
        assert client.delete(f"/songs/{bad}", headers=H).status_code in (404, 405, 422)
    assert client.get("/files/soundcloud-1", headers=H).status_code == 404
    assert client.post("/download", json={"video_id": SC_ID}, headers=H).status_code == 422
