import time

from app import credits_split, titles


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
