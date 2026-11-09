"""Faststart for stored m4a files: the `moov` atom (the index a player needs before it can play) sits in front of `mdat` (the audio). Safari cannot start a file whose `moov` is at the end until it has read the whole file; Chromium asks for the tail with a second range request and hides it. `ensure` moves `moov` forward without re-encoding, atomically, and leaves a file that is already fine, fragmented or not understood untouched."""

from __future__ import annotations

import logging
import os
import struct
import tempfile
from pathlib import Path
from typing import BinaryIO, Iterator

log = logging.getLogger("faststart")

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl"}
MAX_MOOV = 64 * 1024 * 1024
CHUNK = 1024 * 1024
U32 = 0xFFFFFFFF

OK = "ok"
FIXED = "fixed"
SKIPPED = "skipped"


class Unsupported(Exception):
    pass


def _header(f: BinaryIO, pos: int, end: int) -> tuple[bytes, int, int] | None:
    """(type, size, header length) of the atom at `pos`, or None at a damaged or truncated atom."""
    f.seek(pos)
    head = f.read(8)
    if len(head) < 8:
        return None
    size, kind = struct.unpack(">I4s", head)
    hlen = 8
    if size == 1:
        ext = f.read(8)
        if len(ext) < 8:
            return None
        size = struct.unpack(">Q", ext)[0]
        hlen = 16
    elif size == 0:
        size = end - pos
    if size < hlen or pos + size > end:
        return None
    return kind, size, hlen


def atoms(f: BinaryIO, start: int, end: int) -> Iterator[tuple[bytes, int, int, int]]:
    """(type, offset, size, header length) of the atoms between `start` and `end`; stops at the first damaged one."""
    pos = start
    while pos + 8 <= end:
        h = _header(f, pos, end)
        if h is None:
            return
        kind, size, hlen = h
        yield kind, pos, size, hlen
        pos += size


def top_level(path: Path) -> list[tuple[str, int, int]]:
    """[(type, offset, size)] of the file's top-level atoms."""
    with open(path, "rb") as f:
        end = os.fstat(f.fileno()).st_size
        return [(k.decode("latin-1"), o, s) for k, o, s, _ in atoms(f, 0, end)]


def is_faststart(path: Path) -> bool | None:
    """True when `moov` comes before the first `mdat`, False when it comes after, None when either is missing."""
    moov = mdat = None
    for kind, off, _ in top_level(path):
        if kind == "moov" and moov is None:
            moov = off
        elif kind == "mdat" and mdat is None:
            mdat = off
    if moov is None or mdat is None:
        return None
    return moov < mdat


def _shift(buf: bytearray, start: int, end: int, delta: int) -> None:
    """Add `delta` to every chunk offset of the `stco` and `co64` tables inside buf[start:end] (a container's children)."""
    pos = start
    while pos + 8 <= end:
        size, kind = struct.unpack_from(">I4s", buf, pos)
        hlen = 8
        if size == 1:
            size = struct.unpack_from(">Q", buf, pos + 8)[0]
            hlen = 16
        elif size == 0:
            size = end - pos
        if size < hlen or pos + size > end:
            raise Unsupported("damaged atom inside moov")
        body = pos + hlen
        if kind in CONTAINERS:
            _shift(buf, body, pos + size, delta)
        elif kind in (b"stco", b"co64"):
            count = struct.unpack_from(">I", buf, body + 4)[0]
            wide = kind == b"co64"
            width = 8 if wide else 4
            if body + 8 + count * width > pos + size:
                raise Unsupported("chunk table is longer than its atom")
            fmt = ">Q" if wide else ">I"
            for i in range(count):
                at = body + 8 + i * width
                value = struct.unpack_from(fmt, buf, at)[0] + delta
                if not wide and value > U32:
                    raise Unsupported("32-bit chunk offset overflow")
                struct.pack_into(fmt, buf, at, value)
        pos += size


def _copy(src: BinaryIO, dst: BinaryIO, start: int, end: int) -> None:
    src.seek(start)
    left = end - start
    while left > 0:
        block = src.read(min(CHUNK, left))
        if not block:
            raise Unsupported("file ended early")
        dst.write(block)
        left -= len(block)


def _rewrite(path: Path) -> bool:
    """Write the faststart copy beside `path` and swap it in; False when the file needs nothing."""
    with open(path, "rb") as f:
        size = os.fstat(f.fileno()).st_size
        top = list(atoms(f, 0, size))
        if sum(s for _, _, s, _ in top) != size:
            raise Unsupported("atoms do not cover the file")
        kinds = [k for k, _, _, _ in top]
        if b"moov" not in kinds or b"mdat" not in kinds:
            raise Unsupported("no moov or no mdat")
        if kinds.count(b"moov") != 1 or b"moof" in kinds:
            raise Unsupported("fragmented or several moov atoms")
        moov = next(a for a in top if a[0] == b"moov")
        mdats = [a for a in top if a[0] == b"mdat"]
        if moov[1] < mdats[0][1]:
            return False
        if any(m[1] > moov[1] for m in mdats):
            raise Unsupported("mdat after moov")
        if moov[2] > MAX_MOOV:
            raise Unsupported("moov is too large")
        f.seek(moov[1])
        buf = bytearray(f.read(moov[2]))
        _shift(buf, moov[3], len(buf), moov[2])
        head = top[0]
        if head[0] != b"ftyp":
            raise Unsupported("file does not start with ftyp")
        tail = head[1] + head[2]
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".faststart-", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as out:
                _copy(f, out, 0, tail)
                out.write(buf)
                _copy(f, out, tail, moov[1])
                _copy(f, out, moov[1] + moov[2], size)
                out.flush()
                os.fsync(out.fileno())
            if os.path.getsize(tmp) != size:
                raise Unsupported("rewritten size differs")
            if is_faststart(Path(tmp)) is not True:
                raise Unsupported("rewritten file is not faststart")
            os.chmod(tmp, os.stat(path).st_mode & 0o777)
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
    return True


def ensure(path: Path) -> str:
    """Make the m4a at `path` start with its `moov` atom. Returns "fixed" (rewritten), "ok" (already fine) or "skipped" (missing, fragmented, unknown layout or any failure); never raises, so a download never fails because of it."""
    try:
        if not path.is_file():
            return SKIPPED
        return FIXED if _rewrite(path) else OK
    except Unsupported as exc:
        log.info("faststart skipped for %s: %s", path.name, exc)
    except Exception:
        log.warning("faststart failed for %s", path.name, exc_info=True)
    return SKIPPED


def scan(root: Path, apply: bool = False) -> dict[str, int]:
    """Count (and with `apply` rewrite) the m4a files under `root` whose moov is not in front. Files that are not understood are only counted."""
    counts = {"checked": 0, "already_fast": 0, "needs_fix": 0, "fixed": 0, "skipped": 0}
    for path in sorted(root.rglob("*.m4a")):
        if not path.is_file() or path.name.startswith("."):
            continue
        counts["checked"] += 1
        try:
            state = is_faststart(path)
        except OSError:
            state = None
        if state is True:
            counts["already_fast"] += 1
        elif state is None:
            counts["skipped"] += 1
        elif not apply:
            counts["needs_fix"] += 1
        else:
            counts[{FIXED: "fixed", OK: "already_fast"}.get(ensure(path), "skipped")] += 1
    return counts


def main(argv: list[str] | None = None) -> int:
    import argparse
    import json

    ap = argparse.ArgumentParser(prog="python -m app.faststart", description="Move the moov atom of stored m4a files to the front. Dry run unless --apply.")
    ap.add_argument("root", type=Path, help="a directory of m4a files (searched recursively)")
    ap.add_argument("--apply", action="store_true", help="rewrite the files that need it, one at a time and atomically")
    args = ap.parse_args(argv)
    print(json.dumps(scan(args.root, args.apply)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
