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
