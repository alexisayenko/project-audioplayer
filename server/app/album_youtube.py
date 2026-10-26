"""Albums from a YouTube playlist (task-0120, API-255..API-257): a preview that creates nothing (playlist tracks, a title guess, Discogs candidates with a track matching), a commit that creates the marked songs and the album, Discogs search and auto-linking of imported songs to tracks."""

from __future__ import annotations

import difflib
import os
import re
import urllib.error
from typing import Any

from fastapi import HTTPException

from . import album_covers, albums, credit_title, credits_split, deps, discogs_lookup, downloads, extractor, limits, playlist_import, timeutil, urlclean, users
from .links import Resolved

MAX_CANDIDATES = 8
MAX_LABELS = 3
BEST_MIN_SCORE = 0.7
BEST_MARGIN = 0.1
SUBSTRING_SCORE = 0.6
MAX_SELECTED = 200
_NOISE_GROUP = re.compile(r"(?<!\s)\s*[\(\[]\s*(?:(?:full|complete|entire|whole)\s+)?(?:album|lp|ep)(?:\s+(?:stream|version|playlist))?\s*[\)\]]", re.I)
_NOISE_TAIL = re.compile(r"(?<![\s\-–—:|])[\s\-–—:|]+(?:full|complete|entire|whole)\s+(?:album|lp|ep)(?:\s+stream)?\s*$", re.I)
_SEP = re.compile(r"(?<!\s)\s+[-–—]\s+")
_TOPIC = re.compile(r"(?<!\s)\s+-\s+topic$", re.I)
_BRACKETS = re.compile(r"(?<!\s)\s*[\(\[]([^\)\]]*)[\)\]]")
_IGNORED_BRACKET = re.compile(r"^\s*(?:mono|stereo|bonus track|\d{4}\s+(?:mix|version))\s*$", re.I)
_YEAR = re.compile(r"(?<![\w])((?:19|20)\d{2})(?![\w])")
_DESC_YEAR = re.compile(r"(?:released?|release date|℗|©|year)\D{0,15}((?:19|20)\d{2})(?!\d)", re.I)
_TRAIL_SQUARE = re.compile(r"(?<!\s)\s*\[[^\]]*\]\s*$")
_ROUND_YEAR = r"(?:19|20)\d{2}"
_ROUND_REMASTER = r"(?:\d{4}\s+)?re-?master(?:ed)?(?:\s+\d{4})?"
_TRAIL_ROUND = re.compile(rf"(?<!\s)\s*\(\s*({_ROUND_YEAR}|{_ROUND_REMASTER})\s*\)\s*$", re.I)
_TRAIL_YEAR = re.compile(r"(?<![\s,\-–—])[\s,\-–—]+(?:19|20)\d{2}$")


def guess_year(title: Any, description: Any = None) -> int | None:
    found = _YEAR.search(str(title or ""))
    if not found and description:
        found = _DESC_YEAR.search(str(description)[:3000])
    return timeutil.valid_year(int(found.group(1))) if found else None


def _clean_album(text: str) -> str:
    previous = None
    while previous != text and text:
        previous = text
        text = _TRAIL_SQUARE.sub("", text)
        text = _TRAIL_ROUND.sub("", text)
        if not re.fullmatch(r"(?:19|20)\d{2}", text.strip()):
            text = _TRAIL_YEAR.sub("", text)
        text = text.strip()
    return text


def guess(title: Any, uploader: Any, description: Any = None) -> dict[str, Any]:
    year = guess_year(title, description)
    text = _NOISE_TAIL.sub("", _NOISE_GROUP.sub("", str(title or ""))).strip(" -–—|:")
    channel = str(uploader or "").strip()
    parts = _SEP.split(text, maxsplit=1)
    if len(parts) == 2 and all(p.strip() for p in parts):
        artist, album = parts[0].strip(), _clean_album(parts[1].strip())
    elif _TOPIC.search(channel) and text:
        artist, album = (_TOPIC.sub("", channel).strip() or None), _clean_album(text)
    else:
        artist, album = None, _clean_album(text)
    return {"artist": artist, "album": album or None, "year": year}


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
    hint = guess(meta["title"], meta["uploader"], meta.get("description"))
    candidates: list[dict[str, Any]] = []
    error = None
    if hint["artist"] or hint["album"]:
        try:
            candidates = search(hint["artist"], hint["album"], len(tracks), [t["durationS"] for t in tracks], tracks)["candidates"]
        except HTTPException as exc:
            error = exc.detail if exc.detail in ("discogs_unavailable", "discogs_failed") else "discogs_failed"
    return {
        "playlist": {"title": meta["title"] or "", "uploader": meta["uploader"] or None, "count": len(tracks), "url": meta["url"]},
        "guess": hint,
        "tracks": tracks,
        "candidates": candidates,
        "searchError": error,
    }


# --- commit --------------------------------------------------------------------------------------

def _bad(code: str) -> HTTPException:
    return HTTPException(status_code=422, detail=code)


def _selected(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw or len(raw) > MAX_SELECTED:
        raise _bad("bad_selection")
    out, seen_pos, seen_vid = [], set(), set()
    for item in raw:
        pos = item.get("position") if isinstance(item, dict) else None
        vid = str(item.get("videoId") or "") if isinstance(item, dict) else ""
        title = str(item.get("title") or "").strip()[: albums.MAX_TEXT] if isinstance(item, dict) else ""
        if isinstance(pos, bool) or not isinstance(pos, int) or pos < 1 or pos in seen_pos or not urlclean.VIDEO_ID_RE.fullmatch(vid) or vid in seen_vid or not title:
            raise _bad("bad_selection")
        seen_pos.add(pos)
        seen_vid.add(vid)
        out.append({"position": pos, "videoId": vid, "title": title, "durationS": _seconds(item.get("durationS"))})
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
        "genres": [],
        "rymUrl": None,
        "links": {"discogs": None, "rateyourmusic": None, "youtube": None, "wikipedia": None},
        "source": {"type": "youtube", "id": list_id, "url": urlclean.playlist_url(list_id)},
        "tracks": [{"no": i, "title": s["title"], "durationS": s["durationS"]} for i, s in enumerate(selected, 1)],
    }


def _commit_payload(body: dict[str, Any], selected: list[dict[str, Any]], list_id: str) -> tuple[dict[str, Any], dict[int, int]]:
    if body.get("candidate") is None:
        payload = _fallback_payload(body.get("fallback"), selected, list_id)
        return payload, {s["position"]: i for i, s in enumerate(selected, 1)}
    candidate = body["candidate"]
    if isinstance(candidate, dict) and "source" not in candidate and isinstance(candidate.get("discogsId"), int):
        candidate = {**candidate, "source": {"type": "discogs", "id": str(candidate["discogsId"])}}
    payload = albums.validate(candidate)
    return payload, _mapping(body.get("mapping"), selected, {t["no"] for t in payload["tracks"]})


def commit(uid: str, owner: bool, body: dict[str, Any], songs: list[dict[str, Any]]) -> dict[str, Any]:
    list_id = _playlist_ref(body.get("playlistUrl"))
    playlist_link = albums._stored_link("youtube", body.get("playlistUrl")) or urlclean.playlist_url(list_id)
    selected = _selected(body.get("selected"))
    try:
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
    views = _views(uid, owner, list_id, songs, fresh)
    for s in fresh:
        _create(uid, views.get(s["videoId"]) or _minimal(s))
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
    album = album_covers.present_one(uid, album_covers.auto(uid, album))
    return {
        "album": album,
        "songs": [{"position": s["position"], "songId": ids[s["position"]]} for s in selected],
        "linked": len(mapping),
        "unlinked": len(album["tracks"]) - len(mapping),
    }


def _views(uid: str, owner: bool, list_id: str, songs: list[dict[str, Any]], fresh: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if not fresh:
        return {}
    try:
        playlist_import.charge_listing(uid, owner)
        found = playlist_import.listing(list_id, songs)
    except Exception:
        return {}
    return {e["id"]: e for e in found["entries"] if e["state"] == "ok"}


def _minimal(selected: dict[str, Any]) -> dict[str, Any]:
    return {"id": selected["videoId"], "title": selected["title"], "mainArtists": [], "featuredArtists": [], "withArtists": [], "version": None,
            "duration": selected["durationS"], "thumbnail": None}


def _create(uid: str, entry: dict[str, Any]) -> None:
    meta: dict[str, Any] = {"title": entry["title"], "mainArtists": entry["mainArtists"], "featuredArtists": entry["featuredArtists"]}
    if entry["withArtists"]:
        meta["withArtists"] = entry["withArtists"]
    if entry["version"]:
        meta["version"] = {k: v for k, v in entry["version"].items() if v}
    probe = {"duration": entry["duration"], "thumbnail": entry["thumbnail"], "tags": []}
    link = Resolved(entry["id"], urlclean.watch_url(entry["id"]), probe)
    try:
        downloads.add_metadata_only(uid, entry["id"], link, meta, [])
    except HTTPException as exc:
        if exc.status_code != 409:
            raise


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
    head, _, tail = str(item.get("title") or "").partition(" - ")
    title, who, year, tracks = tail or head, (head if tail else ""), item.get("year"), None
    try:
        detail = discogs_lookup._get(f"releases/{ident}")
        tracks = albums._flat_tracks(detail)
        title = str(detail.get("title") or title)
        who = albums._artists(detail) or who
        year = detail.get("year") or year
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
        "tracks": tracks or [],
    }
    if plist is not None:
        out["matches"] = match_tracks(plist, tracks or [])
    return out


# --- title matching ------------------------------------------------------------------------------

def _strip_brackets(text: str) -> str:
    def drop(m: re.Match[str]) -> str:
        inner = m.group(1)
        return "" if credits_split.kind_of(inner) == "remaster" or _IGNORED_BRACKET.fullmatch(inner) else m.group(0)

    return _BRACKETS.sub(drop, text)


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
