"""Custom covers: validate and re-encode an uploaded image, and fetch one from a URL without reaching private networks."""

from __future__ import annotations

import hashlib
import http.client
import io
import ipaddress
import os
import socket
import ssl
import urllib.parse
from dataclasses import dataclass

from PIL import Image, ImageOps

from . import httpjson
from .problems import Problem

MAX_BYTES = 5 * 1024 * 1024
MAX_SIDE = 1024
MAX_PIXELS = 40_000_000
MAX_REDIRECTS = 3
TIMEOUT = 10.0
ALLOWED_TYPES = ("image/jpeg", "image/png", "image/webp")
ALLOWED_PORTS = (80, 443)
USER_AGENT = "audioplayer/0.1 (cover fetch)"
WIKIMEDIA_USER_AGENT = "Electrophone/1.0 (https://electrophone.cc)"
NOT_ALLOWED = "That address is not allowed."

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def refuse(status: int, code: str, detail: str) -> Problem:
    return Problem(status, code, detail)


def too_large() -> Problem:
    return refuse(413, "cover_too_large", "The image is larger than 5 MB.")


def normalize(data: bytes) -> bytes:
    """Decode the image (JPEG, PNG or WebP only), apply its EXIF rotation, shrink to MAX_SIDE and re-encode as JPEG."""
    if len(data) > MAX_BYTES:
        raise too_large()
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in ("JPEG", "PNG", "WEBP"):
                raise refuse(415, "cover_bad_type", "Use a JPEG, PNG or WebP image.")
            probe.load()
            img = ImageOps.exif_transpose(probe)
            if img.mode in ("RGBA", "LA", "P"):
                rgba = img.convert("RGBA")
                flat = Image.new("RGB", rgba.size, (0, 0, 0))
                flat.paste(rgba, mask=rgba.getchannel("A"))
                img = flat
            else:
                img = img.convert("RGB")
    except Problem:
        raise
    except (OSError, ValueError, Image.DecompressionBombError, SyntaxError):
        raise refuse(422, "cover_bad_image", "This file is not a readable image.") from None
    img.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=88, optimize=True)
    return out.getvalue()


def version_of(jpeg: bytes) -> str:
    return hashlib.sha1(jpeg, usedforsecurity=False).hexdigest()[:10]


def _public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


def resolve_public(host: str, port: int) -> str:
    """The first address of `host`, only when every address it resolves to is public; else a refusal."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        raise refuse(502, "cover_url_unreachable", "Could not reach that address.") from None
    ips = [info[4][0] for info in infos]
    if not ips or not all(_public(ip) for ip in ips):
        raise refuse(422, "cover_url_refused", NOT_ALLOWED)
    return ips[0]


def _is_discogs(host: str) -> bool:
    return host == "discogs.com" or host.endswith(".discogs.com")


def auth_headers(host: str) -> dict[str, str]:
    """The Discogs token, only for discogs.com hosts (never for any other host a redirect leads to)."""
    token = os.environ.get("DISCOGS_TOKEN", "").strip()
    return {"Authorization": f"Discogs token={token}"} if token and _is_discogs(host) else {}


def user_agent_for(host: str) -> str:
    if _is_discogs(host):
        return httpjson.user_agent()
    return WIKIMEDIA_USER_AGENT if host == "wikimedia.org" or host.endswith(".wikimedia.org") else USER_AGENT


def _without_tracking(query: str) -> str:
    pairs = urllib.parse.parse_qsl(query, keep_blank_values=True)
    if not any(k.lower().startswith("utm_") for k, _ in pairs):
        return query
    return urllib.parse.urlencode([(k, v) for k, v in pairs if not k.lower().startswith("utm_")])


def parse_url(url: str) -> tuple[str, str, int, str]:
    """(scheme, host, port, path-with-query) of an http(s) URL on port 80 or 443 without credentials, else a refusal."""
    try:
        parts = urllib.parse.urlsplit(url.strip())
        host, port = parts.hostname, parts.port
    except ValueError:
        raise refuse(422, "cover_url_refused", "Enter a full http:// or https:// address.") from None
    if parts.scheme not in ("http", "https") or not host:
        raise refuse(422, "cover_url_refused", "Enter a full http:// or https:// address.")
    if parts.username or parts.password:
        raise refuse(422, "cover_url_refused", NOT_ALLOWED)
    port = port or (443 if parts.scheme == "https" else 80)
    if port not in ALLOWED_PORTS:
        raise refuse(422, "cover_url_refused", NOT_ALLOWED)
    path = parts.path or "/"
    query = _without_tracking(parts.query)
    return parts.scheme, host, port, f"{path}?{query}" if query else path


@dataclass
class Reply:
    status: int
    location: str
    content_type: str
    body: bytes


def http_get(scheme: str, host: str, port: int, path: str, ip: str) -> Reply:
    """One GET to the already-checked `ip` (no DNS again, so no rebinding); the body is read up to MAX_BYTES + 1."""
    sock = socket.create_connection((ip, port), timeout=TIMEOUT)  # NOSONAR host/IP validated and connection pinned to the checked IP (DNS-rebinding safe), see fetch()
    try:
        if scheme == "https":
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
        conn = http.client.HTTPConnection(host, port, timeout=TIMEOUT)  # NOSONAR host/IP validated and connection pinned to the checked IP (DNS-rebinding safe), see fetch()
        conn.sock = sock
        conn.request("GET", path, headers={"Host": host, "User-Agent": user_agent_for(host.lower()), "Accept": "image/*", "Connection": "close", **auth_headers(host.lower())})  # NOSONAR host/IP validated and connection pinned to the checked IP (DNS-rebinding safe), see fetch()
        resp = conn.getresponse()
        body = b"" if 300 <= resp.status < 400 else resp.read(MAX_BYTES + 1)
        return Reply(resp.status, resp.getheader("Location") or "", (resp.getheader("Content-Type") or "").split(";")[0].strip().lower(), body)
    finally:
        sock.close()


def _target_ip(host: str, port: int) -> str:
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return resolve_public(host, port)
    if not _public(str(ip)):
        raise refuse(422, "cover_url_refused", NOT_ALLOWED)
    return str(ip)


def _accept(reply: Reply) -> bytes:
    if reply.status != 200:
        raise refuse(502, "cover_url_unreachable", f"That address answered {reply.status}.")
    if reply.content_type not in ALLOWED_TYPES:
        raise refuse(415, "cover_bad_type", "That address is not a JPEG, PNG or WebP image.")
    if len(reply.body) > MAX_BYTES:
        raise too_large()
    return reply.body


def fetch(url: str) -> bytes:
    """Download an image from a public http(s) URL: every hop is resolved and checked, redirects are followed up to MAX_REDIRECTS."""
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        scheme, host, port, path = parse_url(current)
        target = _target_ip(host, port)
        try:
            reply = http_get(scheme, host, port, path, target)
        except (OSError, http.client.HTTPException):
            raise refuse(502, "cover_url_unreachable", "Could not reach that address.") from None
        if 300 <= reply.status < 400 and reply.location:
            current = urllib.parse.urljoin(current, reply.location)
            continue
        return _accept(reply)
    raise refuse(422, "cover_url_refused", "That address redirects too many times.")
