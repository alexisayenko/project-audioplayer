"""Startup readiness (API-188): the server listens first and runs the slow startup work (git recovery, migrations) in a background thread.

Until the work is done every request except the allow-listed ones answers 503 `{"detail": "starting"}` with `Retry-After`,
so no route reads or writes user data while a migration rewrites it. The cap `AUDIO_STARTUP_MAX_S` unblocks the app even if the worker hangs.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections.abc import Callable
from typing import Any

from starlette.types import ASGIApp, Receive, Scope, Send

from . import legal

log = logging.getLogger("audioplayer.readiness")

RETRY_AFTER_S = 3
DEFAULT_MAX_S = 300.0
PUBLIC_EXACT = frozenset({"/health", "/robots.txt", "/legal", "/", "/index.html"})
STATIC_PREFIXES = ("/_v/", "/js/", "/css/", "/img/", "/data/")
STATIC_ROOT_SUFFIXES = (".css", ".png", ".svg", ".ico", ".webmanifest")
_STATIC_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def max_seconds() -> float:
    try:
        return max(0.0, float(os.environ.get("AUDIO_STARTUP_MAX_S", "")))
    except ValueError:
        return DEFAULT_MAX_S


def sync_mode() -> bool:
    return os.environ.get("AUDIO_STARTUP_SYNC", "").strip().lower() in ("1", "true", "yes", "on")


def allowed_while_starting(method: str, path: str) -> bool:
    """The one allow-list: /health (any method), the page shell and the static web files (read only); everything else is API or data."""
    if path == "/health":
        return True
    if method not in _STATIC_METHODS:
        return False
    if path in PUBLIC_EXACT or path.startswith(STATIC_PREFIXES):
        return True
    return path.count("/") == 1 and path.endswith(STATIC_ROOT_SUFFIXES)


class Readiness:
    """idle (no startup run yet, nothing to wait for) -> starting -> ready | failed; `overdue` once the cap has passed."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._lock = threading.Lock()
        self._clock = clock
        self._state = "idle"
        self._step: str | None = None
        self._error: str | None = None
        self._started = 0.0
        self._finished = 0.0

    def reset(self) -> None:
        with self._lock:
            self._state, self._step, self._error, self._started, self._finished = "idle", None, None, 0.0, 0.0

    def begin(self) -> None:
        with self._lock:
            self._state, self._step, self._error = "starting", "begin", None
            self._started, self._finished = self._clock(), 0.0

    def step(self, name: str) -> None:
        with self._lock:
            if self._state == "starting":
                self._step = name

    def done(self) -> None:
        with self._lock:
            if self._state in ("starting", "overdue"):
                self._state, self._step, self._finished = "ready", None, self._clock()
        log.info("startup finished in %.1f s", self.elapsed())

    def fail(self, error: str) -> None:
        with self._lock:
            self._state, self._step, self._error, self._finished = "failed", None, error, self._clock()
        log.error("startup worker crashed after %.1f s, serving anyway: %s", self.elapsed(), error)

    def elapsed(self) -> float:
        with self._lock:
            if not self._started:
                return 0.0
            return round((self._finished or self._clock()) - self._started, 1)

    def blocking(self) -> bool:
        """True while requests must wait; flips to overdue (and logs once) when the cap has passed."""
        with self._lock:
            if self._state != "starting":
                return False
            if self._clock() - self._started < max_seconds():
                return True
            self._state = "overdue"
            step = self._step
        log.warning("startup still running at step %r after %s s: serving requests anyway (AUDIO_STARTUP_MAX_S)", step, max_seconds())
        return False

    def starting(self) -> bool:
        with self._lock:
            return self._state in ("starting", "overdue")

    def snapshot(self, owner: bool = False) -> dict[str, Any]:
        blocking = self.blocking()
        with self._lock:
            state = "ready" if self._state == "idle" else self._state
            out: dict[str, Any] = {"state": state, "step": self._step}
            if owner:
                out["elapsed_s"] = round((self._finished or self._clock()) - self._started, 1) if self._started else 0.0
                out["error"] = self._error
        return {"ready": not blocking, "startup": out}


readiness = Readiness()


def run_worker(steps: list[tuple[str, Callable[[], object]]], state: Readiness | None = None) -> None:
    """Run the steps in order; a step that raises is logged and skipped (as a failed migration always was), a crash outside a step marks the run failed."""
    state = state or readiness
    try:
        for name, fn in steps:
            state.step(name)
            try:
                fn()
            except Exception:
                log.exception("startup step %s failed", name)
        state.done()
    except BaseException as exc:
        state.fail(repr(exc))


def start_worker(steps: list[tuple[str, Callable[[], object]]], state: Readiness | None = None) -> threading.Thread | None:
    state = state or readiness
    state.begin()
    if sync_mode():
        run_worker(steps, state)
        return None
    thread = threading.Thread(target=run_worker, args=(steps, state), name="startup-worker", daemon=True)
    thread.start()
    return thread


class ReadinessMiddleware:
    """Pure ASGI, outermost: answers 503 for everything not allow-listed while the startup work runs."""

    def __init__(self, app: ASGIApp, state: Readiness | None = None) -> None:
        self.app = app
        self.state = state

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        state = self.state or readiness
        if scope["type"] != "http" or not state.blocking() or allowed_while_starting(scope["method"], scope["path"]):
            await self.app(scope, receive, send)
            return
        body = json.dumps({"detail": "starting", "step": state.snapshot()["startup"]["step"]}).encode()
        headers = [
            (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
            (b"retry-after", str(RETRY_AFTER_S).encode()), (b"cache-control", b"no-store"), (b"x-robots-tag", legal.ROBOTS_TAG.encode()),
        ]
        await send({"type": "http.response.start", "status": 503, "headers": headers})
        await send({"type": "http.response.body", "body": b"" if scope["method"] == "HEAD" else body})
