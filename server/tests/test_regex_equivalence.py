import time

import pytest

from app import credits_split, titles

PATTERNS = {
    "split": credits_split._SPLIT,
    "mashup_tail": credits_split._MASHUP_TAIL,
    "source_split": credits_split._SOURCE_SPLIT,
    "cover_tail": credits_split._COVER_TAIL,
    "mashup_by": credits_split._MASHUP_BY,
    "makers": credits_split._MAKERS,
    "release_tag": titles.RELEASE_TAG,
}

ADVERSARIAL = {
    "split": "a" + " " * 5000 + "!",
    "mashup_tail": " " * 5000 + "(mashup",
    "source_split": "a" + " " * 5000 + "!",
    "cover_tail": "a" + " " * 5000 + "!",
    "mashup_by": "a" + " " * 5000 + "!",
    "makers": "a" + " " * 5000 + "!",
    "release_tag": " " * 5000 + "(" + " " * 5000 + "x",
}


@pytest.mark.parametrize("name", sorted(ADVERSARIAL))
def test_adversarial_input_is_fast(name):
    text = ADVERSARIAL[name]
    new = PATTERNS[name]
    start = time.perf_counter()
    calls = (new.fullmatch,) if name == "mashup_by" else (new.search, new.split)
    for rx_call in calls:
        rx_call(text)
    assert time.perf_counter() - start < 1.0
