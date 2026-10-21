"""Trim on download (task-0045, ADR-0040): ffmpeg and yt-dlp are faked, so these tests check the commands, the contract and the stored recipe."""

import math
import subprocess
from pathlib import Path

import pytest

from app import deps, extractor, trim, users
from app.problems import Problem
from tests.test_library import H, VID, VID2, add, client  # noqa: F401


def song(client, vid=VID):
    return next(s for s in client.get("/library", headers=H).json()["songs"] if s["id"] == vid)


def stored_trim(client, vid=VID):
    first = song(client, vid)["sources"][0]
    return first.get("trim_start"), first.get("trim_end")


@pytest.fixture
def calls(monkeypatch):
    """Records every `download_audio` call; the fake writes the cut file and reports a 100 s source and a length from the trim."""
    seen = []

    def fake(video_id, out_dir, progress=None, source_url=None, trim=None):
        seen.append({"vid": video_id, "dir": out_dir, "trim": trim})
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"cut" if trim else b"whole")
        if not trim:
            return {"id": video_id, "title": "T", "artist": "A", "duration": 100}
        start, end = trim
        return {"id": video_id, "title": "T", "artist": "A", "duration": (end or 100) - (start or 0), "source_duration": 100, "trim": trim}

    monkeypatch.setattr(extractor, "download_audio", fake)
    return seen


class FakeFfmpeg:
    def __init__(self, monkeypatch, seconds=30.0):
        self.commands = []
        self.seconds = seconds
        monkeypatch.setattr(trim.subprocess, "run", self.run)

    def run(self, cmd, **kw):
        self.commands.append(cmd)
        if cmd[0] == "ffprobe":
            return subprocess.CompletedProcess(cmd, 0, stdout=f"{self.seconds}\n", stderr="")
        Path(cmd[-1]).write_bytes(b"encoded")
        return subprocess.CompletedProcess(cmd, 0, stdout=b"", stderr=b"")


def test_check_accepts_start_only_end_only_and_both():
    assert trim.check(12, None) == (12.0, None)
    assert trim.check(None, 90) == (None, 90.0)
    assert trim.check(12.5, 90) == (12.5, 90.0)
    assert trim.check(None, None) == (None, None)
    assert trim.check(0, None) == (None, None)


def test_check_clamps_the_end_to_the_source_duration():
    assert trim.check(10, 500, 200) == (10.0, 200.0)
    assert trim.check(None, 500, 200) == (None, 200.0)


@pytest.mark.parametrize("start,end,duration,code", [
    (30, 30, None, "invalid_trim"),
    (40, 30, None, "invalid_trim"),
    (-1, 30, None, "invalid_trim"),
    (None, -5, None, "invalid_trim"),
    (float("nan"), None, None, "invalid_trim"),
    (True, None, None, "invalid_trim"),
    ("5", None, None, "invalid_trim"),
    (200, None, 200, "invalid_trim"),
    (250, 300, 200, "invalid_trim"),
    (10, 10.5, None, "trim_too_short"),
    (199.5, None, 200, "trim_too_short"),
    (None, 0.5, None, "trim_too_short"),
])
def test_check_refuses_with_a_clear_422(start, end, duration, code):
    with pytest.raises(Problem) as info:
        trim.check(start, end, duration)
    assert info.value.status == 422
    assert info.value.code == code
    assert info.value.detail


def test_encode_command_start_only():
    cmd = trim.encode_command(Path("in.m4a"), Path("out.m4a"), (12.5, None))
    assert cmd[:6] == ["ffmpeg", "-y", "-v", "error", "-i", "in.m4a"]
    assert cmd[cmd.index("-ss") + 1] == "12.5"
    assert "-to" not in cmd
    assert cmd[-1] == "out.m4a"


def test_encode_command_end_only():
    cmd = trim.encode_command(Path("in.m4a"), Path("out.m4a"), (None, 90))
    assert "-ss" not in cmd
    assert cmd[cmd.index("-to") + 1] == "90"


def test_encode_command_both_and_always_reencodes_to_aac():
    cmd = trim.encode_command(Path("in.m4a"), Path("out.m4a"), (12, 90))
    assert cmd.index("-ss") < cmd.index("-to")
    assert cmd[cmd.index("-c:a") + 1] == "aac"
    assert "copy" not in cmd
    assert "-vn" in cmd


def test_reencode_replaces_the_file_and_reports_its_length(tmp_path, monkeypatch):
    fake = FakeFfmpeg(monkeypatch, seconds=78.0)
    path = tmp_path / "a.m4a"
    path.write_bytes(b"source")
    assert trim.reencode(path, (12, 90)) == 78.0
    assert path.read_bytes() == b"encoded"
    assert not (tmp_path / "a.trim.m4a").exists()
    assert fake.commands[0][-1].endswith("a.trim.m4a")
    assert fake.commands[1][0] == "ffprobe"


def test_reencode_failure_keeps_the_source_and_raises(tmp_path, monkeypatch):
    def boom(cmd, **kw):
        raise subprocess.CalledProcessError(1, cmd, stderr=b"Invalid data found")

    monkeypatch.setattr(trim.subprocess, "run", boom)
    path = tmp_path / "a.m4a"
    path.write_bytes(b"source")
    with pytest.raises(RuntimeError, match="Invalid data found"):
        trim.reencode(path, (1, 5))
    assert path.read_bytes() == b"source"
    assert not (tmp_path / "a.trim.m4a").exists()


class FakeYdl:
    opts = None
    info = {"id": VID, "title": "T", "uploader": "U", "duration": 200}

    def __init__(self, opts):
        FakeYdl.opts = opts
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=True):
        out = Path(self.opts["outtmpl"].replace("%(ext)s", "m4a"))
        out.write_bytes(b"section" if "download_ranges" in self.opts else b"whole")
        return dict(FakeYdl.info)


def test_youtube_trim_uses_download_ranges_then_reencodes_without_cutting(tmp_path, monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYdl)
    fake = FakeFfmpeg(monkeypatch, seconds=78.0)
    info = extractor.download_audio(VID, tmp_path, None, None, trim=(12, 90))
    assert FakeYdl.opts["force_keyframes_at_cuts"] is True
    assert callable(FakeYdl.opts["download_ranges"])
    encode = next(c for c in fake.commands if c[0] == "ffmpeg")
    assert "-ss" not in encode and "-to" not in encode
    assert info["duration"] == 78.0
    assert info["source_duration"] == 200
    assert info["trim"] == (12.0, 90.0)
    assert (tmp_path / f"{VID}.m4a").read_bytes() == b"encoded"


def test_youtube_trim_start_only_has_an_open_end(tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr(extractor.yt_dlp.utils, "download_range_func", lambda chapters, ranges: seen.setdefault("ranges", ranges) or (lambda *a: []))
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYdl)
    FakeFfmpeg(monkeypatch, seconds=50.0)
    extractor.download_audio(VID, tmp_path, None, None, trim=(150, None))
    assert seen["ranges"] == [(150.0, math.inf)]


def test_youtube_trim_end_only_starts_at_zero(tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr(extractor.yt_dlp.utils, "download_range_func", lambda chapters, ranges: seen.setdefault("ranges", ranges) or (lambda *a: []))
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYdl)
    FakeFfmpeg(monkeypatch, seconds=60.0)
    extractor.download_audio(VID, tmp_path, None, None, trim=(None, 60))
    assert seen["ranges"] == [(0.0, 60.0)]


def test_youtube_trim_clamps_the_end_and_refuses_a_start_beyond_the_source(tmp_path, monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYdl)
    FakeFfmpeg(monkeypatch, seconds=100.0)
    info = extractor.download_audio(VID, tmp_path, None, None, trim=(100, 900))
    assert info["trim"] == (100.0, 200.0)
    with pytest.raises(Problem) as err:
        extractor.download_audio(VID, tmp_path, None, None, trim=(250, None))
    assert err.value.code == "invalid_trim"


def test_untrimmed_youtube_download_has_no_sections_and_no_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYdl)
    fake = FakeFfmpeg(monkeypatch)
    info = extractor.download_audio(VID, tmp_path)
    assert "download_ranges" not in FakeYdl.opts and "force_keyframes_at_cuts" not in FakeYdl.opts
    assert fake.commands == []
    assert info["duration"] == 200 and "trim" not in info
    assert (tmp_path / f"{VID}.m4a").read_bytes() == b"whole"
    extractor.download_audio(VID, tmp_path, trim=(None, None))
    assert fake.commands == []


def test_soundcloud_trim_downloads_everything_then_cuts_with_ffmpeg(tmp_path, monkeypatch):
    sc = "soundcloud-123456"
    monkeypatch.setattr(extractor, "_download_soundcloud", lambda *a: (tmp_path.joinpath(f"{sc}.m4a").write_bytes(b"whole"), {"id": sc, "duration": 240})[1])
    fake = FakeFfmpeg(monkeypatch, seconds=60.0)
    info = extractor.download_audio(sc, tmp_path, None, None, trim=(30, 90))
    encode = next(c for c in fake.commands if c[0] == "ffmpeg")
    assert encode[encode.index("-ss") + 1] == "30" and encode[encode.index("-to") + 1] == "90"
    assert info["duration"] == 60.0 and info["source_duration"] == 240


def test_duration_falls_back_to_the_cut_arithmetic_when_ffprobe_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYdl)
    fake = FakeFfmpeg(monkeypatch)
    real = fake.run

    def run(cmd, **kw):
        if cmd[0] == "ffprobe":
            raise OSError("no ffprobe")
        return real(cmd, **kw)

    monkeypatch.setattr(trim.subprocess, "run", run)
    info = extractor.download_audio(VID, tmp_path, None, None, trim=(10, 70))
    assert info["duration"] == 60.0


def test_add_with_a_trim_downloads_the_cut_and_stores_the_recipe(client, calls):
    assert add(client, trim={"start": 12, "end": 90}).status_code == 202
    assert calls[0]["trim"] == (12.0, 90.0)
    s = song(client)
    assert s["duration"] == 78
    assert stored_trim(client) == (12, 90)
    assert (deps.audio_dir(users.owner_uid()) / f"{VID}.m4a").read_bytes() == b"cut"


def test_add_with_a_start_only_trim(client, calls):
    assert add(client, trim={"start": 30}).status_code == 202
    assert calls[0]["trim"] == (30.0, None)
    assert stored_trim(client) == (30, None)
    assert song(client)["duration"] == 70


def test_add_without_a_trim_is_the_old_call_and_stores_none(client, monkeypatch):
    seen = []

    def strict(video_id, out_dir, progress=None, source_url=None):
        seen.append(video_id)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"whole")
        return {"id": video_id, "title": "T", "artist": "A", "duration": 100}

    monkeypatch.setattr(extractor, "download_audio", strict)
    assert add(client).status_code == 202
    assert seen == [VID]
    assert stored_trim(client) == (None, None)
    assert song(client)["duration"] == 100


@pytest.mark.parametrize("trim_body", [
    {"start": 30, "end": 30}, {"start": 40, "end": 20}, {"start": -1}, {"start": 10, "end": 10.4},
])
def test_add_with_an_invalid_trim_is_422_and_adds_nothing(client, calls, trim_body):
    r = add(client, trim=trim_body)
    assert r.status_code == 422
    assert client.get("/library", headers=H).json()["songs"] == []
    assert calls == []


def test_fetch_audio_uses_the_stored_trim_and_a_request_override_is_persisted(client, calls):
    assert add(client, audio=False, trim={"start": 10, "end": 50}).status_code == 201
    assert stored_trim(client) == (10, 50)
    assert client.post(f"/songs/{VID}/audio", headers=H).status_code == 202
    assert calls[-1]["trim"] == (10, 50)
    assert song(client)["duration"] == 40
    assert add(client, VID2, audio=False).status_code == 201
    r = client.post(f"/songs/{VID2}/audio", json={"trim": {"start": 2, "end": 8}}, headers=H)
    assert r.status_code == 202
    assert calls[-1]["trim"] == (2.0, 8.0)
    assert stored_trim(client, VID2) == (2, 8)
    assert song(client, VID2)["duration"] == 6


def test_fetch_audio_without_trim_keeps_the_old_call(client, calls):
    assert add(client, audio=False).status_code == 201
    client.post(f"/songs/{VID}/audio", headers=H)
    assert calls[-1]["trim"] is None


def test_redownload_applies_the_stored_trim_and_replaces_the_file(client, calls):
    assert add(client).status_code == 202
    assert song(client)["duration"] == 100
    path = deps.audio_dir(users.owner_uid()) / f"{VID}.m4a"
    assert path.read_bytes() == b"whole"
    r = client.post(f"/songs/{VID}/redownload", json={"trim": {"start": 20, "end": 80}}, headers=H)
    assert r.status_code == 202
    assert calls[-1]["trim"] == (20.0, 80.0)
    assert path.read_bytes() == b"cut"
    s = song(client)
    assert s["duration"] == 60
    assert s["bpm"] == 123
    assert stored_trim(client) == (20, 80)
    assert not [p for p in path.parent.iterdir() if p.name.startswith(".redownload")]
    assert client.post(f"/songs/{VID}/redownload", headers=H).status_code == 202
    assert calls[-1]["trim"] == (20, 80)


def test_redownload_can_clear_the_trim(client, calls):
    assert add(client, trim={"start": 20, "end": 80}).status_code == 202
    r = client.post(f"/songs/{VID}/redownload", json={"trim": {"start": None, "end": None}}, headers=H)
    assert r.status_code == 202
    assert calls[-1]["trim"] is None
    assert stored_trim(client) == (None, None)
    assert song(client)["duration"] == 100


def test_redownload_refreshes_the_automatic_cover_version(client, calls):
    assert add(client).status_code == 202
    before = song(client).get("cover_v")
    client.post(f"/songs/{VID}/redownload", headers=H)
    after = song(client).get("cover_v")
    assert after and after != before


def test_redownload_keeps_the_old_file_when_the_new_download_fails(client, calls, monkeypatch):
    assert add(client).status_code == 202
    path = deps.audio_dir(users.owner_uid()) / f"{VID}.m4a"

    def broken(*a, **k):
        raise RuntimeError("network down")

    monkeypatch.setattr(extractor, "download_audio", broken)
    assert client.post(f"/songs/{VID}/redownload", json={"trim": {"start": 5}}, headers=H).status_code == 202
    assert client.get(f"/songs/{VID}/status", headers=H).json()["status"] == "error"
    assert path.read_bytes() == b"whole"
    assert stored_trim(client) == (None, None)
    assert not [p for p in path.parent.iterdir() if p.name.startswith(".redownload")]


def test_redownload_refuses_a_concurrent_download_of_the_same_song(client, calls):
    assert add(client).status_code == 202
    deps.JOBS[(users.owner_uid(), VID)] = {"status": "downloading", "progress": 0.3, "error": None}
    n = len(calls)
    assert client.post(f"/songs/{VID}/redownload", headers=H).status_code == 409
    assert len(calls) == n


def test_redownload_validates_the_trim_and_the_song(client, calls):
    assert client.post(f"/songs/{VID}/redownload", headers=H).status_code == 404
    assert add(client).status_code == 202
    assert client.post(f"/songs/{VID}/redownload", json={"trim": {"start": 50, "end": 20}}, headers=H).status_code == 422
    assert client.post(f"/songs/{VID}/redownload", json={"trim": {"start": 500}}, headers=H).status_code == 422
    assert client.post(f"/songs/{VID}/redownload", json={"trim": {"start": 99.5}}, headers=H).status_code == 422
    r = client.post(f"/songs/{VID}/redownload", json={"trim": {"start": 10, "end": 500}}, headers=H)
    assert r.status_code == 202
    assert calls[-1]["trim"] == (10.0, 100.0)
    assert stored_trim(client) == (10, 100)


def test_legacy_download_passes_the_trim_and_persists_it_on_an_existing_song(client, monkeypatch):
    seen = []

    def fake(video_id, out_dir, trim=None):
        seen.append(trim)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"cut")
        return {"id": video_id, "title": "T", "artist": "A", "duration": 60 if trim else 100, "source_duration": 100, "trim": trim}

    monkeypatch.setattr(extractor, "download", fake)
    assert add(client, audio=False).status_code == 201
    r = client.post("/download", json={"video_id": VID, "trim": {"start": 1, "end": 8}}, headers=H)
    assert r.status_code == 200
    assert r.json()["duration"] == 60 and "trim" not in r.json()
    assert seen == [(1.0, 8.0)]
    assert stored_trim(client) == (1, 8)
    assert song(client)["duration"] == 60
    assert client.post("/download", json={"video_id": VID}, headers=H).status_code == 200
    assert seen[-1] == (1, 8)


def test_legacy_download_without_trim_is_unchanged(client, monkeypatch):
    seen = []

    def strict(video_id, out_dir):
        seen.append(video_id)
        out_dir.mkdir(parents=True, exist_ok=True)
        return {"id": video_id, "title": "T", "artist": "A", "duration": 100}

    monkeypatch.setattr(extractor, "download", strict)
    assert client.post("/download", json={"video_id": VID}, headers=H).status_code == 200
    assert seen == [VID]
    assert client.post("/download", json={"video_id": VID2, "trim": {"start": 9, "end": 9}}, headers=H).status_code == 422
