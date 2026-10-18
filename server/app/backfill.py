"""BPM backfill: detect the tempo of songs that have audio on the server but no BPM yet.

One job at a time server-wide, run in a niced background thread, one song after another with a short pause,
results written in batches through the normal library transaction. State lives in memory only."""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

from . import bpm, deps, library

log = logging.getLogger(__name__)

SONG_TIMEOUT = 60.0
NICE = 10
_lock = threading.Lock()
_jobs: dict[str, Job] = {}
_active: str | None = None


def _sleep() -> float:
    try:
        return max(0.0, float(os.environ.get("AUDIO_BACKFILL_SLEEP", "0.2")))
    except ValueError:
        return 0.2


def _batch() -> int:
    try:
        return max(1, int(os.environ.get("AUDIO_BACKFILL_BATCH", "10")))
    except ValueError:
        return 10


class Job:
    def __init__(self, uid: str, total: int) -> None:
        self.uid = uid
        self.state = "running"
        self.total = total
        self.done = 0
        self.failed = 0
        self.skipped = 0
        self.started_at = library.now_utc()
        self.finished_at: str | None = None
        self.last_error: str | None = None
        self.cancel = threading.Event()
        self.thread: threading.Thread | None = None


def candidates(uid: str) -> list[str]:
    """Ids of the user's songs with a bpm of null whose audio file is on the server."""
    out = []
    for song in deps.load_songs(uid):
        if song.get("bpm") is None and library.has_file(song) and (deps.audio_dir(uid) / library.file_name(song)).is_file():
            out.append(song["id"])
    return out


def status(uid: str) -> dict[str, Any]:
    job = _jobs.get(uid)
    cand = len(candidates(uid))
    if job is None:
        return {"state": "idle", "candidates": cand, "total": 0, "done": 0, "failed": 0, "skipped": 0,
                "started_at": None, "finished_at": None}
    out = {"state": job.state, "candidates": cand, "total": job.total, "done": job.done, "failed": job.failed,
           "skipped": job.skipped, "started_at": job.started_at, "finished_at": job.finished_at}
    if job.last_error:
        out["last_error"] = job.last_error
    return out


def start(uid: str) -> tuple[str, dict[str, Any] | None]:
    """('started', state) | ('nothing', state) | ('running', None) | ('busy', None)."""
    global _active
    with _lock:
        if _active is not None:
            return ("running" if _active == uid else "busy"), None
        ids = candidates(uid)
        if not ids:
            return "nothing", status(uid)
        job = Job(uid, len(ids))
        _jobs[uid] = job
        _active = uid
        job.thread = threading.Thread(target=_run, args=(job, ids), name="bpm-backfill", daemon=True)
        job.thread.start()
    return "started", status(uid)


def cancel(uid: str) -> dict[str, Any]:
    job = _jobs.get(uid)
    if job is not None and job.state == "running":
        job.cancel.set()
    return status(uid)


def reset() -> None:
    global _active
    for job in _jobs.values():
        job.cancel.set()
        if job.thread is not None:
            job.thread.join(5)
    _jobs.clear()
    _active = None


def _detect(path) -> int | None:
    """Run the detector with a per-song timeout; a stuck one is abandoned (its thread ends with its ffmpeg)."""
    box: dict[str, Any] = {}

    def work() -> None:
        try:
            box["v"] = bpm.detect_bpm(path)
        except Exception as exc:
            box["e"] = exc

    t = threading.Thread(target=work, daemon=True)
    t.start()
    t.join(SONG_TIMEOUT)
    if t.is_alive():
        raise TimeoutError("bpm detection timed out")
    if "e" in box:
        raise box["e"]
    return box.get("v")


def _flush(job: Job, results: dict[str, int]) -> None:
    if not results:
        return
    uid = job.uid
    with deps.tx(uid, f"detect bpm for {len(results)} songs"):
        songs = library.load(deps.library_path(uid))
        changed = 0
        for vid, value in results.items():
            song = library.find_song(songs, vid)
            if song is None or song.get("bpm") is not None:
                continue
            song["bpm"] = round(value)
            song["updated_at"] = library.now_utc()
            changed += 1
        if changed:
            deps.save_songs(uid, songs)
    results.clear()


def _process(uid: str, vid: str) -> int | None:
    """The detected BPM, -1 when detection failed, None when the song is not eligible."""
    song = library.find_song(deps.load_songs(uid), vid)
    path = deps.audio_dir(uid) / library.file_name(song) if song and library.has_file(song) else None
    if song is None or song.get("bpm") is not None or path is None or not path.is_file():
        return None
    try:
        value = _detect(path)
    except Exception as exc:
        log.warning("bpm backfill failed for %s: %s", vid, exc)
        return -1
    return -1 if value is None else value


def _run(job: Job, ids: list[str]) -> None:
    global _active
    try:
        try:
            os.nice(NICE)
        except (AttributeError, OSError):
            pass
        uid = job.uid
        pending: dict[str, int] = {}
        batch = _batch()
        for vid in ids:
            if job.cancel.is_set():
                break
            outcome = _process(uid, vid)
            if outcome is None:
                job.skipped += 1
                continue
            if outcome < 0:
                job.failed += 1
            else:
                pending[vid] = outcome
                job.done += 1
            if len(pending) >= batch:
                _flush(job, pending)
            time.sleep(_sleep())
        _flush(job, pending)
        job.state = "cancelled" if job.cancel.is_set() else "done"
    except Exception as exc:
        log.exception("bpm backfill crashed")
        job.last_error = str(exc)[:200]
        job.state = "error"
    finally:
        job.finished_at = library.now_utc()
        with _lock:
            if _active == job.uid:
                _active = None
