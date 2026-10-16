"""Pill tokenizer, a port of web/js/tokens.js (ADD-071); server/tests/fixtures/token_cases.json keeps the two equal."""

from __future__ import annotations

from typing import Any

SEPARATOR = " - "
_WS = frozenset("\t\n\v\f\r                  　﻿")
_DASHES = frozenset("-–—")
_PIPES = frozenset("|｜")
_SLASHES = frozenset("/／")


def _ws(s: str, i: int) -> bool:
    return 0 <= i < len(s) and s[i] in _WS


def js_strip(text: str) -> str:
    start, end = 0, len(text)
    while start < end and text[start] in _WS:
        start += 1
    while end > start and text[end - 1] in _WS:
        end -= 1
    return text[start:end]


def _core_length(s: str, i: int) -> int:
    c = s[i]
    if not (i > 0 and _ws(s, i - 1)):
        return 0
    if c in _DASHES or c in _PIPES:
        return 1 if _ws(s, i + 1) else 0
    if c not in _SLASHES:
        return 0
    length = 2 if i + 1 < len(s) and s[i + 1] in _SLASHES else 1
    return length if _ws(s, i + length) else 0


def _separator_end(s: str, start: int, length: int) -> int:
    end = start + length
    while True:
        while end < len(s) and s[end] in _WS:
            end += 1
        more = _core_length(s, end) if end < len(s) else 0
        if not more:
            return end
        end += more


def tokenize(text: Any) -> list[dict[str, str]]:
    s = "" if text is None else str(text)
    out: list[dict[str, str]] = []
    start = 0
    i = 0
    while i < len(s):
        length = _core_length(s, i)
        if not length:
            i += 1
            continue
        sep_start = i
        while sep_start > start and s[sep_start - 1] in _WS:
            sep_start -= 1
        end = _separator_end(s, i, length)
        out.append({"text": s[start:sep_start], "sep": s[sep_start:end]})
        start = end
        i = end
    out.append({"text": s[start:], "sep": ""})
    return out


def split_tokens(text: Any) -> list[str]:
    return [js_strip(t["text"]) for t in tokenize(text) if js_strip(t["text"]) != ""]


def join_tokens(parts: list[Any]) -> str:
    cleaned = [js_strip("" if p is None else str(p)) for p in parts]
    return SEPARATOR.join(p for p in cleaned if p)
