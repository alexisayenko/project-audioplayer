import json

import pytest

from app import deps, library, main, migrate_retired as mr, migrations

OWNER = "owneruid"


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(mr.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(mr.deps, "SYNC", None)
    return tmp_path


@pytest.fixture
def names_file(tmp_path, monkeypatch):
    def make(names=None, raw=None):
        path = tmp_path / "retired.json"
        path.write_text(raw if raw is not None else json.dumps({"version": 1, "genres": names}), encoding="utf-8")
        monkeypatch.setattr(mr, "DATA_FILE", path)
        return path
    return make


def song(sid, genres, **extra):
    return {"id": sid, "title": sid.upper(), "mainArtists": ["A"], "featuredArtists": [], "genres": genres, "updated_at": "2026-02-02T00:00:00Z", **extra}


def lib(root, uid, songs):
    path = root / "users" / uid / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"settings": {}, "songs": songs}), encoding="utf-8")
    return path


def stored(path):
    return {s["id"]: s for s in json.loads(path.read_text(encoding="utf-8"))["songs"]}


def test_removes_for_every_user_keeps_order_tags_and_updated_at(datadir):
    a = lib(datadir, OWNER, [song("a", ["house", "electronic", "disco"], tags=["country:us"]), song("only", ["electronic"]), song("c", ["pop"])])
    b = lib(datadir, "other", [song("d", ["Electronic ", "techno"])])
    assert mr.run() == 3
    sa, sb = stored(a), stored(b)
    assert sa["a"]["genres"] == ["house", "disco"]
    assert sa["a"]["tags"] == ["country:us"]
    assert sa["only"]["genres"] == []
    assert sa["c"]["genres"] == ["pop"]
    assert sb["d"]["genres"] == ["techno"]
    assert sa["a"]["updated_at"] == "2026-02-02T00:00:00Z"
    assert "electronic" not in json.dumps(library.load_doc(a)["songs"])


def test_backup_marker_and_report(datadir):
    path = lib(datadir, OWNER, [song("a", ["house", "electronic"]), song("only", ["electronic"])])
    before = path.read_bytes()
    mr.run()
    root = datadir / "backups-genre-retired" / OWNER
    assert (root / "library.json").read_bytes() == before
    assert json.loads((root / "applied.json").read_text())["applied"] == ["electronic"]
    run = json.loads((root / "report.json").read_text())["runs"][0]
    assert run["removed"] == {"electronic": 2}
    assert run["songs_touched"] == 2
    assert run["left_without_genre"] == [{"id": "only", "title": "ONLY"}]


def test_second_run_is_a_noop_and_unaffected_users_get_a_marker_only(datadir):
    clean = lib(datadir, "clean", [song("x", ["pop"])])
    lib(datadir, OWNER, [song("a", ["electronic"])])
    clean_before = clean.read_bytes()
    assert mr.run() == 1
    assert clean.read_bytes() == clean_before
    assert not (datadir / "backups-genre-retired" / "clean" / "library.json").exists()
    assert (datadir / "backups-genre-retired" / "clean" / "applied.json").is_file()
    snap = (datadir / "users" / OWNER / "library.json").read_bytes()
    assert mr.run() == 0
    assert (datadir / "users" / OWNER / "library.json").read_bytes() == snap


def test_genre_readded_later_is_not_stripped_again(datadir):
    path = lib(datadir, OWNER, [song("a", ["electronic", "house"])])
    mr.run()
    doc = library.load_doc(path)
    doc["songs"][0]["tags"].append("genre:electronic")
    library.save_doc(path, doc)
    assert mr.run() == 0
    assert "electronic" in stored(path)["a"]["genres"]


def test_a_name_added_later_runs_only_for_itself(datadir, names_file):
    names_file(["electronic"])
    path = lib(datadir, OWNER, [song("a", ["electronic", "house", "disco"])])
    mr.run()
    doc = library.load_doc(path)
    doc["songs"][0]["tags"].append("genre:electronic")
    library.save_doc(path, doc)
    names_file(["electronic", "disco"])
    assert mr.run() == 1
    assert stored(path)["a"]["genres"] == ["house", "electronic"]
    assert json.loads((datadir / "backups-genre-retired" / OWNER / "applied.json").read_text())["applied"] == ["disco", "electronic"]
    assert len(json.loads((datadir / "backups-genre-retired" / OWNER / "report.json").read_text())["runs"]) == 2


def test_switch_off(datadir, monkeypatch, caplog):
    path = lib(datadir, OWNER, [song("a", ["electronic"])])
    before = path.read_bytes()
    monkeypatch.setenv("AUDIO_GENRE_RETIRED", "0")
    with caplog.at_level("INFO", logger="app.migrate_retired"):
        assert mr.run() == 0
    assert path.read_bytes() == before
    assert not (datadir / "backups-genre-retired").exists()
    assert "AUDIO_GENRE_RETIRED=0" in caplog.text


@pytest.mark.parametrize("raw", ["{not json", "[]", '{"genres": "electronic"}', '{"genres": [1]}'])
def test_malformed_names_file_never_raises(datadir, names_file, raw, caplog):
    names_file(raw=raw)
    path = lib(datadir, OWNER, [song("a", ["electronic"])])
    before = path.read_bytes()
    assert mr.run() == 0
    assert path.read_bytes() == before
    assert "retired genres failed" in caplog.text


def test_malformed_library_is_skipped_and_others_continue(datadir, caplog):
    bad = datadir / "users" / "bad" / "library.json"
    bad.parent.mkdir(parents=True)
    bad.write_text("{oops", encoding="utf-8")
    good = lib(datadir, OWNER, [song("a", ["electronic"])])
    assert mr.run() == 1
    assert bad.read_text() == "{oops"
    assert stored(good)["a"]["genres"] == []
    assert "retired genres failed for bad" in caplog.text
    assert not (datadir / "backups-genre-retired" / "bad" / "applied.json").exists()


def test_no_users_dir(datadir):
    assert mr.run() == 0


def test_apply_retired_skips_songs_without_a_tag_list():
    assert mr.apply_retired([{"id": "x"}, {"id": "y", "tags": ["genre:pop"]}], ["electronic"]) == {"removed": {}, "touched": [], "empty": []}


def test_startup_runs_retired_after_renames_and_removals(monkeypatch):
    order = []
    for mod in ("migrate_model2", "migrate_model3", "migrate_tags", "migrate_removals", "migrate_renames", "migrate_retired"):
        monkeypatch.setattr(getattr(migrations, mod), "run", lambda m=mod: order.append(m) or 0)
    monkeypatch.setattr(deps, "SYNC", None)
    main._startup()
    assert order[-2:] == ["migrate_renames", "migrate_retired"]
    assert order.index("migrate_removals") < order.index("migrate_renames")


def _tree_hashes(root):
    import hashlib
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob("*")) if p.is_file()}


def test_startup_migrations_are_idempotent_and_never_re_add_a_retired_genre(datadir, monkeypatch):
    from app import migrate_model2, migrate_model3, migrate_removals, migrate_renames, migrate_tags, users
    monkeypatch.setattr(users, "owner_uid", lambda: OWNER)
    path = lib(datadir, OWNER, [song("wL8DVHuWI7Y", ["music video"]), song("keep", ["electronic", "house"]), song("RVmG_d3HKBA", [])])

    def startup():
        migrate_model2.run()
        migrate_model3.run()
        migrate_tags.run()
        migrate_removals.run()
        migrate_renames.run()
        mr.run()

    startup()
    first = _tree_hashes(datadir)
    assert "electronic" not in json.dumps(stored(path)["wL8DVHuWI7Y"])
    startup()
    assert _tree_hashes(datadir) == first
    assert "electronic" not in json.dumps(stored(path))
    assert "wL8DVHuWI7Y" not in migrate_tags.ONE_OFF or not migrate_tags.apply_one_off([{"id": "wL8DVHuWI7Y", "tags": []}])


def test_one_off_never_adds_a_retired_or_non_canonical_genre(monkeypatch):
    from app import migrate_tags
    monkeypatch.setattr(migrate_tags, "ONE_OFF", {"a": ((), ("genre:electronic",)), "b": ((), ("genre:nosuchgenrexyz",)), "c": ((), ("genre:house",))})
    songs = [{"id": i, "tags": []} for i in "abc"]
    assert migrate_tags.apply_one_off(songs) == ["c"]
    assert [s["tags"] for s in songs] == [[], [], ["genre:house"]]
