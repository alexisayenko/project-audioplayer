"""BPM backfill: detect the tempo of songs that have audio on the server but no BPM yet.

One job at a time server-wide, run in a niced background thread, one song after another with a short pause,
results written in batches through the normal library transaction. State lives in memory only."""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

from . import backgroundjob, bpm, deps, library

log = logging.getLogger(__name__)

SONG_TIMEOUT = 60.0
NICE = 10


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


def candidates(uid: str) -> list[str]:
    """Ids of the user's songs with a bpm of null whose audio file is on the server."""
    out = []
    for song in deps.load_songs(uid):
        if song.get("bpm") is None and library.has_file(song) and (deps.audio_dir(uid) / library.file_name(song)).is_file():
            out.append(song["id"])
    return out


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


def _flush(job: backgroundjob.Job, results: dict[str, int]) -> None:
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


def _work(job: backgroundjob.Job, ids: list[str]) -> None:
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


_runner = backgroundjob.Runner("bpm backfill", ("done", "failed", "skipped"), candidates, _work)
_jobs = _runner.jobs
status = _runner.status
start = _runner.start
cancel = _runner.cancel
reset = _runner.reset
