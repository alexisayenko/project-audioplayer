"""Split job of an album made from a time-coded video (task-0038 phase 1B): yt-dlp and ffmpeg are faked, so these tests check the commands, the bookkeeping, the quotas and the cleanup."""

import subprocess
import time
from pathlib import Path

import pytest

from app import deps, extractor, library, limits, users, video_split
from app.problems import Problem
from tests.test_library import OWNER_UID, client  # noqa: F401

VIDEO = "mixVideo123"
SOURCE_SECONDS = 300.0
TRACKS = [
    {"songId": "trk_a", "start": 0.0, "end": 100.0, "title": "One", "artists": ["Alpha", "Beta"], "trackNo": 1, "version": None},
    {"songId": "trk_b", "start": 100.0, "end": 200.0, "title": "Two", "artists": ["Gamma"], "trackNo": 2, "version": "Remix"},
    {"songId": "trk_c", "start": 200.0, "end": None, "title": "Three", "artists": [], "trackNo": 3, "version": None},
]
ALBUM = {"title": "Night Mix", "albumArtist": "Various Artists", "year": 2020}


class Tools:
    """Fakes yt-dlp (`download_audio`) and ffmpeg/ffprobe (`subprocess.run`)."""

    def __init__(self, monkeypatch):
        self.downloads = []
        self.cuts = []
        self.fail_on = set()
        self.fail_download = None
        self.sized = False
        self.lengths = {}
        monkeypatch.setattr(extractor, "download_audio", self.download)
        monkeypatch.setattr(video_split.subprocess, "run", self.run)

    def download(self, video_id, out_dir, progress=None, source_url=None, trim=None):
        self.downloads.append(Path(out_dir))
        if self.fail_download:
            raise self.fail_download
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"whole-video")
        if progress:
            progress(0.5)
        return {"id": video_id, "title": "Mix", "artist": "DJ", "duration": SOURCE_SECONDS}

    def run(self, cmd, **kw):
        if cmd[0] == "ffprobe":
            path = Path(cmd[-1])
            return subprocess.CompletedProcess(cmd, 0, stdout=f"{self.lengths.get(path, SOURCE_SECONDS)}\n", stderr="")
        dst = Path(cmd[-1])
        title = next((c[6:] for c in cmd if c.startswith("title=")), "")
        if title in self.fail_on:
            raise subprocess.CalledProcessError(1, cmd, stderr=b"boom")
        self.cuts.append(cmd)
        length = float(cmd[cmd.index("-t") + 1])
        dst.write_bytes(b"x" * int(length * video_split.OUTPUT_BYTES_PER_SECOND) if self.sized else b"cut-" + dst.stem.encode())
        self.lengths[dst] = length
        return subprocess.CompletedProcess(cmd, 0, stdout=b"", stderr=b"")


@pytest.fixture
def tools(client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(video_split, "STAGE_TTL", 3600)
    return Tools(monkeypatch)


def make_songs(uid=OWNER_UID, ids=("trk_a", "trk_b", "trk_c")):
    songs = [{"id": i, "title": i, "file": None, "added_at": "2026-06-01T00:00:00Z", "mainArtists": [], "featuredArtists": []} for i in ids]
    deps.save_songs(uid, songs)


def run(uid=OWNER_UID, owner=True, tracks=TRACKS, job_id=None, fades=False, video=VIDEO):
    job_id = job_id or video_split.new_job_id()
    return video_split.submit(uid, owner, job_id, video, tracks, ALBUM, fades, None, None)


def songs_by_id(uid=OWNER_UID):
    return {s["id"]: s for s in deps.load_songs(uid)}


def flag(cmd, name):
    return cmd[cmd.index(name) + 1]


def test_split_downloads_once_and_cuts_each_track(tools):
    make_songs()
    job = run()
    assert len(tools.downloads) == 1
    assert len(tools.cuts) == 3
    assert job["status"] == "done"
    assert job["done"] == 3
    assert job["total"] == 3
    assert job["failed"] == []
    audio = deps.audio_dir(OWNER_UID)
    songs = songs_by_id()
    for sid in ("trk_a", "trk_b", "trk_c"):
        assert (audio / f"{sid}.m4a").read_bytes() == b"cut-" + f"{sid}.cut".encode()
        assert songs[sid]["file"] == f"{sid}.m4a"
        assert songs[sid]["bpm"] is None or isinstance(songs[sid]["bpm"], int)
        assert library.audio_state(songs[sid], deps.user_audio_root(OWNER_UID)) == "server"
    assert [songs[s]["duration"] for s in ("trk_a", "trk_b", "trk_c")] == [100.0, 100.0, 100.0]
    assert not video_split.stage_dir(OWNER_UID, VIDEO).exists()


def test_cut_commands_use_the_confirmed_times_and_copy_the_stream(tools):
    make_songs()
    run()
    first, second, third = tools.cuts
    assert flag(first, "-ss") == "0.000"
    assert flag(first, "-t") == "100.000"
    assert flag(second, "-ss") == "100.000"
    assert flag(second, "-t") == "100.000"
    assert flag(third, "-ss") == "200.000"
    assert flag(third, "-t") == "100.000"
    for cmd in tools.cuts:
        assert flag(cmd, "-c:a") == "copy"
        assert "-af" not in cmd
        assert cmd[:3] == ["ffmpeg", "-y", "-v"]


def test_tags_carry_title_artist_album_track_and_year(tools):
    make_songs()
    run()
    tags = {c[i + 1].split("=", 1)[0]: c[i + 1].split("=", 1)[1] for c in tools.cuts[1:2] for i, a in enumerate(c) if a == "-metadata"}
    assert tags == {"title": "Two (Remix)", "artist": "Gamma", "album": "Night Mix", "album_artist": "Various Artists", "track": "2", "date": "2020"}
    third = [c[i + 1] for c in tools.cuts[2:] for i, a in enumerate(c) if a == "-metadata"]
    assert not any(t.startswith("artist=") for t in third)


def test_fades_only_inside_the_file_and_force_a_reencode(tools):
    make_songs()
    run(fades=True)
    first, second, third = tools.cuts
    assert "afade=t=in" not in flag(first, "-af")
    assert "afade=t=out:st=99.000:d=1" in flag(first, "-af")
    assert "afade=t=in:st=0:d=1" in flag(second, "-af")
    assert "afade=t=out:st=99.000:d=1" in flag(second, "-af")
    assert "afade=t=in:st=0:d=1" in flag(third, "-af")
    assert "afade=t=out" not in flag(third, "-af")
    assert flag(second, "-c:a") == "aac"


def test_last_track_without_an_end_runs_to_the_downloaded_length(tools):
    make_songs()
    run()
    assert flag(tools.cuts[2], "-t") == "100.000"
    assert songs_by_id()["trk_c"]["duration"] == 100.0


def test_an_end_beyond_the_audio_is_clamped(tools):
    make_songs(ids=("trk_a",))
    run(tracks=[{**TRACKS[0], "start": 250.0, "end": 400.0}])
    assert flag(tools.cuts[0], "-t") == "50.000"


def test_the_split_is_one_add(tools):
    make_songs()
    assert limits.RATE.count(OWNER_UID, []) == 0
    run()
    assert limits.RATE.count(OWNER_UID, []) == 1


def test_status_shape_after_a_run(tools):
    make_songs()
    job = run()
    body = video_split.public(job)
    assert body["state"] == "done"
    assert body["percent"] == 100
    assert body["done"] == 3
    assert body["total"] == 3
    assert body["failed"] == []
    assert body["current"] is None
    assert body["jobId"] == job["job_id"]
    assert video_split.get(OWNER_UID, job["job_id"]) is job


def test_progress_is_visible_while_splitting(tools, monkeypatch):
    make_songs()
    seen = []
    real = tools.run

    def spy(cmd, **kw):
        if cmd[0] == "ffmpeg":
            job = next(iter(deps.JOBS.values()))
            seen.append(video_split.public(job))
        return real(cmd, **kw)

    monkeypatch.setattr(video_split.subprocess, "run", spy)
    run()
    assert [s["state"] for s in seen] == ["splitting"] * 3
    assert [s["done"] for s in seen] == [0, 1, 2]
    assert [s["current"] for s in seen] == ["Alpha, Beta - One", "Gamma - Two", "Three"]


def test_a_failed_track_does_not_stop_the_others_and_the_download_is_kept(tools):
    make_songs()
    tools.fail_on = {"Two (Remix)"}
    job = run()
    assert job["status"] == "done"
    assert job["done"] == 2
    assert [f["songId"] for f in job["failed"]] == ["trk_b"]
    assert "cut failed" in job["failed"][0]["error"]
    assert job["message"] == "2 of 3 tracks have audio, 1 failed"
    songs = songs_by_id()
    assert songs["trk_a"]["file"]
    assert songs["trk_c"]["file"]
    assert not songs["trk_b"]["file"]
    stage = video_split.stage_dir(OWNER_UID, VIDEO)
    assert sorted(p.name for p in stage.iterdir()) == [f"{VIDEO}.m4a"]


def test_retry_cuts_only_the_failed_tracks_from_the_kept_download_without_a_new_add(tools):
    make_songs()
    tools.fail_on = {"Two (Remix)"}
    run()
    assert limits.RATE.count(OWNER_UID, []) == 1
    tools.fail_on = set()
    tools.cuts.clear()
    job = run()
    assert len(tools.downloads) == 1
    assert len(tools.cuts) == 1
    assert flag(tools.cuts[0], "-ss") == "100.000"
    assert "track=2" in " ".join(tools.cuts[0])
    assert job["status"] == "done"
    assert job["done"] == 3
    assert job["failed"] == []
    assert limits.RATE.count(OWNER_UID, []) == 1
    assert not video_split.stage_dir(OWNER_UID, VIDEO).exists()


def test_an_old_staging_file_is_not_reused_and_costs_a_new_add(tools):
    make_songs()
    tools.fail_on = {"Two (Remix)"}
    run()
    source = video_split.stage_dir(OWNER_UID, VIDEO) / f"{VIDEO}.m4a"
    old = time.time() - 2 * 3600
    import os
    os.utime(source, (old, old))
    tools.fail_on = set()
    run()
    assert len(tools.downloads) == 2
    assert limits.RATE.count(OWNER_UID, []) == 2


def test_all_tracks_failing_is_an_error_and_the_download_stays_for_a_retry(tools):
    make_songs()
    tools.fail_on = {"One", "Two (Remix)", "Three"}
    job = run()
    assert job["status"] == "error"
    assert job["done"] == 0
    assert len(job["failed"]) == 3
    assert "cut failed" in job["error"]
    assert video_split.public(job)["state"] == "error"


def test_a_failed_download_is_an_error_with_a_code_and_nothing_is_left(tools):
    make_songs()
    tools.fail_download = RuntimeError("HTTP Error 404: Not Found")
    job = run()
    assert job["status"] == "error"
    assert job["code"] == "not_found"
    assert job["done"] == 0
    assert not video_split.stage_dir(OWNER_UID, VIDEO).exists()
    assert not any(songs_by_id()[s]["file"] for s in ("trk_a", "trk_b", "trk_c"))


def test_tracks_that_already_have_audio_are_skipped(tools):
    make_songs()
    audio = deps.audio_dir(OWNER_UID)
    audio.mkdir(parents=True, exist_ok=True)
    (audio / "trk_a.m4a").write_bytes(b"old")
    songs = deps.load_songs(OWNER_UID)
    songs[0]["file"] = "trk_a.m4a"
    deps.save_songs(OWNER_UID, songs)
    job = run()
    assert len(tools.cuts) == 2
    assert (audio / "trk_a.m4a").read_bytes() == b"old"
    assert job["done"] == 3
    assert job["total"] == 3


def test_nothing_left_to_cut_is_done_at_once_and_free(tools):
    make_songs()
    run()
    limits.RATE.reset()
    tools.downloads.clear()
    job = run()
    assert job["status"] == "done"
    assert tools.downloads == []
    assert limits.RATE.count(OWNER_UID, []) == 0


def test_a_running_split_of_the_same_video_is_returned_not_started_twice(tools):
    make_songs()
    deps.JOBS[(OWNER_UID, "split_running")] = {"job_id": "split_running", "video_id": VIDEO, "status": "splitting", "done": 1, "total": 3}
    job = run()
    assert job["job_id"] == "split_running"
    assert tools.downloads == []


def test_a_deleted_song_fails_only_its_track(tools):
    make_songs(ids=("trk_a", "trk_c"))
    job = run()
    assert job["status"] == "done"
    assert job["done"] == 2
    assert job["failed"][0]["songId"] == "trk_b"
    assert job["failed"][0]["error_code"] == "unknown_song"
    assert not (deps.audio_dir(OWNER_UID) / "trk_b.m4a").exists()


def test_a_cut_outside_the_audio_fails_its_track(tools):
    make_songs(ids=("trk_a", "trk_b"))
    job = run(tracks=[TRACKS[0], {**TRACKS[1], "start": 350.0, "end": 400.0}])
    assert job["done"] == 1
    assert job["failed"][0]["error_code"] == "invalid_cut"


def test_storage_quota_stops_the_split_and_marks_the_rest(tools, monkeypatch):
    uid = users.uid_for_email("guest@example.com")
    make_songs(uid)
    tools.sized = True
    monkeypatch.setenv("USER_MAX_BYTES", str(video_split.estimate_bytes(150)))
    job = run(uid=uid, owner=False)
    assert job["status"] == "done"
    assert job["done"] == 1
    assert [f["songId"] for f in job["failed"]] == ["trk_b", "trk_c"]
    assert {f["error_code"] for f in job["failed"]} == {"library_full_bytes"}


def test_a_full_storage_refuses_the_split_before_anything_runs(tools, monkeypatch):
    uid = users.uid_for_email("guest@example.com")
    make_songs(uid)
    audio = deps.audio_dir(uid)
    audio.mkdir(parents=True, exist_ok=True)
    (audio / "other.m4a").write_bytes(b"x" * 100)
    monkeypatch.setenv("USER_MAX_BYTES", "50")
    with pytest.raises(Problem) as err:
        run(uid=uid, owner=False)
    assert err.value.code == "library_full_bytes"
    assert tools.downloads == []


def test_hourly_limit_refuses_a_second_split(tools, monkeypatch):
    uid = users.uid_for_email("guest@example.com")
    make_songs(uid, ids=("trk_a", "trk_b", "trk_c"))
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "1")
    limits.RATE.record(uid, [])
    with pytest.raises(Problem) as err:
        run(uid=uid, owner=False)
    assert err.value.code == "hourly_limit"
    assert err.value.status == 429
    assert tools.downloads == []
    with pytest.raises(Problem):
        video_split.precheck(uid, False, TRACKS)


def test_owner_is_exempt_from_the_hourly_limit(tools, monkeypatch):
    make_songs()
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "1")
    limits.RATE.record(OWNER_UID, [])
    assert run()["status"] == "done"


def test_precheck_refuses_a_split_that_cannot_fit(tools, monkeypatch):
    uid = users.uid_for_email("guest@example.com")
    monkeypatch.setenv("USER_MAX_BYTES", "1000")
    with pytest.raises(Problem) as err:
        video_split.precheck(uid, False, TRACKS)
    assert err.value.code == "library_full_bytes"
    video_split.precheck(OWNER_UID, True, TRACKS)


@pytest.mark.parametrize("tracks,code", [
    ([], "no_tracks"),
    ([{"songId": f"s{i}", "start": float(i), "end": float(i) + 1} for i in range(101)], "too_many_tracks"),
    ([{"songId": "a", "start": 5.0, "end": 5.0}], "bad_tracklist"),
    ([{"songId": "a", "start": -1.0, "end": 5.0}], "bad_tracklist"),
    ([{"songId": "a", "start": 0.0, "end": 50.0}, {"songId": "b", "start": 40.0, "end": 60.0}], "bad_tracklist"),
    ([{"songId": "a", "start": 0.0, "end": 5.0}, {"songId": "a", "start": 5.0, "end": 9.0}], "bad_tracklist"),
    ([{"songId": "../x", "start": 0.0, "end": 5.0}], "bad_tracklist"),
    ([{"songId": "a", "start": "0", "end": 5.0}], "bad_tracklist"),
])
def test_check_request_refuses_bad_lists(tracks, code):
    with pytest.raises(Problem) as err:
        video_split.check_request(600.0, tracks)
    assert err.value.code == code


def test_check_request_limits_the_video_and_the_start_times():
    with pytest.raises(Problem) as err:
        video_split.check_request(4 * 3600 + 1, TRACKS)
    assert err.value.status == 413
    assert err.value.code == "video_too_long"
    with pytest.raises(Problem) as err:
        video_split.check_request(150.0, TRACKS)
    assert err.value.code == "bad_tracklist"
    video_split.check_request(4 * 3600, TRACKS)
    video_split.check_request(None, TRACKS)


def test_a_bad_video_id_is_refused(tools):
    make_songs()
    with pytest.raises(Problem) as err:
        video_split.submit(OWNER_UID, True, "split_x", "../etc", TRACKS, ALBUM)
    assert err.value.code == "invalid_video_id"


def test_sweep_removes_only_stale_staging_folders(tools):
    audio = deps.audio_dir(OWNER_UID)
    old, fresh = audio / ".split-oldVideo001", audio / ".split-newVideo001"
    for folder in (old, fresh):
        folder.mkdir(parents=True)
        (folder / f"{folder.name[7:]}.m4a").write_bytes(b"x")
    import os
    past = time.time() - 2 * 3600
    os.utime(old / "oldVideo001.m4a", (past, past))
    assert video_split.sweep(OWNER_UID) == 1
    assert not old.exists()
    assert fresh.exists()
    assert video_split.sweep("nobody") == 0


def test_a_failed_attach_leaves_no_audio_file(tools, monkeypatch):
    make_songs(ids=("trk_a",))

    def boom(uid, songs):
        raise OSError("disk")

    monkeypatch.setattr(deps, "save_songs", boom)
    job = run(tracks=[TRACKS[0]])
    assert job["status"] == "error"
    assert job["done"] == 0
    assert not (deps.audio_dir(OWNER_UID) / "trk_a.m4a").exists()


def test_the_song_cover_is_the_video_thumbnail(tools, monkeypatch):
    make_songs(ids=("trk_a",))

    def fake_cover(video_id, dest, artwork=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"jpg")

    monkeypatch.setattr(extractor, "fetch_cover", fake_cover)
    run(tracks=[TRACKS[0]])
    assert songs_by_id()["trk_a"]["cover"] == "covers/trk_a.jpg"
    assert (deps.covers_dir(OWNER_UID) / "trk_a.jpg").read_bytes() == b"jpg"


@pytest.mark.parametrize("fields", [{"cover_source": "custom"}, {"cover_source": "default"}, {"cover_off": True}, {"cover": "covers/trk_a.jpg"}])
def test_a_late_thumbnail_never_overwrites_the_art_a_song_already_has(tools, monkeypatch, fields):
    make_songs(ids=("trk_a",))
    path = deps.covers_dir(OWNER_UID) / "trk_a.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"album-art")
    songs = deps.load_songs(OWNER_UID)
    songs[0].update(fields)
    if "cover_source" in fields:
        songs[0].update(cover="covers/trk_a.jpg", cover_v="v")
    deps.save_songs(OWNER_UID, songs)

    def fake_cover(video_id, dest, artwork=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"youtube-thumbnail")

    monkeypatch.setattr(extractor, "fetch_cover", fake_cover)
    run(tracks=[TRACKS[0]])
    assert path.read_bytes() == b"album-art"
