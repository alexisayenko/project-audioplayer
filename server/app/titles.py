"""Pure helpers that turn a YouTube channel + raw video title into a clean artist and title."""

from __future__ import annotations

import re

_NOISE = re.compile(
    r"[\(\[][^\)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|remaster(ed)?|h[dq]|4k|clip|mv)\b[^\)\]]*[\)\]]",
    re.I,
)
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
    t = _NOISE.sub("", title or "")
    t = re.sub(r"[\(\[]\s*[\)\]]", "", t)
    return re.sub(r"\s+", " ", t).strip(" -|")


_VERSION_BRACKET = re.compile(
    r"[\(\[](?=[^)\]]*\b(?:live|unplugged|in concert)\b|\s*(?:acoustic|sessions?|at)\b)[^)\]]*[\)\]]",
    re.I,
)
_VERSION_TAIL = re.compile(r"(?<!\s)\s+(?:-\s+(?:live|acoustic|unplugged|sessions?|in concert)|live (?:at|from|in|on))\b.*$", re.I)


def lookup_artist(artist: str) -> str:
    """The artist for external lookups only: clean_artist without feat/ft/featuring credits; never shown or saved."""
    a = re.sub(r"\s+", " ", _strip_feat(clean_artist(artist))).strip(" -|")
    return a or clean_artist(artist)


_FEAT_SPLIT = re.compile(r"\s*[,&]\s*|\s+(?:and|x)\s+", re.I)


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
    return primary, [n for n in (p.strip(" -|") for p in _FEAT_SPLIT.split(text)) if n]


def lookup_title(title: str) -> str:
    """The title for external lookups only: clean_title plus feat credits and version info (live, acoustic, unplugged, session, venue) removed; never shown or saved."""
    base = re.sub(r"\s+", " ", re.sub(r"[\(\[]\s*[\)\]]", "", _strip_feat(clean_title(title)))).strip(" -|")
    t = _VERSION_BRACKET.sub("", base)
    t = _VERSION_TAIL.sub("", t)
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
_REMIX_WORD = re.compile(r"\bremix\b", re.I)


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
    """Cut the remix out of a title: the first bracket whose text has the word "remix", else the first later segment (split by spaced | - \u2013 \u2014) that has it; return (title without it, its text)."""
    if not isinstance(title, str):
        return "", None
    for m in _BRACKET.finditer(title):
        inner = m.group(1).strip()
        if inner and _REMIX_WORD.search(inner):
            rest = f"{title[: m.start()]} {title[m.end() :]}"
            return re.sub(r"\s+", " ", rest).strip(" -|"), inner
    return _cut_remix_segment(title)


def split_title(artist: str, title: str) -> tuple[str, str, str | None]:
    """Cut the remix out of the title, then split artist and title as split_artist_title does; a feat credit left of the first spaced dash makes that left part the artist when nothing else split."""
    cut, remix = cut_remix(title)
    a, t = split_artist_title(artist, cut)
    if a == clean_artist(artist) and t == clean_title(cut):
        m = _CUE_DASH.search(t)
        if m and _has_feat_keyword(t[: m.start()]) and t[m.end() :].strip():
            a, t = t[: m.start()].strip(), clean_title(t[m.end() :])
    return normalize_feat(a), normalize_feat(t), remix
