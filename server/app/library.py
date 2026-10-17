"""library.json store: {settings:{music_root}, songs:[...]}, atomic replace on write."""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections import Counter
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from . import countrycodes, credits, discogs_lookup, genre_filter, genre_lookup, langcodes, urlclean, wiki_lookup
from .jsonio import write_json_atomic
from .tags import namespace, namespaced_values
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
    """Stored sources `{platform, url}`; the older `{source, id, url}` entries are accepted (`source` is the platform, the id is derived again on output)."""
    out: list[dict[str, Any]] = []
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict):
            continue
        platform = e.get("platform") if isinstance(e.get("platform"), str) and e.get("platform") else e.get("source")
        if not isinstance(platform, str) or not platform:
            continue
        url = urlclean.clean_url(e["url"]) if isinstance(e.get("url"), str) else None
        out.append({"platform": platform, "url": url})
    return out


def _source_id(platform: str, url: str | None, song_id: str) -> str | None:
    if platform == urlclean.source_of(song_id):
        return song_id
    if not url:
        return None
    if platform == "youtube":
        return urlclean.parse_video_id(url)
    return url.split("soundcloud.com/", 1)[1] if "soundcloud.com/" in url else None


def sources_of(song: dict[str, Any]) -> list[dict[str, Any]]:
    """The sources of a song as `{platform, url, source, id}` (`source` and `id` are the legacy keys iOS decodes); the single source derived from the id and `source_url` for old records."""
    sid = str(song.get("id", ""))
    stored = clean_sources(song.get("sources")) if isinstance(song.get("sources"), list) else []
    if not stored:
        stored = [{"platform": urlclean.source_of(sid), "url": song.get("source_url")}]
    return [{"platform": e["platform"], "url": e["url"], "source": e["platform"], "id": _source_id(e["platform"], e["url"], sid)} for e in stored]


def audio_state(song: dict[str, Any], root: Path | None) -> str:
    """`server` when the audio file is on the server, else `none`; never stored. `phone` is client-side.

    `root` None (music_root server not configured) trusts the record's `file`."""
    if not has_file(song):
        return "none"
    if root is None:
        return "server"
    return "server" if (root / file_name(song)).is_file() else "none"


def genre_names(tags: Iterable[Any]) -> list[str]:
    """The bare genre names of the stored `genre:` tags."""
    return list(dict.fromkeys(v.strip() for v in namespaced_values(tags, "genre") if v.strip()))


def tag_list(song: dict[str, Any]) -> list[str]:
    """All tags of a song in the working form: `genre:<name>` for each stored bare genre, then the other stored tags (a loaded song already has them merged in `tags`)."""
    genres = [f"genre:{g}" for g in song.get("genres") or [] if isinstance(g, str) and g.strip()]
    return [*genres, *(str(t) for t in song.get("tags") or [])]


def merge_genres(genres: Iterable[Any] | None, tags: Iterable[Any] | None) -> list[str]:
    """Cleaned working tags from a request: bare `genres` become `genre:` tags and join the sent `tags`."""
    return clean_tags([*(f"genre:{g}" for g in genres or [] if isinstance(g, str) and g.strip()), *(tags or [])])


def stored_song(song: dict[str, Any]) -> dict[str, Any]:
    """The file form of a working song (data model v2): genres bare in `genres`, only the other tags left in `tags`; the working song is not changed."""
    if "tags" not in song and "genres" not in song:
        return song
    full = tag_list(song)
    genres = genre_names(full)
    rest = [t for t in full if namespace(t) != "genre"]
    out: dict[str, Any] = {}
    for k, v in song.items():
        if k == "tags":
            out["genres"] = genres
            if rest:
                out["tags"] = rest
        elif k != "genres":
            out[k] = v
    if "genres" not in out:
        out["genres"] = genres
        if rest:
            out["tags"] = rest
    return out


def view_tags(song: dict[str, Any]) -> list[str]:
    """The legacy `tags` view of a v2 song: its stored tags (countries included) and `decade:NNs` computed from the displayed year."""
    kept = drop_derived_tags(tag_list(song))
    decade = decade_tag(credits.display_year(song))
    return [*(t for t in kept if namespace(t) != "country"), *([decade] if decade else []), *(t for t in kept if namespace(t) == "country")]


def public_song(song: dict[str, Any], root: Path | None) -> dict[str, Any]:
    """The record plus derived, additive fields: the legacy `artist`, `remixer`, `year`, `remix_year`, `album` and `tags` view, `genres`, `audio_state`, `sources`, and `audio` when a file exists."""
    out = dict(song)
    credits.ensure(out)
    out.update(credits.project(out))
    out.pop("raw", None)
    out["tags"], out["genres"] = view_tags(out), genre_names(tag_list(out))
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
    stored = s.pop("genres", None)
    tags = [*(f"genre:{g}" for g in stored if isinstance(g, str)), *(s.get("tags") or [])] if isinstance(stored, list) else list(s.get("tags") or [])
    if isinstance(genre, str) and genre.strip():
        tags.append(f"genre:{genre}")
    if "tags" in s or genre or isinstance(stored, list):
        s["tags"] = clean_tags(tags)


def split_tags(tags: Iterable[Any]) -> tuple[list[str], list[str], Counter[str]]:
    """`(kept, countries, removed)`: the tags without `decade:`, `lang:` and `country:` values (data model v2), the canonical country codes found, and a count of the removed tags per prefix."""
    kept: list[str] = []
    countries: list[str] = []
    removed: Counter[str] = Counter()
    for tag in tags:
        ns = namespace(tag)
        if ns not in ("decade", "lang", "country"):
            kept.append(str(tag))
            continue
        removed[ns] += 1
        if ns == "country":
            code = countrycodes.canonical_country(str(tag).partition(":")[2])
            if code and code not in countries:
                countries.append(code)
    return kept, countries, removed


def drop_derived_tags(tags: Iterable[Any]) -> list[str]:
    """The tags without `decade:` (computed at runtime) and `lang:` (discarded) values; `country:` tags stay on the song (ADR-0031)."""
    return [str(t) for t in tags if namespace(t) not in ("decade", "lang")]


def strip_derived(song: dict[str, Any]) -> None:
    if "tags" in song:
        song["tags"] = drop_derived_tags(song["tags"] or [])


def normalize(raw: Any) -> dict[str, Any]:
    """Accept the old bare {songs:[...]} shape and return {settings, songs}; an `artists` table that the model-3 migration has not removed yet is carried along untouched."""
    if isinstance(raw, list):
        raw = {"songs": raw}
    raw = raw if isinstance(raw, dict) else {}
    settings = dict(raw.get("settings") or {})
    songs = [normalize_song(s) for s in raw.get("songs") or []]
    for song in songs:
        strip_derived(song)
    doc: dict[str, Any] = {"settings": settings, "songs": songs}
    if "artists" in raw:
        doc["artists"] = raw["artists"]
    return doc


def decade_tag(year: Any) -> str | None:
    """`decade:90s` for every year from 1950 up to max_year(), else None; computed at runtime, never stored."""
    if isinstance(year, bool) or not isinstance(year, int) or not DECADE_MIN <= year <= max_year():
        return None
    return f"decade:{year // 10 * 10 % 100:02d}s"


def load_doc(path: Path) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as f:
            return normalize(json.load(f))
    except FileNotFoundError:
        return normalize({})


def save_doc(path: Path, doc: dict[str, Any]) -> None:
    songs = doc.get("songs") or []
    for song in songs:
        credits.absorb(song)
        strip_derived(song)
    settings = {**(doc.get("settings") or {}), "credits_schema": credits.SCHEMA if "artists" not in doc else settings_schema(doc)}
    out: dict[str, Any] = {"settings": settings, "songs": [stored_song(s) for s in songs]}
    if "artists" in doc:
        out["artists"] = doc["artists"]
    write_json_atomic(path, out)


def settings_schema(doc: dict[str, Any]) -> Any:
    """The stamp of a library that still holds the model-2 Artist table stays what it was, so the model-3 migration still runs on it."""
    return (doc.get("settings") or {}).get("credits_schema", 2)


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
