"""A refusal with a machine-readable code: JSON {"error": code, "detail": message} plus optional extra fields."""
from __future__ import annotations

from typing import Any


class Problem(Exception):
    def __init__(self, status: int, code: str, detail: str, headers: dict[str, str] | None = None, **extra: Any) -> None:
        super().__init__(detail)
        self.status, self.code, self.detail = status, code, detail
        self.headers = headers or {}
        self.extra = extra

    def body(self) -> dict[str, Any]:
        return {"error": self.code, "detail": self.detail, **self.extra}
