import time

from app import album_youtube, credit_title, wiki_lookup


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


def test_album_title_patterns_stay_linear():
    n = 20000
    texts = (" " * n + "x", "x" + " " * n, "x" + " - " * n, "x" + " , " * n, "x" + " (" * n, "x" + " [" * n)
    for name in ("_NOISE_GROUP", "_NOISE_TAIL", "_SEP", "_TOPIC", "_TRAIL_ROUND", "_TRAIL_YEAR"):
        pattern = getattr(album_youtube, name)
        for text in texts:
            assert elapsed(lambda: pattern.sub("", text)) < 1, (name, text[:6])
    for text in texts + ("[" * n, "[]" * n, "]" * n, "x" + " [a]" * n):
        assert elapsed(lambda: album_youtube._strip_trail_square(text)) < 1, text[:6]
    for text in texts:
        assert elapsed(lambda: album_youtube._strip_brackets(text)) < 1, text[:6]


def test_strip_trail_square_matches_the_old_pattern():
    import re
    old = re.compile(r"(?<!\s)\s*\[[^\]]*\]\s*$")
    cases = ["", " ", "[", "]", "[]", " []", "a[b]", "a [b] ", "a [b]\n", "[a][b]", "a [b] [c]", "a [b]]", "a ]b[", "a [[b]", "a [b] ", "  [x]", "[x] y", "a [b] c]", "[a [b] ]", "x [] []"]
    for text in cases:
        assert album_youtube._strip_trail_square(text) == old.sub("", text), repr(text)


def test_strip_brackets_cases():
    cases = {
        "Album (2011 Remastered)": "Album",
        "Album (Mono) [Live]": "Album [Live]",
        "Album  (Bonus Track)x": "Albumx",
        "(Stereo)": "",
        "Album (a (b) c)": "Album (a (b) c)",
        "Album (open": "Album (open",
    }
    for text, expected in cases.items():
        assert album_youtube._strip_brackets(text) == expected, text
