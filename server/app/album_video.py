"""An album from a time-coded YouTube video (task-0038 phase 1B, API-264..API-270): a preview that creates nothing (chapters, the description or a pasted text parsed into tracks), and a create that makes the album and one metadata-only song per included track, then queues the split job (`video_split.run`) that cuts the audio."""

from __future__ import annotations

import base64
import hashlib
import json
import math
from typing import Any

from fastapi import HTTPException

from . import album_covers, album_preview, album_youtube, albums, credits, deps, extractor, library, limits, playlist_import, previewcache, sources, tracklist, urlclean, users, video_split
from .problems import Problem

MAX_SECONDS = video_split.MAX_SECONDS
MAX_TRACKS = video_split.MAX_TRACKS
MIN_TRACKS = 2
MAX_TEXT_CHARS = 50000
MAX_RAW_CHARS = 20000
FADED_TYPES = ("mix", "compilation")
TOLERANCE_S = 1.0


def _bad(code: str, status: int = 422) -> HTTPException:
    return HTTPException(status_code=status, detail=code)


def video_id_of(url: Any) -> str:
    text = url.strip() if isinstance(url, str) else ""
    vid = urlclean.parse_video_id(text) if text.lower().startswith("https://") or urlclean.VIDEO_ID_RE.fullmatch(text) else None
    if vid is None or not urlclean.VIDEO_ID_RE.fullmatch(vid):
        raise _bad("bad_url", 400)
    return vid


def _details(video_id: str) -> dict[str, Any]:
    key = f"vd:{video_id}"
    found = previewcache.recall(key)
    if found is None:
        try:
            found = extractor.video_details(video_id)
        except Exception as exc:
            if extractor.error_code(exc) in ("not_found", "private"):
                raise _bad("not_found", 404) from exc
            raise HTTPException(status_code=502, detail="youtube_failed") from exc
        previewcache.remember(key, found)
    return found


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0 else None


def _check_size(duration: float | None, count: int) -> None:
    if duration is not None and duration > MAX_SECONDS:
        raise Problem(413, "video_too_long", "video longer than 4 hours")
    if count > MAX_TRACKS:
        raise Problem(413, "too_many_tracks", "more than 100 tracks")


# --- preview -------------------------------------------------------------------------------------

def _version(text: Any) -> dict[str, Any] | None:
    return album_preview.version_of(text)


def _owned_index(songs: list[dict[str, Any]]) -> dict[Any, dict[str, Any]]:
    index: dict[Any, dict[str, Any]] = {}
    for song in songs:
        key = playlist_import._key(song.get("title"), credits.main_artists(song), song.get("version"))
        if key:
            index.setdefault(key, song)
    return index


def _match(index: dict[Any, dict[str, Any]], title: str, artists: list[str], version: Any) -> dict[str, Any] | None:
    key = playlist_import._key(title, artists, _version(version))
    song = index.get(key) if key else None
    return {"songId": song["id"], "title": song.get("title") or "", "artists": credits.main_artists(song)} if song else None


def _tracks_out(found: Any, duration: float | None, songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    index = _owned_index(songs)
    out = []
    for t in found.tracks:
        end = t.end if t.end is not None else duration
        out.append({
            "index": t.index, "start": t.start, "end": end, "artists": list(t.artists), "title": t.title, "version": t.version,
            "trackNo": t.track_no, "warnings": list(t.warnings), "match": _match(index, t.title, list(t.artists), t.version),
        })
    return out


def _parsed(details: dict[str, Any], text: str | None, allow_empty: bool = False) -> tuple[Any, str, str]:
    """(result, source, rawText): a pasted text, else the chapters, else the description; a result needs at least two tracks. With `allow_empty` a video without a track list gives no tracks and source "none" (the Add album wizard pastes the list later)."""
    duration = _number(details["duration"])
    if text is not None:
        pasted = tracklist.parse_tracklist(text, duration)
        if len(pasted.tracks) < MIN_TRACKS:
            raise _bad("no tracklist found")
        return pasted, "pasted", text
    chapters = tracklist.from_chapters(details["chapters"], duration) if details["chapters"] else None
    if chapters is not None and len(chapters.tracks) >= MIN_TRACKS:
        return chapters, "chapters", ""
    description = details["description"]
    found = tracklist.parse_tracklist(description, duration) if description.strip() else None
    if found is not None and len(found.tracks) >= MIN_TRACKS:
        return found, "description", description[:MAX_RAW_CHARS]
    if allow_empty:
        return tracklist.TracklistResult(), "none", ""
    raise _bad("no tracklist found")


def preview(uid: str, owner: bool, url: Any, songs: list[dict[str, Any]], text: Any = None, allow_empty: bool = False) -> dict[str, Any]:
    """The video, its track list parsed from chapters, the description or `text`, and an album guess; nothing is created."""
    vid = video_id_of(url)
    if text is not None and (not isinstance(text, str) or len(text) > MAX_TEXT_CHARS):
        raise _bad("bad_text")
    playlist_import.charge_listing(uid, owner)
    details = _details(vid)
    duration = _number(details["duration"])
    _check_size(duration, 0)
    found, source, raw = _parsed(details, text, allow_empty)
    _check_size(duration, len(found.tracks))
    tracks = _tracks_out(found, duration, songs)
    hint = album_youtube.guess(details["title"], details["uploader"], details["description"])
    listing = [{"position": t["index"] + 1, "title": t["title"], "durationS": round(t["end"] - t["start"]) if t["end"] is not None else None} for t in tracks]
    found_info = album_preview.describe(hint, details["description"], listing)
    hint, links, genres = found_info["hint"], found_info["links"], found_info["genres"]
    artist = album_preview.album_artist(tracks, hint, details["uploader"])
    album_preview.default_artists(tracks, artist)
    album = album_preview.album_out(details["title"], hint, artist, found_info["cover"] or details["thumbnail"])
    return {
        "videoId": vid, "url": urlclean.watch_url(vid), "title": details["title"], "uploader": details["uploader"], "thumbnail": details["thumbnail"],
        "duration": duration, "source": source, "rawText": raw, "tracks": tracks, "album": album,
        "guess": hint, "genres": genres, "links": links, "discogsMatch": found_info["discogsMatch"], "discogsCandidates": found_info["candidates"],
        "warnings": list(found.warnings),
    }


# --- create --------------------------------------------------------------------------------------

def track_song_id(video_id: str, start: float) -> str:
    """The id of the song cut from `video_id` at `start`: an underscore and ten base64 characters, stable for the same cut."""
    digest = hashlib.sha1(f"{video_id}:{start:.3f}".encode(), usedforsecurity=False).digest()
    return "_" + base64.urlsafe_b64encode(digest).decode()[:10]


def _names(value: Any) -> list[str]:
    items = value if isinstance(value, list) else []
    names = [str(a).strip()[: albums.MAX_TEXT] for a in items if isinstance(a, str) and a.strip()]
    if len(names) != len(items) or len(names) > 10:
        raise _bad("bad_tracks")
    return names


def _clean_times(start: Any, end: Any, duration: float | None) -> tuple[float, float]:
    if isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        raise _bad("bad_times")
    start, end = float(start), float(end)
    if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end <= start:
        raise _bad("bad_times")
    if duration is not None and (start >= duration or end > duration + TOLERANCE_S):
        raise _bad("bad_times")
    return start, end


def _clean_track(raw: Any, duration: float | None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise _bad("bad_tracks")
    start, end = _clean_times(raw.get("start"), raw.get("end"), duration)
    title = raw.get("title")
    version = raw.get("version")
    number = raw.get("trackNo")
    existing = raw.get("useExistingSongId")
    if not isinstance(title, str) or not title.strip() or (version is not None and not isinstance(version, str)):
        raise _bad("bad_tracks")
    if number is not None and (isinstance(number, bool) or not isinstance(number, int) or not 0 < number < 1000):
        raise _bad("bad_tracks")
    if existing is not None and (not isinstance(existing, str) or not urlclean.is_valid_video_id(existing)):
        raise _bad("bad_tracks")
    return {
        "start": round(start, 3), "end": round(min(end, duration) if duration is not None else end, 3), "artists": _names(raw.get("artists")),
        "title": title.strip()[: albums.MAX_TEXT], "version": (version or "").strip()[: albums.MAX_TEXT] or None, "trackNo": number, "existing": existing,
    }


def _included(raw: Any, duration: float | None) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise _bad("bad_tracks")
    rows = [r for r in raw if isinstance(r, dict) and r.get("include") is True]
    if not rows:
        raise _bad("no_tracks")
    _check_size(duration, len(rows))
    tracks = sorted((_clean_track(r, duration) for r in rows), key=lambda t: t["start"])
    for before, after in zip(tracks, tracks[1:]):
        if after["start"] < before["end"]:
            raise _bad("bad_times")
    if len({t["existing"] for t in tracks if t["existing"]}) != sum(1 for t in tracks if t["existing"]):
        raise _bad("bad_tracks")
    return tracks


def _request_key(vid: str, album: dict[str, Any], tracks: list[dict[str, Any]], fades: bool) -> str:
    blob = json.dumps([vid, album["title"], album["artist"], album["type"], album["year"], fades, tracks], sort_keys=True, default=str)
    return hashlib.sha1(blob.encode(), usedforsecurity=False).hexdigest()[:16]


def _song_record(vid: str, album: dict[str, Any], track: dict[str, Any], song_id: str, duration: float | None) -> dict[str, Any]:
    length = round(track["end"] - track["start"], 3)
    meta: dict[str, Any] = {"title": track["title"], "mainArtists": track["artists"], "featuredArtists": [], "albums": [album["title"]]}
    version = _version(track["version"])
    if version:
        meta["version"] = version
    if album["year"]:
        meta["releaseYear"] = album["year"]
    return {
        "id": song_id,
        "title": track["title"],
        **credits.new_fields(meta, {"title": track["title"]}),
        "bpm": None,
        "sources": [sources.make_entry(sources.YOUTUBE, vid, track["start"], track["end"], length)],
        "file": None,
        "cover": None,
        "duration": length,
        "added_at": library.now_utc(),
        "tags": library.merge_genres(album["genres"], []),
        "sourceVideoId": vid,
        "sourceStartSec": track["start"],
        "sourceEndSec": track["end"],
        **({"trackNo": track["trackNo"]} if track["trackNo"] else {}),
    }


def _guard(songs: list[dict[str, Any]], owner: bool, fresh: int) -> None:
    if not owner and len(songs) + fresh > limits.max_songs():
        raise Problem(403, "library_full_songs", f"Your library is full ({limits.max_songs()} songs). Delete some songs to add more.")


def _album_record(uid: str, vid: str, album: dict[str, Any], tracks: list[dict[str, Any]], ids: list[str], key: str) -> dict[str, Any]:
    items = albums.load(deps.albums_path(uid))
    if len(items) >= albums.MAX_ALBUMS:
        raise HTTPException(status_code=409, detail="album_limit")
    link = albums.clean_link("youtube", f"https://youtu.be/{vid}")
    payload = {
        "title": album["title"], "artist": album["artist"], "year": album["year"], "genres": album["genres"], "rymUrl": album["links"]["rateyourmusic"],
        "links": {**album["links"], "youtube": link},
        "source": {"type": "video", "id": vid, "url": urlclean.watch_url(vid)},
        "tracks": [{"no": i, "title": t["title"], "durationS": max(1, round(t["end"] - t["start"]))} for i, t in enumerate(tracks, 1)],
    }
    record = albums.build(payload, {a["id"] for a in items})
    for track, song_id in zip(record["tracks"], ids):
        track["songId"] = song_id
    record["type"] = album["type"]
    record["requestKey"] = key
    albums.save(deps.albums_path(uid), [record, *items])
    return record


def _job_id(key: str) -> str:
    return f"split_{key[:12]}"


def _submit(uid: str, owner: bool, job_id: str, vid: str, album: dict[str, Any], fades: bool, thumbnail: str | None, fresh: list[dict[str, Any]]) -> dict[str, Any]:
    if not fresh:
        job = {"job_id": job_id, "video_id": vid, "status": "done", "progress": 1.0, "error": None, "done": 0, "total": 0, "current": None, "failed": []}
        deps.JOBS[(uid, job_id)] = job
        return job
    info = {"title": album["title"], "albumArtist": album["artist"], "year": album["year"]}
    return video_split.submit(uid, owner, job_id, vid, fresh, info, fades, urlclean.watch_url(vid), thumbnail)


def _cut_list(tracks: list[dict[str, Any]], ids: list[str]) -> list[dict[str, Any]]:
    return [
        {"songId": sid, "start": t["start"], "end": t["end"], "title": t["title"], "artists": t["artists"], "trackNo": t["trackNo"], "version": t["version"]}
        for t, sid in zip(tracks, ids) if not t["existing"]
    ]


def create(uid: str, owner: bool, body: Any) -> dict[str, Any]:
    """The album and one metadata-only song per included track, then the split job (one add); the same request again returns the same album and job."""
    data = body if isinstance(body, dict) else {}
    vid = video_id_of(data.get("url"))
    details = _details(vid)
    duration = _number(details["duration"])
    _check_size(duration, 0)
    album = album_preview.clean_album(data.get("album"))
    tracks = _included(data.get("tracks"), duration)
    fades = data["fades"] if isinstance(data.get("fades"), bool) else album["type"] in FADED_TYPES
    key = _request_key(vid, album, tracks, fades)
    job_id = _job_id(key)
    thumbnail = details["thumbnail"]
    with users.user_lock(uid):
        found = albums.find_source(albums.load(deps.albums_path(uid)), {"type": "video", "id": vid})
        if found:
            if found.get("requestKey") != key:
                raise HTTPException(status_code=409, detail={"code": "already_exists", "id": found["id"]})
            ids = [t.get("songId") for t in found["tracks"]]
            job = video_split.get(uid, job_id)
            if job is None or job.get("status") == "error":
                job = _submit(uid, owner, job_id, vid, album, fades, thumbnail, _cut_list(tracks, ids))
            return {"jobId": job["job_id"], "albumId": found["id"], "songIds": ids}
        songs = deps.load_songs(uid)
        by_id = {s["id"] for s in songs}
        if any(t["existing"] and t["existing"] not in by_id for t in tracks):
            raise _bad("unknown_song")
        ids = [t["existing"] or track_song_id(vid, t["start"]) for t in tracks]
        missing = [(t, sid) for t, sid in zip(tracks, ids) if not t["existing"] and sid not in by_id]
        fresh = _cut_list(tracks, ids)
        if fresh:
            video_split.precheck(uid, owner, fresh)
        _guard(songs, owner, len(missing))
        with deps.tx(uid, f"album from video {vid}"):
            fresh_songs = [_song_record(vid, album, t, sid, duration) for t, sid in missing]
            if fresh_songs:
                deps.save_songs(uid, [*library.load(deps.library_path(uid)), *fresh_songs])
            record = _album_record(uid, vid, album, tracks, ids, key)
        job = _submit(uid, owner, job_id, vid, album, fades, thumbnail, fresh)
    album_preview.store_cover(uid, record, album["coverUrl"], thumbnail)
    if data.get("coverToSongs") is True:
        album_covers.apply_to_new_songs(uid, record["id"], [sid for _, sid in missing])
    return {"jobId": job["job_id"], "albumId": record["id"], "songIds": ids}


def job_status(uid: str, job_id: str) -> dict[str, Any]:
    job = video_split.get(uid, job_id)
    if job is None:
        raise _bad("not_found", 404)
    return video_split.public(job)
