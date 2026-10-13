"""Identity -> user id, owner, signup policy, per-user locks and profile files."""
from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_OWNER = "alex.isayenko@gmail.com"
UID_LEN = 16

_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def user_lock(uid: str) -> threading.RLock:
    """Serialises writes to one user's library; never taken while holding the global git lock."""
    with _locks_guard:
        return _locks.setdefault(uid, threading.RLock())


def uid_for_email(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()[:UID_LEN]


def uid_for_sub(sub: str) -> str:
    return hashlib.sha256(str(sub).encode()).hexdigest()[:UID_LEN]


def _csv(name: str) -> list[str]:
    return [v.strip().lower() for v in os.environ.get(name, "").split(",") if v.strip()]


def owner_email() -> str:
    """OWNER_EMAIL, else the deprecated ALLOWED_EMAIL (first entry), else the default."""
    for name in ("OWNER_EMAIL", "ALLOWED_EMAIL"):
        values = _csv(name)
        if values:
            return values[0]
    return DEFAULT_OWNER


def owner_uid() -> str:
    return uid_for_email(owner_email())


def is_owner(uid: str) -> bool:
    return uid == owner_uid()


def pinned_apple_subs() -> set[str]:
    return set(_csv("ALLOWED_APPLE_SUB"))


def signup_open() -> bool:
    return os.environ.get("SIGNUP_OPEN", "1").strip().lower() not in ("0", "false", "no", "off")


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_profile(identity: dict[str, Any]) -> dict[str, Any]:
    provider = identity["provider"]
    profile: dict[str, Any] = {
        "email": identity.get("email") or None,
        "provider": provider,
        "created_at": now_utc(),
    }
    if identity.get("sub"):
        profile["subs"] = {provider: str(identity["sub"])}
    return profile


def read_profile(path: Path) -> dict[str, Any] | None:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (FileNotFoundError, ValueError):
        return None


def write_profile(path: Path, profile: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
