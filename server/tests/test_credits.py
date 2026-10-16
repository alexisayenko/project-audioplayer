import copy

import pytest

from app import credits, credits_v1


def migrated(**legacy):
    song = {"id": "aaaaaaaaaa1", "title": "T", **legacy}
    assert credits.ensure(song) is True
    return song


@pytest.mark.parametrize("names, text", [([], ""), (["A"], "A"), (["A", "B"], "A & B"), (["A", "B", "C"], "A, B & C"), (["A", "", "B"], "A & B")])
def test_join_names(names, text):
    assert credits.join_names(names) == text


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
        assert song["rawTitle"] == "T" and "raw" not in song
        assert credits.project(song)["artist"] == "A & B"

    def test_raw_stays_when_dropping_it_would_change_the_derived_artist(self):
        song = migrated(artist="A - B")
        assert song["mainArtists"] == ["A", "B"]
        assert song["raw"]["artist"] == "A - B" and song["rawTitle"] == "T"
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
        assert song["releaseYear"] == 2001 and "year" not in song


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
        assert song["mainArtists"] == ["A", "B"] and song["featuredArtists"] == ["C"] and song["releaseYear"] == 1999
        assert song["albums"] == ["Al"] and song["rawTitle"] == "T raw"
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
        assert song["raw"]["artist"] == "A - B" and credits.project(song)["artist"] == "A - B"
        plain = {**copy.deepcopy(ADR24), "featured": [], "raw": {"title": "T", "artist": "A & B"}}
        plain["artists"] = ["A & B"]
        credits.ensure(plain)
        assert "raw" not in plain and plain["rawTitle"] == "T"

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
        assert credits.version_type(song) == "mashup" and credits.version_type({}) is None


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

    def test_the_adr0024_names_are_accepted_for_one_release(self):
        song = applied({"artists": ["X"], "featured": [], "released": 2001, "version": {"kind": "live", "name": "L", "by": ["Q"], "year": 2002}})
        assert (song["mainArtists"], song["featuredArtists"], song["releaseYear"]) == (["X"], [], 2001)
        assert song["version"] == {"type": "live", "name": "L", "artists": ["Q"], "releaseYear": 2002}

    def test_a_v2_name_wins_over_the_adr0024_one(self):
        song = applied({"artists": ["Old"], "mainArtists": ["New"], "released": 1, "releaseYear": 2001,
                        "version": {"kind": "live", "type": "edit", "by": ["O"], "artists": ["N"]}})
        assert song["mainArtists"] == ["New"] and song["releaseYear"] == 2001
        assert song["version"]["type"] == "edit" and song["version"]["artists"] == ["N"]

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
        assert song["mainArtists"] == [] and "version" not in song and song["albums"] == []

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
        assert song["raw"] == {"title": "T", "artist": "A - B"} and song["rawTitle"] == "T"

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
        ({"released": 1899}, "releaseYear must be from 1900 to 2027"),
        ({"year": 2028}, "year must be from 1900 to 2027"),
        ({"remix_year": 1899}, "remix_year must be from 1900 to 2027"),
    ])
    def test_rejections(self, changes, message):
        with pytest.raises(ValueError, match=message):
            credits.clean_changes(changes, stored())

    @pytest.mark.parametrize("year", [1900, 2027])
    def test_boundaries_pass(self, year):
        assert credits.clean_changes({"releaseYear": year, "version": {"type": "live", "releaseYear": year}}, stored())["releaseYear"] == year

    def test_an_unchanged_stored_out_of_range_year_passes(self):
        song = stored(releaseYear=1850, version={"type": "remix", "name": "R", "artists": [], "releaseYear": 2099})
        out = credits.clean_changes({"releaseYear": 1850, "version": {"type": "remix", "name": "R", "releaseYear": 2099}}, song)
        assert out["releaseYear"] == 1850 and out["version"]["releaseYear"] == 2099
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
        assert fields["releaseYear"] == 2000 and fields["albums"] == ["Al"]

    def test_structure_wins_over_legacy_and_the_adr0024_names_work(self):
        fields = credits.new_fields({"artist": "Legacy", "artists": ["New"], "year": 1990, "released": 2001})
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
        assert song["mainArtists"] == ["Brand New"] and song["releaseYear"] == 2003
        assert "artist" not in song and "year" not in song

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
        assert song["releaseYear"] == 1999 and "year" not in song
        assert song["raw"]["rejected"] == {"year": 3000}


def test_a_suggestion_is_renamed_to_the_v2_names():
    found = {"artists": ["A"], "featured": ["B"], "title": None, "notes": ["n"],
             "version": {"kind": "cover", "name": "X Cover", "by": [], "of": ["X"], "ambiguous": True}}
    assert credits.suggestion(found) == {
        "mainArtists": ["A"], "featuredArtists": ["B"], "title": None, "notes": ["n"],
        "version": {"type": "cover", "name": "X Cover", "artists": [], "originalArtists": ["X"], "ambiguous": True},
    }
    assert credits.suggestion({"artists": [], "featured": [], "version": None})["version"] is None


class TestEnsureRepairs:
    def test_missing_keys_are_added_in_the_documented_order(self):
        song = {"id": "a", "title": "T", "mainArtists": ["A"], "rawTitle": "T"}
        assert credits.ensure(song) is True
        assert list(song) == ["id", "title", "mainArtists", "featuredArtists", "releaseYear", "albums", "rawTitle"]
        song = {"mainArtists": ["A"], "featuredArtists": None, "albums": "x"}
        assert credits.ensure(song) is True
        assert song["featuredArtists"] == [] and song["albums"] == []

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
        assert song["version"]["releaseYear"] == 2001 and song["version"]["artists"] == []

    def test_a_flat_song_is_converted_before_its_changes_are_resolved(self):
        flat = {"id": "a", "title": "T", "artist": "Band", "year": 1999}
        assert credits.clean_changes({"year": 1999, "artist": "Band"}, flat) == {}
        assert credits.clean_changes({"artist": "Other"}, flat)["mainArtists"] == ["Other"]
        assert "artist" in flat
        credits.apply_changes(flat, {"releaseYear": 2000})
        assert flat["mainArtists"] == ["Band"] and flat["releaseYear"] == 2000

    def test_absorb_converts_a_flat_song(self):
        flat = {"id": "a", "title": "T", "artist": "Band"}
        assert credits.absorb(flat) is True and flat["mainArtists"] == ["Band"]
