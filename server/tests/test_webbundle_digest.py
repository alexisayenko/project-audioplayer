from app import webbundle


def _tree(root):
    (root / "js").mkdir()
    (root / "js" / "app.js").write_text("import './a.js';")
    (root / "js" / "a.js").write_text("export const a = 1;")
    (root / "js" / "studio-only.js").write_text("export const s = 1;")
    (root / "style.css").write_text("body{}")


def test_digest_covers_the_listed_modules_and_sheets_only(tmp_path):
    _tree(tmp_path)
    listed = ["js/app.js", "js/a.js"]
    before = webbundle.source_digest(tmp_path, listed, ["style.css"])
    (tmp_path / "js" / "studio-only.js").write_text("export const s = 2;")
    assert webbundle.source_digest(tmp_path, listed, ["style.css"]) == before
    (tmp_path / "js" / "a.js").write_text("export const a = 2;")
    assert webbundle.source_digest(tmp_path, listed, ["style.css"]) != before


def test_digest_does_not_depend_on_the_order_of_the_module_list(tmp_path):
    _tree(tmp_path)
    assert webbundle.source_digest(tmp_path, ["js/a.js", "js/app.js"], []) == webbundle.source_digest(tmp_path, ["js/app.js", "js/a.js"], [])


def test_a_manifest_without_a_module_list_is_stale(tmp_path):
    _tree(tmp_path)
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "manifest.json").write_text('{"sources": "x", "stylesheets": ["style.css"]}')
    assert webbundle._load(tmp_path) is None
