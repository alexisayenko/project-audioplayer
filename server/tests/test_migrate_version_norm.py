import json

import pytest

from app import library, migrate_version_norm as mv

OWNER = "owneruid"


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(mv.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(mv.deps, "SYNC", None)
    return tmp_path


def song(sid, name, **extra):
    version = {"type": "remaster", "name": name, "artists": [], "releaseYear": None} if name is not None else None
    row = {"id": sid, "title": "Smoke On The Water", "mainArtists": ["Deep Purple"], "featuredArtists": [], "updated_at": "2026-02-02T00:00:00Z", **extra}
    if version:
        row["version"] = version
    return row


def lib(root, uid, songs):
    path = root / "users" / uid / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"settings": {}, "songs": songs}), encoding="utf-8")
    return path


def stored(path):
    return {s["id"]: s for s in json.loads(path.read_text(encoding="utf-8"))["songs"]}


def test_spellings_end_up_identical_and_the_rest_is_untouched(datadir):
    path = lib(datadir, OWNER, [song("a", "2024 Remastered"), song("b", "2024 remaster"), song("c", "(Remastered 2011)"), song("d", "Remastered"), song("e", "Live in Tokyo"), song("f", None)])
    assert mv.run() == 3
    rows = stored(path)
    assert rows["a"]["version"]["name"] == rows["b"]["version"]["name"] == "2024 remaster"
    assert rows["c"]["version"]["name"] == "2011 remaster"
    assert rows["d"]["version"]["name"] == "remaster"
    assert rows["e"]["version"]["name"] == "Live in Tokyo"
    assert "version" not in rows["f"]
    assert rows["a"]["title"] == "Smoke On The Water"
    assert rows["a"]["updated_at"] == "2026-02-02T00:00:00Z"
    assert rows["a"]["version"]["type"] == "remaster"


def test_every_user_and_second_run_changes_nothing(datadir):
    a = lib(datadir, OWNER, [song("a", "2024 Remastered")])
    b = lib(datadir, "other", [song("b", "Remastered 2009")])
    assert mv.run() == 2
    snap = (a.read_bytes(), b.read_bytes())
    assert mv.run() == 0
    assert (a.read_bytes(), b.read_bytes()) == snap
    assert stored(b)["b"]["version"]["name"] == "2009 remaster"


def test_apply_norm_is_idempotent():
    songs = [song("a", "(2024 Remastered)")]
    assert mv.apply_norm(songs) == ["a"]
    assert mv.apply_norm(songs) == []


def test_backup_written_once_and_marker_respected(datadir):
    path = lib(datadir, OWNER, [song("a", "2024 Remastered")])
    before = path.read_bytes()
    mv.run()
    root = datadir / "backups-version-norm" / OWNER
    assert (root / "library.json").read_bytes() == before
    assert json.loads((root / "applied.json").read_text())["songs"] == 1
    doc = library.load_doc(path)
    doc["songs"].append(song("z", "Remastered 1999"))
    library.save_doc(path, doc)
    snap = path.read_bytes()
    assert mv.run() == 0
    assert path.read_bytes() == snap
    assert (root / "library.json").read_bytes() == before


def test_user_without_changes_gets_a_marker_but_no_backup(datadir):
    path = lib(datadir, "clean", [song("a", "Live in Tokyo")])
    before = path.read_bytes()
    assert mv.run() == 0
    assert path.read_bytes() == before
    assert not (datadir / "backups-version-norm" / "clean" / "library.json").exists()
    assert (datadir / "backups-version-norm" / "clean" / "applied.json").is_file()


def test_switch_off(datadir, monkeypatch, caplog):
    path = lib(datadir, OWNER, [song("a", "2024 Remastered")])
    before = path.read_bytes()
    monkeypatch.setenv("AUDIO_VERSION_NORM", "0")
    with caplog.at_level("INFO", logger="app.migrate_version_norm"):
        assert mv.run() == 0
    assert path.read_bytes() == before
    assert not (datadir / "backups-version-norm").exists()
    assert "AUDIO_VERSION_NORM=0" in caplog.text


def test_malformed_library_is_skipped_and_others_continue(datadir, caplog):
    bad = datadir / "users" / "bad" / "library.json"
    bad.parent.mkdir(parents=True)
    bad.write_text("{oops", encoding="utf-8")
    good = lib(datadir, OWNER, [song("a", "2024 Remastered")])
    assert mv.run() == 1
    assert stored(good)["a"]["version"]["name"] == "2024 remaster"
    assert "version name normalisation failed" in caplog.text
