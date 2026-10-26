import copy
import json
import logging

import pytest

from app import credits, migrate_model2

OLD = {"settings": {"credits_schema": 1}, "songs": [
    {"id": "a", "title": "A", "artists": ["Solo"], "featured": [], "released": 1995, "album": "Al", "raw": {"title": "A raw", "artist": "Solo"},
     "tags": ["genre:house", "decade:90s", "country:us", "lang:en"]},
    {"id": "b", "title": "B", "artists": ["Solo"], "featured": ["Guest"], "released": 1996, "tags": ["country:us"]},
    {"id": "c", "title": "C", "artists": ["Odd"], "featured": [], "released": 1997, "tags": ["country:fr"]},
    {"id": "d", "title": "D", "artists": ["Odd"], "featured": [], "released": 1997, "tags": ["country:de"]},
    {"id": "e", "title": "E", "artists": ["P", "Q"], "featured": [], "released": 2001, "tags": ["country:gb", "decade:70s"], "raw": {"title": "E raw", "artist": "P - Q"}},
]}


def write(tmp_path, doc, uid="u1"):
    path = tmp_path / "users" / uid / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


def test_convert_moves_the_flat_fields_into_the_credits_model_and_reports_what_needs_review():
    doc, report = migrate_model2.convert(OLD)
    a, _, _, _, e = doc["songs"]
    assert report["ok"] is True
    assert report["legacy_diffs"] == []
    assert doc["settings"]["credits_schema"] == 2
    assert {"mainArtists", "featuredArtists", "releaseYear", "albums"} <= set(a)
    assert not {"artists", "featured", "released", "album"} & set(a)
    assert a["albums"] == ["Al"]
    assert a["rawTitle"] == "A raw"
    assert "raw" not in a
    assert report["raw_kept"] == ["e"]
    assert e["raw"]["artist"] == "P - Q"
    assert {t["name"]: t["countries"] for t in doc["artists"]} == {"Odd": [], "P": [], "Q": [], "Solo": ["us"]}
    assert report["review"]["conflicting_countries"] == [{"artist": "Odd", "countries": [["fr"], ["de"]]}]
    assert report["review"]["multi_artist_countries"] == [{"id": "e", "mainArtists": ["P", "Q"], "countries": ["gb"]}]
    assert report["tags_removed"] == {"decade": 2, "lang": 1, "country": 5}
    assert report["decade_tags_disagreeing_with_release_year"] == 1
    assert a["genres"] == ["house"]
    assert "tags" not in a


def test_convert_does_not_modify_its_input_and_is_idempotent():
    before = copy.deepcopy(OLD)
    doc, _ = migrate_model2.convert(OLD)
    assert OLD == before
    assert migrate_model2.is_model2(doc)
    again, report = migrate_model2.convert(doc)
    assert again == doc
    assert report["songs_converted"] == 0


def test_a_dry_run_writes_nothing_but_the_report(tmp_path):
    path = write(tmp_path, OLD)
    original = path.read_bytes()
    out = migrate_model2.migrate(path, report_path=tmp_path / "report.json")
    assert out["status"] == "dry_run"
    assert path.read_bytes() == original
    assert json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))["status"] == "dry_run"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["report.json", "users"]


def test_apply_backs_up_rewrites_refuses_to_run_twice_and_numbers_a_second_backup(tmp_path):
    path = write(tmp_path, OLD)
    original = path.read_bytes()
    out = migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    assert out["status"] == "migrated"
    assert (tmp_path / "bk" / "library.json").read_bytes() == original
    migrated = json.loads(path.read_text(encoding="utf-8"))
    assert migrate_model2.is_model2(migrated)
    assert migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")["status"] == "already_migrated"
    assert json.loads(path.read_text(encoding="utf-8")) == migrated
    path.write_text(json.dumps(OLD), encoding="utf-8")
    migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    assert sorted(p.name for p in (tmp_path / "bk").iterdir() if p.name.startswith("library")) == ["library.1.json", "library.json"]


def test_a_difference_in_a_derived_field_aborts_and_writes_nothing(tmp_path, monkeypatch):
    path = write(tmp_path, OLD)
    original = path.read_bytes()
    real = credits.project
    monkeypatch.setattr(credits, "project", lambda song: {**real(song), "year": 1} if song.get("id") == "c" else real(song))
    out = migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    assert out["status"] == "aborted"
    assert [d["id"] for d in out["legacy_diffs"]] == ["c"]
    assert path.read_bytes() == original
    assert not (tmp_path / "bk").exists()
    with pytest.raises(migrate_model2.MigrationAborted):
        migrate_model2.check(out)


def test_review_file_is_written_on_apply(tmp_path):
    path = write(tmp_path, OLD)
    migrate_model2.migrate(path, apply=True, backup_dir=tmp_path / "bk")
    review = json.loads((tmp_path / "bk" / "review-model2-u1.json").read_text(encoding="utf-8"))
    assert review["review"]["multi_artist_countries"][0]["id"] == "e"


@pytest.mark.parametrize("raw", [
    None, [], {}, {"settings": {"credits_schema": 1}, "songs": []},
    {"settings": {"credits_schema": 2}, "songs": [{"id": "a", "artists": ["x"]}]},
    {"settings": {"credits_schema": 2}, "songs": [{"id": "a", "mainArtists": [], "artist": "x"}]},
])
def test_is_model2_is_false_for_older_or_mixed_files(raw):
    assert migrate_model2.is_model2(raw) is False


def test_a_missing_file_is_reported(tmp_path):
    assert migrate_model2.migrate(tmp_path / "nope.json")["status"] == "missing"


def test_the_command_line_runs_a_dry_run_then_an_apply_then_refuses_a_second_one(tmp_path, capsys):
    path = write(tmp_path, OLD)
    assert migrate_model2.main(["--library", str(path), "--report", str(tmp_path / "r.json")]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "dry_run"
    assert migrate_model2.main(["--library", str(path), "--apply", "--backup-dir", str(tmp_path / "bk")]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "migrated"
    assert migrate_model2.main(["--library", str(path), "--apply", "--backup-dir", str(tmp_path / "bk")]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "already_migrated"


def test_the_command_line_fails_on_an_abort(tmp_path, monkeypatch, capsys):
    path = write(tmp_path, OLD)
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
    first = write(datadir, OLD, "u1")
    second = write(datadir, OLD, "u2")
    with caplog.at_level(logging.INFO, logger="app.migrate_model2"):
        assert migrate_model2.run() == 2
    assert all(migrate_model2.is_model2(json.loads(p.read_text(encoding="utf-8"))) for p in (first, second))
    assert (datadir / "backups-model2" / "u1" / "library.json").exists()
    assert migrate_model2.run() == 0
    assert "data model 2 migrated for u1" in caplog.text


def test_startup_logs_an_abort_and_survives_a_corrupt_library_and_no_users(datadir, monkeypatch, caplog):
    assert migrate_model2.run() == 0
    bad = datadir / "users" / "u0" / "library.json"
    bad.parent.mkdir(parents=True)
    bad.write_text("{not json")
    path = write(datadir, OLD, "u1")
    original = path.read_bytes()
    monkeypatch.setattr(credits, "project", lambda song: {"artist": "x", "remixer": None, "year": None, "remix_year": None, "album": None})
    assert migrate_model2.run() == 0
    assert path.read_bytes() == original
    assert "aborted" in caplog.text
    assert "failed" in caplog.text
