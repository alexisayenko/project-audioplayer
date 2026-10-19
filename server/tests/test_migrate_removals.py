import copy
import json
from pathlib import Path

import pytest

from app import library, migrate_removals as mr

OWNER = "owneruid"
FIXTURE = Path(__file__).parent / "fixtures" / "removal_songs.json"


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
    assert "genre removals applied for owneruid: 1 songs, 1 genres" in caplog.text


def test_never_empties_a_song_and_logs_it(datadir, plan_file, caplog):
    plan_file({"a": {"remove": ["house", "disco"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "disco"])])
    with caplog.at_level("INFO", logger="app.migrate_removals"):
        mr.run()
    assert stored(owner)["a"]["genres"] == ["disco"]
    assert "would be left without a genre" in caplog.text
    report = json.loads(mr.report_path(OWNER).read_text(encoding="utf-8"))
    assert report["removed"] == {"a": ["house"]} and report["skipped"] == {"a": ["disco"]}


def test_backup_report_marker_and_idempotent(datadir, plan_file):
    plan_file({"a": {"remove": ["pop"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "pop"])])
    original = owner.read_bytes()
    assert mr.run() == 1
    assert mr.backup_path(OWNER).read_bytes() == original
    assert mr.marker_path(OWNER).is_file() and mr.report_path(OWNER).is_file()
    assert "backups-genre-removals" in str(mr.backup_path(OWNER)) and "audioplayer" not in str(mr.backup_path(OWNER))
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
    assert mr.marker_path(OWNER).is_file() and not mr.backup_path(OWNER).exists()


def test_switch_off(datadir, plan_file, monkeypatch):
    monkeypatch.setenv("AUDIO_GENRE_REMOVALS", "0")
    plan_file({"a": {"remove": ["pop"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "pop"])])
    before = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == before and not mr.marker_path(OWNER).exists()


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
    assert owner.read_bytes() == before and not mr.marker_path(OWNER).exists()
    assert "genre removals failed" in caplog.text


def test_missing_owner_library_is_fine(datadir, plan_file):
    plan_file({"a": {"remove": ["pop"]}})
    assert mr.run() == 0


def test_the_real_file_against_the_live_shape():
    plan, digest = mr.load_plan(mr.DATA_FILE)
    assert len(plan) == 56 and sum(len(v) for v in plan.values()) == 106 and len(digest) == 64
    doc = json.loads(mr.DATA_FILE.read_text(encoding="utf-8"))
    assert doc["scope"] == "owner" and doc["approved"] == "2026-10-19"
    assert all(row["title"] for row in doc["songs"].values())
    live = json.loads(FIXTURE.read_text(encoding="utf-8"))["songs"]
    assert {s["id"] for s in live} == set(plan)
    songs = library.normalize({"songs": copy.deepcopy(live)})["songs"]
    before = copy.deepcopy(songs)
    result = mr.apply_plan(songs, plan)
    assert not result["skipped"]
    assert sum(len(v) for v in result["removed"].values()) == 106
    for old, new in zip(before, songs):
        genres = [t for t in new["tags"] if t.startswith("genre:")]
        assert genres and not set(plan[new["id"]]) & {g.partition(":")[2] for g in genres}
        assert {k: v for k, v in new.items() if k != "tags"} == {k: v for k, v in old.items() if k != "tags"}
        assert [t for t in new["tags"] if not t.startswith("genre:")] == [t for t in old["tags"] if not t.startswith("genre:")]
