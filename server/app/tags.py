"""Helpers for `namespace:value` tags."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from typing import Any


def namespace(tag: Any) -> str:
    """The trimmed, casefolded namespace of `ns:value`; "" for a plain tag."""
    key, sep, _ = str(tag).partition(":")
    return key.strip().casefold() if sep else ""


def namespaced_values(tags: Iterable[Any], ns: str) -> Iterator[str]:
    """The value part of every `ns:` tag."""
    for tag in tags:
        key, sep, value = str(tag).partition(":")
        if sep and key.strip().casefold() == ns:
            yield value
