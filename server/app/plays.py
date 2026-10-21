"""Listening history (task-0056): an append-only CSV per user kept outside every git-synced tree, aggregated on read, copied into the repo once a day."""

from __future__ import annotations

import csv
import io
import json
import logging
import math
import os
import shutil
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from . import deps, readiness
from .jsonio import write_bytes_atomic, write_json_atomic

log = logging.getLogger("audioplayer.plays")

HEADER = ("timestamp", "song_id", "listened_s")
FILE = "play-history.csv"
KEYS_FILE = "batch-keys.json"
MARKER = ".last-sync"
LISTENED_THRESHOLD = 0.9
MIN_PLAY_S = 5.0
MAX_BATCH = 500
CONT_GAP_S = 900.0
REPAIR_GAP_S = 120.0
MAX_PLAY_S = 86400.0
OVERRUN = 1.1
KEEP_KEYS = 200
SYNC_EVERY_S = 24 * 3600
FIRST_SYNC_DELAY_S = 60.0
RETRY_S = 3600.0
MESSAGE = "sync listening history"
WINDOWS = ("today", "d7", "d30", "all")

_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}
_cache: dict[str, tuple[tuple[int, int], list[tuple[datetime, str, float]]]] = {}


def plays_root() -> Path:
    """AUDIO_PLAYS_DIR, else `.plays` in the music root (the dataset the service user already writes)."""
    env = os.environ.get("AUDIO_PLAYS_DIR", "").strip()
    return Path(env) if env else deps.music_dir() / ".plays"


def user_dir(uid: str) -> Path:
    return plays_root() / uid


def csv_path(uid: str) -> Path:
    return user_dir(uid) / FILE


def repo_copy(uid: str) -> Path:
    return deps.data_root() / "users" / uid / FILE


def _lock(uid: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(uid, threading.Lock())


def parse_timestamp(raw: Any) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        when = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    when = when.replace(tzinfo=UTC) if when.tzinfo is None else when.astimezone(UTC)
    if when > datetime.now(UTC) + timedelta(days=1):
        return None
    return when


def stamp(when: datetime) -> str:
    return when.strftime("%Y-%m-%dT%H:%M:%SZ")


def _limit(song: dict[str, Any]) -> float:
    duration = song.get("duration")
    if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration > 0:
        return min(MAX_PLAY_S, duration * OVERRUN)
    return MAX_PLAY_S


def _accept(raw: Any, songs: dict[str, dict[str, Any]]) -> tuple[str, str, float] | None:
    if not isinstance(raw, dict):
        return None
    when = parse_timestamp(raw.get("timestamp"))
    song_id = raw.get("song_id")
    song = songs.get(song_id) if isinstance(song_id, str) else None
    seconds = raw.get("listened_s")
    if when is None or song is None or isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds):
        return None
    cont = raw.get("cont") is True
    if seconds < MIN_PLAY_S and not (cont and seconds > 0):
        return None
    return when, song_id, round(min(float(seconds), _limit(song)), 1), cont


def _continues(prev: list[Any], when: datetime, song_id: str) -> bool:
    if prev[1] != song_id or when < prev[0]:
        return False
    return abs((when - prev[0]).total_seconds() - prev[2]) <= CONT_GAP_S


def _last_record(text: str) -> list[Any] | None:
    last = text.rstrip("\n").rsplit("\n", 1)[-1]
    if not last or last.startswith(HEADER[0]):
        return None
    try:
        row = next(csv.reader([last]))
        when = parse_timestamp(row[0])
        seconds = float(row[2])
    except (StopIteration, IndexError, ValueError):
        return None
    if len(row) != 3 or when is None or not math.isfinite(seconds):
        return None
    return [when, row[1], seconds]


def merge_fragments(rows: list[tuple[datetime, str, float]], durations: dict[str, float]) -> list[tuple[datetime, str, float]]:
    """Read-side repair: consecutive records of one song that continue an unfinished play (previous under 0.9 x duration, gap at most 120 s, timestamps in order) become one record, the sum capped at 1.1 x duration."""
    out: list[tuple[datetime, str, float]] = []
    for when, song_id, seconds in rows:
        duration = durations.get(song_id)
        if out and duration:
            prev_when, prev_id, prev_s = out[-1]
            gap = (when - prev_when).total_seconds() - prev_s
            if prev_id == song_id and when >= prev_when and prev_s < LISTENED_THRESHOLD * duration and gap <= REPAIR_GAP_S:
                out[-1] = (prev_when, prev_id, round(min(prev_s + seconds, OVERRUN * duration), 1))
                continue
        out.append((when, song_id, seconds))
    return out


def _seen_keys(folder: Path) -> list[str]:
    try:
        data = json.loads((folder / KEYS_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [k for k in data if isinstance(k, str)] if isinstance(data, list) else []


def append(uid: str, batch_key: str, plays: list[Any]) -> dict[str, Any]:
    """`{ok, appended, duplicate, ignored}`; a repeated batch key appends nothing. A `cont` play joins the previous record of the same song (merged in place) when it starts within 15 minutes of that record's end; a merged play counts as appended."""
    songs = {s["id"]: s for s in deps.load_songs(uid)}
    items = [row for row in (_accept(p, songs) for p in plays[:MAX_BATCH]) if row]
    folder = user_dir(uid)
    with _lock(uid):
        keys = _seen_keys(folder)
        if batch_key in keys:
            return {"ok": True, "appended": 0, "duplicate": True, "ignored": len(plays)}
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / FILE
        fresh = not path.exists() or path.stat().st_size == 0
        text = "" if fresh else path.read_text(encoding="utf-8")
        stored = _last_record(text)
        stored_edited = False
        rows: list[list[Any]] = []
        accepted = 0
        for when, song_id, seconds, cont in items:
            prev = rows[-1] if rows else stored
            if cont and prev is not None and _continues(prev, when, song_id):
                prev[2] = round(min(prev[2] + seconds, _limit(songs[song_id])), 1)
                stored_edited = stored_edited or not rows
                accepted += 1
            elif seconds >= MIN_PLAY_S:
                rows.append([when, song_id, seconds])
                accepted += 1
        lines = [[stamp(w), sid, sec] for w, sid, sec in rows]
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        if stored_edited:
            head = text.rstrip("\n").rsplit("\n", 1)[0]
            writer.writerow([stamp(stored[0]), stored[1], stored[2]])
            writer.writerows(lines)
            write_bytes_atomic(path, (head + "\n" + buffer.getvalue()).encode("utf-8"))
            _cache.pop(uid, None)
        elif lines or fresh:
            if fresh:
                writer.writerow(HEADER)
            writer.writerows(lines)
            with open(path, "a", encoding="utf-8", newline="") as f:
                f.write(buffer.getvalue())
                f.flush()
                os.fsync(f.fileno())
        write_json_atomic(folder / KEYS_FILE, [*keys, batch_key][-KEEP_KEYS:], compact=True)
    return {"ok": True, "appended": accepted, "duplicate": False, "ignored": len(plays) - accepted}


def _rows(uid: str) -> list[tuple[datetime, str, float]]:
    path = csv_path(uid)
    with _lock(uid):
        try:
            st = path.stat()
        except OSError:
            return []
        sig = (st.st_size, st.st_mtime_ns)
        hit = _cache.get(uid)
        if hit and hit[0] == sig:
            return hit[1]
        rows: list[tuple[datetime, str, float]] = []
        with open(path, encoding="utf-8", newline="") as f:
            for line in csv.reader(f):
                if len(line) != 3 or line[0] == HEADER[0]:
                    continue
                when = parse_timestamp(line[0])
                try:
                    seconds = float(line[2])
                except ValueError:
                    continue
                if when is not None and math.isfinite(seconds):
                    rows.append((when, line[1], seconds))
        _cache[uid] = (sig, rows)
        return rows


def _blank() -> dict[str, Any]:
    return {
        "listened": dict.fromkeys(WINDOWS, 0),
        "skipped": dict.fromkeys(WINDOWS, 0),
        "total_listened_s": 0.0,
        "last_listened": None,
    }


def listening(uid: str, now: datetime | None = None) -> dict[str, Any]:
    """Per-song counts of `listened` (listened_s >= LISTENED_THRESHOLD x duration) and `skipped` per window; a song without a known duration counts every play as skipped."""
    now = now or datetime.now(UTC)
    today = now.date()
    edges = {"d7": now - timedelta(days=7), "d30": now - timedelta(days=30)}
    songs = {s["id"]: s for s in deps.load_songs(uid)}
    out: dict[str, dict[str, Any]] = {}
    durations = {
        i: float(s["duration"])
        for i, s in songs.items()
        if isinstance(s.get("duration"), (int, float)) and not isinstance(s.get("duration"), bool) and s["duration"] > 0
    }
    for when, song_id, seconds in merge_fragments(_rows(uid), durations):
        song = songs.get(song_id)
        if song is None or when > now:
            continue
        duration = song.get("duration")
        known = isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration > 0
        outcome = "listened" if known and seconds >= LISTENED_THRESHOLD * duration else "skipped"
        entry = out.setdefault(song_id, _blank())
        counts = entry[outcome]
        counts["all"] += 1
        if when.date() == today:
            counts["today"] += 1
        for name, edge in edges.items():
            if when >= edge:
                counts[name] += 1
        entry["total_listened_s"] += seconds
        if outcome == "listened":
            day = when.date().isoformat()
            if entry["last_listened"] is None or day > entry["last_listened"]:
                entry["last_listened"] = day
    for entry in out.values():
        entry["total_listened_s"] = round(entry["total_listened_s"], 1)
    return {"songs": out, "generated": stamp(now)}


def delete_user(uid: str) -> None:
    """Account deletion: the outside history and the in-repo snapshot."""
    with _lock(uid):
        shutil.rmtree(user_dir(uid), ignore_errors=True)
        _cache.pop(uid, None)
    if repo_copy(uid).exists():
        with deps.tx(uid, "delete listening history"):
            repo_copy(uid).unlink(missing_ok=True)


# --- daily copy into the git-synced tree ------------------------------------------------------

def _changed() -> dict[str, bytes]:
    found: dict[str, bytes] = {}
    root = plays_root()
    if not root.is_dir():
        return found
    for folder in sorted(root.iterdir()):
        uid = folder.name
        if not folder.is_dir() or uid.startswith(".") or not (deps.data_root() / "users" / uid).is_dir():
            continue
        with _lock(uid):
            try:
                data = (folder / FILE).read_bytes()
            except OSError:
                continue
        try:
            same = repo_copy(uid).read_bytes() == data
        except OSError:
            same = False
        if not same:
            found[uid] = data
    return found


def sync_once() -> int:
    """Copy every changed history into the repo tree in one commit; returns how many users changed."""
    changed = _changed()
    if changed and deps.SYNC:
        with deps.SYNC.transaction():
            for uid, data in changed.items():
                write_bytes_atomic(repo_copy(uid), data)
            deps.SYNC.commit(MESSAGE)
    else:
        for uid, data in changed.items():
            write_bytes_atomic(repo_copy(uid), data)
    return len(changed)


def last_sync() -> float:
    try:
        return float((plays_root() / MARKER).read_text().strip())
    except (OSError, ValueError):
        return 0.0


def _mark(when: float) -> None:
    plays_root().mkdir(parents=True, exist_ok=True)
    (plays_root() / MARKER).write_text(f"{when:.0f}\n")


def sync_enabled() -> bool:
    off = os.environ.get("AUDIO_PLAYS_SYNC", "1").strip().lower() in ("0", "false", "no", "off")
    return not off and not readiness.sync_mode()


def _loop(stop: threading.Event) -> None:
    delay = FIRST_SYNC_DELAY_S
    while not stop.wait(delay):
        try:
            due = last_sync() + SYNC_EVERY_S - time.time()
            if due > 0:
                delay = min(due, RETRY_S)
                continue
            count = sync_once()
            _mark(time.time())
            log.info("listening history synced: %d users changed", count)
            delay = RETRY_S
        except Exception:
            log.exception("listening history sync failed, retrying later")
            delay = RETRY_S


_stop = threading.Event()
_thread: threading.Thread | None = None


def start_sync() -> threading.Thread | None:
    """Background daily copy; never blocks startup or readiness."""
    global _thread
    if not sync_enabled() or (_thread and _thread.is_alive()):
        return None
    _stop.clear()
    _thread = threading.Thread(target=_loop, args=(_stop,), name="plays-sync", daemon=True)
    _thread.start()
    return _thread


def stop_sync() -> None:
    _stop.set()
