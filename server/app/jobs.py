"""Download scheduler: a global cap, a per-user cap, and FIFO order; extra jobs wait as `queued`."""
from __future__ import annotations

import logging
import threading
from collections import deque
from typing import Callable

from . import limits

log = logging.getLogger(__name__)


class _Job:
    def __init__(self, uid: str, exempt: bool, run: Callable[[], None], started: Callable[[], None]):
        self.uid, self.exempt, self.run, self.started = uid, exempt, run, started


class Scheduler:
    def __init__(self) -> None:
        self.inline = False
        self._lock = threading.Lock()
        self._pending: deque[_Job] = deque()
        self._running = 0
        self._by_user: dict[str, int] = {}

    def submit(self, uid: str, exempt: bool, run: Callable[[], None], started: Callable[[], None]) -> bool:
        """Queue a job; True when it starts at once. `inline` (tests) runs it in the caller."""
        job = _Job(uid, exempt, run, started)
        if self.inline:
            started()
            run()
            return True
        with self._lock:
            self._pending.append(job)
            began = self._pump_locked()
        return job in began

    def _allowed(self, job: _Job) -> bool:
        return job.exempt or self._by_user.get(job.uid, 0) < limits.user_concurrency()

    def _pump_locked(self) -> list[_Job]:
        began: list[_Job] = []
        while self._running < limits.global_concurrency():
            job = next((j for j in self._pending if self._allowed(j)), None)
            if job is None:
                break
            self._pending.remove(job)
            self._running += 1
            self._by_user[job.uid] = self._by_user.get(job.uid, 0) + 1
            began.append(job)
        for job in began:
            threading.Thread(target=self._work, args=(job,), daemon=True).start()
        return began

    def _work(self, job: _Job) -> None:
        try:
            job.started()
            job.run()
        except Exception:
            log.exception("download job crashed")
        finally:
            with self._lock:
                self._running -= 1
                self._by_user[job.uid] -= 1
                self._pump_locked()
