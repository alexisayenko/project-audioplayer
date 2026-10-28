"""The album's genres onto its linked songs (task-0120, API-311), the genre twin of `album_covers.apply_to_songs`. Songs store genres as plain `genre:<name>` tags with no record of who chose them, so "own" is read from the data: no genres means automatic, genres that differ from the album's are kept until the caller confirms with `overwrite`."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from . import album_youtube, albums, deps, library
from .tags import namespace

log = logging.getLogger(__name__)


def _set_genres(song: dict[str, Any], genre_tags: list[str]) -> None:
    others = [t for t in library.tag_list(song) if namespace(t) != "genre"]
    song["tags"] = [*genre_tags, *others]
    song.pop("genres", None)
    song["updated_at"] = library.now_utc()


def apply_to_songs(uid: str, album_id: str, overwrite: bool = False) -> dict[str, Any] | None:
    """Give the album's genres to every linked song that exists in the library, in one library write. A song with no genres gets them; a song whose genres already are exactly the album's is left (`unchanged`); a song with other genres is kept (`skipped`) unless `overwrite`, which REPLACES its genres with the album's (its other tags stay). Returns `{linked, applied, unchanged, skipped, failed}`, None for an unknown album; raises `no_genres` when the album has none from the genre tree. A song that cannot be updated is counted in `failed` and the others are still saved."""
    with deps.tx(uid, f"album genres to songs {album_id}"):
        album = next((a for a in albums.load(deps.albums_path(uid)) if a["id"] == album_id), None)
        if album is None:
            return None
        wanted = library.clean_tags([f"genre:{g}" for g in album_youtube.vocab_genres(album.get("genres"))])
        keys = {n.casefold() for n in library.genre_names(wanted)}
        if not keys:
            raise HTTPException(status_code=409, detail="no_genres")
        songs = library.load(deps.library_path(uid))
        by_id = {s.get("id"): s for s in songs}
        ids = list(dict.fromkeys(t["songId"] for t in album.get("tracks") or [] if isinstance(t, dict) and t.get("songId") in by_id))
        result = {"linked": len(ids), "applied": 0, "unchanged": 0, "skipped": 0, "failed": 0}
        for sid in ids:
            song = by_id[sid]
            try:
                have = {n.casefold() for n in library.genre_names(library.tag_list(song))}
                if have == keys:
                    result["unchanged"] += 1
                elif have and not overwrite:
                    result["skipped"] += 1
                else:
                    _set_genres(song, wanted)
                    result["applied"] += 1
            except Exception as exc:
                log.warning("album genres to songs: %s", type(exc).__name__)
                result["failed"] += 1
        if result["applied"]:
            deps.save_songs(uid, songs)
        return result
