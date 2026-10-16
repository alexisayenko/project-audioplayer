"""Genre suggestions from what yt-dlp already returns for a YouTube video: its `tags`, `categories` and the hashtags in the title and description."""

from __future__ import annotations

import re
from typing import Any

from . import genre_filter, genre_vocab

SOURCE = "youtube"
MAX_GENRES = 3
_HASHTAG = re.compile(r"(?<![\w&#])#([^\W\d_][\w]*)", re.UNICODE)
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def _candidates(info: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for field in ("tags", "categories"):
        value = info.get(field)
        if isinstance(value, list):
            out += [str(v) for v in value if isinstance(v, str)]
    for text in (info.get("title"), info.get("description")):
        if isinstance(text, str):
            out += _HASHTAG.findall(text)
    return out


def _forms(raw: str) -> list[str]:
    spaced = " ".join(_CAMEL.sub(" ", raw.lstrip("#").replace("_", " ")).split())
    return [spaced, raw.lstrip("#")] if spaced != raw.lstrip("#") else [spaced]


def genre_of(raw: str) -> str | None:
    """The vocabulary genre a tag or hashtag stands for ("DeepHouse" gives "deep house"), else None."""
    for form in _forms(raw):
        if not form.strip() or not genre_filter.is_genre(form):
            continue
        name = genre_filter.vocabulary_name(form)
        if name:
            return name
    return None


def suggest(info: dict[str, Any], artist: str = "", title: str = "") -> list[str]:
    """`genre:` tags found in the video's tags, categories and hashtags, in order and unique, at most MAX_GENRES; names equal to the artist or title are skipped."""
    own = {genre_vocab.key(v) for v in (artist, title) if v}
    found: list[str] = []
    for raw in _candidates(info):
        if genre_vocab.key(raw) in own:
            continue
        name = genre_of(raw)
        if name and f"genre:{name}" not in found:
            found.append(f"genre:{name}")
        if len(found) >= MAX_GENRES:
            break
    return found
