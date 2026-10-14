"""The web UI: index.html with versioned asset URLs, immutable versioned files and a revalidating static mount."""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from .safepath import safe_join

_ASSET_REF = re.compile(r'(href|src)="(tokens\.css|style\.css|favicon\.svg|js/app\.js)"')
_IMMUTABLE = "public, max-age=31536000, immutable"
_VERSION_LEN = 10


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
