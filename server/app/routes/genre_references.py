"""Reference tracks per genre (API-216..API-222, ADR-0044): a shared catalogue every signed-in user reads, only the owner writes."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response

from .. import deps, genre_references as refs
from ..problems import Problem

router = APIRouter()

User = Annotated[dict[str, Any], Depends(deps.require_token)]
PATCHABLE = ("role", "note", "year", "reviewed", "sources", "source_url")


def _genre(name: str) -> str:
    genre = refs.resolve_genre(name)
    if genre is None:
        raise Problem(404, "unknown_genre", "That genre is not in the vocabulary.")
    return genre


def _owner(user: dict[str, Any]) -> None:
    if not user["owner"]:
        raise Problem(403, "owner_only", "Only the owner edits reference tracks.")


def _song_card(uid: str, song: dict[str, Any]) -> dict[str, Any]:
    pub = deps.public_song(uid, song)
    return {k: pub.get(k) for k in ("id", "title", "artist", "year", "album", "cover", "cover_v", "cover_source", "audio_state")}


def _view(entry: dict[str, Any], songs: dict[str, dict[str, Any]], uid: str) -> dict[str, Any]:
    out = refs.public(entry)
    song = songs.get(str(entry.get("song_id") or ""))
    out["in_library"] = song is not None
    if song is not None:
        out["song"] = _song_card(uid, song)
    return out


@router.get("/genres/references")
def get_all_references(user: User):
    """Every genre's entries in summary form (ids, roles, song ids) and the `by_song` map of song id to `[{genre, role}]`, for badges and the Library filter."""
    doc = refs.load()
    return {"references": {g: [refs.summary(r) for r in rows] for g, rows in sorted(doc.items())}, "by_song": refs.by_song(doc)}


@router.get("/genres/{name}/references", responses=deps.responses(404))
def get_genre_references(name: str, user: User):
    genre = _genre(name)
    uid = user["uid"]
    songs = {str(s.get("id")): s for s in deps.load_songs(uid)}
    return {"genre": genre, "references": [_view(r, songs, uid) for r in refs.load().get(genre, [])]}


@router.post("/genres/{name}/references", status_code=201, responses=deps.responses(403, 404, 409, 422))
def add_reference(name: str, body: dict[str, Any], user: User):
    """`{artist, title, year?, role, note?, sources?, song_id?}` or `{song_id, role, note?}` (artist, title and year come from the owner's library song)."""
    _owner(user)
    genre = _genre(name)
    uid = user["uid"]
    fields = dict(body)
    song = None
    if fields.get("song_id"):
        song = next((s for s in deps.load_songs(uid) if str(s.get("id")) == str(fields["song_id"])), None)
        if song is None:
            raise Problem(422, "unknown_song", "song_id is not in the owner's library.")
        facts = refs.song_facts(song)
        for key in ("artist", "title", "year"):
            if fields.get(key) in (None, ""):
                fields[key] = facts[key]
        fields["song_id"] = str(song["id"])
    with deps.tx(uid, f"reference add {genre}"):
        doc = refs.load()
        entry = refs.make_entry(doc, genre, fields)
        doc.setdefault(genre, []).append(entry)
        refs.save(doc)
    return _view(entry, {str(song["id"]): song} if song else {}, uid)


def _find(doc: dict[str, list[dict[str, Any]]], genre: str, ref_id: str) -> dict[str, Any]:
    for row in doc.get(genre, []):
        if row["id"] == ref_id:
            return row
    raise Problem(404, "unknown_reference", "No such reference track.")


@router.patch("/genres/{name}/references/{ref_id}", responses=deps.responses(403, 404, 422))
def patch_reference(name: str, ref_id: str, body: dict[str, Any], user: User):
    """Change `role`, `note`, `year`, `reviewed` or `sources` (the whole list is replaced; null or "" clears note and year). Artist, title and song_id do not change: delete and add instead."""
    _owner(user)
    genre = _genre(name)
    uid = user["uid"]
    unknown = sorted(set(body) - set(PATCHABLE))
    if unknown:
        raise Problem(422, "bad_reference", f"Cannot change: {', '.join(unknown)}.")
    with deps.tx(uid, f"reference edit {genre}"):
        doc = refs.load()
        row = _find(doc, genre, ref_id)
        if "role" in body:
            row["role"] = refs.clean_role(body["role"])
        if "year" in body:
            _set(row, "year", refs.clean_year(body["year"]))
        if "note" in body:
            _set(row, "note", refs.clean_note(body["note"]))
        if "reviewed" in body:
            if not isinstance(body["reviewed"], bool):
                raise Problem(422, "bad_reference", "reviewed must be true or false.")
            row["reviewed"] = body["reviewed"]
        if "sources" in body or "source_url" in body:
            _set(row, "sources", refs.sources_from(body) or None)
        refs.save(doc)
    songs = {str(s.get("id")): s for s in deps.load_songs(uid)}
    return _view(row, songs, uid)


def _set(row: dict[str, Any], key: str, value: Any) -> None:
    if value is None:
        row.pop(key, None)
    else:
        row[key] = value


@router.delete("/genres/{name}/references/{ref_id}", status_code=204, responses=deps.responses(403, 404))
def delete_reference(name: str, ref_id: str, user: User):
    _owner(user)
    genre = _genre(name)
    with deps.tx(user["uid"], f"reference delete {genre}"):
        doc = refs.load()
        row = _find(doc, genre, ref_id)
        doc[genre].remove(row)
        refs.save(doc)
    return Response(status_code=204)
