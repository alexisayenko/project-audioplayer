import itertools
import json
import random
import re
import time
from pathlib import Path

from app import credits_split, titles

OLD_SPLIT = re.compile(r"\s*+[,&]\s*+|\s++(?:and|x|vs\.?)\s++", re.I)
OLD_MASHUP_TAIL = re.compile(r"\s*+[(\[]\s*+(mash[\s-]?up)\s*+[)\]]\s*+$", re.I)
OLD_SOURCE_SPLIT = re.compile(r"\s++(?:x|×|vs\.?)\s++", re.I)
OLD_MIX_TAIL = re.compile(r"^(?P<x>.*?)[\s,/-]*\b(?:mix|edit|version)\s*$", re.I)
OLD_COVER_TAIL = re.compile(r"^(.*?)[\s,:-]*+\bcover(?:\s++version)?+\s*+$", re.I)
OLD_RELEASE_TAG = re.compile(r"\s*+[(\[]\s*+([^()\[\]]*?\brelease)\s*+[)\]]\s*+$", re.I)

PIECES = [
    "a", "B", "x", "X", "×", "and", "AND", "vs", "Vs.", "&", ",", ":", "-", "/", " ", "  ", "\t", "\n", "(", ")", "[", "]",
    "mashup", "mash up", "mash-up", "mix", "Edit", "version", "cover", "Cover", "release", "Release", "é", "ſ",
]
FIXTURES = Path(__file__).parent / "fixtures"


def strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from strings(v)


def corpus():
    for n in range(1, 4):
        for combo in itertools.product(PIECES, repeat=n):
            yield "".join(combo)
    rng = random.Random(7)
    for _ in range(60000):
        yield "".join(rng.choice(PIECES) for _ in range(rng.randint(4, 14)))
    for name in ("credits_split_cases.json", "credit_title_cases.json", "title_clean_cases.json"):
        for s in strings(json.loads((FIXTURES / name).read_text(encoding="utf-8"))):
            yield s
            yield f"  {s}  "
            yield s.replace(" ", "   ")


def found(pattern, s, how):
    if how == "split":
        return pattern.split(s), [m.span() for m in pattern.finditer(s)]
    m = getattr(pattern, how)(s)
    return (m.span(), m.groups()) if m else None


def check(new, old, how):
    for s in corpus():
        assert found(new, s, how) == found(old, s, how), repr(s)


def test_split_unchanged():
    check(credits_split._SPLIT, OLD_SPLIT, "split")


def test_source_split_unchanged():
    check(credits_split._SOURCE_SPLIT, OLD_SOURCE_SPLIT, "split")


def test_mashup_tail_unchanged():
    check(credits_split._MASHUP_TAIL, OLD_MASHUP_TAIL, "search")


def test_mix_tail_unchanged():
    check(credits_split._MIX_TAIL, OLD_MIX_TAIL, "match")


def test_cover_tail_unchanged():
    check(credits_split._COVER_TAIL, OLD_COVER_TAIL, "match")


def test_release_tag_unchanged():
    check(titles.RELEASE_TAG, OLD_RELEASE_TAG, "search")


def elapsed(fn):
    start = time.perf_counter()
    fn()
    return time.perf_counter() - start


def test_adversarial_inputs_stay_fast():
    n = 30000
    spaces = " " * n
    cases = [
        (credits_split._SPLIT.split, spaces + "q"),
        (credits_split._SOURCE_SPLIT.split, "a" + spaces + "q"),
        (credits_split._MASHUP_TAIL.search, spaces + "q"),
        (credits_split._MIX_TAIL.match, spaces + "q"),
        (credits_split._MIX_TAIL.match, ("- " * n) + "q"),
        (credits_split._COVER_TAIL.match, ("a" + spaces) * 3 + "q"),
        (titles.RELEASE_TAG.search, spaces + "q"),
    ]
    for fn, text in cases:
        assert elapsed(lambda: fn(text)) < 1.0, (fn, text[:10])
