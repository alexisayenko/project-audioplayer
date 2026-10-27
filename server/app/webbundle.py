"""The optional pre-built web bundle (ADR-0047): web/dist/ is made by scripts/build-web.mjs and used only while it matches the sources."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from pathlib import Path

log = logging.getLogger("audioplayer.web")

_SHEET = re.compile(r'<link rel="stylesheet" href="([^"]+)">[ \t]*\n?')
_HEAD_END = "</head>"
_SCRIPT = 'src="js/app.js"'
_ICONS_IMPORT = "from './js/icons.js'"
_cache: dict[tuple[str, str], dict | None] = {}


def enabled() -> bool:
    return os.environ.get("AUDIO_WEB_BUNDLE", "1").strip().lower() not in ("0", "false", "no", "off")


def source_digest(root: Path, modules: list[str], sheets: list[str]) -> str:
    """SHA-256 over the web/js modules the app bundle was built from (sorted by path, listed in the manifest) and the stylesheets in link order; the same value scripts/build-web.mjs writes."""
    digest = hashlib.sha256()
    for rel in [*sorted(modules), *sheets]:
        digest.update(f"{rel}\0".encode())
        digest.update((root / rel).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _load(root: Path) -> dict | None:
    try:
        manifest = json.loads((root / "dist" / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    try:
        if manifest["sources"] != source_digest(root, manifest["modules"], manifest["stylesheets"]):
            log.warning("web bundle is stale (web/js or a stylesheet changed since web/dist was built); serving the unbundled files")
            return None
        needed = [manifest["css"], manifest["entry"], manifest["icons"], *manifest["tier1"], *manifest["tier2"]]
    except (KeyError, TypeError, OSError):
        return None
    if not all((root / rel).is_file() for rel in needed):
        log.warning("web bundle is incomplete; serving the unbundled files")
        return None
    return manifest


def manifest_for(root: Path, version: str) -> dict | None:
    """The manifest of web/dist when the bundle is on, built from the current sources and complete; else None (the page then uses the unbundled files)."""
    if not enabled():
        return None
    key = (str(root), version)
    if key not in _cache:
        if len(_cache) > 8:
            _cache.clear()
        _cache[key] = _load(root)
    return _cache[key]


def rewrite_page(page: str, version: str, manifest: dict) -> str | None:
    """index.html with one stylesheet, the bundle entry, the bundled icons module and preload hints for the startup files; None when the page does not have the expected shape."""
    sheets = [m.group(1) for m in _SHEET.finditer(page)]
    if sheets != manifest["stylesheets"] or page.count(_SCRIPT) != 1 or page.count(_ICONS_IMPORT) != 1 or _HEAD_END not in page:
        return None
    base = f"_v/{version}/"
    seen: list[str] = []

    def one_sheet(_match: re.Match) -> str:
        seen.append("")
        return f'<link rel="stylesheet" href="{base}{manifest["css"]}">\n' if len(seen) == 1 else ""

    page = _SHEET.sub(one_sheet, page)
    page = page.replace(_SCRIPT, f'src="{base}{manifest["entry"]}"').replace(_ICONS_IMPORT, f"from './{base}{manifest['icons']}'")
    links = "".join(f'<link rel="modulepreload" href="{base}{p}">\n' for p in manifest["tier1"])
    if manifest["tier2"]:
        links += f'<script type="application/json" id="tier2-modules">{json.dumps([base + p for p in manifest["tier2"]])}</script>\n'
    return page.replace(_HEAD_END, links + _HEAD_END, 1)
