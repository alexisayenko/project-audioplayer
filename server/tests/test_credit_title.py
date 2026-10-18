import json
from pathlib import Path

import pytest

from app import credit_title

CASES = json.loads((Path(__file__).parent / "fixtures" / "credit_title_cases.json").read_text(encoding="utf-8"))["parse"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c['artist']} | {c['title']}")
def test_parse_table(case):
    got = credit_title.parse(case["artist"], case["title"], split_vs=case.get("splitVs", False))
    assert {k: got[k] for k in case["expect"]} == case["expect"]


SETTLED = [c for c in CASES if "feat" not in c["expect"]["title"].lower() or c["expect"]["title"] == c["title"]]


@pytest.mark.parametrize("case", SETTLED, ids=lambda c: f"{c['artist']} | {c['title']}")
def test_parse_is_idempotent(case):
    first = credit_title.parse(case["artist"], case["title"], split_vs=case.get("splitVs", False))
    again = credit_title.parse(" - ".join(first["mainArtists"]), first["title"], split_vs=case.get("splitVs", False))
    assert again["mainArtists"] == first["mainArtists"]
    assert again["title"] == first["title"]
    assert again["featuredArtists"] == [] and again["withArtists"] == []


def test_removed_lists_the_exact_groups():
    got = credit_title.parse("A", "T (feat. C) (with W)")
    assert got["removed"] == ["(with W)", "(feat. C)"]


def test_split_keeps_noise_and_returns_the_legacy_artist():
    got = credit_title.split("Gotye", "Somebody (feat. Kimbra) [Free Download]")
    assert got["title"] == "Somebody [Free Download]"
    assert got["artist"] == "Gotye feat. Kimbra"
    assert got["mainArtists"] == ["Gotye"]
    assert got["featuredArtists"] == ["Kimbra"]
    assert got["withArtists"] == []


def test_split_finds_a_group_hidden_behind_noise():
    got = credit_title.split("A", "T (feat. C) [NCS Release]")
    assert got["title"] == "T [NCS Release]"
    assert got["featuredArtists"] == ["C"]


def test_split_without_credits_returns_the_inputs_untouched():
    got = credit_title.split("A - B", "Sticks  & Stones ")
    assert got == {"artist": "A - B", "title": "Sticks  & Stones ", "mainArtists": ["A", "B"], "featuredArtists": [], "withArtists": []}


def test_split_cuts_a_pill_and_builds_the_legacy_artist():
    got = credit_title.split("Kato Feat. Jon", "Turn The Lights Off")
    assert (got["artist"], got["mainArtists"], got["featuredArtists"], got["title"]) == ("Kato feat. Jon", ["Kato"], ["Jon"], "Turn The Lights Off")


def test_split_with_names_in_the_legacy_artist():
    got = credit_title.split("A", "T (feat. C) (with W & X)")
    assert got["artist"] == "A feat. C with W & X"


def test_split_cuts_the_artist_at_vs_for_the_add_paths():
    got = credit_title.split("Mason vs Princess Superstar", "Perfect (Exceeder)")
    assert got["mainArtists"] == ["Mason", "Princess Superstar"]
    assert got["artist"] == "Mason vs Princess Superstar"


def test_parse_keeps_stored_vs_whole_by_default():
    assert credit_title.parse("A vs. B", "T")["mainArtists"] == ["A vs. B"]
