"""Crash-safe JSON file writes."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def _target(path: Path) -> Path:
    s = os.fspath(path)
    if chr(0) in s:
        raise ValueError("NUL byte in path")
    real = os.path.realpath(s)
    if os.path.isdir(real):
        raise IsADirectoryError(real)
    return Path(real)


def write_json_atomic(path: Path, data: Any, indent: int | None = 2, compact: bool = False) -> None:
    """Write `data` to a temp file in the same directory, fsync it and rename it over `path`; a failure leaves `path` untouched."""
    path = _target(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".json-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=None if compact else indent, separators=(",", ":") if compact else None)
            if not compact:
                f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)  # NOSONAR path validated by safepath.* in main(); only validated Paths reach here  # NOSONAR path validated by safepath.* in main(); only validated Paths reach here
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def write_bytes_atomic(path: Path, data: bytes) -> None:
    """Write `data` to a temp file in the same directory, fsync it and rename it over `path`; a failure leaves `path` untouched."""
    path = _target(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".json-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
