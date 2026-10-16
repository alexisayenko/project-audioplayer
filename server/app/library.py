"""library.json store: {settings:{music_root}, songs:[...]}, atomic replace on write."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from . import countrycodes, credits, discogs_lookup, genre_filter, genre_lookup, langcodes, urlclean, wiki_lookup
from .jsonio import write_json_atomic
from .timeutil import max_year, now_utc  # noqa: F401

_ROOT_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_.-]+)://(.*)$")
_DECADE_RE = re.compile(r"^\d{2}s$")
DECADE_MIN = 1950


def file_name(song: dict[str, Any]) -> str:
    """Audio file name of a song, never a path."""
    default = f"{song.get('id', '')}.m4a"
    return Path(str(song.get("file") or default)).name or default


def find_song(songs: list[dict[str, Any]], song_id: str) -> dict[str, Any] | None:
    return next((s for s in songs if s["id"] == song_id), None)


def has_file(song: dict[str, Any]) -> bool:
    """True when the record names an audio file; an explicit `file: null` is a metadata-only song."""
    return bool(song.get("file"))


def clean_sources(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict) or not isinstance(e.get("source"), str) or not e.get("id"):
            continue
        url = urlclean.clean_url(e["url"]) if isinstance(e.get("url"), str) else None
        out.append({"source": e["source"], "id": str(e["id"]), "url": url})
    return out


def sources_of(song: dict[str, Any]) -> list[dict[str, Any]]:
    """Stored `sources`, or the single source derived from the id and `source_url` (old records)."""
    stored = song.get("sources")
    if isinstance(stored, list) and stored:
        return stored
    sid = str(song.get("id", ""))
    return [{"source": urlclean.source_of(sid), "id": sid, "url": song.get("source_url")}]


def audio_state(song: dict[str, Any], root: Path | None) -> str:
    """`server` when the audio file is on the server, else `none`; never stored. `phone` is client-side.

    `root` None (music_root server not configured) trusts the record's `file`."""
    if not has_file(song):
        return "none"
    if root is None:
        return "server"
    return "server" if (root / file_name(song)).is_file() else "none"


def public_song(song: dict[str, Any], root: Path | None) -> dict[str, Any]:
    """The record plus derived, additive fields: `audio_state`, `sources`, and `audio` when a file exists."""
    out = dict(song)
    credits.ensure(out)
    out.update(credits.project(out))
    state = audio_state(song, root)
    out["audio_state"] = state
    out["sources"] = sources_of(song)
    if state == "server":
        name = file_name(song)
        size = None
        if root is not None:
            try:
                size = (root / name).stat().st_size
            except OSError:
                pass
        out["audio"] = {
            "file": name,
            "format": Path(name).suffix.lstrip(".").lower() or None,
            "size": size,
            "duration": song.get("duration"),
        }
    return out


def updated_at(song: dict[str, Any]) -> str:
    return str(song.get("updated_at") or song.get("added_at") or "")


def catalog_revision(songs: list[dict[str, Any]]) -> str:
    """Content hash of the public catalog; changes on any add, edit, delete or audio-state change."""
    blob = json.dumps(songs, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


def normalize_song(song: dict[str, Any]) -> dict[str, Any]:
    s = dict(song)
    credits.ensure(s)
    if "id" in s and (s.get("file") == "" or "file" not in s):
        s["file"] = f"{s['id']}.m4a"
    if "sources" in s:
        s["sources"] = clean_sources(s["sources"])
    if isinstance(s.get("bpm"), (int, float)) and not isinstance(s["bpm"], bool):
        s["bpm"] = round(s["bpm"])
    if isinstance(s.get("source_url"), str):
        s["source_url"] = urlclean.clean_url(s["source_url"])
    for key in ("wikipedia_song", "wikipedia_artist"):
        s[key] = wiki_lookup.clean_link(s.get(key))
    if "wikipedia_album" in s:
        s["wikipedia_album"] = wiki_lookup.clean_link(s["wikipedia_album"])
    if "musicbrainz_url" in s:
        s["musicbrainz_url"] = genre_lookup.clean_recording_url(s["musicbrainz_url"])
    if "discogs_url" in s:
        s["discogs_url"] = discogs_lookup.clean_url(s["discogs_url"])
    if "spotify_url" in s:
        s["spotify_url"] = urlclean.clean_spotify_url(s["spotify_url"])
    s.pop("original", None)
    normalize_tags(s)
    return s


def normalize_tags(s: dict[str, Any]) -> None:
    genre = s.pop("genre", None)
    tags = list(s.get("tags") or [])
    if isinstance(genre, str) and genre.strip():
        tags.append(f"genre:{genre}")
    if "tags" in s or genre:
        s["tags"] = clean_tags(tags)
    year = credits.released(s)
    if decade_tag(year):
        s["tags"] = with_decade(s.get("tags") or [], year)


def normalize(raw: Any) -> dict[str, Any]:
    """Accept the old bare {songs:[...]} shape and return {settings, songs}."""
    if isinstance(raw, list):
        raw = {"songs": raw}
    raw = raw if isinstance(raw, dict) else {}
    settings = dict(raw.get("settings") or {})
    songs = [normalize_song(s) for s in raw.get("songs") or []]
    return {"settings": settings, "songs": songs}


def decade_tag(year: Any) -> str | None:
    """`decade:90s` for every year from 1950 up to max_year(), else None."""
    if isinstance(year, bool) or not isinstance(year, int) or not DECADE_MIN <= year <= max_year():
        return None
    return f"decade:{year // 10 * 10 % 100:02d}s"


def with_decade(tags: list[str], year: Any) -> list[str]:
    """Replace every `decade:*` tag by the one derived from `year`; untouched when the year gives none."""
    derived = decade_tag(year)
    if derived is None:
        return list(tags)
    out: list[str] = []
    placed = False
    for t in tags:
        if t.casefold().startswith("decade:"):
            if not placed:
                out.append(derived)
                placed = True
        else:
            out.append(t)
    if not placed:
        out.append(derived)
    return out


def load_doc(path: Path) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as f:
            doc = normalize(json.load(f))
        for song in doc["songs"]:
            bad = unknown_countries(song.get("tags") or [])
            if bad:
                logging.getLogger(__name__).warning("song %s has unmapped country tags %s", song.get("id"), bad)
        return doc
    except FileNotFoundError:
        return normalize({})


def save_doc(path: Path, doc: dict[str, Any]) -> None:
    songs = doc.get("songs") or []
    for song in songs:
        credits.absorb(song)
    out = {"settings": {**(doc.get("settings") or {}), "credits_schema": credits.SCHEMA}, "songs": songs}
    write_json_atomic(path, out)


def load(path: Path) -> list[dict[str, Any]]:
    return load_doc(path)["songs"]


def save(path: Path, songs: list[dict[str, Any]], default_music_root: str | None = None) -> None:
    """Replace the songs, keeping stored settings (seeding music_root if absent)."""
    doc = load_doc(path)
    doc["songs"] = songs
    if default_music_root and not doc["settings"].get("music_root"):
        doc["settings"]["music_root"] = default_music_root
    save_doc(path, doc)


def load_hosts() -> dict[str, str]:
    """Server name -> local mount path: AUDIO_HOSTS="a=/p;b=/q" and/or AUDIO_HOSTS_FILE (JSON)."""
    hosts: dict[str, str] = {}
    file = os.environ.get("AUDIO_HOSTS_FILE", "")
    if file:
        with open(file, encoding="utf-8") as f:
            hosts.update({str(k): str(v) for k, v in json.load(f).items()})
    for item in os.environ.get("AUDIO_HOSTS", "").split(";"):
        name, sep, target = item.partition("=")
        if sep and name.strip() and target.strip():
            hosts[name.strip()] = target.strip()
    return hosts


def resolve_music_root(root: str, hosts: dict[str, str] | None = None) -> Path:
    """`<servername>://<path>/` -> local dir via the hosts map; a plain path is used as is."""
    m = _ROOT_RE.match(root)
    if not m:
        return Path(root)
    name, rest = m.groups()
    hosts = load_hosts() if hosts is None else hosts
    if name not in hosts:
        raise LookupError(f"music_root server {name!r} is not configured (AUDIO_HOSTS)")
    return Path(hosts[name]) / rest.strip("/")


def clean_tag(tag: str, song_genres: Iterable[str] = ()) -> str:
    """Trim and collapse spaces; `key:value` is lowercased, a plain tag keeps its case; a half-empty `key:` or `:value` is dropped. `song_genres` are the song's other `genre:` values (the `progressive` rule of TAG-075)."""
    key, sep, value = tag.partition(":")
    key, value = " ".join(key.split()), " ".join(value.split())
    if sep and key and value:
        key, value = key.lower(), value.lower()
        if key == "lang":
            value = langcodes.canonical_lang(value) or value
        elif key == "country":
            value = countrycodes.canonical_country(value) or value
        elif key == "genre":
            if genre_filter.is_dropped(value):
                return ""
            value = " ".join(genre_filter.canonical(value, song_genres).lower().split()) or value
        elif key == "decade" and not _DECADE_RE.match(value):
            value = value.replace(" ", "")
        return f"{key}:{value}"
    if sep:
        return ""
    return " ".join(tag.split())


def unknown_countries(tags: list[str]) -> list[str]:
    """Values of `country:` tags that do not canonicalise to an ISO 3166-1 alpha-2 code (call on cleaned tags)."""
    out = []
    for t in tags:
        key, _, value = str(t).partition(":")
        if key.strip().lower() == "country" and value.strip() and countrycodes.canonical_country(value) is None:
            out.append(" ".join(value.split()))
    return out


def clean_tags(tags: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    extras: list[tuple[str, str | None]] = []
    genres = [" ".join(v.split()) for t in tags for ns, sep, v in [str(t).partition(":")] if sep and ns.strip().lower() == "genre"]
    for raw in tags:
        raw = str(raw)
        ns, sep, val = raw.partition(":")
        if sep and ns.strip().lower() == "genre":
            sp = genre_filter.split_prefix(" ".join(val.split()))
            if sp and not genre_filter.is_dropped(sp[0]):
                extras.append((sp[1], sp[2]))
        t = clean_tag(raw, genres)
        if t and t.casefold() not in seen:
            seen.add(t.casefold())
            out.append(t)
    for country, lang in extras:
        if sum(1 for t in out if t.startswith("country:")) < 2 and f"country:{country}" not in seen:
            seen.add(f"country:{country}")
            out.append(f"country:{country}")
        if lang and not any(t.startswith("lang:") for t in out):
            seen.add(f"lang:{lang}")
            out.append(f"lang:{lang}")
    return out


def tag_counts(songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, dict[str, Any]] = {}
    for s in songs:
        for t in s.get("tags", []):
            e = counts.setdefault(t.casefold(), {"tag": t, "count": 0})
            e["count"] += 1
    return sorted(counts.values(), key=lambda e: e["tag"].casefold())


_BAD_NAME = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]')


def download_name(song: dict[str, Any] | None, video_id: str, limit: int = 120) -> str:
    """`Artist - Title.m4a` for a browser save: no path separators, control chars or quotes; falls back to `<id>.m4a`."""
    parts = [credits.artist_string(song or {}), str((song or {}).get("title") or "")]
    text = " - ".join(p for p in parts if p.strip())
    text = " ".join(_BAD_NAME.sub(" ", text).split()).strip(" .")
    text = text[:limit].strip(" .")
    return f"{text}.m4a" if text else f"{video_id}.m4a"


def content_disposition(name: str) -> str:
    """RFC 6266 attachment header with an ASCII fallback and `filename*` for the real UTF-8 name."""
    import unicodedata
    from urllib.parse import quote

    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().replace("%", "_").replace('"', "_").replace(chr(92), "_")
    stem, _, ext = ascii_name.rpartition(".")
    if not stem.strip(" _-."):
        ascii_name = f"download.{ext or 'm4a'}"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name, safe='')}"
