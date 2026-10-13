"""Pure helpers that turn a YouTube channel + raw video title into a clean artist and title."""

from __future__ import annotations

import re

_NOISE = re.compile(
    r"[\(\[][^\)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|remaster(ed)?|hd|hq|4k|live|clip|mv)\b[^\)\]]*[\)\]]",
    re.I,
)
_FEAT = re.compile(r"\s*[\(\[]?\b(?:feat\.?|ft\.?|featuring)\s.*$", re.I)
_SEP = re.compile(r"\s+(?:-|●●)\s+")


def clean_artist(artist: str) -> str:
    a = re.sub(r"\s*-\s*Topic\s*$", "", artist or "", flags=re.I)
    a = re.sub(r"VEVO\s*$", "", a, flags=re.I)
    a = _FEAT.sub("", a)
    return re.sub(r"\s+", " ", a).strip()


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
