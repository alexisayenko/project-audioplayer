import ast
import json
import random
import re
import time
from pathlib import Path

import pytest

from app import credits_split, titles, wiki_lookup

TESTS = Path(__file__).parent

OLD = {
    "split": (r"\s*,\s*|\s*&\s*|\s+and\s+|\s+x\s+|\s+vs\.?\s+", credits_split._SPLIT),
    "mashup_tail": (r"\s*[(\[]\s*(mash[\s-]?up)\s*[)\]]\s*$", credits_split._MASHUP_TAIL),
    "source_split": (r"\s+(?:x|×|vs\.?)\s+", credits_split._SOURCE_SPLIT),
    "cover_tail": (r"^(.*?)[\s,:-]*\bcover(?:\s+version)?\s*$", credits_split._COVER_TAIL),
    "mashup_by": (r"mash[\s-]?up\s+by\s+(?P<a>.+)|(?P<b>.+?)\s+mash[\s-]?up", credits_split._MASHUP_BY),
    "makers": (r"\s*,\s*|\s*&\s*|\s+and\s+|\s+x\s+|\s+feat\.?\s+|\s+ft\.?\s+", credits_split._MAKERS),
    "release_tag": (r"\s*[(\[]\s*([^()\[\]]*?\brelease)\s*[)\]]\s*$", titles.RELEASE_TAG),
    "wiki_bracket": (r"\s*\([^)]*\)\s*$", re.compile(r"\s*+\([^)]*+\)\s*+$")),
}


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(k)
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


def _corpus():
    out = set()
    for f in (TESTS / "fixtures").glob("*.json"):
        out.update(_strings(json.loads(f.read_text(encoding="utf-8"))))
    for f in TESTS.glob("test_*.py"):
        if f.name == Path(__file__).name:
            continue
        for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(n, ast.Constant) and isinstance(n.value, str):
                out.add(n.value)
    return {s for s in out if len(s) < 300}


def _generated():
    rnd = random.Random(7)
    seps = [" ", "  ", "\t", "\n", " , ", ",", " & ", "&", " and ", " x ", " X ", " vs ", " vs. ", " feat. ", " ft ", " feat ", " × ", " - ", " – ", " ", " "]
    words = ["Alpha", "Beta", "Земфира", "Мумий Тролль", "mashup", "mash up", "mash-up", "Mashup", "by", "cover", "Cover", "version", "release", "Release", "remix", "(", ")", "[", "]", ":", "-", "x", "and", "feat.", "Tiësto", "é"]
    out = []
    for _ in range(1500):
        out.append("".join(rnd.choice(words) + rnd.choice(seps) for _ in range(rnd.randint(1, 7))).rstrip(rnd.choice(["", " ", "\n"])))
    for w in ("(mashup)", "[ mash up ]", "(NCS Release)", "[Magic Cover Release]", "cover", "cover version", "x cover  ", "A - cover", "a  mashup", "mashup by X, Y", "Song (Band)  ", "Song ()"):
        out.append(w)
        out.append("  " + w + "  ")
        out.append("A" + " " * 40 + w)
    out.append(" " * 300)
    out.append("a" + " " * 300 + "x" + " " * 300 + "b")
    out.append("(" + "release " * 50 + ")")
    return out


INPUTS = sorted(_corpus() | set(_generated()))


def _view(rx, text):
    return (
        [(m.span(), m.groups(), m.groupdict()) for m in rx.finditer(text)],
        rx.split(text),
        rx.sub("|", text),
        [(m.span(), m.groups()) if m else None for m in (rx.match(text), rx.fullmatch(text))],
    )


@pytest.mark.parametrize("name", sorted(OLD))
def test_equivalent_to_old_pattern(name):
    old_src, new = OLD[name]
    old = re.compile(old_src, re.I if name != "wiki_bracket" else 0)
    assert len(INPUTS) > 1500
    for text in INPUTS:
        assert _view(new, text) == _view(old, text), text


ADVERSARIAL = {
    "split": "a" + " " * 5000 + "!",
    "mashup_tail": " " * 5000 + "(mashup",
    "source_split": "a" + " " * 5000 + "!",
    "cover_tail": "a" + " " * 5000 + "!",
    "mashup_by": "a" + " " * 5000 + "!",
    "makers": "a" + " " * 5000 + "!",
    "release_tag": " " * 5000 + "(" + " " * 5000 + "x",
    "wiki_bracket": "a" + " " * 5000 + "(b",
}


@pytest.mark.parametrize("name", sorted(ADVERSARIAL))
def test_adversarial_input_is_fast(name):
    text = ADVERSARIAL[name]
    new = OLD[name][1]
    start = time.perf_counter()
    calls = (new.fullmatch,) if name == "mashup_by" else (new.search, new.split)
    for rx_call in calls:
        rx_call(text)
    assert time.perf_counter() - start < 1.0
