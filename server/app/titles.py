"""Pure helpers that turn a YouTube channel + raw video title into a clean artist and title."""

from __future__ import annotations

import re

_NOISE = re.compile(
    r"[\(\[][^\)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|remaster(ed)?|hd|hq|4k|live|clip|mv)\b[^\)\]]*[\)\]]",
    re.I,
)
_FEAT = re.compile(r"[\(\[]?\b(?:feat\.?|ft\.?|featuring)\s.*$", re.I)
_SEP = re.compile(r"\s+(?:-|●●)\s+")


def clean_artist(artist: str) -> str:
    a = re.sub(r"-\s*Topic$", "", (artist or "").rstrip(), flags=re.I)
    a = re.sub(r"VEVO\s*$", "", a, flags=re.I)
    a = _FEAT.sub("", a)
    a = re.sub(r"\s+", " ", a).strip()
    stripped = a[: -len(" official")] if a.casefold().endswith(" official") else a
    return stripped.strip() or a


def clean_title(title: str) -> str:
    t = _NOISE.sub("", title or "")
    t = _FEAT.sub("", t)
    t = re.sub(r"[\(\[]\s*[\)\]]", "", t)
    return re.sub(r"\s+", " ", t).strip(" -|")


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


def cut_remix(title: str) -> tuple[str, str | None]:
    """Cut the first bracket whose text contains the word "remix"; return (title without it, its inner text)."""
    if not isinstance(title, str):
        return "", None
    for m in _BRACKET.finditer(title):
        inner = m.group(1).strip()
        if inner and _REMIX_WORD.search(inner):
            rest = f"{title[: m.start()]} {title[m.end() :]}"
            return re.sub(r"\s+", " ", rest).strip(" -|"), inner
    return title, None


def split_title(artist: str, title: str) -> tuple[str, str, str | None]:
    """Cut the remix bracket out of the title, then split artist and title as split_artist_title does."""
    cut, remix = cut_remix(title)
    a, t = split_artist_title(artist, cut)
    return a, t, remix
