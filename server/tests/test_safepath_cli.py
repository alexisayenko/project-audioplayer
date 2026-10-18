import json
import os

import pytest

from app import jsonio, migrate_model2, migrate_model3, safepath


def lib(tmp_path, name="library.json"):
    d = tmp_path / "users" / "u1"
    d.mkdir(parents=True)
    p = d / name
    p.write_text(json.dumps({"settings": {"credits_schema": 3}, "songs": []}))
    return p


def test_input_file_accepts_a_temp_copy(tmp_path):
    p = lib(tmp_path)
    assert safepath.input_file(p) == p.resolve()
    assert safepath.input_file(tmp_path / "users" / "u1" / ".." / "u1" / "library.json") == p.resolve()


def test_input_file_accepts_a_missing_file_unless_required(tmp_path):
    missing = tmp_path / "library.json"
    assert safepath.input_file(missing) == missing.resolve()
    with pytest.raises(safepath.UnsafePath):
        safepath.input_file(missing, must_exist=True)


@pytest.mark.parametrize("raw", ["", "a\0b.json", "x.txt", "library", "..", "dir/.json", "sp ace.json"])
def test_input_file_rejects_bad_names(tmp_path, raw):
    with pytest.raises(safepath.UnsafePath):
        safepath.input_file(tmp_path / raw if raw and "\0" not in raw else raw)


def test_input_file_rejects_a_directory(tmp_path):
    (tmp_path / "d.json").mkdir()
    with pytest.raises(safepath.UnsafePath):
        safepath.input_file(tmp_path / "d.json")


def test_input_file_rejects_a_link_to_another_name(tmp_path):
    secret = tmp_path / "secret.json"
    secret.write_text("{}")
    link = tmp_path / "library.json"
    try:
        os.symlink(secret, link)
    except OSError:
        pytest.skip("no symlinks")
    with pytest.raises(safepath.UnsafePath):
        safepath.input_file(link)


def test_data_root_of(tmp_path):
    assert safepath.data_root_of(lib(tmp_path)) == tmp_path
    assert safepath.data_root_of(tmp_path / "x" / "library.json") == tmp_path / "x"


def test_output_file_stays_under_the_bases(tmp_path):
    base = (os.path.realpath(tmp_path),)
    ok = safepath.output_file(tmp_path / "report.json", base)
    assert ok == tmp_path.resolve() / "report.json"
    for bad in (tmp_path / ".." / "report.json", "/etc/passwd.json", tmp_path / "no" / "such" / "r.json", tmp_path / "r.txt", "a\0.json"):
        with pytest.raises(safepath.UnsafePath):
            safepath.output_file(bad, base)


def test_output_file_rejects_a_directory_and_an_escaping_link(tmp_path):
    base = (os.path.realpath(tmp_path / "in"),)
    (tmp_path / "in").mkdir()
    (tmp_path / "in" / "d.json").mkdir()
    with pytest.raises(safepath.UnsafePath):
        safepath.output_file(tmp_path / "in" / "d.json", base)
    try:
        os.symlink(tmp_path / "out.json", tmp_path / "in" / "r.json")
    except OSError:
        pytest.skip("no symlinks")
    with pytest.raises(safepath.UnsafePath):
        safepath.output_file(tmp_path / "in" / "r.json", base)


def test_output_dir(tmp_path):
    base = (os.path.realpath(tmp_path),)
    assert safepath.output_dir(tmp_path / "bk", base) == tmp_path.resolve() / "bk"
    for bad in (tmp_path / "a" / "b", tmp_path / ".." / ".." / "bk", "x\0"):
        with pytest.raises(safepath.UnsafePath):
            safepath.output_dir(bad, base)
    (tmp_path / "f").write_text("")
    with pytest.raises(safepath.UnsafePath):
        safepath.output_dir(tmp_path / "f", base)


@pytest.mark.parametrize("mod", [migrate_model2, migrate_model3])
def test_cli_dry_run_on_a_temp_copy_writes_the_report(tmp_path, capsys, mod):
    p = lib(tmp_path)
    assert mod.main(["--library", str(p), "--report", str(tmp_path / "report.json")]) in (0, 1)
    assert (tmp_path / "report.json").exists()


@pytest.mark.parametrize("mod", [migrate_model2, migrate_model3])
@pytest.mark.parametrize("flag", ["--report", "--backup-dir"])
def test_cli_refuses_a_target_outside_the_trusted_folders(tmp_path, capsys, mod, flag):
    p = lib(tmp_path)
    assert mod.main(["--library", str(p), flag, "/nonexistent-root/x/out.json"]) == 2
    assert "refused" in capsys.readouterr().err


def test_cli_refuses_bad_library_and_legacy(tmp_path, capsys):
    assert migrate_model3.main(["--library", str(tmp_path / "library.txt")]) == 2
    assert migrate_model3.main(["--library", str(lib(tmp_path)), "--legacy-backup", str(tmp_path / "no pe.json")]) == 2


def test_write_json_atomic_refuses_nul_and_directories(tmp_path):
    with pytest.raises(ValueError):
        jsonio.write_json_atomic(tmp_path / "a\0.json", {})
    with pytest.raises(IsADirectoryError):
        jsonio.write_json_atomic(tmp_path, {})
    with pytest.raises(IsADirectoryError):
        jsonio.write_bytes_atomic(tmp_path, b"")
