import importlib
import json

import pytest
from fastapi.testclient import TestClient

from app import extractor, library, main

VID = "dQw4w9WgXcQ"
VID2 = "9bZkp7q19f0"
H = {"X-API-Token": "secret"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(main, "DOWNLOAD_DIR", tmp_path / "downloads")
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "JOBS", {})

    def fake_download(video_id, out_dir, progress=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"audio")
        if progress:
            progress(0.5)
        return {"id": video_id, "title": "Yt Title", "artist": "Yt Artist", "duration": 7}

    def fake_cover(video_id, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"jpg")

    monkeypatch.setattr(extractor, "download_audio", fake_download)
    monkeypatch.setattr(extractor, "fetch_cover", fake_cover)
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
            "genre": None,
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
    assert json.loads((tmp_path / "library.json").read_text())["songs"][0]["id"] == VID
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
    def boom(vid, dest):
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
    assert s["tags"] == ["x", "y"] and s["title"] == "Song"
    assert client.get("/library", headers=H).json()["songs"][0]["artist"] == "New"
    assert client.patch(f"/songs/{VID}", json={"title": " "}, headers=H).status_code == 422
    assert client.patch(f"/songs/{VID2}", json={"title": "x"}, headers=H).status_code == 404


def test_delete(client, tmp_path):
    add(client)
    assert client.delete(f"/songs/{VID}", headers=H).status_code == 204
    assert client.get("/library", headers=H).json() == {"songs": []}
    assert not (tmp_path / "downloads" / f"{VID}.m4a").exists()
    assert not (tmp_path / "covers" / f"{VID}.jpg").exists()
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
    assert library.load(p) == [{"id": "a"}]
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
        assert c.get("/health").json() == {"status": "ok"}
        assert c.get("/library").status_code == 401
    finally:
        monkeypatch.delenv("AUDIO_WEB_DIR")
        importlib.reload(main)
