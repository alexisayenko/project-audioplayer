"""The album-from-video flow end to end over HTTP, the way the web client drives it: preview, create, poll the job; only yt-dlp and ffmpeg are faked."""

import pytest

from app import deps, extractor, limits, playlist_import, previewcache, video_split
from tests.test_library import H, client  # noqa: F401
from tests import test_video_split
from tests.test_video_split import Tools

VID = "yeUFSnA9Puk"
URL = f"https://www.youtube.com/watch?v={VID}"
TEXT = "00:00 Alpha - One\n05:00 Beta - Two (Remix)\n10:30 Alpha - Three\n"
THUMB = f"https://i.ytimg.com/vi/{VID}/hqdefault.jpg"
DETAILS = {"id": VID, "title": "Various - Forest Mix (Full Album) 2019", "uploader": "Chan", "duration": 900.0,
           "thumbnail": THUMB, "description": "", "chapters": []}


@pytest.fixture
def flow(client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(video_split, "STAGE_TTL", 3600)
    monkeypatch.setattr(test_video_split, "SOURCE_SECONDS", DETAILS["duration"])
    tools = Tools(monkeypatch)
    monkeypatch.setattr(extractor, "video_details", lambda video_id: DETAILS)
    monkeypatch.setattr(deps.SCHED, "inline", True)
    monkeypatch.setattr("app.album_covers.auto", lambda uid, record: None)
    playlist_import.reset_limits()
    limits.RATE.reset()
    previewcache.clear()
    return tools


def create_body(preview):
    rows = [{"include": True, "start": t["start"], "end": t["end"], "artists": t["artists"], "title": t["title"], "version": t["version"],
             "trackNo": i + 1, "useExistingSongId": None} for i, t in enumerate(preview["tracks"])]
    return {"url": preview["url"], "album": {**preview["album"], "genres": ["Psytrance"]}, "tracks": rows, "fades": True}


def test_preview_text_then_create_then_poll_gives_songs_with_audio(client, flow):
    pasted = client.post("/albums/from-video/preview", json={"url": URL}, headers=H)
    assert (pasted.status_code, pasted.json()["detail"]) == (422, "no tracklist found")

    r = client.post("/albums/from-video/preview-text", json={"url": URL, "text": TEXT}, headers=H)
    assert r.status_code == 200, r.text
    preview = r.json()
    assert (preview["videoId"], preview["source"], preview["duration"], len(preview["tracks"])) == (VID, "pasted", 900.0, 3)
    assert preview["tracks"][2]["end"] == 900.0 and preview["album"]["coverUrl"] == THUMB

    made = client.post("/albums/from-video", json=create_body(preview), headers=H)
    assert made.status_code == 202, made.text
    data = made.json()
    assert len(data["songIds"]) == 3

    job = client.get(f"/jobs/{data['jobId']}", headers=H).json()
    assert (job["state"], job["done"], job["total"], job["failed"]) == ("done", 3, 3, [])

    songs = {s["id"]: s for s in client.get("/library", headers=H).json()["songs"]}
    assert [songs[i]["audio_state"] for i in data["songIds"]] == ["server"] * 3
    assert [songs[i]["title"] for i in data["songIds"]] == ["One", "Two", "Three"]
    album = client.get(f"/albums/{data['albumId']}", headers=H).json()
    assert [t["songId"] for t in album["tracks"]] == data["songIds"]
    assert len(flow.downloads) == 1 and len(flow.cuts) == 3
    assert any("afade" in " ".join(cmd) for cmd in flow.cuts)

    again = client.post("/albums/from-video", json=create_body(preview), headers=H)
    assert (again.status_code, again.json()) == (202, data)
    assert len(flow.downloads) == 1


def test_preview_from_the_description_then_create(client, flow, monkeypatch):
    monkeypatch.setattr(extractor, "video_details", lambda video_id: {**DETAILS, "description": TEXT})
    preview = client.post("/albums/from-video/preview", json={"url": URL}, headers=H).json()
    assert preview["source"] == "description"
    data = client.post("/albums/from-video", json=create_body(preview), headers=H).json()
    job = client.get(f"/jobs/{data['jobId']}", headers=H).json()
    assert (job["state"], job["done"]) == ("done", 3)
    songs = {s["id"]: s for s in client.get("/library", headers=H).json()["songs"]}
    assert {songs[i]["audio_state"] for i in data["songIds"]} == {"server"}


def test_unauthenticated_calls_are_401(client, flow):
    assert client.post("/albums/from-video/preview-text", json={"url": URL, "text": TEXT}).status_code == 401
    assert client.post("/albums/from-video", json={"url": URL}).status_code == 401
    assert client.get("/jobs/split_x").status_code == 401
