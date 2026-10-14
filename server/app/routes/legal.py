from __future__ import annotations

from fastapi import APIRouter, Response

from .. import legal

router = APIRouter()


@router.get("/legal")
def legal_note(response: Response) -> dict[str, str | None]:
    response.headers["Cache-Control"] = "public, max-age=300"
    return {"note": legal.NOTE, "contact": legal.contact()}


@router.get("/robots.txt")
def robots_txt() -> Response:
    return Response(legal.ROBOTS_TXT, media_type="text/plain", headers={"Cache-Control": "public, max-age=300"})
