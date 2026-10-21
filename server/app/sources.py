"""Song sources (DATA-193, ADR-0040): `[{type, ref, trim_start, trim_end, duration?}]`, the URL derived from `type` + `ref`.

Pure functions, no I/O. `type` is `youtube`, `soundcloud`, `spotify` or `url` (catch-all, `ref` is the full cleaned address); other types (`applemusic`, `shazam`) carry the id of a metadata-only catalog song.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from typing import Any
from urllib.parse import parse_qsl, urlsplit

from . import urlclean

YOUTUBE, SOUNDCLOUD, SPOTIFY, URL = "youtube", "soundcloud", "spotify", "url"

TEMPLATES: dict[str, str] = {
    YOUTUBE: "https://www.youtube.com/watch?v={ref}",
    SOUNDCLOUD: "https://soundcloud.com/{ref}",
    SPOTIFY: "https://open.spotify.com/track/{ref}",
    URL: "{ref}",
}

_TIME_RE = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$", re.I)
_CLOCK_RE = re.compile(r"^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:\.\d+)?$")
_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]*://", re.I)
_SPOTIFY_TRACK_RE = re.compile(r"^https?://open\.spotify\.com/(?:intl-[a-z]{2}(?:-[a-z]{2,4})?/)?track/([A-Za-z0-9]{22})(?:[/?#].*)?$", re.I)
_SC_PREFIX = "https://soundcloud.com/"
_START_KEYS = ("t", "start")


def parse_time(text: Any) -> int | None:
    """Seconds from `85`, `85s`, `1m25s`, `1h2m3s`, `1:25` or `1:02:03`; None when it is not a time or is negative nonsense."""
    if isinstance(text, bool):
        return None
    if isinstance(text, (int, float)):
        return int(text) if math.isfinite(text) and text >= 0 else None
    if not isinstance(text, str):
        return None
    s = text.strip()
    if not s:
        return None
    m = _CLOCK_RE.fullmatch(s)
    if m:
        hours, minutes, seconds = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
        return None if seconds > 59 or (m.group(1) and minutes > 59) else hours * 3600 + minutes * 60 + seconds
    m = _TIME_RE.fullmatch(s)
    if not m or not any(m.groups()):
        return None
    return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(float(m.group(3) or 0))


def _start_hint(text: str) -> int | None:
    parts = urlsplit(text if _SCHEME_RE.match(text) else f"https://{text}")
    for source in (parts.query, parts.fragment):
        for k, v in parse_qsl(source, keep_blank_values=True):
            if k in _START_KEYS:
                t = parse_time(v)
                if t:
                    return t
    return None


def parse_source_url(url: str) -> dict[str, Any]:
    """`{type, ref}` plus `trim_start` (seconds) when the link carries a start time (`t=`, `start=`, `#t=`); the start time is a suggestion, never part of `ref`."""
    text = (url or "").strip()
    out: dict[str, Any]
    if urlclean.VIDEO_ID_RE.fullmatch(text):
        return {"type": YOUTUBE, "ref": text}
    vid = next((m.group(1) for rx in urlclean._URL_ID_RES if (m := rx.match(text))), None)
    if vid:
        out = {"type": YOUTUBE, "ref": vid}
    elif m := _SPOTIFY_TRACK_RE.match(text):
        return {"type": SPOTIFY, "ref": m.group(1)}
    elif (sc := urlclean.classify_soundcloud(text)) and sc[0] == "track":
        out = {"type": SOUNDCLOUD, "ref": sc[1][len(_SC_PREFIX):]}
    else:
        return {"type": URL, "ref": urlclean.clean_url(text)}
    start = _start_hint(text)
    if start:
        out["trim_start"] = start
    return out


def source_url(type_: str, ref: str) -> str | None:
    """The canonical address of a source; None for a catalog type without one."""
    template = TEMPLATES.get(type_)
    if template is not None:
        return template.format(ref=ref) if ref else None
    return ref if re.match(r"^https?://", ref or "", re.I) else None


def platform(entry: dict[str, Any]) -> str:
    """The legacy `source` of an entry: its type, or for a `url` entry the platform its address belongs to."""
    type_ = str(entry.get("type") or "")
    if type_ != URL:
        return type_
    host = (urlsplit(str(entry.get("ref") or "")).hostname or "").lower()
    if host == "youtube.com" or host.endswith(".youtube.com") or host == "youtu.be":
        return YOUTUBE
    if host == "soundcloud.com" or host.endswith(".soundcloud.com"):
        return SOUNDCLOUD
    if host.endswith("spotify.com"):
        return SPOTIFY
    return URL


def _seconds(value: Any) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return int(value) if float(value).is_integer() else round(float(value), 3)


def make_entry(type_: str, ref: str, trim_start: Any = None, trim_end: Any = None, duration: Any = None) -> dict[str, Any]:
    out: dict[str, Any] = {"type": type_, "ref": ref, "trim_start": _seconds(trim_start), "trim_end": _seconds(trim_end)}
    if (d := _seconds(duration)) is not None and d > 0:
        out["duration"] = d
    return out


def _from_old(e: dict[str, Any], song_id: str) -> dict[str, Any] | None:
    kind = e.get("platform") if isinstance(e.get("platform"), str) and e.get("platform") else e.get("source")
    url = e.get("url") if isinstance(e.get("url"), str) and e["url"].strip() else None
    if url:
        parsed = parse_source_url(url)
        return make_entry(parsed["type"], parsed["ref"])
    if not isinstance(kind, str) or not kind or not song_id:
        return None
    own = e.get("id")
    if kind == YOUTUBE and isinstance(own, str) and own != song_id and urlclean.VIDEO_ID_RE.fullmatch(own):
        return make_entry(YOUTUBE, own)
    if kind == urlclean.source_of(song_id):
        if kind == YOUTUBE:
            return make_entry(YOUTUBE, song_id)
        if kind == SOUNDCLOUD:
            return make_entry(URL, urlclean.watch_url(song_id))
        return make_entry(kind, song_id.split("-", 1)[1])
    return None


def _clean_entry(e: dict[str, Any]) -> dict[str, Any] | None:
    type_, ref = e.get("type"), e.get("ref")
    if not isinstance(type_, str) or not type_ or not isinstance(ref, str) or not ref.strip():
        return None
    return make_entry(type_, ref.strip(), e.get("trim_start"), e.get("trim_end"), e.get("duration"))


def is_new_shape(raw: Any) -> bool:
    return isinstance(raw, list) and all(isinstance(e, dict) and "type" in e and "ref" in e for e in raw)


def dedupe(entries: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """First entry of each (type, ref) wins, order kept; a later duplicate only fills trims and duration the first lacks."""
    out: list[dict[str, Any]] = []
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    for e in entries:
        key = (e["type"], e["ref"])
        if key in seen:
            for field in ("trim_start", "trim_end", "duration"):
                if seen[key].get(field) is None and e.get(field) is not None:
                    seen[key][field] = e[field]
            continue
        seen[key] = e
        out.append(e)
    return out


def normalize_sources(song: dict[str, Any]) -> list[dict[str, Any]]:
    """The sources of a song in the new shape from any older one (`sources` as `{platform|source, id, url}`, `{platform, url}`, or only `source`/`id`/`source_url`); order and primary kept, idempotent."""
    sid = str(song.get("id") or "")
    raw = song.get("sources")
    entries: list[dict[str, Any]] = []
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict):
            continue
        item = _clean_entry(e) if "type" in e and "ref" in e else _from_old(e, sid)
        if item:
            entries.append(item)
    if not entries:
        legacy = {"platform": song.get("source") or urlclean.source_of(sid), "url": song.get("source_url")}
        item = _from_old(legacy, sid)
        if item:
            entries.append(item)
    return dedupe(entries)


def legacy_id(entry: dict[str, Any], song_id: str) -> str | None:
    kind = platform(entry)
    if kind == urlclean.source_of(song_id):
        return song_id
    return entry["ref"] if kind in (YOUTUBE, SOUNDCLOUD, SPOTIFY) and entry["type"] != URL else None


def public_entry(entry: dict[str, Any], song_id: str) -> dict[str, Any]:
    """The API form: the new fields plus the legacy `url`, `platform`, `source` and `id` that old clients decode."""
    kind = platform(entry)
    return {**entry, "url": source_url(entry["type"], entry["ref"]), "platform": kind, "source": kind, "id": legacy_id(entry, song_id)}


def validate_trim(start: Any, end: Any, duration: Any = None) -> tuple[int | float | None, int | float | None]:
    """Checked `(start, end)` in seconds: each optional, 0 <= start < end, and within `duration` when it is known. ValueError with the message for the first fault."""
    out: list[int | float | None] = []
    for name, value in (("start", start), ("end", end)):
        if value is None:
            out.append(None)
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"trim {name} must be a number of seconds")
        if value < 0:
            raise ValueError(f"trim {name} must not be negative")
        out.append(_seconds(value))
    s, e = out
    known = _seconds(duration)
    if e is not None and e <= (s or 0):
        raise ValueError("trim start must be before trim end")
    if known:
        if e is not None and e > known:
            raise ValueError("trim end is beyond the end of the track")
        if s is not None and s >= known:
            raise ValueError("trim start is beyond the end of the track")
    return s, e


def apply_trim(entries: list[dict[str, Any]], trim: dict[str, Any], index: int = 0, duration: Any = None) -> None:
    """Set the trim of one entry (a key left out of `trim` keeps its value; an explicit None clears it); ValueError when invalid."""
    entry = entries[index]
    start = trim["start"] if "start" in trim else entry.get("trim_start")
    end = trim["end"] if "end" in trim else entry.get("trim_end")
    entry["trim_start"], entry["trim_end"] = validate_trim(start, end, entry.get("duration") or duration)
