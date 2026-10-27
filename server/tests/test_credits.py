import copy
import json

import pytest

from app import credits, credits_v1, discogs_lookup, extractor, genre_lookup, guest, identify, library, metadata, metafill, wiki_lookup
from tests.test_extractor_mapping import ydl  # noqa: F401
from tests.test_guest import web
from tests.test_identify import MB_URL, wire
from tests.test_library import H, ODIR, OWNER_UID, VID, VID2, client  # noqa: F401


def migrated(**legacy):
    song = {"id": "aaaaaaaaaa1", "title": "T", **legacy}
    assert credits.ensure(song) is True
    return song


def test_join_names_skips_blank_names():
    assert credits.join_names(["A", "", "B"]) == "A & B"


@pytest.mark.parametrize("text, kind", [
    ("Alesso Remix", "remix"), ("Foo Mashup", "remix"), ("Mixed By DJ Gvozd", "other"), ("Mixed By DJ X Remix", "remix"),
    ("Gabriel & Dresden Chill Mix", "remix"), ("", "remix"), (None, "remix"),
])
def test_kind_for(text, kind):
    assert credits.kind_for(text) == kind


class TestFlatLegacyToV2:
    def test_artist_is_one_entry_per_pill_never_split_on_ampersand_comma_or_feat(self):
        assert migrated(artist="Nadia Ali, Starkillers & Alex Kenji")["mainArtists"] == ["Nadia Ali, Starkillers & Alex Kenji"]
        assert migrated(artist="Kato feat. Jon")["mainArtists"] == ["Kato feat. Jon"]
        assert migrated(artist="A - B / C")["mainArtists"] == ["A", "B", "C"]

    @pytest.mark.parametrize("artist", [None, "", "   ", 5, ["A"]])
    def test_blank_or_odd_artist_is_empty(self, artist):
        assert migrated(artist=artist)["mainArtists"] == []

    def test_title_is_untouched_and_featured_is_empty(self):
        song = migrated(title="Song (feat. X) (Alesso Remix)", artist="A")
        assert song["title"] == "Song (feat. X) (Alesso Remix)"
        assert song["featuredArtists"] == []
        assert "version" not in song

    @pytest.mark.parametrize("year, released", [(1999, 1999), ("1999", 1999), (True, None), (False, None), ("abc", None), (None, None), (2.0, 2), (2999, 2999), (1500, 1500)])
    def test_year_becomes_release_year(self, year, released):
        assert migrated(year=year)["releaseYear"] == released

    def test_remixer_becomes_a_remix_version_with_no_extra_artists(self):
        song = migrated(artist="A", remixer="Alesso Remix", year=2009, remix_year=2012)
        assert song["version"] == {"type": "remix", "name": "Alesso Remix", "artists": [], "releaseYear": 2012}
        assert song["releaseYear"] == 2009

    def test_mixed_by_is_other_unless_it_says_remix(self):
        assert migrated(remixer="Mixed By DJ Gvozd")["version"]["type"] == "other"
        assert migrated(remixer="Mixed By DJ Gvozd Remix")["version"]["type"] == "remix"

    def test_remixer_is_trimmed_and_blank_means_no_version(self):
        assert migrated(remixer="  Alesso Remix ")["version"]["name"] == "Alesso Remix"
        assert "version" not in migrated(remixer="   ")
        assert "version" not in migrated(remixer=None)

    def test_remix_year_without_remixer_is_an_other_version(self):
        assert migrated(remix_year=2012)["version"] == {"type": "other", "name": None, "artists": [], "releaseYear": 2012}

    def test_the_source_title_is_kept_and_the_composite_raw_dropped_when_the_artist_is_unchanged(self):
        song = migrated(artist="  A & B ", remixer="Alesso Remix", year="1999", remix_year=2012)
        assert song["rawTitle"] == "T"
        assert "raw" not in song
        assert credits.project(song)["artist"] == "A & B"

    def test_raw_stays_when_dropping_it_would_change_the_derived_artist(self):
        song = migrated(artist="A - B")
        assert song["mainArtists"] == ["A", "B"]
        assert song["raw"]["artist"] == "A - B"
        assert song["rawTitle"] == "T"
        assert credits.project(song)["artist"] == "A - B"

    def test_album_becomes_a_list(self):
        assert migrated(artist="A", album="Al")["albums"] == ["Al"]
        assert migrated(artist="A", album="  ")["albums"] == []
        assert migrated(artist="A", album=None)["albums"] == []
        assert migrated(artist="A")["albums"] == []

    def test_legacy_keys_are_removed_and_other_keys_and_order_kept(self):
        song = migrated(artist="A", album="Al", remixer=None, year=2000, bpm=120, updated_at="2026-01-01T00:00:00Z")
        for key in credits.LEGACY_KEYS:
            assert key not in song
        assert list(song) == ["id", "title", "mainArtists", "featuredArtists", "releaseYear", "rawTitle", "albums", "bpm", "updated_at"]
        assert song["updated_at"] == "2026-01-01T00:00:00Z"

    def test_ensure_is_idempotent(self):
        song = migrated(artist="A", remixer="X Remix", year=2000, remix_year=2001)
        again = copy.deepcopy(song)
        assert credits.ensure(again) is False
        assert again == song

    def test_ensure_converts_legacy_keys_left_on_a_structured_song(self):
        song = migrated(artist="A", year=2000)
        song["year"] = 2001
        assert credits.ensure(song) is True
        assert song["releaseYear"] == 2001
        assert "year" not in song


ADR24 = {
    "id": "aaaaaaaaaa1", "title": "T", "artists": ["A", "B"], "featured": ["C"], "released": 1999, "album": "Al",
    "version": {"kind": "cover", "name": "N", "by": ["X"], "year": 2012, "of": ["Orig"]},
    "raw": {"title": "T raw", "artist": "A - B", "remixer": "N"}, "tags": ["genre:house"],
}


class TestAdr0024ToV2:
    def test_every_key_is_renamed_in_place(self):
        song = copy.deepcopy(ADR24)
        assert credits.ensure(song) is True
        assert list(song) == ["id", "title", "mainArtists", "featuredArtists", "releaseYear", "albums", "version", "rawTitle", "tags"]
        assert song["mainArtists"] == ["A", "B"]
        assert song["featuredArtists"] == ["C"]
        assert song["releaseYear"] == 1999
        assert song["albums"] == ["Al"]
        assert song["rawTitle"] == "T raw"
        assert song["version"] == {"type": "cover", "name": "N", "artists": ["X"], "releaseYear": 2012, "originalArtists": ["Orig"]}

    def test_original_artists_only_for_cover_and_mashup_and_absent_when_empty(self):
        remix = {**ADR24, "version": {"kind": "remix", "name": "R", "by": [], "year": None, "of": ["Stray"]}}
        credits.ensure(remix)
        assert remix["version"] == {"type": "remix", "name": "R", "artists": [], "releaseYear": None}
        cover = {**ADR24, "version": {"kind": "cover", "name": None, "by": [], "year": None, "of": []}}
        credits.ensure(cover)
        assert "originalArtists" not in cover["version"]
        legacy_string = {**ADR24, "version": {"kind": "mashup", "name": None, "by": [], "year": None, "of": "Orig"}}
        credits.ensure(legacy_string)
        assert legacy_string["version"]["originalArtists"] == ["Orig"]

    def test_the_composite_raw_is_kept_only_when_the_derived_artist_would_change(self):
        song = {**copy.deepcopy(ADR24), "featured": []}
        credits.ensure(song)
        assert song["raw"]["artist"] == "A - B"
        assert credits.project(song)["artist"] == "A - B"
        plain = {**copy.deepcopy(ADR24), "featured": [], "raw": {"title": "T", "artist": "A & B"}}
        plain["artists"] = ["A & B"]
        credits.ensure(plain)
        assert "raw" not in plain
        assert plain["rawTitle"] == "T"

    def test_the_derived_legacy_fields_do_not_change(self):
        for song in (copy.deepcopy(ADR24), {**copy.deepcopy(ADR24), "featured": [], "album": None, "version": {"kind": "live", "name": None, "by": ["Q"], "year": None}}):
            before = credits_v1.project_v1(song)
            credits.ensure(song)
            assert credits.project(song) == before

    def test_ensure_is_idempotent(self):
        song = copy.deepcopy(ADR24)
        credits.ensure(song)
        again = copy.deepcopy(song)
        assert credits.ensure(again) is False
        assert again == song

    def test_old_keys_left_on_a_v2_song_are_absorbed(self):
        song = copy.deepcopy(ADR24)
        credits.ensure(song)
        song["artists"], song["released"], song["album"] = ["Old Name"], 2001, "New Al"
        assert credits.ensure(song) is True
        assert (song["mainArtists"], song["releaseYear"], song["albums"]) == (["Old Name"], 2001, ["New Al"])
        for key in ("artists", "released", "album"):
            assert key not in song


class TestProject:
    def test_empty_structure(self):
        song = {"title": "T", "mainArtists": [], "featuredArtists": [], "releaseYear": None}
        assert credits.project(song) == {"artist": None, "remixer": None, "year": None, "remix_year": None, "album": None}

    def test_artist_joins_and_features(self):
        base = {"title": "T", "featuredArtists": [], "releaseYear": 2009}
        assert credits.project({**base, "mainArtists": ["A", "B", "C"]})["artist"] == "A, B & C"
        assert credits.project({**base, "mainArtists": ["Kato"], "featuredArtists": ["Jon"]})["artist"] == "Kato feat. Jon"
        assert credits.project({**base, "mainArtists": ["A"], "featuredArtists": ["B", "C"]})["artist"] == "A feat. B & C"
        assert credits.project({**base, "mainArtists": ["A"]})["year"] == 2009

    def test_album_is_the_first_of_albums(self):
        song = {"title": "T", "mainArtists": ["A"], "albums": ["First", "Second"]}
        assert credits.project(song)["album"] == "First"
        assert credits.first_album({"albums": ["  "]}) is None

    def test_a_kept_raw_artist_round_trips_when_it_matches_the_pills(self):
        song = migrated(artist="  A - B ")
        assert credits.project(song)["artist"] == "A - B"
        song["mainArtists"] = ["Nadia Ali", "Starkillers"]
        assert credits.project(song)["artist"] == "Nadia Ali & Starkillers"

    def test_raw_artist_is_not_used_when_featured_exist(self):
        song = migrated(artist="A - B")
        song["featuredArtists"] = ["C"]
        assert credits.project(song)["artist"] == "A & B feat. C"

    @pytest.mark.parametrize("version, text", [
        ({"type": "remix", "name": "Alesso Remix", "artists": ["X"], "releaseYear": None}, "Alesso Remix"),
        ({"type": "remix", "name": None, "artists": ["A", "B"], "releaseYear": None}, "A & B"),
        ({"type": "live", "name": None, "artists": [], "releaseYear": None}, "Live"),
        ({"type": "cover", "name": None, "artists": [], "releaseYear": None, "originalArtists": ["X"]}, "Cover"),
        ({"type": "other", "name": None, "artists": [], "releaseYear": 2012}, None),
    ])
    def test_remixer_text(self, version, text):
        song = {"title": "T", "mainArtists": ["A"], "featuredArtists": [], "releaseYear": None, "version": version}
        assert credits.project(song)["remixer"] == text
        assert credits.project(song)["remix_year"] == version["releaseYear"]

    def test_legacy_only_song_projects_its_own_values(self):
        assert credits.project({"artist": " A ", "remixer": "", "year": 1999, "remix_year": None}) == {"artist": "A", "remixer": None, "year": 1999, "remix_year": None, "album": None}

    def test_artist_string_and_lookup_artist(self):
        song = {"title": "T", "mainArtists": ["B"], "featuredArtists": [], "releaseYear": None, "version": {"type": "cover", "name": None, "artists": [], "releaseYear": None, "originalArtists": ["A"]}}
        assert credits.artist_string(song) == "B"
        assert credits.lookup_artist(song) == "A"
        song["version"]["originalArtists"] = "Legacy"
        assert credits.lookup_artist(song) == "Legacy"
        song["version"] = {"type": "mashup", "name": None, "artists": [], "releaseYear": None, "originalArtists": ["S1", "S2"]}
        assert credits.lookup_artist(song) == "B"
        assert credits.release_year({"releaseYear": 1990, "mainArtists": []}) == 1990
        assert credits.release_year({"released": 1990, "artists": []}) == 1990
        assert credits.release_year({"year": 1991}) == 1991
        assert credits.version_type(song) == "mashup"
        assert credits.version_type({}) is None


def stored(**over):
    song = {"id": "aaaaaaaaaa1", "title": "T", "mainArtists": ["A", "B"], "featuredArtists": ["C"], "releaseYear": 1999, "albums": ["Al", "Deluxe"],
            "version": {"type": "remix", "name": "Alesso Remix", "artists": ["Alesso"], "releaseYear": 2012},
            "rawTitle": "T", "raw": {"title": "T", "artist": "A - B"}}
    song.update(over)
    return song


def applied(changes, **over):
    song = stored(**over)
    credits.apply_changes(song, changes)
    return song


class TestApplyChanges:
    def test_structure_replaces_and_main_artists_alone_keeps_featured(self):
        song = applied({"mainArtists": ["X"]})
        assert (song["mainArtists"], song["featuredArtists"]) == (["X"], ["C"])
        song = applied({"featuredArtists": []})
        assert (song["mainArtists"], song["featuredArtists"]) == (["A", "B"], [])

    @pytest.mark.parametrize("changes,message", [
        ({"artists": ["X"]}, "artists is retired, use mainArtists"),
        ({"featured": []}, "featured is retired, use featuredArtists"),
        ({"released": 2001}, "released is retired, use releaseYear"),
        ({"mainArtists": ["New"], "artists": ["Old"]}, "artists is retired, use mainArtists"),
        ({"version": {"kind": "live"}}, "version.kind is retired, use version.type"),
        ({"version": {"type": "live", "by": ["Q"]}}, "version.by is retired, use version.artists"),
        ({"version": {"type": "live", "year": 2002}}, "version.year is retired, use version.releaseYear"),
        ({"version": {"type": "cover", "of": ["X"]}}, "version.of is retired, use version.originalArtists"),
    ])
    def test_the_adr0024_request_names_are_retired(self, changes, message):
        song = stored()
        before = copy.deepcopy(song)
        with pytest.raises(ValueError, match=message):
            credits.apply_changes(song, changes)
        assert song == before

    def test_structure_shadows_every_legacy_key_of_its_group(self):
        song = applied({"mainArtists": ["X"], "artist": "Totally Different", "version": None, "remixer": "Other Remix", "remix_year": 2030,
                        "releaseYear": 2001, "year": 2002, "albums": ["Z"], "album": "Nope"})
        assert song["mainArtists"] == ["X"]
        assert "version" not in song
        assert song["releaseYear"] == 2001
        assert song["albums"] == ["Z"]

    def test_version_null_removes_it_and_shadows_remixer(self):
        song = applied({"version": None, "remixer": "Alesso Remix"})
        assert "version" not in song

    def test_version_object_replaces_the_whole_stored_version(self):
        song = applied({"version": {"type": "live", "name": "Live at X"}})
        assert song["version"] == {"type": "live", "name": "Live at X", "artists": [], "releaseYear": None}

    def test_legacy_equal_to_the_projection_is_a_no_op(self):
        before = stored()
        proj = credits.project(before)
        song = applied({"artist": proj["artist"], "remixer": proj["remixer"], "year": proj["year"], "remix_year": proj["remix_year"],
                        "album": proj["album"], "title": "T"})
        assert song == before

    def test_legacy_blank_equals_projected_null(self):
        song = stored(mainArtists=[], featuredArtists=[], releaseYear=None, albums=[])
        song.pop("version")
        credits.apply_changes(song, {"artist": "  ", "remixer": "", "year": None, "remix_year": None, "album": ""})
        assert song["mainArtists"] == []
        assert "version" not in song
        assert song["albums"] == []

    def test_changed_legacy_artist_becomes_pills_and_clears_featured(self):
        song = applied({"artist": "X & Y - Z"})
        assert (song["mainArtists"], song["featuredArtists"]) == (["X & Y", "Z"], [])

    def test_cleared_legacy_remixer_removes_the_version(self):
        assert "version" not in applied({"remixer": None})

    def test_changed_legacy_remixer_renames_but_keeps_type_artists_and_year(self):
        song = applied({"remixer": "Bob Remix"})
        assert song["version"] == {"type": "remix", "name": "Bob Remix", "artists": ["Alesso"], "releaseYear": 2012}

    def test_legacy_remixer_creates_a_version_when_none_exists(self):
        song = stored()
        song.pop("version")
        credits.apply_changes(song, {"remixer": "Mixed By DJ Q"})
        assert song["version"] == {"type": "other", "name": "Mixed By DJ Q", "artists": [], "releaseYear": None}
        song.pop("version")
        credits.apply_changes(song, {"remixer": "Bob Remix"})
        assert song["version"]["type"] == "remix"

    def test_legacy_remix_year_sets_or_creates(self):
        assert applied({"remix_year": 2020})["version"]["releaseYear"] == 2020
        assert applied({"remix_year": None})["version"]["releaseYear"] is None
        song = stored()
        song.pop("version")
        credits.apply_changes(song, {"remix_year": 2020})
        assert song["version"] == {"type": "other", "name": None, "artists": [], "releaseYear": 2020}
        orphan = stored(version={"type": "other", "name": None, "artists": [], "releaseYear": 2012})
        credits.apply_changes(orphan, {"remix_year": None})
        assert "version" not in orphan

    def test_legacy_year_sets_release_year(self):
        assert applied({"year": 2005})["releaseYear"] == 2005
        assert applied({"year": None})["releaseYear"] is None

    def test_legacy_album_replaces_the_first_album_and_blank_clears_them(self):
        assert applied({"album": "Other"})["albums"] == ["Other"]
        assert applied({"album": "  "})["albums"] == []
        assert applied({"albums": ["One", " one ", "Two"]})["albums"] == ["One", "Two"]

    def test_raw_and_raw_title_are_never_touched(self):
        song = applied({"mainArtists": ["Z"], "releaseYear": 2001, "version": None})
        assert song["raw"] == {"title": "T", "artist": "A - B"}
        assert song["rawTitle"] == "T"

    def test_a_new_key_is_placed_in_the_documented_order(self):
        song = {"id": "x", "title": "T", "mainArtists": [], "featuredArtists": [], "releaseYear": None, "rawTitle": "T", "tags": []}
        credits.apply_changes(song, {"version": {"type": "live"}, "albums": ["A"]})
        assert list(song) == ["id", "title", "mainArtists", "featuredArtists", "releaseYear", "albums", "version", "rawTitle", "tags"]

    def test_names_are_trimmed_deduped_case_insensitively_and_empties_dropped(self):
        assert applied({"mainArtists": [" A ", "a", "", "B", "b "]})["mainArtists"] == ["A", "B"]

    def test_cover_keeps_original_artists_as_a_list_and_other_types_must_not_have_it(self):
        song = applied({"version": {"type": "cover", "originalArtists": "Artist A"}})
        assert song["version"] == {"type": "cover", "name": None, "artists": [], "releaseYear": None, "originalArtists": ["Artist A"]}
        with pytest.raises(ValueError, match="only for covers and mashups"):
            applied({"version": {"type": "remix", "originalArtists": "Artist A"}})

    def test_mashup_keeps_several_sources_and_a_string_becomes_a_list(self):
        song = applied({"version": {"type": "mashup", "originalArtists": [" S1 ", "s1", "S2", ""]}})
        assert song["version"] == {"type": "mashup", "name": None, "artists": [], "releaseYear": None, "originalArtists": ["S1", "S2"]}
        assert applied({"version": {"type": "mashup", "originalArtists": "Only"}})["version"]["originalArtists"] == ["Only"]
        assert "originalArtists" not in applied({"version": {"type": "mashup"}})["version"]
        assert credits.project(song)["remixer"] == "Mashup"

    def test_a_stored_string_of_original_artists_is_normalised_by_ensure_and_idempotently(self):
        song = {"id": "a", "title": "T", "mainArtists": ["A"], "featuredArtists": [], "releaseYear": None, "albums": [],
                "version": {"type": "cover", "name": None, "artists": [], "releaseYear": None, "originalArtists": "Orig"}}
        assert credits.ensure(song) is True
        assert song["version"]["originalArtists"] == ["Orig"]
        assert credits.ensure(song) is False

    def test_an_empty_other_version_is_dropped(self):
        assert "version" not in applied({"version": {"type": "other", "name": " ", "artists": [], "releaseYear": None}})


class TestValidation:
    @pytest.mark.parametrize("changes, message", [
        ({"mainArtists": "A"}, "mainArtists must be a list of at most 30 names"),
        ({"mainArtists": [f"n{i}" for i in range(31)]}, "mainArtists must be a list of at most 30 names"),
        ({"mainArtists": [1]}, "mainArtists must be a list of at most 30 names"),
        ({"mainArtists": ["x" * 201]}, "at most 200 characters"),
        ({"featuredArtists": [f"n{i}" for i in range(31)]}, "featuredArtists must be a list of at most 30 names"),
        ({"albums": [f"n{i}" for i in range(31)]}, "albums must be a list of at most 30 names"),
        ({"version": {"type": "bogus"}}, "version.type must be one of remix, cover"),
        ({"version": {}}, "version.type must be one of"),
        ({"version": "x"}, "version must be an object or null"),
        ({"version": {"type": "remix", "extra": 1}}, "unknown keys"),
        ({"version": {"type": "remix", "name": "x" * 301}}, "version.name must be at most 300"),
        ({"version": {"type": "remix", "artists": [f"n{i}" for i in range(31)]}}, "version.artists must be a list of at most 30 names"),
        ({"version": {"type": "remix", "releaseYear": 1899}}, "version.releaseYear must be from 1900 to 2027"),
        ({"version": {"type": "remix", "releaseYear": 2028}}, "version.releaseYear must be from 1900 to 2027"),
        ({"version": {"type": "mashup", "originalArtists": [f"n{i}" for i in range(31)]}}, "version.originalArtists must be a list of at most 30 names"),
        ({"version": {"type": "cover", "originalArtists": 5}}, "version.originalArtists must be a list of at most 30 names"),
        ({"version": {"type": "cover", "originalArtists": "x" * 201}}, "names must be at most 200"),
        ({"releaseYear": 1899}, "releaseYear must be from 1900 to 2027"),
        ({"releaseYear": 2028}, "releaseYear must be from 1900 to 2027"),
        ({"releaseYear": "x"}, "releaseYear must be from 1900 to 2027"),
        ({"year": 2028}, "year must be from 1900 to 2027"),
        ({"remix_year": 1899}, "remix_year must be from 1900 to 2027"),
    ])
    def test_rejections(self, changes, message):
        song = stored()
        with pytest.raises(ValueError, match=message):
            credits.clean_changes(changes, song)

    @pytest.mark.parametrize("year", [1900, 2027])
    def test_boundaries_pass(self, year):
        assert credits.clean_changes({"releaseYear": year, "version": {"type": "live", "releaseYear": year}}, stored())["releaseYear"] == year

    def test_an_unchanged_stored_out_of_range_year_passes(self):
        song = stored(releaseYear=1850, version={"type": "remix", "name": "R", "artists": [], "releaseYear": 2099})
        out = credits.clean_changes({"releaseYear": 1850, "version": {"type": "remix", "name": "R", "releaseYear": 2099}}, song)
        assert out["releaseYear"] == 1850
        assert out["version"]["releaseYear"] == 2099
        with pytest.raises(ValueError):
            credits.clean_changes({"releaseYear": 1851}, song)

    def test_failed_apply_leaves_the_song_unchanged(self):
        song = stored()
        before = copy.deepcopy(song)
        with pytest.raises(ValueError):
            credits.apply_changes(song, {"mainArtists": ["Z"], "releaseYear": 3000})
        assert song == before


class TestNewFields:
    def test_structure_only(self):
        fields = credits.new_fields({"title": "T", "mainArtists": ["A", "B"], "featuredArtists": ["C"], "releaseYear": 2001, "albums": ["Al"],
                                     "version": {"type": "live", "name": "Live"}}, {"title": "T raw", "artist": "A & B"})
        assert list(fields) == ["mainArtists", "featuredArtists", "releaseYear", "albums", "version", "rawTitle"]
        assert fields["rawTitle"] == "T raw"
        assert fields["version"] == {"type": "live", "name": "Live", "artists": [], "releaseYear": None}

    def test_legacy_only_from_ios_and_raw_title_from_the_submitted_title(self):
        fields = credits.new_fields({"title": "Song", "artist": "Band", "album": "", "remixer": None, "year": None})
        assert fields == {"mainArtists": ["Band"], "featuredArtists": [], "releaseYear": None, "albums": [], "rawTitle": "Song"}

    def test_legacy_remixer_years_and_album(self):
        fields = credits.new_fields({"title": "S", "artist": "A", "remixer": "X Remix", "year": 2000, "remix_year": 2012, "album": "Al"})
        assert fields["version"] == {"type": "remix", "name": "X Remix", "artists": [], "releaseYear": 2012}
        assert fields["releaseYear"] == 2000
        assert fields["albums"] == ["Al"]

    def test_structure_wins_over_legacy(self):
        fields = credits.new_fields({"artist": "Legacy", "mainArtists": ["New"], "year": 1990, "releaseYear": 2001})
        assert (fields["mainArtists"], fields["releaseYear"]) == (["New"], 2001)

    def test_nothing_sent(self):
        assert credits.new_fields({}) == {"mainArtists": [], "featuredArtists": [], "releaseYear": None, "albums": []}

    def test_invalid_input_raises(self):
        with pytest.raises(ValueError):
            credits.new_fields({"releaseYear": 3000})


class TestAbsorb:
    def test_legacy_keys_are_converted_and_removed(self):
        song = stored()
        song["artist"], song["year"] = "Brand New", 2003
        assert credits.absorb(song) is True
        assert song["mainArtists"] == ["Brand New"]
        assert song["releaseYear"] == 2003
        assert "artist" not in song
        assert "year" not in song

    def test_values_equal_to_the_projection_change_nothing(self):
        song = stored()
        song["year"] = 1999
        credits.absorb(song)
        assert song == stored()

    def test_nothing_to_do(self):
        assert credits.absorb(stored()) is False

    def test_an_invalid_legacy_value_is_kept_in_raw_not_raised(self):
        song = stored()
        song["year"] = 3000
        assert credits.absorb(song) is True
        assert song["releaseYear"] == 1999
        assert "year" not in song
        assert song["raw"]["rejected"] == {"year": 3000}


def test_a_suggestion_is_renamed_to_the_v2_names():
    found = {"artists": ["A"], "featured": ["B"], "title": None, "notes": ["n"],
             "version": {"kind": "cover", "name": "X Cover", "by": [], "of": ["X"], "ambiguous": True}}
    assert credits.suggestion(found) == {
        "mainArtists": ["A"], "featuredArtists": ["B"], "title": None, "notes": ["n"],
        "version": {"type": "cover", "name": "X Cover", "artists": [], "originalArtists": ["X"], "ambiguous": True},
    }
    assert credits.suggestion({"artists": [], "featured": [], "version": None})["version"] is None
    alt = credits.suggestion({"artists": ["B"], "featured": [], "version": None, "alternatives": [{"artists": ["A"], "featured": [], "version": {"kind": "cover", "name": "x", "by": [], "of": ["B"]}, "title": "T"}]})
    assert alt["alternatives"] == [{"mainArtists": ["A"], "featuredArtists": [], "version": {"type": "cover", "name": "x", "artists": [], "originalArtists": ["B"]}, "title": "T"}]


class TestEnsureRepairs:
    def test_missing_keys_are_added_in_the_documented_order(self):
        song = {"id": "a", "title": "T", "mainArtists": ["A"], "rawTitle": "T"}
        assert credits.ensure(song) is True
        assert list(song) == ["id", "title", "mainArtists", "featuredArtists", "releaseYear", "albums", "rawTitle"]
        song = {"mainArtists": ["A"], "featuredArtists": None, "albums": "x"}
        assert credits.ensure(song) is True
        assert song["featuredArtists"] == []
        assert song["albums"] == []

    def test_a_loose_version_is_put_in_shape(self):
        song = {"mainArtists": ["A"], "featuredArtists": [], "releaseYear": None, "albums": [],
                "version": {"type": "cover", "artists": "Q", "originalArtists": "Orig"}}
        assert credits.ensure(song) is True
        assert song["version"] == {"type": "cover", "artists": ["Q"], "originalArtists": ["Orig"], "name": None, "releaseYear": None}
        song["version"] = {"type": "cover", "name": None, "artists": [], "releaseYear": None, "originalArtists": []}
        credits.ensure(song)
        assert "originalArtists" not in song["version"]
        song["version"] = {"kind": "live", "name": "L", "by": ["Z"], "year": 2000}
        credits.ensure(song)
        assert song["version"] == {"type": "live", "name": "L", "artists": ["Z"], "releaseYear": 2000}
        song["version"] = {"type": "remix", "year": 2001, "name": "R"}
        credits.ensure(song)
        assert song["version"]["releaseYear"] == 2001
        assert song["version"]["artists"] == []

    def test_a_flat_song_is_converted_before_its_changes_are_resolved(self):
        flat = {"id": "a", "title": "T", "artist": "Band", "year": 1999}
        assert credits.clean_changes({"year": 1999, "artist": "Band"}, flat) == {}
        assert credits.clean_changes({"artist": "Other"}, flat)["mainArtists"] == ["Other"]
        assert "artist" in flat
        credits.apply_changes(flat, {"releaseYear": 2000})
        assert flat["mainArtists"] == ["Band"]
        assert flat["releaseYear"] == 2000

    def test_absorb_converts_a_flat_song(self):
        flat = {"id": "a", "title": "T", "artist": "Band"}
        assert credits.absorb(flat) is True
        assert flat["mainArtists"] == ["Band"]


REAL_PREVIEW = extractor.preview
LEGACY = ("artist", "remixer", "remix_year", "year")


def post(client, metadata=None, *, vid=VID, audio=False, **extra):
    body = {"url": f"https://youtu.be/{vid}", "audio": audio, "metadata": {"title": "Song", **(metadata or {})}, "tags": [], **extra}
    return client.post("/songs", json=body, headers=H)


def song(client, vid=VID):
    return next(s for s in client.get("/library", headers=H).json()["songs"] if s["id"] == vid)


def on_disk(tmp_path, vid=VID):
    doc = json.loads((ODIR(tmp_path) / "library.json").read_text(encoding="utf-8"))
    return next(s for s in doc["songs"] if s["id"] == vid)


class TestCreate:
    def test_structure_keys_are_stored_and_projected(self, client, tmp_path):
        r = post(client, {"mainArtists": ["Dua Lipa", "Elton John"], "featuredArtists": ["Jon"], "releaseYear": 2021,
                          "version": {"type": "live", "name": "Live, Royal Albert Hall", "releaseYear": 2022}})
        assert r.status_code == 201
        got = r.json()["song"]
        assert (got["mainArtists"], got["featuredArtists"], got["releaseYear"]) == (["Dua Lipa", "Elton John"], ["Jon"], 2021)
        assert got["version"] == {"type": "live", "name": "Live, Royal Albert Hall", "artists": [], "releaseYear": 2022}
        assert (got["artist"], got["remixer"], got["year"], got["remix_year"]) == ("Dua Lipa & Elton John feat. Jon", "Live, Royal Albert Hall", 2021, 2022)
        stored = on_disk(tmp_path)
        assert all(k not in stored for k in LEGACY)
        assert list(stored)[:7] == ["id", "title", "mainArtists", "featuredArtists", "releaseYear", "albums", "version"]
        assert "decade:20s" in got["tags"]

    def test_legacy_keys_from_ios_become_structure(self, client, tmp_path):
        r = post(client, {"artist": "Band", "album": "", "remixer": "Alesso Remix", "releaseYear": 1999, "remix_year": 2012,
                          "wikipedia_song": None, "wikipedia_artist": None, "musicbrainz_url": None})
        got = r.json()["song"]
        assert got["mainArtists"] == ["Band"]
        assert got["releaseYear"] == 1999
        assert got["version"] == {"type": "remix", "name": "Alesso Remix", "artists": [], "releaseYear": 2012}
        assert on_disk(tmp_path)["rawTitle"] == "Song"
        assert "raw" not in on_disk(tmp_path)

    def test_structure_wins_over_legacy_keys_in_the_same_body(self, client):
        got = post(client, {"artist": "Legacy", "mainArtists": ["New"], "year": 1990, "releaseYear": 2001, "remixer": "Old Remix", "version": None}).json()["song"]
        assert (got["mainArtists"], got["releaseYear"], got["artist"], got["year"]) == (["New"], 2001, "New", 2001)
        assert "version" not in got
        assert got["remixer"] is None

    def test_unsent_keys_do_not_become_nulls_that_wipe_structure(self, client):
        got = post(client, {"mainArtists": ["A"]}).json()["song"]
        assert got["mainArtists"] == ["A"]
        assert got["releaseYear"] == 1987
        assert "version" not in got

    def test_source_raw_is_stored_verbatim_and_never_edited_later(self, client, tmp_path):
        raw = {"title": "Song (Alesso Remix) [Official]", "artist": "Band - Topic", "remixer": "Alesso Remix"}
        post(client, {"mainArtists": ["Band"], "version": {"type": "remix", "name": "Alesso Remix", "artists": ["Alesso"]}}, source_raw=raw)
        assert on_disk(tmp_path)["rawTitle"] == raw["title"]
        client.patch(f"/songs/{VID}", json={"title": "Other", "mainArtists": ["Z"], "version": None}, headers=H)
        assert on_disk(tmp_path)["rawTitle"] == raw["title"]

    def test_with_audio_the_source_artist_fills_an_empty_artist(self, client, tmp_path):
        assert post(client, audio=True).status_code == 202
        got = song(client)
        assert got["mainArtists"] == ["Yt Artist"]
        assert got["artist"] == "Yt Artist"
        assert "artist" not in on_disk(tmp_path)

    def test_without_audio_the_source_year_fills_released_only_when_unsent(self, client):
        assert post(client).json()["song"]["releaseYear"] == 1987
        assert post(client, {"releaseYear": 2001}, vid=VID2).json()["song"]["releaseYear"] == 2001

    @pytest.mark.parametrize("meta, message", [
        ({"version": {"type": "bogus"}}, "version.type must be one of remix, cover, mashup, live, acoustic, extended, instrumental, remaster, edit, other"),
        ({"version": {"type": "remix", "originalArtists": "X"}}, "version.originalArtists is only for covers and mashups"),
        ({"mainArtists": [f"n{i}" for i in range(31)]}, "mainArtists must be a list of at most 30 names"),
        ({"releaseYear": 1899}, "releaseYear must be from 1900 to 2027"),
        ({"version": {"type": "live", "releaseYear": 2028}}, "version.releaseYear must be from 1900 to 2027"),
        ({"year": 2028}, "year must be from 1900 to 2027"),
        ({"remix_year": 1800}, "remix_year must be from 1900 to 2027"),
    ])
    def test_rejections(self, client, meta, message):
        r = post(client, meta)
        assert r.status_code == 422
        assert r.json()["detail"] == message
        assert client.get("/library", headers=H).json()["songs"] == []

    def test_unknown_version_keys_are_a_422(self, client):
        assert post(client, {"version": {"type": "remix", "colour": "red"}}).status_code == 422


class TestPatch:
    @pytest.fixture
    def structured(self, client):
        post(client, {"mainArtists": ["A", "B"], "featuredArtists": ["C"], "releaseYear": 1999, "version": {"type": "remix", "name": "Alesso Remix", "artists": ["Alesso"], "releaseYear": 2012}},
             source_raw={"title": "Song", "artist": "A - B"})
        return client

    def test_title_only_keeps_all_structure(self, structured, tmp_path):
        before = on_disk(tmp_path)
        got = structured.patch(f"/songs/{VID}", json={"title": "New"}, headers=H).json()
        assert (got["mainArtists"], got["featuredArtists"], got["releaseYear"], got["version"]) == (before["mainArtists"], before["featuredArtists"], before["releaseYear"], before["version"])
        assert on_disk(tmp_path)["rawTitle"] == before["rawTitle"]

    def test_structure_keys_replace(self, structured, tmp_path):
        got = structured.patch(f"/songs/{VID}", json={"mainArtists": ["X"], "releaseYear": 2005, "version": {"type": "cover", "originalArtists": "Orig"}}, headers=H).json()
        assert got["mainArtists"] == ["X"]
        assert got["featuredArtists"] == ["C"]
        assert got["releaseYear"] == 2005
        assert got["version"] == {"type": "cover", "name": None, "artists": [], "releaseYear": None, "originalArtists": ["Orig"]}
        assert (got["artist"], got["remixer"], got["year"], got["remix_year"]) == ("X feat. C", "Cover", 2005, None)
        assert "decade:00s" in got["tags"]
        assert all(k not in on_disk(tmp_path) for k in LEGACY)

    def test_version_null_removes_the_version(self, structured):
        got = structured.patch(f"/songs/{VID}", json={"version": None}, headers=H).json()
        assert "version" not in got
        assert got["remixer"] is None
        assert got["remix_year"] is None
        assert "version" not in song(structured)

    def test_structure_shadows_legacy_in_the_same_patch(self, structured):
        got = structured.patch(f"/songs/{VID}", json={"mainArtists": ["Only"], "artist": "Ignored", "releaseYear": 2001, "year": 1950}, headers=H).json()
        assert (got["mainArtists"], got["releaseYear"]) == (["Only"], 2001)

    def test_ios_edit_of_an_unchanged_song_is_a_no_op_on_structure(self, structured, tmp_path):
        current = song(structured)
        before = on_disk(tmp_path)
        body = {"title": current["title"], "artist": current["artist"], "album": "", "remixer": current["remixer"], "year": current["year"],
                "wikipedia_song": None, "wikipedia_artist": None, "musicbrainz_url": None, "tags": current["tags"]}
        assert structured.patch(f"/songs/{VID}", json=body, headers=H).status_code == 200
        after = on_disk(tmp_path)
        for key in ("mainArtists", "featuredArtists", "releaseYear", "version", "rawTitle", "title"):
            assert after[key] == before[key]

    def test_ios_changed_artist_flattens_to_pills_and_clears_featured(self, structured):
        got = structured.patch(f"/songs/{VID}", json={"artist": "Brand - New"}, headers=H).json()
        assert (got["mainArtists"], got["featuredArtists"]) == (["Brand", "New"], [])

    def test_ios_cleared_remixer_removes_the_version(self, structured):
        got = structured.patch(f"/songs/{VID}", json={"remixer": None}, headers=H).json()
        assert "version" not in got

    def test_legacy_remix_year_sets_the_version_year(self, structured):
        assert structured.patch(f"/songs/{VID}", json={"remix_year": 2020}, headers=H).json()["version"]["releaseYear"] == 2020

    @pytest.mark.parametrize("body, message", [
        ({"mainArtists": [f"n{i}" for i in range(31)]}, "mainArtists must be a list of at most 30 names"),
        ({"version": {"type": "nope"}}, "version.type must be one of"),
        ({"version": {"type": "live", "originalArtists": "X"}}, "version.originalArtists is only for covers and mashups"),
        ({"releaseYear": 2028}, "releaseYear must be from 1900 to 2027"),
        ({"version": {"type": "live", "releaseYear": 1899}}, "version.releaseYear must be from 1900 to 2027"),
        ({"year": 1899}, "year must be from 1900 to 2027"),
    ])
    def test_rejections_leave_the_song_unchanged(self, structured, tmp_path, body, message):
        before = on_disk(tmp_path)
        r = structured.patch(f"/songs/{VID}", json=body, headers=H)
        assert r.status_code == 422
        assert message in str(r.json()["detail"])
        assert on_disk(tmp_path) == before

    def test_an_unchanged_out_of_range_stored_year_does_not_block_other_edits(self, client, tmp_path):
        post(client, {"mainArtists": ["A"]})
        path = ODIR(tmp_path) / "library.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["songs"][0]["releaseYear"] = 1850
        path.write_text(json.dumps(doc), encoding="utf-8")
        assert client.patch(f"/songs/{VID}", json={"title": "T2", "year": 1850, "releaseYear": 1850}, headers=H).status_code == 200
        assert client.patch(f"/songs/{VID}", json={"releaseYear": 1851}, headers=H).status_code == 422


class TestListsAndGuest:
    def test_library_and_catalog_carry_the_schema_and_always_present_keys(self, client):
        post(client, {"mainArtists": ["A"], "version": {"type": "live"}})
        post(client, {"title": "Plain"}, vid=VID2)
        lib = client.get("/library", headers=H).json()
        cat = client.get("/catalog", headers=H).json()
        assert lib["credits_schema"] == 3
        assert cat["credits_schema"] == 3
        for body in (lib, cat):
            for s in body["songs"]:
                for key in ("title", "mainArtists", "featuredArtists", "releaseYear", "albums", "genres", "artist", "remixer", "year", "remix_year", "album"):
                    assert key in s, key
            assert "version" in next(s for s in body["songs"] if s["id"] == VID)
            assert "version" not in next(s for s in body["songs"] if s["id"] == VID2)

    def test_catalog_revision_etag_and_since_follow_edits(self, client):
        post(client, {"mainArtists": ["A"]})
        first = client.get("/catalog", headers=H)
        etag = first.headers["ETag"]
        assert client.get("/catalog", headers={**H, "If-None-Match": etag}).status_code == 304
        client.patch(f"/songs/{VID}", json={"mainArtists": ["B"]}, headers=H)
        again = client.get("/catalog", headers={**H, "If-None-Match": etag})
        assert again.status_code == 200
        assert again.headers["ETag"] != etag
        stamp = song(client)["updated_at"]
        assert [s["id"] for s in client.get("/catalog", params={"since": stamp}, headers=H).json()["songs"]] == [VID]

    def test_guest_gets_the_structure_but_not_raw(self, client, monkeypatch):
        monkeypatch.setenv("PUBLIC_VIEW", "1")
        post(client, {"mainArtists": ["A"], "featuredArtists": ["B"], "releaseYear": 1999, "version": {"type": "remix", "name": "X Remix", "artists": ["X"]}}, source_raw={"title": "Original Upload Title"})
        owner = song(client)
        assert "rawTitle" in owner
        seen = web().get("/library").json()["songs"][0]
        assert "rawTitle" not in seen
        assert "raw" not in seen
        assert "metadata_checked_at" not in seen
        assert (seen["mainArtists"], seen["featuredArtists"], seen["releaseYear"], seen["version"]["type"]) == (["A"], ["B"], 1999, "remix")
        assert seen["artist"] == "A feat. B"
        assert seen["remixer"] == "X Remix"
        assert seen["year"] == 1999
        assert {"mainArtists", "featuredArtists", "releaseYear", "albums", "version"} <= guest.SONG_KEYS
        assert not {"raw", "rawTitle"} & guest.SONG_KEYS


class TestPreviewAndMetadata:
    @pytest.fixture
    def real_preview(self, client, monkeypatch, ydl):  # noqa: F811
        monkeypatch.setattr(extractor, "preview", REAL_PREVIEW)
        for mod, name in ((genre_lookup, "lookup"),):
            monkeypatch.setattr(mod, name, lambda a, t, f=None: genre_lookup._empty())
        monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, mb=None: {"tags": [], "releaseYear": None, "wikipedia_song": None, "wikipedia_artist": None})
        monkeypatch.setattr(discogs_lookup, "suggest", lambda a, t: {"tags": [], "releaseYear": None, "url": None, "country": None, "artist": "", "title": ""})
        return ydl

    def test_an_upload_only_video_gives_no_year_and_no_decade(self, real_preview, client):
        real_preview.info = {"title": "Kato feat. Jon - Turn The Lights Off (Alesso Remix)", "uploader": "Chan", "upload_date": "20140301"}
        body = client.post("/preview", json={"url": VID}, headers=H).json()
        assert body["year"] is None
        assert body["suggested_year"] is None
        assert body["released_suggestion"] is None
        assert body["published_year"] == 2014
        assert body["raw"]["title"] == "Kato feat. Jon - Turn The Lights Off (Alesso Remix)"
        assert body["raw"]["remixer"] == "Alesso Remix"
        assert body["remixer"] == "Alesso Remix"
        sug = body["suggested_credits"]
        assert sug["featuredArtists"] == ["Jon"]
        assert sug["version"]["artists"] == ["Alesso"]
        assert not any(t.startswith("decade:") for t in body["tags"])

    @pytest.mark.parametrize("wiki, mb, disc, expect", [
        (1990, 1991, 1992, (1990, "wikipedia")), (None, 1991, 1992, (1991, "musicbrainz")), (None, None, 1992, (1992, "discogs")), (None, None, None, None),
        (2999, 1991, None, (1991, "musicbrainz")),
    ])
    def test_released_suggestion_chain(self, real_preview, client, monkeypatch, wiki, mb, disc, expect):
        real_preview.info = {"title": "T", "uploader": "A", "upload_date": "20140301", "release_year": 2005}
        monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, m=None: {"tags": [], "year": wiki, "wikipedia_song": None, "wikipedia_artist": None})
        monkeypatch.setattr(genre_lookup, "lookup", lambda a, t, f=None: {**genre_lookup._empty(), "year": mb})
        monkeypatch.setattr(discogs_lookup, "suggest", lambda a, t: {"tags": [], "year": disc, "url": None, "country": None, "artist": "", "title": ""})
        body = client.post("/preview", json={"url": VID}, headers=H).json()
        if expect is None:
            assert body["released_suggestion"] is None
            assert body["year"] is None
        else:
            assert body["released_suggestion"] == {"year": expect[0], "source": expect[1]}
            assert body["suggested_year"] == expect[0]
            assert body["year"] == expect[0]

    def test_metadata_for_a_version_withholds_the_original_links(self, client, monkeypatch):
        mb = {**genre_lookup._empty(), "year": 1999, "mb_url": MB_URL}
        monkeypatch.setattr(genre_lookup, "lookup", lambda a, t, f=None: mb)
        monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, m=None: {"tags": [], "releaseYear": None})
        monkeypatch.setattr(discogs_lookup, "suggest", lambda a, t: {"tags": [], "year": 1998, "url": "https://www.discogs.com/release/5"})
        body = {"title": "T", "artist": "A", "sources": []}
        plain = client.post("/metadata", json=body, headers=H).json()
        version = client.post("/metadata", json={**body, "version_kind": "remix"}, headers=H).json()
        assert plain["services"]["musicbrainz"]["url"] == MB_URL
        assert plain["services"]["discogs"]["url"]
        assert version["services"]["musicbrainz"] == {"found": False, "url": None}
        assert version["services"]["discogs"] == {"found": False, "url": None}
        assert version["year"] == 1999
        assert "version_year" in version
        assert version["version_year"] == version["remix_year"]

    def test_unknown_version_kind_is_a_422(self, client):
        assert client.post("/metadata", json={"title": "T", "version_kind": "bogus"}, headers=H).status_code == 422


class TestEnrichmentOfVersions:
    RESP = {"album": "Original Album", "year": 1999, "tags": ["genre:house"], "wikipedia_album": "https://en.wikipedia.org/wiki/Found",
            "services": {"musicbrainz": {"found": True, "url": MB_URL}}}

    def version_song(self, **over):
        return {"id": VID, "title": "T", "mainArtists": ["A"], "featuredArtists": [], "releaseYear": None, "albums": [], "tags": [],
                "version": {"type": "remix", "name": "X Remix", "artists": [], "releaseYear": None}, **over}

    def test_metafill_fills_released_and_genres_but_never_album_or_links_for_a_version(self):
        s = self.version_song()
        assert metafill.apply(s, self.RESP) is True
        assert s["releaseYear"] == 1999
        assert "genre:house" in s["tags"]
        assert s["albums"] == []
        assert "musicbrainz_url" not in s
        assert "wikipedia_album" not in s

    def test_metafill_fills_everything_for_a_song_without_a_version(self):
        s = self.version_song()
        s.pop("version")
        metafill.apply(s, self.RESP)
        assert s["albums"] == ["Original Album"]
        assert s["musicbrainz_url"].startswith("https://musicbrainz.org/")

    def test_metafill_asks_for_the_original_work(self, monkeypatch):
        seen = {}
        monkeypatch.setattr(metafill.metadata, "gather", lambda title, artist, fetchers, *a, **kw: seen.update(title=title, artist=artist, kw=kw) or {})
        cover = self.version_song(mainArtists=["Covering Band"], version={"type": "cover", "name": None, "artists": [], "releaseYear": None, "originalArtists": ["Original Band"]})
        metafill._fetch(cover)
        assert (seen["title"], seen["artist"], seen["kw"]) == ("T", "Original Band", {"version_kind": "cover"})
        metafill._fetch(self.version_song())
        assert seen["artist"] == "A"
        assert seen["kw"] == {"version_kind": "remix"}

    def test_metafill_treats_a_mashup_like_any_version(self, monkeypatch):
        seen = {}
        monkeypatch.setattr(metafill.metadata, "gather", lambda title, artist, fetchers, *a, **kw: seen.update(artist=artist, kw=kw) or {})
        metafill._fetch(self.version_song(mainArtists=["Maker"], version={"type": "mashup", "name": None, "artists": [], "releaseYear": None, "originalArtists": ["S1", "S2"]}))
        assert seen["artist"] == "Maker"
        assert seen["kw"] == {"version_kind": "mashup"}

    def test_metafill_needs_released_not_album_for_a_version(self):
        s = self.version_song(tags=["genre:house"])
        assert metafill._needs(s)
        s["releaseYear"] = 2000
        assert not metafill._needs(s)

    def test_identify_offers_no_musicbrainz_or_discogs_link_for_a_version(self, monkeypatch):
        wire(monkeypatch)
        monkeypatch.setattr(genre_lookup, "lookup", lambda a, t, f=None: {**genre_lookup._empty(), "mb_url": MB_URL, "year": 1997})
        plain = {"id": "x", "title": "around the world", "mainArtists": ["daft punk"], "featuredArtists": [], "releaseYear": None}
        assert identify.run(plain, None)["links"]["musicbrainz"] == MB_URL
        version = {**plain, "version": {"type": "remix", "name": "R", "artists": [], "releaseYear": None}}
        out = identify.run(version, None)
        assert out["links"]["musicbrainz"] is None
        assert out["links"]["discogs"] is None
        assert out["suggested_year"] == 1997

    def test_download_name_uses_the_credited_artists(self):
        s = self.version_song(mainArtists=["A", "B"], featuredArtists=["C"])
        assert library.download_name(s, VID) == "A & B feat. C - T.m4a"
        assert credits.artist_string(s) == "A & B feat. C"


def test_preview_does_not_link_the_remixer_as_the_artist(client, monkeypatch):
    meta = {"id": VID, "title": "Kate Bush - Running Up That Hill (Orkidea Pure Progressive Mix)", "artist": "Orkidea", "tags": ["genre:trance"]}
    monkeypatch.setattr(extractor, "preview", lambda v: dict(meta))
    monkeypatch.setattr(genre_lookup, "suggest_tags", lambda a, t: ["genre:pop"])
    monkeypatch.setattr(genre_lookup, "lookup", lambda a, t, f=None: genre_lookup._empty())
    monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, mb=None: {"tags": ["genre:art pop"], "song_genres": [], "year": None, "wikipedia_song": None, "wikipedia_artist": "https://en.wikipedia.org/wiki/Orkidea"})
    monkeypatch.setattr(discogs_lookup, "suggest", lambda a, t: {"tags": [], "year": None, "url": None})
    body = client.post("/preview", json={"url": VID}, headers=H).json()
    assert body["wikipedia_artist"] is None
    assert body["tags"] == ["genre:trance"]
    assert body["original_genres"] == ["genre:pop", "genre:art pop"]
