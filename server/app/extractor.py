"""Thin wrapper around yt-dlp. Kept separate so tests can stub it."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yt_dlp

from . import langcodes, library
from .urlclean import is_valid_video_id, parse_video_id, watch_url  # noqa: F401


def search(query: str, limit: int) -> list[dict[str, Any]]:
    opts = {"quiet": True, "extract_flat": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    results = []
    for entry in info.get("entries", []):
        if not entry or not is_valid_video_id(entry.get("id", "")):
            continue
        results.append(
            {
                "id": entry["id"],
                "title": entry.get("title") or "",
                "artist": entry.get("uploader") or entry.get("channel") or "",
                "duration": entry.get("duration"),
                "thumbnail": f"https://i.ytimg.com/vi/{entry['id']}/hqdefault.jpg",
            }
        )
    return results


def download(video_id: str, out_dir: Path) -> dict[str, Any]:
    """Download the m4a audio stream for one video; return its metadata."""
    out_dir.mkdir(parents=True, exist_ok=True)
    opts = {
        "quiet": True,
        "noplaylist": True,
        "format": "bestaudio[ext=m4a]/140",
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
    }
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    return {
        "id": video_id,
        "title": info.get("title") or "",
        "artist": info.get("artist") or info.get("uploader") or "",
        "duration": info.get("duration"),
        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
    }


def cover_url(video_id: str) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def _year(info: dict[str, Any]) -> int | None:
    if info.get("release_year"):
        return int(info["release_year"])
    date = str(info.get("release_date") or info.get("upload_date") or "")
    return int(date[:4]) if date[:4].isdigit() else None


def suggest_tags(info: dict[str, Any]) -> list[str]:
    """yt-dlp's real `genre` and `language` values -> suggested `genre:` and `lang:` tags."""
    raw = info.get("genre")
    values = raw if isinstance(raw, list) else re.split(r"[,;]", str(raw)) if raw else []
    tags = [f"genre:{v}" for v in values if str(v).strip()]
    lang = langcodes.to_lang_code(str(info.get("language") or ""))
    if lang:
        tags.append(f"lang:{lang}")
    return library.clean_tags(tags)


def preview(video_id: str) -> dict[str, Any]:
    """Fetch metadata without downloading."""
    opts = {"quiet": True, "noplaylist": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(watch_url(video_id), download=False)
    return {
        "id": video_id,
        "source_url": watch_url(video_id),
        "title": info.get("track") or info.get("title") or "",
        "artist": info.get("artist") or info.get("creator") or info.get("uploader") or "",
        "album": info.get("album"),
        "year": _year(info),
        "tags": suggest_tags(info),
        "duration": info.get("duration"),
        "thumbnail": cover_url(video_id),
    }


def download_audio(video_id: str, out_dir: Path, progress=None) -> dict[str, Any]:
    """Like download(), but reports progress (0..1) via the callback."""
    out_dir.mkdir(parents=True, exist_ok=True)

    def hook(d: dict[str, Any]) -> None:
        if progress and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                progress(min(d.get("downloaded_bytes", 0) / total, 1.0))

    opts = {
        "quiet": True,
        "noplaylist": True,
        "format": "bestaudio[ext=m4a]/140",
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "progress_hooks": [hook],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(watch_url(video_id), download=True)
    return {
        "id": video_id,
        "title": info.get("track") or info.get("title") or "",
        "artist": info.get("artist") or info.get("creator") or info.get("uploader") or "",
        "duration": info.get("duration"),
    }


def fetch_cover(video_id: str, dest: Path) -> None:
    """Download the thumbnail for a video id to dest (fixed ytimg host only)."""
    import urllib.request

    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(cover_url(video_id), timeout=20) as r:
        data = r.read()
    dest.write_bytes(data)

