"""Split job of an album made from a time-coded video (task-0038 phase 1B): one yt-dlp download of the audio, one ffmpeg cut per track, each file attached to the song it belongs to."""

from __future__ import annotations

import logging
import os
import re
import secrets
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from . import bpm, deps, extractor, jobs, library, limits, users
from . import trim as trimming
from .downloads import mark_started
from .jsonio import write_bytes_atomic
from .links import short_error
from .problems import Problem

log = logging.getLogger(__name__)

FADE_SECONDS = 1.0
CUT_TIMEOUT = 600
STAGE_TTL = 3600
SOURCE_BYTES_PER_SECOND = 16000
OUTPUT_BYTES_PER_SECOND = 24000
MAX_TRACKS = 100
MAX_SECONDS = 4 * 3600
STAGE_PREFIX = ".split-"
_SONG_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{6,64}")
_MIN_FADED_CUT = 2.0


def new_job_id() -> str:
    return f"split_{secrets.token_hex(6)}"


def _percent(job: dict[str, Any], status: Any, done: int, total: int) -> int:
    if status == "downloading":
        return int(round(float(job.get("progress") or 0.0) * 100))
    if status == "queued":
        return 0
    if status == "done":
        return 100
    return int(100 * done / total) if total else 0


def public(job: dict[str, Any]) -> dict[str, Any]:
    """Status body of `GET /jobs/{jobId}`: state queued|downloading|splitting|done|error, counts, the current track, the failed tracks."""
    status = job.get("status")
    total = int(job.get("total") or 0)
    done = int(job.get("done") or 0)
    percent = _percent(job, status, done, total)
    body: dict[str, Any] = {
        "jobId": job.get("job_id"),
        "state": status,
        "percent": max(0, min(100, percent)),
        "done": done,
        "total": total,
        "current": job.get("current"),
        "failed": list(job.get("failed") or []),
    }
    if job.get("message"):
        body["message"] = job["message"]
    if status == "error":
        body["error"] = job.get("error")
        body["error_code"] = job.get("code")
    return body


def get(uid: str, job_id: str) -> dict[str, Any] | None:
    return deps.JOBS.get((uid, job_id))


def find_active(uid: str, video_id: str) -> dict[str, Any] | None:
    for (u, _), job in deps.JOBS.copy().items():
        if u == uid and job.get("video_id") == video_id and job.get("status") in ("queued", "downloading", "splitting"):
            return job
    return None


def estimate_bytes(seconds: float) -> int:
    return int(max(seconds, 0.0) * OUTPUT_BYTES_PER_SECOND)


def _check_cut(track: dict[str, Any], previous: float, video_seconds: float | None) -> float:
    start, end = track.get("start"), track.get("end")
    if not isinstance(start, (int, float)) or isinstance(start, bool) or start < 0:
        raise Problem(422, "bad_tracklist", "A track has a wrong start time.")
    if end is not None and (not isinstance(end, (int, float)) or isinstance(end, bool) or end <= start):
        raise Problem(422, "bad_tracklist", "A track must end after it starts.")
    if start < previous:
        raise Problem(422, "bad_tracklist", "Tracks must not overlap.")
    if video_seconds is not None and start >= video_seconds:
        raise Problem(422, "bad_tracklist", "A track starts after the end of the video.")
    return float(end) if end is not None else float(start)


def check_request(video_seconds: float | None, tracks: list[dict[str, Any]]) -> None:
    """422 before anything is created: the limits of the owner decisions (4 hours, 100 tracks) and a consistent cut list."""
    if not tracks:
        raise Problem(422, "no_tracks", "Pick at least one track.")
    if len(tracks) > MAX_TRACKS:
        raise Problem(413, "too_many_tracks", f"more than {MAX_TRACKS} tracks")
    if video_seconds is not None and video_seconds > MAX_SECONDS:
        raise Problem(413, "video_too_long", "video longer than 4 hours")
    previous = 0.0
    for t in tracks:
        previous = _check_cut(t, previous, video_seconds)
    ids = [t.get("songId") for t in tracks]
    if len(set(ids)) != len(ids) or not all(isinstance(i, str) and _SONG_ID.fullmatch(i) for i in ids):
        raise Problem(422, "bad_tracklist", "Every track needs its own song.")


def precheck(uid: str, owner: bool, tracks: list[dict[str, Any]]) -> None:
    """The quota refusals (hourly adds, storage, pool) of a split, raised before songs are created; the whole split is one add."""
    songs = deps.load_songs(uid)
    limits.check_fetch(uid, owner, songs, deps.audio_dir(uid), deps.pool_dir())
    if not owner:
        seconds = sum(max((t.get("end") or t["start"]) - t["start"], 0.0) for t in tracks)
        if limits.dir_bytes(deps.audio_dir(uid)) + estimate_bytes(seconds) > limits.max_bytes():
            raise Problem(403, "library_full_bytes", f"Your storage is full ({limits.max_bytes() / limits.GB:g} GB). Delete some songs to add more.")


def stage_dir(uid: str, video_id: str) -> Path:
    return deps.audio_dir(uid) / f"{STAGE_PREFIX}{video_id}"


def _age_mark(stage: Path) -> float:
    source = stage / f"{stage.name[len(STAGE_PREFIX):]}.m4a"
    return (source if source.is_file() else stage).stat().st_mtime


def sweep(uid: str) -> int:
    """Remove staging folders older than an hour (kept after a partial failure so a retry skips the download); returns how many."""
    root = deps.audio_dir(uid)
    removed = 0
    if not root.is_dir():
        return 0
    for path in root.glob(f"{STAGE_PREFIX}*"):
        try:
            if path.is_dir() and time.time() - _age_mark(path) > STAGE_TTL and find_active(uid, path.name[len(STAGE_PREFIX):]) is None:
                shutil.rmtree(path, ignore_errors=True)
                removed += 1
        except OSError:
            continue
    return removed


def _has_audio(uid: str, song: dict[str, Any] | None) -> bool:
    return song is not None and library.audio_state(song, deps.user_audio_root(uid)) == "server"


def submit(uid: str, owner: bool, job_id: str, video_id: str, tracks: list[dict[str, Any]], album: dict[str, Any] | None = None,
           fades: bool = False, source_url: str | None = None, thumbnail: str | None = None) -> dict[str, Any]:
    """Register the job record and queue the split on the download scheduler; returns the record (`public(record)` is its status).

    `tracks`: `[{songId, start, end|None, title, artists[], trackNo|None, version|None}]` in play order, the songs already exist (metadata only).
    `album`: `{title, albumArtist, year}` for the tags. Tracks whose song already has audio are skipped. A split for the same video that is running
    is returned instead of a second one; a finished or failed one is simply run again (a retry skips the finished tracks and reuses a fresh staging file).
    The whole split is charged as one add, unless nothing is left to cut or the staged download is reused."""
    if not _VIDEO_ID.fullmatch(video_id or ""):
        raise Problem(422, "invalid_video_id", "invalid video id")
    check_request(None, tracks)
    with users.user_lock(uid):
        running = find_active(uid, video_id)
        if running is not None:
            return running
        songs = library.load(deps.library_path(uid))
        pending = [{**t, "pos": i} for i, t in enumerate(tracks) if not _has_audio(uid, library.find_song(songs, t["songId"]))]
        job: dict[str, Any] = {
            "job_id": job_id, "video_id": video_id, "status": "queued", "progress": 0.0, "error": None,
            "done": len(tracks) - len(pending), "total": len(tracks), "current": None, "failed": [],
        }
        key = (uid, job_id)
        if not pending:
            job.update(status="done", progress=1.0)
            deps.JOBS[key] = job
            return job
        sweep(uid)
        if _stage_file(uid, video_id) is None:
            limits.check_fetch(uid, owner, songs, deps.audio_dir(uid), deps.pool_dir())
            limits.RATE.record(uid, songs)
        deps.JOBS[key] = job
    deps.SCHED.submit(
        uid, owner,
        lambda: run_split(uid, owner, job_id, video_id, pending, album or {}, fades, source_url, thumbnail, len(tracks)),
        mark_started(key),
    )
    return job


def _stage_file(uid: str, video_id: str) -> Path | None:
    """The staged download of a video when it is complete and under an hour old."""
    path = stage_dir(uid, video_id) / f"{video_id}.m4a"
    try:
        if path.is_file() and path.stat().st_size > 0 and time.time() - path.stat().st_mtime <= STAGE_TTL:
            return path
    except OSError:
        pass
    return None


def _fail_job(job: dict[str, Any], exc: Exception) -> None:
    if isinstance(exc, extractor.PreviewOnly):
        job.update(status="error", error=str(exc), code="preview_only")
    elif isinstance(exc, Problem):
        job.update(status="error", error=exc.detail, code=exc.code)
    else:
        job.update(status="error", error=short_error(exc), code=extractor.error_code(exc))


def _room(owner: bool, out: Path, stage: Path, need: int) -> None:
    """Storage left for `need` more bytes: the user's quota (not the owner's), not counting the staging folder, and the pool."""
    if not owner and limits.dir_bytes(out) - limits.dir_bytes(stage) + need > limits.max_bytes():
        raise Problem(403, "library_full_bytes", f"Your storage is full ({limits.max_bytes() / limits.GB:g} GB). Delete some songs to add more.")
    limits.check_pool(deps.pool_dir())


def _download(uid: str, owner: bool, job: dict[str, Any], video_id: str, stage: Path, source_url: str | None) -> dict[str, Any]:
    source = stage / f"{video_id}.m4a"
    if _stage_file(uid, video_id) is not None:
        return {"duration": trimming.probe_seconds(source), "thumbnail": None}
    shutil.rmtree(stage, ignore_errors=True)
    out = deps.audio_dir(uid)
    limits.check_capacity(owner, out, deps.pool_dir())
    stage.mkdir(parents=True, exist_ok=True)
    return extractor.download_audio(video_id, stage, jobs.Tracker(job), source_url)


def cut_command(src: Path, dst: Path, start: float, end: float, tags: dict[str, str], fade_in: bool, fade_out: bool) -> list[str]:
    """ffmpeg cut of [start, end): stream copy of the AAC audio (frame accurate) unless a fade needs a re-encode."""
    length = end - start
    cmd = ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(src), "-vn", "-map_metadata", "-1"]
    filters = []
    d = min(FADE_SECONDS, length / 4)
    if fade_in:
        filters.append(f"afade=t=in:st=0:d={d:g}")
    if fade_out:
        filters.append(f"afade=t=out:st={length - d:.3f}:d={d:g}")
    if filters:
        cmd += ["-af", ",".join(filters), "-c:a", "aac", "-b:a", trimming.AAC_BITRATE]
    else:
        cmd += ["-c:a", "copy"]
    for name, value in tags.items():
        cmd += ["-metadata", f"{name}={value}"]
    return cmd + ["-movflags", "+faststart", str(dst)]


def _tags(track: dict[str, Any], album: dict[str, Any], index: int) -> dict[str, str]:
    artists = [a for a in track.get("artists") or [] if isinstance(a, str) and a.strip()]
    title = str(track.get("title") or "").strip()
    if track.get("version"):
        title = f"{title} ({track['version']})" if title else str(track["version"])
    number = track.get("trackNo") if isinstance(track.get("trackNo"), int) else index + 1
    wanted = {
        "title": title,
        "artist": ", ".join(artists),
        "album": str(album.get("title") or "").strip(),
        "album_artist": str(album.get("albumArtist") or "").strip(),
        "track": str(number),
        "date": str(album["year"]) if isinstance(album.get("year"), int) and not isinstance(album.get("year"), bool) else "",
    }
    return {k: v for k, v in wanted.items() if v}


def _cut_one(src: Path, dst: Path, source_seconds: float, track: dict[str, Any], album: dict[str, Any], fades: bool, index: int) -> float:
    start = float(track["start"])
    end = min(float(track["end"]), source_seconds) if track.get("end") is not None else source_seconds
    if start >= source_seconds or end - start < trimming.MIN_CUT:
        raise Problem(422, "invalid_cut", "The track lies outside the downloaded audio.")
    faded = fades and end - start >= _MIN_FADED_CUT
    fade_in = faded and start > 0
    fade_out = faded and end < source_seconds - 0.5
    try:
        subprocess.run(cut_command(src, dst, start, end, _tags(track, album, index), fade_in, fade_out), capture_output=True, timeout=CUT_TIMEOUT, check=True)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode(errors="replace").strip()[-200:]
        raise RuntimeError(f"cut failed: {detail or exc}") from exc
    if not dst.is_file() or dst.stat().st_size == 0:
        raise RuntimeError("ffmpeg produced no audio")
    return trimming.probe_seconds(dst) or end - start


def _detect_bpm(path: Path, song_id: str) -> float | None:
    try:
        return bpm.detect_bpm(path)
    except Exception as exc:
        log.warning("bpm detection failed for %s: %s", song_id, exc)
        return None


def _wants_thumbnail(song: dict[str, Any]) -> bool:
    """The video thumbnail is only the automatic cover: a song that has a cover already, one the user switched off or one pinned (`custom`, `default`, e.g. the album art copied by `coverToSongs` while the split was still running) keeps its own."""
    return not song.get("cover") and not song.get("cover_off") and song.get("cover_source") not in ("custom", "default")


def _store_cover(uid: str, song_id: str, jpeg: bytes | None) -> str | None:
    if jpeg is None:
        return None
    try:
        write_bytes_atomic(deps.covers_dir(uid) / f"{song_id}.jpg", jpeg)
    except Exception:
        return None
    return f"covers/{song_id}.jpg"


def _fetch_thumbnail(video_id: str, stage: Path, thumbnail: str | None) -> bytes | None:
    try:
        staged = stage / "cover.jpg"
        extractor.fetch_cover(video_id, staged, thumbnail)
        return staged.read_bytes()
    except Exception:
        return None


def _attach(uid: str, song_id: str, produced: Path, seconds: float, value: float | None, thumbnail: bytes | None) -> None:
    out = deps.audio_dir(uid)
    final = out / f"{song_id}.m4a"
    out.mkdir(parents=True, exist_ok=True)
    os.replace(produced, final)
    try:
        with deps.tx(uid, f"split {song_id}"):
            songs = library.load(deps.library_path(uid))
            song = library.find_song(songs, song_id)
            if song is None:
                raise Problem(404, "unknown_song", deps.UNKNOWN_SONG)
            song["file"] = f"{song_id}.m4a"
            song["duration"] = seconds
            if song.get("bpm") is None and value is not None:
                song["bpm"] = round(value)
            if thumbnail is not None and _wants_thumbnail(song):
                song["cover"] = _store_cover(uid, song_id, thumbnail) or song.get("cover")
            song["updated_at"] = library.now_utc()
            deps.save_songs(uid, songs)
    except Exception:
        final.unlink(missing_ok=True)
        raise


def _label(track: dict[str, Any]) -> str:
    artists = ", ".join(a for a in track.get("artists") or [] if isinstance(a, str))
    return f"{artists} - {track.get('title')}" if artists else str(track.get("title") or track["songId"])


def _split_one(uid: str, owner: bool, stage: Path, source: Path, source_seconds: float, track: dict[str, Any], album: dict[str, Any],
               fades: bool, cover: bytes | None) -> None:
    song_id = track["songId"]
    _room(owner, deps.audio_dir(uid), stage, estimate_bytes((track.get("end") or source_seconds) - track["start"]))
    if library.find_song(deps.load_songs(uid), song_id) is None:
        raise Problem(404, "unknown_song", deps.UNKNOWN_SONG)
    produced = stage / f"{song_id}.cut.m4a"
    seconds = _cut_one(source, produced, source_seconds, track, album, fades, track["pos"])
    value = _detect_bpm(produced, song_id)
    _attach(uid, song_id, produced, seconds, value, cover)


def _failure(track: dict[str, Any], exc: Exception) -> dict[str, Any]:
    isproblem = isinstance(exc, Problem)
    return {"songId": track["songId"], "title": track.get("title"), "error": exc.detail if isproblem else short_error(exc), "error_code": exc.code if isproblem else None}


def _run_tracks(uid: str, owner: bool, job: dict[str, Any], stage: Path, source: Path, source_seconds: float, tracks: list[dict[str, Any]],
                album: dict[str, Any], fades: bool, cover: bytes | None, total: int, failed: list[dict[str, Any]]) -> None:
    for index, track in enumerate(tracks):
        job["current"] = _label(track)
        try:
            _split_one(uid, owner, stage, source, source_seconds, track, album, fades, cover)
            job["done"] += 1
        except Exception as exc:
            (stage / f"{track['songId']}.cut.m4a").unlink(missing_ok=True)
            entry = _failure(track, exc)
            failed.append(entry)
            job["failed"] = list(failed)
            if entry["error_code"] in ("library_full_bytes", "server_full"):
                failed.extend(_failure(rest, exc) for rest in tracks[index + 1:])
                job["failed"] = list(failed)
                break
        job["progress"] = round(job["done"] / total, 3) if total else 1.0


def _finish(job: dict[str, Any], failed: list[dict[str, Any]], total: int) -> None:
    job["current"] = None
    if failed and job["done"] == 0:
        first = failed[0]
        job.update(status="error", error=first["error"], code=first["error_code"])
        return
    job.update(status="done", progress=1.0)
    if failed:
        job["message"] = f"{job['done']} of {total} tracks have audio, {len(failed)} failed"


def run_split(uid: str, owner: bool, job_id: str, video_id: str, tracks: list[dict[str, Any]], album: dict[str, Any], fades: bool,
              source_url: str | None, thumbnail: str | None, total: int) -> None:
    """The worker: download once, cut each track, attach each file. A failed track does not stop the others; the staging folder is removed unless a track failed (then it is kept for a retry, for an hour)."""
    job = deps.JOBS[(uid, job_id)]
    stage = stage_dir(uid, video_id)
    failed: list[dict[str, Any]] = []
    try:
        info = _download(uid, owner, job, video_id, stage, source_url)
        source = stage / f"{video_id}.m4a"
        source_seconds = trimming.probe_seconds(source) or info.get("duration")
        if not source_seconds:
            raise RuntimeError("the downloaded audio has no length")
        job.update(status="splitting", progress=0.0)
        cover = _fetch_thumbnail(video_id, stage, info.get("thumbnail") or thumbnail)
        _run_tracks(uid, owner, job, stage, source, float(source_seconds), tracks, album, fades, cover, total, failed)
        _finish(job, failed, total)
    except Exception as exc:
        job["current"] = None
        _fail_job(job, exc)
    finally:
        if failed and (stage / f"{video_id}.m4a").is_file():
            _keep_only_source(stage, video_id)
        else:
            shutil.rmtree(stage, ignore_errors=True)


def _keep_only_source(stage: Path, video_id: str) -> None:
    """After a partial failure only the downloaded audio stays (for a retry); its age is the download's."""
    try:
        for entry in stage.iterdir():
            if entry.name != f"{video_id}.m4a":
                if entry.is_dir():
                    shutil.rmtree(entry, ignore_errors=True)
                else:
                    entry.unlink(missing_ok=True)
    except OSError:
        pass
