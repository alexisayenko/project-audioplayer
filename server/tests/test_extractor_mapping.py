import subprocess
from types import SimpleNamespace

import pytest

from app import extractor

YT = "dQw4w9WgXcQ"
SC = "soundcloud-1234"
SC_URL = "https://soundcloud.com/some-artist/some-track"


class FakeYDL:
    info: dict = {}
    seen: list = []

    def __init__(self, opts):
        FakeYDL.seen.append(opts)
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=False):
        FakeYDL.seen.append((url, download))
        for hook in self.opts.get("progress_hooks", []):
            hook({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100, "speed": 10.5, "eta": 3})
            hook({"status": "finished"})
        return FakeYDL.info


@pytest.fixture
def ydl(monkeypatch):
    FakeYDL.info, FakeYDL.seen = {}, []
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    return FakeYDL


def test_search_skips_bad_entries_and_maps_fields(ydl):
    ydl.info = {"entries": [
        None, {"id": "bad"}, {"title": "no id"},
        {"id": YT, "title": "Artist - Song (Remix)", "uploader": "Chan", "duration": 200},
        {"id": "9bZkp7q19f0", "title": "Plain", "channel": "Ch", "duration": None},
    ]}
    got = extractor.search("q", 5)
    assert [r["id"] for r in got] == [YT, "9bZkp7q19f0"]
    assert got[0]["artist"] == "Chan"
    assert "Song" in got[0]["title"]
    assert got[0]["thumbnail"] == f"https://i.ytimg.com/vi/{YT}/hqdefault.jpg"
    assert ydl.seen[1] == ("ytsearch5:q", False)


def test_search_with_no_entries_key(ydl):
    ydl.info = {}
    assert extractor.search("q", 3) == []


def test_download_legacy_maps_info_and_makes_the_directory(ydl, tmp_path):
    ydl.info = {"title": "T", "uploader": "U", "duration": 12}
    out = tmp_path / "deep" / "dir"
    got = extractor.download(YT, out)
    assert out.is_dir()
    assert got == {"id": YT, "title": "T", "artist": "U", "duration": 12, "thumbnail": f"https://i.ytimg.com/vi/{YT}/hqdefault.jpg"}
    assert ydl.seen[0]["outtmpl"] == str(out / "%(id)s.%(ext)s")
    assert ydl.seen[0]["noplaylist"] is True
    ydl.info = {"artist": "Real", "uploader": "U"}
    assert extractor.download(YT, out)["artist"] == "Real"
    assert extractor.download(YT, out)["title"] == ""


YT_INFO = {
    "id": YT, "title": "Daft Punk - One More Time (Official Video)", "uploader": "DaftPunkVEVO", "duration": 320,
    "upload_date": "20090415", "genre": "House; Electronic, Disco", "album": "Discovery",
}


def test_preview_youtube_info_dict_mapping(ydl):
    ydl.info = {**YT_INFO, "artist": "Daft Punk", "track": "One More Time"}
    got = extractor.preview(YT)
    assert got["id"] == YT
    assert got["source"] == "youtube"
    assert got["source_url"] == f"https://www.youtube.com/watch?v={YT}"
    assert (got["artist"], got["title"], got["album"], got["duration"]) == ("Daft Punk", "One More Time", "Discovery", 320)
    assert got["year"] == 2009
    assert {t.lower() for t in got["tags"]} >= {"genre:house", "genre:electronic", "genre:disco"}
    assert got["thumbnail"] == f"https://i.ytimg.com/vi/{YT}/hqdefault.jpg"


def test_preview_prefers_release_year_over_dates(ydl):
    ydl.info = {**YT_INFO, "release_year": 1999, "release_date": "20000101"}
    assert extractor.preview(YT)["year"] == 1999
    ydl.info = {**YT_INFO, "release_date": "20010101"}
    assert extractor.preview(YT)["year"] == 2001
    ydl.info = {"title": "x", "upload_date": "bad!"}
    assert extractor.preview(YT)["year"] is None
    ydl.info = {"title": "x"}
    assert extractor.preview(YT)["year"] is None


@pytest.mark.parametrize("raw,expected", [
    (None, []), ("", []), (" ; , ", []), (["Rock", " ", "Pop"], ["genre:rock", "genre:pop"]), ("Rock,Pop", ["genre:rock", "genre:pop"]),
])
def test_suggest_tags_shapes(raw, expected):
    assert [t.lower() for t in extractor.suggest_tags({"genre": raw})] == expected


SC_INFO = {
    "id": 1234, "title": "Some Track (Foo Bar Remix)", "uploader": "some-artist", "duration": 245.0, "genre": "Techno",
    "release_date": "20200301", "thumbnail": "https://i1.sndcdn.com/artworks-abc-large.jpg",
    "formats": [{"format_id": "http_mp3_1_0"}, {"format_id": "hls_opus_64_0"}],
}


def test_soundcloud_probe_info_dict_mapping(ydl):
    ydl.info = dict(SC_INFO)
    got = extractor.soundcloud_probe(SC_URL)
    assert got["id"] == SC
    assert got["source"] == "soundcloud"
    assert got["source_url"] == SC_URL
    assert got["artist"] == "some-artist"
    assert got["title"] == "Some Track"
    assert got["remixer"] == "Foo Bar Remix"
    assert got["year"] == 2020
    assert got["duration"] == 245.0
    assert got["thumbnail"] == "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"
    assert got["preview_only"] is False
    assert "genre:techno" in [t.lower() for t in got["tags"]]


def test_soundcloud_probe_artist_precedence_and_genres_fallback(ydl):
    ydl.info = {**SC_INFO, "artists": ["First", "Second"], "artist": "A", "creator": "C", "genre": None, "genres": ["Ambient"]}
    got = extractor.soundcloud_probe(SC_URL)
    assert got["artist"] == "First"
    assert [t.lower() for t in got["tags"]] == ["genre:ambient"]
    ydl.info = {**SC_INFO, "artist": "A", "creator": "C"}
    assert extractor.soundcloud_probe(SC_URL)["artist"] == "A"
    ydl.info = {**SC_INFO, "creator": "C"}
    assert extractor.soundcloud_probe(SC_URL)["artist"] == "C"
    ydl.info = {**SC_INFO, "artists": []}
    assert extractor.soundcloud_probe(SC_URL)["artist"] == "some-artist"


def test_soundcloud_preview_only_when_every_format_is_a_preview(ydl):
    ydl.info = {**SC_INFO, "formats": [{"format_id": "http_mp3_preview"}, {"format_id": "hls_preview"}]}
    assert extractor.soundcloud_probe(SC_URL)["preview_only"] is True
    ydl.info = {**SC_INFO, "formats": [{"format_id": "http_mp3_preview"}, {"format_id": "hls_opus"}]}
    assert extractor.soundcloud_probe(SC_URL)["preview_only"] is False
    ydl.info = {**SC_INFO, "formats": []}
    assert extractor.soundcloud_probe(SC_URL)["preview_only"] is False


def test_soundcloud_artwork_prefers_t500x500_thumbnail_entry(ydl):
    ydl.info = {**SC_INFO, "thumbnails": [{"id": "t500x500", "url": "https://i1.sndcdn.com/artworks-z-t500x500.jpg"}, {"id": "x"}, "junk"]}
    assert extractor.soundcloud_probe(SC_URL)["thumbnail"] == "https://i1.sndcdn.com/artworks-z-t500x500.jpg"


@pytest.mark.parametrize("info", [{"_type": "playlist"}, {"_type": "multi_video"}, {"entries": [{}]}])
def test_soundcloud_playlists_are_refused(ydl, info):
    ydl.info = {"id": 1, **info}
    with pytest.raises(ValueError, match="single tracks"):
        extractor.soundcloud_probe(SC_URL)


@pytest.mark.parametrize("url,expected", [
    ("https://i1.sndcdn.com/artworks-a-large.jpg", "https://i1.sndcdn.com/artworks-a-t500x500.jpg"),
    ("https://i1.sndcdn.com/artworks-a-t120x120.png?x=1", "https://i1.sndcdn.com/artworks-a-t500x500.jpg?x=1"),
    ("https://sndcdn.com/artworks-a-badge.jpeg", "https://sndcdn.com/artworks-a-t500x500.jpg"),
    ("https://i1.sndcdn.com/artworks-a.jpg", "https://i1.sndcdn.com/artworks-a.jpg"),
    ("http://i1.sndcdn.com/artworks-a-large.jpg", None),
    ("https://evil-sndcdn.com/a-large.jpg", None),
    ("https://sndcdn.com.evil.io/a-large.jpg", None),
    ("https://example.com/x-large.jpg", None),
    ("", None), (None, None),
])
def test_large_artwork_host_allowlist(url, expected):
    assert extractor.large_artwork(url) == expected


def test_cover_url_per_source():
    assert extractor.cover_url(YT) == f"https://i.ytimg.com/vi/{YT}/hqdefault.jpg"
    assert extractor.cover_url(SC) is None
    assert extractor.cover_url(SC, "https://i1.sndcdn.com/a-large.jpg") == "https://i1.sndcdn.com/a-t500x500.jpg"
    assert extractor.cover_url(SC, "https://evil.example/a-large.jpg") is None


def test_download_audio_youtube_progress_and_result(ydl, tmp_path):
    ydl.info = {"title": "Artist - Song", "uploader": "U", "duration": 100}
    events = []

    class P:
        def __call__(self, p):
            events.append(("p", p))

        def detail(self, speed, eta):
            events.append(("d", speed, eta))

        def converting(self):
            events.append(("c",))

    got = extractor.download_audio(YT, tmp_path / "o", P())
    assert events == [("d", 10.5, 3), ("p", 0.5), ("c",)]
    assert got["id"] == YT
    assert got["duration"] == 100
    assert ydl.seen[-1] == (f"https://www.youtube.com/watch?v={YT}", True)


def test_download_audio_plain_callable_progress_and_none(ydl, tmp_path):
    ydl.info = {"title": "t"}
    seen = []
    extractor.download_audio(YT, tmp_path, seen.append)
    assert seen == [0.5]
    extractor.download_audio(YT, tmp_path, None)


def test_progress_is_capped_at_one_when_total_is_an_estimate(monkeypatch, tmp_path):
    class Over(FakeYDL):
        def extract_info(self, url, download=False):
            for h in self.opts["progress_hooks"]:
                h({"status": "downloading", "downloaded_bytes": 150, "total_bytes_estimate": 100})
                h({"status": "downloading", "downloaded_bytes": 5})
            return {}

    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", Over)
    seen = []
    extractor.download_audio(YT, tmp_path, seen.append)
    assert seen == [1.0]


def test_download_soundcloud_success(ydl, tmp_path, monkeypatch):
    ydl.info = {**SC_INFO, "format_id": "http_mp3_1_0"}
    monkeypatch.setattr(extractor, "_file_seconds", lambda p: 245.0)
    got = extractor.download_audio(SC, tmp_path, None, SC_URL)
    assert got["id"] == SC
    assert got["title"] == "Some Track"
    assert got["remixer"] == "Foo Bar Remix"
    assert ydl.seen[0]["postprocessors"][0]["preferredcodec"] == "m4a"
    assert ydl.seen[0]["outtmpl"] == str(tmp_path / f"{SC}.%(ext)s")


def test_download_soundcloud_preview_by_format_id_removes_partial_file(ydl, tmp_path):
    (tmp_path / f"{SC}.m4a").write_bytes(b"x")
    ydl.info = {**SC_INFO, "format_id": "http_mp3_preview"}
    with pytest.raises(extractor.PreviewOnly):
        extractor.download_audio(SC, tmp_path, None, SC_URL)
    assert not (tmp_path / f"{SC}.m4a").exists()


def test_download_soundcloud_preview_detected_by_short_file(ydl, tmp_path, monkeypatch):
    (tmp_path / f"{SC}.m4a").write_bytes(b"x")
    ydl.info = {**SC_INFO, "format_id": "x", "duration": 245}
    monkeypatch.setattr(extractor, "_file_seconds", lambda p: 30.0)
    with pytest.raises(extractor.PreviewOnly, match="Preview only"):
        extractor.download_audio(SC, tmp_path, None, SC_URL)
    assert not (tmp_path / f"{SC}.m4a").exists()


@pytest.mark.parametrize("page,file,expected", [
    (245, 30, True), (245, 34.9, True), (245, 35, False), (90, 30, False), (95.1, 34, True), (None, 30, False), (245, None, False), (0, 10, False),
])
def test_looks_like_preview_boundaries(page, file, expected):
    assert extractor._looks_like_preview(page, file) is expected


def test_file_seconds_parses_ffprobe_and_swallows_failures(monkeypatch, tmp_path):
    monkeypatch.setattr(extractor.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout="12.5\n"))
    assert extractor._file_seconds(tmp_path / "a") == 12.5
    monkeypatch.setattr(extractor.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout="N/A"))
    assert extractor._file_seconds(tmp_path / "a") is None

    def boom(*a, **k):
        raise subprocess.CalledProcessError(1, "ffprobe")

    monkeypatch.setattr(extractor.subprocess, "run", boom)
    assert extractor._file_seconds(tmp_path / "a") is None

    def missing(*a, **k):
        raise FileNotFoundError("ffprobe")

    monkeypatch.setattr(extractor.subprocess, "run", missing)
    assert extractor._file_seconds(tmp_path / "a") is None


def test_fetch_cover_writes_the_file_and_refuses_unknown_hosts(monkeypatch, tmp_path):
    class R:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"jpg"

    urls = []
    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", lambda u, timeout=0: urls.append(u) or R())
    dest = tmp_path / "x" / "c.jpg"
    extractor.fetch_cover(YT, dest)
    assert dest.read_bytes() == b"jpg"
    assert urls == [f"https://i.ytimg.com/vi/{YT}/hqdefault.jpg"]
    with pytest.raises(ValueError, match="no cover"):
        extractor.fetch_cover(SC, tmp_path / "n.jpg", "https://evil.example/a-large.jpg")
    assert not (tmp_path / "n.jpg").exists()


@pytest.mark.parametrize("msg,code", [
    ("HTTP Error 404: Not Found", "not_found"), ("Video does not exist", "not_found"), ("HTTP Error 403: Forbidden", "private"),
    ("This video is private", "private"), ("HTTP Error 401", "private"), ("connection reset", None), ("", None),
])
def test_error_code(msg, code):
    assert extractor.error_code(Exception(msg)) == code
