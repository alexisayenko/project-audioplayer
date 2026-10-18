import itertools
import re
import time

from app import credit_title, wiki_lookup

OLD_NAME_SEP = re.compile(r"\s*,\s*|\s+(?:&|\+|x|[aA][nN][dD]|[vV][sS]\.?)\s+")
OLD_VS = re.compile(r"\s+vs\.?\s+", re.I)
OLD_BRACKET_TAIL = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]\s*$")

PIECES = ["a", "B", "x", "X", "and", "AND", "Vs", "vs.", "&", "+", ",", " ", "  ", "\t", "\n", "(", ")", "[", "]", "é", "-"]


def variants(limit):
    for n in range(1, limit + 1):
        for combo in itertools.product(PIECES, repeat=n):
            yield "".join(combo)


def corpus():
    yield from variants(3)
    for s in ["A, B & C", "A  ,  B x C", "A and B AND C", "A vs. B vs C", " vs ", "A\tvs\nB", "Song (feat. X)", "Song [Remix]  ", "Song (a) (b) ", "((x)", "(x))", "  (x)  ", "a ( b ", "a  (b)\n", "a (b)\n\n", "x vs y", "ſ"]:
        yield s


def test_name_sep_split_unchanged():
    for s in corpus():
        assert credit_title._NAME_SEP.split(s) == OLD_NAME_SEP.split(s), repr(s)


def test_vs_split_unchanged():
    for s in corpus():
        assert credit_title._VS.split(s) == OLD_VS.split(s), repr(s)


def test_bracket_tail_sub_unchanged():
    for s in corpus():
        assert wiki_lookup._BRACKET_TAIL.sub("", s) == OLD_BRACKET_TAIL.sub("", s), repr(s)


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
    assert elapsed(lambda: wiki_lookup._BRACKET_TAIL.sub("", big_space)) < 1
    assert elapsed(lambda: wiki_lookup._BRACKET_TAIL.sub("", big_open)) < 1
