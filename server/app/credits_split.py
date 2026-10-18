"""Suggested splits of ambiguous credit strings (ADD-113): suggestions and review flags only, never applied by the server."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from . import credits, timeutil, titles
from .tokens import split_tokens

_SPLIT = re.compile(r"(?:(?<!\s)\s++)?+[,&]\s*+|(?<!\s)\s++(?:and|x|vs\.?)\s++", re.I)
_KIND_WORDS = (
    ("remix", re.compile(r"\bremix(?:ed)?\b|\bmashup\b|\bbootleg\b|\brework\b|\bvip\b", re.I)),
    ("live", re.compile(r"\blive\b|\bunplugged\b|\bin concert\b", re.I)),
    ("acoustic", re.compile(r"\bacoustic\b", re.I)),
    ("extended", re.compile(r"\bextended\b", re.I)),
    ("instrumental", re.compile(r"\binstrumental\b", re.I)),
    ("remaster", re.compile(r"\bremaster(?:ed)?\b", re.I)),
    ("edit", re.compile(r"\bedit\b", re.I)),
    ("cover", re.compile(r"\bcover\b", re.I)),
    ("other", re.compile(r"\bslowed\b|\bsped[\s-]?up\b|\bspeed[\s-]?up\b|\bnightcore\b|\breverb\b", re.I)),
)
_BY_STRIP = re.compile(
    r"\b(?:remix(?:ed)?|mix(?:ed)?|edit|mashup|bootleg|rework|vip|dub|version|radio|club|extended|original|instrumental|vocal|chill|by)\b", re.I)
_MIXED_BY = re.compile(r"\bmixed\s+by\b", re.I)
_REMIX_WORDISH = re.compile(r"\b(?:remix|mashup|mix|edit)\b", re.I)
_PUNCT = " -|"
_MASHUP_WORD = re.compile(r"^mash[\s-]?up$", re.I)
_MASHUP_TAIL = re.compile(r"(?<!\s)\s*+[(\[]\s*+(mash[\s-]?up)\s*+[)\]]\s*+$", re.I)
_SOURCE_SPLIT = re.compile(r"(?<!\s)\s++(?:x|×|vs\.?)\s++", re.I)
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


_MIX_TAIL = re.compile(r"^(?P<x>.*?)(?<![\s,/-])[\s,/-]*+\b(?:mix|edit|version)\s*$", re.I)
_DESCRIPTOR_WORDS = frozenset((
    "extended", "radio", "club", "dub", "vip", "original", "instrumental", "acoustic", "short", "long", "album", "single",
    "full", "main", "extra", "maxi", "deep", "vocal",
))
_DESCRIPTOR_NUMBER = re.compile(r"^\d+(?:[\"'\u2033\u2032]|-?inch)?$", re.I)
_DESCRIPTOR_KINDS = (("extended", "extended"), ("instrumental", "instrumental"), ("acoustic", "acoustic"), ("radio", "edit"))


def _descriptor_kind(text: str) -> str | None:
    """Type of a "<descriptor words> Mix/Edit/Version" text that names no person ("Extended Mix", "Radio Edit", "Club Mix", "12\" Mix"): extended, instrumental, acoustic or edit by its first matching word, else other; None when the text has another word (a person) or no descriptor."""
    m = _MIX_TAIL.match(text.strip())
    words = [w.lower() for w in re.split(r"[\s,/+&-]+", m.group("x")) if w] if m else []
    if not words or not all(w in _DESCRIPTOR_WORDS or _DESCRIPTOR_NUMBER.match(w) for w in words):
        return None
    return next((kind for word, kind in _DESCRIPTOR_KINDS if word in words), "other")


def _kind_of(text: str) -> str:
    if _MASHUP_WORD.match(text.strip()):
        return "mashup"
    descriptor = _descriptor_kind(text)
    if descriptor and not re.search(r"\bremix\b|\bmashup\b|\bmixed\s+by\b", text, re.I):
        return descriptor
    if _MIXED_BY.search(text) and not re.search(r"\bremix\b|\bmashup\b", text, re.I):
        return "other"
    for kind, pattern in _KIND_WORDS:
        if pattern.search(text):
            return kind
    return credits.kind_for(text)


kind_of = _kind_of
_YEAR = re.compile(r"(?<!\d)(?:19|20)\d{2}(?!\d)")


def version_year(text: str | None) -> int | None:
    """The explicit 4-digit year in a remaster version's text ("2011 Remaster", "Remastered 2011"), else None; any other kind has none."""
    if not text or _kind_of(text) != "remaster":
        return None
    m = _YEAR.search(text)
    return timeutil.valid_year(int(m.group())) if m else None


_COVER_TAIL = re.compile(r"^(.*?)(?<![\s,:-])[\s,:-]*+\bcover(?:\s++version)?+\s*+$", re.I)


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


def _reading(artists: list[str], featured: list[str], version: dict[str, Any], title: str) -> dict[str, Any]:
    return {"artists": artists, "featured": featured, "version": version, "title": title}


def _cover_dash(left: str, right: str, text: str, name: str, credited: list[str], featured: list[str], ctx: dict[str, Any], notes: list[str]) -> tuple[str, list[str], dict[str, Any], list[dict[str, Any]] | None]:
    """`A - T (X Cover)`: X is the performer and A the original artist, or the other way round. Evidence in order: the work's known original artist (`ctx["original"]`), the credited artists, the uploader (`ctx["uploader"]`, an X equal to it performs); with none the first reading (X performs) is returned with both listed as `alternatives`, nothing decided."""
    a_names, x_names, title = _names(left), _names(name), _squash(right)

    def reading(performers: list[str], original: list[str]) -> dict[str, Any]:
        return _reading(performers, featured, {"kind": "cover", "name": text, "by": [], "of": original}, title)

    r1, r2 = reading(a_names, x_names), reading(x_names, a_names)

    def hit(names: list[str], pool: set[str]) -> bool:
        return any(_fold(n) in pool for n in names)

    original = {_fold(o) for o in ctx.get("original") or []}
    credit = {_fold(c) for c in credited}
    uploader = {_fold(ctx["uploader"])} if ctx.get("uploader") else set()
    chosen = None
    if hit(x_names, original):
        chosen = r1
    elif hit(a_names, original):
        chosen = r2
    else:
        chosen = next((r1 if hit(a_names, pool) else r2 for pool in (credit, uploader) if hit(a_names, pool) or hit(x_names, pool)), None)
    notes.append("cover_dash")
    if chosen:
        return title, chosen["artists"], chosen["version"], None
    notes.append("cover_ambiguous")
    return title, r2["artists"], r2["version"], [r2, r1]


def _by_names(text: str, kind: str) -> list[str]:
    if kind not in ("remix", "other") or (kind == "other" and not _MIXED_BY.search(text)):
        return []
    return _names(_BY_STRIP.sub(" ", text))


def version_artists(text: str) -> list[str]:
    """The people named in a version text: "Moreno J Remix" gives [Moreno J]; descriptor-only texts ("Club Mix", "Slowed") give none."""
    return _by_names(text, _kind_of(text))


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


_MASHUP_BY = re.compile(r"mash[\s-]?up\s+by\s+(?P<a>.+)|(?P<b>.+?)\s++mash[\s-]?up", re.I)
_MAKERS = re.compile(r"\s*+[,&]\s*+|\s++(?:and|x|feat\.?|ft\.?)\s++", re.I)
_MASH_SOURCES = re.compile(r"\s+(?:x|×|vs\.?|&|\+)\s+|\s*,\s*", re.I)


def _split_names(text: str, pattern: re.Pattern[str]) -> list[str]:
    out: list[str] = []
    for part in pattern.split(_squash(text)):
        name = part.strip(_PUNCT + " ")
        if name and name.casefold() not in {o.casefold() for o in out}:
            out.append(name)
    return out


def _mashup_by(base: str, artists: list[str], name: str, makers: str) -> tuple[str, list[str], dict[str, Any]]:
    """"A x B - Title (mashup by X)": X are the main artists, A and B the sources (`of`), the text after the dash is the title as is."""
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


def _title_first(base: str, title_text: str, artists: list[str], ctx: dict[str, Any]) -> tuple[str, list[str]] | None:
    """`Title - Artist` read title first (ADD-135): the after-dash plain name is a known artist (credited, uploader, original) and the before-dash part is not, or a version bracket sits before the dash and no artist is credited; returns (title, artists)."""
    m = _DASH.search(base)
    if not m:
        return None
    left, right = _squash(base[: m.start()]), _squash(base[m.end():])
    if not left or not right or _DASH.search(right) or titles._BRACKET.search(right) or titles._FEAT_KEY.search(right):
        return None
    right_names = _names(right)
    known = {_fold(n) for n in [*artists, *(ctx.get("original") or []), *([ctx["uploader"]] if ctx.get("uploader") else [])]}
    right_hit = any(_fold(n) in known for n in right_names)
    left_hit = any(_fold(n) in known for n in [left, *_names(left)])
    if left_hit or not (right_hit or (not artists and titles.marker_before_dash(title_text))):
        return None
    return left, artists if all(_fold(n) in {_fold(a) for a in artists} for n in right_names) else right_names


def _cover_reading(base: str, artists: list[str], featured: list[str], version: dict[str, Any], ctx: dict[str, Any], notes: list[str]) -> tuple[str, list[str], dict[str, Any], list[dict[str, Any]] | None]:
    dash = _DASH.search(base)
    cname = cover_name(version["name"])
    if dash and cname and _squash(base[: dash.start()]) and _squash(base[dash.end() :]):
        return _cover_dash(base[: dash.start()], base[dash.end() :], version["name"], cname, [*artists, *featured], featured, ctx, notes)
    return base, artists, _cover_version(version["name"], [*artists, *featured], notes) or version, None


def _credited_names(primary: str, notes: list[str]) -> list[str]:
    artists: list[str] = []
    seen: set[str] = set()
    pills = split_tokens(primary)
    for pill in pills:
        for name in _names(pill):
            if name.casefold() not in seen:
                seen.add(name.casefold())
                artists.append(name)
    if len(artists) > len(pills):
        notes.append("multi_artist")
    return artists


Reading = tuple[str, list[str], dict[str, Any] | None, list[dict[str, Any]] | None]


def _plain_version(
    base: str, artists: list[str], featured: list[str], version: dict[str, Any], ctx: dict[str, Any], notes: list[str]
) -> Reading:
    if version["kind"] == "cover":
        return _cover_reading(base, artists, featured, version, ctx, notes)
    return base, artists, version, None


def _mashup_reading(
    base: str, artists: list[str], from_title: str | None, tail: re.Match[str] | None, remixer_text: str, notes: list[str]
) -> Reading | None:
    by_text = next((t for t in (remixer_text, _squash(from_title or "")) if t and _MASHUP_BY.fullmatch(t)), None)
    if by_text and not tail:
        m = _MASHUP_BY.fullmatch(by_text)
        assert m is not None
        base, artists, version = _mashup_by(base, artists, by_text, m.group("a") or m.group("b"))
        notes.append("mashup_by")
        notes.append("remixer_to_version" if by_text == remixer_text else "version_in_title")
        return base, artists, version, None
    if tail or _MASHUP_WORD.match(remixer_text):
        base, artists, version = _mashup(base, artists, notes, tail.group(1) if tail else remixer_text)
        notes.append("version_in_title" if tail else "remixer_to_version")
        return base, artists, version, None
    return None


def _version_reading(
    base: str, artists: list[str], featured: list[str], from_title: str | None, tail: re.Match[str] | None,
    remixer_text: str, release: tuple[int, bool] | None, ctx: dict[str, Any], notes: list[str],
) -> Reading:
    mashup = _mashup_reading(base, artists, from_title, tail, remixer_text, notes)
    if mashup:
        return mashup
    if remixer_text:
        notes.append("remixer_to_version")
        if from_title:
            notes.append("version_in_title")
        return _plain_version(base, artists, featured, _version(remixer_text), ctx, notes)
    if from_title:
        notes.append("version_in_title")
        return _plain_version(base, artists, featured, _version(_squash(from_title)), ctx, notes)
    if release and release[1]:
        notes.append("cover_release")
        notes.append("version_in_title")
        return base, artists, {"kind": "cover", "name": "Cover", "by": []}, None
    return base, artists, None, None


def _title_stage(
    title_text: str, featured: list[str], notes: list[str]
) -> tuple[str, list[str], tuple[int, bool] | None, re.Match[str] | None, str | None]:
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
        return _squash(base[: tail.start()]), featured, release, tail, None
    base, from_title = _title_version(base)
    return base, featured, release, None, from_title


def suggest(artist: str | None, title: str | None, remixer: str | None, ctx: dict[str, Any] | None = None) -> dict[str, Any]:
    """`{artists, featured, version, title, notes}` suggested from the current strings; `title` is the base title when it differs, `notes` are codes."""
    ctx = ctx or {}
    notes: list[str] = []
    primary, featured = _cut_feat(_squash(artist or ""))
    if featured:
        notes.append("feat_in_artist")
    artists = _credited_names(primary, notes)
    title_text = (title or "").strip()
    base, featured, release, tail, from_title = _title_stage(title_text, featured, notes)
    base, artists, version, alternatives = _version_reading(
        base, artists, featured, from_title, tail, _squash(remixer or ""), release, ctx, notes)
    if not tail and not alternatives and (version is None or version["kind"] not in ("cover", "mashup")):
        first = _title_first(base, title_text, artists, ctx)
        if first:
            base, artists = first
            notes.append("title_first")
    new_title = base if base and base != title_text else None
    out = {"artists": artists, "featured": featured, "version": version, "title": new_title, "notes": notes}
    if alternatives:
        out["alternatives"] = alternatives
    return out


def _year_of(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None


def _text_flags(title: str, remixer: str) -> set[str]:
    text = f"{title} {remixer}"
    found: set[str] = set()
    if _MIXED_BY.search(text):
        found.add("mixed_by")
    for flag, pattern in _FLAG_WORDS.items():
        if re.search(pattern, text, re.I):
            found.add(flag)
    if remixer.strip() and not _REMIX_WORDISH.search(remixer):
        found.add("remixer_without_remix_word")
    return found


def _artist_flags(artist: str, title: str) -> set[str]:
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
    if not artist.strip():
        found.add("blank_artist")
    return found


def _year_flags(raw: dict[str, Any], remixer: str) -> set[str]:
    found: set[str] = set()
    remix_year = raw.get("remix_year")
    if isinstance(remix_year, (int, str)) and not isinstance(remix_year, bool) and str(remix_year).strip() and not remixer.strip():
        found.add("remix_year_without_remixer")
    for key in ("year", "remix_year"):
        year = _year_of(raw.get(key))
        if year is not None and timeutil.valid_year(year) is None:
            found.add("year_out_of_range")
    return found


def review_flags(raw: dict[str, Any]) -> list[str]:
    """Flags of the original strings that deserve a human look, in the fixed `FLAGS` order."""
    artist = raw.get("artist") if isinstance(raw.get("artist"), str) else ""
    title = raw.get("title") if isinstance(raw.get("title"), str) else ""
    remixer = raw.get("remixer") if isinstance(raw.get("remixer"), str) else ""
    found = _artist_flags(artist, title) | _text_flags(title, remixer) | _year_flags(raw, remixer)
    return [f for f in FLAGS if f in found]
