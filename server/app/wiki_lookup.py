"""Wikipedia links and structured facts (genre, country, year) from MusicBrainz relations and Wikidata."""

from __future__ import annotations

import html
import logging
import re
import time
import urllib.parse
import urllib.request
from typing import Any

from . import countrycodes, genre_lookup, httpjson, timeutil
from .titles import artist_candidates

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
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    headers = {"User-Agent": WIKIMEDIA_UA} if _WIKIMEDIA_HOST.search(host) else None
    return httpjson.http_json(url, TIMEOUT, headers=headers)


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
    years = [y for y in years if timeutil.valid_year(y)]
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
    return timeutil.valid_year(year) is not None


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
    return {"genres": [], "album": None, "year": None, "type": None, "name": None, "artist": None, "kind": None}


def _apply_param(out: dict[str, Any], key: str, value: str) -> bool:
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
        return False
    return True


def parse_infobox(wikitext: str) -> dict[str, Any]:
    """{genres, album, year, type, name, artist, kind} from the first {{Infobox ...}}; empty values when absent or malformed.

    `album` is the infobox `album` parameter only (a standalone single has none, so it stays None)."""
    out = _empty_infobox()
    try:
        body = _infobox_body(wikitext or "")
        if body is None:
            return out
        out["kind"] = re.sub(r"\s+", " ", re.sub(r"^\s*infobox\b", "", _split_top(body)[0], flags=re.I).replace("_", " ")).strip().casefold() or None
        seen: set[str] = set()
        for part in _split_top(body)[1:]:
            key, eq, value = part.partition("=")
            key = key.strip().casefold()
            if not eq or key in seen:
                continue
            if _apply_param(out, key, value):
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
    """Record the song page's infobox album and year; put its genres first in `song_genres` and `tags`, deduplicated against Wikidata's. The artist page's infobox genres are artist evidence (`artist_genres`), read only when the song page has no infobox genres, and never become the song's own (TAG-102)."""
    song_box = infobox(song_page)
    found["infobox_album"], found["infobox_year"] = song_box["album"], song_box["year"]
    has_both = bool(song_box["name"] and song_box["artist"])
    found["infobox_suggest"] = {"artist": song_box["artist"], "title": song_box["name"]} if has_both else None
    song_first = [f"genre:{g}" for g in song_box["genres"]]
    artist_first = [] if song_first else [f"genre:{g}" for g in infobox_genres(artist_page)]
    if not song_first and not artist_first:
        return
    seen = {_norm(t) for t in song_first}
    song = [*song_first, *(t for t in found["song_genres"] if _norm(t) not in seen)]
    seen_artist = {_norm(t) for t in artist_first}
    artist = [*artist_first, *(t for t in found.get("artist_genres", []) if _norm(t) not in seen_artist)]
    in_song = {_norm(t) for t in [*song, *artist_first]}
    found["tags"] = [*song, *artist_first, *(t for t in found["tags"] if not t.startswith("genre:") or _norm(t) not in in_song)]
    found["song_genres"] = song
    found["artist_genres"] = artist


def facts(song_qid: str | None, artist_qid: str | None) -> dict[str, Any]:
    """Tag suggestions and the song's publication year from Wikidata; empty on any failure.

    `song_genres` are the song entity's own genres (all of them); `artist_genres` are the artist entity's (all of them, also those the song lists too: the song page and the artist page are separate source groups, TAG-100); `tags` are the song's, then the artist's not already listed, then the country."""
    result: dict[str, Any] = {"tags": [], "song_genres": [], "artist_genres": [], "year": None}
    try:
        song = (_entity(song_qid) or {}).get("claims") or {} if song_qid else {}
        artist = (_entity(artist_qid) or {}).get("claims") or {} if artist_qid else {}
        song_ids = list(dict.fromkeys(_ids(song, "P136")))[:MAX_GENRES]
        artist_ids = [i for i in dict.fromkeys(_ids(artist, "P136")) if i not in song_ids][:MAX_GENRES]
        artist_all = list(dict.fromkeys(_ids(artist, "P136")))[:MAX_GENRES]
        all_ids = list(dict.fromkeys([*song_ids, *artist_ids, *artist_all]))
        labels = _label_map(all_ids) if all_ids else {}
        song_genres = _genre_tags(song_ids, labels)
        artist_genres = [t for t in _genre_tags(artist_ids, labels) if t not in song_genres]
        result["song_genres"] = song_genres
        result["artist_genres"] = _genre_tags(artist_all, labels)
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


_search_cache: dict[str, list[str]] = {}
MAX_CANDIDATES = 3


def _search_raw(query: str, lang: str = "en") -> list[str]:
    key = query if lang == "en" else f"{lang}:{query}"
    if key not in _search_cache:
        api = urllib.parse.urlencode({"action": "query", "list": "search", "srsearch": query, "srnamespace": "0", "srlimit": "5", "format": "json"})
        hits = ((_fetch_json(f"https://{lang}.wikipedia.org/w/api.php?{api}")).get("query") or {}).get("search") or []
        _search_cache[key] = [str(h["title"]) for h in hits if h.get("title")]
    return _search_cache[key]


def _search(query: str) -> list[str]:
    """Titles of the top English Wikipedia article hits for `query`; [] on any failure."""
    try:
        return _search_raw(query)
    except Exception as exc:
        log.warning("wikipedia search failed for %r: %s", query, exc)
        return []


def _article_url(title: str, lang: str = "en") -> str:
    return f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"), safe="_(),!'~*-.:")


_CYRILLIC = re.compile("[\u0400-\u04ff]")
_UK_ONLY = re.compile("[їєіґЇЄІҐ]")
_BE_ONLY = re.compile("[ўЎ]")
_QUOTE_CHARS = "\"'`«»„“”‟‘’‚‹›"
_QUOTES = re.compile(f"[{re.escape(_QUOTE_CHARS)}]")
_DESCRIPTOR = re.compile(
    rf"^(?:вокально-инструментальный\s+ансамбль|ансамбль|виа|рок-группа|группа|гурт)(?:\s+|(?=[{re.escape(_QUOTE_CHARS)}]))(?P<quote>[{re.escape(_QUOTE_CHARS)}])?\s*",
    re.I,
)


def _strip_bracket_tail(text: str) -> str:
    end = len(text.rstrip())
    if not end or text[end - 1] not in ")]":
        return text
    closer = end - 1
    seg = max(text.rfind(")", 0, closer), text.rfind("]", 0, closer)) + 1
    openers = [i for i in (text.find("(", seg, closer), text.find("[", seg, closer)) if i >= 0]
    if not openers:
        return text
    start = min(openers)
    while start > 0 and text[start - 1].isspace():
        start -= 1
    return text[:start]


_ALBUM_RU = "альбом"
_WORK_SUFFIX = {
    "ru": {"artist": "группа", "song": "песня", "album": _ALBUM_RU},
    "uk": {"artist": "гурт", "song": "пісня", "album": _ALBUM_RU},
    "be": {"artist": "гурт", "song": "песня", "album": _ALBUM_RU},
}
_DISAMBIGUATION = "Q4167410"
_GROUP_CLASSES = {"Q215380", "Q2088357", "Q5741069"}
_MUSIC_OCCUPATIONS = {"Q177220", "Q639669", "Q488205", "Q36834", "Q753110", "Q855091", "Q130857", "Q2252262", "Q183945"}
_WORK_CLASSES = {"Q7366", "Q134556", "Q482994", "Q208569", "Q169930", "Q105543609", "Q2188189"}
_foreign_cache: dict[str, str | None] = {}


def _wiki_langs(text: str) -> list[str]:
    """Wikipedia language editions to search for a name written in Cyrillic, best first; [] for any other script."""
    if not _CYRILLIC.search(text):
        return []
    if _BE_ONLY.search(text):
        return ["be", "ru"]
    if _UK_ONLY.search(text):
        return ["uk", "ru"]
    return ["ru", "uk"]


def _wiki_names(name: str, kind: str) -> list[str]:
    """Query forms of a non-Latin name: quotes removed and whitespace collapsed; for artists also without a leading descriptor word (group, VIA, ensemble); for songs and albums also without a trailing bracket."""
    def tidy(text: str) -> str:
        return re.sub(r"\s+", " ", _QUOTES.sub(" ", text)).strip()

    plain = tidy(name)
    variants = [plain]
    if kind == "artist":
        m = _DESCRIPTOR.match(name.strip())
        stripped = tidy(name.strip()[m.end() :]) if m else ""
        if stripped:
            variants = [stripped, plain] if m.group("quote") else [plain, stripped]
    else:
        variants.append(tidy(_strip_bracket_tail(name)))
    return list(dict.fromkeys(v for v in variants if v))


def _wiki_pages(lang: str, titles: list[str]) -> list[tuple[str, str]]:
    """(resolved title, Wikidata id) of the existing pages among `titles`, in the order given, redirects followed."""
    query = urllib.parse.urlencode(
        {"action": "query", "prop": "pageprops", "ppprop": "wikibase_item", "titles": "|".join(titles), "redirects": "1", "format": "json", "formatversion": "2"}
    )
    data = (_fetch_json(f"https://{lang}.wikipedia.org/w/api.php?{query}")).get("query") or {}
    alias = {r["from"]: r["to"] for key in ("normalized", "redirects") for r in data.get(key) or []}
    pages = {p["title"]: p for p in data.get("pages") or [] if p.get("title") and not p.get("missing") and not p.get("invalid")}
    out: list[tuple[str, str]] = []
    for title in titles:
        resolved = alias.get(alias.get(title, title), alias.get(title, title))
        qid = ((pages.get(resolved) or {}).get("pageprops") or {}).get("wikibase_item")
        if qid and _QID.match(str(qid)) and not any(resolved == t for t, _ in out):
            out.append((resolved, str(qid)))
    return out


def _wd_claims(qid: str) -> dict[str, Any]:
    got = _claims_map([qid])
    if qid not in got:
        raise RuntimeError(f"claims of {qid} unavailable")
    return got[qid]


def _is_music_artist(claims: dict[str, Any]) -> bool:
    classes = set(_ids(claims, "P31"))
    if _DISAMBIGUATION in classes:
        return False
    if classes & _GROUP_CLASSES or claims.get("P434") or claims.get("P264"):
        return True
    if "Q5" in classes:
        return bool(set(_ids(claims, "P106")) & _MUSIC_OCCUPATIONS)
    return bool(claims.get("P136"))


def _is_music_work(claims: dict[str, Any]) -> bool:
    classes = set(_ids(claims, "P31"))
    if _DISAMBIGUATION in classes:
        return False
    return bool(classes & _WORK_CLASSES or claims.get("P175") or claims.get("P435") or claims.get("P436"))


def _lead_text(lang: str, title: str) -> str:
    query = urllib.parse.urlencode(
        {"action": "query", "prop": "extracts", "exintro": "1", "explaintext": "1", "titles": title, "redirects": "1", "format": "json", "formatversion": "2"}
    )
    pages = ((_fetch_json(f"https://{lang}.wikipedia.org/w/api.php?{query}")).get("query") or {}).get("pages") or []
    return " ".join(str(p.get("extract") or "") for p in pages)


def _foreign_page(lang: str, kind: str, name: str, rest: str, credited: list[str]) -> str | None:
    wanted = genre_lookup._norm(name)
    suffix = _WORK_SUFFIX[lang][kind]
    direct = [f"{name} ({suffix})", name]
    search_q = f"{name} {rest}".strip()
    if kind == "artist":
        hits = [t for t in _search_raw(search_q, lang) if genre_lookup._norm(_strip_bracket_tail(t)) == wanted]
    else:
        hits = [t for t in _search_raw(search_q, lang) if genre_lookup._norm(t).startswith(wanted)]
    titles = list(dict.fromkeys([*direct, *hits[: MAX_CANDIDATES + 2]]))
    for title, qid in _wiki_pages(lang, titles):
        claims = _wd_claims(qid)
        if not (_is_music_artist(claims) if kind == "artist" else _is_music_work(claims)):
            continue
        if kind != "artist":
            lead = _lead_text(lang, title)
            if not any(genre_lookup._norm(c) and genre_lookup._norm(c) in genre_lookup._norm(lead) for c in credited):
                continue
        return clean_link(_article_url(title, lang))
    return None


def _find_foreign(kind: str, name: str, rest: str, credited: list[str]) -> str | None:
    """Article of a non-English edition (Russian, Ukrainian, Belarusian) for a Cyrillic artist, song or album name; None for other scripts.

    A page qualifies only when its Wikidata item is a music artist (group class, MusicBrainz id, label or genre; or a person with a music occupation) or a music work (song, single or album class or a performer), so a generic article of the same title never wins; songs and albums must also name a credited artist in the lead."""
    langs = _wiki_langs(name)
    if not langs:
        return None
    key = "\0".join([kind, name, rest, *credited])
    if key not in _foreign_cache:
        try:
            _foreign_cache[key] = next(
                (url for lang in langs for n in _wiki_names(name, kind) if (url := _foreign_page(lang, kind, n, rest, credited))),
                None,
            )
        except Exception as exc:
            log.warning("wikipedia %s lookup in %s failed for %r: %s", kind, "/".join(langs), name, exc)
            return None
    return _foreign_cache[key]


def _loose(a: str, b: str) -> bool:
    return genre_lookup._artist_match(a, b)


def _find_article(query: str, name: str, kinds: tuple[str, ...], credited: list[str]) -> str | None:
    """The first search hit starting with `name` whose infobox is of one of `kinds` (a substring of its template name), named `name`, and, when `credited` is given, credited to one of those artists.

    Disambiguation pages and pages without an infobox never qualify."""
    wanted = genre_lookup._norm(name)
    if not wanted:
        return None
    hits = [t for t in _search(query) if genre_lookup._norm(t).startswith(wanted)][:MAX_CANDIDATES]
    for title in hits:
        url = _article_url(title)
        box = infobox(url)
        if not box["kind"] or not any(k in box["kind"] for k in kinds):
            continue
        if box["name"] and not _loose(name, box["name"]):
            continue
        if credited and not (box["artist"] and any(_loose(c, box["artist"]) for c in credited)):
            continue
        return url
    return None


def find_song(title: str, names: list[str]) -> str | None:
    """English Wikipedia article of a song found by search ("<title> <artist>") when MusicBrainz has no link; None unless its song infobox names the artist."""
    return _find_article(f"{title} {names[0]}", title, ("song", "single"), names) or _find_foreign("song", title, names[0], names)


def find_album(album: str, names: list[str]) -> str | None:
    return _find_article(f"{album} {names[0]} album", album, ("album",), names) or _find_foreign("album", album, names[0], names)


def find_artist(artist: str) -> str | None:
    """English Wikipedia article of a band or musician whose title is the artist's name, optionally followed by a bracket ("Haddaway", "Air (French band)")."""
    wanted = genre_lookup._norm(artist)
    if not wanted:
        return None
    for title in _search(artist)[:MAX_CANDIDATES + 2]:
        base = genre_lookup._norm(re.sub(r"\s*+\([^)]*+\)\s*+$", "", title))  # NOSONAR linear-time proven by tests/test_regex_backtracking.py and test_credits_regex_equivalence.py
        if base != wanted:
            continue
        kind = infobox(_article_url(title))["kind"] or ""
        if "musical artist" in kind or "band" in kind or "person" in kind or "singer" in kind or "musician" in kind or "dj" in kind:
            return _article_url(title)
    return _find_foreign("artist", artist, "", [])


def _suggest_into(out: dict[str, Any], artist: str, title: str, mb: dict[str, Any]) -> None:
    song_link, song_q = _pick(mb["song_rels"])
    artist_link, artist_q = _pick(mb["artist_rels"])
    out["wikipedia_song"], out["wikipedia_artist"] = song_link, artist_link
    out["wikipedia_album"] = _pick(mb.get("album_rels") or [])[0] if mb.get("album") else None
    names = artist_candidates(artist)
    if song_link and _credits_other_artist(song_link, names):
        song_link, song_q = None, None
        out["wikipedia_song"] = None
    if not song_link and title and names:
        song_link = find_song(title, names)
        out["wikipedia_song"] = song_link
        song_q = None
    if not artist_link and names:
        artist_link = next((u for u in (find_artist(n) for n in names) if u), None)
        out["wikipedia_artist"] = artist_link
        artist_q = None
    song_q = song_q or qid_of_page(song_link or "")
    artist_q = artist_q or qid_of_page(artist_link or "")
    found = facts(song_q, artist_q)
    out["tags"] = found["tags"]
    out["song_genres"] = found["song_genres"]
    out["artist_genres"] = found.get("artist_genres", [])
    out["year"] = found["year"] or mb["year"]
    _with_infobox(out, song_link, artist_link)
    if not out["wikipedia_album"] and names:
        out["wikipedia_album"] = _search_album(names, (out["infobox_album"], mb.get("album")))


def _credits_other_artist(song_link: str, names: list[str]) -> bool:
    box_artist = infobox(song_link)["artist"]
    return bool(box_artist) and not any(genre_lookup._artist_match(c, box_artist) for c in names)


def _search_album(names: list[str], candidates: tuple[str | None, str | None]) -> str | None:
    for album in dict.fromkeys(a for a in candidates if a):
        found = find_album(album, names)
        if found:
            return found
    return None


def suggest(artist: str, title: str, mb: dict[str, Any] | None = None) -> dict[str, Any]:
    """{wikipedia_song, wikipedia_artist, wikipedia_album, tags, year} for a track via MusicBrainz + Wikidata; empty values on any failure.

    `mb` is an already looked-up MusicBrainz result (`lookup` or `lookup_recording`) used instead of searching."""
    out: dict[str, Any] = {"wikipedia_song": None, "wikipedia_artist": None, "wikipedia_album": None, "tags": [], "song_genres": [], "artist_genres": [], "year": None, "infobox_album": None, "infobox_year": None, "infobox_suggest": None}
    if not genre_lookup.enabled():
        return out
    try:
        mb = mb or genre_lookup.lookup(artist, title)
        out["year"] = mb["year"]
        _suggest_into(out, artist, title, mb)
    except Exception as exc:
        log.warning("wikipedia suggestion failed for %r - %r: %s", artist, title, exc)
    return out


def _page_url(url: str | None) -> str | None:
    """A Wikipedia page for a cleaned link; a Wikidata link becomes its sitelink, else stays the Wikidata URL."""
    qid = qid_of(url)
    return (sitelink(qid) or url) if qid else url


def from_links(song_link: Any, artist_link: Any, album_link: Any = None) -> dict[str, Any]:
    """Tags, year and page URLs (`wikipedia_song`, `wikipedia_artist`, `wikipedia_album`) for user-edited Wikipedia/Wikidata links; empty when disabled or on any failure."""
    out: dict[str, Any] = {"tags": [], "song_genres": [], "artist_genres": [], "year": None, "infobox_album": None, "infobox_year": None, "infobox_suggest": None, "wikipedia_song": None, "wikipedia_artist": None, "wikipedia_album": None}
    if not genre_lookup.enabled():
        return out
    try:
        song_url, artist_url = clean_link(song_link), clean_link(artist_link)
        song_q, artist_q = qid_of_page(song_url or ""), qid_of_page(artist_url or "")
        out.update(facts(song_q, artist_q))
        out["wikipedia_song"] = _page_url(song_url)
        out["wikipedia_artist"] = _page_url(artist_url)
        out["wikipedia_album"] = _page_url(clean_link(album_link))
        _with_infobox(out, out["wikipedia_song"], out["wikipedia_artist"])
        return out
    except Exception as exc:
        log.warning("wikipedia link lookup failed: %s", exc)
        return out


COVER_TTL = 300
COVER_SIZE = 1024
THUMB_SIZE = 240
_cover_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}
_THUMB_PX = re.compile(r"/(\d+)px-")


def _thumb_of(url: str) -> str:
    return _THUMB_PX.sub(f"/{THUMB_SIZE}px-", url, count=1)


WIKIMEDIA_UA = "Electrophone/1.0 (https://electrophone.cc)"
_WIKIMEDIA_HOST = re.compile(r"(?:^|\.)(?:wikipedia|wikimedia|wikidata)\.org$")
_IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")
_NOT_COVER = re.compile(
    r"commons-logo|flag_of|flag of|edit-clear|question_book|wikimedia|wikipedia[-_ ]logo|wikiquote|wikisource|wikidata|wikt|"
    r"logo|symbol|ambox|portal|stub|speaker|padlock|crystal|nuvola|folder|disambig|searchtool|"
    r"red_pog|gold_medal|silver_medal|bronze_medal|increase|decrease|steady|icon\.(?:png|jpe?g|webp)$",
    re.I,
)
_COVER_WORDS = re.compile(r"cover|album|single|artwork", re.I)
_TITLE_STOP = {"song", "album", "single", "the", "and", "film", "band", "music"}
_WORD = re.compile(r"[^\W_]{3,}", re.UNICODE)


def _strip_tracking(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    if not parts.query:
        return url
    kept = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True) if not k.lower().startswith("utm_")]
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(kept)))


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _https(value: Any) -> str | None:
    return _strip_tracking(value) if isinstance(value, str) and value.startswith("https://") else None


def _suggestion(url: str, thumb: str, title: str, page_url: str, width: Any, height: Any) -> dict[str, Any]:
    return {
        "url": url, "thumb": thumb, "title": title, "source": "wikipedia", "page": page_url,
        "width": _int(width), "height": _int(height),
    }


def _api(host: str, query: str) -> dict[str, Any]:
    return _fetch_json(f"https://{host}/w/api.php?{query}&redirects=1&format=json&formatversion=2")


def _first_page(data: dict[str, Any]) -> dict[str, Any]:
    pages = (data.get("query") or {}).get("pages") or []
    return pages[0] if pages and isinstance(pages[0], dict) else {}


def _summary_image(thumb: dict[str, Any], orig: dict[str, Any]) -> tuple[str | None, Any, Any]:
    thumb_src, orig_src = _https(thumb.get("source")), _https(orig.get("source"))
    if orig_src and orig_src.lower().split("?")[0].endswith(".svg"):
        orig_src = None
    orig_w, orig_h = _int(orig.get("width")), _int(orig.get("height"))
    if orig_src and (orig_w is None or orig_w <= COVER_SIZE):
        return orig_src, orig_w, orig_h
    if thumb_src and _THUMB_PX.search(thumb_src) and orig_w:
        return _THUMB_PX.sub(f"/{COVER_SIZE}px-", thumb_src, count=1), COVER_SIZE, round(orig_h * COVER_SIZE / orig_w) if orig_h else None
    if orig_src:
        return orig_src, orig_w, orig_h
    if thumb_src:
        return thumb_src, _int(thumb.get("width")), _int(thumb.get("height"))
    return None, None, None


def _from_summary(host: str, title: str, page_url: str) -> dict[str, Any] | None:
    """The lead image from the REST summary, which also has the non-free (fair use) infobox images that pageimages leaves out."""
    data = _fetch_json(f"https://{host}/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"), safe=""))
    thumb = data.get("thumbnail") if isinstance(data.get("thumbnail"), dict) else {}
    orig = data.get("originalimage") if isinstance(data.get("originalimage"), dict) else {}
    thumb_src = _https(thumb.get("source"))
    url, width, height = _summary_image(thumb, orig)
    if not url:
        return None
    desktop = (data.get("content_urls") or {}).get("desktop") or {}
    return _suggestion(
        url, thumb_src or _thumb_of(url), str(data.get("title") or title),
        str(desktop.get("page") or page_url), width, height,
    )


def _from_pageimages(host: str, title: str, page_url: str) -> dict[str, Any] | None:
    page = _first_page(_api(
        host,
        f"action=query&prop=pageimages|info&piprop=thumbnail&pithumbsize={COVER_SIZE}&inprop=url&titles=" + urllib.parse.quote(title, safe=""),
    ))
    thumb = page.get("thumbnail") if isinstance(page.get("thumbnail"), dict) else {}
    source = _https(thumb.get("source"))
    if not source:
        return None
    return _suggestion(source, _thumb_of(source), str(page.get("title") or title), str(page.get("fullurl") or page_url), thumb.get("width"), thumb.get("height"))


def _looks_like_cover(file_title: str, page_title: str) -> bool:
    name = file_title.split(":", 1)[-1]
    if not name.lower().endswith(_IMAGE_EXT) or _NOT_COVER.search(name):
        return False
    if _COVER_WORDS.search(name):
        return True
    words = {w.lower() for w in _WORD.findall(page_title)} - _TITLE_STOP
    lowered = name.lower()
    return any(w in lowered for w in words)


def _from_page_files(host: str, title: str, page_url: str) -> dict[str, Any] | None:
    """The first file of the article that looks like a cover, resolved to a 1024 px url."""
    listing = _first_page(_api(host, "action=query&prop=images&imlimit=50&titles=" + urllib.parse.quote(title, safe="")))
    page_title = str(listing.get("title") or title)
    files = [i["title"] for i in listing.get("images") or [] if isinstance(i, dict) and isinstance(i.get("title"), str)]
    chosen = next((f for f in files if _looks_like_cover(f, page_title)), None)
    if not chosen:
        return None
    info = _first_page(_api(host, f"action=query&prop=imageinfo&iiprop=url|size&iiurlwidth={COVER_SIZE}&titles=" + urllib.parse.quote(chosen, safe="")))
    entry = (info.get("imageinfo") or [None])[0]
    if not isinstance(entry, dict):
        return None
    url = _https(entry.get("thumburl")) or _https(entry.get("url"))
    if not url:
        return None
    scaled = bool(entry.get("thumburl") and entry.get("thumbwidth"))
    return _suggestion(
        url, _thumb_of(url), page_title, page_url,
        entry.get("thumbwidth") if scaled else entry.get("width"),
        entry.get("thumbheight") if scaled else entry.get("height"),
    )


def _page_image(page_url: str) -> dict[str, Any] | None:
    """The lead image of a Wikipedia article (the infobox picture of an album or song page): REST summary, then pageimages, then the article's file list; None when there is none."""
    parts = urllib.parse.urlsplit(page_url)
    host = (parts.hostname or "").lower()
    if not _WP_HOST.match(host) or not parts.path.startswith(_WIKI_PATH):
        return None
    now = time.monotonic()
    hit = _cover_cache.get(page_url)
    if hit and now - hit[0] < COVER_TTL:
        return hit[1]
    title = urllib.parse.unquote(parts.path[len(_WIKI_PATH):]).replace("_", " ").strip()
    found: dict[str, Any] | None = None
    failures = 0
    for step in (_from_summary, _from_pageimages, _from_page_files):
        try:
            found = step(host, title, page_url)
        except Exception as exc:
            failures += 1
            log.warning("wikipedia cover step %s failed for %s: %s", step.__name__, page_url, exc)
        if found:
            break
    if found or failures < 3:
        _cover_cache[page_url] = (now, found)
    return found


def cover_candidates(links: list[str]) -> list[dict[str, Any]]:
    """Cover suggestions from Wikipedia pages (song page first, then album page), deduplicated by image; a failing page is skipped."""
    out: list[dict[str, Any]] = []
    for link in links:
        try:
            page = _page_url(link)
            found = _page_image(page) if page else None
        except Exception as exc:
            log.warning("wikipedia cover lookup failed for %s: %s", link, exc)
            continue
        if found and all(found["url"] != other["url"] for other in out):
            out.append(found)
    return out
