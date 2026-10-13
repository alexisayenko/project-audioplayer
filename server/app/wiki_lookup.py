"""Wikipedia links and structured facts (genre, country, year) from MusicBrainz relations and Wikidata."""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.parse
import urllib.request
from typing import Any

from . import genre_lookup

log = logging.getLogger(__name__)

WIKIDATA = "https://www.wikidata.org"
TIMEOUT = 5
MAX_GENRES = 3

_WP_HOST = re.compile(r"^(?:[a-z0-9-]+\.)+wikipedia\.org$")
_WD_HOST = re.compile(r"^(?:www\.|m\.)?wikidata\.org$")
_QID = re.compile(r"^Q[1-9]\d*$")
_SITE = re.compile(r"^([a-z]{2,3}(?:-[a-z]+)?)wiki$")

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
    if raw.startswith("http://"):
        raw = "https://" + raw[len("http://") :]
    try:
        parts = urllib.parse.urlsplit(raw)
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
            if re.fullmatch(r"[A-Za-z]{2}", code):
                return [f"country:{code.lower()}"]
    return []


def _genre_tags(*claim_sets: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for cs in claim_sets:
        ids += [i for i in _ids(cs, "P136") if i not in ids]
    ids = ids[:6]
    labels = _label_map(ids) if ids else {}
    out: list[str] = []
    for i in ids:
        tag = f"genre:{labels[i].strip().casefold()}" if i in labels else ""
        if tag and tag not in out:
            out.append(tag)
    return out[:MAX_GENRES]


def facts(song_qid: str | None, artist_qid: str | None) -> dict[str, Any]:
    """Tag suggestions and the song's publication year from Wikidata; empty on any failure."""
    result: dict[str, Any] = {"tags": [], "year": None}
    try:
        song = (_entity(song_qid) or {}).get("claims") or {} if song_qid else {}
        artist = (_entity(artist_qid) or {}).get("claims") or {} if artist_qid else {}
        tags = [*_genre_tags(song, artist), *_country_tags(artist, song)]
        result["tags"] = tags
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
            title = urllib.parse.unquote(parts.path[len("/wiki/") :]).replace("_", " ")
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
    out: dict[str, Any] = {"wikipedia_song": None, "wikipedia_artist": None, "tags": [], "year": None}
    if not genre_lookup.enabled():
        return out
    try:
        mb = genre_lookup.lookup(artist, title)
        out["year"] = mb["year"]
        song_link, song_q = _pick(mb["song_rels"])
        artist_link, artist_q = _pick(mb["artist_rels"])
        out["wikipedia_song"], out["wikipedia_artist"] = song_link, artist_link
        song_q = song_q or qid_of_page(song_link or "")
        artist_q = artist_q or qid_of_page(artist_link or "")
        found = facts(song_q, artist_q)
        out["tags"] = found["tags"]
        out["year"] = found["year"] or mb["year"]
    except Exception as exc:
        log.warning("wikipedia suggestion failed for %r - %r: %s", artist, title, exc)
    return out


def _page_url(url: str | None) -> str | None:
    """A Wikipedia page for a cleaned link; a Wikidata link becomes its sitelink, else stays the Wikidata URL."""
    qid = qid_of(url)
    return (sitelink(qid) or url) if qid else url


def from_links(song_link: Any, artist_link: Any) -> dict[str, Any]:
    """Tags, year and page URLs (`wikipedia_song`, `wikipedia_artist`) for user-edited Wikipedia/Wikidata links; empty when disabled or on any failure."""
    out: dict[str, Any] = {"tags": [], "year": None, "wikipedia_song": None, "wikipedia_artist": None}
    if not genre_lookup.enabled():
        return out
    try:
        song_url, artist_url = clean_link(song_link), clean_link(artist_link)
        song_q, artist_q = qid_of_page(song_url or ""), qid_of_page(artist_url or "")
        out.update(facts(song_q, artist_q))
        out["wikipedia_song"] = _page_url(song_url)
        out["wikipedia_artist"] = _page_url(artist_url)
        return out
    except Exception as exc:
        log.warning("wikipedia link lookup failed: %s", exc)
        return out
