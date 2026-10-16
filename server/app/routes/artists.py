"""The Artist table (DATA-148): names with their countries."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from .. import artist_table, countrycodes, deps
from ..schemas import ArtistPatch

router = APIRouter()


@router.get("/artists")
def get_artists(user: dict[str, Any] = Depends(deps.read_user)):
    return deps.load_artists(user["uid"])


@router.patch("/artists/{name:path}", responses=deps.responses(404, 422))
def patch_artist(name: str, req: ArtistPatch, user: dict[str, Any] = Depends(deps.require_token)):
    """Replace the countries of one artist (ISO 3166-1 alpha-2 codes, alpha-3 codes or English names)."""
    unknown = [c for c in req.countries if countrycodes.canonical_country(c) is None]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown country: {unknown[0]}")
    if len(req.countries) > artist_table.MAX_COUNTRIES:
        raise HTTPException(status_code=422, detail=f"at most {artist_table.MAX_COUNTRIES} countries")
    uid = user["uid"]
    with deps.tx(uid, f"artist {name[:40]}"):
        doc = deps.load_doc(uid)
        if artist_table.find(doc["artists"], name) is None:
            raise HTTPException(status_code=404, detail="unknown artist")
        entry = artist_table.set_countries(doc["artists"], name, req.countries)
        deps.save_doc(uid, doc)
    return entry
