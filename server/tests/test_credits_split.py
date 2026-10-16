import json
from pathlib import Path

import pytest

from app import credits, credits_split

CASES = json.loads((Path(__file__).parent / "fixtures" / "credits_split_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES["join"], ids=lambda c: c["text"] or "empty")
def test_join_names(case):
    assert credits.join_names(case["names"]) == case["text"]


@pytest.mark.parametrize("case", CASES["split"], ids=lambda c: f"{c['artist']}|{c['title']}|{c['remixer']}")
def test_suggest(case):
    assert credits_split.suggest(case["artist"], case["title"], case["remixer"]) == case["expect"]


@pytest.mark.parametrize("case", CASES["review"], ids=lambda c: json.dumps(c["raw"], ensure_ascii=False)[:60])
def test_review_flags(case):
    assert credits_split.review_flags(case["raw"]) == case["flags"]


def test_suggest_tolerates_none_everywhere():
    assert credits_split.suggest(None, None, None)["artists"] == []


def test_suggestion_is_a_value_it_never_mutates_inputs():
    raw = {"title": "T (feat. X)", "artist": "A & B", "remixer": "Z Remix"}
    before = dict(raw)
    credits_split.suggest(raw["artist"], raw["title"], raw["remixer"])
    credits_split.review_flags(raw)
    assert raw == before


def test_flags_are_returned_in_the_documented_order():
    flags = credits_split.review_flags({"title": "S (feat. X) (Live) (Remix)", "artist": "A & B feat. C", "remixer": "Mixed By Q", "remix_year": 2012, "year": 1500})
    assert flags == [f for f in credits_split.FLAGS if f in flags]
    assert {"feat_in_artist", "feat_in_title", "multi_artist_in_one_pill", "mixed_by", "live", "year_out_of_range"} <= set(flags)
