"""UTC timestamps in the one format the data files and the API use: `YYYY-MM-DDTHH:MM:SSZ`."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def now_utc() -> str:
    return datetime.now(UTC).strftime(STAMP_FORMAT)


def epoch_of(stamp: Any) -> float | None:
    """Unix time of a stamp, or None when it is not one."""
    try:
        return datetime.strptime(str(stamp), STAMP_FORMAT).replace(tzinfo=UTC).timestamp()
    except ValueError:
        return None
