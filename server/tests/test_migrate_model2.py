import copy
import json
import logging
import random
from pathlib import Path

import pytest

from app import credits, genre_filter, library, migrate_model2
from tests.test_credits_properties import legacy_song

FIX = json.loads((Path(__file__).parent / "fixtures" / "live_library_sample.json").read_text(encoding="utf-8"))
LIVE, EXPECTED = FIX["library"], FIX["expected"]
FIELDS = migrate_model2.LEGACY_FIELDS


def write(tmp_path, doc, uid="u1"):
    path = tmp_path / "users" / uid / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


def derived(song):
    proj = credits.project(song)
    return {k: proj[k] for k in FIELDS}


def test_the_live_shapes_convert_with_the_real_derived_values_unchanged():
    doc, report = migrate_model2.convert(LIVE)
    assert report["ok"] is True
    assert report["legacy_diffs"] == []
    assert report["songs"] == len(LIVE["songs"])
    for song in doc["songs"]:
        want = {k: (v.strip() or None) if isinstance(v, str) else v for k, v in EXPECTED[song["id"]].items()}
        assert derived(song) == want, song["id"]
    assert doc["settings"]["credits_schema"] == 2


def test_the_converted_songs_have_only_v2_keys():
    doc, _ = migrate_model2.convert(LIVE)
    for song in doc["songs"]:
        for old in ("artists", "featured", "released", "album", "artist", "remixer", "year", "remix_year"):
            assert old not in song, (song["id"], old)
        assert {"mainArtists", "featuredArtists", "releaseYear", "albums"} <= set(song)
        assert all(not str(t).startswith(("decade:", "lang:", "country:")) for t in song.get("tags", []))
        assert all(set(e) == {"platform", "url"} for e in song.get("sources", []))
        version = song.get("version")
        if version:
            assert set(version) - {"originalArtists"} == {"type", "name", "artists", "releaseYear"}
            assert version["type"] in credits.TYPES


def test_the_tag_counts_match_the_input():
    _, report = migrate_model2.convert(LIVE)
    want = {p: sum(1 for s in LIVE["songs"] for t in s.get("tags", []) if t.startswith(p + ":")) for p in ("decade", "lang", "country")}
    assert report["tags_removed"] == want
    assert want["decade"] > 0
    assert want["lang"] > 0
    assert want["country"] > 0
    assert report["decade_tags_disagreeing_with_release_year"] == 0


def test_the_artist_table_comes_from_single_main_artists_and_unassignable_countries_are_reviewed():
    doc, report = migrate_model2.convert(LIVE)
    table = {e["name"]: e["countries"] for e in doc["artists"]}
    names = {n.casefold() for s in doc["songs"] for n in s["mainArtists"]}
    assert {n.casefold() for n in table} == names
    for entry in report["review"]["multi_artist_countries"]:
        assert len(entry["mainArtists"]) > 1
        assert entry["countries"]
    single = [s for s in LIVE["songs"] if len(s["artists"]) == 1]
    countries = {s["artists"][0]: [t[8:] for t in s["tags"] if t.startswith("country:")] for s in single}
    reviewed = {c["artist"].casefold() for c in report["review"]["conflicting_countries"]}
    for artist, found in countries.items():
        if found and artist.casefold() not in reviewed and not any(n.casefold() == artist.casefold() and table[n] != found for n in table):
            assert {n.casefold(): c for n, c in table.items()}[artist.casefold()] == found
    assert report["artists"]["total"] == len(table)


def test_the_input_is_not_modified():
    before = copy.deepcopy(LIVE)
    migrate_model2.convert(LIVE)
    assert LIVE == before


def test_a_dry_run_writes_nothing_but_the_report(tmp_path):
    path = write(tmp_path, LIVE)
    original = path.read_bytes()
    out = migrate_model2.migrate(path, report_path=tmp_path / "report.json")
    assert out["status"] == "dry_run"
    assert path.read_bytes() == original
    assert json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))["status"] == "dry_run"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["report.json", "users"]


def test_apply_backs_up_rewrites_and_refuses_to_run_twice(tmp_path):
    path = write(tmp_path, LIVE)
    original = path.read_bytes()
    out = migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    assert out["status"] == "migrated"
    assert (tmp_path / "bk" / "library.json").read_bytes() == original
    migrated = json.loads(path.read_text(encoding="utf-8"))
    assert migrate_model2.is_model2(migrated)
    again = migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    assert again["status"] == "already_migrated"
    assert json.loads(path.read_text(encoding="utf-8")) == migrated
    assert (tmp_path / "bk" / "library.json").read_bytes() == original


def test_a_restored_old_file_gets_a_numbered_backup_not_an_overwrite(tmp_path):
    path = write(tmp_path, LIVE)
    migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    path.write_text(json.dumps(LIVE), encoding="utf-8")
    migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    assert sorted(p.name for p in (tmp_path / "bk").iterdir() if p.name.startswith("library")) == ["library.1.json", "library.json"]


def test_the_migrated_file_loads_and_serves_the_same_derived_values(tmp_path):
    path = write(tmp_path, LIVE)
    migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    doc = library.load_doc(path)
    assert len(doc["songs"]) == len(LIVE["songs"])
    for song in doc["songs"]:
        view = library.public_song(song, None)
        want = {k: (v.strip() or None) if isinstance(v, str) else v for k, v in EXPECTED[song["id"]].items()}
        assert {k: view[k] for k in FIELDS} == want
        assert view["genres"] == library.genre_names(song["tags"])
    old_by_id = {s["id"]: s for s in LIVE["songs"]}
    for song in doc["songs"]:
        view = library.public_song(song, None)
        shown = (view.get("version") or {}).get("releaseYear")
        skip = ("lang:", "country:", "decade:") if shown else ("lang:", "country:")
        old = {"genre:eurodance" if t == "genre:eurobeat" else t for t in old_by_id[song["id"]]["tags"] if not t.startswith(skip) and not (t.startswith("genre:") and genre_filter.is_dropped(t[6:]))}
        assert {t for t in view["tags"] if not t.startswith(skip)} == old


def test_updated_at_and_other_fields_are_untouched():
    doc, _ = migrate_model2.convert(LIVE)
    for old, new in zip(LIVE["songs"], doc["songs"]):
        assert new.get("updated_at") == old.get("updated_at")
        for key in ("id", "title", "bpm", "duration", "added_at", "musicbrainz_url"):
            assert new.get(key) == old.get(key)


def test_a_difference_in_a_derived_field_aborts_and_writes_nothing(tmp_path, monkeypatch):
    path = write(tmp_path, LIVE)
    original = path.read_bytes()
    real = credits.project
    monkeypatch.setattr(credits, "project", lambda song: {**real(song), "year": 1} if song.get("id") == LIVE["songs"][3]["id"] else real(song))
    out = migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    assert out["status"] == "aborted"
    assert [d["id"] for d in out["legacy_diffs"]] == [LIVE["songs"][3]["id"]]
    assert path.read_bytes() == original
    assert not (tmp_path / "bk").exists()
    with pytest.raises(migrate_model2.MigrationAborted):
        migrate_model2.check(out)


def test_raw_stays_only_where_the_artist_text_would_change():
    old = {"settings": {"credits_schema": 1}, "songs": [
        {"id": "a", "title": "A", "artists": ["X", "Y"], "featured": [], "released": 2000, "album": None, "raw": {"title": "A raw", "artist": "X - Y"}},
        {"id": "b", "title": "B", "artists": ["Z"], "featured": [], "released": None, "album": "Al", "raw": {"title": "B raw", "artist": "Z"}},
    ]}
    doc, report = migrate_model2.convert(old)
    a, b = doc["songs"]
    assert report["raw_kept"] == ["a"]
    assert a["raw"]["artist"] == "X - Y"
    assert a["rawTitle"] == "A raw"
    assert "raw" not in b
    assert b["rawTitle"] == "B raw"
    assert b["albums"] == ["Al"]
    assert report["ok"] is True


def test_countries_go_to_single_artists_conflicts_and_groups_are_reviewed():
    old = {"songs": [
        {"id": "a", "title": "A", "artists": ["Solo"], "featured": [], "released": 1995, "tags": ["genre:house", "decade:90s", "country:us", "lang:en"]},
        {"id": "b", "title": "B", "artists": ["Solo"], "featured": [], "released": 1996, "tags": ["country:us"]},
        {"id": "c", "title": "C", "artists": ["Odd"], "featured": [], "released": 1997, "tags": ["country:fr"]},
        {"id": "d", "title": "D", "artists": ["Odd"], "featured": [], "released": 1997, "tags": ["country:de"]},
        {"id": "e", "title": "E", "artists": ["P", "Q"], "featured": [], "released": 2001, "tags": ["country:gb", "decade:70s"]},
    ]}
    doc, report = migrate_model2.convert(old)
    table = {e["name"]: e["countries"] for e in doc["artists"]}
    assert table == {"Odd": [], "P": [], "Q": [], "Solo": ["us"]}
    assert report["review"]["conflicting_countries"] == [{"artist": "Odd", "countries": [["fr"], ["de"]]}]
    assert report["review"]["multi_artist_countries"] == [{"id": "e", "mainArtists": ["P", "Q"], "countries": ["gb"]}]
    assert report["tags_removed"] == {"decade": 2, "lang": 1, "country": 5}
    assert report["decade_tags_disagreeing_with_release_year"] == 1
    assert doc["songs"][0]["genres"] == ["house"]
    assert "tags" not in doc["songs"][0]


def test_review_file_is_written_on_apply(tmp_path):
    old = {"songs": [{"id": "e", "title": "E", "artists": ["P", "Q"], "featured": [], "released": 2001, "tags": ["country:gb"]}]}
    path = write(tmp_path, old)
    migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    review = json.loads((tmp_path / "bk" / "review-model2-u1.json").read_text(encoding="utf-8"))
    assert review["review"]["multi_artist_countries"][0]["id"] == "e"


@pytest.mark.parametrize("seed", range(8))
def test_flat_legacy_songs_round_trip_old_to_new_to_derived(seed):
    rng = random.Random(900 + seed)
    songs = [legacy_song(rng, i) for i in range(60)]
    for s in songs:
        s["tags"] = ["x", "decade:90s"]
    expected = [credits_v1_view(s) for s in songs]
    doc, report = migrate_model2.convert({"songs": copy.deepcopy(songs)})
    assert report["ok"], report["legacy_diffs"][:2]
    assert [{k: v for k, v in derived(s).items() if k != "album"} for s in doc["songs"]] == expected
    again, _ = migrate_model2.convert(doc)
    assert again["songs"] == doc["songs"]
    assert again["artists"] == doc["artists"]


def credits_v1_view(song):
    from app import credits_v1

    proj = credits_v1.project_v1(copy.deepcopy(song))
    return {k: proj[k] for k in ("artist", "remixer", "year", "remix_year")}


def test_conversion_is_idempotent_on_the_live_shapes():
    doc, _ = migrate_model2.convert(LIVE)
    assert migrate_model2.is_model2(doc)
    again, report = migrate_model2.convert(doc)
    assert again == doc
    assert report["songs_converted"] == 0


@pytest.mark.parametrize("raw", [
    None, [], {}, {"settings": {"credits_schema": 1}, "songs": []},
    {"settings": {"credits_schema": 2}, "songs": [{"id": "a", "artists": ["x"]}]},
    {"settings": {"credits_schema": 2}, "songs": [{"id": "a", "mainArtists": [], "artist": "x"}]},
])
def test_is_model2_is_false_for_older_or_mixed_files(raw):
    assert migrate_model2.is_model2(raw) is False


def test_a_missing_file_is_reported(tmp_path):
    assert migrate_model2.migrate(tmp_path / "nope.json")["status"] == "missing"


def test_the_command_line_runs_a_dry_run_then_an_apply(tmp_path, capsys):
    path = write(tmp_path, LIVE)
    assert migrate_model2.main(["--library", str(path), "--report", str(tmp_path / "r.json")]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "dry_run"
    assert migrate_model2.main(["--library", str(path), "--apply", "--backup-dir", str(tmp_path / "bk")]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "migrated"
    assert migrate_model2.main(["--library", str(path), "--apply", "--backup-dir", str(tmp_path / "bk")]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "already_migrated"


def test_the_command_line_fails_on_an_abort(tmp_path, monkeypatch, capsys):
    path = write(tmp_path, LIVE)
    real = credits.project
    monkeypatch.setattr(credits, "project", lambda song: {**real(song), "artist": "changed"})
    assert migrate_model2.main(["--library", str(path)]) == 1
    assert json.loads(capsys.readouterr().out)["status"] == "aborted"


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(migrate_model2.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(migrate_model2.deps, "SYNC", None)
    return tmp_path


def test_startup_migrates_every_user_once(datadir, caplog):
    first = write(datadir, LIVE, "u1")
    second = write(datadir, LIVE, "u2")
    with caplog.at_level(logging.INFO, logger="app.migrate_model2"):
        assert migrate_model2.run() == 2
    assert all(migrate_model2.is_model2(json.loads(p.read_text(encoding="utf-8"))) for p in (first, second))
    assert (datadir / "backups-model2" / "u1" / "library.json").exists()
    assert migrate_model2.run() == 0
    assert "data model 2 migrated for u1" in caplog.text


def test_startup_logs_an_abort_and_leaves_the_file(datadir, monkeypatch, caplog):
    path = write(datadir, LIVE, "u1")
    original = path.read_bytes()
    monkeypatch.setattr(credits, "project", lambda song: {"artist": "x", "remixer": None, "year": None, "remix_year": None, "album": None})
    assert migrate_model2.run() == 0
    assert path.read_bytes() == original
    assert "aborted" in caplog.text


def test_startup_survives_a_corrupt_library(datadir, caplog):
    bad = datadir / "users" / "u1" / "library.json"
    bad.parent.mkdir(parents=True)
    bad.write_text("{not json")
    assert migrate_model2.run() == 0
    assert "failed" in caplog.text
    assert migrate_model2.deps.data_root() == datadir


def test_startup_without_users_does_nothing(datadir):
    assert migrate_model2.run() == 0
