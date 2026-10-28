"""Record labels of albums and songs (task-0120, KI3, DATA-209, API-312): an optional list of names such as "Parvati Records", stored as `labels` on the album and on the song. A release can have several labels. Not part of any search identity or duplicate check; included in the Library text search."""

from __future__ import annotations

import re
from typing import Any

MAX_LABELS = 10
MAX_LABEL = 100
_SPACES = re.compile(r"\s+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_DISAMBIG = re.compile(r"\s*\(\d+\)$")
_NOISE = frozenset({"not on label", "self-released", "self released", "selfreleased", "no label", "unknown label", "unknown"})
_NOT_ON_LABEL = "not on label"


def _name(value: Any) -> str:
    return _SPACES.sub(" ", value).strip() if isinstance(value, str) else ""


def _is_noise(name: str) -> bool:
    key = name.casefold()
    return key in _NOISE or key.startswith(_NOT_ON_LABEL)


def tidy(value: Any) -> list[str]:
    """The stored labels of a record: trimmed, spaces collapsed, control characters and over-long or non-text entries dropped, duplicates (ignoring case) removed, at most `MAX_LABELS`. Never raises."""
    items = value if isinstance(value, (list, tuple)) else []
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        name = _name(item)
        if not name or len(name) > MAX_LABEL or _CONTROL.search(name) or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        out.append(name)
    return out[:MAX_LABELS]


def clean(value: Any, what: str = "labels") -> list[str]:
    """The labels of a request: None or an empty list is `[]`; a non-list, a non-text entry, a name longer than `MAX_LABEL`, one with a control character, or more than `MAX_LABELS` distinct names raises ValueError."""
    if value is None:
        return []
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"{what} must be a list of at most {MAX_LABELS} names")
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            raise ValueError(f"{what} must be a list of at most {MAX_LABELS} names")
        name = _SPACES.sub(" ", item).strip()
        if not name:
            continue
        if len(name) > MAX_LABEL or _CONTROL.search(name):
            raise ValueError(f"{what} names must be at most {MAX_LABEL} characters")
        if name.casefold() not in seen:
            seen.add(name.casefold())
            out.append(name)
    if len(out) > MAX_LABELS:
        raise ValueError(f"{what} must be a list of at most {MAX_LABELS} names")
    return out


def from_discogs(names: Any) -> list[str]:
    """Label names read from Discogs (`labels[].name`, or a search hit's `label` list): the " (2)" disambiguator is removed, "Not On Label" (also with a suffix such as "Not On Label (Artist Self-released)") and the self-released and unknown placeholders are dropped, the rest as `tidy`."""
    items = names if isinstance(names, (list, tuple)) else []
    kept = []
    for item in items:
        name = _DISAMBIG.sub("", _name(item))
        if name and not _is_noise(name):
            kept.append(name)
    return tidy(kept)


def fields(value: Any) -> dict[str, list[str]]:
    """`{"labels": [...]}` for a record, or `{}` when there are none (a song without labels carries no key)."""
    found = tidy(value)
    return {"labels": found} if found else {}
