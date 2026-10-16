import copy

import pytest

from app import credits


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


class TestMigrateFields:
    def test_artist_is_one_entry_per_pill_never_split_on_ampersand_comma_or_feat(self):
        assert migrated(artist="Nadia Ali, Starkillers & Alex Kenji")["artists"] == ["Nadia Ali, Starkillers & Alex Kenji"]
        assert migrated(artist="Kato feat. Jon")["artists"] == ["Kato feat. Jon"]
        assert migrated(artist="A - B / C")["artists"] == ["A", "B", "C"]

    @pytest.mark.parametrize("artist", [None, "", "   ", 5, ["A"]])
    def test_blank_or_odd_artist_is_empty(self, artist):
        assert migrated(artist=artist)["artists"] == []

    def test_title_is_untouched_and_featured_is_empty(self):
        song = migrated(title="Song (feat. X) (Alesso Remix)", artist="A")
        assert song["title"] == "Song (feat. X) (Alesso Remix)"
        assert song["featured"] == []
        assert "version" not in song

    @pytest.mark.parametrize("year, released", [(1999, 1999), ("1999", 1999), (True, None), (False, None), ("abc", None), (None, None), (2.0, 2), (2999, 2999), (1500, 1500)])
    def test_year_becomes_released(self, year, released):
        assert migrated(year=year)["released"] == released

    def test_remixer_becomes_a_remix_version_with_empty_by(self):
        song = migrated(artist="A", remixer="Alesso Remix", year=2009, remix_year=2012)
        assert song["version"] == {"kind": "remix", "name": "Alesso Remix", "by": [], "year": 2012}
        assert song["released"] == 2009

    def test_mixed_by_is_other_unless_it_says_remix(self):
        assert migrated(remixer="Mixed By DJ Gvozd")["version"]["kind"] == "other"
        assert migrated(remixer="Mixed By DJ Gvozd Remix")["version"]["kind"] == "remix"

    def test_remixer_is_trimmed_and_blank_means_no_version(self):
        assert migrated(remixer="  Alesso Remix ")["version"]["name"] == "Alesso Remix"
        assert "version" not in migrated(remixer="   ")
        assert "version" not in migrated(remixer=None)

    def test_remix_year_without_remixer_is_an_other_version(self):
        assert migrated(remix_year=2012)["version"] == {"kind": "other", "name": None, "by": [], "year": 2012}

    def test_raw_keeps_every_original_value_verbatim(self):
        song = migrated(artist="  A & B ", remixer="Alesso Remix", year="1999", remix_year=2012)
        assert song["raw"] == {"title": "T", "artist": "  A & B ", "remixer": "Alesso Remix", "year": "1999", "remix_year": 2012}

    def test_legacy_keys_are_removed_and_other_keys_and_order_kept(self):
        song = migrated(artist="A", album="Al", remixer=None, year=2000, bpm=120, updated_at="2026-01-01T00:00:00Z")
        for key in credits.LEGACY_KEYS:
            assert key not in song
        assert list(song) == ["id", "title", "artists", "featured", "released", "raw", "album", "bpm", "updated_at"]
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
        assert song["released"] == 2001 and "year" not in song


class TestProject:
    def test_empty_structure(self):
        song = {"title": "T", "artists": [], "featured": [], "released": None}
        assert credits.project(song) == {"artist": None, "remixer": None, "year": None, "remix_year": None}

    def test_artist_joins_and_features(self):
        base = {"title": "T", "featured": [], "released": 2009}
        assert credits.project({**base, "artists": ["A", "B", "C"]})["artist"] == "A, B & C"
        assert credits.project({**base, "artists": ["Kato"], "featured": ["Jon"]})["artist"] == "Kato feat. Jon"
        assert credits.project({**base, "artists": ["A"], "featured": ["B", "C"]})["artist"] == "A feat. B & C"
        assert credits.project({**base, "artists": ["A"]})["year"] == 2009

    def test_raw_artist_round_trips_when_it_matches_the_pills(self):
        song = migrated(artist="  Nadia Ali, Starkillers & Alex Kenji ")
        assert credits.project(song)["artist"] == "Nadia Ali, Starkillers & Alex Kenji"
        song["artists"] = ["Nadia Ali", "Starkillers"]
        assert credits.project(song)["artist"] == "Nadia Ali & Starkillers"

    def test_raw_artist_is_not_used_when_featured_exist(self):
        song = migrated(artist="A - B")
        song["featured"] = ["C"]
        assert credits.project(song)["artist"] == "A & B feat. C"

    @pytest.mark.parametrize("version, text", [
        ({"kind": "remix", "name": "Alesso Remix", "by": ["X"], "year": None}, "Alesso Remix"),
        ({"kind": "remix", "name": None, "by": ["A", "B"], "year": None}, "A & B"),
        ({"kind": "live", "name": None, "by": [], "year": None}, "Live"),
        ({"kind": "cover", "name": None, "by": [], "year": None, "of": "X"}, "Cover"),
        ({"kind": "other", "name": None, "by": [], "year": 2012}, None),
    ])
    def test_remixer_text(self, version, text):
        song = {"title": "T", "artists": ["A"], "featured": [], "released": None, "version": version}
        assert credits.project(song)["remixer"] == text
        assert credits.project(song)["remix_year"] == version["year"]

    def test_legacy_only_song_projects_its_own_values(self):
        assert credits.project({"artist": " A ", "remixer": "", "year": 1999, "remix_year": None}) == {"artist": "A", "remixer": None, "year": 1999, "remix_year": None}

    def test_artist_string_and_lookup_artist(self):
        song = {"title": "T", "artists": ["B"], "featured": [], "released": None, "version": {"kind": "cover", "name": None, "by": [], "year": None, "of": "A"}}
        assert credits.artist_string(song) == "B"
        assert credits.lookup_artist(song) == "A"
        assert credits.released({"released": 1990, "artists": []}) == 1990
        assert credits.released({"year": 1991}) == 1991


def stored(**over):
    song = {"id": "aaaaaaaaaa1", "title": "T", "artists": ["A", "B"], "featured": ["C"], "released": 1999,
            "version": {"kind": "remix", "name": "Alesso Remix", "by": ["Alesso"], "year": 2012},
            "raw": {"title": "T", "artist": "A - B"}}
    song.update(over)
    return song


def applied(changes, **over):
    song = stored(**over)
    credits.apply_changes(song, changes)
    return song


class TestApplyChanges:
    def test_structure_replaces_and_artists_alone_keeps_featured(self):
        song = applied({"artists": ["X"]})
        assert (song["artists"], song["featured"]) == (["X"], ["C"])
        song = applied({"featured": []})
        assert (song["artists"], song["featured"]) == (["A", "B"], [])

    def test_structure_shadows_every_legacy_key_of_its_group(self):
        song = applied({"artists": ["X"], "artist": "Totally Different", "version": None, "remixer": "Other Remix", "remix_year": 2030, "released": 2001, "year": 2002})
        assert song["artists"] == ["X"]
        assert "version" not in song
        assert song["released"] == 2001

    def test_version_null_removes_it_and_shadows_remixer(self):
        song = applied({"version": None, "remixer": "Alesso Remix"})
        assert "version" not in song

    def test_version_object_replaces_the_whole_stored_version(self):
        song = applied({"version": {"kind": "live", "name": "Live at X"}})
        assert song["version"] == {"kind": "live", "name": "Live at X", "by": [], "year": None}

    def test_legacy_equal_to_the_projection_is_a_no_op(self):
        before = stored()
        proj = credits.project(before)
        song = applied({"artist": proj["artist"], "remixer": proj["remixer"], "year": proj["year"], "remix_year": proj["remix_year"], "title": "T"})
        assert song == before

    def test_legacy_blank_equals_projected_null(self):
        song = stored(artists=[], featured=[], released=None)
        song.pop("version")
        credits.apply_changes(song, {"artist": "  ", "remixer": "", "year": None, "remix_year": None})
        assert song["artists"] == [] and "version" not in song

    def test_changed_legacy_artist_becomes_pills_and_clears_featured(self):
        song = applied({"artist": "X & Y - Z"})
        assert (song["artists"], song["featured"]) == (["X & Y", "Z"], [])

    def test_cleared_legacy_remixer_removes_the_version(self):
        assert "version" not in applied({"remixer": None})

    def test_changed_legacy_remixer_renames_but_keeps_kind_by_and_year(self):
        song = applied({"remixer": "Bob Remix"})
        assert song["version"] == {"kind": "remix", "name": "Bob Remix", "by": ["Alesso"], "year": 2012}

    def test_legacy_remixer_creates_a_version_when_none_exists(self):
        song = stored()
        song.pop("version")
        credits.apply_changes(song, {"remixer": "Mixed By DJ Q"})
        assert song["version"] == {"kind": "other", "name": "Mixed By DJ Q", "by": [], "year": None}
        song.pop("version")
        credits.apply_changes(song, {"remixer": "Bob Remix"})
        assert song["version"]["kind"] == "remix"

    def test_legacy_remix_year_sets_or_creates(self):
        assert applied({"remix_year": 2020})["version"]["year"] == 2020
        assert applied({"remix_year": None})["version"]["year"] is None
        song = stored()
        song.pop("version")
        credits.apply_changes(song, {"remix_year": 2020})
        assert song["version"] == {"kind": "other", "name": None, "by": [], "year": 2020}
        orphan = stored(version={"kind": "other", "name": None, "by": [], "year": 2012})
        credits.apply_changes(orphan, {"remix_year": None})
        assert "version" not in orphan

    def test_legacy_year_sets_released(self):
        assert applied({"year": 2005})["released"] == 2005
        assert applied({"year": None})["released"] is None

    def test_raw_is_never_touched(self):
        song = applied({"artists": ["Z"], "released": 2001, "version": None})
        assert song["raw"] == {"title": "T", "artist": "A - B"}

    def test_a_new_key_is_placed_in_the_documented_order(self):
        song = {"id": "x", "title": "T", "artists": [], "featured": [], "released": None, "raw": {"title": "T"}, "album": None}
        credits.apply_changes(song, {"version": {"kind": "live"}})
        assert list(song) == ["id", "title", "artists", "featured", "released", "version", "raw", "album"]

    def test_names_are_trimmed_deduped_case_insensitively_and_empties_dropped(self):
        assert applied({"artists": [" A ", "a", "", "B", "b "]})["artists"] == ["A", "B"]

    def test_cover_keeps_of_and_other_kinds_must_not_have_it(self):
        song = applied({"version": {"kind": "cover", "of": "Artist A"}})
        assert song["version"] == {"kind": "cover", "name": None, "by": [], "year": None, "of": "Artist A"}
        with pytest.raises(ValueError, match="only for covers"):
            applied({"version": {"kind": "remix", "of": "Artist A"}})

    def test_an_empty_other_version_is_dropped(self):
        assert "version" not in applied({"version": {"kind": "other", "name": " ", "by": [], "year": None}})


class TestValidation:
    @pytest.mark.parametrize("changes, message", [
        ({"artists": "A"}, "artists must be a list of at most 30 names"),
        ({"artists": [f"n{i}" for i in range(31)]}, "artists must be a list of at most 30 names"),
        ({"artists": [1]}, "artists must be a list of at most 30 names"),
        ({"artists": ["x" * 201]}, "at most 200 characters"),
        ({"featured": [f"n{i}" for i in range(31)]}, "featured must be a list of at most 30 names"),
        ({"version": {"kind": "bogus"}}, "version.kind must be one of remix, live"),
        ({"version": {}}, "version.kind must be one of"),
        ({"version": "x"}, "version must be an object or null"),
        ({"version": {"kind": "remix", "extra": 1}}, "unknown keys"),
        ({"version": {"kind": "remix", "name": "x" * 301}}, "version.name must be at most 300"),
        ({"version": {"kind": "remix", "by": [f"n{i}" for i in range(31)]}}, "version.by must be a list of at most 30 names"),
        ({"version": {"kind": "remix", "year": 1899}}, "version.year must be from 1900 to 2027"),
        ({"version": {"kind": "remix", "year": 2028}}, "version.year must be from 1900 to 2027"),
        ({"version": {"kind": "cover", "of": "x" * 201}}, "version.of must be at most 200"),
        ({"released": 1899}, "released must be from 1900 to 2027"),
        ({"released": 2028}, "released must be from 1900 to 2027"),
        ({"released": "x"}, "released must be from 1900 to 2027"),
        ({"year": 2028}, "year must be from 1900 to 2027"),
        ({"remix_year": 1899}, "remix_year must be from 1900 to 2027"),
    ])
    def test_rejections(self, changes, message):
        with pytest.raises(ValueError, match=message):
            credits.clean_changes(changes, stored())

    @pytest.mark.parametrize("year", [1900, 2027])
    def test_boundaries_pass(self, year):
        assert credits.clean_changes({"released": year, "version": {"kind": "live", "year": year}}, stored())["released"] == year

    def test_an_unchanged_stored_out_of_range_year_passes(self):
        song = stored(released=1850, version={"kind": "remix", "name": "R", "by": [], "year": 2099})
        out = credits.clean_changes({"released": 1850, "version": {"kind": "remix", "name": "R", "year": 2099}}, song)
        assert out["released"] == 1850 and out["version"]["year"] == 2099
        with pytest.raises(ValueError):
            credits.clean_changes({"released": 1851}, song)

    def test_failed_apply_leaves_the_song_unchanged(self):
        song = stored()
        before = copy.deepcopy(song)
        with pytest.raises(ValueError):
            credits.apply_changes(song, {"artists": ["Z"], "released": 3000})
        assert song == before


class TestNewFields:
    def test_structure_only(self):
        fields = credits.new_fields({"title": "T", "artists": ["A", "B"], "featured": ["C"], "released": 2001, "version": {"kind": "live", "name": "Live"}}, {"title": "T raw", "artist": "A & B"})
        assert list(fields) == ["artists", "featured", "released", "version", "raw"]
        assert fields["raw"] == {"title": "T raw", "artist": "A & B"}
        assert fields["version"] == {"kind": "live", "name": "Live", "by": [], "year": None}

    def test_legacy_only_from_ios_and_raw_from_the_submitted_strings(self):
        fields = credits.new_fields({"title": "Song", "artist": "Band", "album": "", "remixer": None, "year": None})
        assert fields == {"artists": ["Band"], "featured": [], "released": None, "raw": {"title": "Song", "artist": "Band"}}

    def test_legacy_remixer_and_years(self):
        fields = credits.new_fields({"title": "S", "artist": "A", "remixer": "X Remix", "year": 2000, "remix_year": 2012})
        assert fields["version"] == {"kind": "remix", "name": "X Remix", "by": [], "year": 2012}
        assert fields["released"] == 2000
        assert fields["raw"]["remixer"] == "X Remix"

    def test_structure_wins_over_legacy(self):
        fields = credits.new_fields({"artist": "Legacy", "artists": ["New"], "year": 1990, "released": 2001})
        assert (fields["artists"], fields["released"]) == (["New"], 2001)

    def test_nothing_sent(self):
        assert credits.new_fields({}) == {"artists": [], "featured": [], "released": None}

    def test_invalid_input_raises(self):
        with pytest.raises(ValueError):
            credits.new_fields({"released": 3000})


class TestAbsorb:
    def test_legacy_keys_are_converted_and_removed(self):
        song = stored()
        song["artist"], song["year"] = "Brand New", 2003
        assert credits.absorb(song) is True
        assert song["artists"] == ["Brand New"] and song["released"] == 2003
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
        assert song["released"] == 1999 and "year" not in song
        assert song["raw"]["rejected"] == {"year": 3000}
