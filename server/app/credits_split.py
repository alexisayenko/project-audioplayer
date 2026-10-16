"""Suggested splits of ambiguous credit strings (ADD-113): suggestions and review flags only, never applied by the server."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from . import credits, timeutil, titles
from .tokens import split_tokens

_SPLIT = re.compile(r"\s*,\s*|\s*&\s*|\s+and\s+|\s+x\s+|\s+vs\.?\s+", re.I)
_KIND_WORDS = (
    ("remix", re.compile(r"\bremix(?:ed)?\b|\bmashup\b|\bbootleg\b|\brework\b|\bvip\b", re.I)),
    ("live", re.compile(r"\blive\b|\bunplugged\b|\bin concert\b", re.I)),
    ("acoustic", re.compile(r"\bacoustic\b", re.I)),
    ("extended", re.compile(r"\bextended\b", re.I)),
    ("instrumental", re.compile(r"\binstrumental\b", re.I)),
    ("remaster", re.compile(r"\bremaster(?:ed)?\b", re.I)),
    ("edit", re.compile(r"\bedit\b", re.I)),
    ("cover", re.compile(r"\bcover\b", re.I)),
)
_BY_STRIP = re.compile(
    r"\b(?:remix(?:ed)?|mix(?:ed)?|edit|mashup|bootleg|rework|vip|dub|version|radio|club|extended|original|instrumental|vocal|chill|by)\b", re.I)
_MIXED_BY = re.compile(r"\bmixed\s+by\b", re.I)
_REMIX_WORDISH = re.compile(r"\b(?:remix|mashup|mix|edit)\b", re.I)
_PUNCT = " -|"
_MASHUP_WORD = re.compile(r"^mash[\s-]?up$", re.I)
_MASHUP_TAIL = re.compile(r"\s*[(\[]\s*(mash[\s-]?up)\s*[)\]]\s*$", re.I)
_SOURCE_SPLIT = re.compile(r"\s+(?:x|×|vs\.?)\s+", re.I)
_DASH = re.compile(r"\s[-–—]\s")
FLAGS = (
    "feat_in_artist", "feat_in_title", "multi_artist_in_one_pill", "remix_text_in_title", "mixed_by", "live", "acoustic",
    "unplugged", "extended", "instrumental", "remaster", "edit", "cover", "remixer_without_remix_word",
    "remix_year_without_remixer", "blank_artist", "year_out_of_range",
)
_FLAG_WORDS = {
    "live": r"\blive\b", "acoustic": r"\bacoustic\b", "unplugged": r"\bunplugged\b", "extended": r"\bextended\b",
    "instrumental": r"\binstrumental\b", "remaster": r"\bremaster(?:ed)?\b", "edit": r"\bedit\b", "cover": r"\bcover\b",
}


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip(_PUNCT + " ")


def _names(text: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for part in _SPLIT.split(_squash(text)):
        name = part.strip(_PUNCT + " ")
        if name and name.casefold() not in seen:
            seen.add(name.casefold())
            out.append(name)
    return out


def _cut_feat(text: str) -> tuple[str, list[str]]:
    names: list[str] = []
    while True:
        m = titles._FEAT_KEY.search(text)
        if not m:
            return _squash(text), names
        i = m.start()
        opener = text[i - 1] if i else ""
        if opener in titles._CLOSERS:
            close = text.find(titles._CLOSERS[opener], m.end())
            stop = len(text) if close < 0 else close
            names += _names(text[m.end():stop])
            text = text[: i - 1] + " " + text[stop + 1:]
        else:
            stop = titles._feat_end(text, m.end())
            names += _names(text[m.end():stop])
            text = text[:i] + " " + text[stop:]


def _kind_of(text: str) -> str:
    if _MASHUP_WORD.match(text.strip()):
        return "mashup"
    if _MIXED_BY.search(text) and not re.search(r"\bremix\b|\bmashup\b", text, re.I):
        return "other"
    for kind, pattern in _KIND_WORDS:
        if pattern.search(text):
            return kind
    return credits.kind_for(text)


_COVER_TAIL = re.compile(r"^(.*?)[\s,:-]*\bcover(?:\s+version)?\s*$", re.I)


def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)).lower()


def cover_name(text: str) -> str:
    m = _COVER_TAIL.match(text)
    return _squash(m.group(1)) if m else ""


def _cover_version(text: str, credited: list[str], notes: list[str]) -> dict[str, Any] | None:
    """A title parenthetical `NAME Cover`: NAME is the performer when it is a credited artist, else the original artist; no credits to compare with is ambiguous."""
    name = cover_name(text)
    if not name:
        return None
    version: dict[str, Any] = {"kind": "cover", "name": text, "by": []}
    if not credited:
        notes.append("cover_ambiguous")
    elif _fold(name) in {_fold(c) for c in credited}:
        notes.append("cover_performer")
    else:
        version["of"] = [name]
    return version


def _by_names(text: str, kind: str) -> list[str]:
    if kind not in ("remix", "other"):
        return []
    return _names(_BY_STRIP.sub(" ", text))


def _version(text: str) -> dict[str, Any]:
    kind = _kind_of(text)
    return {"kind": kind, "name": text, "by": _by_names(text, kind)}


def _title_version(title: str) -> tuple[str, str | None]:
    rest, remix = titles.cut_remix(title)
    if remix:
        return _squash(rest), remix
    for m in titles._BRACKET.finditer(title):
        inner = m.group(1).strip()
        if inner and any(p.search(inner) for _, p in _KIND_WORDS):
            return _squash(f"{title[: m.start()]} {title[m.end():]}"), inner
    return title, None


def _sources(text: str) -> list[str]:
    """The works of a `Song A x Song B` text when it splits unambiguously on x, vs or the multiplication sign, else nothing."""
    parts = [_squash(p) for p in _SOURCE_SPLIT.split(_squash(text))]
    return parts if len(parts) >= 2 and all(parts) else []


_MASHUP_BY = re.compile(r"mash[\s-]?up\s+by\s+(?P<a>.+)|(?P<b>.+?)\s+mash[\s-]?up", re.I)
_MAKERS = re.compile(r"\s*,\s*|\s*&\s*|\s+and\s+|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+", re.I)
_MASH_SOURCES = re.compile(r"\s+(?:x|×|vs\.?|&|\+)\s+|\s*,\s*", re.I)


def _split_names(text: str, pattern: re.Pattern[str]) -> list[str]:
    out: list[str] = []
    for part in pattern.split(_squash(text)):
        name = part.strip(_PUNCT + " ")
        if name and name.casefold() not in {o.casefold() for o in out}:
            out.append(name)
    return out


def _mashup_by(base: str, artists: list[str], name: str, makers: str) -> tuple[str, list[str], dict[str, Any]]:
    """"A x B - Title (mashup by X)": X are the main artists, A and B the sources (\`of\`), the text after the dash is the title as is."""
    version: dict[str, Any] = {"kind": "mashup", "name": name, "by": []}
    m = _DASH.search(base)
    left, right = (base[: m.start()], base[m.end():]) if m else ("", "")
    if m and _squash(left) and _squash(right):
        sources, title = _split_names(left, _MASH_SOURCES), _squash(right)
    else:
        sources, title = artists, _squash(base)
    if sources:
        version["of"] = sources
    return title, _split_names(makers, _MAKERS), version


def _mashup(base: str, artists: list[str], notes: list[str], name: str) -> tuple[str, list[str], dict[str, Any]]:
    """`Title - A, B (mashup)`: the credited names are the provisional makers; sources only when the title names them with x or vs."""
    version: dict[str, Any] = {"kind": "mashup", "name": name, "by": []}
    m = _DASH.search(base)
    left, right = (base[: m.start()], base[m.end():]) if m else (base, "")
    if m and _squash(left) and _squash(right):
        sources = _sources(right)
        if sources:
            version["of"] = sources
            return _squash(right), _names(left), version
        notes.append("mashup_makers_unknown")
        return _squash(left), _names(right), version
    sources = _sources(base)
    if sources:
        version["of"] = sources
    notes.append("mashup_makers_unknown")
    return _squash(base), artists, version


def suggest(artist: str | None, title: str | None, remixer: str | None) -> dict[str, Any]:
    """`{artists, featured, version, title, notes}` suggested from the current strings; `title` is the base title when it differs, `notes` are codes."""
    notes: list[str] = []
    artist_text = _squash(artist or "")
    primary, featured = _cut_feat(artist_text)
    if featured:
        notes.append("feat_in_artist")
    artists: list[str] = []
    seen: set[str] = set()
    for pill in split_tokens(primary):
        for name in _names(pill):
            if name.casefold() not in seen:
                seen.add(name.casefold())
                artists.append(name)
    if len(artists) > len(split_tokens(primary)):
        notes.append("multi_artist")
    title_text = (title or "").strip()
    base, title_feat = _cut_feat(title_text)
    if title_feat:
        notes.append("feat_in_title")
        featured = [*featured, *(n for n in title_feat if n.casefold() not in {f.casefold() for f in featured})]
    release = titles.release_tag(base)
    if release:
        base = _squash(base[: release[0]])
        notes.append("release_tag")
    tail = _MASHUP_TAIL.search(base)
    if tail:
        base, from_title = _squash(base[: tail.start()]), None
    else:
        base, from_title = _title_version(base)
    remixer_text = _squash(remixer or "")
    version: dict[str, Any] | None = None
    by_text = next((t for t in (remixer_text, _squash(from_title or "")) if t and _MASHUP_BY.fullmatch(t)), None)
    if by_text and not tail:
        m = _MASHUP_BY.fullmatch(by_text)
        assert m is not None
        base, artists, version = _mashup_by(base, artists, by_text, m.group("a") or m.group("b"))
        notes.append("mashup_by")
        notes.append("remixer_to_version" if by_text == remixer_text else "version_in_title")
    elif tail or _MASHUP_WORD.match(remixer_text):
        base, artists, version = _mashup(base, artists, notes, tail.group(1) if tail else remixer_text)
        notes.append("version_in_title" if tail else "remixer_to_version")
    elif remixer_text:
        version = _version(remixer_text)
        notes.append("remixer_to_version")
        if from_title:
            notes.append("version_in_title")
    elif from_title:
        version = _version(_squash(from_title))
        notes.append("version_in_title")
        if version["kind"] == "cover":
            version = _cover_version(version["name"], [*artists, *featured], notes) or version
    elif release and release[1]:
        version = {"kind": "cover", "name": "Cover", "by": []}
        notes.append("cover_release")
        notes.append("version_in_title")
    new_title = base if base and base != title_text else None
    return {"artists": artists, "featured": featured, "version": version, "title": new_title, "notes": notes}


def review_flags(raw: dict[str, Any]) -> list[str]:
    """Flags of the original strings that deserve a human look, in the fixed `FLAGS` order."""
    artist = raw.get("artist") if isinstance(raw.get("artist"), str) else ""
    title = raw.get("title") if isinstance(raw.get("title"), str) else ""
    remixer = raw.get("remixer") if isinstance(raw.get("remixer"), str) else ""
    text = f"{title} {remixer}"
    found: set[str] = set()
    if titles._FEAT_KEY.search(artist):
        found.add("feat_in_artist")
    if titles._FEAT_KEY.search(title):
        found.add("feat_in_title")
    primary, _ = _cut_feat(artist)
    if any(_SPLIT.search(pill) for pill in split_tokens(primary)):
        found.add("multi_artist_in_one_pill")
    if titles._REMIX_WORD.search(title) and not _MIXED_BY.search(title):
        found.add("remix_text_in_title")
    if _MIXED_BY.search(text):
        found.add("mixed_by")
    for flag, pattern in _FLAG_WORDS.items():
        if re.search(pattern, text, re.I):
            found.add(flag)
    if remixer.strip() and not _REMIX_WORDISH.search(remixer):
        found.add("remixer_without_remix_word")
    remix_year = raw.get("remix_year")
    if isinstance(remix_year, (int, str)) and not isinstance(remix_year, bool) and str(remix_year).strip() and not remixer.strip():
        found.add("remix_year_without_remixer")
    if not artist.strip():
        found.add("blank_artist")
    for key in ("year", "remix_year"):
        value = raw.get(key)
        if isinstance(value, bool):
            continue
        year = value if isinstance(value, int) else int(value) if isinstance(value, str) and value.strip().isdigit() else None
        if year is not None and timeutil.valid_year(year) is None:
            found.add("year_out_of_range")
    return [f for f in FLAGS if f in found]
