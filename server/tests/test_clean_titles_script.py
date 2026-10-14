import importlib.util
import json
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "clean-titles.py"


def load_script():
    spec = importlib.util.spec_from_file_location("clean_titles", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_apply_writes_backup_outside_library_dir(tmp_path, monkeypatch):
    mod = load_script()
    lib_dir = tmp_path / "data" / "users" / "u1"
    lib_dir.mkdir(parents=True)
    lib = lib_dir / "library.json"
    lib.write_text(json.dumps([{"id": "1", "title": "Song [Free Download]", "artist": "A"}]))
    backups = tmp_path / "bk"
    monkeypatch.setattr(sys, "argv", ["clean-titles", "--library", str(lib), "--apply", "--backup-dir", str(backups)])
    assert mod.main() == 0
    assert [p.name for p in lib_dir.iterdir()] == ["library.json"]
    saved = list(backups.glob("*.bak-*"))
    assert len(saved) == 1
    assert "Free Download" in saved[0].read_text()


def test_default_backup_dir_is_not_next_to_library(tmp_path, monkeypatch):
    mod = load_script()
    monkeypatch.setattr(mod.tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(mod.os, "access", lambda *a: False)
    d = mod.default_backup_dir("20260101-000000")
    assert d.parent == tmp_path or str(d).startswith("/var/backups")
