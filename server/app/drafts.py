"""Per-user draft list (LIB-170..LIB-174, API-180..API-185, DATA-180..DATA-182): pasted "Artist - Title" lines and links kept as future additions. Stored in users/<uid>/drafts.json, never in library.json."""

from __future__ import annotations

import json
import os
import random
import re
import threading
import time
import unicodedata
import uuid
from concurrent.futures import ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any

from . import credit_title, credits, credits_split, links, playlist_import, previewcache, titleclean, titles, urlclean
from .jsonio import write_json_atomic
from .library import sources_of
from .problems import Problem
from .ratelimit import KeyedWindow
from .timeutil import now_utc
from .version_norm import normalize_version

MAX_DRAFTS = 500
MAX_LINES = 100
MAX_LINE = 300
FETCH_WORKERS = 2
FETCH_DELAY_S = (0.4, 1.0)
FETCH_TIMEOUT_S = 40.0
PERIOD_S = 3600.0
ID_RE = re.compile(r"^d_[0-9a-f]{12}$")
STATES = ("new", "fetched", "failed")
RATE_LIMITED = playlist_import._RATE_LIMITED
FETCHABLE = ("youtube", "soundcloud")
CREDIT_KEYS = ("title", "mainArtists", "featuredArtists", "withArtists", "version")

_URL_RE = re.compile(
    r"https?://[^\s<>\"']+"
    r"|(?:(?:www\.|m\.|music\.)?youtu(?:\.be|be\.com)|(?:www\.|m\.|on\.)?soundcloud\.com)/[^\s<>\"']+",
    re.I,
)
_URL_TAIL = ").],;!?"
_EMPTY_PAIRS = re.compile(r"\[\s*\]|\(\s*\)|<\s*>|\{\s*\}")
_EDGE = " \t-–—|:,;."
_DASH = re.compile(r"\s[-–—]\s")
_fetches = KeyedWindow(600, PERIOD_S)


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, "")))
    except ValueError:
        return default


def reset_limits() -> None:
    _fetches.reset()


def charge_fetches(uid: str, owner: bool, count: int) -> float:
    """Seconds to wait when `count` fetches do not fit the user's hourly budget, else 0 (the owner is exempt)."""
    if owner or count <= 0:
        return 0.0
    _fetches.limit = _env_int("DRAFT_FETCHES_PER_HOUR", 600)
    return _fetches.charge(uid, count)


def refusal(wait_s: float) -> Problem:
    minutes = max(1, int(-(-wait_s // 60)))
    return Problem(429, "draft_limit", f"Draft lookup limit reached. Try again in {minutes} min.",
                   headers={"Retry-After": str(int(wait_s) + 1)}, retry_after_minutes=minutes)


def fold(text: Any) -> str:
    plain = "".join(c for c in unicodedata.normalize("NFKD", str(text or "")) if not unicodedata.combining(c))
    return " ".join(re.sub(r"\W+", " ", plain.casefold()).split())


def split_input(raw: Any) -> list[str]:
    """Trimmed non-empty lines of a paste; every element may itself hold several lines."""
    items = raw if isinstance(raw, list) else [raw]
    return [line.strip() for item in items for line in str(item or "").splitlines() if line.strip()]


def line_parts(line: str) -> tuple[str, str]:
    """`(text, url)` of one line: the first link anywhere in it (cleaned) and the rest as the "Artist - Title" text."""
    found = _URL_RE.search(line)
    if not found:
        return " ".join(line.split()), ""
    raw = found.group(0).rstrip(_URL_TAIL)
    rest = f"{line[: found.start()]} {line[found.start() + len(raw):]}"
    rest = _EMPTY_PAIRS.sub(" ", rest)
    text = " ".join(rest.split()).strip(_EDGE).strip()
    full = raw if re.match(r"https?://", raw, re.I) else f"https://{raw}"
    return text, urlclean.clean_url(full)


def source_of(url: str) -> str | None:
    """`youtube`, `soundcloud` (a track or short link), `link` (any other http(s) link) or None (no link)."""
    if not url:
        return None
    if urlclean.parse_video_id(url) and re.match(r"https?://", url, re.I):
        return "youtube"
    sc = urlclean.classify_soundcloud(url)
    if sc and sc[0] in ("track", "short"):
        return "soundcloud"
    return "link" if re.match(r"https?://[^\s/]+", url, re.I) else None


def parse_text(text: str) -> dict[str, Any] | None:
    """Title, artists and version of an "Artist - Title" text with the add paths' helpers (noise, version bracket, feat / with and vs splits); None for an empty text."""
    cleaned = titleclean.clean(text or "").strip()
    if not cleaned:
        return None
    artist, title, remixer = titles.split_title("", cleaned, lead=True)
    if not artist and (m := _DASH.search(title)):
        left, right = title[: m.start()].strip(), title[m.end():].strip()
        if left and right:
            artist, title = titles.clean_artist(left), titles.clean_title(right)
    found = credit_title.parse(artist, title, split_vs=True)
    version = None
    if remixer:
        version = {"type": credits_split.kind_of(remixer), "name": normalize_version(remixer), "artists": credits_split.version_artists(remixer), "releaseYear": credits_split.version_year(remixer)}
    return {"title": found["title"] or title, "mainArtists": found["mainArtists"], "featuredArtists": found["featuredArtists"],
            "withArtists": found["withArtists"], "version": version}


def _blank_fetched() -> dict[str, Any]:
    return {"sourceId": None, "title": "", "mainArtists": [], "featuredArtists": [], "withArtists": [], "version": None, "year": None, "duration": None, "thumbnail": None}


def fetched_fields(vid: str, meta: dict[str, Any]) -> dict[str, Any]:
    """The draft fields of one quick lookup: what the playlist import shows for a video (credits, version, upload year as the version-year suggestion, length, thumbnail)."""
    row = playlist_import.view(vid, meta, playlist_import.Owned([]), detailed=True)
    return {"sourceId": vid, "title": row["title"], "mainArtists": row["mainArtists"], "featuredArtists": row["featuredArtists"], "withArtists": row["withArtists"],
            "version": row["version"], "year": row["publishedYear"], "duration": row["duration"], "thumbnail": row["thumbnail"]}


def quick_fetch(url: str) -> dict[str, Any]:
    """Title, channel / artist, length, upload year and thumbnail of one YouTube or SoundCloud link; no AcoustID, Discogs, MusicBrainz or Wikipedia. Raises on failure."""
    vid = urlclean.parse_video_id(url)
    if vid:
        return fetched_fields(vid, previewcache.youtube(vid))
    try:
        link = links.resolve_link(url)
    except links.Refused as refused:
        raise ValueError(json.loads(refused.response.body).get("detail", "link refused")) from refused
    return fetched_fields(link.vid, link.probe or {})


def new_draft(text: str, url: str, origin: dict[str, Any] | None = None) -> dict[str, Any]:
    blank = {k: v for k, v in _blank_fetched().items() if k != "sourceId"}
    draft = {"id": f"d_{uuid.uuid4().hex[:12]}", "text": text, "url": url, "source": source_of(url), "state": "new", "createdAt": now_utc(), "fetched": None, **blank}
    if origin:
        draft["playlist"] = {"id": origin["id"], "title": origin.get("title") or "", "position": origin["position"]}
    return draft


def compose(draft: dict[str, Any]) -> None:
    """Fill the credit fields: the typed text wins (its missing artists come from the fetch), a draft without text takes the fetched credits; year, length and thumbnail always come from the fetch."""
    fetched = draft.get("fetched") or _blank_fetched()
    parsed = parse_text(draft.get("text", ""))
    if parsed is None:
        base = {k: fetched[k] for k in CREDIT_KEYS}
    else:
        base = {**parsed, "mainArtists": parsed["mainArtists"] or list(fetched["mainArtists"])}
    draft.update(base)
    draft.update({k: fetched[k] for k in ("year", "duration", "thumbnail")})


def apply_fetch(draft: dict[str, Any], fields: dict[str, Any] | None) -> None:
    draft["fetched"] = fields
    draft["state"] = "fetched" if fields else "failed"
    compose(draft)


def build(text: str, url: str, origin: dict[str, Any] | None = None) -> dict[str, Any]:
    draft = new_draft(text, url, origin)
    compose(draft)
    return draft


def fetchable(draft: dict[str, Any]) -> bool:
    return draft.get("source") in FETCHABLE


class _Fetcher:
    def __init__(self, urls: dict[str, str]) -> None:
        self.urls = urls
        self.pending = list(urls)
        self.lock = threading.Lock()
        self.halted = threading.Event()
        self.limited = threading.Event()
        self.results: dict[str, dict[str, Any] | None] = {}
        self.errors: dict[str, str] = {}

    def take(self) -> str | None:
        with self.lock:
            return self.pending.pop(0) if self.pending else None

    def one(self, key: str) -> None:
        try:
            self.results[key] = quick_fetch(self.urls[key])
        except Exception as exc:
            self.errors[key] = links.short_error(exc)
            if RATE_LIMITED.search(str(exc)):
                self.halted.set()
                self.limited.set()
            else:
                self.results[key] = None

    def worker(self) -> None:
        first = True
        while not self.halted.is_set():
            key = self.take()
            if key is None:
                return
            if not first:
                time.sleep(random.uniform(*FETCH_DELAY_S))
            first = False
            if self.halted.is_set():
                return
            self.one(key)


def _fetch_all(urls: dict[str, str]) -> tuple[dict[str, dict[str, Any] | None], bool, dict[str, str]]:
    """Fetch the given `{key: url}` with FETCH_WORKERS workers and a random pause between one worker's fetches, within FETCH_TIMEOUT_S. Returns `{key: fields | None}` for the lookups that ended (None = failed), whether YouTube refused with a 429 or a bot check (the rest, and the refused one, are then left unfetched), and the short error of each failure."""
    fetcher = _Fetcher(urls)
    pool = ThreadPoolExecutor(max_workers=FETCH_WORKERS)
    futures = [pool.submit(fetcher.worker) for _ in range(min(FETCH_WORKERS, len(urls)))]
    wait(futures, timeout=FETCH_TIMEOUT_S)
    fetcher.halted.set()
    pool.shutdown(wait=False, cancel_futures=True)
    return dict(fetcher.results), fetcher.limited.is_set(), dict(fetcher.errors)


def fetch_many(drafts: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any] | None], bool, dict[str, str]]:
    """Quick lookups for the fetchable drafts, keyed by draft id."""
    return _fetch_all({d["id"]: d["url"] for d in drafts if fetchable(d)})


# --- storage --------------------------------------------------------------------------------

def load(path: Path) -> list[dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return []
    items = raw.get("drafts") if isinstance(raw, dict) else None
    return [d for d in items or [] if isinstance(d, dict) and isinstance(d.get("id"), str)]


def save(path: Path, drafts: list[dict[str, Any]]) -> None:
    write_json_atomic(path, {"drafts": drafts})


# --- library marks and output ------------------------------------------------------------------

class Library:
    """What the user already has, for the "In library" mark: song ids, source links and normalised title + artists + version; `song_id` says which song a draft matches."""

    def __init__(self, songs: list[dict[str, Any]]) -> None:
        self.by_id: dict[str, str] = {}
        self.by_url: dict[str, str] = {}
        self.by_key: dict[tuple[str, tuple[str, ...], str], str] = {}
        for song in songs:
            self._index(song)

    def _index(self, song: dict[str, Any]) -> None:
        sid = str(song.get("id") or "")
        self.by_id.setdefault(sid, sid)
        for entry in sources_of(song):
            if entry.get("source") == "youtube":
                self.by_id.setdefault(str(entry.get("id") or ""), sid)
        for u in [song.get("source_url"), *(e.get("url") for e in sources_of(song))]:
            if isinstance(u, str) and u:
                self.by_url.setdefault(urlclean.clean_url(u), sid)
        key = playlist_import._key(song.get("title"), credits.main_artists(song), song.get("version"))
        if key:
            self.by_key.setdefault(key, sid)

    def link_song_id(self, draft: dict[str, Any]) -> str | None:
        url = draft.get("url") or ""
        vid = urlclean.parse_video_id(url) if url else None
        fetched_id = (draft.get("fetched") or {}).get("sourceId")
        for candidate in (vid, fetched_id):
            if candidate and candidate in self.by_id:
                return self.by_id[candidate]
        return self.by_url.get(url) if url else None

    def owns_link(self, draft: dict[str, Any]) -> bool:
        return self.link_song_id(draft) is not None

    def song_id(self, draft: dict[str, Any]) -> str | None:
        found = self.link_song_id(draft)
        if found:
            return found
        key = playlist_import._key(draft.get("title", ""), draft.get("mainArtists") or [], draft.get("version"))
        return self.by_key.get(key) if key else None

    def has(self, draft: dict[str, Any]) -> bool:
        return self.song_id(draft) is not None


PUBLIC_KEYS = ("id", "text", "url", "source", "title", "mainArtists", "featuredArtists", "withArtists", "version", "year", "duration", "thumbnail", "state", "createdAt", "playlist")


def origin_of(draft: dict[str, Any]) -> dict[str, Any] | None:
    """`{id, title, position}` of the YouTube playlist a draft was imported from, or None (old drafts, pasted lines)."""
    raw = draft.get("playlist")
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not raw["id"]:
        return None
    position = raw.get("position")
    return {"id": raw["id"], "title": raw["title"] if isinstance(raw.get("title"), str) else "",
            "position": position if isinstance(position, int) and not isinstance(position, bool) else 0}


def public(draft: dict[str, Any], library: Library) -> dict[str, Any]:
    out = {k: draft.get(k) for k in PUBLIC_KEYS}
    out["playlist"] = origin_of(draft)
    out["mainArtists"] = list(out["mainArtists"] or [])
    out["featuredArtists"] = list(out["featuredArtists"] or [])
    out["withArtists"] = list(out["withArtists"] or [])
    out["state"] = out["state"] if out["state"] in STATES else "new"
    out["inLibrary"] = library.has(draft)
    return out


# --- adding ------------------------------------------------------------------------------------

def pair_origins(raw: Any, origins: list[dict[str, Any] | None] | None) -> list[tuple[str, dict[str, Any] | None]]:
    """The lines of a paste with the playlist origin of their item; `origins[i]` belongs to item `i` and counts only when that item is a single line."""
    items = raw if isinstance(raw, list) else [raw]
    out: list[tuple[str, dict[str, Any] | None]] = []
    for index, item in enumerate(items):
        parts = split_input(item)
        origin = origins[index] if origins and index < len(origins) and len(parts) == 1 else None
        out.extend((part, origin) for part in parts)
    return out


def _parsed_line(line: str, counts: dict[str, int]) -> tuple[str, str, str] | None:
    if len(line) > MAX_LINE:
        counts["tooLong"] += 1
        return None
    text, url = line_parts(line)
    key = fold(text)
    return None if not url and not key else (text, url, key)


def _url_taken(url: str, text: str, by_url: dict[str, dict[str, Any]], seen_urls: set[str], counts: dict[str, int], updates: list[tuple[dict[str, Any], str]]) -> bool:
    if url in seen_urls:
        counts["duplicates"] += 1
        return True
    seen_urls.add(url)
    match = by_url.get(url)
    if match is None:
        return False
    if text and not match.get("text"):
        updates.append((match, text))
    else:
        counts["duplicates"] += 1
    return True


def plan_lines(raw: Any, existing: list[dict[str, Any]], origins: list[dict[str, Any] | None] | None = None) -> dict[str, Any]:
    """Split a paste and drop what cannot be a draft: `lines` are the new `(text, url)` pairs in paste order (`origins` the playlist origin of each, or None), `updates` the existing drafts that get the text of a line with the same link; `counts` says what was left out and why."""
    pairs = pair_origins(raw, origins)
    lines = [line for line, _ in pairs]
    counts = {"lines": len(lines), "overLineCap": max(0, len(lines) - MAX_LINES), "tooLong": 0, "duplicates": 0}
    by_url = {d["url"]: d for d in existing if d.get("url")}
    known_texts = {fold(d.get("text")) for d in existing if d.get("text")}
    seen_urls: set[str] = set()
    seen_texts: set[str] = set()
    fresh: list[tuple[str, str]] = []
    fresh_origins: list[dict[str, Any] | None] = []
    updates: list[tuple[dict[str, Any], str]] = []
    for line, origin in pairs[:MAX_LINES]:
        parsed = _parsed_line(line, counts)
        if parsed is None:
            continue
        text, url, key = parsed
        if url:
            if _url_taken(url, text, by_url, seen_urls, counts, updates):
                continue
        elif key in seen_texts or key in known_texts:
            counts["duplicates"] += 1
            continue
        if key:
            seen_texts.add(key)
        fresh.append((text, url))
        fresh_origins.append(origin)
    return {"lines": fresh, "origins": fresh_origins, "updates": updates, "counts": counts}


def find(items: list[dict[str, Any]], draft_id: str) -> dict[str, Any] | None:
    return next((d for d in items if d["id"] == draft_id), None)


def insert(items: list[dict[str, Any]], built: list[dict[str, Any]], texts: list[tuple[str, str]]) -> dict[str, Any]:
    """Put the new drafts first (in paste order) into `items` and give the existing drafts their new text (`texts` is `(id, text)`), up to MAX_DRAFTS; returns the created and updated drafts and how many new ones a concurrent paste or the cap left out."""
    by_url = {d["url"] for d in items if d.get("url")}
    known = {fold(d.get("text")) for d in items if d.get("text")}
    created: list[dict[str, Any]] = []
    left_out = {"duplicates": 0, "overCap": 0}
    for draft in built:
        key = fold(draft["text"])
        if (draft["url"] and draft["url"] in by_url) or (not draft["url"] and key in known):
            left_out["duplicates"] += 1
        elif len(items) + len(created) >= MAX_DRAFTS:
            left_out["overCap"] += 1
        else:
            created.append(draft)
            by_url.add(draft["url"])
            known.add(key)
    items[:0] = created
    updated: list[dict[str, Any]] = []
    for draft_id, text in texts:
        found = find(items, draft_id)
        if found is not None and not found.get("text"):
            found["text"] = text
            compose(found)
            updated.append(found)
    return {"created": created, "updated": updated, **left_out}


def edit(draft: dict[str, Any], text: str, url: str, fields: dict[str, Any] | None, fetched: bool) -> None:
    """Replace the raw text and link of a draft and re-parse it; a new link drops the old lookup, `fetched` says whether `fields` (None = failed) is the lookup of the new link."""
    if url != draft.get("url"):
        draft.update({"url": url, "source": source_of(url), "fetched": None, "state": "new"})
    draft["text"] = text
    if fetched:
        apply_fetch(draft, fields)
    else:
        compose(draft)
