from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from .. import buildinfo, deps, userjson
from ..readiness import readiness

router = APIRouter()

NO_STORE = {
    "state": "ok", "unpushed": 0, "oldest_unpushed_age_s": None, "last_push_at": None, "stale_after_s": 90,
    "mode": "none", "timer_seen": True, "last_run_at": None, "last_error": None,
    "inbound": {"enabled": False, "last_pull_at": None, "behind": 0, "foreign_commits": 0, "last_rebase_at": None}, "repos": [],
}


@router.api_route("/health", methods=["GET", "HEAD"])
def health(viewer: Annotated[str, Depends(deps.sync_viewer)]) -> dict[str, Any]:
    owner = viewer == "owner"
    ready = readiness.snapshot(owner=owner)
    if deps.SYNC is None or readiness.starting():
        sync = dict(NO_STORE) if owner else {"state": "ok"}
        if readiness.starting():
            sync["state"] = "pending"
        body: dict[str, Any] = {"status": "ok", "sync": sync}
    else:
        body = {"status": "ok", "sync": deps.SYNC.sync_status(owner=owner)}
    body.update(ready)
    if owner:
        body["build"] = buildinfo.build()
        if bad := userjson.flagged(deps.data_root()):
            body["corrupt_files"] = bad
    return body
