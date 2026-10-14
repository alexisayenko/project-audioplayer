from app import deps, extractor, jobs
from tests.test_fetch_audio import add_meta
from pathlib import Path

from tests.test_library import VID, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, uid, who  # noqa: F401


def hooked(events):
    """A download_audio stand-in that runs the real yt-dlp hook logic against scripted events."""
    class FakeYDL:
        def __init__(self, opts):
            self.hooks = opts["progress_hooks"]

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download=True):
            for ev in events:
                for h in self.hooks:
                    h(ev)
            return {"duration": 9, "title": "T", "uploader": "U"}
    return FakeYDL


def test_public_maps_states_and_clamps_percent():
    q = jobs.public({"status": "queued", "progress": 0.0, "error": None})
    assert (q["state"], q["percent"], q["speed"], q["eta"], q["error_code"]) == ("queued", 0, None, None, None)
    d = jobs.public({"status": "downloading", "progress": 0.426, "speed": 1000, "eta": 7, "error": None})
    assert (d["state"], d["percent"], d["speed"], d["eta"], d["progress"]) == ("downloading", 43, 1000, 7, 0.426)
    over = jobs.public({"status": "downloading", "progress": 7.0})
    assert over["percent"] == 100
    c = jobs.public({"status": "downloading", "progress": 1.0, "converting": True, "speed": 5, "eta": 1})
    assert (c["state"], c["percent"], c["speed"], c["eta"], c["status"]) == ("converting", 100, None, None, "downloading")
    assert "converting" not in c
    f = jobs.public({"status": "error", "progress": 0.3, "error": "boom", "code": "preview_only"})
    assert (f["state"], f["error"], f["error_code"], f["status"]) == ("failed", "boom", "preview_only", "error")
    assert jobs.public({"status": "done", "progress": 1.0})["percent"] == 100


def test_extractor_hook_feeds_tracker(monkeypatch):
    events = [
        {"status": "downloading", "downloaded_bytes": 250, "total_bytes": 1000, "speed": 500.0, "eta": 2},
        {"status": "downloading", "downloaded_bytes": 600, "total_bytes_estimate": 1200, "speed": None, "eta": None},
        {"status": "finished", "downloaded_bytes": 1000, "total_bytes": 1000},
    ]
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", hooked(events))
    job = {"status": "downloading", "progress": 0.0}
    seen = []

    class Spy(jobs.Tracker):
        def __call__(self, p):
            super().__call__(p)
            seen.append(jobs.public(job))
    extractor.download_audio(VID, Path("."), Spy(job))
    assert [(s["state"], s["percent"]) for s in seen] == [("downloading", 25), ("downloading", 50)]
    assert seen[0]["speed"] == 500
    assert seen[0]["eta"] == 2
    assert jobs.public(job)["state"] == "converting"


def test_status_endpoint_exposes_progress_per_user(multi, monkeypatch):
    a, b = who(multi, ALICE), who(multi, BOB)
    add_meta(multi, a)
    snaps = []

    def fake(video_id, out_dir, progress=None, source_url=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"audio")
        job = next(j for (u, v), j in deps.JOBS.items() if v == video_id)
        progress(0.42)
        progress.detail(2048.7, 5.2)
        snaps.append(jobs.public(job))
        progress.converting()
        snaps.append(jobs.public(job))
        return {"id": video_id, "title": "T", "artist": "A", "duration": 5}

    monkeypatch.setattr(extractor, "download_audio", fake)
    assert multi.post(f"/songs/{VID}/audio", headers=a).status_code == 202
    assert (snaps[0]["state"], snaps[0]["percent"], snaps[0]["speed"], snaps[0]["eta"]) == ("downloading", 42, 2048, 5)
    assert (snaps[1]["state"], snaps[1]["percent"]) == ("converting", 100)
    done = multi.get(f"/songs/{VID}/status", headers=a).json()
    assert done["status"] == "done"
    assert done["state"] == "done"
    assert done["percent"] == 100
    assert done["progress"] == 1.0
    assert done["speed"] is None
    assert done["error_code"] is None
    assert multi.get(f"/songs/{VID}/status", headers=b).status_code == 404


def test_failed_status_carries_code_and_message(multi, monkeypatch):
    a = who(multi, ALICE)
    add_meta(multi, a)

    def boom(*args, **kwargs):
        raise extractor.PreviewOnly()

    monkeypatch.setattr(extractor, "download_audio", boom)
    multi.post(f"/songs/{VID}/audio", headers=a)
    s = multi.get(f"/songs/{VID}/status", headers=a).json()
    assert s["status"] == "error"
    assert s["state"] == "failed"
    assert s["error_code"] == "preview_only"
    assert s["error"]
