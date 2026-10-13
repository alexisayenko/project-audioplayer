import importlib
import json

import pytest
from fastapi.testclient import TestClient

from app import bpm, extractor, library, main, users

VID = "dQw4w9WgXcQ"
VID2 = "9bZkp7q19f0"
H = {"X-API-Token": "secret"}
OWNER_UID = users.uid_for_email("alex.isayenko@gmail.com")


def ODIR(tmp_path):
    """The owner's data dir in the plain-file layout."""
    return tmp_path / "users" / OWNER_UID


def ADIR(tmp_path):
    """The owner's audio dir under the default music root (tmp_path / downloads)."""
    return tmp_path / "downloads" / "users" / OWNER_UID


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(main, "DOWNLOAD_DIR", tmp_path / "downloads")
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "JOBS", {})

    def fake_download(video_id, out_dir, progress=None, source_url=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"audio")
        if progress:
            progress(0.5)
        return {"id": video_id, "title": "Yt Title", "artist": "Yt Artist", "duration": 7}

    def fake_cover(video_id, dest, artwork=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"jpg")

    monkeypatch.setattr(extractor, "download_audio", fake_download)
    monkeypatch.setattr(extractor, "fetch_cover", fake_cover)
    monkeypatch.setattr(bpm, "detect_bpm", lambda path: 123.4)
    monkeypatch.setattr(
        extractor,
        "preview",
        lambda vid: {
            "id": vid,
            "source_url": extractor.watch_url(vid),
            "title": "T",
            "artist": "A",
            "album": None,
            "year": 1987,
            "tags": [],
            "duration": 9,
            "thumbnail": extractor.cover_url(vid),
        },
    )
    return TestClient(main.app)


def add(client, vid=VID, **kw):
    body = {"url": f"https://youtu.be/{vid}", "metadata": {"title": "Song"}, "tags": ["80s"], **kw}
    return client.post("/songs", json=body, headers=H)


def test_parse_video_id():
    p = extractor.parse_video_id
    assert p(f"https://www.youtube.com/watch?v={VID}&t=5") == VID
    assert p(f"https://music.youtube.com/watch?list=x&v={VID}") == VID
    assert p(f"https://youtu.be/{VID}?si=abc") == VID
    assert p(f"https://youtube.com/shorts/{VID}") == VID
    assert p(VID) == VID
    assert p("https://evil.example/watch?v=" + VID) is None
    assert p("nonsense") is None


def test_dirty_url_is_stored_clean(client):
    dirty = f"https://youtu.be/{VID}?si=abc123"
    clean = f"https://www.youtube.com/watch?v={VID}"
    assert client.post("/preview", json={"url": dirty}, headers=H).json()["source_url"] == clean
    assert add(client, url=dirty).status_code == 202
    assert client.get("/library", headers=H).json()["songs"][0]["source_url"] == clean


def test_new_endpoints_require_token(client):
    for method, path in [
        ("get", "/library"),
        ("get", "/tags"),
        ("post", "/preview"),
        ("post", "/songs"),
        ("patch", f"/songs/{VID}"),
        ("delete", f"/songs/{VID}"),
        ("get", f"/songs/{VID}/status"),
    ]:
        assert getattr(client, method)(path).status_code == 401, path


def test_empty_library(client):
    assert client.get("/library", headers=H).json() == {"songs": []}


def test_preview(client):
    r = client.post("/preview", json={"url": f"https://youtu.be/{VID}"}, headers=H)
    assert r.status_code == 200
    assert r.json()["title"] == "T" and r.json()["in_library"] is False
    assert client.post("/preview", json={"url": "http://x.y"}, headers=H).status_code == 422


def test_preview_failure_is_502(client, monkeypatch):
    def boom(vid):
        raise RuntimeError("Video unavailable")

    monkeypatch.setattr(extractor, "preview", boom)
    r = client.post("/preview", json={"url": VID}, headers=H)
    assert r.status_code == 502 and "unavailable" in r.json()["detail"]


def test_add_song_full_flow(client, tmp_path):
    r = add(client, tags=["80s", "Workout", "workout", " "])
    assert r.status_code == 202
    st = client.get(f"/songs/{VID}/status", headers=H).json()
    assert st["status"] == "done"
    songs = client.get("/library", headers=H).json()["songs"]
    assert len(songs) == 1
    s = songs[0]
    assert s["id"] == VID and s["title"] == "Song" and s["artist"] == "Yt Artist"
    assert s["cover"] == f"covers/{VID}.jpg" and s["duration"] == 7
    assert s["tags"] == ["80s", "Workout"]
    assert s["source_url"].endswith(VID) and s["added_at"].endswith("Z")
    assert json.loads((ODIR(tmp_path) / "library.json").read_text())["songs"][0]["id"] == VID
    assert client.get(f"/files/{VID}", headers=H).content == b"audio"
    assert client.get(f"/covers/{VID}", headers=H).content == b"jpg"
    assert client.get("/tags", headers=H).json() == [
        {"tag": "80s", "count": 1},
        {"tag": "Workout", "count": 1},
    ]


def test_duplicate_is_409(client):
    assert add(client).status_code == 202
    assert add(client).status_code == 409


def test_bad_url_is_422(client):
    assert client.post("/songs", json={"url": "nope"}, headers=H).status_code == 422


def test_download_error_status(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("\x1b[0;31mERROR:\x1b[0m Video unavailable")

    monkeypatch.setattr(extractor, "download_audio", boom)
    assert add(client).status_code == 202
    st = client.get(f"/songs/{VID}/status", headers=H).json()
    assert st["status"] == "error" and "Video unavailable" in st["error"]
    assert "\x1b" not in st["error"]
    assert client.get("/library", headers=H).json() == {"songs": []}


def test_cover_failure_is_not_fatal(client, monkeypatch):
    def boom(vid, dest, artwork=None):
        raise OSError("no network")

    monkeypatch.setattr(extractor, "fetch_cover", boom)
    add(client)
    s = client.get("/library", headers=H).json()["songs"][0]
    assert s["cover"] is None
    assert client.get(f"/covers/{VID}", headers=H).status_code == 404


def test_status_unknown_404(client):
    assert client.get(f"/songs/{VID}/status", headers=H).status_code == 404


def test_patch(client):
    add(client)
    body = {"artist": " New ", "year": 1999, "album": "", "tags": ["x", "X", "y"]}
    r = client.patch(f"/songs/{VID}", json=body, headers=H)
    assert r.status_code == 200
    s = r.json()
    assert s["artist"] == "New" and s["year"] == 1999 and s["album"] is None
    assert s["tags"] == ["x", "y", "decade:90s"] and s["title"] == "Song"
    assert client.get("/library", headers=H).json()["songs"][0]["artist"] == "New"
    assert client.patch(f"/songs/{VID}", json={"title": " "}, headers=H).status_code == 422
    assert client.patch(f"/songs/{VID2}", json={"title": "x"}, headers=H).status_code == 404


def test_delete(client, tmp_path):
    add(client)
    assert client.delete(f"/songs/{VID}", headers=H).status_code == 204
    assert client.get("/library", headers=H).json() == {"songs": []}
    assert not (ADIR(tmp_path) / f"{VID}.m4a").exists()
    assert not (ODIR(tmp_path) / "covers" / f"{VID}.jpg").exists()
    assert client.delete(f"/songs/{VID}", headers=H).status_code == 404
    assert add(client).status_code == 202


def test_query_token_on_files_and_covers_only(client):
    add(client)
    assert client.get(f"/files/{VID}", params={"token": "secret"}).status_code == 200
    assert client.get(f"/covers/{VID}", params={"token": "secret"}).status_code == 200
    assert client.get(f"/files/{VID}", params={"token": "bad"}).status_code == 401
    assert client.get(f"/covers/{VID}").status_code == 401
    assert client.get("/library", params={"token": "secret"}).status_code == 401


def test_atomic_save_survives_failure(tmp_path, monkeypatch):
    p = tmp_path / "library.json"
    library.save(p, [{"id": "a"}])

    def boom(*a, **k):
        raise OSError("disk")

    monkeypatch.setattr(library.json, "dump", boom)
    with pytest.raises(OSError):
        library.save(p, [{"id": "b"}])
    assert [s["id"] for s in library.load(p)] == ["a"]
    assert [f.name for f in tmp_path.iterdir()] == ["library.json"]


def test_static_ui_served_without_shadowing_api(tmp_path, monkeypatch):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<h1>ui</h1>")
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setenv("AUDIO_WEB_DIR", str(web))
    m = importlib.reload(main)
    try:
        c = TestClient(m.app)
        assert "ui" in c.get("/").text
        assert c.get("/health").json() == {"status": "ok", "sync": "ok"}
        assert c.get("/library").status_code == 401
    finally:
        monkeypatch.delenv("AUDIO_WEB_DIR")
        importlib.reload(main)


def test_clean_tags_normalises_namespaced():
    assert library.clean_tags(["Genre: Synth  Wave", "genre:synth wave", " Mood:Chill ", "80s", "80S", "a:", ":b", "mood:", " : ", " "]) == [
        "genre:synth wave", "mood:chill", "80s",
    ]


def test_old_genre_migrated_on_load(tmp_path):
    p = tmp_path / "library.json"
    p.write_text(json.dumps({"songs": [
        {"id": "a", "title": "A", "genre": "Synthwave", "tags": ["80s", "Genre:synthwave"]},
        {"id": "b", "title": "B", "genre": None},
        {"id": "c", "title": "C", "genre": " Pop ", "tags": []},
    ]}))
    a, b, c = library.load(p)
    assert a["tags"] == ["80s", "genre:synthwave"] and "genre" not in a
    assert "genre" not in b and "tags" not in b
    assert c["tags"] == ["genre:pop"]
    library.save(p, [a, b, c])
    assert all("genre" not in s for s in json.loads(p.read_text())["songs"])


def test_patch_normalises_and_ignores_genre(client):
    add(client)
    r = client.patch(f"/songs/{VID}", json={"genre": "Pop", "tags": ["Genre:Pop", "Mood: Chill", "genre:pop"]}, headers=H)
    assert r.status_code == 200 and "genre" not in r.json()
    assert r.json()["tags"] == ["genre:pop", "mood:chill"]
    assert client.get("/tags", headers=H).json() == [
        {"tag": "genre:pop", "count": 1},
        {"tag": "mood:chill", "count": 1},
    ]


def test_suggest_tags_from_ytdlp_metadata():
    assert extractor.suggest_tags({"genre": "Synth Pop"}) == ["genre:synth pop"]
    assert extractor.suggest_tags({"genre": "Rock, Pop"}) == ["genre:rock", "genre:pop"]
    assert extractor.suggest_tags({"categories": ["Music", "Film & Animation"]}) == []
    assert extractor.suggest_tags({}) == []


def test_preview_suggests_genre_tag_with_mocked_ytdlp(monkeypatch):
    class FakeYDL:
        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download=False):
            return {"title": "T", "uploader": "U", "genre": "Synthwave", "release_year": 2020, "duration": 5}

    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    meta = extractor.preview(VID)
    assert meta["tags"] == ["genre:synthwave"] and "genre" not in meta


def test_bpm_detected_on_add(client):
    add(client)
    assert client.get("/library", headers=H).json()["songs"][0]["bpm"] == 123


def test_bpm_from_add_form_skips_detection(client, monkeypatch):
    monkeypatch.setattr(bpm, "detect_bpm", lambda path: pytest.fail("must not run"))
    add(client, metadata={"title": "Song", "bpm": 98.55})
    assert client.get("/library", headers=H).json()["songs"][0]["bpm"] == 99


def test_bpm_detection_crash_does_not_fail_download(client, monkeypatch):
    def boom(path):
        raise RuntimeError("aubio exploded")

    monkeypatch.setattr(bpm, "detect_bpm", boom)
    add(client)
    st = client.get(f"/songs/{VID}/status", headers=H).json()
    assert st["status"] == "done"
    assert client.get("/library", headers=H).json()["songs"][0]["bpm"] is None


def test_bpm_none_when_undetectable(client, monkeypatch):
    monkeypatch.setattr(bpm, "detect_bpm", lambda path: None)
    add(client)
    assert client.get("/library", headers=H).json()["songs"][0]["bpm"] is None


def test_patch_bpm_validation(client):
    add(client)
    url = f"/songs/{VID}"
    assert client.patch(url, json={"bpm": 19.9}, headers=H).status_code == 422
    assert client.patch(url, json={"bpm": 300.1}, headers=H).status_code == 422
    assert client.patch(url, json={"bpm": "fast"}, headers=H).status_code == 422
    r = client.patch(url, json={"bpm": 128.04}, headers=H)
    assert r.status_code == 200 and r.json()["bpm"] == 128
    assert client.patch(url, json={"title": "X"}, headers=H).json()["bpm"] == 128
    assert client.patch(url, json={"bpm": None}, headers=H).json()["bpm"] is None


def test_redetect_bpm(client, monkeypatch):
    add(client)
    client.patch(f"/songs/{VID}", json={"bpm": 60}, headers=H)
    r = client.post(f"/songs/{VID}/bpm/detect", headers=H)
    assert r.status_code == 200 and r.json()["bpm"] == 123
    assert client.get("/library", headers=H).json()["songs"][0]["bpm"] == 123
    monkeypatch.setattr(bpm, "detect_bpm", lambda path: None)
    assert client.post(f"/songs/{VID}/bpm/detect", headers=H).status_code == 422
    assert client.get("/library", headers=H).json()["songs"][0]["bpm"] == 123
    assert client.post(f"/songs/{VID2}/bpm/detect", headers=H).status_code == 404


def test_old_song_without_bpm_loads(client, tmp_path):
    ODIR(tmp_path).mkdir(parents=True, exist_ok=True)
    (ODIR(tmp_path) / "library.json").write_text(json.dumps({"songs": [{"id": VID, "title": "Old"}]}))
    songs = client.get("/library", headers=H).json()["songs"]
    assert songs[0]["id"] == VID and "bpm" not in songs[0]
    assert client.patch(f"/songs/{VID}", json={"bpm": 100}, headers=H).json()["bpm"] == 100


def test_fractional_bpm_migrated_on_load():
    doc = library.normalize({"songs": [{"id": "a", "bpm": 132.1}, {"id": "b", "bpm": None}, {"id": "c"}]})
    assert [s.get("bpm") for s in doc["songs"]] == [132, None, None]
    assert isinstance(doc["songs"][0]["bpm"], int)


@pytest.mark.parametrize("year,tag", [
    (1949, None), (1950, "decade:50s"), (1994, "decade:90s"), (1999, "decade:90s"),
    (2000, "decade:00s"), (2007, "decade:00s"), (2013, "decade:10s"),
    (2029, "decade:20s"), (2030, None), (None, None), (True, None),
])
def test_decade_tag_derivation(year, tag):
    assert library.decade_tag(year) == tag


def test_with_decade_replaces_and_leaves_alone():
    assert library.with_decade(["rock", "decade:80s", "decade:70s"], 1994) == ["rock", "decade:90s"]
    assert library.with_decade(["rock"], 2007) == ["rock", "decade:00s"]
    assert library.with_decade(["decade:80s"], 1949) == ["decade:80s"]
    assert library.with_decade(["decade:80s"], None) == ["decade:80s"]


def test_decade_value_normalised_never_rejected():
    assert library.clean_tag("Decade:90S") == "decade:90s"
    assert library.clean_tag("decade:the 90s") == "decade:the90s"


def test_decade_migration_on_load(tmp_path):
    p = tmp_path / "library.json"
    p.write_text(json.dumps({"songs": [
        {"id": "a", "title": "A", "year": 1994},
        {"id": "b", "title": "B", "year": 2007, "tags": ["x", "decade:80s"]},
        {"id": "c", "title": "C", "year": 1949, "tags": ["decade:80s"]},
        {"id": "d", "title": "D"},
    ]}))
    a, b, c, d = library.load(p)
    assert a["tags"] == ["decade:90s"]
    assert b["tags"] == ["x", "decade:00s"]
    assert c["tags"] == ["decade:80s"]
    assert "tags" not in d


def test_decade_on_create_and_year_change(client):
    add(client, vid=VID2, metadata={"title": "Song", "year": 1994})
    assert client.get("/library", headers=H).json()["songs"][0]["tags"] == ["80s", "decade:90s"]
    add(client)
    assert client.get("/library", headers=H).json()["songs"][1]["tags"] == ["80s"]
    r = client.patch(f"/songs/{VID}", json={"year": 1994, "tags": ["x"]}, headers=H)
    assert r.json()["tags"] == ["x", "decade:90s"]
    r = client.patch(f"/songs/{VID}", json={"year": 2013}, headers=H)
    assert r.json()["tags"] == ["x", "decade:10s"]
    r = client.patch(f"/songs/{VID}", json={"tags": ["x", "decade:60s"]}, headers=H)
    assert r.json()["tags"] == ["x", "decade:10s"]
    r = client.patch(f"/songs/{VID}", json={"year": 2030}, headers=H)
    assert r.json()["tags"] == ["x", "decade:10s"]
    r = client.patch(f"/songs/{VID}", json={"year": None}, headers=H)
    assert r.json()["tags"] == ["x", "decade:10s"]


def test_web_assets_are_versioned_and_revalidated(tmp_path, monkeypatch):
    web = tmp_path / "web"
    (web / "js").mkdir(parents=True)
    (web / "index.html").write_text(
        '<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="style.css">'
        '<script type="module" src="js/app.js"></script><a href="https://example.com/style.css">x</a>'
    )
    (web / "tokens.css").write_text(":root{}")
    (web / "style.css").write_text("body{}")
    (web / "js" / "app.js").write_text("import './lib.js';")
    (web / "js" / "lib.js").write_text("export {};")
    (tmp_path / "secret.txt").write_text("secret")
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setenv("AUDIO_WEB_DIR", str(web))
    m = importlib.reload(main)
    try:
        c = TestClient(m.app)
        page = c.get("/")
        version = m.web_version()
        assert page.headers["cache-control"] == "no-cache"
        assert page.headers["etag"] == f'"{version}"'
        for name in ("tokens.css", "style.css", "js/app.js"):
            assert f'"_v/{version}/{name}"' in page.text
        assert 'href="https://example.com/style.css"' in page.text
        assert c.get("/", headers={"If-None-Match": f'"{version}"'}).status_code == 304

        asset = c.get(f"/_v/{version}/js/lib.js")
        assert asset.status_code == 200 and "immutable" in asset.headers["cache-control"]
        assert c.get("/_v/old/js/lib.js").headers["cache-control"] == "no-cache"
        assert c.get(f"/_v/{version}/%2e%2e/secret.txt").status_code == 404
        assert c.get(f"/_v/{version}/js/missing.js").status_code == 404
        assert "no-cache" in c.get("/style.css").headers["cache-control"]

        (web / "style.css").write_text("body{color:red}")
        assert m.web_version() != version
        assert c.get(f"/_v/{version}/style.css").headers["cache-control"] == "no-cache"
    finally:
        monkeypatch.delenv("AUDIO_WEB_DIR")
        importlib.reload(main)
