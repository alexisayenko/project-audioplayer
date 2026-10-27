"""The engine shared by the server-wide backfills (BPM, metadata): one job at a time, a daemon thread, state in memory only.

A backfill module supplies its candidate ids and a `work(job, ids)` loop that bumps the job's counters and watches `job.cancel`;
the runner owns the job table, the start/cancel/reset calls, the status shape and the final state."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import Any

from fastapi.responses import JSONResponse

from . import library
from .problems import Problem

log = logging.getLogger(__name__)


class Job:
    def __init__(self, uid: str, total: int, counters: tuple[str, ...]) -> None:
        self.uid = uid
        self.state = "running"
        self.total = total
        for name in counters:
            setattr(self, name, 0)
        self.started_at = library.now_utc()
        self.finished_at: str | None = None
        self.last_error: str | None = None
        self.cancel = threading.Event()
        self.thread: threading.Thread | None = None


class Runner:
    def __init__(self, label: str, counters: tuple[str, ...], candidates: Callable[[str], list[str]], work: Callable[[Job, list[str]], None]) -> None:
        self.label = label
        self.counters = counters
        self.candidates = candidates
        self.work = work
        self.jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._active: str | None = None

    def status(self, uid: str) -> dict[str, Any]:
        job = self.jobs.get(uid)
        found = len(self.candidates(uid))
        if job is None:
            return {"state": "idle", "candidates": found, "total": 0, **dict.fromkeys(self.counters, 0), "started_at": None, "finished_at": None}
        out = {"state": job.state, "candidates": found, "total": job.total, **{name: getattr(job, name) for name in self.counters},
               "started_at": job.started_at, "finished_at": job.finished_at}
        if job.last_error:
            out["last_error"] = job.last_error
        return out

    def start(self, uid: str) -> tuple[str, dict[str, Any] | None]:
        """('started', state) | ('nothing', state) | ('running', None) | ('busy', None)."""
        with self._lock:
            if self._active is not None:
                return ("running" if self._active == uid else "busy"), None
            ids = self.candidates(uid)
            if not ids:
                return "nothing", self.status(uid)
            job = Job(uid, len(ids), self.counters)
            self.jobs[uid] = job
            self._active = uid
            job.thread = threading.Thread(target=self._run, args=(job, ids), name=self.label.replace(" ", "-"), daemon=True)
            job.thread.start()
        return "started", self.status(uid)

    def cancel(self, uid: str) -> dict[str, Any]:
        job = self.jobs.get(uid)
        if job is not None and job.state == "running":
            job.cancel.set()
        return self.status(uid)

    def reset(self) -> None:
        for job in self.jobs.values():
            job.cancel.set()
            if job.thread is not None:
                job.thread.join(5)
        self.jobs.clear()
        self._active = None

    def _run(self, job: Job, ids: list[str]) -> None:
        try:
            self.work(job, ids)
            job.state = "cancelled" if job.cancel.is_set() else "done"
        except Exception as exc:
            log.exception("%s crashed", self.label)
            job.last_error = str(exc)[:200]
            job.state = "error"
        finally:
            job.finished_at = library.now_utc()
            with self._lock:
                if self._active == job.uid:
                    self._active = None


def start_reply(kind: str, state: dict[str, Any] | None, running: tuple[str, str], busy: tuple[str, str]) -> Any:
    """The POST answer for a `Runner.start` result: 202 with the state, 200 when there is nothing to do, 409 `running` (this user's job) or `busy` (another user's)."""
    if kind == "running":
        raise Problem(409, *running)
    if kind == "busy":
        raise Problem(409, *busy)
    if kind == "nothing":
        return JSONResponse(state, status_code=200)
    return state
