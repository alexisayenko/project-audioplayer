import json

import pytest

from app import migrate_removals as mr

OWNER = "owneruid"


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(mr.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(mr.deps, "SYNC", None)
    monkeypatch.setattr(mr.users, "owner_uid", lambda: OWNER)
    return tmp_path


@pytest.fixture
def plan_file(tmp_path, monkeypatch):
    def make(songs, name="removals.json", raw=None):
        path = tmp_path / name
        path.write_text(raw if raw is not None else json.dumps({"version": 1, "songs": songs}), encoding="utf-8")
        monkeypatch.setattr(mr, "DATA_FILE", path)
        monkeypatch.setattr(mr, "load_plan", lambda p=path, f=mr.load_plan: f(p))
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


def test_owner_only_present_genres_order_and_updated_at(datadir, plan_file, caplog):
    plan_file({"a": {"remove": ["pop", "rock"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "pop", "disco"], tags=["country:us"]), song("b", ["pop", "house"])])
    other = lib(datadir, "other", [song("a", ["house", "pop", "disco"])])
    before_other = other.read_bytes()
    with caplog.at_level("INFO", logger="app.migrate_removals"):
        assert mr.run() == 1
    s = stored(owner)
    assert s["a"]["genres"] == ["house", "disco"]
    assert s["a"]["updated_at"] == "2026-02-02T00:00:00Z"
    assert s["a"]["tags"] == ["country:us"]
    assert s["b"]["genres"] == ["pop", "house"]
    assert other.read_bytes() == before_other
    assert "genre removals applied for owneruid: 1 songs, 1 removed, 0 added" in caplog.text


def test_never_empties_a_song_and_logs_it(datadir, plan_file, caplog):
    plan_file({"a": {"remove": ["house", "disco"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "disco"])])
    with caplog.at_level("INFO", logger="app.migrate_removals"):
        mr.run()
    assert stored(owner)["a"]["genres"] == ["disco"]
    assert "would be left without a genre" in caplog.text
    report = json.loads(mr.report_path(OWNER).read_text(encoding="utf-8"))
    assert report["removed"] == {"a": ["house"]}
    assert report["skipped"] == {"a": ["disco"]}


def test_backup_report_marker_and_idempotent(datadir, plan_file):
    plan_file({"a": {"remove": ["pop"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "pop"])])
    original = owner.read_bytes()
    assert mr.run() == 1
    assert mr.backup_path(OWNER).read_bytes() == original
    assert mr.marker_path(OWNER).is_file()
    assert mr.report_path(OWNER).is_file()
    assert "backups-genre-removals" in str(mr.backup_path(OWNER))
    assert "audioplayer" not in str(mr.backup_path(OWNER))
    after = owner.read_bytes()
    lib(datadir, OWNER, [song("a", ["house", "pop"])])
    again = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == again != after


def test_nothing_to_remove_writes_only_the_marker(datadir, plan_file):
    plan_file({"zzz": {"remove": ["pop"]}})
    owner = lib(datadir, OWNER, [song("a", ["house"])])
    before = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == before
    assert mr.marker_path(OWNER).is_file()
    assert not mr.backup_path(OWNER).exists()


def test_switch_off(datadir, plan_file, monkeypatch):
    monkeypatch.setenv("AUDIO_GENRE_REMOVALS", "0")
    plan_file({"a": {"remove": ["pop"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "pop"])])
    before = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == before
    assert not mr.marker_path(OWNER).exists()


@pytest.mark.parametrize("raw", ["{not json", "[]", '{"songs": {"a": {"remove": "pop"}}}', '{"songs": []}'])
def test_malformed_file_is_tolerated(datadir, plan_file, raw, caplog):
    plan_file(None, raw=raw)
    owner = lib(datadir, OWNER, [song("a", ["house", "pop"])])
    before = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == before
    assert "genre removals failed" in caplog.text


def test_a_failure_leaves_the_library_unchanged(datadir, plan_file, monkeypatch, caplog):
    plan_file({"a": {"remove": ["pop"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "pop"])])
    before = owner.read_bytes()

    def boom(*a, **k):
        raise OSError("disk")

    monkeypatch.setattr(mr.library, "save_doc", boom)
    assert mr.run() == 0
    assert owner.read_bytes() == before
    assert not mr.marker_path(OWNER).exists()
    assert "genre removals failed" in caplog.text


def test_missing_owner_library_is_fine(datadir, plan_file):
    plan_file({"a": {"remove": ["pop"]}})
    assert mr.run() == 0


def test_add_appends_after_the_last_genre_validates_and_is_idempotent(datadir, plan_file, caplog):
    plan_file({"a": {"remove": ["pop"], "add": ["Deep  House", "house", "zzzz qqq"]}, "b": {"remove": [], "add": ["house"]}})
    owner = lib(datadir, OWNER, [song("a", ["pop", "house", "disco"], tags=["country:us"]), song("b", ["house"])])
    with caplog.at_level("INFO", logger="app.migrate_removals"):
        assert mr.run() == 1
    s = stored(owner)
    assert s["a"]["genres"] == ["house", "disco", "deep house"]
    assert s["a"]["tags"] == ["country:us"]
    assert s["a"]["updated_at"] == "2026-02-02T00:00:00Z"
    assert s["b"]["genres"] == ["house"]
    assert "genre removals applied for owneruid: 1 songs, 1 removed, 1 added" in caplog.text
    assert "genre addition skipped for owneruid: song a, not in the vocabulary (zzzz qqq)" in caplog.text
    report = json.loads(mr.report_path(OWNER).read_text(encoding="utf-8"))
    assert report["added"] == {"a": ["deep house"]}
    assert report["unknown"] == {"a": ["zzzz qqq"]}
    after = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == after


def test_an_added_genre_is_never_removed_and_keeps_a_song_from_being_empty():
    songs = [{"id": "a", "tags": ["genre:pop", "decade:10s"]}]
    result = mr.apply_plan(songs, {"a": ["pop", "deep house"]}, {"a": ["deep house"]})
    assert songs[0]["tags"] == ["genre:deep house", "decade:10s"]
    assert result["removed"] == {"a": ["pop"]}
    assert result["added"] == {"a": ["deep house"]}
    assert not result["skipped"]


def test_clear_empties_the_genres_only_with_the_flag_and_is_idempotent(datadir, plan_file, caplog):
    plan_file({"a": {"clear": True}, "b": {"remove": ["pop", "house"]}})
    owner = lib(datadir, OWNER, [song("a", ["rock", "pop"], tags=["country:us"]), song("b", ["pop", "house"])])
    with caplog.at_level("INFO", logger="app.migrate_removals"):
        assert mr.run() == 1
    s = stored(owner)
    assert s["a"]["genres"] == []
    assert s["a"]["tags"] == ["country:us"]
    assert s["b"]["genres"] == ["house"]
    assert "song b would be left without a genre (house)" in caplog.text
    report = json.loads(mr.report_path(OWNER).read_text(encoding="utf-8"))
    assert report["cleared"] == {"a": ["rock", "pop"]}
    after = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == after


def test_a_clear_row_with_remove_or_add_is_rejected(plan_file):
    for row in ({"clear": True, "remove": ["pop"]}, {"clear": True, "add": ["pop"]}):
        plan_file({"a": row})
        with pytest.raises(ValueError):
            mr.load_plan(mr.DATA_FILE)


