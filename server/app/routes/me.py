from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from .. import deps, limits, users

router = APIRouter()


@router.get("/me")
def me(user: Annotated[dict[str, Any], Depends(deps.require_token)]) -> dict[str, Any]:
    profile = users.read_profile(deps.profile_path(user["uid"])) or {}
    return {"email": user["email"], "provider": user["provider"], "owner": user["owner"],
            "created_at": profile.get("created_at")}


@router.get("/me/usage")
def me_usage(user: Annotated[dict[str, Any], Depends(deps.require_token)]) -> dict[str, Any]:
    uid = user["uid"]
    root = deps.user_audio_root(uid)
    return limits.usage(uid, user["owner"], deps.load_songs(uid), root if root is not None else Path(os.devnull))
