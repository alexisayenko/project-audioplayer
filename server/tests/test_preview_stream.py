import json

import pytest
from fastapi.testclient import TestClient

from app import deps, extractor, main
from app.routes import lookup

VID = "dQw4w9WgXcQ"
H = {"X-API-Token": "secret"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(deps, "DOWNLOAD_DIR", tmp_path / "downloads")
    monkeypatch.setattr(deps, "DATA_DIR", tmp_path)
    monkeypatch.setattr(deps, "JOBS", {})
    monkeypatch.setattr(
        extractor, "preview",
        lambda vid: {"id": vid, "source_url": extractor.watch_url(vid), "title": "T", "artist": "A", "album": None, "year": None, "tags": [], "duration": 9, "thumbnail": ""},
    )
    return TestClient(main.app)


def events(resp):
    return [json.loads(line) for line in resp.text.splitlines() if line]


def test_stream_reports_every_stage_in_order_then_the_result(client):
    r = client.post("/preview/stream", json={"url": f"https://youtu.be/{VID}"}, headers=H)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/x-ndjson")
    evs = events(r)
    assert evs[0]["event"] == "stages"
    ids = [s["id"] for s in evs[0]["stages"]]
    assert ids == ["link", "details", "genres", "wiki", "discogs"]
    assert all(s["label"] for s in evs[0]["stages"])
    steps = [(e["id"], e["state"]) for e in evs if e["event"] == "stage"]
    assert steps == [(i, st) for i in ids for st in ("start", "done")]
    assert evs[-1]["event"] == "result"


def test_stream_result_equals_the_plain_preview(client):
    plain = client.post("/preview", json={"url": f"https://youtu.be/{VID}"}, headers=H).json()
    streamed = events(client.post("/preview/stream", json={"url": f"https://youtu.be/{VID}"}, headers=H))[-1]["data"]
    assert streamed == plain


def test_stream_refused_link_is_an_error_event_at_the_first_step(client):
    evs = events(client.post("/preview/stream", json={"url": "http://x.y"}, headers=H))
    err = evs[-1]
    assert err["event"] == "error"
    assert err["stage"] == "link"
    assert err["status"] == 422
    assert err["error"] == "unsupported"
    assert not any(e["event"] == "result" for e in evs)


def test_stream_extractor_failure_names_the_details_step(client, monkeypatch):
    def boom(vid):
        raise RuntimeError("ERROR: Video unavailable")

    monkeypatch.setattr(extractor, "preview", boom)
    err = events(client.post("/preview/stream", json={"url": VID}, headers=H))[-1]
    assert err["stage"] == "details"
    assert err["status"] == 502
    assert "Video unavailable" in err["detail"]


def test_stream_lookup_failure_names_the_failing_step(client, monkeypatch):
    def boom(artist, title):
        raise RuntimeError("wiki down")

    monkeypatch.setattr(lookup.wiki_lookup, "suggest", boom)
    evs = events(client.post("/preview/stream", json={"url": VID}, headers=H))
    assert evs[-1]["event"] == "error"
    assert evs[-1]["stage"] == "wiki"
    assert ("genres", "done") in [(e.get("id"), e.get("state")) for e in evs]


def test_stream_requires_the_token(client):
    assert client.post("/preview/stream", json={"url": VID}).status_code == 401
