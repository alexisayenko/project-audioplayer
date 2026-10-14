from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from .. import deps, genre_graph, genres
from ..tags import namespaced_values

router = APIRouter()

GENRES_MAX = 1000


@router.get("/genres")
def get_genres(user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    counts: dict[str, int] = {}
    for s in deps.load_songs(user["uid"]):
        for value in namespaced_values(s.get("tags", []), "genre"):
            n = genres.normalise(value)
            if n:
                counts[n] = counts.get(n, 0) + 1
    used = sorted(counts, key=lambda g: (-counts[g], g))
    rest = [g for g in genres.BUILTIN if g not in counts]
    return {"genres": [*used, *rest][:GENRES_MAX]}


@router.get("/genres/graph")
def get_genre_graph(user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    return genre_graph.graph(deps.load_songs(user["uid"]), deps.DATA_DIR / "genre-ontology.json")
