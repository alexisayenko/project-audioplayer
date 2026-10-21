"""Trim on download (task-0045, ADR-0040): validation of a cut, the recipe stored on the primary source and the ffmpeg re-encode that makes the cut exact."""

from __future__ import annotations

import math
import os
import subprocess
from pathlib import Path
from typing import Any

from .problems import Problem

MIN_CUT = 1.0
ENCODE_TIMEOUT = 600
AAC_BITRATE = "192k"

Trim = tuple[float | None, float | None]
NONE: Trim = (None, None)


def _number(value: Any, name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise Problem(422, "invalid_trim", f"trim {name} must be a number of seconds, 0 or more")
    return float(value)


def check(start: Any, end: Any, duration: float | None = None) -> Trim:
    """A cleaned `(start, end)` in seconds, `(None, None)` for no cut; `end` is clamped to the known source duration. 422 `invalid_trim` / `trim_too_short`."""
    s, e = _number(start, "start"), _number(end, "end")
    if s == 0:
        s = None
    known = duration if isinstance(duration, (int, float)) and duration > 0 else None
    if known is not None:
        if s is not None and s >= known:
            raise Problem(422, "invalid_trim", f"trim start ({s:g} s) is beyond the end of the source ({known:g} s)")
        if e is not None and e > known:
            e = float(known)
    if e is not None and e <= (s or 0.0):
        raise Problem(422, "invalid_trim", "trim start must be before trim end")
    if s is None and e is None:
        return NONE
    length = (e if e is not None else known if known is not None else math.inf) - (s or 0.0)
    if length < MIN_CUT:
        raise Problem(422, "trim_too_short", f"the cut must be at least {MIN_CUT:g} s long")
    return s, e


def is_cut(trim: Trim | None) -> bool:
    return bool(trim) and trim != NONE


def _primary(song: dict[str, Any] | None) -> dict[str, Any]:
    sources = (song or {}).get("sources")
    return sources[0] if isinstance(sources, list) and sources and isinstance(sources[0], dict) else {}


def stored(song: dict[str, Any] | None) -> Trim:
    """The trim recorded on the primary source of a song; `(None, None)` when there is none."""
    src = _primary(song)
    return src.get("trim_start"), src.get("trim_end")


def source_duration(song: dict[str, Any] | None) -> float | None:
    """The full length of the primary source when known; a trimmed song's own `duration` is the cut length, so it is a fallback only for untrimmed songs."""
    src = _primary(song)
    if isinstance(src.get("duration"), (int, float)) and src["duration"] > 0:
        return float(src["duration"])
    own = (song or {}).get("duration")
    if stored(song) == NONE and isinstance(own, (int, float)) and own > 0:
        return float(own)
    return None


def persist(song: dict[str, Any], trim: Trim, source_seconds: float | None = None) -> None:
    """Write the trim onto the primary source of `song` (created from the platform and URL when the record has none)."""
    from . import sources

    song["sources"] = sources.normalize_sources(song)
    if not song["sources"]:
        return
    primary = song["sources"][0]
    primary["trim_start"], primary["trim_end"] = trim
    if source_seconds:
        primary["duration"] = source_seconds


def section(trim: Trim) -> tuple[float, float]:
    """The yt-dlp download section: start (0 when open) and end (infinity when open)."""
    return trim[0] or 0.0, trim[1] if trim[1] is not None else math.inf


def encode_command(src: Path, dst: Path, trim: Trim) -> list[str]:
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src)]
    if trim[0] is not None:
        cmd += ["-ss", f"{trim[0]:g}"]
    if trim[1] is not None:
        cmd += ["-to", f"{trim[1]:g}"]
    return cmd + ["-vn", "-c:a", "aac", "-b:a", AAC_BITRATE, "-movflags", "+faststart", str(dst)]


def probe_seconds(path: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout.strip()
        return float(out)
    except Exception:
        return None


def reencode(path: Path, trim: Trim) -> float | None:
    """Replace the m4a at `path` with its re-encoded cut (`NONE` re-encodes without cutting, for a file yt-dlp already sectioned); returns the resulting length in seconds when it can be read."""
    tmp = path.with_name(f"{path.stem}.trim.m4a")
    try:
        subprocess.run(encode_command(path, tmp, trim), capture_output=True, timeout=ENCODE_TIMEOUT, check=True)
        if not tmp.is_file() or tmp.stat().st_size == 0:
            raise RuntimeError("ffmpeg produced no audio")
        os.replace(tmp, path)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode(errors="replace").strip()[-200:]
        raise RuntimeError(f"trim failed: {detail or exc}") from exc
    finally:
        tmp.unlink(missing_ok=True)
    return probe_seconds(path)
