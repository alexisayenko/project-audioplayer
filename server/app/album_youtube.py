"""Albums from a YouTube playlist (task-0120, API-255..API-257): metadata-only catalog songs from the playlist import, a title guess, Discogs candidates and auto-linking of imported songs to tracks."""

from __future__ import annotations

import difflib
import os
import re
import urllib.error
from typing import Any

from fastapi import HTTPException

from . import albums, credit_title, credits_split, discogs_lookup, downloads, extractor, limits, playlist_import, timeutil, urlclean
from .links import Resolved

MAX_CANDIDATES = 8
MAX_LABELS = 3
BEST_MIN_SCORE = 0.7
BEST_MARGIN = 0.1
_NOISE_GROUP = re.compile(r"\s*[\(\[]\s*(?:(?:full|complete|entire|whole)\s+)?(?:album|lp|ep)(?:\s+(?:stream|version|playlist))?\s*[\)\]]", re.I)
_NOISE_TAIL = re.compile(r"[\s\-–—:|]+(?:full|complete|entire|whole)\s+(?:album|lp|ep)(?:\s+stream)?\s*$", re.I)
_SEP = re.compile(r"\s+[-–—]\s+")
_TOPIC = re.compile(r"\s+-\s+topic$", re.I)
_BRACKETS = re.compile(r"\s*[\(\[]([^\)\]]*)[\)\]]")
_IGNORED_BRACKET = re.compile(r"^\s*(?:mono|stereo|bonus track|\d{4}\s+(?:mix|version))\s*$", re.I)


def guess(title: Any, uploader: Any) -> dict[str, str | None]:
    text = _NOISE_TAIL.sub("", _NOISE_GROUP.sub("", str(title or ""))).strip(" -–—|:")
    channel = str(uploader or "").strip()
    parts = _SEP.split(text, maxsplit=1)
    if len(parts) == 2 and all(p.strip() for p in parts):
        return {"artist": parts[0].strip(), "album": parts[1].strip()}
    if _TOPIC.search(channel) and text:
        return {"artist": _TOPIC.sub("", channel).strip() or None, "album": text}
    return {"artist": None, "album": text or None}


def _http(exc: Exception) -> HTTPException:
    if extractor.error_code(exc) in ("not_found", "private"):
        return HTTPException(status_code=404, detail="not_found")
    return HTTPException(status_code=502, detail="youtube_failed")


def start(uid: str, owner: bool, url: str, songs: list[dict[str, Any]]) -> dict[str, Any]:
    ref = urlclean.parse_playlist(url) if url.strip().lower().startswith("https://") else None
    if ref is None or ref[0] == "mix":
        raise HTTPException(status_code=400, detail="bad_url")
    if ref[0] == "private":
        raise HTTPException(status_code=404, detail="not_found")
    playlist_import.charge_listing(uid, owner)
    try:
        found = playlist_import.listing(ref[1], songs)
    except Exception as exc:
        raise _http(exc) from exc
    entries = found["entries"]
    usable = [(i, e) for i, e in enumerate(entries, 1) if e["state"] == "ok"]
    skipped = [{"title": e["title"], "reason": e["reason"]} for e in entries if e["state"] != "ok"]
    if not usable:
        raise HTTPException(status_code=404, detail="not_found")
    owned = playlist_import.Owned(songs)
    fresh = [e for _, e in usable if e["id"] not in owned.ids]
    if not owner and len(songs) + len(fresh) > limits.max_songs():
        raise HTTPException(status_code=409, detail="library_full_songs")
    for entry in fresh:
        _create(uid, entry)
    meta = found["playlist"]
    return {
        "playlist": {"title": meta["title"] or "", "uploader": meta["uploader"] or None, "count": len(usable)},
        "guess": guess(meta["title"], meta["uploader"]),
        "songs": [{"songId": e["id"], "title": e["title"], "durationS": _seconds(e["duration"]), "position": i} for i, e in usable],
        "skipped": skipped,
    }


def _seconds(value: Any) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0 else None


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
        return 0.85
    return difflib.SequenceMatcher(None, w, f).ratio()


def _closeness(a: float, b: float) -> float:
    return max(0.0, 1 - abs(a - b) / max(a, b, 1))


def search(artist: Any, album: Any, track_count: Any, durations: Any) -> dict[str, Any]:
    if not os.environ.get("DISCOGS_TOKEN", "").strip():
        raise HTTPException(status_code=503, detail="discogs_unavailable")
    artist, album = str(artist or "").strip(), str(album or "").strip()
    count = track_count if isinstance(track_count, int) and not isinstance(track_count, bool) and track_count > 0 else None
    lengths = [d for d in durations if isinstance(d, (int, float)) and not isinstance(d, bool) and d > 0] if isinstance(durations, list) else []
    total = sum(lengths) or None
    if not artist and not album:
        return {"candidates": []}
    params = {"type": "release", "per_page": "20", **({"artist": artist} if artist else {}), **({"release_title": album} if album else {})}
    try:
        results = discogs_lookup._get("database/search", params).get("results") or []
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {"candidates": []}
        raise HTTPException(status_code=502, detail="discogs_failed") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="discogs_failed") from exc
    seen: set[int] = set()
    picks = []
    for item in results:
        ident = item.get("id") if isinstance(item, dict) else None
        if isinstance(ident, int) and ident not in seen and item.get("type") in (None, "release"):
            seen.add(ident)
            picks.append(item)
    candidates = [_candidate(item, artist, album, count, total) for item in picks[:MAX_CANDIDATES]]
    candidates.sort(key=lambda c: (-c["score"], c["discogsId"]))
    if candidates and candidates[0]["score"] >= BEST_MIN_SCORE and (len(candidates) == 1 or candidates[0]["score"] - candidates[1]["score"] >= BEST_MARGIN):
        candidates[0]["best"] = True
    return {"candidates": candidates}


def _texts(value: Any, limit: int | None = None) -> list[str]:
    items = value if isinstance(value, list) else []
    out = [str(v).strip() for v in items if isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).strip()]
    return out[:limit] if limit else out


def _text(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _candidate(item: dict[str, Any], artist: str, album: str, count: int | None, total: float | None) -> dict[str, Any]:
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
    score = round(sum(w * v for w, v in parts) / weight, 3) if weight else 0.0
    return {
        "url": f"https://www.discogs.com/release/{ident}", "discogsId": ident, "title": title,
        "artist": discogs_lookup._DISAMBIG.sub("", who).rstrip(), "year": timeutil.valid_year(year) if year else None,
        "trackCount": len(tracks) if tracks is not None else None, "score": score, "best": False,
        "formats": _texts(item.get("format")), "labels": _texts(item.get("label"), MAX_LABELS),
        "country": _text(item.get("country")), "catno": _text(item.get("catno")),
        "thumb": _text(item.get("thumb")) if str(item.get("thumb") or "").startswith("https://") else None,
    }


# --- auto-link -----------------------------------------------------------------------------------

def _strip_brackets(text: str) -> str:
    def drop(m: re.Match[str]) -> str:
        inner = m.group(1)
        return "" if credits_split.kind_of(inner) == "remaster" or _IGNORED_BRACKET.fullmatch(inner) else m.group(0)

    return _BRACKETS.sub(drop, text)


def track_key(title: Any) -> str:
    base = credit_title.parse(None, str(title or ""))["title"]
    return playlist_import._fold(_strip_brackets(base))


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
