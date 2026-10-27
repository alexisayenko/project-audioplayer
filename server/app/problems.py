"""A refusal with a machine-readable code: JSON {"error": code, "detail": message} plus optional extra fields."""
from __future__ import annotations

import re
from typing import Any


class Problem(Exception):
    def __init__(self, status: int, code: str, detail: str, headers: dict[str, str] | None = None, **extra: Any) -> None:
        super().__init__(detail)
        self.status, self.code, self.detail = status, code, detail
        self.headers = headers or {}
        self.extra = extra

    def body(self) -> dict[str, Any]:
        return {"error": self.code, "detail": self.detail, **self.extra}


UNCODED_STATUSES = frozenset({401, 403, 404, 429})
_CODE = re.compile(r"[a-z][a-z0-9_]*")
_BY_STATUS = {400: "bad_request", 405: "method_not_allowed", 409: "conflict", 422: "unprocessable", 502: "bad_gateway", 503: "service_unavailable"}


def error_code(status: int, detail: Any) -> str | None:
    """The `error` key added to a plain `{detail}` refusal: the code the detail already is (`album_limit`, `{"code": ...}`), else one per status.
    None for 401, 403, 404 and 429: shipped iOS builds read `{error, detail}` as a coded refusal and then skip their branches on those statuses."""
    if status in UNCODED_STATUSES:
        return None
    if isinstance(detail, dict) and isinstance(detail.get("code"), str):
        return detail["code"]
    if isinstance(detail, str) and _CODE.fullmatch(detail):
        return detail
    return _BY_STATUS.get(status, "error")
