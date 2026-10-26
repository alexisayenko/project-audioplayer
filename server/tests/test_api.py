import pytest
from fastapi.testclient import TestClient

from app import deps, extractor, links, main

VID = "dQw4w9WgXcQ"
HEADERS = {"X-API-Token": "secret"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(deps, "DOWNLOAD_DIR", tmp_path)
    monkeypatch.setattr(deps, "DATA_DIR", tmp_path / "data")
    return TestClient(main.app)


def test_search(client, monkeypatch):
    monkeypatch.setattr(extractor, "search", lambda q, n: [{"id": VID, "title": q}])
    r = client.get("/search", params={"q": "song"}, headers=HEADERS)
    assert r.status_code == 200
    assert r.json()[0]["id"] == VID


def test_download_then_fetch(client, monkeypatch, tmp_path):
    def fake_download(video_id, out_dir):
        (out_dir / f"{video_id}.m4a").write_bytes(b"audio")
        return {"id": video_id, "title": "t", "artist": "a", "duration": 1, "thumbnail": ""}

    monkeypatch.setattr(extractor, "download", fake_download)
    r = client.post("/download", json={"video_id": VID}, headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["file_url"] == f"/files/{VID}"
    f = client.get(f"/files/{VID}", headers=HEADERS)
    assert f.status_code == 200
    assert f.content == b"audio"


def test_rejects_bad_video_id(client):
    r = client.post("/download", json={"video_id": "--exec=rm"}, headers=HEADERS)
    assert r.status_code == 422
    assert client.get("/files/..%2Fetc", headers=HEADERS).status_code in (404, 422)


def test_missing_file_404(client):
    assert client.get(f"/files/{VID}", headers=HEADERS).status_code == 404


@pytest.mark.parametrize(
    "msg,expected",
    [
        ("ERROR: [youtube] abc: Sign in to confirm. Use --cookies-from-browser or --cookies for auth", "Sign in to confirm."),
        ("ERROR: Video unavailable. See https://example.com/faq for more", "Video unavailable."),
        ("Seeing things. See   http://x.y", "Seeing things."),
        ("See https://x.y at start", "See https://x.y at start"),
        ("Use --cookies first", "Use --cookies first"),
        ("See the docs. Use --cookies", "See the docs."),
        ("plain\x1b[31m red\x1b[0m", "plain red"),
        ("xUse --cookies later", "xUse --cookies later"),
        ("a See b See https://x.y", "a See b"),
        ("See\thttps://x.y", "See\thttps://x.y"),
        ("Seeing https://x.y", "Seeing https://x.y"),
        ("", ""),
    ],
)
def test_short_cuts_hints(msg, expected):
    assert links.short_error(Exception(msg)) == expected
