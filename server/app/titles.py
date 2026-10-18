"""Pure helpers that turn a YouTube channel + raw video title into a clean artist and title."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable

from . import titleclean

_BRACKETED = re.compile(r"[\(\[][^\)\]]*[\)\]]")
_NOISE_WORD = re.compile(r"\b(?:official|video|audio|lyrics?|visuali[sz]er|remaster(?:ed)?|h[dq]|4k|clip|mv)\b", re.I)
_LIVE_WORD = re.compile(r"\b(?:live|unplugged|in concert)\b", re.I)
_VERSION_LEAD = re.compile(r"\s*(?:acoustic|sessions?|at)\b", re.I)


def _drop_brackets(text: str, doomed: Callable[[str], bool]) -> str:
    out: list[str] = []
    pos = 0
    start = 0
    while True:
        m = _BRACKETED.search(text, start)
        if not m:
            break
        if doomed(m.group()):
            out.append(text[pos : m.start()])
            pos = start = m.end()
        else:
            start = m.start() + 1
    out.append(text[pos:])
    return "".join(out)


def _is_noise(bracket: str) -> bool:
    return bool(_NOISE_WORD.search(bracket))


def _is_version(bracket: str) -> bool:
    return bool(_LIVE_WORD.search(bracket, 1) or _VERSION_LEAD.match(bracket, 1))


_FEAT_KEY = re.compile(r"\b(?:featuring|feat\.?|ft\.?)\s", re.I)
_FEAT_STOPS = (" - ", " \u2013 ", " \u2014 ", " | ", " \u25cf\u25cf ", " \u2022 ", ")", "]", "(", "[")
_CLOSERS = {"(": ")", "[": "]"}


def _feat_end(text: str, start: int) -> int:
    ends = [i for i in (text.find(stop, start) for stop in _FEAT_STOPS) if i >= 0]
    return min(ends) if ends else len(text)


def _strip_feat(text: str) -> str:
    """Drop each feat/ft/featuring credit up to its own boundary; the rest of the text stays."""
    pos = 0
    while True:
        m = _FEAT_KEY.search(text, pos)
        if not m:
            return text
        i = m.start()
        opener = text[i - 1] if i else ""
        if opener in _CLOSERS:
            close = text.find(_CLOSERS[opener], m.end())
            stop = len(text) if close < 0 else close + 1
            text = text[: i - 1] + text[stop:]
            pos = max(i - 1, 0)
        else:
            text = text[:i] + text[_feat_end(text, m.end()) :]
            pos = i
_SEP = re.compile(r"\s+(?:-|●●)\s+")


def clean_artist(artist: str) -> str:
    a = re.sub(r"-\s*Topic$", "", (artist or "").rstrip(), flags=re.I)
    a = re.sub(r"VEVO\s*$", "", a, flags=re.I)
    a = re.sub(r"\s+", " ", a).strip()
    stripped = a[: -len(" official")] if a.casefold().endswith(" official") else a
    return stripped.strip() or a


def clean_title(title: str) -> str:
    t = _drop_brackets(title or "", _is_noise)
    t = re.sub(r"[\(\[]\s*[\)\]]", "", t)
    return re.sub(r"\s+", " ", t).strip(" -|")


_VERSION_KEY = re.compile(r"(?:-\s+(?:live|acoustic|unplugged|sessions?|in concert)|live (?:at|from|in|on))\b", re.I)


def _cut_version_tail(text: str) -> str:
    """Drops the first version marker that is followed by no line break (bar one final newline), and everything after it."""
    limit = len(text) - 1 if text.endswith("\n") else len(text)
    last_break = text.rfind("\n", 0, limit)
    pos = 0
    while (m := _VERSION_KEY.search(text, pos)) is not None:
        if m.start() and text[m.start() - 1].isspace() and m.end() > last_break:
            return text[: len(text[: m.start()].rstrip())] + text[limit:]
        pos = m.start() + 1
    return text


def lookup_artist(artist: str) -> str:
    """The artist for external lookups only: clean_artist without feat/ft/featuring credits; never shown or saved."""
    a = re.sub(r"\s+", " ", _strip_feat(clean_artist(artist))).strip(" -|")
    return a or clean_artist(artist)


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text)


_FEAT_SPLIT = re.compile(r" ?[,&] ?| (?:and|x) ", re.I)


def lookup_credits(artist: str) -> tuple[str, list[str]]:
    """(primary artist, featured names) of a saved artist for lookups: "A feat. B & C" gives ("A", ["B", "C"]); names split on ",", "&", " and ", " x "."""
    primary = lookup_artist(artist)
    a = clean_artist(artist)
    m = _FEAT_KEY.search(a)
    if not m:
        return primary, []
    opener = a[m.start() - 1] if m.start() else ""
    if opener in _CLOSERS:
        close = a.find(_CLOSERS[opener], m.end())
        text = a[m.end() : len(a) if close < 0 else close]
    else:
        text = a[m.end() : _feat_end(a, m.end())]
    return primary, [n for n in (p.strip(" -|") for p in _FEAT_SPLIT.split(_squash(text))) if n]


_MULTI_ARTIST = re.compile(r" [-–—] |, ")


def artist_candidates(artist: str) -> list[str]:
    """Names to try for a lookup, never saved: the whole lookup artist first, then its first part when the string holds several artists (split on " - " or the legacy ", ")."""
    whole = lookup_credits(artist)[0]
    first = _MULTI_ARTIST.split(_squash(whole), 1)[0].strip(" -|")
    return [whole] if not first or first == whole else [whole, first]


def lookup_title(title: str) -> str:
    """The title for external lookups only: clean_title plus feat credits and version info (live, acoustic, unplugged, session, venue) removed; never shown or saved."""
    title = titleclean.clean(title or "")
    base = re.sub(r"\s+", " ", re.sub(r"[\(\[]\s*[\)\]]", "", _strip_feat(clean_title(title)))).strip(" -|")
    t = _drop_brackets(base, _is_version)
    t = _cut_version_tail(t)
    return re.sub(r"\s+", " ", t).strip(" -|") or base or clean_title(title)


def split_artist_title(artist: str, title: str) -> tuple[str, str]:
    artist, title = clean_artist(artist), clean_title(title)
    if not artist and " - " in title:
        a, _, t = title.partition(" - ")
        return clean_artist(a), clean_title(t)
    if artist and title.casefold().startswith(artist.casefold()):
        m = _SEP.match(title, len(artist))
        if m and title[m.end() :].strip():
            title = title[m.end() :].strip()
    return artist, title


_BRACKET = re.compile(r"[\(\[]([^\)\]]*)[\)\]]")
_REMIX_WORD = re.compile(r"\bremix\b|\bmashup\b|\bmixed\s+by\b", re.I)


RELEASE_TAG = re.compile(r"\s*+[(\[]\s*+([^()\[\]]*?\brelease)\s*+[)\]]\s*+$", re.I)
_RELEASE_TAG_TAIL = RELEASE_TAG
_RELEASE_SKIP = re.compile(r"\bremix(?:ed)?\b|\bmashup\b|\bmixed\s+by\b", re.I)


def release_tag(title: str) -> tuple[int, bool] | None:
    """(start of the trailing label release tag, whether it names a cover) for "(Magic Cover Release)" or "[NCS Release]"; None when the last bracket does not end in "Release" or holds a remix or mashup."""
    m = RELEASE_TAG.search(title)
    if not m or _RELEASE_SKIP.search(m.group(1)):
        return None
    return m.start(), bool(re.search(r"\bcover\b", m.group(1), re.I))
_SEGMENT_SEP = re.compile(r"( \| | - | \u2013 | \u2014 )")
_CUE_DASH = re.compile(r" [-\u2013\u2014] ")
_FEAT_NORM = re.compile(r"\b(?:featuring|feat|ft)\b(\.?)", re.I)
_NUMBER = re.compile(r"\d[\d.,'\"\u2032\u2033]*", re.ASCII)


def _prev_is_number(text: str, end: int) -> bool:
    i = end
    while i > 0 and text[i - 1] in " \t":
        i -= 1
    j = i
    while j > 0 and not text[j - 1].isspace():
        j -= 1
    return j < i and _NUMBER.fullmatch(text, j, i) is not None


def _is_feat_keyword(text: str, m: re.Match) -> bool:
    if _prev_is_number(text, m.start()):
        return False
    if m.group(1) or m.group(0).lower() == "featuring":
        return True
    i = m.end()
    while i < len(text) and text[i].isspace():
        i += 1
    return i < len(text) and (text[i].isupper() or text[i].isdigit())


def _has_feat_keyword(text: str) -> bool:
    return any(_is_feat_keyword(text, m) for m in _FEAT_NORM.finditer(text))


def normalize_feat(text: str) -> str:
    """Rewrite each feat/ft/featuring keyword to "feat."; not after a number ("5 ft tall"), and bare feat/ft only before a capital or digit; names and the rest stay verbatim."""
    return _FEAT_NORM.sub(lambda m: "feat." if _is_feat_keyword(text, m) else m.group(0), text)


def _cut_remix_segment(title: str) -> tuple[str, str | None]:
    parts = _SEGMENT_SEP.split(title)
    if len(parts) < 5:
        return title, None
    for i in range(2, len(parts), 2):
        seg = parts[i].strip()
        if seg and _REMIX_WORD.search(seg):
            return "".join(parts[: i - 1] + parts[i + 1 :]).strip(), seg
    return title, None


def cut_remix(title: str) -> tuple[str, str | None]:
    """Cut the remix out of a title: the first bracket whose text has the word "remix" or "mashup" or the phrase "mixed by", else the first later segment (split by spaced | - \u2013 \u2014) that has it; return (title without it, its text)."""
    if not isinstance(title, str):
        return "", None
    for m in _BRACKET.finditer(title):
        inner = m.group(1).strip()
        if inner and _REMIX_WORD.search(inner):
            rest = f"{title[: m.start()]} {title[m.end() :]}"
            return re.sub(r"\s+", " ", rest).strip(" -|"), inner
    return _cut_remix_segment(title)


_VERSION_WORDS = r"remix(?:ed)?|mix|edit|mashup|bootleg|rework|vip|dub|live|acoustic|unplugged|instrumental|remaster(?:ed)?|cover|extended|slowed|sped[\s-]?up|speed[\s-]?up|nightcore|reverb"
_VERSION_MARK = re.compile(rf"\b(?:{_VERSION_WORDS}|version)\b", re.I)
_VERSION_WORD = re.compile(rf"\b(?:{_VERSION_WORDS})\b", re.I)
_RELEASE_END = re.compile(r"\brelease\s*$", re.I)


def _is_version_group(inner: str) -> bool:
    return bool(_VERSION_WORD.search(inner)) and not _RELEASE_END.search(inner) and not _FEAT_KEY.match(inner) and not titleclean._is_noise(inner)


def cut_version(title: str) -> tuple[str, str | None]:
    """cut_remix, else the first of the title's trailing bracket groups (round or square, only whitespace between them and the end) whose text holds a known version word (remix, mix, edit, rework, bootleg, vip, dub, mashup, extended, live, acoustic, unplugged, instrumental, remaster(ed), cover, slowed, sped up, speed up, nightcore, reverb) as a whole word and is not promo noise, a "... Release" tag or a feat. credit; later version groups stay in the title; return (title without it, its text)."""
    cut, remix = cut_remix(title)
    if remix or not isinstance(title, str):
        return cut, remix
    tail: list[re.Match[str]] = []
    pos = len(title.rstrip())
    for m in reversed(list(_BRACKET.finditer(title))):
        if title[m.end() : pos].strip():
            break
        tail.append(m)
        pos = m.start()
    for m in reversed(tail):
        inner = m.group(1).strip()
        if inner and _is_version_group(inner):
            rest = re.sub(r"\s+", " ", f"{title[: m.start()]} {title[m.end() :]}").strip(" -|")
            if rest:
                return rest, inner
    return title, None


def marker_before_dash(title: str) -> bool:
    """True when a bracket naming a version (remix, edit, live, cover, ...) sits left of the first spaced dash outside brackets: "Title [X Remix] feat. Y - Artist" (ADD-135)."""
    blanked = _BRACKET.sub(lambda m: "x" * len(m.group()), title)
    m = _CUE_DASH.search(blanked)
    return bool(m) and any(_VERSION_MARK.search(b.group(1)) for b in _BRACKET.finditer(title[: m.start()]))


def lead_artist(title: str) -> tuple[str, str] | None:
    """(artist, title) when the title is exactly "Artist - Title" with one spaced dash (hyphen, en or em dash) and non-empty sides, and neither side starts like a version or noise word ("Live - ...", "Song - Live at ..."); else None."""
    t = clean_title(title)
    parts = _CUE_DASH.split(t)
    if len(parts) != 2:
        return None
    left, right = parts[0].strip(), parts[1].strip()
    if not left or not right or _VERSION_MARK.search(left) or _NOISE_WORD.search(left) or _NUMBER.fullmatch(left):
        return None
    if _VERSION_MARK.match(right) or _VERSION_KEY.match(f"- {right}"):
        return None
    return clean_artist(left), clean_title(right)


def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)).casefold()


def _title_first(artist: str, title: str, cut: str) -> tuple[str, str] | None:
    """(title, artist) of a reversed "Title [Version] feat. X - Artist" when the after-dash part is a plain name and the uploader equals it, or a version bracket sits before the dash and the uploader is not the before-dash part; else None."""
    t = clean_title(cut)
    m = _CUE_DASH.search(t)
    if not m:
        return None
    left, right = t[: m.start()].strip(), t[m.end() :].strip()
    if not left or not right or _CUE_DASH.search(right) or _BRACKET.search(right) or _FEAT_KEY.search(right):
        return None
    up = _fold(clean_artist(artist))
    is_left = bool(up) and up == _fold(clean_artist(_strip_feat(left)))
    if is_left or not (up and up == _fold(clean_artist(right)) or marker_before_dash(title)):
        return None
    return left, right


def split_title(artist: str, title: str) -> tuple[str, str, str | None]:
    """Cut the remix or another version (cut_version) out of the title, then split artist and title as split_artist_title does; a feat credit left of the first spaced dash makes that left part the artist when nothing else split; a reversed "Title [Version] feat. X - Artist" is read title first (ADD-135)."""
    cut, remix = cut_version(title)
    reversed_ = _title_first(artist, title, cut)
    if reversed_:
        return normalize_feat(clean_artist(reversed_[1])), normalize_feat(reversed_[0]), remix
    a, t = split_artist_title(artist, cut)
    if a == clean_artist(artist) and t == clean_title(cut):
        m = _CUE_DASH.search(t)
        if m and (_has_feat_keyword(t[: m.start()]) or _RELEASE_TAG_TAIL.search(t)) and t[m.end() :].strip():
            a, t = t[: m.start()].strip(), clean_title(t[m.end() :])
    return normalize_feat(a), normalize_feat(t), remix


def lookup_query(artist: str, title: str) -> tuple[str, list[str], str]:
    """(artist, artist names to try, title) as the external lookups should ask for a saved artist and title."""
    artist, title = split_artist_title(artist, title)
    return artist, artist_candidates(artist), lookup_title(title)
