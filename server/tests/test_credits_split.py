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
    assert credits_split.suggest(case["artist"], case["title"], case["remixer"], case.get("ctx")) == case["expect"]


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


def test_cover_parenthetical_original_performer_ambiguous():
    s = credits_split.suggest("Teemid", "Crazy feat. Joie Tan (Gnarls Barkley Cover)", None)
    assert s["version"] == {"kind": "cover", "name": "Gnarls Barkley Cover", "by": [], "of": ["Gnarls Barkley"]}
    perf = credits_split.suggest("Sofia Karlberg", "Writings On The Wall (sófia karlberg cover version)", None)
    assert perf["version"] == {"kind": "cover", "name": "sófia karlberg cover version", "by": []}
    assert "cover_performer" in perf["notes"]
    amb = credits_split.suggest("", "Song (X Cover)", None)
    assert amb["version"] == {"kind": "cover", "name": "X Cover", "by": []} and "cover_ambiguous" in amb["notes"]


def test_cover_rule_is_whole_word_and_parenthetical_only():
    assert credits_split.suggest("A", "Cover Me Up", None)["version"] is None
    assert credits_split.suggest("A", "Discovery (Recovery)", None)["version"] is None
    assert credits_split.suggest("A", "Song (Cover)", None)["version"].get("of") is None
    assert credits_split.suggest("Sam Smith", "Writings On The Wall", "Sofia Karlberg Cover")["version"].get("of") is None
    assert credits_split.suggest("A", "Song (Remix) (X Cover)", None)["version"]["kind"] == "remix"


def test_mashup_word_forms_and_non_matches():
    for text in ("(mashup)", "[Mash-Up]", "(MASH UP)"):
        s = credits_split.suggest("", f"Song - A, B {text}", None)
        assert s["version"]["kind"] == "mashup" and s["artists"] == ["A", "B"] and "mashup_makers_unknown" in s["notes"]
    for title in ("Discovery (Mashups)", "Mashup City", "Song (Mashup Remix)"):
        assert (credits_split.suggest("A", title, None)["version"] or {}).get("kind") != "mashup"


def test_mashup_never_guesses_sources_without_an_explicit_separator():
    s = credits_split.suggest("", "Кончится лето - Yaukoshi, LXST CXNTURY, Цой (mashup)", None)
    assert "of" not in s["version"] and s["title"] == "Кончится лето"


def test_cover_with_a_dash_uses_evidence_or_lists_both_readings():
    title = "Pharrell Williams - Happy (EFIX & ALLISON Cover)"
    known = credits_split.suggest("", title, None, {"original": ["Pharrell Williams"]})
    assert (known["artists"], known["title"], known["version"]["kind"], known["version"]["of"]) == (["EFIX", "ALLISON"], "Happy", "cover", ["Pharrell Williams"])
    assert "alternatives" not in known
    assert credits_split.suggest("", title, None, {"uploader": "EFIX"})["artists"] == ["EFIX", "ALLISON"]
    none = credits_split.suggest("", title, None)
    assert "cover_ambiguous" in none["notes"]
    assert [r["artists"] for r in none["alternatives"]] == [["EFIX", "ALLISON"], ["Pharrell Williams"]]
    crazy = credits_split.suggest("", "Teemid - Crazy feat. Joie Tan (Gnarls Barkley Cover)", None, {"original": ["Gnarls Barkley"]})
    assert (crazy["artists"], crazy["featured"], crazy["title"], crazy["version"]["of"]) == (["Teemid"], ["Joie Tan"], "Crazy", ["Gnarls Barkley"])
