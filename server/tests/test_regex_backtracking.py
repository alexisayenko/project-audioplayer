import time

from app import credit_title, wiki_lookup


def test_bracket_tail_normal_cases():
    cases = {
        "Song (Live)": "Song",
        "Song [Remix]": "Song",
        "Song (a) (b)": "Song (a)",
        "Song (Live)  ": "Song",
        "Song": "Song",
        "Song (x": "Song (x",
        "Song x)": "Song x)",
        "": "",
    }
    for text, expected in cases.items():
        assert wiki_lookup._strip_bracket_tail(text) == expected, text


def elapsed(fn):
    start = time.perf_counter()
    fn()
    return time.perf_counter() - start


def test_adversarial_inputs_stay_linear():
    n = 20000
    big_space = "a" + " " * n + "b"
    big_open = "(" * n
    assert elapsed(lambda: credit_title._NAME_SEP.split(big_space)) < 1
    assert elapsed(lambda: credit_title._VS.split(big_space)) < 1
    for text in (big_space, big_open, "[" * n, "(" * n + "x", ") " * n, "(a" * (n // 2), "(" * n + ")", "[(" * (n // 2) + "]"):
        assert elapsed(lambda: wiki_lookup._strip_bracket_tail(text)) < 1, text[:8]
