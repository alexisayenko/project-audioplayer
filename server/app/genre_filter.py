"""Deterministic clean-up of suggested `genre:` tags: drop values that are not genres, then canonicalise spelling."""

from __future__ import annotations

import re
import unicodedata

from . import genres

_PLAIN = """
danish swedish german british american french dutch italian spanish norwegian finnish russian polish australian canadian brazilian japanese korean
irish scottish welsh english icelandic belgian austrian swiss portuguese greek turkish ukrainian czech slovak hungarian romanian bulgarian serbian croatian
mexican argentine argentinian colombian chilean cuban jamaican indian chinese taiwanese thai vietnamese indonesian filipino israeli arab arabic persian iranian
egyptian nigerian ghanaian kenyan african south african new zealand estonian latvian lithuanian slovenian european scandinavian nordic latin american
uk usa us u s u k united kingdom united states england britain germany france denmark sweden norway finland netherlands holland italy spain russia poland
australia canada brazil japan korea ireland scotland wales iceland belgium austria switzerland portugal greece turkey ukraine mexico argentina colombia
chile cuba jamaica china india israel london new york los angeles paris berlin stockholm copenhagen oslo helsinki amsterdam manchester chicago detroit
dj producer composer singer vocalist band duo group remixer instrumentalist musician artist songwriter rapper guitarist pianist drummer bassist
seen live favorites favourites favourite favorite love loved awesome good best beautiful great amazing cool nice fav faves under 2000 listeners
female vocalists male vocalists female vocalist male vocalist female male all albums i own my music own
english spanish french german italian portuguese russian japanese korean chinese dutch swedish danish norwegian finnish polish arabic hindi turkish latin
music songs song single singles remix remixes cover covers live official
"""
_PHRASES = (
    "south african", "new zealand", "latin american", "united kingdom", "united states", "new york", "los angeles", "seen live",
    "under 2000 listeners", "female vocalists", "male vocalists", "female vocalist", "male vocalist", "albums i own", "my music",
)
_YEARISH = re.compile(r"^(\d{2}|\d{4})s?$")


def key(name: str) -> str:
    """Lowercase, accents folded, spaces and hyphens collapsed away."""
    folded = unicodedata.normalize("NFKD", name.casefold())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    return "".join(c for c in folded if c not in " -_\t")


def _build_deny() -> frozenset[str]:
    text = _PLAIN
    out = {key(p) for p in _PHRASES}
    for p in _PHRASES:
        text = text.replace(p, " ")
    out.update(key(w) for w in text.split())
    return frozenset(out)


DENY = _build_deny()
_BUILTIN_BY_KEY: dict[str, str] = {}
for _name in genres.BUILTIN:
    _BUILTIN_BY_KEY.setdefault(key(_name), _name)


def _strip_music(value: str) -> str:
    v = " ".join(value.split())
    if v.casefold().endswith(" music") and key(v) not in _BUILTIN_BY_KEY:
        stripped = v[: -len(" music")].strip()
        return stripped or v
    return v


def is_genre(value: str) -> bool:
    k = key(value)
    if not k or k in DENY or _YEARISH.match(k):
        return False
    stripped = key(_strip_music(value))
    return bool(stripped) and stripped not in DENY and not _YEARISH.match(stripped)


ALIASES: dict[str, str] = {
    "electronic dance music": "electronic dance",
    "punk rock": "punk",
}
_ALIAS_BY_KEY: dict[str, str] = {}
for _a, _t in ALIASES.items():
    _ALIAS_BY_KEY[key(_a)] = _t
    _ALIAS_BY_KEY.setdefault(key(_t), _t)


def canonical(value: str) -> str:
    """One spelling per genre: ALIASES first, else strip a trailing " music" (unless the built-in list has that exact name) and use the built-in spelling when one matches."""
    aliased = _ALIAS_BY_KEY.get(key(value))
    if aliased:
        return aliased
    v = _strip_music(value)
    return _BUILTIN_BY_KEY.get(key(v), v)


def filter_tags(tags: list[str]) -> list[str]:
    """Drop non-genre `genre:` tags and canonicalise the rest, keeping order; other tags pass through. Duplicates are left to the caller's tag clean-up."""
    out: list[str] = []
    for t in tags:
        ns, sep, value = str(t).partition(":")
        if sep and ns.strip().casefold() == "genre":
            if not is_genre(value):
                continue
            out.append(f"genre:{canonical(value)}")
        else:
            out.append(t)
    return out
