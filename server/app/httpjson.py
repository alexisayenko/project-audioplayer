"""One JSON-over-HTTP helper for the lookups: identifying User-Agent, Accept header and a mandatory timeout."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_UA = "audioplayer/0.1 (alex.isayenko@gmail.com)"


def user_agent() -> str:
    return os.environ.get("AUDIO_MB_USER_AGENT", DEFAULT_UA)


def build_request(url: str, params: dict[str, str] | None = None, form: dict[str, str] | None = None,
                  headers: dict[str, str] | None = None) -> urllib.request.Request:
    """GET `url?params`, or a POST of `form` when given."""
    if params is not None:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    data = urllib.parse.urlencode(form).encode("ascii") if form is not None else None
    merged = {"User-Agent": user_agent(), "Accept": "application/json", **(headers or {})}
    return urllib.request.Request(url, data=data, headers=merged)


def fetch(req: urllib.request.Request, timeout: float) -> Any:
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_json(url: str, timeout: float, params: dict[str, str] | None = None, form: dict[str, str] | None = None,
              headers: dict[str, str] | None = None) -> Any:
    return fetch(build_request(url, params, form, headers), timeout)
