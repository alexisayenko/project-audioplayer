import pytest

from app.titles import split_title

CH = "Melodic Techno & Progressive Trance Anthem Rework | Sadrican"


def test_example_from_channel():
    assert split_title(CH, "Delerium - Innocente (Sadrican 2026 Remix)") == (CH, "Delerium - Innocente", "Sadrican 2026 Remix")


def test_square_brackets():
    assert split_title("X", "A - B [Sadrican Remix]") == ("X", "A - B", "Sadrican Remix")


def test_remix_then_noise():
    assert split_title("", "A - B (Sadrican Remix) (Official Video)") == ("A", "B", "Sadrican Remix")


def test_first_remix_bracket_wins():
    assert split_title("", "A - B (Foo Remix) [Bar Remix]")[2] == "Foo Remix"


def test_remix_bracket_in_middle_collapses_spaces():
    assert split_title("", "A - B (Foo Remix) Live Edit") == ("A", "B Live Edit", "Foo Remix")


def test_channel_prefix_removed_after_cut():
    assert split_title("Gnarls Barkley", "Gnarls Barkley - Crazy (Foo Remix)") == ("Gnarls Barkley", "Crazy", "Foo Remix")


def test_case_insensitive_and_accents():
    assert split_title("", "A - B (DJ Tiësto's REMIX)") == ("A", "B", "DJ Tiësto's REMIX")


@pytest.mark.parametrize("t", ["A - B (Extended Mix)", "A - B (Club Mix)", "A - B [Bootleg]", "A - B (Rework)", "A - B (Remastered)", "Remix Song", "A - B (Remixed)"])
def test_non_remix_untouched(t):
    assert split_title("", t)[2] is None


def test_noise_bracket_still_stripped_when_remix_is_elsewhere():
    assert split_title("", "A - B (Live) [Foo Remix]") == ("A", "B (Live)", "Foo Remix")


def test_empty_input():
    assert split_title("", "") == ("", "", None)
    assert split_title(None, None) == ("", "", None)
