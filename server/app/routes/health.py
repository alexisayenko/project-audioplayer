from __future__ import annotations

from fastapi import APIRouter

from .. import deps

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "sync": deps.SYNC.status() if deps.SYNC else "ok"}
