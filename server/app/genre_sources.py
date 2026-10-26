"""Where each genre of the vocabulary also exists (GEN-066, ADR-0033): ids and titles from `server/data/genre_sources.json`; every link is built here and nowhere else (`genre_source_links`)."""

from __future__ import annotations

import json
import logging
import threading
import urllib.parse
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

SOURCES_FILE = Path(__file__).resolve().parent.parent / "data" / "genre_sources.json"
LINK_ORDER = ("wikipedia", "apple_music", "spotify", "discogs", "rym", "musicbrainz")
RYM_FILE = SOURCES_FILE.with_name("genre_rym.json")
MATCH_KINDS = ("name", "synonym", "manual")

_lock = threading.Lock()
_loaded = False
_data: dict[str, dict[str, Any]] = {}
_meta: dict[str, Any] = {}
_rym: dict[str, str] = {}


def _q(text: str) -> str:
    """Percent-encode for a query value or a path segment: spaces as %20, '&' as %26, '/' as %2F."""
    return urllib.parse.quote(text, safe="")


def _title(text: str) -> str:
    page, _, fragment = text.partition("#")
    out = urllib.parse.quote(page.replace(" ", "_"), safe="_(),!*'~:@$")
    if fragment:
        out += "#" + urllib.parse.quote(fragment.replace(" ", "_"), safe="_(),!*'~:@$")
    return out


def genre_source_links(key: str, sources: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    """The links the infobox shows for a genre, in the fixed order Wikipedia, Apple Music, Spotify, Discogs, MusicBrainz, as `[{source, url, kind}]` with kind `page` (a page of that catalogue) or `search` (a search or filter URL).

    `key` is the genre key (its name); `sources` is `sources_for(key)`. Rules (one source of truth, documented in server/data/README.md):
    wikipedia: the article when matched, else a Wikipedia search for the name (search);
    apple_music: Apple Music has no genre page that resolves, so always the search for the matched Apple name, else for the key (search);
    spotify: always the search `genre:"<key>"` (search; Spotify has no genre catalogue, nothing is stored);
    discogs: the release search filtered by style, or by genre for a family, when the genre is in Discogs; else a plain release search for the name (search);
    rym: only the curated URL of `server/data/genre_rym.json` (Alex supplies them), kind page; none when the genre has no entry;
    musicbrainz: the genre page when matched (page), else none."""
    out: list[dict[str, str]] = []
    wp = sources.get("wikipedia")
    if wp and wp.get("title"):
        out.append({"source": "wikipedia", "url": f"https://en.wikipedia.org/wiki/{_title(wp['title'])}", "kind": "page"})
    else:
        out.append({"source": "wikipedia", "url": f"https://en.wikipedia.org/w/index.php?search={_q(key + ' music genre')}", "kind": "search"})
    am = sources.get("apple_music")
    term = am["name"] if am and am.get("name") else key
    out.append({"source": "apple_music", "url": f"https://music.apple.com/us/search?term={_q(term)}", "kind": "search"})
    spotify_query = 'genre:"' + key + '"'
    out.append({"source": "spotify", "url": "https://open.spotify.com/search/" + _q(spotify_query), "kind": "search"})
    dc = sources.get("discogs")
    if dc:
        param = "genre" if dc.get("family") else "style"
        out.append({"source": "discogs", "url": f"https://www.discogs.com/search/?{param}={_q(dc.get('name') or key)}&type=release", "kind": "search"})
    else:
        out.append({"source": "discogs", "url": f"https://www.discogs.com/search/?q={_q(key)}&type=release", "kind": "search"})
    rym = sources.get("rym")
    if rym and rym.get("url"):
        out.append({"source": "rym", "url": rym["url"], "kind": "page"})
    mb = sources.get("musicbrainz")
    if mb and mb.get("id"):
        out.append({"source": "musicbrainz", "url": f"https://musicbrainz.org/genre/{_q(mb['id'])}", "kind": "page"})
    return out


def _check_spec(key: str, src: str, fields: tuple[str, ...], spec: Any) -> None:
    if spec is None:
        return
    if isinstance(spec, dict) and src == "wikipedia" and spec.get("match") == "manual":
        fields = ("title",)
    if not isinstance(spec, dict) or any(not isinstance(spec.get(f), str) or not spec[f] for f in fields) or spec.get("match") not in MATCH_KINDS:
        raise ValueError(f"genre_sources.json: entry {key!r} {src} needs {', '.join(fields)} and a match of {'/'.join(MATCH_KINDS)}")


def parse(doc: Any) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Validate the file shape: returns (rows per genre key, `_meta`). Raises ValueError naming the bad entry."""
    if not isinstance(doc, dict):
        raise ValueError("genre_sources.json: not an object")
    meta = doc.get("_meta") if isinstance(doc.get("_meta"), dict) else {}
    rows: dict[str, dict[str, Any]] = {}
    for k, v in doc.items():
        if k == "_meta":
            continue
        if not isinstance(v, dict) or not isinstance(v.get("discogs"), (bool, type(None))):
            raise ValueError(f"genre_sources.json: entry {k!r} needs a 'discogs' of true, false or null")
        for src, fields in (("musicbrainz", ("id", "name")), ("wikipedia", ("title", "wikidata")), ("apple_music", ("id", "name"))):
            _check_spec(k, src, fields, v.get(src))
        rows[k] = v
    return rows, meta


def _load() -> None:
    global _loaded, _data, _meta, _rym
    with _lock:
        if _loaded:
            return
        try:
            with open(SOURCES_FILE, encoding="utf-8") as f:
                _data, _meta = parse(json.load(f))
        except FileNotFoundError:
            _data, _meta = {}, {}
        except (OSError, ValueError) as e:
            log.warning("genre sources ignored: %s", e)
            _data, _meta = {}, {}
        _rym = _load_rym()
        _loaded = True


def _load_rym() -> dict[str, str]:
    try:
        with open(RYM_FILE, encoding="utf-8") as f:
            doc = json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        log.warning("genre rym links ignored: %s", e)
        return {}
    if not isinstance(doc, dict):
        return {}
    return {k: v for k, v in doc.items() if isinstance(v, str) and v.startswith("https://rateyourmusic.com/")}


def reset() -> None:
    global _loaded
    with _lock:
        _loaded = False


def meta() -> dict[str, Any]:
    _load()
    return _meta


def stored(name: str) -> dict[str, Any]:
    """The raw stored row of a genre key; empty when the file is missing or the genre is not in it."""
    _load()
    return _data.get(name, {})


def sources_for(name: str, is_family: bool = False) -> dict[str, dict[str, Any]]:
    """The stored ids and titles of the catalogues a genre was matched in (`musicbrainz`, `wikipedia`, `apple_music`) plus `discogs` ({name, family}) when the genre is in Discogs; no URLs; `{}` without the file."""
    row = stored(name)
    out: dict[str, dict[str, Any]] = {}
    if row.get("discogs") is True:
        out["discogs"] = {"name": row.get("discogs_name") or name, "family": is_family}
    if name in _rym:
        out["rym"] = {"url": _rym[name]}
    for src in ("musicbrainz", "wikipedia", "apple_music"):
        spec = row.get(src)
        if isinstance(spec, dict):
            out[src] = dict(spec)
    return out


def payload_fields(name: str, is_family: bool = False) -> dict[str, Any]:
    """The two fields a vocabulary row carries: `sources` (stored ids) and `source_links` (built URLs)."""
    sources = sources_for(name, is_family)
    return {"sources": sources, "source_links": genre_source_links(name, sources)}
