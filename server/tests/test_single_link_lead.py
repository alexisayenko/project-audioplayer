from pathlib import Path

import pytest

from app import extractor, titles
from tests.test_credit_title_wiring import preview, real_preview  # noqa: F401
from tests.test_extractor_mapping import SC_INFO, SC_URL, ydl  # noqa: F401
from tests.test_library import H, VID, client  # noqa: F401

SOUNDTRACK = "Mason vs Princess Superstar - Perfect (Exceeder) [Official Music Video] [Saltburn Soundtrack]"


class TestPreviewReadsArtistDashTitle:
    def test_channel_that_is_the_artist(self, real_preview, client):
        p = preview(real_preview, client, "Mason - Exceeder (Original Mix)", uploader="Mason")
        assert (p["artist"], p["title"], p["mainArtists"]) == ("Mason", "Exceeder", ["Mason"])

    def test_vs_names_and_use_note_bracket(self, real_preview, client):
        p = preview(real_preview, client, SOUNDTRACK, uploader="Mason")
        assert p["mainArtists"] == ["Mason", "Princess Superstar"]
        assert p["title"] == "Perfect (Exceeder)"
        assert p["raw"]["title"] == SOUNDTRACK
        assert p["raw"]["artist"] == "Mason"

    def test_other_channel_gives_the_left_side(self, real_preview, client):
        p = preview(real_preview, client, "The Midnight - Love Is An Ocean (Lyrics)", uploader="WaveMusic")
        assert (p["artist"], p["title"], p["mainArtists"]) == ("The Midnight", "Love Is An Ocean", ["The Midnight"])
        assert p["raw"]["artist"] == "WaveMusic"
        assert p["suggested_credits"]["title"] is None
        assert p["suggested_credits"]["mainArtists"] == ["The Midnight"]

    def test_remix_bracket_still_becomes_the_version(self, real_preview, client):
        p = preview(real_preview, client, "Delerium - Innocente (Sadrican 2026 Remix)", uploader="Sadrican")
        assert (p["artist"], p["title"], p["remixer"]) == ("Delerium", "Innocente", "Sadrican 2026 Remix")

    def test_feat_in_the_title_part_moves_out(self, real_preview, client):
        p = preview(real_preview, client, "Artist - Song (feat. Guest)", uploader="Label")
        assert (p["mainArtists"], p["featuredArtists"], p["title"]) == (["Artist"], ["Guest"], "Song")

    @pytest.mark.parametrize("title, uploader, info", [
        ("Artist - Song - Extra", "Chan", {}),
        ("Artist - Song", "Artist - Topic", {"artist": "Artist", "track": "Song"}),
        ("Mason - Exceeder", "Chan", {"track": "Exceeder"}),
        ("Live - Anything", "Chan", {}),
        ("Song - Live at Wembley", "Chan", {}),
        ("07 - Song", "Chan", {}),
        ("Just a title", "Chan", {}),
    ])
    def test_unsplit_cases_keep_the_channel_artist(self, real_preview, client, title, uploader, info):
        p = preview(real_preview, client, title, uploader=uploader, **info)
        assert p["mainArtists"] == [extractor.titles.clean_artist(info.get("artist") or uploader)]

    def test_title_with_two_dashes_is_unchanged(self, real_preview, client):
        p = preview(real_preview, client, "Artist - Song - Extra", uploader="Chan")
        assert (p["artist"], p["title"]) == ("Chan", "Artist - Song - Extra")

    def test_channel_prefix_with_two_dashes_keeps_existing_reading(self, real_preview, client):
        p = preview(real_preview, client, "Chan - Song - Extra", uploader="Chan")
        assert (p["artist"], p["title"]) == ("Chan", "Song - Extra")

    def test_topic_channel_with_artist_data_is_not_split(self, real_preview, client):
        p = preview(real_preview, client, "A - B", uploader="Someone - Topic", artist="Someone", track="A - B")
        assert p["mainArtists"] == ["Someone"]
        assert p["title"] == "A - B"


class TestUseNoteBrackets:
    @pytest.mark.parametrize("title, want", [
        ("Soundtrack to My Life", ("Chan", "Soundtrack to My Life")),
        ("Artist - Soundtrack to My Life (Official Video)", ("Artist", "Soundtrack to My Life")),
        ("Soundtrack", ("Chan", "Soundtrack")),
        ("Score", ("Chan", "Score")),
    ])
    def test_names_with_the_words_stay(self, real_preview, client, title, want):
        p = preview(real_preview, client, title, uploader="Chan")
        assert (p["artist"], p["title"]) == want

    @pytest.mark.parametrize("note", ["[Game OST]", "(From the Motion Picture)", "(Theme from Foo)", "[Saltburn Soundtrack]"])
    def test_trailing_group_is_dropped(self, real_preview, client, note):
        assert preview(real_preview, client, f"Artist - Song {note}", uploader="Chan")["title"] == "Song"


class TestSoundCloudAndDownload:
    def test_soundcloud_probe_reads_artist_dash_title_without_artist_data(self, ydl):  # noqa: F811
        ydl.info = {**SC_INFO, "title": "The Midnight - Sunset (Original Mix) [Game OST]"}
        got = extractor.soundcloud_probe(SC_URL)
        assert (got["artist"], got["mainArtists"], got["title"]) == ("The Midnight", ["The Midnight"], "Sunset (Original Mix)")
        assert got["raw"]["artist"] == "some-artist"

    def test_soundcloud_probe_with_artist_data_or_two_dashes_is_unchanged(self, ydl):  # noqa: F811
        ydl.info = {**SC_INFO, "title": "A - B", "artist": "Real"}
        assert (extractor.soundcloud_probe(SC_URL)["artist"], extractor.soundcloud_probe(SC_URL)["title"]) == ("Real", "A - B")
        ydl.info = {**SC_INFO, "title": "A - B - C"}
        assert (extractor.soundcloud_probe(SC_URL)["artist"], extractor.soundcloud_probe(SC_URL)["title"]) == ("some-artist", "A - B - C")

    def test_youtube_download_fallback_reads_artist_dash_title(self, ydl, tmp_path):  # noqa: F811
        ydl.info = {"title": SOUNDTRACK, "uploader": "Mason"}
        d = extractor.download_audio(VID, Path(tmp_path))
        assert d["artist"] == "Mason vs Princess Superstar"
        ydl.info = {"title": "A - B", "uploader": "X", "artist": "Real"}
        d = extractor.download_audio(VID, Path(tmp_path))
        assert (d["artist"], d["title"]) == ("Real", "A - B")


@pytest.mark.parametrize("artist, title, lead, expected", [
    ("WaveMusic", "The Midnight - Love Is An Ocean (Lyrics)", True, ("The Midnight", "Love Is An Ocean", None)),
    ("WaveMusic", "The Midnight - Love Is An Ocean (Lyrics)", False, ("WaveMusic", "The Midnight - Love Is An Ocean", None)),
    ("Mason", "Mason - Exceeder", True, ("Mason", "Exceeder", None)),
    ("Chan", "A - B - C", True, ("Chan", "A - B - C", None)),
    ("Chan", "Chan - A - B", True, ("Chan", "A - B", None)),
    ("Chan", "Live - Anything", True, ("Chan", "Live - Anything", None)),
    ("Chan", "A - B (Foo Remix)", True, ("A", "B", "Foo Remix")),
])
def test_split_title_lead_flag(artist, title, lead, expected):
    assert titles.split_title(artist, title, lead=lead) == expected
