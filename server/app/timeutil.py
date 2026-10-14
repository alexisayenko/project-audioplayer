"""UTC timestamps in the one format the data files and the API use: `YYYY-MM-DDTHH:MM:SSZ`."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
MIN_YEAR = 1900


def _utc_now() -> datetime:
    return datetime.now(UTC)


def max_year(now: datetime | None = None) -> int:
    """Latest allowed release year: the current UTC year plus one."""
    return (now or _utc_now()).year + 1


def valid_year(value: Any, now: datetime | None = None) -> int | None:
    """The year when it is an integer in MIN_YEAR..max_year, else None (lookups discard, never reject)."""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if MIN_YEAR <= value <= max_year(now) else None


def year_range_text(now: datetime | None = None) -> str:
    return f"from {MIN_YEAR} to {max_year(now)}"


def now_utc() -> str:
    return datetime.now(UTC).strftime(STAMP_FORMAT)


def epoch_of(stamp: Any) -> float | None:
    """Unix time of a stamp, or None when it is not one."""
    try:
        return datetime.strptime(str(stamp), STAMP_FORMAT).replace(tzinfo=UTC).timestamp()
    except ValueError:
        return None
