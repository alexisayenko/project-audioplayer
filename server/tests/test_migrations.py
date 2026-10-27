import logging

import pytest

from app import deps, migration, migrations


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(deps, "SYNC", None)
    return tmp_path


def _library(root, uid):
    path = root / "users" / uid / "library.json"
    path.parent.mkdir(parents=True)
    path.write_text("{}", encoding="utf-8")
    return path


def test_registry_order_and_labels(monkeypatch):
    seen = []
    for label, module in migrations.REGISTRY:
        monkeypatch.setattr(module, "run", lambda label=label: seen.append(label))
    for _label, run in migrations.startup_steps():
        run()
    assert seen == [
        "migrate model 2", "migrate model 3", "migrate tags", "migrate removals", "migrate renames",
        "migrate retired", "migrate version norm", "migrate sources", "migrate reference tags", "migrate genre eras seed",
    ]


def test_registry_modules_each_have_run():
    assert all(callable(module.run) for _label, module in migrations.REGISTRY)


def test_enabled_only_off_for_zero(monkeypatch):
    monkeypatch.delenv("AUDIO_X", raising=False)
    assert migration.enabled("AUDIO_X")
    monkeypatch.setenv("AUDIO_X", " 0 ")
    assert not migration.enabled("AUDIO_X")
    monkeypatch.setenv("AUDIO_X", "1")
    assert migration.enabled("AUDIO_X")


def test_base_dir_follows_the_git_data_repo(root, monkeypatch, tmp_path_factory):
    assert migration.base_dir() == root
    repo = tmp_path_factory.mktemp("repo")
    monkeypatch.setattr(deps, "SYNC", type("Sync", (), {"data_repo": repo})())
    assert migration.user_backup("backups-x", "u1") == repo / "backups-x" / "u1" / "library.json"


def test_backup_once_keeps_the_first_copy(tmp_path):
    source = tmp_path / "a.json"
    target = tmp_path / "b" / "c.json"
    source.write_text("one", encoding="utf-8")
    migration.backup_once(source, target)
    source.write_text("two", encoding="utf-8")
    migration.backup_once(source, target)
    assert target.read_text(encoding="utf-8") == "one"


def test_marker_roundtrip_and_tolerance(tmp_path):
    path = tmp_path / "m" / "applied.json"
    assert migration.read_marker(path) == {}
    migration.write_marker(path, {"marker": 1})
    assert migration.marker_has(path, "marker", 1)
    assert not migration.marker_has(path, "marker", 2)
    path.write_text("[1]", encoding="utf-8")
    assert migration.read_marker(path) == {}
    path.write_text("{bad", encoding="utf-8")
    assert migration.read_marker(path) == {}
    assert migration.marker_beside(path) == path


def test_libraries_sorted_and_empty_without_users(root):
    assert migration.libraries() == []
    _library(root, "b")
    _library(root, "a")
    assert [p.parent.name for p in migration.libraries()] == ["a", "b"]


def test_run_for_libraries_skips_done_and_survives_failures(root, caplog):
    for uid in ("a", "b", "c"):
        _library(root, uid)

    def apply(uid, _lib):
        if uid == "b":
            raise RuntimeError("boom")
        return 2

    with caplog.at_level(logging.INFO, logger="app.migration"):
        assert migration.run_for_libraries(lambda uid: uid == "a", apply, "done %s %d", "failed %s") == 2
    messages = [r.getMessage() for r in caplog.records]
    assert "done c 2" in messages
    assert "failed b" in messages
    assert not any("done a" in m for m in messages)
