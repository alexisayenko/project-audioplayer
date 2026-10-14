"""Hostname config: PUBLIC_HOSTS, CANONICAL_HOST and OAUTH_REDIRECT_URIS (all optional, read per call)."""

from __future__ import annotations

import os
import re
from urllib.parse import quote

from fastapi import Request, Response
from starlette.responses import RedirectResponse

from . import guest

_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
_PORT = r":\d{1,5}"
_HOST_RE = re.compile(rf"^(?=.{{1,253}}(?:{_PORT})?$){_LABEL}(?:\.{_LABEL})*(?:{_PORT})?$")
EXEMPT_PATHS = ("/health", "/robots.txt", "/legal")


def valid_host(value: str) -> str:
    """The lowercased host[:port] when it is a plain hostname, else ''."""
    host = value.strip().lower()
    return host if _HOST_RE.match(host) else ""


def public_hosts() -> list[str]:
    parts = (valid_host(p) for p in os.environ.get("PUBLIC_HOSTS", "").split(","))
    return [p for p in parts if p]


def canonical_host() -> str:
    return valid_host(os.environ.get("CANONICAL_HOST", ""))


def request_host(request: Request) -> str:
    """The Host header; X-Forwarded-Host only when the peer is loopback/LAN (the cloudflared host)."""
    peer = request.client.host if request.client else ""
    forwarded = request.headers.get("x-forwarded-host", "").split(",")[0] if guest.trusted_peer(peer) else ""
    return valid_host(forwarded or request.headers.get("host", ""))


def public_origin(request: Request) -> str:
    """https origin for absolute URLs: the request host when allowed, else the canonical or first public host."""
    host = request_host(request)
    allowed = public_hosts()
    if allowed and host not in allowed:
        host = canonical_host() or allowed[0]
    return f"https://{host or canonical_host() or request.url.netloc}"


def oauth_redirect(request: Request) -> str:
    """Apple web redirect URI: OAUTH_REDIRECT_URIS entry for this host, the first entry, APPLE_WEB_REDIRECT_URI, or the origin."""
    uris = [u.strip() for u in os.environ.get("OAUTH_REDIRECT_URIS", "").split(",") if u.strip().startswith("https://")]
    if uris:
        host = request_host(request)
        return next((u for u in uris if u.split("/")[2].lower() == host), uris[0])
    return os.environ.get("APPLE_WEB_REDIRECT_URI", "") or public_origin(request) + "/"


def canonical_redirect(request: Request) -> Response | None:
    target = canonical_host()
    if not target or request.method not in ("GET", "HEAD") or request.url.path in EXEMPT_PATHS:
        return None
    if request_host(request) == target:
        return None
    query = f"?{request.url.query}" if request.url.query else ""
    response = RedirectResponse(f"https://{target}{quote(request.url.path, safe='/%:@!$&()*+,;=~-._')}{query}", status_code=308)
    response.headers["Cache-Control"] = "no-store"
    return response
