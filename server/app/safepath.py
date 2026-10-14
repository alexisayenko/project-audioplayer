"""Path joining that cannot leave its base directory."""

from __future__ import annotations

from pathlib import Path


def safe_join(base: Path, *parts: str) -> Path | None:
    """`base/parts` when it resolves inside `base` (symlinks and `..` included), else None."""
    path = base.joinpath(*parts)
    return path if path.resolve().is_relative_to(base.resolve()) else None
