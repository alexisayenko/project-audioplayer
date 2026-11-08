"""Square JPEG thumbnails of stored covers, made on first request and cached outside the git-synced data tree."""

from __future__ import annotations

import io
import os
import re
from pathlib import Path

from PIL import Image, ImageOps

from . import deps
from .jsonio import write_bytes_atomic

SIZES = (96, 192, 320)
QUALITY = 82
MAX_SOURCE_BYTES = 8 * 1024 * 1024
_SAFE_UID = re.compile(r"[A-Za-z0-9_.@-]{1,128}")


def snap(size: int) -> int:
    """The allowed size closest to `size`."""
    return min(SIZES, key=lambda s: (abs(s - size), s))


def cache_root() -> Path:
    """`AUDIO_CACHE_DIR`, else `.cache` in the download directory: never inside the git-synced data or covers repos."""
    override = os.environ.get("AUDIO_CACHE_DIR", "").strip()
    return (Path(override) if override else deps.DOWNLOAD_DIR / ".cache") / "thumbs"


def _user_dir(uid: str) -> Path | None:
    if not _SAFE_UID.fullmatch(uid) or uid in (".", ".."):
        return None
    return cache_root() / uid


def render(data: bytes, size: int) -> bytes:
    """The centre-cropped square of `data`, shrunk to `size` px (never enlarged), as a JPEG."""
    with Image.open(io.BytesIO(data)) as probe:
        probe.load()
        img = ImageOps.exif_transpose(probe).convert("RGB")
    side = min(img.size)
    left, top = (img.width - side) // 2, (img.height - side) // 2
    img = img.crop((left, top, left + side, top + side))
    if side > size:
        img = img.resize((size, size), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=QUALITY, optimize=True)
    return out.getvalue()


def thumbnail(uid: str, video_id: str, original: Path, size: int) -> Path | None:
    """The cached thumbnail file of `original` at `size` (made now when missing); None when it cannot be made, so the caller serves the original."""
    try:
        stat = original.stat()
        folder = _user_dir(uid)
        if folder is None or stat.st_size > MAX_SOURCE_BYTES:
            return None
        target = folder / f"{video_id}.{size}.{stat.st_mtime_ns}-{stat.st_size}.jpg"
        if target.is_file():
            return target
        jpeg = render(original.read_bytes(), size)
        folder.mkdir(parents=True, exist_ok=True)
        write_bytes_atomic(target, jpeg)
        for old in folder.glob(f"{video_id}.{size}.*.jpg"):
            if old != target:
                old.unlink(missing_ok=True)
        return target
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        return None


def drop(uid: str, video_id: str) -> None:
    """Forget every cached thumbnail of a song (its cover changed or was removed)."""
    folder = _user_dir(uid)
    if folder is None or not folder.is_dir():
        return
    for old in folder.glob(f"{video_id}.*.jpg"):
        old.unlink(missing_ok=True)
