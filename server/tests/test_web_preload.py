import importlib
import json
import re
from pathlib import Path

from fastapi.testclient import TestClient

from app import main, web
from app.web import dynamic_imports, lazy_modules, module_closure, static_imports, web_version

REAL_WEB = Path(__file__).resolve().parents[2] / "web"
LAZY = [
    "settings", "genres", "genres-rework", "playlists", "stats", "theory", "viz-ui", "song-card", "add", "edit-dialog", "song-form", "drafts",
    "share-ui", "share-open", "player-tag-picker", "player-actions", "library-toolbar", "viz-modes", "viz-terrain-gl",
]
ORPHANS = {"js/display-title.js", "js/track-sub.js", "js/viz-deltae.js", "js/viz-timeline-worker.js"}


def _tree(root: Path, files: dict[str, str]) -> None:
    for rel, body in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(body)


def test_web_119_closure_follows_static_imports_only(tmp_path):
    _tree(tmp_path, {
        "js/app.js": "import { a } from './a.js';\nimport './side.js';\nconst lazy = () => import('./lazy.js');\n",
        "js/a.js": "import {\n  x,\n  y,\n} from './b.js';\nexport { z } from '../lib/c.js';\nexport * from './app.js';\n",
        "js/b.js": "export const x = 1, y = 2;\n",
        "js/side.js": "// import nothing from './ghost.js'\nexport {};\n",
        "js/lazy.js": "import './only-lazy.js';\n",
        "js/only-lazy.js": "export {};\n",
        "lib/c.js": "export const z = 3;\n",
    })
    assert module_closure(tmp_path) == ["js/app.js", "js/a.js", "js/side.js", "js/b.js", "lib/c.js"]
    assert static_imports(tmp_path, "js/a.js") == ["js/b.js", "lib/c.js", "js/app.js"]


def _independent_graph(root: Path) -> set[str]:
    spec = re.compile(r"""(?:\bfrom\s+|^\s*import\s+)['"](\.{1,2}/[^'"]+)['"]""", re.M)
    seen, todo = {"js/app.js"}, ["js/app.js"]
    while todo:
        rel = todo.pop()
        for s in spec.findall((root / rel).read_text(encoding="utf-8")):
            dep = str(((root / rel).parent / s).resolve().relative_to(root.resolve())).replace("\\", "/")
            if dep not in seen:
                seen.add(dep)
                todo.append(dep)
    return seen


def test_web_119_real_closure_exists_and_equals_the_static_graph():
    paths = module_closure(REAL_WEB)
    assert len(paths) == len(set(paths))
    assert all((REAL_WEB / p).is_file() for p in paths)
    assert set(paths) == _independent_graph(REAL_WEB)
    for rel in paths:
        for dep in static_imports(REAL_WEB, rel):
            assert (REAL_WEB / dep).is_file(), f"{rel} imports missing {dep}"


def test_web_119_lazy_routes_and_visualizer_stay_out_of_the_startup_closure():
    paths = set(module_closure(REAL_WEB))
    assert [n for n in LAZY if f"js/{n}.js" in paths] == []
    assert {"js/library.js", "js/player.js", "js/store.js"} <= paths


def test_web_119_index_carries_one_versioned_modulepreload_per_module(tmp_path, monkeypatch):
    web_root = tmp_path / "web"
    _tree(web_root, {
        "index.html": '<html><head><link rel="stylesheet" href="style.css"></head><body><script type="module" src="js/app.js"></script></body></html>',
        "style.css": "body{}",
        "js/app.js": "import './lib.js';\nimport('./lazy.js');",
        "js/lib.js": "export {};",
        "js/lazy.js": "export {};",
    })
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setenv("AUDIO_WEB_DIR", str(web_root))
    monkeypatch.setenv("PUBLIC_VIEW", "0")
    m = importlib.reload(main)
    try:
        page = TestClient(m.app).get("/").text
        version = web_version()
        hints = re.findall(r'<link rel="modulepreload" href="([^"]+)">', page)
        assert hints == [f"_v/{version}/js/app.js", f"_v/{version}/js/lib.js"]
        assert page.index("modulepreload") < page.index("</head>")
        assert web._preload_links(version).count("modulepreload") == 2
    finally:
        monkeypatch.delenv("AUDIO_WEB_DIR")
        importlib.reload(main)


def test_web_121_tier2_is_what_only_dynamic_imports_reach_in_prefetch_order(tmp_path):
    _tree(tmp_path, {
        "js/app.js": "import './a.js';\nconst x = () => import('./late.js');\nconst y = () => import(\n  './card.js'\n);\n",
        "js/a.js": "export {};\nimport('./a-lazy.js');\n",
        "js/late.js": "import './shared.js';\nimport('./deep.js');\n",
        "js/card.js": "import './shared.js';\nimport './a.js';\n",
        "js/shared.js": "export {};\n",
        "js/deep.js": "export {};\n",
        "js/a-lazy.js": "export {};\n",
        "js/unused.js": "export {};\n",
    })
    assert dynamic_imports(tmp_path, "js/app.js") == ["js/late.js", "js/card.js"]
    tier2 = lazy_modules(tmp_path)
    assert sorted(tier2) == ["js/a-lazy.js", "js/card.js", "js/deep.js", "js/late.js", "js/shared.js"]
    assert not set(tier2) & set(module_closure(tmp_path))
    assert len(tier2) == len(set(tier2))
    assert "js/unused.js" not in tier2


def _all_modules(root: Path) -> set[str]:
    return {f"js/{p.name}" for p in (root / "js").glob("*.js")}


def _reachable_any_edge(root: Path) -> set[str]:
    spec = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}/[^'"]+)['"]""")
    seen, todo = {"js/app.js"}, ["js/app.js"]
    while todo:
        rel = todo.pop()
        for s in spec.findall((root / rel).read_text(encoding="utf-8")):
            dep = str(((root / rel).parent / s).resolve().relative_to(root.resolve())).replace("\\", "/")
            if dep not in seen:
                seen.add(dep)
                todo.append(dep)
    return seen


def test_web_121_real_tier2_is_every_module_that_tier1_does_not_hold():
    tier1 = set(module_closure(REAL_WEB))
    tier2 = lazy_modules(REAL_WEB)
    assert len(tier2) == len(set(tier2))
    assert all((REAL_WEB / p).is_file() for p in tier2)
    assert not tier1 & set(tier2)
    assert set(tier2) == _reachable_any_edge(REAL_WEB) - tier1
    assert _all_modules(REAL_WEB) - tier1 - set(tier2) == ORPHANS, "a js module that nothing loads (add it to ORPHANS or delete it)"


def test_web_121_tier2_starts_with_the_song_card_then_add_edit_then_the_visualizer_then_the_routes():
    tier2 = lazy_modules(REAL_WEB)
    first = [tier2.index(f"js/{n}.js") for n in ("song-card", "edit-dialog", "add", "viz-ui", "genres-rework", "stats", "settings", "theory")]
    assert first == sorted(first)


def test_web_121_index_lists_the_tier2_modules_as_json_without_preloading_them(tmp_path, monkeypatch):
    web_root = tmp_path / "web"
    _tree(web_root, {
        "index.html": '<html><head></head><body><script type="module" src="js/app.js"></script></body></html>',
        "js/app.js": "import './lib.js';\nimport('./lazy.js');",
        "js/lib.js": "export {};",
        "js/lazy.js": "import './more.js';",
        "js/more.js": "export {};",
    })
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setenv("AUDIO_WEB_DIR", str(web_root))
    monkeypatch.setenv("PUBLIC_VIEW", "0")
    m = importlib.reload(main)
    try:
        page = TestClient(m.app).get("/").text
        version = web_version()
        assert re.findall(r'<link rel="modulepreload" href="([^"]+)">', page) == [f"_v/{version}/js/app.js", f"_v/{version}/js/lib.js"]
        listed = re.search(r'<script type="application/json" id="tier2-modules">(.*?)</script>', page).group(1)
        assert json.loads(listed) == [f"_v/{version}/js/lazy.js", f"_v/{version}/js/more.js"]
        assert page.index("tier2-modules") < page.index("</head>")
    finally:
        monkeypatch.delenv("AUDIO_WEB_DIR")
        importlib.reload(main)
