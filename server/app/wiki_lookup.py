"""Wikipedia links and structured facts (genre, country, year) from MusicBrainz relations and Wikidata."""

from __future__ import annotations

import datetime
import html
import json
import logging
import os
import re
import urllib.parse
import urllib.request
from typing import Any

from . import countrycodes, genre_lookup
from .titles import lookup_credits

log = logging.getLogger(__name__)

WIKIDATA = "https://www.wikidata.org"
TIMEOUT = 5
MAX_GENRES = 12

_WP_HOST = re.compile(r"^(?:[a-z0-9-]+\.)+wikipedia\.org$")
_WD_HOST = re.compile(r"^(?:www\.|m\.)?wikidata\.org$")
_QID = re.compile(r"^Q[1-9]\d*$")
_SITE = re.compile(r"^([a-z]{2,3}(?:-[a-z]+)?)wiki$")

_infobox_cache: dict[str, dict[str, Any]] = {}
_entities: dict[str, dict[str, Any] | None] = {}
_claims: dict[str, dict[str, Any]] = {}
_labels: dict[str, str] = {}
_qid_of_page: dict[str, str | None] = {}


def _qid_from_wikidata_url(url: str) -> str | None:
    parts = urllib.parse.urlsplit(url)
    if parts.hostname and _WD_HOST.match(parts.hostname):
        m = re.fullmatch(r"/(?:wiki|entity)/(Q[1-9]\d*)", parts.path)
        return m.group(1) if m else None
    return None


def clean_link(value: Any) -> str | None:
    """A https URL on *.wikipedia.org (/wiki/<title>) or wikidata.org/wiki/Q<id>; anything else is None."""
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        parts = urllib.parse.urlsplit(raw)
        if parts.scheme == "http":
            parts = parts._replace(scheme="https")
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        return None
    if parts.scheme != "https" or port not in (None, 443) or parts.username or parts.password:
        return None
    if _WD_HOST.match(host):
        qid = _qid_from_wikidata_url(raw)
        return f"https://www.wikidata.org/wiki/{qid}" if qid else None
    if _WP_HOST.match(host) and re.fullmatch(r"/wiki/\S+", parts.path):
        return f"https://{host}{parts.path}"
    return None


def qid_of(link: str | None) -> str | None:
    return _qid_from_wikidata_url(link) if link else None


def _fetch_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": os.environ.get("AUDIO_MB_USER_AGENT", genre_lookup.DEFAULT_UA), "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _entity(qid: str) -> dict[str, Any] | None:
    if qid not in _entities:
        try:
            data = _fetch_json(f"{WIKIDATA}/wiki/Special:EntityData/{qid}.json")
            ents = data.get("entities") or {}
            _entities[qid] = ents.get(qid) or next(iter(ents.values()), None)
        except Exception as exc:
            log.warning("wikidata entity %s failed: %s", qid, exc)
            return None
    return _entities[qid]


def _wbget(ids: list[str], props: str) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {"action": "wbgetentities", "ids": "|".join(ids), "props": props, "languages": "en", "format": "json"}
    )
    return (_fetch_json(f"{WIKIDATA}/w/api.php?{query}")).get("entities") or {}


def _label_map(ids: list[str]) -> dict[str, str]:
    todo = [i for i in dict.fromkeys(ids) if i not in _labels]
    if todo:
        try:
            for qid, ent in _wbget(todo, "labels").items():
                label = ((ent.get("labels") or {}).get("en") or {}).get("value")
                if label:
                    _labels[qid] = str(label)
        except Exception as exc:
            log.warning("wikidata labels failed: %s", exc)
    return {i: _labels[i] for i in ids if i in _labels}


def _claims_map(ids: list[str]) -> dict[str, dict[str, Any]]:
    todo = [i for i in dict.fromkeys(ids) if i not in _claims]
    if todo:
        try:
            for qid, ent in _wbget(todo, "claims").items():
                _claims[qid] = ent.get("claims") or {}
        except Exception as exc:
            log.warning("wikidata claims failed: %s", exc)
    return {i: _claims[i] for i in ids if i in _claims}


def _values(claims: dict[str, Any], prop: str) -> list[Any]:
    """Best-rank datavalues of a property (preferred over normal, deprecated dropped)."""
    items = [c for c in claims.get(prop) or [] if c.get("rank") != "deprecated"]
    if any(c.get("rank") == "preferred" for c in items):
        items = [c for c in items if c.get("rank") == "preferred"]
    out = []
    for c in items:
        snak = c.get("mainsnak") or {}
        if snak.get("snaktype") == "value":
            out.append((snak.get("datavalue") or {}).get("value"))
    return [v for v in out if v is not None]


def _ids(claims: dict[str, Any], prop: str) -> list[str]:
    return [str(v["id"]) for v in _values(claims, prop) if isinstance(v, dict) and _QID.match(str(v.get("id", "")))]


def _strings(claims: dict[str, Any], prop: str) -> list[str]:
    return [v for v in _values(claims, prop) if isinstance(v, str)]


def _year(claims: dict[str, Any]) -> int | None:
    years = []
    for v in _values(claims, "P577"):
        m = re.match(r"^\+?(\d{1,4})-", str((v or {}).get("time", ""))) if isinstance(v, dict) else None
        if m and int((v or {}).get("precision") or 0) >= 9:
            years.append(int(m.group(1)))
    return min(years) if years else None


def _country_tags(artist_claims: dict[str, Any], song_claims: dict[str, Any]) -> list[str]:
    countries = _ids(artist_claims, "P495") or _ids(artist_claims, "P27")
    if not countries:
        places = _ids(artist_claims, "P740")
        if places:
            pc = _claims_map(places)
            countries = [c for p in places for c in _ids(pc.get(p, {}), "P17")]
    countries = countries or _ids(song_claims, "P495")
    if not countries:
        return []
    cc = _claims_map(countries[:2])
    for q in countries[:2]:
        for code in _strings(cc.get(q, {}), "P297"):
            known = countrycodes.canonical_country(code) if re.fullmatch(r"[A-Za-z]{2}", code) else None
            if known:
                return [f"country:{known}"]
    return []


def _genre_tags(ids: list[str], labels: dict[str, str]) -> list[str]:
    out: list[str] = []
    for i in ids:
        tag = f"genre:{labels[i].strip().casefold()}" if i in labels else ""
        if tag and tag not in out:
            out.append(tag)
    return out


_REF_PAIR = re.compile(r"<ref\b[^>]*?(?<!/)>.*?</ref\s*>", re.S | re.I)
_REF_SELF = re.compile(r"<ref\b[^>]*/\s*>", re.I)
_COMMENT = re.compile(r"<!--.*?-->", re.S)
_WIKI_PATH = "/wiki/"
_BR = re.compile(r"<br\s*(?:/\s*)?>", re.I)
_TAG = re.compile(r"<[^>]+>")
_LINK = re.compile(r"\[\[([^\[\]|]*)(?:\|([^\[\]]*))?\]\]")
_INNER_TPL = re.compile(r"\{\{([^{}]*)\}\}")
_FOOTNOTE = re.compile(r"\[(?:\d+|note\s*\d+|[a-z])\]", re.I)
_LIST_TPLS = {"hlist", "flatlist", "plainlist", "ubl", "unbulleted list", "bulleted list", "ulist", "collapsible list"}
_UNWRAP_TPLS = {"nowrap", "small", "nobr", "lang"}


def _link_text(m: re.Match[str]) -> str:
    target, text = m.group(1).strip(), m.group(2)
    if re.match(r"(?:file|image|category):", target, re.I):
        return ""
    return (text if text is not None else target).strip()


def _template(m: re.Match[str]) -> str:
    parts = m.group(1).split("|")
    name = parts[0].strip().casefold().replace("_", " ")
    args = [a for a in parts[1:] if not re.match(r"\s*\w[\w ]*=", a)]
    if name in _LIST_TPLS:
        return "\n" + "\n".join(args) + "\n"
    if name in _UNWRAP_TPLS:
        return args[-1] if args else ""
    return ""


def _split_top(body: str) -> list[str]:
    parts: list[str] = []
    depth, cur, i = 0, [], 0
    while i < len(body):
        two = body[i : i + 2]
        if two in ("{{", "[["):
            depth += 1
            cur.append(two)
            i += 2
        elif two in ("}}", "]]"):
            depth -= 1
            cur.append(two)
            i += 2
        elif body[i] == "|" and depth == 0:
            parts.append("".join(cur))
            cur = []
            i += 1
        else:
            cur.append(body[i])
            i += 1
    parts.append("".join(cur))
    return parts


def _infobox_body(wikitext: str) -> str | None:
    m = re.search(r"\{\{\s*infobox\b", wikitext, re.I)
    if not m:
        return None
    depth, i = 0, m.start()
    while i < len(wikitext):
        two = wikitext[i : i + 2]
        if two == "{{":
            depth += 1
            i += 2
        elif two == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return wikitext[m.start() + 2 : i - 2]
        else:
            i += 1
    return None


def _clean_lines(value: str) -> list[str]:
    value = _COMMENT.sub("", value)
    value = _REF_PAIR.sub("", value)
    value = _REF_SELF.sub("", value)
    value = _LINK.sub(_link_text, value)
    for _ in range(10):
        value, n = _INNER_TPL.subn(_template, value)
        if not n:
            break
    value = value.replace("{{", "").replace("}}", "")
    value = _TAG.sub("\n", _BR.sub("\n", value))
    out = []
    for line in value.split("\n"):
        line = html.unescape(line.strip().lstrip("*#:;").strip()).replace("\xa0", " ")
        line = _FOOTNOTE.sub("", line).replace("'" * 3, "").replace("''", "")
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            out.append(line)
    return out


def _clean_genre_value(value: str) -> list[str]:
    out: list[str] = []
    for line in _clean_lines(value):
        for item in line.split(","):
            item = item.strip(" .;").casefold()
            if item and item not in out:
                out.append(item)
    return out[:MAX_GENRES]


def _clean_text(value: str) -> str | None:
    lines = _clean_lines(value)
    return (lines[0].strip(' "\u201c\u201d;') or None) if lines else None


def _clean_artist(value: str) -> str | None:
    names: list[str] = []
    value = re.sub(r"\[\[[^\[\]]*\]\]", lambda m: m.group(0).replace(",", "\x00"), value)
    for line in _clean_lines(value):
        for part in line.split(","):
            part = part.replace("\x00", ",")
            name = part.strip(' "\u201c\u201d;.')
            if name[:4].casefold() == "the " and name[0] == "t":
                name = "T" + name[1:]
            if name and name not in names:
                names.append(name)
    return ", ".join(names) or None


_DATE_TPLS = ("start date", "start date and age", "release date", "release date and age", "film date", "start-date")
_YEAR = re.compile(r"(?<!\d)(\d{4})(?!\d)")


def _in_range(year: int) -> bool:
    return 1900 <= year <= datetime.date.today().year + 1


def _clean_year(value: str) -> int | None:
    value = _REF_SELF.sub("", _REF_PAIR.sub("", _COMMENT.sub("", value)))
    for m in re.finditer(r"\{\{([^{}]*)\}\}", value):
        parts = m.group(1).split("|")
        if parts[0].strip().casefold().replace("_", " ") in _DATE_TPLS:
            args = [a.strip() for a in parts[1:] if "=" not in a]
            if args and re.fullmatch(r"\d{4}", args[0]) and _in_range(int(args[0])):
                return int(args[0])
    for line in _clean_lines(value):
        for m in _YEAR.finditer(line):
            if _in_range(int(m.group(1))):
                return int(m.group(1))
    return None


def _empty_infobox() -> dict[str, Any]:
    return {"genres": [], "album": None, "year": None, "type": None, "name": None, "artist": None}


def parse_infobox(wikitext: str) -> dict[str, Any]:
    """{genres, album, year, type, name, artist} from the first {{Infobox ...}}; empty values when absent or malformed.

    `album` is the infobox `album` parameter only (a standalone single has none, so it stays None)."""
    out = _empty_infobox()
    try:
        body = _infobox_body(wikitext or "")
        if body is None:
            return out
        seen: set[str] = set()
        for part in _split_top(body)[1:]:
            key, eq, value = part.partition("=")
            key = key.strip().casefold()
            if not eq or key in seen:
                continue
            if key in ("genre", "genres") and not out["genres"]:
                out["genres"] = _clean_genre_value(value)
            elif key == "album":
                out["album"] = _clean_text(value)
            elif key in ("released", "release"):
                out["year"] = _clean_year(value)
            elif key == "artist":
                out[key] = _clean_artist(value)
            elif key in ("type", "name"):
                out[key] = _clean_text(value)
            else:
                continue
            seen.add(key)
    except Exception as exc:
        log.warning("infobox parse failed: %s", exc)
        return _empty_infobox()
    return out


def parse_infobox_genres(wikitext: str) -> list[str]:
    """Lowercase genre names from the `genre`/`genres` parameter of the first {{Infobox ...}}; [] when absent or malformed."""
    return parse_infobox(wikitext)["genres"]


def infobox(page_url: str | None) -> dict[str, Any]:
    """Infobox facts of an en.wikipedia.org article (lead section wikitext); empty on any failure or other hosts."""
    try:
        parts = urllib.parse.urlsplit(page_url or "")
        if (parts.hostname or "").lower() != "en.wikipedia.org" or not parts.path.startswith(_WIKI_PATH):
            return _empty_infobox()
        title = urllib.parse.unquote(parts.path[len(_WIKI_PATH) :])
        if title not in _infobox_cache:
            api = (
                "https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&section=0&format=json&formatversion=2&redirects=1&page="
                + urllib.parse.quote(title, safe="")
            )
            text = (_fetch_json(api).get("parse") or {}).get("wikitext") or ""
            _infobox_cache[title] = parse_infobox(text if isinstance(text, str) else "")
        return {**_infobox_cache[title], "genres": list(_infobox_cache[title]["genres"])}
    except Exception as exc:
        log.warning("infobox fetch failed: %s", exc)
        return _empty_infobox()


def infobox_genres(page_url: str | None) -> list[str]:
    return infobox(page_url)["genres"]


def _norm(tag: str) -> str:
    return re.sub(r"\s+", " ", tag.partition(":")[2] or tag).strip().casefold()


def _with_infobox(found: dict[str, Any], song_page: str | None, artist_page: str | None) -> None:
    """Record the song page's infobox album and year; put its genres (else the artist page's) first in `song_genres` and `tags`, deduplicated against Wikidata's."""
    song_box = infobox(song_page)
    found["infobox_album"], found["infobox_year"] = song_box["album"], song_box["year"]
    has_both = bool(song_box["name"] and song_box["artist"])
    found["infobox_suggest"] = {"artist": song_box["artist"], "title": song_box["name"]} if has_both else None
    box = song_box["genres"] or infobox_genres(artist_page)
    if not box:
        return
    first = [f"genre:{g}" for g in box]
    seen = {_norm(t) for t in first}
    song = [*first, *(t for t in found["song_genres"] if _norm(t) not in seen)]
    in_song = {_norm(t) for t in song}
    found["tags"] = [*song, *(t for t in found["tags"] if not t.startswith("genre:") or _norm(t) not in in_song)]
    found["song_genres"] = song


def facts(song_qid: str | None, artist_qid: str | None) -> dict[str, Any]:
    """Tag suggestions and the song's publication year from Wikidata; empty on any failure.

    `song_genres` are the song entity's own genres (all of them); `tags` are those, then the artist's, then the country."""
    result: dict[str, Any] = {"tags": [], "song_genres": [], "year": None}
    try:
        song = (_entity(song_qid) or {}).get("claims") or {} if song_qid else {}
        artist = (_entity(artist_qid) or {}).get("claims") or {} if artist_qid else {}
        song_ids = list(dict.fromkeys(_ids(song, "P136")))[:MAX_GENRES]
        artist_ids = [i for i in dict.fromkeys(_ids(artist, "P136")) if i not in song_ids][:MAX_GENRES]
        all_ids = [*song_ids, *artist_ids]
        labels = _label_map(all_ids) if all_ids else {}
        song_genres = _genre_tags(song_ids, labels)
        artist_genres = [t for t in _genre_tags(artist_ids, labels) if t not in song_genres]
        result["song_genres"] = song_genres
        result["tags"] = [*song_genres, *artist_genres, *_country_tags(artist, song)]
        result["year"] = _year(song)
    except Exception as exc:
        log.warning("wikidata facts failed: %s", exc)
    return result


def sitelink(qid: str) -> str | None:
    """English Wikipedia article of a Wikidata item, else any other-language Wikipedia article."""
    ent = _entity(qid)
    links = (ent or {}).get("sitelinks") or {}
    keys = ["enwiki"] + [k for k in links if k != "enwiki" and _SITE.match(k)]
    for key in keys:
        link = links.get(key)
        if not link:
            continue
        url = link.get("url")
        if not url and link.get("title") and _SITE.match(key):
            lang = _SITE.match(key).group(1).replace("_", "-")
            url = f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(str(link['title']).replace(' ', '_'))}"
        url = clean_link(url)
        if url:
            return url
    return None


def qid_of_page(url: str) -> str | None:
    """Wikidata id of a Wikipedia article URL (pageprops API); None on any failure."""
    url = clean_link(url) or ""
    if not url:
        return None
    direct = qid_of(url)
    if direct:
        return direct
    if url not in _qid_of_page:
        try:
            parts = urllib.parse.urlsplit(url)
            title = urllib.parse.unquote(parts.path[len(_WIKI_PATH) :]).replace("_", " ")
            query = urllib.parse.urlencode(
                {"action": "query", "prop": "pageprops", "ppprop": "wikibase_item", "titles": title, "redirects": "1", "format": "json"}
            )
            pages = ((_fetch_json(f"https://{parts.hostname}/w/api.php?{query}")).get("query") or {}).get("pages") or {}
            qid = next((p["pageprops"]["wikibase_item"] for p in pages.values() if (p.get("pageprops") or {}).get("wikibase_item")), None)
            _qid_of_page[url] = qid if qid and _QID.match(qid) else None
        except Exception as exc:
            log.warning("pageprops lookup failed for %s: %s", url, exc)
            return None
    return _qid_of_page[url]


def _pick(rels: list[str]) -> tuple[str | None, str | None]:
    """(Wikipedia URL, Wikidata id) from MusicBrainz URL relations; English Wikipedia preferred; Wikidata resolved to a sitelink."""
    wp = [u for u in (clean_link(r) for r in rels) if u and not qid_of(u)]
    wp.sort(key=lambda u: not urllib.parse.urlsplit(u).hostname.startswith("en."))
    qid = next((q for q in (qid_of(clean_link(r)) for r in rels) if q), None)
    link = wp[0] if wp else None
    if not link and qid:
        link = sitelink(qid) or f"https://www.wikidata.org/wiki/{qid}"
    return link, qid


def suggest(artist: str, title: str) -> dict[str, Any]:
    """{wikipedia_song, wikipedia_artist, tags, year} for a track via MusicBrainz + Wikidata; empty values on any failure."""
    out: dict[str, Any] = {"wikipedia_song": None, "wikipedia_artist": None, "tags": [], "song_genres": [], "year": None, "infobox_album": None, "infobox_year": None, "infobox_suggest": None}
    if not genre_lookup.enabled():
        return out
    try:
        mb = genre_lookup.lookup(artist, title)
        out["year"] = mb["year"]
        song_link, song_q = _pick(mb["song_rels"])
        artist_link, artist_q = _pick(mb["artist_rels"])
        out["wikipedia_song"], out["wikipedia_artist"] = song_link, artist_link
        box_artist = infobox(song_link)["artist"] if song_link else None
        if box_artist and not genre_lookup._artist_match(lookup_credits(artist)[0], box_artist):
            song_link, song_q = None, None
            out["wikipedia_song"] = None
        song_q = song_q or qid_of_page(song_link or "")
        artist_q = artist_q or qid_of_page(artist_link or "")
        found = facts(song_q, artist_q)
        out["tags"] = found["tags"]
        out["song_genres"] = found["song_genres"]
        out["year"] = found["year"] or mb["year"]
        _with_infobox(out, song_link, artist_link)
    except Exception as exc:
        log.warning("wikipedia suggestion failed for %r - %r: %s", artist, title, exc)
    return out


def _page_url(url: str | None) -> str | None:
    """A Wikipedia page for a cleaned link; a Wikidata link becomes its sitelink, else stays the Wikidata URL."""
    qid = qid_of(url)
    return (sitelink(qid) or url) if qid else url


def from_links(song_link: Any, artist_link: Any) -> dict[str, Any]:
    """Tags, year and page URLs (`wikipedia_song`, `wikipedia_artist`) for user-edited Wikipedia/Wikidata links; empty when disabled or on any failure."""
    out: dict[str, Any] = {"tags": [], "song_genres": [], "year": None, "infobox_album": None, "infobox_year": None, "infobox_suggest": None, "wikipedia_song": None, "wikipedia_artist": None}
    if not genre_lookup.enabled():
        return out
    try:
        song_url, artist_url = clean_link(song_link), clean_link(artist_link)
        song_q, artist_q = qid_of_page(song_url or ""), qid_of_page(artist_url or "")
        out.update(facts(song_q, artist_q))
        out["wikipedia_song"] = _page_url(song_url)
        out["wikipedia_artist"] = _page_url(artist_url)
        _with_infobox(out, out["wikipedia_song"], out["wikipedia_artist"])
        return out
    except Exception as exc:
        log.warning("wikipedia link lookup failed: %s", exc)
        return out
