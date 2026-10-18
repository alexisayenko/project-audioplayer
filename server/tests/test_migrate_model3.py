import contextlib
import copy
import hashlib
import json
import logging
import os
from types import SimpleNamespace

import pytest

from app import library, migrate_model2, migrate_model3


def song(sid, artists, countries=None, **extra):
    s = {"id": sid, "title": sid.upper(), "mainArtists": list(artists), "featuredArtists": [], "releaseYear": 1990, "albums": [],
         "genres": ["house"], "sources": [{"platform": "youtube", "url": f"https://www.youtube.com/watch?v={sid}"}],
         "file": f"{sid}.m4a", "added_at": "2026-01-01T00:00:00Z", "updated_at": "2026-02-02T00:00:00Z", **extra}
    if countries is not None:
        s["tags"] = [f"country:{c}" for c in countries]
    return s


def legacy(sid, artist, tags):
    return {"id": sid, "title": sid.upper(), "artist": artist, "year": 1990, "tags": ["genre:house", "decade:90s", *tags]}


def v2(songs, table, **extra):
    return {"settings": {"music_root": "perkunas://data/music/", "credits_schema": 2}, "songs": songs, "artists": table, **extra}


def entry(name, *countries):
    return {"name": name, "countries": list(countries)}


def write(tmp_path, doc, uid="u1"):
    path = tmp_path / "users" / uid / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    return path


def write_legacy(tmp_path, songs, uid="u1", name="library.json"):
    path = tmp_path / "backups-model2" / uid / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"songs": songs}), encoding="utf-8")
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree(root):
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())


def tags_of(doc):
    return {s["id"]: [t for t in s.get("tags", []) if t.startswith("country:")] for s in doc["songs"]}


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(migrate_model3.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(migrate_model3.deps, "SYNC", None)
    return tmp_path


def library_v2():
    return v2([
        song("kb1", ["Kate Bush"]), song("kb2", ["Kate Bush"]), song("kb3", ["Kate Bush"]),
        song("ka1", ["Kato"]), song("ka2", ["Kato"]),
        song("ed1", ["Edited"]), song("ed2", ["Edited"]),
        song("duo", ["Pa", "Qa"]), song("duo2", ["Pa", "Qa"]), song("duo3", ["Pa", "Zz"]),
        song("new", ["Fresh"]), song("none", ["Nobody"]), song("ussr", ["Soviet"]),
        song("many", ["Wide"]), song("tagged", ["Tg"], tags=["country:it", "keep"]),
    ], [entry("Edited", "de"), entry("Fresh", "es"), entry("Kate Bush"), entry("Kato"), entry("Nobody"), entry("Pa", "gb"), entry("Qa", "fr"),
        entry("Soviet"), entry("Tg"), entry("Wide"), entry("Zz")])


def library_backup():
    return [
        legacy("kb1", "Kate Bush", ["country:gb"]), legacy("kb2", "Kate Bush", ["country:fi"]), legacy("kb3", "Kate Bush", ["country:gb"]),
        legacy("ka1", "Kato", ["country:us"]), legacy("ka2", "Kato", ["country:dk"]),
        legacy("ed1", "Edited", ["country:fr"]), legacy("ed2", "Edited", ["country:fr"]),
        legacy("duo", "Pa - Qa", ["country:gb", "country:it"]), legacy("duo2", "Pa - Qa", []),
        legacy("none", "Nobody", []), legacy("ussr", "Soviet", ["country:ussr"]),
        legacy("many", "Wide", ["country:gb", "country:fr", "country:de", "country:Atlantis"]),
    ]


def run(tmp_path, apply=False, doc=None, legacy_songs=None, **kw):
    path = write(tmp_path, doc or library_v2())
    src = write_legacy(tmp_path, legacy_songs if legacy_songs is not None else library_backup()) if legacy_songs != "none" else None
    out = migrate_model3.migrate(path, apply=apply, backup_dir=tmp_path / "bk", legacy_backup=src, **kw)
    return path, out


def test_each_song_gets_its_countries_by_the_rule(tmp_path):
    path, out = run(tmp_path, apply=True)
    assert out["status"] == "migrated"
    assert out["anomalies"] == []
    got = tags_of(json.loads(path.read_text(encoding="utf-8")))
    assert got["kb1"] == ["country:gb"]
    assert got["kb2"] == ["country:fi"]
    assert got["kb3"] == ["country:gb"]
    assert got["ka1"] == ["country:us"]
    assert got["ka2"] == ["country:dk"]
    assert got["ed1"] == ["country:de"]
    assert got["ed2"] == ["country:de"]
    assert got["duo"] == ["country:gb", "country:it"]
    assert got["duo2"] == ["country:gb", "country:fr"]
    assert got["duo3"] == ["country:gb"]
    assert got["new"] == ["country:es"]
    assert got["none"] == []
    assert got["tagged"] == ["country:it"]
    assert got["ussr"] == ["country:su"]
    assert got["many"] == ["country:gb", "country:fr", "country:de"]


def test_report_counts_and_lists_disagreements(tmp_path):
    _, out = run(tmp_path)
    assert out["status"] == "dry_run"
    assert out["songs"] == 15
    assert out["artists_table_removed"] == 11
    assert out["countries_restored_from_backup"] == 8
    assert out["countries_taken_from_table"] == 5
    assert out["countries_already_on_song"] == 1
    assert out["left_empty"] == 1
    assert out["table_and_backup_disagree"] == {"songs": 3, "ids": ["ed1", "ed2", "duo"]}
    assert out["unknown_country_values_in_backup"] == 1
    assert out["backup_found"] is True


def test_a_single_artist_edit_after_model_2_wins_over_the_backup(tmp_path):
    path, out = run(tmp_path, apply=True)
    assert tags_of(json.loads(path.read_text(encoding="utf-8")))["ed1"] == ["country:de"]
    assert "ed1" in out["table_and_backup_disagree"]["ids"]


def test_the_song_with_several_countries_in_the_backup_keeps_all_of_them(tmp_path):
    path, _ = run(tmp_path, apply=True)
    assert tags_of(json.loads(path.read_text(encoding="utf-8")))["many"] == ["country:gb", "country:fr", "country:de"]


def test_several_main_artists_without_a_backup_entry_take_the_table_union_and_none_when_empty(tmp_path):
    lib = v2([song("a", ["X", "Y"]), song("b", ["Em", "Pty"])], [entry("X", "gb", "fr"), entry("Y", "fr", "de"), entry("Em"), entry("Pty")])
    path, out = run(tmp_path, apply=True, doc=lib, legacy_songs=[])
    got = tags_of(json.loads(path.read_text(encoding="utf-8")))
    assert got == {"a": ["country:gb", "country:fr", "country:de"], "b": []}
    assert out["countries_taken_from_table"] == 1
    assert out["left_empty"] == 1


def test_without_a_backup_file_only_the_table_rules_apply(tmp_path):
    path, out = run(tmp_path, apply=True, legacy_songs="none")
    assert out["status"] == "migrated"
    assert out["backup_found"] is False
    assert out["legacy_backup"] is None
    got = tags_of(json.loads(path.read_text(encoding="utf-8")))
    assert got["kb1"] == []
    assert got["ed1"] == ["country:de"]
    assert got["duo"] == ["country:gb", "country:fr"]
    assert got["tagged"] == ["country:it"]
    assert out["countries_restored_from_backup"] == 0


def test_the_table_is_removed_and_the_stamp_is_3_and_nothing_else_changes(tmp_path):
    before = library_v2()
    path, _ = run(tmp_path, apply=True)
    after = json.loads(path.read_text(encoding="utf-8"))
    assert "artists" not in after
    assert after["settings"] == {"music_root": "perkunas://data/music/", "credits_schema": 3}
    assert [s["id"] for s in after["songs"]] == [s["id"] for s in before["songs"]]
    for old, new in zip(before["songs"], after["songs"]):
        assert {k: v for k, v in old.items() if k != "tags"} == {k: v for k, v in new.items() if k != "tags"}
        assert [t for t in old.get("tags", []) if not t.startswith("country:")] == [t for t in new.get("tags", []) if not t.startswith("country:")]
        assert new["updated_at"] == old["updated_at"]


def test_the_migrated_file_is_served_with_the_countries_in_the_tags_view(tmp_path):
    path, _ = run(tmp_path, apply=True)
    doc = library.load_doc(path)
    assert "artists" not in doc
    views = {s["id"]: library.public_song(s, None)["tags"] for s in doc["songs"]}
    assert views["kb2"] == ["genre:house", "decade:90s", "country:fi"]
    assert views["tagged"] == ["genre:house", "keep", "decade:90s", "country:it"]


def test_a_second_run_does_nothing(tmp_path):
    path, _ = run(tmp_path, apply=True)
    first = digest(path)
    out = migrate_model3.migrate(path, apply=True, backup_dir=tmp_path / "bk", legacy_backup=tmp_path / "backups-model2" / "u1" / "library.json")
    assert out["status"] == "already_migrated"
    assert digest(path) == first
    assert sorted(p.name for p in (tmp_path / "bk").iterdir()) == ["library.json"]


def test_a_dry_run_touches_nothing_but_the_report(tmp_path):
    path = write(tmp_path, library_v2())
    src = write_legacy(tmp_path, library_backup())
    before = {p: digest(p) for p in (path, src)}
    files = tree(tmp_path)
    out = migrate_model3.migrate(path, report_path=tmp_path / "report.json", legacy_backup=src)
    assert out["status"] == "dry_run"
    assert {p: digest(p) for p in (path, src)} == before
    assert tree(tmp_path) == sorted([*files, "report.json"])
    assert json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))["countries_restored_from_backup"] == 8


def test_the_backup_is_a_byte_copy_and_a_restored_file_gets_a_numbered_one(tmp_path):
    path = write(tmp_path, library_v2())
    src = write_legacy(tmp_path, library_backup())
    original = path.read_bytes()
    migrate_model3.migrate(path, apply=True, backup_dir=tmp_path / "bk", legacy_backup=src)
    assert (tmp_path / "bk" / "library.json").read_bytes() == original
    path.write_bytes(original)
    out = migrate_model3.migrate(path, apply=True, backup_dir=tmp_path / "bk", legacy_backup=src)
    assert out["status"] == "migrated"
    assert out["backup"].endswith("library.1.json")
    assert (tmp_path / "bk" / "library.json").read_bytes() == original
    assert (tmp_path / "bk" / "library.1.json").read_bytes() == original


def test_the_write_is_atomic_and_leaves_no_temp_files(tmp_path):
    path, _ = run(tmp_path, apply=True)
    assert not [p for p in path.parent.iterdir() if p.name != "library.json"]
    assert json.loads(path.read_text(encoding="utf-8"))["settings"]["credits_schema"] == 3


def test_a_failing_write_leaves_the_library_and_no_temp_file(tmp_path, monkeypatch):
    path = write(tmp_path, library_v2())
    src = write_legacy(tmp_path, library_backup())
    original = path.read_bytes()
    monkeypatch.setattr(os, "replace", lambda *a: (_ for _ in ()).throw(OSError("disk")))
    with pytest.raises(OSError):
        migrate_model3.migrate(path, apply=True, backup_dir=tmp_path / "bk", legacy_backup=src)
    assert path.read_bytes() == original
    assert [p.name for p in path.parent.iterdir()] == ["library.json"]


@pytest.mark.parametrize("what", ["duplicate", "no_id", "tags_not_list", "no_songs"])
def test_an_anomaly_aborts_and_leaves_the_file_unchanged(tmp_path, what):
    lib = library_v2()
    if what == "duplicate":
        lib["songs"].append(copy.deepcopy(lib["songs"][0]))
    elif what == "no_id":
        lib["songs"].append({"title": "x"})
    elif what == "tags_not_list":
        lib["songs"][0]["tags"] = "country:gb"
    else:
        lib["songs"] = {"oops": 1}
    path, out = run(tmp_path, apply=True, doc=lib)
    assert out["status"] == "aborted"
    assert out["anomalies"]
    assert out["ok"] is False
    assert json.loads(path.read_text(encoding="utf-8")) == lib
    assert not (tmp_path / "bk").exists()


def test_an_unreadable_backup_aborts(tmp_path):
    path = write(tmp_path, library_v2())
    bad = tmp_path / "backups-model2" / "u1" / "library.json"
    bad.parent.mkdir(parents=True)
    bad.write_text("{not json", encoding="utf-8")
    original = path.read_bytes()
    out = migrate_model3.migrate(path, apply=True, backup_dir=tmp_path / "bk", legacy_backup=bad)
    assert out["status"] == "aborted"
    assert "cannot be read" in out["anomalies"][0]
    assert path.read_bytes() == original


def test_the_input_is_not_modified():
    lib, back = library_v2(), {"songs": library_backup()}
    before = copy.deepcopy((lib, back))
    migrate_model3.convert(lib, back)
    assert (lib, back) == before


def test_an_older_or_missing_file_is_reported_and_not_touched(tmp_path):
    flat = write(tmp_path, {"songs": [{"id": "a", "title": "A", "artist": "X", "tags": ["country:gb"]}]})
    original = flat.read_bytes()
    assert migrate_model3.migrate(flat, apply=True, backup_dir=tmp_path / "bk")["status"] == "not_model2"
    assert flat.read_bytes() == original
    assert not (tmp_path / "bk").exists()
    assert migrate_model3.migrate(tmp_path / "nope.json")["status"] == "missing"


def test_the_oldest_numbered_copy_of_the_pre_v2_backup_is_the_original(datadir):
    path = write(datadir, library_v2())
    write_legacy(datadir, library_backup(), name="library.2.json")
    write_legacy(datadir, [legacy("kb1", "Kate Bush", ["country:us"])], name="library.10.json")
    write_legacy(datadir, library_backup(), name="library.1.json")
    assert migrate_model3.legacy_backup_path(path).name == "library.1.json"
    write_legacy(datadir, library_backup(), name="library.json")
    assert migrate_model3.legacy_backup_path(path).name == "library.json"
    out = migrate_model3.migrate(path)
    assert out["countries_restored_from_backup"] == 8
    assert out["legacy_backup"].endswith("library.json")


def test_the_command_line_runs_a_dry_run_then_an_apply(tmp_path, capsys):
    path = write(tmp_path, library_v2())
    src = write_legacy(tmp_path, library_backup())
    args = ["--library", str(path), "--legacy-backup", str(src)]
    assert migrate_model3.main([*args, "--report", str(tmp_path / "r.json")]) == 0
    brief = json.loads(capsys.readouterr().out)
    assert brief["status"] == "dry_run"
    assert brief["countries_restored_from_backup"] == 8
    assert brief["table_and_backup_disagree"] == 3
    assert migrate_model3.main([*args, "--apply", "--backup-dir", str(tmp_path / "bk")]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "migrated"
    assert migrate_model3.main([*args, "--apply", "--backup-dir", str(tmp_path / "bk")]) == 0
    assert json.loads(capsys.readouterr().out)["status"] == "already_migrated"


def test_the_command_line_fails_on_an_abort(tmp_path, capsys):
    lib = library_v2()
    lib["songs"].append(copy.deepcopy(lib["songs"][0]))
    path = write(tmp_path, lib)
    assert migrate_model3.main(["--library", str(path), "--legacy-backup", str(tmp_path / "missing.json")]) == 1
    assert json.loads(capsys.readouterr().out)["status"] == "aborted"


def test_startup_migrates_every_user_once_after_model_2_from_a_legacy_file(datadir, caplog):
    legacy_lib = {"songs": [
        {"id": "kb1", "title": "A", "artist": "Kate Bush", "tags": ["genre:pop", "country:gb"]},
        {"id": "kb2", "title": "B", "artist": "Kate Bush", "tags": ["genre:pop", "country:fi"]},
        {"id": "ed1", "title": "C", "artist": "Solo", "tags": ["country:fr", "country:de"]},
    ]}
    paths = [write(datadir, legacy_lib, uid) for uid in ("u1", "u2")]
    assert migrate_model2.run() == 2
    assert all(tags_of(json.loads(p.read_text(encoding="utf-8")))["kb1"] == [] for p in paths)
    with caplog.at_level(logging.INFO, logger="app.migrate_model3"):
        assert migrate_model3.run() == 2
    for p in paths:
        doc = json.loads(p.read_text(encoding="utf-8"))
        assert "artists" not in doc
        assert doc["settings"]["credits_schema"] == 3
        assert tags_of(doc) == {"kb1": ["country:gb"], "kb2": ["country:fi"], "ed1": ["country:fr", "country:de"]}
    assert (datadir / "backups-model3" / "u1" / "library.json").exists()
    assert migrate_model3.run() == 0
    assert migrate_model2.run() == 0
    assert "data model 3 migrated for u1" in caplog.text


def test_startup_commits_once_per_user_with_the_model_3_message(datadir, monkeypatch):
    commits = []

    @contextlib.contextmanager
    def transaction():
        yield

    monkeypatch.setattr(migrate_model3.deps, "SYNC", SimpleNamespace(transaction=transaction, commit=commits.append, data_repo=datadir))
    write(datadir, library_v2(), "user0001-xyz")
    write(datadir, library_v2(), "user0002-xyz")
    assert migrate_model3.run() == 2
    assert commits == ["audioplayer: user0001 migrate data model 3", "audioplayer: user0002 migrate data model 3"]
    assert (datadir / "backups-model3" / "user0001-xyz" / "library.json").exists()


def test_startup_logs_an_abort_and_leaves_the_file(datadir, caplog):
    lib = library_v2()
    lib["songs"].append(copy.deepcopy(lib["songs"][0]))
    path = write(datadir, lib)
    original = path.read_bytes()
    assert migrate_model3.run() == 0
    assert path.read_bytes() == original
    assert "aborted" in caplog.text


def test_startup_skips_a_library_that_is_not_at_schema_2_and_survives_a_corrupt_one(datadir, caplog):
    flat = write(datadir, {"songs": [{"id": "a", "title": "A", "artist": "X"}]}, "u1")
    bad = datadir / "users" / "u2" / "library.json"
    bad.parent.mkdir(parents=True)
    bad.write_text("{not json")
    original = flat.read_bytes()
    assert migrate_model3.run() == 0
    assert flat.read_bytes() == original
    assert "not at schema 2" in caplog.text
    assert "failed" in caplog.text


def test_startup_without_users_does_nothing(datadir):
    assert migrate_model3.run() == 0


def test_is_model3_needs_the_stamp_and_no_table():
    assert migrate_model3.is_model3({"settings": {"credits_schema": 3}, "songs": []})
    assert not migrate_model3.is_model3({"settings": {"credits_schema": 3}, "songs": [], "artists": []})
    assert not migrate_model3.is_model3({"settings": {"credits_schema": 2}, "songs": []})
    assert not migrate_model3.is_model3(None)
    assert not migrate_model3.is_model3({"songs": []})


def test_model_2_leaves_a_v3_file_alone(datadir):
    path, _ = run(datadir, apply=True)
    before = path.read_bytes()
    assert migrate_model2.is_model2(json.loads(before))
    assert migrate_model2.run() == 0
    assert path.read_bytes() == before
