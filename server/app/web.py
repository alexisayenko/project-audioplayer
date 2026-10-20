"""The web UI: index.html with versioned asset URLs and module preload hints, immutable versioned files and a revalidating static mount."""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from .safepath import safe_join

_ASSET_REF = re.compile(r'(href|src)="(tokens\.css|style\.css|favicon\.svg|js/app\.js)"')
_ENTRY = "js/app.js"
_STATIC_IMPORT = re.compile(r"""(?:^|[\n;])\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"](\.{1,2}/[^'"]+)['"]""")
_BARE_IMPORT = re.compile(r"""(?:^|[\n;])\s*import\s*['"](\.{1,2}/[^'"]+)['"]""")
_DYNAMIC_IMPORT = re.compile(r"""\bimport\(\s*['"](\.{1,2}/[^'"]+)['"]\s*\)""")
_TIER2_FIRST = (
    "js/song-card.js", "js/library-toolbar.js", "js/add.js", "js/edit-dialog.js", "js/share-ui.js", "js/drafts.js",
    "js/player-tag-picker.js", "js/player-actions.js", "js/share-open.js", "js/share.js", "js/viz-ui.js",
    "js/genres-rework.js", "js/stats.js", "js/settings.js", "js/theory.js", "js/playlists.js", "js/genres.js",
)
_IMMUTABLE = "public, max-age=31536000, immutable"
_VERSION_LEN = 10
_preload_cache: dict[tuple[str, str], str] = {}


def web_dir() -> Path:
    return Path(os.environ.get("AUDIO_WEB_DIR", Path(__file__).resolve().parents[2] / "web"))


class NoCacheStaticFiles(StaticFiles):
    """Revalidate on every load so UI edits show up without a hard refresh."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


def web_version() -> str:
    """Short fingerprint of the web files; it changes whenever any of them is deployed."""
    root = web_dir()
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file():
            info = path.stat()
            digest.update(f"{path.relative_to(root)}:{info.st_mtime_ns}:{info.st_size}".encode())
    return digest.hexdigest()[:_VERSION_LEN]


def static_imports(root: Path, rel: str) -> list[str]:
    """Web-root paths of the modules that module `rel` imports with static import or export-from; dynamic import() is not followed."""
    source = (root / rel).read_text(encoding="utf-8")
    found = [m.group(1) for m in _STATIC_IMPORT.finditer(source)] + [m.group(1) for m in _BARE_IMPORT.finditer(source)]
    base = Path(rel).parent
    return [os.path.normpath(base / spec).replace(os.sep, "/") for spec in found]


def module_closure(root: Path, entry: str = _ENTRY) -> list[str]:
    """The entry module and everything it reaches through static imports, breadth first; a lazily imported route is not in it."""
    order = [entry]
    seen = {entry}
    for rel in order:
        for dep in static_imports(root, rel):
            if dep not in seen and (root / dep).is_file():
                seen.add(dep)
                order.append(dep)
    return order


def dynamic_imports(root: Path, rel: str) -> list[str]:
    """Web-root paths of the modules that module `rel` loads with a literal dynamic import()."""
    source = (root / rel).read_text(encoding="utf-8")
    base = Path(rel).parent
    return [os.path.normpath(base / m.group(1)).replace(os.sep, "/") for m in _DYNAMIC_IMPORT.finditer(source)]


def lazy_modules(root: Path, entry: str = _ENTRY) -> list[str]:
    """Tier 2: every module reachable from the startup closure only through dynamic import(), in prefetch order.

    The order starts with the modules of _TIER2_FIRST (each followed by what only it needs), then the rest in discovery order.
    """
    tier1 = module_closure(root, entry)
    seen = set(tier1)
    roots = [d for rel in tier1 for d in dynamic_imports(root, rel)]
    roots = [r for r in _TIER2_FIRST if r in roots] + [r for r in roots if r not in _TIER2_FIRST]
    out: list[str] = []
    for start in roots:
        if start in seen or not (root / start).is_file():
            continue
        group = [start]
        seen.add(start)
        for rel in group:
            for dep in static_imports(root, rel) + dynamic_imports(root, rel):
                if dep not in seen and (root / dep).is_file():
                    seen.add(dep)
                    group.append(dep)
        out.extend(group)
    return out


def tier_paths(root: Path) -> tuple[list[str], list[str]]:
    """(tier 1, tier 2): the startup closure that the page preloads, and the lazy modules the browser warms up in the background."""
    return module_closure(root), lazy_modules(root)


def _preload_links(version: str) -> str:
    root = web_dir()
    key = (str(root), version)
    if key not in _preload_cache:
        if len(_preload_cache) > 8:
            _preload_cache.clear()
        try:
            tier1, tier2 = tier_paths(root)
        except OSError:
            tier1, tier2 = [], []
        links = "".join(f'<link rel="modulepreload" href="_v/{version}/{p}">\n' for p in tier1)
        if tier2:
            listing = json.dumps([f"_v/{version}/{p}" for p in tier2])
            links += f'<script type="application/json" id="tier2-modules">{listing}</script>\n'
        _preload_cache[key] = links
    return _preload_cache[key]


def _index_response(request: Request) -> Response:
    """index.html with every asset under /_v/<version>/, so a deploy is a new URL.

    Browsers and CDNs may keep the versioned files for a year; the page that names
    them is always revalidated (ETag), so users pick up a deploy on the next load.
    """
    version = web_version()
    etag = f'"{version}"'
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    page = (web_dir() / "index.html").read_text(encoding="utf-8")
    page = _ASSET_REF.sub(lambda m: f'{m.group(1)}="_v/{version}/{m.group(2)}"', page)
    if "</head>" in page:
        page = page.replace("</head>", _preload_links(version) + "</head>", 1)
    return HTMLResponse(page, headers=headers)


def _versioned_file(version: str, path: str) -> FileResponse:
    target = safe_join(web_dir(), path)
    if target is None or not target.is_file():
        raise HTTPException(status_code=404, detail="not found")
    cache = _IMMUTABLE if version == web_version() else "no-cache"
    return FileResponse(target, headers={"Cache-Control": cache})


def mount(app: FastAPI) -> None:
    """Add the UI routes; call after every API router so the API always wins."""
    root = web_dir()
    if not root.is_dir():
        return
    if (root / "index.html").is_file():
        app.add_api_route("/", _index_response, methods=["GET"], include_in_schema=False)
        app.add_api_route("/index.html", _index_response, methods=["GET"], include_in_schema=False)
    app.add_api_route("/_v/{version}/{path:path}", _versioned_file, methods=["GET"], include_in_schema=False)
    app.mount("/", NoCacheStaticFiles(directory=root, html=True), name="web")
