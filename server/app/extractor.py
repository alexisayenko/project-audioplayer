"""Thin wrapper around yt-dlp. Kept separate so tests can stub it."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yt_dlp

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def is_valid_video_id(video_id: str) -> bool:
    return bool(VIDEO_ID_RE.fullmatch(video_id))


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
