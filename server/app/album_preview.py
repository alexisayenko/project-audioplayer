"""What the YouTube video preview and the YouTube playlist preview share (task-0120, API-300, API-302): the album artist and title, default track artists, the description links with the Discogs release or auto-match, suggested genres, the cleaned album of a commit and the cover store. The two flows differ only in how their tracks are obtained."""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException

from . import album_covers, album_youtube, albums, credits_split, labels, playlist_import, timeutil
from .version_norm import normalize_version

VARIOUS = "Various Artists"
VARIOUS_HEADS = ("various", "various artists", "va")
TYPES = albums.TYPES
LINK_KINDS = ("discogs", "wikipedia", "rateyourmusic")
_TOPIC = re.compile(r"(?<!\s)\s+-\s+topic$", re.I)


def topic_free(name: Any) -> str:
    return _TOPIC.sub("", str(name or "")).strip()


def version_of(text: Any) -> dict[str, Any] | None:
    """A version text ("Foo Remix") as the song's version credit {type, name, artists}; None when empty."""
    value = str(text or "").strip()
    if not value:
        return None
    found = {"type": credits_split.kind_of(value), "name": normalize_version(value), "artists": credits_split.version_artists(value)}
    return {k: v for k, v in found.items() if v}


def album_artist(tracks: list[dict[str, Any]], hint: dict[str, Any], uploader: str) -> str:
    """The common track artist, else the guessed artist, else the uploader (without " - Topic"), else "Various Artists"."""
    named = [tuple(t["artists"]) for t in tracks if t["artists"]]
    if not named:
        return hint["artist"] or topic_free(uploader) or VARIOUS
    folded = {tuple(playlist_import._fold(a) for a in names) for names in named}
    if len(folded) == 1 and len(named) == len(tracks):
        return " & ".join(named[0])
    return VARIOUS


def album_title(source_title: str, hint: dict[str, Any], artist: str) -> str:
    head, album = hint["artist"], hint["album"]
    if album and head and (playlist_import._fold(head) == playlist_import._fold(artist) or playlist_import._fold(head) in VARIOUS_HEADS):
        return album
    return (f"{head} - {album}" if head and album else album) or source_title.strip()


def default_artists(tracks: list[dict[str, Any]], artist: str) -> None:
    """Tracks without an artist take the album artist (not "Various Artists"); `artist` on each track is the joined text."""
    for t in tracks:
        if not t["artists"] and artist != VARIOUS:
            t["artists"] = [artist]
        t["artist"] = " & ".join(t["artists"])


def album_out(source_title: str, hint: dict[str, Any], artist: str, cover: str | None) -> dict[str, Any]:
    return {"title": album_title(source_title, hint, artist)[: albums.MAX_TEXT], "albumArtist": artist, "type": hint["type"], "year": hint["year"], "coverUrl": cover}


def describe(hint: dict[str, Any], description: Any, listing: list[dict[str, Any]]) -> dict[str, Any]:
    """Links from the description, the Discogs release they name or the one exact master match, and suggested genres, for a guess and tracks [{position, title, durationS}]. The returned `hint` takes a matched release's artist, title, year and type; `cover` is that release's image (else None); `options` are the full search candidates (empty when a release matched) and `candidates` their compact form."""
    links = album_youtube.description_links(description)
    info = album_youtube.release_info(links["discogs"]) if links["discogs"] else None
    auto = False
    if info and album_youtube.matches_guess(hint, info):
        links["discogs"] = info["url"]
    elif links["discogs"] is None and (info := album_youtube.auto_match(hint, len(listing))):
        links["discogs"] = info["url"]
        auto = True
    else:
        info = None
    if info:
        hint = {"artist": info["artist"] or hint["artist"], "album": info["title"], "year": info["year"] or hint["year"], "type": info["type"] or hint["type"]}
    options: list[dict[str, Any]] = []
    error = None
    if info and info["genres"]:
        genres = info["genres"]
    else:
        options, genres, error = album_youtube.suggest(hint, listing)
    return {
        "hint": hint, "links": links, "discogsMatch": links["discogs"] if auto else None, "genres": genres,
        "options": options, "candidates": [] if info else album_youtube.public_candidates(options), "cover": info["cover"] if info else None, "searchError": error,
    }


def _bad(code: str) -> HTTPException:
    return HTTPException(status_code=422, detail=code)


def clean_links(raw: Any) -> dict[str, str | None]:
    """The user's Discogs, Wikipedia and RateYourMusic links normalised; an invalid or missing one is None (never an error)."""
    data = raw if isinstance(raw, dict) else {}
    out: dict[str, str | None] = {}
    for key in LINK_KINDS:
        try:
            out[key] = albums.clean_link(key, data.get(key))
        except albums.AlbumError:
            out[key] = None
    return out


def clean_album(raw: Any) -> dict[str, Any]:
    """The album of a commit validated: title, artist and a type are required (422 `bad_album`); year, vocabulary genres, label names (422 `bad_album` when malformed), an https cover and the three links are optional."""
    data = raw if isinstance(raw, dict) else {}
    title = str(data.get("title") or "").strip()[: albums.MAX_TEXT]
    artist = str(data.get("albumArtist") or "").strip()[: albums.MAX_TEXT]
    kind = "mix" if data.get("type") == "DJ mix" else data.get("type")
    if not title or not artist or kind not in TYPES:
        raise _bad("bad_album")
    year = data.get("year")
    if year is not None and (isinstance(year, bool) or not isinstance(year, int) or timeutil.valid_year(year) is None):
        raise _bad("bad_album")
    genres = data.get("genres")
    if genres is not None and (not isinstance(genres, list) or not all(isinstance(g, str) for g in genres)):
        raise _bad("bad_album")
    try:
        names = labels.clean(data.get("labels"))
    except ValueError:
        raise _bad("bad_album") from None
    cover = data.get("coverUrl")
    return {
        "title": title, "artist": artist, "type": kind, "year": year, "genres": albums._genres({"genres": genres or []}), "labels": names,
        "coverUrl": cover if isinstance(cover, str) and cover.startswith("https://") and len(cover) <= 500 else None,
        "links": clean_links(data.get("links")),
    }


def store_cover(uid: str, record: dict[str, Any], cover_url: str | None, fallback: str | None = None) -> None:
    """The chosen cover, else the fallback, else the automatic cover; every failure is swallowed (a new album never fails for its cover)."""
    try:
        for url in dict.fromkeys(u for u in (cover_url, fallback) if u and cover_url):
            try:
                album_covers.store(uid, record["id"], album_covers.fetch_jpeg(url), "url", url)
                return
            except Exception:
                continue
        album_covers.auto(uid, record)
    except Exception:
        return
