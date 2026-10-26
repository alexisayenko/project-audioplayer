"""Explicit albums (task-0120, ADR-0050, API-248..API-253, DATA-205): per-user `users/<uid>/albums.json`, phase 1 Discogs source only."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import urllib.error
from urllib.parse import parse_qsl, urlencode, urlsplit
from pathlib import Path
from typing import Any

from . import discogs_lookup, timeutil
from .jsonio import write_json_atomic

MAX_ALBUMS = 2000
MAX_TRACKS = 500
MAX_TEXT = 300
MAX_GENRES = 20
ID_RE = re.compile(r"alb_[0-9a-f]{8}")
_URL = re.compile(r"https://(?:www\.)?discogs\.com/(?:[a-z]{2}(?:-[A-Z]{2})?/)?(release|master)/(\d+)(?:[-/?#].*)?")
_POS = re.compile(r"\s+")


class AlbumError(Exception):
    def __init__(self, status: int, code: str, key: str | None = None):
        super().__init__(code)
        self.status, self.code, self.key = status, code, key


def parse_url(value: Any) -> tuple[str, int]:
    match = _URL.fullmatch(value.strip()) if isinstance(value, str) else None
    if not match:
        raise AlbumError(400, "bad_url")
    return match.group(1), int(match.group(2))


_RYM = re.compile(r"https://(?:www\.)?rateyourmusic\.com(/(?:release|album)/[^?#\s]*)(?:[?#].*)?")


def clean_rym(value: Any) -> str | None:
    """A RateYourMusic release link normalised (https, no www, no query or fragment); empty or None is None; anything else raises 422 bad_rym_url."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    text = value.strip() if isinstance(value, str) else ""
    match = _RYM.fullmatch(text) if len(text) <= 300 else None
    if not match:
        raise AlbumError(422, "bad_rym_url")
    return f"https://rateyourmusic.com{match.group(1)}"


LINK_KEYS = ("discogs", "rateyourmusic", "youtube", "wikipedia")
_YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
_WP_HOST = re.compile(r"(?:[a-z0-9-]+\.)+wikipedia\.org")


def _bad(key: str) -> AlbumError:
    return AlbumError(422, "bad_link", key)


def clean_link(key: str, value: Any) -> str | None:
    """A link of one kind normalised (https only, fragment dropped, at most 300 characters); empty or None is None; anything else raises 422 bad_link with the key."""
    if key not in LINK_KEYS:
        raise _bad(str(key))
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    text = value.strip() if isinstance(value, str) else ""
    if len(text) > MAX_TEXT or not text.startswith("https://"):
        raise _bad(key)
    if key == "rateyourmusic":
        try:
            return clean_rym(text)
        except AlbumError:
            raise _bad(key) from None
    if key == "discogs":
        found = discogs_lookup.clean_url(text)
        if not found:
            raise _bad(key)
        return found
    try:
        parts = urlsplit(text)
        host = (parts.hostname or "").lower()
    except ValueError:
        raise _bad(key) from None
    if key == "wikipedia":
        if not _WP_HOST.fullmatch(host) or not parts.path.startswith("/wiki/") or len(parts.path) < 7:
            raise _bad(key)
        return f"https://{host}{parts.path}"
    if host == "youtu.be" and len(parts.path) > 1:
        return f"https://youtu.be{parts.path}"
    if host in _YT_HOSTS and parts.path in ("/watch", "/playlist"):
        query = {k: v for k, v in reversed(parse_qsl(parts.query)) if k in ("v", "list") and v}
        needed = "list" if parts.path == "/playlist" else None
        if (needed and needed in query) or (not needed and ("v" in query or "list" in query)):
            ordered = {k: query[k] for k in ("v", "list") if k in query}
            return f"https://{host}{parts.path}?{urlencode(ordered)}"
    raise _bad(key)


def _stored_link(key: str, value: Any) -> str | None:
    try:
        return clean_link(key, value)
    except AlbumError:
        return None


def full_links(album: dict[str, Any]) -> dict[str, str | None]:
    """All four links of a stored album; an unedited discogs link is the import source link, rateyourmusic follows `rymUrl`."""
    stored = album.get("links") if isinstance(album.get("links"), dict) else {}
    out = {key: _stored_link(key, stored.get(key)) for key in LINK_KEYS}
    if "discogs" not in stored:
        source = album.get("source")
        out["discogs"] = _stored_link("discogs", source.get("url")) if isinstance(source, dict) else None
    out["rateyourmusic"] = _stored_rym(album.get("rymUrl")) or out["rateyourmusic"]
    return out


def set_links(album: dict[str, Any], changes: dict[str, Any]) -> None:
    """Applies already-validated link changes and keeps `rymUrl` and links.rateyourmusic equal."""
    links = full_links(album)
    links.update(changes)
    album["links"] = links
    album["rymUrl"] = links["rateyourmusic"]


MAX_FIELD = 200


def _bad_field(key: str) -> AlbumError:
    return AlbumError(422, "bad_field", key)


def clean_field(key: str, value: Any) -> Any:
    """One editable album field checked for PATCH; raises 422 bad_field with the key."""
    if key in ("title", "artist"):
        text = value.strip() if isinstance(value, str) else ""
        if not text or len(text) > MAX_FIELD:
            raise _bad_field(key)
        return text
    if key == "year":
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int) or not 1900 <= value <= 2100:
            raise _bad_field(key)
        return value
    if key == "genres":
        if not isinstance(value, list) or not all(isinstance(g, str) for g in value):
            raise _bad_field(key)
        return _genres({"genres": value})
    raise _bad_field(key)


def parse_duration(value: Any) -> int | None:
    parts = str(value or "").strip().split(":")
    if not 1 < len(parts) <= 3 or not all(p.isdigit() for p in parts):
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds or None


def _artists(detail: dict[str, Any]) -> str:
    names = [discogs_lookup._name_of(a) for a in detail.get("artists") or [] if isinstance(a, dict) and a.get("name")]
    return ", ".join(names)


def _flat_tracks(detail: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in detail.get("tracklist") or []:
        if not isinstance(item, dict):
            continue
        kind = item.get("type_") or "track"
        if kind == "heading":
            continue
        subs = [s for s in item.get("sub_tracks") or [] if isinstance(s, dict)]
        rows.extend(subs if kind == "index" and subs else [item])
    tracks = []
    for row in rows:
        title = _POS.sub(" ", str(row.get("title") or "")).strip()[:MAX_TEXT]
        if row.get("type_") == "heading" or not title:
            continue
        tracks.append({"no": len(tracks) + 1, "title": title, "durationS": parse_duration(row.get("duration"))})
    return tracks[:MAX_TRACKS]


def _genres(detail: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for key in ("genres", "styles"):
        for g in detail.get(key) or []:
            text = _POS.sub(" ", str(g)).strip()[:80]
            if text and text.casefold() not in {o.casefold() for o in out}:
                out.append(text)
    return out[:MAX_GENRES]


def _fetch(path: str) -> dict[str, Any]:
    if not os.environ.get("DISCOGS_TOKEN", "").strip():
        raise AlbumError(503, "discogs_unavailable")
    try:
        data = discogs_lookup._get(path)
    except urllib.error.HTTPError as exc:
        raise AlbumError(404 if exc.code == 404 else 502, "not_found" if exc.code == 404 else "discogs_failed") from exc
    except Exception as exc:
        raise AlbumError(502, "discogs_failed") from exc
    if not isinstance(data, dict):
        raise AlbumError(502, "discogs_failed")
    return data


def preview(url: Any) -> dict[str, Any]:
    kind, ident = parse_url(url)
    if kind == "master":
        main = _fetch(f"masters/{ident}").get("main_release")
        if not isinstance(main, int) or main <= 0:
            raise AlbumError(400, "bad_url")
        ident = main
    detail = _fetch(f"releases/{ident}")
    tracks = _flat_tracks(detail)
    title = str(detail.get("title") or "").strip()[:MAX_TEXT]
    if not title or not tracks:
        raise AlbumError(404, "not_found")
    return {
        "title": title,
        "artist": _artists(detail)[:MAX_TEXT],
        "year": timeutil.valid_year(detail.get("year")) if detail.get("year") else None,
        "genres": _genres(detail),
        "rymUrl": None,
        "links": {"discogs": f"https://www.discogs.com/release/{ident}", "rateyourmusic": None, "youtube": None, "wikipedia": None},
        "source": {"type": "discogs", "id": str(ident), "url": f"https://www.discogs.com/release/{ident}"},
        "tracks": tracks,
    }


def validate(body: Any) -> dict[str, Any]:
    """The preview payload re-checked; client extras are dropped. Raises AlbumError(422, ...)."""
    bad = AlbumError(422, "bad_album")
    if not isinstance(body, dict):
        raise bad
    src = body.get("source")
    if not isinstance(src, dict) or src.get("type") != "discogs" or not str(src.get("id") or "").isdigit():
        raise bad
    title = str(body.get("title") or "").strip()[:MAX_TEXT]
    raw = body.get("tracks")
    if not title or not isinstance(raw, list) or not raw or len(raw) > MAX_TRACKS:
        raise bad
    tracks = []
    for i, t in enumerate(raw, 1):
        name = str(t.get("title") or "").strip()[:MAX_TEXT] if isinstance(t, dict) else ""
        if not name:
            raise bad
        d = t.get("durationS")
        tracks.append({"no": i, "title": name, "durationS": d if isinstance(d, int) and not isinstance(d, bool) and 0 < d < 86400 * 2 else None})
    year = body.get("year")
    genres = _genres({"genres": body["genres"] if isinstance(body.get("genres"), list) else []})
    ident = str(int(src["id"]))
    given = body.get("links") if isinstance(body.get("links"), dict) else {}
    links = {key: clean_link(key, given[key]) for key in given}
    links.setdefault("discogs", f"https://www.discogs.com/release/{ident}")
    if body.get("rymUrl") not in (None, ""):
        links["rateyourmusic"] = clean_rym(body.get("rymUrl"))
    return {
        "title": title,
        "artist": str(body.get("artist") or "").strip()[:MAX_TEXT],
        "year": timeutil.valid_year(year) if isinstance(year, int) and not isinstance(year, bool) else None,
        "genres": genres,
        "rymUrl": links.get("rateyourmusic"),
        "links": {key: links.get(key) for key in LINK_KEYS},
        "source": {"type": "discogs", "id": ident, "url": f"https://www.discogs.com/release/{ident}"},
        "tracks": tracks,
    }


def new_id(existing: set[str]) -> str:
    while True:
        value = "alb_" + hashlib.sha1(secrets.token_bytes(16)).hexdigest()[:8]
        if value not in existing:
            return value


def _stored_rym(value: Any) -> str | None:
    try:
        return clean_rym(value)
    except AlbumError:
        return None


def load(path: Path) -> list[dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    items = raw.get("albums") if isinstance(raw, dict) else None
    good = [a for a in (items if isinstance(items, list) else []) if isinstance(a, dict) and isinstance(a.get("id"), str) and isinstance(a.get("tracks", []), list)]
    return [{**a, "rymUrl": full_links(a)["rateyourmusic"], "links": full_links(a), "genres": _genres({"genres": a["genres"] if isinstance(a.get("genres"), list) else []})} for a in good]


def save(path: Path, albums: list[dict[str, Any]]) -> None:
    write_json_atomic(path, {"albums": albums})


def find_source(albums: list[dict[str, Any]], source: dict[str, Any]) -> dict[str, Any] | None:
    for a in albums:
        s = a.get("source")
        if isinstance(s, dict) and s.get("type") == source["type"] and str(s.get("id")) == source["id"]:
            return a
    return None


def build(payload: dict[str, Any], existing: set[str]) -> dict[str, Any]:
    tracks = [{**t, "songId": None} for t in payload["tracks"]]
    return {"id": new_id(existing), **{k: payload[k] for k in ("title", "artist", "year", "genres", "rymUrl", "links", "source")}, "tracks": tracks, "created_at": timeutil.now_utc()}


def summary(a: dict[str, Any]) -> dict[str, Any]:
    return {"id": a["id"], "title": a.get("title", ""), "artist": a.get("artist", ""), "year": a.get("year"), "genres": a.get("genres") or [], "rymUrl": a.get("rymUrl"), "links": full_links(a), "trackCount": len(a.get("tracks") or []), "created_at": a.get("created_at")}


def without_dangling(album: dict[str, Any], song_ids: set[Any]) -> dict[str, Any]:
    """A copy whose `songId`s of songs missing from the library read as null (nothing is written)."""
    tracks = [{**t, "songId": t.get("songId") if t.get("songId") in song_ids else None} for t in album["tracks"] if isinstance(t, dict)]
    return {**album, "tracks": tracks}
