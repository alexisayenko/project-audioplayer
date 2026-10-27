"""Track list of a time-coded video (ADD-193 to ADD-197): the lines of a YouTube description or pasted text, or yt-dlp chapters, become tracks with start and end seconds, artists, title and version. Pure: no network, no clock."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import credit_title, titleclean, titles

MAX_TRACKS = 200
MIN_SPAN = 5.0

W_UNREADABLE = "Could not read this line"
W_ORDER = "Time is not after the previous track"
W_PAST_END = "After the end of the video"
W_ARTIST = "Check the artist"
W_NO_ARTIST = "Artist is the channel"
W_SHORT = "Shorter than 5 s"
W_NOT_LIST = "Fewer than two time-coded lines: not a track list"
W_CAPPED = "More than 200 tracks: the rest was dropped"
W_TOTAL = "The total time in the text differs from the video length"

_TIME = re.compile(r"(\d{1,3}):([0-5]\d)(?::([0-5]\d))?(?![\d:])")
_NUM_HASH = re.compile(r"#\s*(\d{1,3})\s*[.):\-–—]?\s*")
_NUM_TRACK = re.compile(r"track\s*(?:#\s*)?(\d{1,3})\s*(?:[:.)\-–—]\s*)?", re.I)
_NUM_DOT = re.compile(r"(\d{1,3})\s*[.)](?!\d)\s*")
_NUM_DASH = re.compile(r"(\d{1,3})\s+[-–—]\s+")
_LEAD_DASH = re.compile(r"[\[(]?(\d{1,3})[\])]?\s+[-–—]\s+(?=\S)")
_LEAD_BARE = re.compile(r"(?:[\[(](\d{1,3})[\])]|(\d{1,3})(?:\s*/\s*\d{1,3})?)\s+(?=[^\W\d_])")
_SEP = re.compile(r"\s[-–—|]\s")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.I)
_TOTAL = re.compile(r"(?:total|duration|length|runtime|full\s+length)\b", re.I)
_INVISIBLE = dict.fromkeys(map(ord, "​‌‍⁠﻿"))
_EDGE = " \t-–—|:·•"
_HEAD_JUNK_KEEP = "[(#"
_NAME_JOINERS = frozenset({"&", "+", "x", "X", "×"})
_OPEN_FOR = {"]": "[", ")": "("}


@dataclass
class Track:
    index: int
    start: float
    end: float | None
    raw_line: str
    artists: list[str]
    title: str
    version: str | None = None
    track_no: int | None = None
    warnings: list[str] = field(default_factory=list)
    featured: list[str] = field(default_factory=list)


@dataclass
class TracklistResult:
    tracks: list[Track] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class _Entry:
    start: float
    raw: str
    text: str
    number: int | None
    lead: tuple[int, str] | None = None


def _take_lead(text: str) -> tuple[int, str] | None:
    m = _LEAD_DASH.match(text) or _LEAD_BARE.match(text)
    if not m:
        return None
    digits = next(g for g in m.groups() if g)
    return int(digits), text[m.end():].strip(_EDGE)


def _resolve_leads(entries: list[_Entry]) -> None:
    """A bare leading number (`01 Artist - Title`) is a track number only when every line has one and they count up by one from 1; otherwise the digits stay in the text (`50 Cent`, `808 State`)."""
    if len(entries) < 2 or any(e.number is not None or not e.lead for e in entries):
        return
    first = entries[0].lead[0]  # type: ignore[index]
    if first != 1 or any(e.lead[0] != first + i for i, e in enumerate(entries)):  # type: ignore[index]
        return
    for e in entries:
        e.number, e.text = e.lead  # type: ignore[misc]


def _seconds(m: re.Match[str]) -> float:
    first, second, third = m.group(1), m.group(2), m.group(3)
    if third is None:
        return int(first) * 60 + int(second)
    return int(first) * 3600 + int(second) * 60 + int(third)


def _prep(line: str) -> str:
    s = line.translate(_INVISIBLE).replace(" ", " ").strip()
    while s and not s[0].isalnum() and s[0] not in _HEAD_JUNK_KEEP:
        s = s[1:].lstrip()
    return s


def _take_number(text: str, dash_ok: bool = False) -> tuple[int | None, str]:
    for pattern in (_NUM_HASH, _NUM_TRACK, _NUM_DOT):
        m = pattern.match(text)
        if m:
            return int(m.group(1)), text[m.end():]
    if dash_ok:
        m = _NUM_DASH.match(text)
        if m and _SEP.search(text, m.end() - 1):
            return int(m.group(1)), text[m.end():]
    return None, text


def _take_head_time(text: str) -> tuple[float, str] | None:
    pos = 0
    opener = text[:1] if text[:1] in "[(" else ""
    if opener:
        pos = 1
        while text[pos : pos + 1] == " ":
            pos += 1
    m = _TIME.match(text, pos)
    if not m:
        return None
    pos = m.end()
    rest = text[pos:]
    probe = rest.lstrip()
    if probe[:1] in ("-", "–", "—"):
        after = probe[1:].lstrip()
        second = _TIME.match(after)
        if second:
            pos = len(text) - len(after) + second.end()
            rest = text[pos:]
    rest = rest.lstrip()
    if rest[:1] in ("]", ")"):
        rest = rest[1:]
    return _seconds(m), rest.lstrip(_EDGE)


def _take_tail_time(text: str) -> tuple[float, str] | None:
    body = text.rstrip()
    closer = body[-1:] if body[-1:] in ("]", ")") else ""
    if closer:
        body = body[:-1].rstrip()
    cut = max(body.rfind(" "), body.rfind("\t"), body.rfind("("), body.rfind("["))
    token = body[cut + 1 :]
    m = _TIME.fullmatch(token)
    if not m:
        return None
    opener = body[cut : cut + 1] if body[cut : cut + 1] in ("(", "[") else ""
    if bool(closer) != bool(opener) or (closer and _OPEN_FOR[closer] != opener):
        return None
    return _seconds(m), body[: max(cut, 0)].rstrip(_EDGE)


def _total_seconds(text: str) -> float | None:
    found = None
    for token in text.split():
        m = _TIME.fullmatch(token.strip("()[]:"))
        if m:
            found = _seconds(m)
    return found


def _entry(line: str) -> _Entry | tuple[str, float | None] | None:
    s = _prep(line)
    if not s:
        return None
    if _TOTAL.match(s):
        return ("total", _total_seconds(s))
    number, body = _take_number(s)
    head = _take_head_time(body)
    if head:
        start, rest = head
        if number is None:
            number, rest = _take_number(rest, dash_ok=True)
        tail = _take_tail_time(rest)
        if tail and tail[1]:
            rest = tail[1]
    else:
        tail = _take_tail_time(body)
        if not tail:
            return None
        start, rest = tail
    text = " ".join(_URL.sub(" ", rest).split()).strip(_EDGE)
    return _Entry(start, line.strip(), text, number, _take_lead(text) if number is None else None)


def _names(pill: str) -> list[str]:
    out: list[str] = []
    for chunk in pill.split(","):
        words = chunk.split()
        cur: list[str] = []
        for i, word in enumerate(words):
            if word in _NAME_JOINERS and cur and i < len(words) - 1:
                out.append(" ".join(cur))
                cur = []
            else:
                cur.append(word)
        if cur:
            out.append(" ".join(cur))
    return out


def _unique(names: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        key = credit_title.fold(n)
        if n and key not in seen:
            seen.add(key)
            out.append(n)
    return out


def _has_bare_and(pill: str) -> bool:
    words = pill.split()
    return any(w.lower() == "and" and 0 < i < len(words) - 1 for i, w in enumerate(words))


def _split_line(text: str) -> tuple[str, str]:
    m = _SEP.search(text)
    if m:
        return text[: m.start()].strip(), text[m.end():].strip()
    head, colon, tail = text.partition(": ")
    if colon and head.strip() and tail.strip():
        return head.strip(), tail.strip()
    return "", text


def _read_text(text: str) -> tuple[list[str], list[str], str, str | None, list[str]]:
    warnings: list[str] = []
    cleaned = titleclean.clean(text) or text
    body, version = titles.cut_version(cleaned)
    artist, title = _split_line(body)
    if not title:
        artist, title = "", body
    if not artist:
        warnings.append(W_NO_ARTIST)
    found = credit_title.parse(artist, title, split_vs=True)
    pills = found["mainArtists"]
    if any(_has_bare_and(p) for p in pills):
        warnings.append(W_ARTIST)
    artists = _unique([n for p in pills for n in _names(p)])
    return artists, _unique(found["featuredArtists"]), found["title"].strip(), (version or "").strip() or None, warnings


def _read_entry(i: int, e: _Entry) -> Track:
    track = Track(index=i, start=float(e.start), end=None, raw_line=e.raw, artists=[], title="", track_no=e.number if e.number is not None else i + 1)
    if e.text:
        track.artists, track.featured, track.title, track.version, track.warnings = _read_text(e.text)
    if not track.title:
        track.title = e.text
        track.warnings.append(W_UNREADABLE)
    return track


def _is_valid(track: Track, last_valid: Track | None, limit: float | None) -> bool:
    if limit is not None and track.start >= limit:
        track.warnings.append(W_PAST_END)
        return False
    if last_valid is not None and track.start <= last_valid.start:
        track.warnings.append(W_ORDER)
        return False
    return True


def _build(entries: list[_Entry], duration: float | None, fallback_end: float | None = None) -> TracklistResult:
    result = TracklistResult()
    _resolve_leads(entries)
    if len(entries) < 2:
        result.warnings.append(W_NOT_LIST)
        return result
    if len(entries) > MAX_TRACKS:
        entries = entries[:MAX_TRACKS]
        result.warnings.append(W_CAPPED)
    limit = duration if duration else fallback_end
    last_valid: Track | None = None
    valid: list[Track] = []
    for i, e in enumerate(entries):
        track = _read_entry(i, e)
        if _is_valid(track, last_valid, limit):
            last_valid = track
            valid.append(track)
        result.tracks.append(track)
    for here, nxt in zip(valid, valid[1:]):
        here.end = nxt.start
    if valid:
        valid[-1].end = float(limit) if limit is not None else None
    for t in valid:
        if t.end is not None and t.end - t.start < MIN_SPAN:
            t.warnings.append(W_SHORT)
    return result


def parse_tracklist(text: str, duration: float | None = None) -> TracklistResult:
    """Tracks of the time-coded lines of `text`, in order of appearance. The last valid track ends at `duration` (None when unknown). Header lines, blank lines, links and a Total line are ignored; a time-coded line without a readable title, a time not after the previous track and a time past `duration` are kept and flagged (the last two have no `end`); fewer than two time-coded lines is not a track list (no tracks, one warning)."""
    entries: list[_Entry] = []
    total: float | None = None
    for line in str(text or "").splitlines():
        e = _entry(line)
        if isinstance(e, tuple):
            total = e[1] if e[1] is not None else total
        elif e:
            entries.append(e)
    result = _build(entries, duration)
    if total is not None and duration and result.tracks and abs(total - duration) > 60:
        result.warnings.append(W_TOTAL)
    return result


def from_chapters(chapters: list[dict[str, Any]], duration: float | None) -> TracklistResult:
    """Tracks of yt-dlp `chapters` (`start_time`, `end_time`, `title`): each chapter title is read like a line of text; the last track ends at `duration`, else at the last chapter's `end_time`."""
    entries: list[_Entry] = []
    fallback: float | None = None
    for ch in chapters or []:
        if not isinstance(ch, dict):
            continue
        start = ch.get("start_time")
        if not isinstance(start, (int, float)) or isinstance(start, bool):
            continue
        raw = str(ch.get("title") or "").strip()
        number, body = _take_number(_prep(raw), dash_ok=True)
        text = " ".join(_URL.sub(" ", body).split()).strip(_EDGE)
        entries.append(_Entry(float(start), raw, text, number, _take_lead(text) if number is None else None))
        end = ch.get("end_time")
        if isinstance(end, (int, float)) and not isinstance(end, bool):
            fallback = float(end)
    return _build(entries, duration, fallback)


def rows(tracks: list[Track]) -> list[dict[str, Any]]:
    """The tracks as plain dicts (keys as the fields), for fixtures and JSON."""
    return [
        {"index": t.index, "start": t.start, "end": t.end, "artists": t.artists, "featured": t.featured, "title": t.title,
         "version": t.version, "track_no": t.track_no, "warnings": t.warnings}
        for t in tracks
    ]

