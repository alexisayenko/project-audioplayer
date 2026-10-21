"""Covers from a Discogs page address: the page's master or release is looked up through the Discogs API and its image is downloaded like any other cover URL."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
from typing import Any

from . import coverimg, discogs_lookup
from .problems import Problem

HOSTS = ("discogs.com", "www.discogs.com")
NO_COVER = "Discogs has no cover for this page."
_PATH = re.compile(r"/(?:[a-z]{2}(?:-[A-Z]{2})?/)?(master|release)/(\d+)(?:-[^/]*)?/?")


def is_discogs_host(host: str | None) -> bool:
    host = (host or "").lower().rstrip(".")
    return host == "discogs.com" or host.endswith(".discogs.com")


def parse_page(url: str) -> tuple[str, int] | None:
    """('master' | 'release', id) of a Discogs page address on discogs.com or www.discogs.com, else None."""
    try:
        parts = urllib.parse.urlsplit(str(url).strip())
        host, port = parts.hostname, parts.port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or (host or "").lower() not in HOSTS or parts.username or parts.password or port not in (None, 80, 443):
        return None
    match = _PATH.fullmatch(parts.path)
    return (match.group(1), int(match.group(2))) if match else None


def page_url(kind: str, ident: int) -> str:
    return f"https://www.discogs.com/{kind}/{int(ident)}"


def _pick(images: Any, key: str) -> str:
    if not isinstance(images, list):
        return ""
    items = [i for i in images if isinstance(i, dict)]
    items.sort(key=lambda i: i.get("type") != "primary")
    for item in items:
        for field in (key, "resource_url"):
            value = item.get(field)
            if isinstance(value, str) and value.startswith("https://") and is_discogs_host(urllib.parse.urlsplit(value).hostname):
                return value
    return ""


def _api(path: str) -> dict[str, Any] | None:
    try:
        doc = discogs_lookup._get(path)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise Problem(502, "cover_url_unreachable", "Could not reach Discogs.") from None
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError):
        raise Problem(502, "cover_url_unreachable", "Could not reach Discogs.") from None
    return doc if isinstance(doc, dict) else None


def cover_image(kind: str, ident: int, key: str = "uri") -> str:
    """The cover image address of a master (falling back to its main release) or a release; '' when Discogs has none."""
    doc = _api(f"{kind}s/{ident}")
    if doc is None:
        return ""
    found = _pick(doc.get("images"), key)
    main = doc.get("main_release")
    if not found and kind == "master" and isinstance(main, int) and not isinstance(main, bool):
        found = cover_image("release", main, key)
    return found


def require_token() -> None:
    if not discogs_lookup._token():
        raise Problem(422, "discogs_not_configured", "Covers from Discogs are not set up on this server (no Discogs token).")


def resolve(url: str) -> str:
    """The image address behind a Discogs page address; a refusal when there is no token or no cover."""
    page = parse_page(url)
    if page is None:
        raise Problem(422, "cover_url_refused", coverimg.NOT_ALLOWED)
    require_token()
    image = cover_image(*page)
    if not image:
        raise Problem(422, "cover_url_unreachable", NO_COVER)
    return image


def fetch(address: str) -> bytes:
    """Image bytes from any cover address: a Discogs page is resolved through the API first, everything else is downloaded directly."""
    if parse_page(address) is None:
        return coverimg.fetch(address)
    return coverimg.fetch(resolve(address))


def suggestion(discogs_url: Any) -> dict[str, Any] | None:
    """One suggestion for a song's stored Discogs link; None without a token or a valid link. `url` is the page address, which PUT /songs/{id}/cover accepts."""
    page = parse_page(discogs_url) if isinstance(discogs_url, str) else None
    if page is None or not discogs_lookup._token():
        return None
    try:
        thumb = cover_image(*page, key="uri150") or None
    except Problem:
        thumb = None
    return {"url": page_url(*page), "thumb": thumb, "title": "Discogs", "source": "discogs",
            "page": page_url(*page), "width": None, "height": None}
