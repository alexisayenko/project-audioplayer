"""Path joining that cannot leave its base directory, and validation of file paths that come from a command line."""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path


def safe_join(base: Path, *parts: str) -> Path | None:
    """`base/parts` when it resolves inside `base` (symlinks and `..` included), else None."""
    path = base.joinpath(*parts)
    return path if path.resolve().is_relative_to(base.resolve()) else None


_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


class UnsafePath(ValueError):
    """The path was refused; nothing was read or written."""


def _text(raw: str | os.PathLike[str]) -> str:
    s = os.fspath(raw)
    if not s or "\0" in s:
        raise UnsafePath("empty path or NUL byte")
    return s


def _plain_name(name: str, suffix: str) -> None:
    if name in (".", "..") or not _NAME.fullmatch(name) or not name.endswith(suffix):
        raise UnsafePath(f"{name!r} is not a plain file name ending in {suffix}")


def input_file(raw: str | os.PathLike[str], suffix: str = ".json", must_exist: bool = False) -> Path:
    """Resolved path of a file to read: a plain `*<suffix>` name, a regular file when it exists, and a symlink may only point to a file of the same name."""
    s = _text(raw)
    real = os.path.realpath(s)
    _plain_name(os.path.basename(os.path.abspath(s)), suffix)
    if os.path.basename(real) != os.path.basename(os.path.abspath(s)):
        raise UnsafePath(f"{s!r} is a link to a differently named file")
    if os.path.exists(real):
        if not os.path.isfile(real):
            raise UnsafePath(f"{s!r} is not a regular file")
    elif must_exist:
        raise UnsafePath(f"{s!r} does not exist")
    return Path(real)


def data_root_of(library: Path) -> Path:
    """`<root>` of `<root>/users/<uid>/library.json`; the folder of the file when it lies elsewhere."""
    parents = library.parents
    return parents[2] if len(parents) > 2 and parents[1].name == "users" else parents[0]


def trusted_bases(library: Path) -> tuple[str, ...]:
    """Where a report or backup may go: the data root of the validated library, the working directory, the temp directory."""
    return tuple(os.path.realpath(b) for b in (data_root_of(library), Path.cwd(), tempfile.gettempdir()))


def _inside(real: str, bases: tuple[str, ...]) -> bool:
    return any(real == b or real.startswith(b.rstrip(os.sep) + os.sep) for b in bases)


def output_file(raw: str | os.PathLike[str], bases: tuple[str, ...], suffix: str = ".json") -> Path:
    """Resolved path of a file to write: a plain `*<suffix>` name in an existing folder under one of `bases`; an existing target must be a regular file."""
    s = _text(raw)
    real = os.path.realpath(s)
    _plain_name(os.path.basename(real), suffix)
    if not _inside(real, bases):
        raise UnsafePath(f"{s!r} is outside the data root, the working directory and the temp directory")
    if not os.path.isdir(os.path.dirname(real)):
        raise UnsafePath(f"the folder of {s!r} does not exist")
    if os.path.exists(real) and not os.path.isfile(real):
        raise UnsafePath(f"{s!r} is not a regular file")
    return Path(real)


def output_dir(raw: str | os.PathLike[str], bases: tuple[str, ...]) -> Path:
    """Resolved path of a folder to write into: under one of `bases`, its parent must exist; the folder itself is created on use."""
    s = _text(raw)
    real = os.path.realpath(s)
    if not _inside(real, bases):
        raise UnsafePath(f"{s!r} is outside the data root, the working directory and the temp directory")
    if not os.path.isdir(os.path.dirname(real)):
        raise UnsafePath(f"the parent folder of {s!r} does not exist")
    if os.path.exists(real) and not os.path.isdir(real):
        raise UnsafePath(f"{s!r} is not a folder")
    return Path(real)
