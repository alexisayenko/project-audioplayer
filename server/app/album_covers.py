"""Album covers (task-0120, API-260..API-263, DATA-206), mirroring the song covers of task-0054: one JPEG per album at `users/<uid>/covers/albums/<albumId>.jpg`, re-encoded by `coverimg.normalize` (5 MB, JPEG/PNG/WebP, at most 1024 px), fetched only through the SSRF-checked `coverimg.fetch` / `discogs_cover.fetch`. Sources: Discogs release images (DISCOGS_TOKEN), the Wikipedia page image of `links.wikipedia`, the YouTube thumbnail of `links.youtube`."""

from __future__ import annotations

import logging
import urllib.parse
from typing import Any

from . import albums, coverimg, deps, discogs_cover, discogs_lookup, library, urlclean, wiki_lookup

log = logging.getLogger(__name__)

SOURCES = ("discogs", "wikipedia", "youtube", "url")
STORED_SOURCES = (*SOURCES, "upload")
MAX_DISCOGS_IMAGES = 4
MAX_WIKIPEDIA_IMAGES = 2


def path_of(uid: str, album_id: str):
    return deps.covers_dir(uid) / "albums" / f"{album_id}.jpg"


def _own(album: dict[str, Any]) -> dict[str, Any]:
    cover = album.get("cover") if isinstance(album.get("cover"), dict) else {}
    source = cover.get("source")
    return {
        "source": source if source in STORED_SOURCES else None,
        "url": cover.get("url") if isinstance(cover.get("url"), str) else None,
        "v": cover.get("v") if isinstance(cover.get("v"), str) else None,
    }


def present(uid: str, album: dict[str, Any], songs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The album with `cover {source, url}` (its own cover), `coverUrl` and `coverFrom`: the album's own cover, else the cover of the first linked song that has one (`/covers/<songId>`), else null."""
    own = _own(album)
    has_file = own["source"] is not None and path_of(uid, album["id"]).is_file()
    cover = {"source": own["source"] if has_file else None, "url": own["url"] if has_file else None}
    if has_file:
        return {**album, "cover": cover, "coverUrl": f"/albums/{album['id']}/cover?v={own['v'] or ''}", "coverFrom": "album"}
    by_id = {s.get("id"): s for s in songs or []}
    for track in album.get("tracks") or []:
        song = by_id.get(track.get("songId")) if isinstance(track, dict) else None
        if song and song.get("cover"):
            version = song.get("cover_v")
            return {**album, "cover": cover, "coverUrl": f"/covers/{song['id']}" + (f"?v={version}" if version else ""), "coverFrom": "song"}
    return {**album, "cover": cover, "coverUrl": None, "coverFrom": None}


# --- candidates ----------------------------------------------------------------------------------

def _discogs_images(kind: str, ident: int) -> list[dict[str, Any]]:
    doc = discogs_cover._api(f"{kind}s/{ident}")
    if doc is None:
        return []
    items = [i for i in doc.get("images") or [] if isinstance(i, dict)]
    items.sort(key=lambda i: i.get("type") != "primary")
    out = []
    for item in items:
        url = next((item[k] for k in ("uri", "resource_url") if isinstance(item.get(k), str) and item[k].startswith("https://")
                    and discogs_cover.is_discogs_host(urllib.parse.urlsplit(item[k]).hostname)), None)
        if url:
            thumb = item.get("uri150") if isinstance(item.get("uri150"), str) and item["uri150"].startswith("https://") else url
            out.append({"source": "discogs", "url": url, "thumb": thumb, "width": _int(item.get("width")), "height": _int(item.get("height")), "label": "Discogs"})
    main = doc.get("main_release")
    if not out and kind == "master" and isinstance(main, int) and not isinstance(main, bool):
        return _discogs_images("release", main)
    return out[:MAX_DISCOGS_IMAGES]


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _video_id(album: dict[str, Any], link: str | None) -> str | None:
    if link:
        vid = urlclean.parse_video_id(link)
        if vid:
            return vid
    for track in album.get("tracks") or []:
        sid = track.get("songId") if isinstance(track, dict) else None
        if isinstance(sid, str) and urlclean.VIDEO_ID_RE.fullmatch(sid):
            return sid
    return None


def discogs_candidates(album: dict[str, Any], link: str | None) -> list[dict[str, Any]]:
    page = discogs_cover.parse_page(link or "")
    found: list[dict[str, Any]] = []
    if page and discogs_lookup._token():
        try:
            found = _discogs_images(*page)
        except Exception as exc:
            log.warning("album cover: discogs images failed: %s", type(exc).__name__)
    thumb = album.get("discogsThumb")
    if not found and isinstance(thumb, str) and thumb.startswith("https://"):
        found = [{"source": "discogs", "url": thumb, "thumb": thumb, "width": None, "height": None, "label": "Discogs search thumbnail"}]
    return found


def wikipedia_candidates(link: str | None) -> list[dict[str, Any]]:
    if not link:
        return []
    try:
        return [
            {"source": "wikipedia", "url": c["url"], "thumb": c.get("thumb") or c["url"], "width": c.get("width"), "height": c.get("height"), "label": "Wikipedia"}
            for c in wiki_lookup.cover_candidates([link])[:MAX_WIKIPEDIA_IMAGES]
        ]
    except Exception as exc:
        log.warning("album cover: wikipedia failed: %s", type(exc).__name__)
        return []


def youtube_candidates(album: dict[str, Any], link: str | None) -> list[dict[str, Any]]:
    vid = _video_id(album, link)
    if not vid:
        return []
    url = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    return [{"source": "youtube", "url": url, "thumb": url, "width": 480, "height": 360, "label": "YouTube thumbnail"}]


def candidates(album: dict[str, Any]) -> list[dict[str, Any]]:
    """What is available now, in priority order (Discogs, Wikipedia, YouTube); nothing is written."""
    links = albums.full_links(album)
    return [*discogs_candidates(album, links["discogs"]), *wikipedia_candidates(links["wikipedia"]), *youtube_candidates(album, links["youtube"])]


# --- storing -------------------------------------------------------------------------------------

def fetch_jpeg(url: str) -> bytes:
    return coverimg.normalize(discogs_cover.fetch(url))


def store(uid: str, album_id: str, jpeg: bytes, source: str, url: str | None) -> dict[str, Any] | None:
    with deps.tx(uid, f"album cover {album_id}"):
        items = albums.load(deps.albums_path(uid))
        album = next((a for a in items if a["id"] == album_id), None)
        if album is None:
            return None
        dest = path_of(uid, album_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        from .jsonio import write_bytes_atomic

        write_bytes_atomic(dest, jpeg)
        album["cover"] = {"source": source, "url": url, "v": coverimg.version_of(jpeg)}
        albums.save(deps.albums_path(uid), items)
        return album


def clear(uid: str, album_id: str) -> dict[str, Any] | None:
    with deps.tx(uid, f"album cover off {album_id}"):
        items = albums.load(deps.albums_path(uid))
        album = next((a for a in items if a["id"] == album_id), None)
        if album is None:
            return None
        path_of(uid, album_id).unlink(missing_ok=True)
        album["cover"] = {"source": None, "url": None, "v": None}
        albums.save(deps.albums_path(uid), items)
        return album


def remove_file(uid: str, album_id: str) -> None:
    path_of(uid, album_id).unlink(missing_ok=True)


def auto(uid: str, album: dict[str, Any]) -> dict[str, Any]:
    """The first cover that downloads, by priority Discogs, Wikipedia, YouTube; every failure is swallowed (a new album never fails for its cover). Returns the album as stored afterwards."""
    try:
        for candidate in candidates(album):
            try:
                jpeg = fetch_jpeg(candidate["url"])
            except Exception as exc:
                log.warning("album cover: %s image failed: %s", candidate["source"], type(exc).__name__)
                continue
            stored = store(uid, album["id"], jpeg, candidate["source"], candidate["url"])
            return stored or album
    except Exception as exc:
        log.warning("album cover: automatic cover failed: %s", type(exc).__name__)
    return album


def present_one(uid: str, album: dict[str, Any]) -> dict[str, Any]:
    return present(uid, album, library.load(deps.library_path(uid)) if any(isinstance(t, dict) and t.get("songId") for t in album.get("tracks") or []) else [])
