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


@pytest.mark.parametrize(
    "channel,raw,want",
    [
        ("RÜFÜS DU SOL", "RÜFÜS DU SOL ●● Innerbloom (Official Video)", ("RÜFÜS DU SOL", "Innerbloom", None)),
        ("Gnarls Barkley Official", "Gnarls Barkley - Crazy (Official Video)", ("Gnarls Barkley", "Crazy", None)),
        (
            "DEEPO Music",
            EXAMPLE,
            ("Kato feat. Jon", "Turn The Lights Off | Jon Hamm Club Dance Scene", "DEEPO Remix Long Version"),
        ),
    ],
    ids=["example_1", "example_2", "example_3"],
)
def test_reference_examples(channel, raw, want):
    assert split_title(channel, raw) == want


def test_two_segments_remix_word_stays_in_title():
    assert split_title("", "Daft Punk - Around The World Remix") == ("Daft Punk", "Around The World Remix", None)
    assert split_title("Chan", "Daft Punk - Around The World Remix") == ("Chan", "Daft Punk - Around The World Remix", None)


def test_remix_segment_after_pipe():
    assert split_title("", "A - B | X Remix") == ("A", "B", "X Remix")
    assert split_title("Chan", "A - B | X Remix") == ("Chan", "A - B", "X Remix")


def test_first_segment_remix_not_cut():
    assert split_title("Chan", "Remix Mania - B")[2] is None
    assert split_title("Chan", "X Remix")[2] is None


def test_feat_cue_with_bracket_remix():
    assert split_title("Chan", "Artist ft. X - Title (Y Remix)") == ("Artist feat. X", "Title", "Y Remix")


def test_no_cue_no_split():
    assert split_title("Chan", "Warriors Dance - The Prodigy") == ("Chan", "Warriors Dance - The Prodigy", None)
    assert split_title("Chan", "Defeat - Song")[0] == "Chan"


def test_song_feat_bracket_kept_in_title():
    assert split_title("Chan", "Song (feat. X)") == ("Chan", "Song (feat. X)", None)


@pytest.mark.parametrize(
    "raw,want",
    [
        ("Kato Feat. Jon - Song", ("Kato feat. Jon", "Song")),
        ("Kato FEAT Jon - Song", ("Kato feat. Jon", "Song")),
        ("Kato feat Jon - Song", ("Kato feat. Jon", "Song")),
        ("Kato Ft. Jon - Song", ("Kato feat. Jon", "Song")),
        ("Kato ft Jon - Song", ("Kato feat. Jon", "Song")),
        ("Kato FT. Jon - Song", ("Kato feat. Jon", "Song")),
        ("Kato featuring Jon - Song", ("Kato feat. Jon", "Song")),
        ("Kato Featuring Jon - Song", ("Kato feat. Jon", "Song")),
        ("Kato feat. Jon - Song", ("Kato feat. Jon", "Song")),
    ],
)
def test_feat_keyword_normalised_in_artist(raw, want):
    assert split_title("Chan", raw)[:2] == want


def test_feat_keyword_normalised_in_title_and_whole_word_only():
    assert split_title("Chan", "Song (Ft. X)")[1] == "Song (feat. X)"
    assert split_title("Chan", "Artist featuring X")[1] == "Artist feat. X"
    assert split_title("Chan", "Defeat Fifth Softly")[1] == "Defeat Fifth Softly"


def test_lookup_handles_both_feat_forms():
    from app.titles import lookup_artist

    assert lookup_artist("Kato feat. Jon") == lookup_artist("Kato Feat. Jon") == "Kato"


@pytest.mark.parametrize(
    "raw,want",
    [
        ("5 ft tall", "5 ft tall"),
        ("6.5 ft Jon", "6.5 ft Jon"),
        ("5 ft. tall", "5 ft. tall"),
        ("Kato ft Jon", "Kato feat. Jon"),
        ("Kato ft jon", "Kato ft jon"),
        ("Song (ft X)", "Song (feat. X)"),
        ("Artist ft. x", "Artist feat. x"),
        ("Artist Feat 2Pac", "Artist feat. 2Pac"),
    ],
)
def test_normalize_feat_skips_feet_and_lowercase_bare_forms(raw, want):
    from app.titles import normalize_feat

    assert normalize_feat(raw) == want


@pytest.mark.parametrize("t", ["Song (Mixed By DJ Gvozd)", "Song [mixed by DJ Gvozd]", "Song (MIXED BY DJ Gvozd)"])
def test_mixed_by_bracket(t):
    assert split_title("", t) == ("", "Song", t[6:-1])


def test_mixed_by_segment_after_pipe():
    assert split_title("", "A - B | Mixed By DJ Gvozd") == ("A", "B", "Mixed By DJ Gvozd")


@pytest.mark.parametrize("t", ["A - B (Mixed)", "A - B (Mixed Version)", "A - B (Extended Mix)"])
def test_mixed_without_by_untouched(t):
    assert split_title("", t)[2] is None
