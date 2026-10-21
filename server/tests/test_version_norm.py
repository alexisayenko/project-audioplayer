import pytest

from app import credits, drafts
from app.version_norm import normalize_version

CASES = [
    ("(2024 Remastered)", "2024 remaster"),
    ("2024 Remastered", "2024 remaster"),
    ("2024 remaster", "2024 remaster"),
    ("Remastered 2009", "2009 remaster"),
    ("(Remastered)", "remaster"),
    ("Remastered", "remaster"),
    ("remastered", "remaster"),
    ("Remaster", "remaster"),
    ("Remastered Version", "remaster"),
    ("re-mastered", "remaster"),
    ("Re mastered", "remaster"),
    ("Digital Remaster", "remaster"),
    ("Digitally Remastered 1999 Edition", "1999 remaster"),
    ("2011 Remastered Version", "2011 remaster"),
    ("Radio Edit, 2011 Remastered", "Radio Edit - 2011 remaster"),
    ("Radio Edit 2011 Remastered", "Radio Edit 2011 remaster"),
    ("Netsky Remix", "Netsky Remix"),
    ("Live from the Royal Albert Hall", "Live from the Royal Albert Hall"),
    ("Deluxe Edition", "Deluxe Edition"),
    ("Unremastered", "Unremastered"),
    ("", ""),
]


@pytest.mark.parametrize(("text", "want"), CASES)
def test_normalize(text, want):
    assert normalize_version(text) == want
    assert normalize_version(want) == want


def test_title_bracket_and_plain_spelling_agree():
    a = drafts.parse_text("Deep Purple - Smoke On The Water (2024 remaster)")
    b = drafts.parse_text("Deep Purple - Smoke On The Water (2024 Remastered)")
    assert a["version"]["name"] == b["version"]["name"] == "2024 remaster"
    assert a["version"]["type"] == "remaster"


def test_clean_version_normalizes_name():
    out = credits._clean_version({"type": "remaster", "name": "Remastered 2009"}, None)
    assert out["name"] == "2009 remaster"
