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
_REMIX_WORDS = {"remix", "bootleg", "rework", "flip", "refix", "vip"}
_GENERIC = {"official", "extended", "radio", "club", "original", "edit", "mix", "dub", "instrumental", "the", "a"}


def remix_hint(title: str, artist: str = "") -> dict[str, str | None] | None:
    """Suggest {original, remixer} from a bracketed "(Name Remix)" credit; None unless a strict keyword ends a bracket."""
    if not isinstance(title, str):
        return None
    for m in _BRACKET.finditer(title):
        words = m.group(1).split()
        if len(words) < 2 or words[-1].strip(".,;:!").casefold() not in _REMIX_WORDS:
            continue
        names = [w for w in words[:-1] if not re.fullmatch(r"\d{4}", w)]
        if names:
            names[-1] = re.sub(r"['’]s$", "", names[-1])
        remixer = " ".join(names).strip()
        if not remixer or all(w.casefold() in _GENERIC for w in names):
            continue
        head = _NOISE.sub("", title[: m.start()])
        head = re.sub(r"\s+", " ", head).strip(" -|")
        return {"original": head if " - " in head else None, "remixer": remixer}
    return None
