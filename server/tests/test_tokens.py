import json
from pathlib import Path

import pytest

from app import tokens

CASES = json.loads((Path(__file__).parent / "fixtures" / "token_cases.json").read_text(encoding="utf-8"))


def test_the_fixture_is_not_trivial():
    assert len(CASES) >= 60
    assert any(len(c["tokenize"]) > 2 for c in CASES)


@pytest.mark.parametrize("case", CASES, ids=[repr(c["input"]) for c in CASES])
def test_port_matches_the_web_tokenizer(case):
    assert tokens.tokenize(case["input"]) == case["tokenize"]
    assert tokens.split_tokens(case["input"]) == case["split"]
    assert tokens.join_tokens(case["split"]) == case["join"]


def test_none_and_non_strings_are_tolerated():
    assert tokens.tokenize(None) == [{"text": "", "sep": ""}]
    assert tokens.split_tokens(None) == []
    assert tokens.split_tokens(12) == ["12"]
    assert tokens.join_tokens(["A", None, " ", " B "]) == "A - B"


def test_ampersand_comma_and_feat_never_split():
    assert tokens.split_tokens("Nadia Ali, Starkillers & Alex Kenji") == ["Nadia Ali, Starkillers & Alex Kenji"]
    assert tokens.split_tokens("Kato feat. Jon") == ["Kato feat. Jon"]
    assert tokens.split_tokens("A - B / C | D") == ["A", "B", "C", "D"]
