"""Albums from a YouTube playlist (task-0120, API-255..API-257): a preview that creates nothing (playlist tracks, a title guess, Discogs candidates with a track matching), a commit that creates the marked songs and the album, Discogs search and auto-linking of imported songs to tracks."""

from __future__ import annotations

import difflib
import logging
import os
import re
import urllib.error
import urllib.parse
from collections.abc import Iterator
from typing import Any

from fastapi import HTTPException

from . import album_covers, albums, credit_title, credits_split, credits_v1, deps, discogs_lookup, downloads, extractor, genre_filter, genre_lookup, library, limits, playlist_import, timeutil, urlclean, users
from .links import Resolved

MAX_CANDIDATES = 8
MAX_LABELS = 3
BEST_MIN_SCORE = 0.7
BEST_MARGIN = 0.1
SUBSTRING_SCORE = 0.6
MAX_SELECTED = 200
MAX_SUGGESTED_GENRES = 4
log = logging.getLogger(__name__)
_FULL_ALBUM = r"(?:(?:full|complete|entire|whole)\s+)?(?:album|lp|ep)"
_NOISE_GROUP = re.compile(rf"(?<!\s)\s*[\(\[]\s*{_FULL_ALBUM}(?:\s+(?:stream|version|playlist))?\s*[\)\]]", re.I)
_NOISE_TAIL = re.compile(r"(?<![\s\-–—:|])[\s\-–—:|]+(?:full|complete|entire|whole)\s+(?:album|lp|ep)(?:\s+stream)?\s*$", re.I)
_NOISE_WORDS = r"(?:official(?:\s+(?:audio|video|music\s+video|album|lyric\s+video|visualizer))?|hd|hq|4k|lyrics?|audio|full\s+(?:album\s+)?stream)"
_NOISE_TAGS = re.compile(rf"(?<!\s)\s*[\(\[]\s*{_NOISE_WORDS}\s*[\)\]]", re.I)
_SEP = re.compile(r"(?<!\s)\s+[-–—]\s+")
_TOPIC = re.compile(r"(?<!\s)\s+-\s+topic$", re.I)
_OPENER = re.compile(r"[\(\[]")
_CLOSER = re.compile(r"[\)\]]")
_IGNORED_BRACKET = re.compile(r"^\s*(?:mono|stereo|bonus track|\d{4}\s+(?:mix|version))\s*$", re.I)
_YEAR = re.compile(r"(?<![\w])((?:19|20)\d{2})(?![\w])")
_DESC_YEAR = re.compile(r"(?:released?|release date|℗|©|year)\D{0,15}((?:19|20)\d{2})(?!\d)", re.I)
_ROUND_YEAR = r"(?:19|20)\d{2}"
_ROUND_REMASTER = r"(?:\d{4}\s+)?re-?master(?:ed)?(?:\s+\d{4})?"
_TRAIL_ROUND = re.compile(rf"(?<!\s)\s*\(\s*({_ROUND_YEAR}|{_ROUND_REMASTER})\s*\)\s*$", re.I)
_TRAIL_YEAR = re.compile(r"(?<![\s,\-–—])[\s,\-–—]+(?:19|20)\d{2}$")


def guess_year(title: Any, description: Any = None) -> int | None:
    found = _YEAR.search(str(title or ""))
    if not found and description:
        found = _DESC_YEAR.search(str(description)[:3000])
    return timeutil.valid_year(int(found.group(1))) if found else None


def _strip_trail_square(text: str) -> str:
    end = len(text.rstrip())
    if not end or text[end - 1] != "]":
        return text
    close = end - 1
    opener = text.find("[", text.rfind("]", 0, close) + 1, close)
    return text if opener < 0 else text[: len(text[:opener].rstrip())]


def _clean_album(text: str) -> str:
    previous = None
    while previous != text and text:
        previous = text
        text = _strip_trail_square(text)
        text = _TRAIL_ROUND.sub("", text)
        if not re.fullmatch(r"(?:19|20)\d{2}", text.strip()):
            text = _TRAIL_YEAR.sub("", text)
        text = text.strip()
    return text


_TYPE_MIX_TITLE = re.compile(r"\b(?:dj[\s-]?(?:mix|set)|live\s+set|mixed\s+by|continuous\s+mix|mixtape)\b", re.I)
_TYPE_MIX_DESC = re.compile(r"\b(?:dj[\s-]?(?:mix|set)|live\s+set|continuous\s+mix)\b", re.I)
_TYPE_TITLE = (
    ("EP", re.compile(r"(?<![\w])EP(?![\w])")),
    ("single", re.compile(r"\bsingle\b", re.I)),
    ("compilation", re.compile(r"\b(?:compilation|various\s+artists)\b", re.I)),
    ("soundtrack", re.compile(r"\b(?:soundtrack|OST|original\s+score)\b", re.I)),
    ("live", re.compile(r"\blive\s+(?:at|in|from)\b|\(live\)|\[live\]", re.I)),
)


def guess_type(title: Any, description: Any = None) -> str:
    """album (default), EP, single, compilation, soundtrack, live or mix (a DJ mix or set); "mix" only when the title or description says so."""
    head = str(title or "")
    if _TYPE_MIX_TITLE.search(head) or (description and _TYPE_MIX_DESC.search(str(description)[:1500])):
        return "mix"
    return next((kind for kind, pattern in _TYPE_TITLE if pattern.search(head)), "album")


def guess(title: Any, uploader: Any, description: Any = None) -> dict[str, Any]:
    year = guess_year(title, description)
    kind = guess_type(title, description)
    text = _NOISE_TAGS.sub("", _NOISE_TAIL.sub("", _NOISE_GROUP.sub("", str(title or "")))).strip(" -–—|:")
    channel = str(uploader or "").strip()
    parts = _SEP.split(text, maxsplit=1)
    if len(parts) == 2 and all(p.strip() for p in parts):
        artist, album = parts[0].strip(), _clean_album(parts[1].strip())
    elif channel and text:
        artist, album = (_TOPIC.sub("", channel).strip() or None), _clean_album(text)
    else:
        artist, album = None, _clean_album(text)
    return {"artist": artist, "album": album or None, "year": year, "type": kind}


def vocab_genres(names: Any, limit: int = albums.MAX_GENRES) -> list[str]:
    """The given genre names mapped to the closed vocabulary (TAG-079: synonyms resolved, unknown names dropped), deduplicated, at most `limit`."""
    values = [n.strip() for n in names if isinstance(n, str) and n.strip()] if isinstance(names, list) else []
    mapped = genre_filter.filter_tags([f"genre:{v}" for v in values])
    return list(dict.fromkeys(t.partition(":")[2] for t in mapped))[:limit]


def _suggest_genres(hint: dict[str, Any], candidates: list[dict[str, Any]], tracks: list[dict[str, Any]]) -> list[str]:
    """Genres of the matched Discogs release, else MusicBrainz for the first track; [] on any failure."""
    try:
        pick = next((c for c in candidates if c.get("best")), None) or next((c for c in candidates[:1] if c["score"] >= BEST_MIN_SCORE), None)
        found = vocab_genres(pick.get("genres"), MAX_SUGGESTED_GENRES) if pick else []
        if not found and hint["artist"] and tracks:
            found = vocab_genres([t.partition(":")[2] for t in genre_lookup.suggest_tags(hint["artist"], tracks[0]["title"]) if t.startswith("genre:")], MAX_SUGGESTED_GENRES)
        return found
    except Exception as exc:
        log.warning("album genre suggestion failed: %s", exc)
        return []


def suggest(hint: dict[str, Any], tracks: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str], str | None]:
    """Discogs candidates, suggested vocabulary genres and a search error code for a guess and tracks [{position, title, durationS}]; shared by the playlist and the video preview."""
    candidates: list[dict[str, Any]] = []
    error = None
    if hint["artist"] or hint["album"]:
        try:
            candidates = search(hint["artist"], hint["album"], len(tracks), [t["durationS"] for t in tracks], tracks)["candidates"]
        except HTTPException as exc:
            error = exc.detail if exc.detail in ("discogs_unavailable", "discogs_failed") else "discogs_failed"
    return candidates, _suggest_genres(hint, candidates, tracks), error


_LINK_TEXT = re.compile(r"https?://[^\s<>\"'\]]+")


def description_links(description: Any) -> dict[str, str | None]:
    """The first Discogs release or master, Wikipedia and RateYourMusic album links in a video description, normalised; absent kinds are None."""
    found: dict[str, str | None] = {"discogs": None, "wikipedia": None, "rateyourmusic": None}
    for raw in _LINK_TEXT.findall(str(description or "")[:20000]):
        url = raw.rstrip(".,;:!?")
        while url.endswith(")") and url.count(")") > url.count("("):
            url = url[:-1]
        host = urllib.parse.urlsplit(url).hostname or ""
        key = "discogs" if host.endswith("discogs.com") else "wikipedia" if host.endswith("wikipedia.org") else "rateyourmusic" if host.endswith("rateyourmusic.com") else None
        if key is None or found[key]:
            continue
        try:
            found[key] = discogs_lookup.clean_url(url) if key == "discogs" else albums.clean_link(key, url.replace("http://", "https://", 1))
        except albums.AlbumError:
            continue
    return found


def _best_image(detail: dict[str, Any]) -> str | None:
    """The primary image of a Discogs release (else the first), else its thumb; https only."""
    images = [i for i in detail.get("images") or [] if isinstance(i, dict)]
    images.sort(key=lambda i: i.get("type") != "primary")
    urls = (str(i.get("uri") or i.get("resource_url") or "") for i in images)
    return next((u for u in urls if u.startswith("https://")), None) or (str(detail.get("thumb")) if str(detail.get("thumb") or "").startswith("https://") else None)


def release_info(link: str) -> dict[str, Any] | None:
    """One Discogs release or master link fetched: {url, title, artist, year, genres (vocabulary, at most 4), type, cover, trackCount}; None on any failure."""
    try:
        kind, ident = albums.parse_url(link)
        if kind == "master":
            main = albums._fetch(f"masters/{ident}").get("main_release")
            if not isinstance(main, int) or main <= 0:
                return None
            ident = main
        detail = albums._fetch(f"releases/{ident}")
        title = str(detail.get("title") or "").strip()[: albums.MAX_TEXT]
        if not title:
            return None
        images = [i for i in detail.get("images") or [] if isinstance(i, dict)]
        cover = _best_image(detail)
        return {
            "url": f"https://www.discogs.com/release/{ident}", "title": title, "artist": discogs_lookup._DISAMBIG.sub("", albums._artists(detail)).rstrip()[: albums.MAX_TEXT],
            "year": timeutil.valid_year(detail.get("year")) if detail.get("year") else None,
            "genres": vocab_genres([*(detail.get("styles") or []), *(detail.get("genres") or [])], MAX_SUGGESTED_GENRES),
            "type": format_type([d for f in detail.get("formats") or [] if isinstance(f, dict) for d in [*(f.get("descriptions") or []), f.get("name")]]),
            "cover": cover, "trackCount": len(albums._flat_tracks(detail)),
        }
    except Exception as exc:
        log.warning("discogs release lookup failed: %s", type(exc).__name__)
        return None


def matches_guess(hint: dict[str, Any], info: dict[str, Any]) -> bool:
    """A Discogs release agrees with the parsed guess: no guessed album, or a similar album title."""
    return not hint["album"] or _sim(hint["album"], info["title"]) >= SUBSTRING_SCORE


def _http(exc: Exception) -> HTTPException:
    if extractor.error_code(exc) in ("not_found", "private"):
        return HTTPException(status_code=404, detail="not_found")
    return HTTPException(status_code=502, detail="youtube_failed")


def _playlist_ref(url: Any) -> str:
    text = url if isinstance(url, str) else ""
    ref = urlclean.parse_playlist(text) if text.strip().lower().startswith("https://") else None
    if ref is None or ref[0] == "mix":
        raise HTTPException(status_code=400, detail="bad_url")
    if ref[0] == "private":
        raise HTTPException(status_code=404, detail="not_found")
    return ref[1]


def _song_ids(songs: list[dict[str, Any]]) -> dict[str, str]:
    """Video id -> library song id (a song's own id and its youtube sources)."""
    from .library import sources_of

    found: dict[str, str] = {}
    for song in songs:
        sid = str(song.get("id") or "")
        found.setdefault(sid, sid)
        for src in sources_of(song):
            if src.get("source") == "youtube":
                found.setdefault(str(src.get("id") or ""), sid)
    return found


def _listing(uid: str, owner: bool, list_id: str, songs: list[dict[str, Any]]) -> dict[str, Any]:
    playlist_import.charge_listing(uid, owner)
    try:
        return playlist_import.listing(list_id, songs)
    except Exception as exc:
        raise _http(exc) from exc


def _seconds(value: Any) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0 else None


def preview(uid: str, owner: bool, url: str, songs: list[dict[str, Any]]) -> dict[str, Any]:
    """Playlist tracks, a guess and Discogs candidates with matches; nothing is created."""
    list_id = _playlist_ref(url)
    found = _listing(uid, owner, list_id, songs)
    usable = [(i, e) for i, e in enumerate(found["entries"], 1) if e["state"] == "ok"]
    if not usable:
        raise HTTPException(status_code=404, detail="not_found")
    have = _song_ids(songs)
    tracks = [{"position": i, "videoId": e["id"], "title": e["title"], "durationS": _seconds(e["duration"]), "url": e["url"], "songId": have.get(e["id"])} for i, e in usable]
    meta = found["playlist"]
    uploader = str(meta["uploader"] or "")
    for track, (_, entry) in zip(tracks, usable):
        track["artists"] = _own_artists(entry, uploader)
        track["version"] = _version_text(entry)
    hint = guess(meta["title"], meta["uploader"], meta.get("description"))
    from . import album_preview

    listing = [{"position": t["position"], "title": t["title"], "durationS": t["durationS"]} for t in tracks]
    shared = album_preview.describe(hint, meta.get("description"), listing)
    hint = shared["hint"]
    artist = album_preview.album_artist([t for t in tracks if t["artists"]] or tracks, hint, uploader)
    album_preview.default_artists(tracks, artist)
    thumbnail = next((e["thumbnail"] for _, e in usable if e.get("thumbnail")), None)
    return {
        "playlist": {"title": meta["title"] or "", "uploader": meta["uploader"] or None, "count": len(tracks), "url": meta["url"]},
        "guess": hint,
        "tracks": tracks,
        "candidates": shared["options"],
        "genres": shared["genres"],
        "searchError": shared["searchError"],
        "album": album_preview.album_out(str(meta["title"] or ""), hint, artist, shared["cover"] or thumbnail),
        "links": shared["links"],
        "discogsMatch": shared["discogsMatch"],
        "discogsCandidates": shared["candidates"],
        "thumbnail": thumbnail,
    }


def _own_artists(entry: dict[str, Any], uploader: str) -> list[str]:
    """The artists parsed from the video title; the uploader channel alone does not count (the album artist replaces it)."""
    names = [str(a) for a in entry["mainArtists"] if str(a).strip()]
    channel = credit_title.fold(uploader)
    topic_free = credit_title.fold(_TOPIC.sub("", uploader))
    if names and channel and [credit_title.fold(a) for a in names] in ([channel], [topic_free]):
        return []
    return names


def _version_text(entry: dict[str, Any]) -> str | None:
    raw = entry.get("raw") if isinstance(entry.get("raw"), dict) else {}
    version = entry.get("version") if isinstance(entry.get("version"), dict) else {}
    return str(raw.get("remixer") or version.get("name") or "").strip() or None


# --- commit --------------------------------------------------------------------------------------

def _bad(code: str) -> HTTPException:
    return HTTPException(status_code=422, detail=code)


def _selected(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw or len(raw) > MAX_SELECTED:
        raise _bad("bad_selection")
    out, seen_pos, seen_vid, seen_no = [], set(), set(), set()
    for item in raw:
        pos = item.get("position") if isinstance(item, dict) else None
        vid = str(item.get("videoId") or "") if isinstance(item, dict) else ""
        title = str(item.get("title") or "").strip()[: albums.MAX_TEXT] if isinstance(item, dict) else ""
        if isinstance(pos, bool) or not isinstance(pos, int) or pos < 1 or pos in seen_pos or not urlclean.VIDEO_ID_RE.fullmatch(vid) or vid in seen_vid or not title:
            raise _bad("bad_selection")
        seen_pos.add(pos)
        seen_vid.add(vid)
        row = {"position": pos, "videoId": vid, "title": title, "durationS": _seconds(item.get("durationS"))}
        if isinstance(item.get("artists"), list):
            names = [str(a).strip()[: albums.MAX_TEXT] for a in item["artists"] if isinstance(a, str) and a.strip()]
            if len(names) != len(item["artists"]) or len(names) > 10:
                raise _bad("bad_selection")
            row["artists"] = names
        if "version" in item:
            if item["version"] is not None and not isinstance(item["version"], str):
                raise _bad("bad_selection")
            row["version"] = (item["version"] or "").strip()[: albums.MAX_TEXT] or None
        number = item.get("trackNo")
        if number is not None:
            if isinstance(number, bool) or not isinstance(number, int) or not 0 < number < 1000 or number in seen_no:
                raise _bad("bad_selection")
            seen_no.add(number)
            row["trackNo"] = number
        out.append(row)
    return sorted(out, key=lambda s: s["position"])


def _mapping(raw: Any, selected: list[dict[str, Any]], track_numbers: set[int]) -> dict[int, int]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise _bad("bad_mapping")
    positions = {s["position"] for s in selected}
    out: dict[int, int] = {}
    used: set[int] = set()
    for key, no in raw.items():
        try:
            pos = int(key)
        except (TypeError, ValueError):
            raise _bad("bad_mapping") from None
        if pos not in positions:
            raise _bad("bad_mapping")
        if no is None:
            continue
        if isinstance(no, bool) or not isinstance(no, int) or no not in track_numbers or no in used:
            raise _bad("bad_mapping")
        used.add(no)
        out[pos] = no
    return out


def _fallback_payload(raw: Any, selected: list[dict[str, Any]], list_id: str) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    title = str(data.get("title") or "").strip()[: albums.MAX_TEXT]
    if not title:
        raise _bad("bad_album")
    year = data.get("year")
    return {
        "title": title,
        "artist": str(data.get("artist") or "").strip()[: albums.MAX_TEXT],
        "year": timeutil.valid_year(year) if isinstance(year, int) and not isinstance(year, bool) else None,
        "genres": albums._genres({"genres": vocab_genres(data.get("genres"))}),
        "type": albums.clean_type(data.get("type")),
        "rymUrl": None,
        "links": {"discogs": None, "rateyourmusic": None, "youtube": None, "wikipedia": None},
        "source": {"type": "youtube", "id": list_id, "url": urlclean.playlist_url(list_id)},
        "tracks": [{"no": i, "title": s["title"], "durationS": s["durationS"]} for i, s in enumerate(selected, 1)],
    }


def _album_payload(raw: Any, selected: list[dict[str, Any]], list_id: str, playlist_link: str) -> tuple[dict[str, Any], dict[int, int], str | None]:
    """The album create payload of the `album` form (API-303): the selected videos in order, every one linked; and the chosen cover address."""
    from . import album_preview

    a = album_preview.clean_album(raw)
    links = {**a["links"], "youtube": playlist_link}
    numbered = all("trackNo" in s for s in selected)
    order = sorted(selected, key=lambda s: s["trackNo"]) if numbered else selected
    numbers = {s["position"]: (s["trackNo"] if numbered else i) for i, s in enumerate(order, 1)}
    payload = {
        "title": a["title"], "artist": a["artist"], "year": a["year"], "genres": a["genres"], "type": a["type"], "rymUrl": links["rateyourmusic"], "links": links,
        "source": {"type": "youtube", "id": list_id, "url": urlclean.playlist_url(list_id)},
        "tracks": [{"no": numbers[s["position"]], "title": s["title"], "durationS": s["durationS"]} for s in order],
    }
    return payload, numbers, a["coverUrl"]


def _commit_payload(body: dict[str, Any], selected: list[dict[str, Any]], list_id: str) -> tuple[dict[str, Any], dict[int, int]]:
    if body.get("candidate") is None:
        payload = _fallback_payload(body.get("fallback"), selected, list_id)
        return payload, {s["position"]: i for i, s in enumerate(selected, 1)}
    candidate = body["candidate"]
    if isinstance(candidate, dict) and "source" not in candidate and isinstance(candidate.get("discogsId"), int):
        candidate = {**candidate, "source": {"type": "discogs", "id": str(candidate["discogsId"])}}
    payload = albums.validate(candidate)
    if body.get("type"):
        payload["type"] = albums.clean_type(body["type"])
    return payload, _mapping(body.get("mapping"), selected, {t["no"] for t in payload["tracks"]})


def commit(uid: str, owner: bool, body: dict[str, Any], songs: list[dict[str, Any]]) -> dict[str, Any]:
    list_id = _playlist_ref(body.get("playlistUrl"))
    playlist_link = albums._stored_link("youtube", body.get("playlistUrl")) or urlclean.playlist_url(list_id)
    selected = _selected(body.get("selected"))
    new_form = isinstance(body.get("album"), dict)
    cover_url = None
    try:
        if new_form:
            payload, mapping, cover_url = _album_payload(body["album"], selected, list_id, playlist_link)
        else:
            payload, mapping = _commit_payload(body, selected, list_id)
    except albums.AlbumError as exc:
        raise HTTPException(status_code=exc.status, detail={"code": exc.code, "key": exc.key} if exc.key else exc.code) from exc
    payload["links"] = {**payload["links"], "youtube": playlist_link}
    have = _song_ids(songs)
    fresh = [s for s in selected if s["videoId"] not in have]
    with users.user_lock(uid):
        existing = albums.find_source(albums.load(deps.albums_path(uid)), payload["source"])
    if existing:
        raise HTTPException(status_code=409, detail={"code": "already_exists", "id": existing["id"]})
    if not owner and len(songs) + len(fresh) > limits.max_songs():
        raise HTTPException(status_code=409, detail="library_full_songs")
    views, channel = _views(uid, owner, list_id, songs, fresh)
    for s in fresh:
        entry = views.get(s["videoId"]) or _minimal(s)
        _create(uid, _with_album_artist(_with_track(entry, s) if new_form else entry, payload["artist"], channel), payload)
    ids = {s["position"]: have.get(s["videoId"], s["videoId"]) for s in selected}
    with deps.tx(uid, "albums commit"):
        items = albums.load(deps.albums_path(uid))
        dup = albums.find_source(items, payload["source"])
        if dup:
            raise HTTPException(status_code=409, detail={"code": "already_exists", "id": dup["id"]})
        if len(items) >= albums.MAX_ALBUMS:
            raise HTTPException(status_code=409, detail="album_limit")
        album = albums.build(payload, {a["id"] for a in items})
        by_no = {t["no"]: t for t in album["tracks"]}
        for pos, no in mapping.items():
            by_no[no]["songId"] = ids[pos]
        albums.save(deps.albums_path(uid), [album, *items])
        own = {have[s["videoId"]]: " & ".join(s["artists"]) for s in selected if new_form and s["videoId"] in have and s.get("artists")}
        fill_songs(uid, album, [have[s["videoId"]] for s in selected if s["videoId"] in have], own)
    if new_form:
        from . import album_preview

        album_preview.store_cover(uid, album, cover_url, extractor.cover_url(selected[0]["videoId"]))
        if body.get("coverToSongs") is True:
            album_covers.apply_to_new_songs(uid, album["id"], [s["videoId"] for s in fresh])
        album = next((a for a in albums.load(deps.albums_path(uid)) if a["id"] == album["id"]), album)
        album = album_covers.present_one(uid, album)
    else:
        album = album_covers.present_one(uid, album_covers.auto(uid, album))
    return {
        "album": album,
        "songs": [{"position": s["position"], "songId": ids[s["position"]]} for s in selected],
        "linked": len(mapping),
        "unlinked": len(album["tracks"]) - len(mapping),
    }


def _views(uid: str, owner: bool, list_id: str, songs: list[dict[str, Any]], fresh: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], str]:
    if not fresh:
        return {}, ""
    try:
        playlist_import.charge_listing(uid, owner)
        found = playlist_import.listing(list_id, songs)
    except Exception:
        return {}, ""
    return {e["id"]: e for e in found["entries"] if e["state"] == "ok"}, str(found["playlist"].get("uploader") or "")


def _minimal(selected: dict[str, Any]) -> dict[str, Any]:
    return {"id": selected["videoId"], "title": selected["title"], "mainArtists": [], "featuredArtists": [], "withArtists": [], "version": None,
            "duration": selected["durationS"], "thumbnail": None}


def _with_track(entry: dict[str, Any], selected: dict[str, Any]) -> dict[str, Any]:
    """The listing entry with the title, artists and version the user edited (API-303)."""
    from . import album_preview

    out = {**entry, "title": selected["title"]}
    if selected.get("artists"):
        out["mainArtists"] = selected["artists"]
    if "version" in selected:
        out["version"] = album_preview.version_of(selected["version"])
    return out


def _with_album_artist(entry: dict[str, Any], album_artist: str, channel: str = "") -> dict[str, Any]:
    """A track with no artist of its own, or only the uploader channel as its artist, gets the album artist (never "Various Artists")."""
    if not album_artist or discogs_lookup._is_various(album_artist):
        return entry
    names = [credit_title.fold(a) for a in entry["mainArtists"]]
    only_channel = bool(channel) and names == [credit_title.fold(channel)] and names != [credit_title.fold(album_artist)]
    if names and not only_channel:
        return entry
    return {**entry, "mainArtists": credits_v1.pills(album_artist)}


def _album_tags(album: dict[str, Any]) -> list[str]:
    return [f"genre:{g}" for g in vocab_genres(album.get("genres"))]


def _create(uid: str, entry: dict[str, Any], album: dict[str, Any] | None = None) -> None:
    meta: dict[str, Any] = {"title": entry["title"], "mainArtists": entry["mainArtists"], "featuredArtists": entry["featuredArtists"]}
    if album:
        meta["albums"] = [album["title"]]
        if album.get("year"):
            meta["releaseYear"] = album["year"]
    if entry["withArtists"]:
        meta["withArtists"] = entry["withArtists"]
    if entry["version"]:
        meta["version"] = {k: v for k, v in entry["version"].items() if v}
    probe = {"duration": entry["duration"], "thumbnail": entry["thumbnail"], "tags": []}
    link = Resolved(entry["id"], urlclean.watch_url(entry["id"]), probe)
    try:
        downloads.add_metadata_only(uid, entry["id"], link, meta, _album_tags(album) if album else [])
    except HTTPException as exc:
        if exc.status_code != 409:
            raise


def fill_song(song: dict[str, Any], album: dict[str, Any], artist: str | None = None) -> bool:
    """Copies the album's title, year, vocabulary genres and the track (else album) artist into the song's EMPTY fields; nothing non-empty is overwritten. Returns whether the song changed."""
    changed = False
    title, year = str(album.get("title") or "").strip(), album.get("year")
    if title and not song.get("albums"):
        song["albums"], changed = [title], True
    if year and song.get("releaseYear") is None:
        song["releaseYear"], changed = year, True
    tags = _album_tags(album)
    if tags and not library.genre_names(library.tag_list(song)):
        song["tags"], changed = [*(song.get("tags") or []), *tags], True
    who = str(artist or album.get("artist") or "").strip()
    if who and not discogs_lookup._is_various(who) and not song.get("mainArtists"):
        song["mainArtists"], changed = credits_v1.pills(who), True
    return changed


def fill_songs(uid: str, album: dict[str, Any], song_ids: list[str], artists: dict[str, str] | None = None) -> None:
    """`fill_song` for these library songs, saved when any changed. Call inside `deps.tx`."""
    wanted = set(song_ids)
    if not wanted:
        return
    songs = library.load(deps.library_path(uid))
    changed = False
    for song in songs:
        if song.get("id") in wanted:
            changed = fill_song(song, album, (artists or {}).get(song["id"])) or changed
    if changed:
        deps.save_songs(uid, songs)


def fill_linked(uid: str, album: dict[str, Any]) -> None:
    """Fills the songs linked to the album's tracks (a track's own artist wins over the album artist). Call inside `deps.tx`."""
    tracks = [t for t in album["tracks"] if t.get("songId")]
    fill_songs(uid, album, [t["songId"] for t in tracks], {t["songId"]: str(t["artist"]) for t in tracks if t.get("artist")})


# --- Discogs candidates --------------------------------------------------------------------------

def _sim(wanted: str, found: str) -> float:
    w, f = discogs_lookup._name(wanted), discogs_lookup._name(found)
    if not w or not f:
        return 0.0
    if w == f:
        return 1.0
    if w in f or f in w:
        return SUBSTRING_SCORE
    return min(difflib.SequenceMatcher(None, w, f).ratio(), SUBSTRING_SCORE + 0.2)


def _closeness(a: float, b: float) -> float:
    return max(0.0, 1 - abs(a - b) / max(a, b, 1))


def _search_results(params: dict[str, str]) -> list[Any]:
    try:
        return discogs_lookup._get("database/search", params).get("results") or []
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return []
        raise HTTPException(status_code=502, detail="discogs_failed") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="discogs_failed") from exc


def _release_picks(results: list[Any]) -> list[dict[str, Any]]:
    seen: set[int] = set()
    picks = []
    for item in results:
        ident = item.get("id") if isinstance(item, dict) else None
        if isinstance(ident, int) and ident not in seen and item.get("type") in (None, "release"):
            seen.add(ident)
            picks.append(item)
    return picks


def _mark_best(candidates: list[dict[str, Any]]) -> None:
    if not candidates or candidates[0]["score"] < BEST_MIN_SCORE:
        return
    if len(candidates) == 1 or candidates[0]["score"] - candidates[1]["score"] >= BEST_MARGIN:
        candidates[0]["best"] = True


def search(artist: Any, album: Any, track_count: Any, durations: Any, playlist_tracks: Any = None) -> dict[str, Any]:
    if not os.environ.get("DISCOGS_TOKEN", "").strip():
        raise HTTPException(status_code=503, detail="discogs_unavailable")
    artist, album = str(artist or "").strip(), str(album or "").strip()
    count = track_count if isinstance(track_count, int) and not isinstance(track_count, bool) and track_count > 0 else None
    lengths = [d for d in durations if isinstance(d, (int, float)) and not isinstance(d, bool) and d > 0] if isinstance(durations, list) else []
    total = sum(lengths) or None
    plist = _playlist_tracks(playlist_tracks)
    if not artist and not album:
        return {"candidates": []}
    params = {"type": "release", "per_page": "20", **({"artist": artist} if artist else {}), **({"release_title": album} if album else {})}
    picks = _release_picks(_search_results(params))
    candidates = [_candidate(item, artist, album, count, total, plist) for item in picks[:MAX_CANDIDATES]]
    candidates.sort(key=lambda c: (-c["score"], c["discogsId"]))
    _mark_best(candidates)
    return {"candidates": candidates}


_FORMAT_TYPES = (("EP", "EP"), ("Single", "single"), ("Maxi-Single", "single"), ("Compilation", "compilation"), ("Mini-Album", "EP"), ("Album", "album"), ("LP", "album"))


def format_type(formats: Any) -> str | None:
    """The album type of a Discogs `format` list (descriptions such as "Album", "EP", "Single"), or None."""
    words = {str(f).strip().lower(): kind for f, kind in _FORMAT_TYPES}
    return next((words[str(f).strip().lower()] for f in formats if str(f).strip().lower() in words), None) if isinstance(formats, list) else None


def find_releases(artist: Any, title: Any, year: Any = None) -> dict[str, Any]:
    """Every Discogs release for an artist and album title: {candidates: [{id, url, title, artist, year, country, label, trackCount, cover, genres, type, kind}], searchError}; failures give an empty list and a code."""
    try:
        found = search(artist, title, None, None)["candidates"]
    except HTTPException as exc:
        return {"candidates": [], "searchError": exc.detail if exc.detail in ("discogs_unavailable", "discogs_failed") else "discogs_failed"}
    wanted = timeutil.valid_year(year) if isinstance(year, int) and not isinstance(year, bool) else None
    found.sort(key=lambda c: (c["year"] != wanted if wanted else False, -c["score"], c["discogsId"]))
    return {"candidates": public_candidates(found), "searchError": None}


def public_candidates(found: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{
        "id": c["discogsId"], "url": c["url"], "title": c["title"], "artist": c["artist"], "year": c["year"], "country": c["country"],
        "label": (c["labels"] or [None])[0], "trackCount": c["trackCount"], "cover": c.get("image") or c["thumb"], "genres": c["genres"][:MAX_SUGGESTED_GENRES],
        "type": format_type(c["formats"]), "kind": "release", "styles": c["styles"], "masterId": c["masterId"], "releaseId": c["discogsId"], "links": {"discogs": c["url"]},
    } for c in found]


def _year_of(value: Any) -> int | None:
    return timeutil.valid_year(int(value)) if str(value or "").isdigit() else None


def auto_match(hint: dict[str, Any], track_count: int) -> dict[str, Any] | None:
    """The one Discogs master whose artist and title equal the guess (normalised; year within one when both known; track count within two when known), read as `release_info` with the master link kept; None when absent, ambiguous or on any failure."""
    artist, album = str(hint.get("artist") or "").strip(), str(hint.get("album") or "").strip()
    if not artist or not album or not os.environ.get("DISCOGS_TOKEN", "").strip():
        return None
    try:
        results = _search_results({"type": "master", "artist": artist, "release_title": album, "per_page": "20"})
        year = hint.get("year")
        same = []
        for item in results:
            if not isinstance(item, dict) or item.get("type") != "master" or not isinstance(item.get("id"), int):
                continue
            who, _, name = str(item.get("title") or "").partition(" - ")
            found = _year_of(item.get("year"))
            if discogs_lookup._name(who) == discogs_lookup._name(artist) and discogs_lookup._name(name) == discogs_lookup._name(album) and (not year or not found or abs(found - year) <= 1):
                same.append(item["id"])
        if len(set(same)) != 1:
            return None
        link = f"https://www.discogs.com/master/{same[0]}"
        info = release_info(link)
        if not info or not matches_guess(hint, info) or (track_count and info["trackCount"] and abs(info["trackCount"] - track_count) > 2):
            return None
        return {**info, "url": link}
    except Exception as exc:
        log.warning("discogs auto match failed: %s", type(exc).__name__)
        return None


def _playlist_tracks(raw: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw, list):
        return None
    out = []
    for item in raw:
        pos = item.get("position") if isinstance(item, dict) else None
        if isinstance(pos, int) and not isinstance(pos, bool):
            out.append({"position": pos, "title": str(item.get("title") or "")})
    return out


def _texts(value: Any, limit: int | None = None) -> list[str]:
    items = value if isinstance(value, list) else []
    out = [str(v).strip() for v in items if isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).strip()]
    return out[:limit] if limit else out


def _text(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _score(album: str, artist: str, count: int | None, total: float | None, title: str, who: str, tracks: list[dict[str, Any]] | None) -> float:
    parts: list[tuple[float, float]] = []
    if album:
        parts.append((0.4, _sim(album, title)))
    if artist:
        parts.append((0.3, _sim(artist, who)))
    if count and tracks:
        parts.append((0.15, _closeness(count, len(tracks))))
    known = [t["durationS"] for t in tracks or [] if t["durationS"]]
    if total and known:
        parts.append((0.15, _closeness(total, sum(known))))
    weight = sum(w for w, _ in parts)
    return round(sum(w * v for w, v in parts) / weight, 3) if weight else 0.0


def _candidate(item: dict[str, Any], artist: str, album: str, count: int | None, total: float | None, plist: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    ident = int(item["id"])
    genres: list[str] = []
    styles: list[str] = []
    image = None
    master = item.get("master_id")
    head, _, tail = str(item.get("title") or "").partition(" - ")
    title, who, year, tracks = tail or head, (head if tail else ""), item.get("year"), None
    try:
        detail = discogs_lookup._get(f"releases/{ident}")
        tracks = albums._flat_tracks(detail)
        title = str(detail.get("title") or title)
        image = _best_image(detail)
        who = albums._artists(detail) or who
        year = detail.get("year") or year
        genres = albums._genres({"genres": [*(detail.get("styles") or []), *(detail.get("genres") or [])]})
        styles = [str(x) for x in detail.get("styles") or []][:MAX_SUGGESTED_GENRES]
        master = detail.get("master_id") or master
    except Exception:
        pass
    score = _score(album, artist, count, total, title, who, tracks)
    out = {
        "url": f"https://www.discogs.com/release/{ident}", "discogsId": ident, "title": title,
        "artist": discogs_lookup._DISAMBIG.sub("", who).rstrip(), "year": timeutil.valid_year(year) if year else None,
        "trackCount": len(tracks) if tracks is not None else None, "score": score, "best": False,
        "formats": _texts(item.get("format")), "labels": _texts(item.get("label"), MAX_LABELS),
        "country": _text(item.get("country")), "catno": _text(item.get("catno")),
        "thumb": _text(item.get("thumb")) if str(item.get("thumb") or "").startswith("https://") else None,
        "tracks": tracks or [], "genres": genres, "image": image, "styles": styles,
        "masterId": master if isinstance(master, int) and not isinstance(master, bool) and master > 0 else None,
    }
    if plist is not None:
        out["matches"] = match_tracks(plist, tracks or [])
    return out


# --- title matching ------------------------------------------------------------------------------

def _bracket_groups(text: str) -> Iterator[tuple[int, int, int, int]]:
    """(start incl. the spaces before, inner start, inner end, end) of each opener up to the next closer, left to right, in one pass."""
    pos = 0
    while (opener := _OPENER.search(text, pos)) and (closer := _CLOSER.search(text, opener.end())):
        start = opener.start()
        while start > pos and text[start - 1].isspace():
            start -= 1
        yield start, opener.end(), closer.start(), closer.end()
        pos = closer.end()


def _strip_brackets(text: str) -> str:
    out: list[str] = []
    last = 0
    for start, inner_start, inner_end, end in _bracket_groups(text):
        inner = text[inner_start:inner_end]
        drop = credits_split.kind_of(inner) == "remaster" or _IGNORED_BRACKET.fullmatch(inner)
        out.append(text[last:start])
        if not drop:
            out.append(text[start:end])
        last = end
    out.append(text[last:])
    return "".join(out)


def track_key(title: Any) -> str:
    base = credit_title.parse(None, str(title or ""))["title"]
    return playlist_import._fold(_strip_brackets(base))


def _is_plain(title: Any) -> bool:
    """True when no ignorable bracket (a remaster) had to be dropped to reach the key."""
    return playlist_import._fold(credit_title.parse(None, str(title or ""))["title"]) == track_key(title)


def match_tracks(playlist_tracks: list[dict[str, Any]], disc_tracks: list[dict[str, Any]]) -> dict[str, int | None]:
    """For each playlist track (`position`, `title`) the number of the Discogs track with the same folded base title, each Discogs track used once; an exact title beats a remaster, then the earlier position wins."""
    keys = [(t["no"], track_key(t["title"])) for t in disc_tracks]
    used: set[int] = set()
    result: dict[str, int | None] = {str(p["position"]): None for p in sorted(playlist_tracks, key=lambda p: p["position"])}
    for track in sorted(playlist_tracks, key=lambda p: (not _is_plain(p["title"]), p["position"])):
        key = track_key(track["title"])
        for no, wanted in keys:
            if no not in used and key and key == wanted:
                used.add(no)
                result[str(track["position"])] = no
                break
    return result


def song_keys(song: dict[str, Any]) -> set[str]:
    base = _strip_brackets(str(song.get("title") or ""))
    keys = {playlist_import._fold(base)}
    version = song.get("version")
    if isinstance(version, dict) and version.get("type") and version.get("type") != "remaster":
        kind, name = str(version.get("type")), str(version.get("name") or "")
        keys = {playlist_import._fold(f"{base} {a}") for a in (f"{name} {kind}", f"{kind} {name}", name, kind) if a.strip()}
    keys.discard("")
    return keys


def auto_link(album: dict[str, Any], song_ids: Any, library_songs: list[dict[str, Any]]) -> int:
    """Links the given songs (in order) to the tracks of the same folded base title, each song and track once; returns how many were linked. Unknown ids are ignored."""
    if not isinstance(song_ids, list):
        return 0
    by_id = {s.get("id"): s for s in library_songs}
    keys = [track_key(t["title"]) for t in album["tracks"]]
    used: set[int] = set()
    done: set[str] = set()
    linked = 0
    for sid in song_ids:
        song = by_id.get(sid) if isinstance(sid, str) else None
        if song is None or sid in done:
            continue
        done.add(sid)
        wanted = song_keys(song)
        for i, key in enumerate(keys):
            if i not in used and key in wanted:
                used.add(i)
                album["tracks"][i]["songId"] = sid
                linked += 1
                break
    return linked
