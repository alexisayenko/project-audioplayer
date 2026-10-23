from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from .. import deps, genre_graph, genre_vocab, genres, genres_v2
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
    used = sorted((g for g in counts if not genre_vocab.group(g)), key=lambda g: (-counts[g], g))
    vocab = genre_vocab.load().entries
    rest = [g for g in genres.BUILTIN if g not in counts and g in vocab]
    listed = set(rest)
    rest += sorted(g for g in vocab if g not in counts and g not in listed)
    return {"genres": [*used, *rest][:GENRES_MAX]}


@router.get("/genres/graph")
def get_genre_graph(user: Annotated[dict[str, Any], Depends(deps.read_user)]):
    return genre_graph.graph(deps.load_songs(user["uid"]), deps.DATA_DIR / "genre-ontology.json")


@router.get("/genres/vocabulary")
def get_genre_vocabulary(user: Annotated[dict[str, Any], Depends(deps.read_user)]):
    """The canonical genre list for the picker (TAG-077, TAG-080): `genres` with name, family, level (family or genre), parents, extra; `families` in display order. Same for every user, built once."""
    return genre_vocab.vocabulary()


@router.get("/genres/v2", responses=deps.responses(503))
def get_genres_v2(user: Annotated[dict[str, Any], Depends(deps.read_user)]):
    """Genres structure v2 (GEN-102): `{version, clusters, genres}`, separate from the v1 vocabulary."""
    try:
        return genres_v2.payload()
    except ValueError as e:
        raise HTTPException(503, detail=str(e)) from e
