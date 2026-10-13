import pytest
from fastapi.testclient import TestClient

from app import extractor, main

VID = "dQw4w9WgXcQ"
HEADERS = {"X-API-Token": "secret"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(main, "DOWNLOAD_DIR", tmp_path)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path / "data")
    return TestClient(main.app)


def test_requires_token(client):
    assert client.get("/search", params={"q": "x"}).status_code == 401
    assert client.get("/search", params={"q": "x"}, headers={"X-API-Token": "no"}).status_code == 401


def test_unconfigured_token_is_refused(client, monkeypatch):
    monkeypatch.delenv("AUDIO_API_TOKEN")
    assert client.get("/search", params={"q": "x"}, headers=HEADERS).status_code == 503


def test_search(client, monkeypatch):
    monkeypatch.setattr(extractor, "search", lambda q, n: [{"id": VID, "title": q}])
    r = client.get("/search", params={"q": "song"}, headers=HEADERS)
    assert r.status_code == 200 and r.json()[0]["id"] == VID


def test_download_then_fetch(client, monkeypatch, tmp_path):
    def fake_download(video_id, out_dir):
        (out_dir / f"{video_id}.m4a").write_bytes(b"audio")
        return {"id": video_id, "title": "t", "artist": "a", "duration": 1, "thumbnail": ""}

    monkeypatch.setattr(extractor, "download", fake_download)
    r = client.post("/download", json={"video_id": VID}, headers=HEADERS)
    assert r.status_code == 200 and r.json()["file_url"] == f"/files/{VID}"
    f = client.get(f"/files/{VID}", headers=HEADERS)
    assert f.status_code == 200 and f.content == b"audio"


def test_rejects_bad_video_id(client):
    r = client.post("/download", json={"video_id": "--exec=rm"}, headers=HEADERS)
    assert r.status_code == 422
    assert client.get("/files/..%2Fetc", headers=HEADERS).status_code in (404, 422)


def test_missing_file_404(client):
    assert client.get(f"/files/{VID}", headers=HEADERS).status_code == 404
