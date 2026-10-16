"""Suggested splits of ambiguous credit strings (ADD-113): suggestions and review flags only, never applied by the server."""

from __future__ import annotations

import re
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
    if _MIXED_BY.search(text) and not re.search(r"\bremix\b|\bmashup\b", text, re.I):
        return "other"
    for kind, pattern in _KIND_WORDS:
        if pattern.search(text):
            return kind
    return credits.kind_for(text)


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
    base, from_title = _title_version(base)
    remixer_text = _squash(remixer or "")
    version: dict[str, Any] | None = None
    if remixer_text:
        version = _version(remixer_text)
        notes.append("remixer_to_version")
        if from_title:
            notes.append("version_in_title")
    elif from_title:
        version = _version(_squash(from_title))
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
