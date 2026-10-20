from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .. import features

router = APIRouter()


@router.get("/features/data")
def features_data() -> JSONResponse:
    """Public, read-only data of the Features screen (API-190); no credentials, the repo it reads from is public."""
    body: dict[str, Any] = features.data()
    return JSONResponse(body, headers={"Cache-Control": "no-cache"})
