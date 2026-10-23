"""Deterministic clean-up of suggested `genre:` tags: drop values that are not genres, then canonicalise spelling."""

from __future__ import annotations

import re
from collections.abc import Iterable

from . import genre_vocab, genres

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


key = genre_vocab.key


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
    if v.casefold().endswith(" music") and key(v) not in _BUILTIN_BY_KEY and genre_vocab.lookup(v) is None:
        stripped = v[: -len(" music")].strip()
        return stripped or v
    return v


DROP: frozenset[str] = frozenset(
    key(v) for v in ("mkj", "deb", "stadiumx", "sam smith", "dancin", "relaxed", "love song", "progressive music", "underground music", "dystopian music",
        "comedy music", "comedy", "novelty music", "novelty song", "novelty", "popular", "underground", "cyberpunk",
        "aaron smith", "joris", "skrux", "medley", "music video", "party", "popcorn", "functional music", "event music", "party music", "west coast swing", "raggacore")
)
REMOVED_GENRES: tuple[str, ...] = (
    "audiobook", "brass & military", "brass and military", "brass band", "children", "children music",
    "children's", "childrens", "concert band", "dialogue", "education", "educational",
    "field recording", "interview", "karaoke", "kids", "kids music", "lullaby",
    "marches", "medical", "military", "military & brass", "military and brass", "monolog",
    "non music", "non-music", "nonmusic", "nursery rhymes", "pipe & drum", "poetry",
    "political", "promotional", "public service announcement", "radioplay", "religious", "sermon",
    "sound poetry", "soundtrack", "speech", "spoken", "spoken word", "story",
    "technical", "therapy", "trailer", "stage & screen", "stage and screen", "soundtracks", "film and tv", "stage, screen",
    "incidental music", "musical", "score", "film score", "theme", "vaudeville", "video game music", "industrial", "ethereal", "ethereal wave", "lo-fi", "epic",
    "dance & edm", "club", "electronica", "indietronica", "alternative dance", "rave",
)
DROP = DROP | frozenset(key(v) for v in REMOVED_GENRES)


def is_dropped(value: str) -> bool:
    """True for a junk tag removed from songs for good (TAG-073), compared by `key`."""
    return key(value) in DROP or key(_strip_music(value)) in DROP


def is_genre(value: str) -> bool:
    k = key(value)
    if k and k not in DROP and genre_vocab.lookup(value):
        return True
    if not k or k in DENY or k in DROP or _YEARISH.match(k):
        return False
    stripped = key(_strip_music(value))
    return bool(stripped) and stripped not in DENY and stripped not in DROP and not _YEARISH.match(stripped)


_DNB = "drum and bass"
_LIQUID_DNB = "liquid drum and bass"
_UPLIFTING_TRANCE = "uplifting trance"
_PROG_HOUSE = "progressive house"
ALIASES: dict[str, str] = {
    "punk rock": "punk",
    "electronic dance music": "edm",
    "euroda": "eurodance",
    "deep progressive": _PROG_HOUSE,
    "mor": "middle of the road",
    "retro-synth": "synthwave",
    "советская волна": "sovietwave",
    "советская-волна": "sovietwave",
    "melodic progressive house": _PROG_HOUSE,
    "hip-hop & rap": "hip hop",
    "rock and indie": "indie rock",
    "pop and chart": "pop",
    "russian electro pop": "synthpop",
    "russian electropop": "synthpop",
    "dnb": _DNB,
    "eurobeat": "eurodance",
    "electro-funk": "electro",
    "hair metal": "glam metal",
    "pop metal": "glam metal",
    "death/doom": "death-doom",
    "d&b": _DNB,
    "drum'n'bass": _DNB,
    "drum n bass music": _DNB,
    "drum & bass": _DNB,
    "drum n bass": _DNB,
    "euro pop": "europop",
    "euro-disco": "euro disco",
    "eurohouse": "euro house",
    "electronic pop": "synthpop",
    "festival progressive house": _PROG_HOUSE,
    "festival trap": "trap",
    "red disco": "disco",
    "intelligent dance music": "idm",
    "dance music": "edm",
    "club music": "edm",
    "electronic dance": "edm",
    "dance": "edm",
    "metal": "heavy metal",
    "psychedelic trance": "psytrance",
    "glam rock": "glam",
    "bebop": "bop",
    "chillout": "downtempo",
    "afro house": "house",
    "big room house": "house",
    "french touch": "french house",
    "melodic house": "house",
    "dream house": "dream trance",
    "chill step": "chillstep",
    "outrun music": "outrun",
    "ambient techno music": "ambient techno",
    "intelligent techno": "ambient techno",
    "outrun electro": "outrun",
    "space synth": "spacesynth",
    "synthdance": "spacesynth",
    "synthesizer dance": "spacesynth",
    "spacedance": "spacesynth",
    "bard": "singer-songwriter",
    "bard song": "singer-songwriter",
    "авторская песня": "singer-songwriter",
    "author song": "singer-songwriter",
    "dream dance": "dream trance",
    "anthem trance": _UPLIFTING_TRANCE,
    "epic trance": _UPLIFTING_TRANCE,
    "euphoric trance": _UPLIFTING_TRANCE,
    "bubblegum dance": "eurodance",
    "techstep": _DNB,
    "liquid funk": _LIQUID_DNB,
    "liquid dnb": _LIQUID_DNB,
    "liquid drum n bass": _LIQUID_DNB,
    "liquid drum & bass": _LIQUID_DNB,
    "breakbeat hardcore": "breakbeat",
    "jersey club": "breakbeat",
    "techno pop": "synthpop",
    "electropop": "synthpop",
}
_ALIAS_BY_KEY: dict[str, str] = {}
for _a, _t in ALIASES.items():
    _ALIAS_BY_KEY[key(_a)] = _t
    _ALIAS_BY_KEY.setdefault(key(_t), _t)

RETAGS: dict[str, str] = {
    "appalachian folk": "folk",
    "romantic": "classical",
    "psychedelic": "psychedelic rock",
    "nederpop": "pop",
    "orchestral": "modern classical",
    "alternative": "alternative rock",
    "indie": "indie rock",
    "dystopian": "darksynth",
    "progressive": "progressive rock",
    "⚈⚈": "glitch hop",
}
PROGRESSIVE = "progressive"
PROGRESSIVE_ELECTRONIC = _PROG_HOUSE
ELECTRONIC_CONTEXT: frozenset[str] = frozenset(key(v) for v in ("electronic", "club"))
_RETAG_BY_KEY: dict[str, str] = {key(_a): _t for _a, _t in RETAGS.items()}


PREFIXES: dict[str, tuple[str, str | None]] = {
    "russian": ("ru", "ru"), "british": ("gb", None), "dutch": ("nl", "nl"), "german": ("de", "de"),
    "french": ("fr", "fr"), "italian": ("it", "it"), "spanish": ("es", "es"), "swedish": ("se", "sv"),
    "polish": ("pl", "pl"), "ukrainian": ("ua", "uk"), "japanese": ("jp", "ja"), "korean": ("kr", "ko"),
    "brazilian": ("br", "pt"), "american": ("us", None), "finnish": ("fi", "fi"), "norwegian": ("no", "no"),
    "danish": ("dk", "da"), "greek": ("gr", "el"), "turkish": ("tr", "tr"), "portuguese": ("pt", "pt"),
    "czech": ("cz", "cs"), "irish": ("ie", None), "australian": ("au", None), "canadian": ("ca", None),
    "chinese": ("cn", "zh"), "icelandic": ("is", "is"),
}
KEEP: set[str] = {key(v) for v in ("uk garage", "british invasion")}


def split_prefix(value: str) -> tuple[str, str, str | None] | None:
    """`russian pop` gives `("pop", "ru", "ru")`: a leading demonym or language word is a country (and language), not a genre (TAG-074). None for aliases, KEEP names and single words. The genre is spelled as `_spelling` (before RETAGS)."""
    v = _strip_music(value)
    if key(v) in _ALIAS_BY_KEY or key(v) in KEEP or genre_vocab.lookup(v):
        return None
    first, _, rest = v.strip().partition(" ")
    hit = PREFIXES.get(first.casefold())
    rest = rest.strip()
    if not hit or not rest or key(rest) in DENY or key(rest) in DROP or _YEARISH.match(key(rest)):
        return None
    return _spelling(rest), hit[0], hit[1]


def _spelling(value: str) -> str:
    aliased = _ALIAS_BY_KEY.get(key(value))
    if aliased:
        return aliased
    sp = split_prefix(value)
    if sp:
        return sp[0]
    v = _strip_music(value)
    return genre_vocab.lookup(v) or _BUILTIN_BY_KEY.get(key(v), v)


def is_electronic(value: str) -> bool:
    """True when the genre sits under the former Electronic family: `ELECTRONIC_CONTEXT` (the raw source words `electronic` and `club`, which are not genres), or one of its vocabulary families has the legacy colour family Electronic (the group Others and every genre promoted out of it; `genre_vocab.families_of`, bare form or "<value> music")."""
    v = _spelling(value).lower()
    return key(v) in ELECTRONIC_CONTEXT or "Electronic" in genre_vocab.colour_families(genre_vocab.families_of(v))


def retag(value: str, song_genres: Iterable[str] = ()) -> str:
    """RETAGS by whole tag (TAG-075): a vague or non-genre tag becomes the named genre it stands for; `progressive` becomes progressive house when another `genre:` of the song is electronic (`is_electronic`), else progressive rock."""
    k = key(value)
    if k == key(PROGRESSIVE) and any(key(g) != k and is_electronic(g) for g in song_genres):
        return PROGRESSIVE_ELECTRONIC
    return _RETAG_BY_KEY.get(k, value)


def canonical(value: str, song_genres: Iterable[str] = ()) -> str:
    """One spelling per genre: ALIASES first, then a leading demonym is stripped (`split_prefix`), else strip a trailing " music" (unless the built-in list has that exact name) and use the built-in spelling when one matches; RETAGS last (`retag`, with the song's other `genre:` values for the `progressive` rule)."""
    return retag(_spelling(value), song_genres)


def vocabulary_name(value: str, song_genres: Iterable[str] = ()) -> str | None:
    """The canonical vocabulary name a genre value maps to (after ALIASES, prefix, " music" and RETAGS, TAG-071, TAG-075), else None (TAG-077)."""
    name = " ".join(canonical(value, song_genres).lower().split())
    return name if genre_vocab.is_canonical(name) else None


def unmappable(value: str, song_genres: Iterable[str] = ()) -> bool:
    """True when a stored `genre:` value is neither junk (TAG-073) nor mappable to the vocabulary (TAG-082)."""
    return not is_dropped(value) and vocabulary_name(value, song_genres) is None


def only_canonical(tags: list[str]) -> list[str]:
    """Drop `genre:` tags that are not in the vocabulary; other tags pass through (suggestions, TAG-079)."""
    out: list[str] = []
    values = [v for t in tags for ns, sep, v in [str(t).partition(":")] if sep and ns.strip().casefold() == "genre"]
    for t in tags:
        ns, sep, value = str(t).partition(":")
        if sep and ns.strip().casefold() == "genre":
            name = vocabulary_name(value, values)
            if name:
                out.append(f"genre:{name}")
        else:
            out.append(t)
    return out


def filter_tags(tags: list[str]) -> list[str]:
    """Drop non-genre `genre:` tags and canonicalise the rest, keeping order; other tags pass through. Duplicates are left to the caller's tag clean-up. Genres outside the vocabulary are dropped too (TAG-079): suggestions never offer them."""
    out: list[str] = []
    values = [v for t in tags for ns, sep, v in [str(t).partition(":")] if sep and ns.strip().casefold() == "genre"]
    for t in tags:
        ns, sep, value = str(t).partition(":")
        if sep and ns.strip().casefold() == "genre":
            if not is_genre(value):
                continue
            name = vocabulary_name(value, values)
            if name:
                out.append(f"genre:{name}")
        else:
            out.append(t)
    return out
