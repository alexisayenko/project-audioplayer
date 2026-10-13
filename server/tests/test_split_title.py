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


@pytest.mark.parametrize(
    "raw,want",
    [
        ("Song (feat. X)", "Song"),
        ("Song [ft. X]", "Song"),
        ("Song feat. X", "Song"),
        ("Song featuring X Y", "Song"),
        ("Artist Feat. Jon - Title", "Artist - Title"),
        ("Song ft. X (Remix by Y)", "Song (Remix by Y)"),
        ("Song ft. X | Live", "Song | Live"),
        ("Defeat Of The Day", "Defeat Of The Day"),
    ],
)
def test_feat_credit_stops_at_its_own_boundary_for_lookups(raw, want):
    from app.titles import lookup_title

    assert lookup_title(raw) == want


def test_clean_title_and_artist_keep_feat():
    from app.titles import clean_artist, clean_title

    assert clean_title("Song (feat. X)") == "Song (feat. X)"
    assert clean_artist("Kato feat. Jon") == "Kato feat. Jon"


def test_lookup_artist_drops_feat():
    from app.titles import lookup_artist

    assert lookup_artist("Kato Feat. Jon") == "Kato"
    assert lookup_artist("Defeat") == "Defeat"


EXAMPLE = "Kato Feat. Jon - Turn The Lights Off | Jon Hamm Club Dance Scene | DEEPO Remix Long Version"


def test_example_feat_noise_and_segment_remix():
    assert split_title("DEEPO Music", EXAMPLE) == (
        "Kato Feat. Jon",
        "Turn The Lights Off | Jon Hamm Club Dance Scene",
        "DEEPO Remix Long Version",
    )


def test_remix_segment_after_pipe():
    assert split_title("", "A - B | X Remix") == ("A", "B", "X Remix")
    assert split_title("Chan", "A - B | X Remix") == ("Chan", "A - B", "X Remix")


def test_first_segment_remix_not_cut():
    assert split_title("Chan", "Remix Mania - B")[2] is None
    assert split_title("Chan", "X Remix")[2] is None


def test_feat_cue_with_bracket_remix():
    assert split_title("Chan", "Artist ft. X - Title (Y Remix)") == ("Artist ft. X", "Title", "Y Remix")


def test_no_cue_no_split():
    assert split_title("Chan", "Warriors Dance - The Prodigy") == ("Chan", "Warriors Dance - The Prodigy", None)
    assert split_title("Chan", "Defeat - Song")[0] == "Chan"


def test_song_feat_bracket_kept_in_title():
    assert split_title("Chan", "Song (feat. X)") == ("Chan", "Song (feat. X)", None)
