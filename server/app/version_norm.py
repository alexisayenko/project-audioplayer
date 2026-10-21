"""One spelling for remaster versions (EC1): every "Remastered", "re-mastered", "Digital Remaster", "Remastered Version" becomes `remaster`, with the 4-digit year first when there is one ("2011 remaster")."""

from __future__ import annotations

import re

from .tokens import join_tokens, split_tokens

_YEAR = r"(?:19|20)\d{2}"
_CORE = r"(?:digital(?:ly)?[\s-]+)?re[\s-]?master(?:ed)?"
_REMASTER = re.compile(
    rf"(?<![\w-])(?:(?P<before>{_YEAR})(?:\s+|\s*[,(]\s*))?{_CORE}(?:\s*[,(]?\s*(?P<after>{_YEAR})\)?)?(?:\s+(?:version|edition))?(?![\w-])",
    re.I,
)
_PART_SPLIT = re.compile(r"\s*[,;]\s*")
_WRAPPED = re.compile(r"[(\[]\s*([^()\[\]]+?)\s*[)\]]")


def _canonical(m: re.Match[str]) -> str:
    year = m.group("before") or m.group("after")
    return f"{year} remaster" if year else "remaster"


def _part(p: str) -> str:
    wrapped = _WRAPPED.fullmatch(p)
    if wrapped and _REMASTER.fullmatch(wrapped.group(1)):
        p = wrapped.group(1)
    return _REMASTER.sub(_canonical, p)


def normalize_version(text: str) -> str:
    """The version label with every remaster phrase spelled `<year> remaster` or `remaster`; any other text is returned unchanged. When the label has several parts ("Radio Edit, 2011 Remastered") the parts are rejoined in the pill style ("Radio Edit - 2011 remaster")."""
    if not isinstance(text, str) or not text.strip():
        return text
    parts = [p for token in split_tokens(text) for p in _PART_SPLIT.split(token) if p]
    out = [_part(p) for p in parts]
    if out == parts:
        return text
    return join_tokens(out)
