"""Anonymous temp-staged downloads (ADR-0041): a signed-out device gets a song staged in a temp folder, fetches it, confirms, and the server deletes it.

No account, no library, no per-user storage. State is in memory; the staging root is <music_root>/.anon/<job-id>/.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import shutil
import threading
import time
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import deps, extractor, jobs, links, previewcache, session, urlclean
from .problems import Problem

log = logging.getLogger(__name__)

MB = 1024 * 1024
HEADER = "X-Anon-Token"
QUEUED, RUNNING, READY, FAILED, ACKED = "queued", "running", "ready", "failed", "acked"
ACTIVE = (QUEUED, RUNNING)
STAGING = ".anon"
COVER = "cover.jpg"
COVER_MAX_BYTES = 2 * MB
UNSUPPORTED = "Only a single YouTube or SoundCloud track link is supported."

clock = time.time


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def enabled() -> bool:
    return os.environ.get("ANON_DOWNLOADS_ENABLED", "1").strip().lower() not in ("0", "false", "off", "no")


def token_ttl() -> int:
    return max(60, _int("ANON_TOKEN_TTL_S", 30 * 24 * 3600))


def sessions_per_ip_hour() -> int:
    return _int("ANON_SESSIONS_PER_IP_HOUR", 20)


def device_per_hour() -> int:
    return _int("ANON_DEVICE_PER_HOUR", 5)


def ip_per_day() -> int:
    return _int("ANON_IP_PER_DAY", 30)


def device_concurrency() -> int:
    return max(1, _int("ANON_MAX_CONCURRENT_PER_DEVICE", 1))


def max_duration() -> int:
    return _int("ANON_MAX_DURATION_S", 15 * 60)


def max_file_bytes() -> int:
    return _int("ANON_MAX_FILE_MB", 60) * MB


def ready_ttl() -> int:
    return _int("ANON_READY_TTL_S", 3600)


def failed_ttl() -> int:
    return _int("ANON_FAILED_TTL_S", 900)


def min_free_bytes() -> int:
    return _int("ANON_MIN_FREE_MB", 2048) * MB


def max_queue() -> int:
    return _int("ANON_MAX_QUEUE", 20)


def sweep_interval() -> int:
    return max(1, _int("ANON_SWEEP_INTERVAL_S", 60))


# --- token ----------------------------------------------------------------------------------

def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _key() -> bytes:
    base = session._key()
    return hmac.new(base, b"anon-token-v1", hashlib.sha256).digest() if base else b""


def available() -> bool:
    return bool(_key())


def issue(did: str | None = None, now: float | None = None) -> tuple[str, int]:
    """A signed `{did, exp}` token for a (new) device id, and its lifetime in seconds."""
    when = clock() if now is None else now
    ttl = token_ttl()
    body = _b64(json.dumps({"d": did or secrets.token_hex(16), "x": int(when + ttl)}, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_key(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}", ttl


def read(token: str, now: float | None = None) -> str | None:
    """The device id of a valid, unexpired token; None otherwise."""
    key = _key()
    if not key or not token or "." not in token:
        return None
    body, _, sig = token.partition(".")
    if not hmac.compare_digest(sig.encode(), _b64(hmac.new(key, body.encode(), hashlib.sha256).digest()).encode()):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        did = data["d"]
        if not isinstance(did, str) or len(did) != 32 or int(data["x"]) < (clock() if now is None else now):
            return None
        return did
    except Exception:
        return None


def short(value: str) -> str:
    """A short keyed hash for the audit log (the raw device id and IP never appear in it)."""
    key = _key() or b"anon"
    return hmac.new(key, value.encode(), hashlib.sha256).hexdigest()[:8]


def ip_key(ip: str) -> str:
    """IPv6 clients are limited per /64, not per address."""
    if ":" in ip:
        head = ip.split("%")[0].split(":")
        if len(head) >= 4 and "" not in head[:4]:
            return ":".join(head[:4]) + "::/64"
    return ip


# --- limits ---------------------------------------------------------------------------------

class Window:
    """Events per key in the last `period` seconds, on the module clock."""

    def __init__(self, period: float) -> None:
        self.period = period
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _fresh(self, key: str, now: float) -> deque[float]:
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= self.period:
            hits.popleft()
        return hits

    def wait(self, key: str, limit: int, now: float) -> int:
        """0 when one more event fits, else the seconds until the oldest one leaves the window."""
        if limit <= 0:
            return int(self.period)
        with self._lock:
            hits = self._fresh(key, now)
            if len(hits) < limit:
                return 0
            return max(1, int(hits[len(hits) - limit] + self.period - now) + 1)

    def add(self, key: str, now: float) -> None:
        with self._lock:
            self._fresh(key, now).append(now)
            if len(self._hits) > 10000:
                self._hits = {k: h for k, h in self._hits.items() if h and now - h[-1] < self.period}

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


SESSIONS = Window(3600)
DEVICE_HOUR = Window(3600)
IP_DAY = Window(86400)

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def reset() -> None:
    SESSIONS.reset()
    DEVICE_HOUR.reset()
    IP_DAY.reset()
    with _lock:
        _jobs.clear()


def _limit(code: str, detail: str, wait: int) -> Problem:
    return Problem(429, code, detail, headers={"Retry-After": str(wait)}, retry_after=wait)


def check_session(ip: str, now: float | None = None) -> None:
    when = clock() if now is None else now
    wait = SESSIONS.wait(ip_key(ip), sessions_per_ip_hour(), when)
    if wait:
        raise _limit("limit_ip", "Too many sessions from this network. Try again later.", wait)
    SESSIONS.add(ip_key(ip), when)


# --- staging --------------------------------------------------------------------------------

def staging_root() -> Path:
    return deps.music_dir() / STAGING


def free_bytes(path: Path) -> int:
    probe = path
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    return shutil.disk_usage(probe).free


def classify(text: str) -> tuple[str, str]:
    """`(platform, normalized input)` for a YouTube link/id or a SoundCloud track/short link; Problem 422 `unsupported_url` otherwise."""
    text = (text or "").strip()
    if not text or len(text) > 2048:
        raise Problem(422, "unsupported_url", UNSUPPORTED)
    vid = urlclean.parse_video_id(text)
    if vid and urlclean.source_of(vid) == "youtube":
        return "youtube", vid
    sc = urlclean.classify_soundcloud(text)
    if sc and sc[0] in ("track", "short"):
        return "soundcloud", sc[1]
    raise Problem(422, "unsupported_url", UNSUPPORTED)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def create(did: str, ip: str, url: str) -> dict[str, Any]:
    """Validate, charge the limits, register a queued job and hand it to the shared scheduler."""
    if not enabled():
        raise Problem(403, "anon_disabled", "Anonymous downloads are turned off.")
    platform, source = classify(url)
    root = staging_root()
    if free_bytes(root) < min_free_bytes():
        log.warning("anon refused: disk_low")
        raise Problem(503, "disk_low", "The server is low on disk space. Try again later.", headers={"Retry-After": "600"})
    now = clock()
    ipk = ip_key(ip)
    with _lock:
        active = [j for j in _jobs.values() if j["state"] in ACTIVE]
        if len(active) >= max_queue():
            raise Problem(503, "busy", "The server is busy. Try again in a few minutes.", headers={"Retry-After": "60"})
        if sum(1 for j in active if j["did"] == did) >= device_concurrency():
            raise _limit("limit_concurrent", "One download at a time. Wait for the current one to finish.", 15)
        wait = DEVICE_HOUR.wait(did, device_per_hour(), now)
        if wait:
            raise _limit("limit_hour", f"You can download {device_per_hour()} songs per hour. Try again in {max(1, wait // 60)} min.", wait)
        wait = IP_DAY.wait(ipk, ip_per_day(), now)
        if wait:
            raise _limit("limit_ip", "Too many downloads from this network today. Try again tomorrow.", wait)
        DEVICE_HOUR.add(did, now)
        IP_DAY.add(ipk, now)
        job_id = secrets.token_urlsafe(16)
        job: dict[str, Any] = {
            "id": job_id, "did": did, "state": QUEUED, "progress": 0.0, "code": None, "platform": platform, "input": source,
            "meta": None, "size": None, "sha256": None, "created": now, "finished": None, "dir": root / job_id, "cancelled": False,
        }
        _jobs[job_id] = job
    log.info("anon job queued id=%s did=%s ip=%s platform=%s", job_id[:6], short(did), short(ipk), platform)
    deps.SCHED.submit("anon:" + did, False, lambda: _work(job), lambda: _start(job))
    return {"id": job_id, "status": QUEUED}


def get(job_id: str, did: str, acked_ok: bool = False) -> dict[str, Any]:
    """The job of this device, else 404 (another device's job and an unknown one look the same)."""
    with _lock:
        job = _jobs.get(job_id)
    if job is None or not hmac.compare_digest(job["did"], did) or (job["state"] == ACKED and not acked_ok):
        raise Problem(404, "not_found", "No such download.")
    return job


def public(job: dict[str, Any]) -> dict[str, Any]:
    state = job["state"]
    ready = state == READY
    return {
        "status": state,
        "progress": 1.0 if ready else min(float(job.get("progress") or 0.0), 0.99),
        "error_code": job["code"] if state == FAILED else None,
        "meta": job["meta"],
        "size": job["size"],
        "sha256": job["sha256"],
        "expires_at": _iso(job["finished"] + ready_ttl()) if ready else None,
    }


def file_path(job: dict[str, Any]) -> Path:
    if job["state"] != READY:
        raise Problem(409, "not_ready", "The download is not ready yet.")
    return job["dir"] / job["file"]


def cover_path(job: dict[str, Any]) -> Path:
    path = job["dir"] / COVER
    if job["state"] != READY or not path.is_file():
        raise Problem(404, "no_cover", "No cover.")
    return path


def acknowledge(job: dict[str, Any], digest: str) -> None:
    """The phone has the file: verify its hash, delete the staged files now. Repeating a good ack is harmless until the record expires."""
    digest = (digest or "").strip().lower()
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise Problem(422, "bad_hash", "sha256 must be 64 hex characters.")
    if job["state"] not in (READY, ACKED):
        raise Problem(409, "not_ready", "The download is not ready yet.")
    if not hmac.compare_digest(digest, job["sha256"]):
        log.info("anon ack hash mismatch id=%s did=%s", job["id"][:6], short(job["did"]))
        raise Problem(422, "hash_mismatch", "The hash does not match the staged file.")
    with _lock:
        if job["state"] == READY:
            job.update(state=ACKED, finished=clock())
            shutil.rmtree(job["dir"], ignore_errors=True)
            log.info("anon ack id=%s did=%s", job["id"][:6], short(job["did"]))


# --- the worker -----------------------------------------------------------------------------

class _Fail(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _start(job: dict[str, Any]) -> None:
    if job["state"] == QUEUED:
        job["state"] = RUNNING


def _refusal_code(refused: links.Refused) -> str:
    try:
        code = json.loads(refused.response.body).get("error", "")
    except Exception:
        code = ""
    return {"unsupported": "unsupported_url"}.get(code, code if code in ("not_found", "private", "preview_only") else "extractor_failed")


def _failure_code(exc: Exception) -> str:
    if isinstance(exc, _Fail):
        return exc.code
    if isinstance(exc, extractor.PreviewOnly):
        return "preview_only"
    if isinstance(exc, links.Refused):
        return _refusal_code(exc)
    return extractor.error_code(exc) or "extractor_failed"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _stage_cover(job: dict[str, Any], vid: str, artwork: str | None) -> None:
    dest = job["dir"] / COVER
    try:
        extractor.fetch_cover(vid, dest, artwork)
        if dest.stat().st_size > COVER_MAX_BYTES:
            dest.unlink(missing_ok=True)
    except Exception:
        dest.unlink(missing_ok=True)


def _fetch(job: dict[str, Any]) -> None:
    link = links.resolve_link(job["input"])
    vid = link.vid
    probe = link.probe or previewcache.youtube(vid)
    duration = probe.get("duration")
    if not isinstance(duration, (int, float)) or duration <= 0 or duration > max_duration():
        raise _Fail("too_long")
    out: Path = job["dir"]
    info = extractor.download_audio(vid, out, jobs.Tracker(job), link.url)
    target = out / f"{vid}.m4a"
    if not target.is_file():
        raise _Fail("extractor_failed")
    size = target.stat().st_size
    if size > max_file_bytes():
        raise _Fail("too_big")
    _stage_cover(job, vid, info.get("thumbnail") or probe.get("thumbnail"))
    meta = {
        "title": info.get("title") or probe.get("title") or "",
        "artist": info.get("artist") or probe.get("artist") or "",
        "duration": info.get("duration") or duration,
        "source_url": link.url,
        "platform": job["platform"],
        "year": probe.get("published_year"),
        "video_id": vid,
    }
    digest = _sha256(target)
    with _lock:
        if job["cancelled"]:
            return
        job.update(state=READY, progress=1.0, meta=meta, size=size, sha256=digest, file=target.name, finished=clock())
    log.info("anon job ready id=%s did=%s bytes=%d", job["id"][:6], short(job["did"]), size)


def _work(job: dict[str, Any]) -> None:
    try:
        _fetch(job)
    except Exception as exc:
        code = _failure_code(exc)
        if not isinstance(exc, (_Fail, links.Refused, extractor.PreviewOnly)):
            log.warning("anon job failed id=%s code=%s error=%s", job["id"][:6], code, type(exc).__name__)
        with _lock:
            job.update(state=FAILED, code=code, finished=clock())
        shutil.rmtree(job["dir"], ignore_errors=True)
        log.info("anon job failed id=%s did=%s code=%s", job["id"][:6], short(job["did"]), code)
    finally:
        if job["cancelled"]:
            shutil.rmtree(job["dir"], ignore_errors=True)


# --- sweeper --------------------------------------------------------------------------------

def _expired(job: dict[str, Any], now: float) -> bool:
    state = job["state"]
    if state == READY:
        return now - job["finished"] >= ready_ttl()
    if state in (FAILED, ACKED):
        return now - job["finished"] >= failed_ttl()
    if state == QUEUED:
        return now - job["created"] >= failed_ttl()
    return now - job["created"] >= 2 * failed_ttl()


def sweep(now: float | None = None) -> int:
    """Drop expired jobs and their files, and directories nobody owns. Returns how many jobs were removed."""
    when = clock() if now is None else now
    with _lock:
        gone = [j for j in _jobs.values() if _expired(j, when)]
        for job in gone:
            job["cancelled"] = True
            del _jobs[job["id"]]
        known = set(_jobs)
    for job in gone:
        shutil.rmtree(job["dir"], ignore_errors=True)
        log.info("anon sweep id=%s state=%s", job["id"][:6], job["state"])
    _drop_orphans(known, when)
    return len(gone)


def _drop_orphans(known: set[str], now: float) -> None:
    try:
        entries = list(staging_root().iterdir())
    except Exception:
        return
    for entry in entries:
        try:
            if entry.name not in known and now - entry.stat().st_mtime >= failed_ttl():
                shutil.rmtree(entry, ignore_errors=True) if entry.is_dir() else entry.unlink(missing_ok=True)
                log.info("anon sweep orphan %s", entry.name[:6])
        except OSError:
            pass


def purge_all() -> None:
    """On start the in-memory jobs are gone, so everything under the staging root is an orphan."""
    try:
        root = staging_root()
        if root.is_dir():
            for entry in root.iterdir():
                shutil.rmtree(entry, ignore_errors=True) if entry.is_dir() else entry.unlink(missing_ok=True)
    except Exception as exc:
        log.warning("anon purge skipped: %s", type(exc).__name__)


_stop = threading.Event()
_thread: threading.Thread | None = None


def _loop() -> None:
    while not _stop.wait(sweep_interval()):
        try:
            sweep()
        except Exception:
            log.exception("anon sweep failed")


def start() -> None:
    global _thread
    purge_all()
    _stop.clear()
    if _thread is None or not _thread.is_alive():
        _thread = threading.Thread(target=_loop, name="anon-sweeper", daemon=True)
        _thread.start()


def stop() -> None:
    _stop.set()
