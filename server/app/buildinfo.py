from __future__ import annotations

import re
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

APP_DIR = Path(__file__).resolve().parent.parent.parent
STARTED_AT = datetime.now(UTC)
_SHA = re.compile(r"[0-9a-f]{40}")
_FRESH_S = 120

def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

def _norm(value: str) -> str | None:
    try:
        return _iso(datetime.fromisoformat(value.strip().replace("Z", "+00:00")))
    except ValueError:
        return None

def _from_git(app_dir: Path) -> tuple[str, str | None] | None:
    try:
        out = subprocess.run(
            ["git", "-c", f"safe.directory={app_dir}", "-C", str(app_dir), "log", "-1", "--format=%H%x09%cI"],
            capture_output=True, text=True, timeout=5, check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    sha, _, date = out.partition("\t")
    return (sha, _norm(date)) if _SHA.fullmatch(sha) else None

def _read_file(path: Path) -> dict[str, str]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return {}
    fields = {}
    for line in text.splitlines():
        key, _, value = line.partition("=")
        fields[key.strip()] = value.strip()
    return fields

class BuildInfo:
    def __init__(self, app_dir: Path = APP_DIR, started_at: datetime | None = None) -> None:
        self.file = app_dir / "BUILD"
        self.started_at = started_at or STARTED_AT
        self.git = _from_git(app_dir)

    def current(self) -> dict[str, Any] | None:
        fields = _read_file(self.file)
        sha, committed = self.git or (None, None)
        file_sha = fields.get("sha", "")
        if sha is None and _SHA.fullmatch(file_sha):
            sha, committed = file_sha, _norm(fields.get("committed_at", ""))
        deployed = _norm(fields.get("deployed_at", ""))
        fresh = deployed is not None and deployed >= _iso(self.started_at.replace(microsecond=0) - timedelta(seconds=_FRESH_S))
        if not fresh or (sha is not None and file_sha and file_sha != sha):
            deployed = _iso(self.started_at)
        return {"sha": sha, "committed_at": committed, "deployed_at": deployed} if sha else None

_info: BuildInfo | None = None

def build() -> dict[str, Any] | None:
    global _info
    if _info is None:
        _info = BuildInfo()
    return _info.current()
