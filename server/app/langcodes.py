"""ISO 639-3 -> 639-1 mapping for the `lang:` tag namespace."""

from __future__ import annotations

import re

IGNORED = {"mul", "zxx", "und", "mis"}

ISO3_TO_1 = {
    "eng": "en", "rus": "ru", "ukr": "uk", "bel": "be", "pol": "pl", "ces": "cs", "slk": "sk", "slv": "sl",
    "hrv": "hr", "srp": "sr", "bos": "bs", "bul": "bg", "mkd": "mk", "ron": "ro", "hun": "hu", "lit": "lt",
    "lav": "lv", "est": "et", "fin": "fi", "swe": "sv", "nor": "no", "nob": "nb", "nno": "nn", "dan": "da",
    "isl": "is", "nld": "nl", "deu": "de", "fra": "fr", "spa": "es", "por": "pt", "ita": "it", "cat": "ca",
    "ell": "el", "tur": "tr", "heb": "he", "ara": "ar", "fas": "fa", "hin": "hi", "ben": "bn", "urd": "ur",
    "tam": "ta", "tel": "te", "tha": "th", "vie": "vi", "ind": "id", "msa": "ms", "zho": "zh", "jpn": "ja",
    "kor": "ko", "gle": "ga", "cym": "cy", "eus": "eu", "glg": "gl", "sqi": "sq", "hye": "hy", "kat": "ka",
    "aze": "az", "kaz": "kk", "uzb": "uz", "lat": "la", "afr": "af", "swa": "sw", "yid": "yi", "mlt": "mt",
}

_SUBTAG = re.compile(r"^([a-z]{2,3})[-_][a-z0-9]+$")


def to_lang_code(raw: str) -> str | None:
    """Normalise a language value to ISO 639-1 (639-3 when no 2-letter code exists); None if unusable."""
    v = str(raw or "").strip().lower()
    m = _SUBTAG.match(v)
    if m:
        v = m.group(1)
    if not re.fullmatch(r"[a-z]{2,3}", v) or v in IGNORED:
        return None
    return ISO3_TO_1.get(v, v)

_NAMES = """
en english
ru russian русский
uk ukrainian українська
be belarusian беларуская
pl polish polski
cs czech čeština
sk slovak slovenčina
sl slovenian slovene slovenščina
hr croatian hrvatski
sr serbian српски srpski
bg bulgarian български
ro romanian română
hu hungarian magyar
lt lithuanian lietuvių
lv latvian latviešu
et estonian eesti
fi finnish suomi
sv swedish svenska
no norwegian norsk
da danish dansk
is icelandic íslenska
nl dutch nederlands
de german deutsch
fr french français francais
es spanish español espanol
pt portuguese português portugues
it italian italiano
ca catalan català
el greek ελληνικά
tr turkish türkçe turkce
he hebrew עברית
ar arabic العربية
fa persian farsi فارسی
hi hindi हिन्दी
bn bengali bangla
ja japanese 日本語
ko korean 한국어
zh chinese mandarin 中文
vi vietnamese
th thai
id indonesian
ms malay
ka georgian ქართული
hy armenian հայերեն
az azerbaijani
kk kazakh қазақша
uz uzbek
la latin
ga irish
cy welsh
sq albanian
mt maltese
af afrikaans
sw swahili
yi yiddish
"""

NAME_TO_1: dict[str, str] = {}
for _line in _NAMES.strip().splitlines():
    _code, *_names = _line.split()
    for _n in _names:
        NAME_TO_1.setdefault(_n.casefold(), _code)


def canonical_lang(raw: str) -> str | None:
    """ISO 639-1 for a code, region-tagged code, English name or native name; None when unknown."""
    v = str(raw or "").strip().casefold()
    return NAME_TO_1.get(v) or to_lang_code(v)
