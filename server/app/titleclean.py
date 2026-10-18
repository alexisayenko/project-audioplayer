"""Remove promo noise ("[Free Download]", "(Official Video)", "| Premiere") from a song title.

Twin of web/js/title-clean.js; both are driven by server/tests/fixtures/title_clean_cases.json. Change them together."""

from __future__ import annotations

import re

_NOISE = (
    "free download", "free dl", "free d/l", "free dl!", "download", "free", "free track", "free release", "premiere", "premiered",
    "exclusive", "out now", "out soon", "available now", "buy", "buy now", "hd", "hq", "4k", "1080p", "720p", "60fps", "official",
    "official video", "official music video", "official audio", "official lyric video", "official visualizer", "official video clip",
    "lyrics", "lyric video", "with lyrics", "video", "audio", "visualizer", "music video", "mv", "clip", "video clip", "full song",
    "full version", "high quality", "hq audio", "original mix", "original version", "original",
)
_WORDS = frozenset(
    "free download dl premiere premiered exclusive hd hq 4k 1080p 720p 480p 360p 60fps official lyrics lyric visualizer mv audio video "
    "music clip with out now soon available buy new full song high quality the".split()
)
_STRONG = frozenset(
    "free download dl premiere premiered exclusive hd hq 4k 1080p 720p 480p 360p 60fps official lyrics lyric visualizer mv video audio clip".split()
)
_PROMO = ("free download", "free dl", "free d/l", "free dl!", "out now", "premiere")
_USE_NOTE_WORDS = ("soundtrack", "ost", "original soundtrack", "score")
_USE_NOTE_LEADS = ("from", "theme from", "music from")

_PUNCT = re.compile(r"[\W_]+")
_PARTS = re.compile(r"[/,&+]")
_GROUP = re.compile(r"[(\[{【][^()\[\]{}【】]*[)\]}】]")
_SEP = re.compile(r"(?:\||｜|//|/|／|-|–|—)(?=\s)")
_SEP_CHARS = "|/-–—"
_HEAD = re.compile(r"^[\s|/\-–—]+")
_WS = re.compile(r"\s+")


def _norm(s: str) -> str:
    return _PUNCT.sub(" ", s.lower()).strip()


_NOISE_SET = frozenset(_norm(n) for n in _NOISE)
_USE_NOTE = re.compile(
    rf"\b(?:{'|'.join(re.escape(w) for w in _USE_NOTE_WORDS)})\b|^\s*(?:{'|'.join(re.escape(w) for w in _USE_NOTE_LEADS)})\s", re.I)
_TAIL_GROUP = re.compile(r"[(\[]([^()\[\]]*)[)\]]\s*$")
_PROMO_SET = frozenset(_norm(n) for n in _PROMO)


def _is_noise(text: str, allowed: frozenset[str] = _NOISE_SET) -> bool:
    whole = _norm(text)
    if not whole:
        return False
    if whole in allowed:
        return True
    parts = [_norm(p) for p in _PARTS.split(text)]
    parts = [p for p in parts if p]
    if len(parts) > 1 and all(p in allowed for p in parts):
        return True
    if allowed is _NOISE_SET:
        words = whole.split()
        return all(w in _WORDS for w in words) and any(w in _STRONG for w in words)
    return False


_RELEASE_KEEP = frozenset("cover covers remix remixed mashup mix mixed edit".split())


def _is_release_tag(text: str) -> bool:
    words = _norm(text).split()
    return len(words) > 1 and words[-1] == "release" and not _RELEASE_KEEP.intersection(words)


def _drop_noise_groups(s: str, removed: list[str]) -> str:
    changed = True

    def drop(m: re.Match) -> str:
        nonlocal changed
        if _is_noise(m.group()[1:-1]) or _is_release_tag(m.group()[1:-1]):
            removed.append(_WS.sub(" ", m.group()))
            changed = True
            return " "
        return m.group()

    while changed:
        changed = False
        s = _GROUP.sub(drop, s)
    return s


def _rstrip_seps(s: str) -> str:
    end = len(s)
    while end and (s[end - 1].isspace() or s[end - 1] in _SEP_CHARS):
        end -= 1
    return s[:end]


def is_use_note(text: str) -> bool:
    """True for the text of a bracket that only says where the song is used ("Saltburn Soundtrack", "Game OST", "From the Motion Picture", "Theme from X"); the whole word soundtrack, ost or score, or a start of from / theme from / music from."""
    return bool(_USE_NOTE.search(text))


def drop_use_notes(s: str, removed: list[str] | None = None) -> str:
    """Drops each trailing round or square bracket group (only whitespace after it) that is a use note, and the separators before it; never the group when nothing else would be left."""
    while True:
        base = s.rstrip()
        m = _TAIL_GROUP.search(base)
        if not m or not is_use_note(m.group(1)):
            break
        head = _rstrip_seps(base[: m.start()])
        if not head.strip():
            break
        if removed is not None:
            removed.append(_WS.sub(" ", m.group()))
        s = head
    return s


def _split_segments(s: str) -> list[str]:
    """Text and separators alternately: a separator is `|`, `/`, `//`, `-`, an en or em dash set off by whitespace on both sides."""
    parts: list[str] = []
    keep = 0
    for m in _SEP.finditer(s):
        start = m.start()
        while start > 0 and s[start - 1].isspace():
            start -= 1
        end = m.end()
        while end < len(s) and s[end].isspace():
            end += 1
        if start < m.start() and start >= keep:
            parts += [s[keep:start], s[start:end]]
            keep = end
    return parts + [s[keep:]]


def _drop_noise_tail(s: str, removed: list[str]) -> str:
    parts = _split_segments(s)
    while len(parts) >= 3:
        sep = parts[-2].strip()
        if sep not in ("-", "–", "—"):
            allowed = _NOISE_SET
        else:
            allowed = _NOISE_SET if len(parts) >= 5 else _PROMO_SET
        if not _is_noise(parts[-1], allowed):
            break
        removed.append(parts[-1].strip())
        parts = parts[:-2]
    joined = "".join(parts)
    return _rstrip_seps(joined) if joined != s else s


def clean_ex(title: str) -> tuple[str, list[str]]:
    """(cleaned title, the removed pieces as written). Never empty: when cleaning would empty it the original stays."""
    original = _WS.sub(" ", title or "").strip()
    s = title or ""
    removed: list[str] = []
    while True:
        before = s
        s = _drop_noise_groups(s, removed)
        if s != before:
            s = _HEAD.sub("", _rstrip_seps(_WS.sub(" ", s).strip()))
        s = _drop_noise_tail(s, removed)
        s = drop_use_notes(s, removed)
        s = _WS.sub(" ", s).strip()
        if s == before.strip() or s == _WS.sub(" ", before).strip():
            break
    if not s:
        return original, []
    return s, removed


def clean(title: str) -> str:
    return clean_ex(title)[0]
