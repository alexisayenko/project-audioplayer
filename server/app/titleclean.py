"""Remove promo noise ("[Free Download]", "(Official Video)", "| Premiere") from a song title.

Twin of web/js/title-clean.js; both are driven by server/tests/fixtures/title_clean_cases.json. Change them together."""

from __future__ import annotations

import re

_NOISE = (
    "free download", "free dl", "free d/l", "free dl!", "download", "free", "free track", "free release", "premiere", "premiered",
    "exclusive", "out now", "out soon", "available now", "buy", "buy now", "hd", "hq", "4k", "1080p", "720p", "60fps", "official",
    "official video", "official music video", "official audio", "official lyric video", "official visualizer", "official video clip",
    "lyrics", "lyric video", "with lyrics", "video", "audio", "visualizer", "music video", "mv", "clip", "video clip", "full song",
    "full version", "high quality", "hq audio",
)
_WORDS = frozenset(
    "free download dl premiere premiered exclusive hd hq 4k 1080p 720p 480p 360p 60fps official lyrics lyric visualizer mv audio video "
    "music clip with out now soon available buy new full song high quality the".split()
)
_STRONG = frozenset(
    "free download dl premiere premiered exclusive hd hq 4k 1080p 720p 480p 360p 60fps official lyrics lyric visualizer mv video audio clip".split()
)
_PROMO = ("free download", "free dl", "free d/l", "free dl!", "out now", "premiere")

_PUNCT = re.compile(r"[\W_]+")
_PARTS = re.compile(r"[/,&+]")
_GROUP = re.compile(r"[(\[{【][^()\[\]{}【】]*[)\]}】]")
_SEG = re.compile(r"(\s+(?:\||｜|//|/|／|-|–|—)\s+)")
_TAIL = re.compile(r"[\s|/\-–—]+$")
_HEAD = re.compile(r"^[\s|/\-–—]+")
_WS = re.compile(r"\s+")


def _norm(s: str) -> str:
    return _PUNCT.sub(" ", s.lower()).strip()


_NOISE_SET = frozenset(_norm(n) for n in _NOISE)
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


def clean_ex(title: str) -> tuple[str, list[str]]:
    """(cleaned title, the removed pieces as written). Never empty: when cleaning would empty it the original stays."""
    original = _WS.sub(" ", title or "").strip()
    s = title or ""
    removed: list[str] = []
    while True:
        before = s
        changed = True
        while changed:
            changed = False

            def drop(m: re.Match) -> str:
                nonlocal changed
                if _is_noise(m.group()[1:-1]):
                    removed.append(_WS.sub(" ", m.group()))
                    changed = True
                    return " "
                return m.group()

            s = _GROUP.sub(drop, s)
        if s != before:
            s = _HEAD.sub("", _TAIL.sub("", _WS.sub(" ", s).strip()))
        parts = _SEG.split(s)
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
        if joined != s:
            s = _TAIL.sub("", joined)
        s = _WS.sub(" ", s).strip()
        if s == before.strip() or s == _WS.sub(" ", before).strip():
            break
    if not s:
        return original, []
    return s, removed


def clean(title: str) -> str:
    return clean_ex(title)[0]
