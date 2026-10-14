"""Outbound rate limiters for the third-party lookups."""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager


class RateLimiter:
    """At least `interval` seconds between calls to one upstream."""

    def __init__(self, interval: float) -> None:
        self.interval = interval
        self.last_call = 0.0
        self._lock = threading.Lock()

    @contextmanager
    def serialized(self) -> Iterator[None]:
        """One call at a time: waits out the interval, holds the lock for the whole call and stamps its end."""
        with self._lock:
            wait = self.last_call + self.interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                yield
            finally:
                self.last_call = time.monotonic()

    def reserve(self) -> None:
        """Book the next slot under the lock, then wait for it outside, so concurrent callers queue up without serialising the calls."""
        with self._lock:
            now = time.monotonic()
            start = max(now, self.last_call + self.interval)
            self.last_call = start
        if start > now:
            time.sleep(start - now)


class WindowLimiter:
    """At most `max_calls` in any `period` seconds; `acquire` waits up to `max_wait`, else raises RuntimeError."""

    def __init__(self, max_calls: int, max_wait: float, period: float = 60.0, name: str = "rate limit") -> None:
        self.max_calls, self.max_wait, self.period, self.name = max_calls, max_wait, period, name
        self.window: deque[float] = deque()
        self._lock = threading.Lock()

    def acquire(self) -> None:
        with self._lock:
            while True:
                now = time.monotonic()
                while self.window and now - self.window[0] >= self.period:
                    self.window.popleft()
                if len(self.window) < self.max_calls:
                    self.window.append(now)
                    return
                wait = self.window[0] + self.period - now
                if wait > self.max_wait:
                    raise RuntimeError(f"{self.name} reached")
                time.sleep(wait)
