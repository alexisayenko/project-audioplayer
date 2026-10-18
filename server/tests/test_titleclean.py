import json
from pathlib import Path

import pytest

from app import titleclean
from app.titleclean import clean, clean_ex

CASES = json.loads((Path(__file__).parent / "fixtures" / "title_clean_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("raw,want", CASES)
def test_table(raw, want):
    assert clean(raw) == want


@pytest.mark.parametrize("raw,want", CASES)
def test_idempotent(raw, want):
    assert clean(clean(raw)) == clean(raw)


def test_enough_cases():
    assert len(CASES) >= 40


def test_removed_pieces():
    assert clean_ex("De Hofnar - Zonnestraal [Free Download]") == ("De Hofnar - Zonnestraal", ["[Free Download]"])
    assert clean_ex("Song") == ("Song", [])


def test_never_empty():
    assert clean_ex("[Free Download]") == ("[Free Download]", [])


def test_preview_fields(monkeypatch):
    from app.routes import lookup
    assert lookup.clean_preview_title({"title": "A - B [Free Download]"}) == {"title": "A - B", "title_raw": "A - B [Free Download]"}


def test_lookup_title_uses_it():
    from app.titles import lookup_title
    assert lookup_title("Song [Free Download]") == "Song"
    assert titleclean.clean("Song (Live) [HD]") == "Song (Live)"


_ALPHABET = [" ", " ", "\t", "\n", "-", "–", "|", "/", ",", "&", "(", ")", "1", "a", "x", "and", "live", "live at", "- live", "Live In", "acoustic", "ab"]


def _fuzz_strings(count=4000):
    import random

    rng = random.Random(20260414)
    for _ in range(count):
        yield "".join(rng.choice(_ALPHABET) for _ in range(rng.randint(0, 14)))


def test_rewritten_regexes_match_the_originals():
    import re

    from app import discogs_lookup, titleclean, titles

    old_seg = re.compile(r"((?<!\s)\s+(?:\||｜|//|/|／|-|–|—)\s+)")
    old_tail = re.compile(r"(?<![\s|/\-–—])[\s|/\-–—]+$")
    old_disambig = re.compile(r"(?<!\s)\s*\(\d+\)$")
    old_feat = re.compile(r"(?:(?<!\s)\s++)?[,&]\s*+|(?<!\s)\s++(?:and|x)\s++", re.I)
    old_multi = re.compile(r"(?<!\s)\s+[-–—]\s+|,\s+")
    old_version = re.compile(r"(?<!\s)\s++(?:-\s+(?:live|acoustic|unplugged|sessions?|in concert)|live (?:at|from|in|on))\b.*+$", re.I)

    def names(parts):
        flat = [" ".join(p.split()).strip(" -|") for p in parts]
        return [p for p in flat if p]

    for s in _fuzz_strings():
        assert titleclean._split_segments(s) == old_seg.split(s), repr(s)
        assert titleclean._rstrip_seps(s) == old_tail.sub("", s), repr(s)
        assert discogs_lookup._name(s) == discogs_lookup.genre_lookup._norm(old_disambig.sub("", s)), repr(s)
        assert names(titles._FEAT_SPLIT.split(titles._squash(s))) == names(old_feat.split(s)), repr(s)
        flat = titles._squash(s)
        assert titles._MULTI_ARTIST.split(flat, 1)[0].strip(" -|") == old_multi.split(flat, 1)[0].strip(" -|"), repr(s)
        assert titles._cut_version_tail(s) == old_version.sub("", s), repr(s)


def test_rewritten_regexes_stay_fast_on_long_runs():
    import time

    from app import titleclean, titles

    start = time.perf_counter()
    big = " " * 20000
    titleclean._split_segments(big + "x")
    titleclean._rstrip_seps("x" + "-" * 20000)
    titles.lookup_credits("A feat. " + big + "x")
    titles.artist_candidates(big + "x")
    titles._cut_version_tail(" live at" * 5000 + "\nz")
    assert time.perf_counter() - start < 2


def test_use_notes_are_reported_as_removed():
    assert clean_ex("Perfect (Exceeder) [Official Music Video] [Saltburn Soundtrack]") == (
        "Perfect (Exceeder)",
        ["[Official Music Video]", "[Saltburn Soundtrack]"],
    )
