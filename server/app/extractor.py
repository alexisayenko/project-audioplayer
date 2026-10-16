"""Thin wrapper around yt-dlp. Kept separate so tests can stub it."""

from __future__ import annotations

import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

import yt_dlp

from . import credits_split, genre_filter, library, timeutil, urlclean, yt_genres
from .jsonio import write_bytes_atomic
from .titles import cut_remix, split_artist_title, split_title
from .urlclean import is_valid_video_id, parse_video_id, source_of, watch_url  # noqa: F401

PREVIEW_ONLY_MESSAGE = "Preview only \u2014 SoundCloud Go+ track, can't be downloaded in full."
_PREVIEW_MAX_SECONDS = 35
_PREVIEW_GAP_SECONDS = 60
_SC_ARTWORK_RE = re.compile(r"-(?:large|crop|badge|small|tiny|mini|original|t\d+x\d+)\.(?:jpg|jpeg|png)(?=$|\?)", re.I)


class PreviewOnly(Exception):
    """A SoundCloud Go+ track whose full audio is not available (only the 30 s preview)."""

    def __init__(self, message: str = PREVIEW_ONLY_MESSAGE) -> None:
        super().__init__(message)


def search(query: str, limit: int) -> list[dict[str, Any]]:
    opts = {"quiet": True, "extract_flat": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    results = []
    for entry in info.get("entries", []):
        if not entry or not is_valid_video_id(entry.get("id", "")):
            continue
        artist, title = split_artist_title(entry.get("uploader") or entry.get("channel") or "", entry.get("title") or "")
        results.append(
            {
                "id": entry["id"],
                "title": title,
                "artist": artist,
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


def _is_sndcdn(url: str) -> bool:
    parts = urlparse(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and (host == "sndcdn.com" or host.endswith(".sndcdn.com"))


def large_artwork(url: str | None) -> str | None:
    """SoundCloud artwork URL upgraded to 500x500 (https sndcdn.com only)."""
    if not url or not _is_sndcdn(url):
        return None
    return _SC_ARTWORK_RE.sub("-t500x500.jpg", url)


def cover_url(video_id: str, artwork: str | None = None) -> str | None:
    """Where the cover comes from: ytimg for YouTube ids, the stored artwork URL for SoundCloud ones."""
    if source_of(video_id) == "soundcloud":
        return large_artwork(artwork)
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def _published_year(info: dict[str, Any]) -> int | None:
    """Year the platform shows for the upload (`upload_date`, else the created `timestamp`); never a release date."""
    date = str(info.get("upload_date") or "")
    if date[:4].isdigit():
        return timeutil.valid_year(int(date[:4]))
    stamp = info.get("timestamp")
    if isinstance(stamp, (int, float)) and not isinstance(stamp, bool):
        try:
            return timeutil.valid_year(datetime.fromtimestamp(stamp, UTC).year)
        except (OverflowError, OSError, ValueError):
            return None
    return None


def suggest_tags(info: dict[str, Any]) -> list[str]:
    """yt-dlp's real `genre` value -> suggested `genre:` tags."""
    raw = info.get("genre")
    if isinstance(raw, list):
        values = raw
    elif raw:
        values = re.split(r"[,;]", str(raw))
    else:
        values = []
    tags = [f"genre:{v}" for v in values if str(v).strip()]
    return genre_filter.only_canonical(library.clean_tags(tags))


def _artwork_of(info: dict[str, Any]) -> str | None:
    thumbs = {t.get("id"): t.get("url") for t in info.get("thumbnails") or [] if isinstance(t, dict)}
    return large_artwork(thumbs.get("t500x500") or info.get("thumbnail"))


def _sc_formats_preview_only(info: dict[str, Any]) -> bool:
    """yt-dlp marks SoundCloud 30 s snippets with `preview` in the format id; only previews left means Go+."""
    formats = [f for f in info.get("formats") or [] if isinstance(f, dict)]
    return bool(formats) and all("preview" in str(f.get("format_id") or "") for f in formats)


def _first(value: Any) -> str:
    if isinstance(value, list):
        return str(value[0]) if value else ""
    return str(value or "")


def _soundcloud_info(url: str, download: bool = False, opts: dict[str, Any] | None = None) -> dict[str, Any]:
    base = {"quiet": True, "noplaylist": True}
    if not download:
        base["skip_download"] = True
    with yt_dlp.YoutubeDL({**base, **(opts or {})}) as ydl:
        info = ydl.extract_info(url, download=download)
    if info.get("_type") in ("playlist", "multi_video") or info.get("entries"):
        raise ValueError(urlclean.UNSUPPORTED_MESSAGE)
    return info


def soundcloud_probe(url: str) -> dict[str, Any]:
    """Resolve a canonical SoundCloud track URL to its id, metadata and preview-only flag (no download)."""
    info = _soundcloud_info(url)
    raw_title = info.get("track") or info.get("title") or ""
    title, remixer = cut_remix(raw_title)
    artist = _first(info.get("artists")) or info.get("artist") or info.get("creator") or info.get("uploader") or ""
    return {
        "id": urlclean.soundcloud_song_id(info["id"]),
        "source_url": urlclean.watch_url(urlclean.soundcloud_song_id(info["id"]), url),
        "source": "soundcloud",
        "title": title,
        "artist": artist,
        "album": info.get("album"),
        "remixer": remixer,
        "raw": {"title": raw_title, "artist": artist, "remixer": remixer},
        "suggested_credits": credits_split.suggest(artist, title, remixer, {"uploader": artist}),
        "year": None,
        "published_year": _published_year(info),
        "tags": suggest_tags({**info, "genre": info.get("genre") or info.get("genres")}),
        "duration": info.get("duration"),
        "thumbnail": _artwork_of(info),
        "preview_only": _sc_formats_preview_only(info),
    }


def preview(video_id: str) -> dict[str, Any]:
    """Fetch YouTube metadata without downloading."""
    opts = {"quiet": True, "noplaylist": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(watch_url(video_id), download=False)
    raw_artist = info.get("artist") or info.get("creator") or info.get("uploader") or ""
    raw_title = info.get("track") or info.get("title") or ""
    artist, title, remixer = split_title(raw_artist, raw_title)
    return {
        "id": video_id,
        "source": "youtube",
        "source_url": watch_url(video_id),
        "title": title,
        "artist": artist,
        "album": info.get("album"),
        "remixer": remixer,
        "raw": {"title": raw_title, "artist": raw_artist, "remixer": remixer},
        "suggested_credits": credits_split.suggest(artist, title, remixer, {"uploader": raw_artist}),
        "year": None,
        "published_year": _published_year(info),
        "tags": suggest_tags(info),
        "youtube_genres": yt_genres.suggest(info, artist, title),
        "duration": info.get("duration"),
        "thumbnail": cover_url(video_id),
    }


def _file_seconds(path: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout.strip()
        return float(out)
    except Exception:
        return None


def _looks_like_preview(page_seconds: float | None, file_seconds: float | None) -> bool:
    return bool(page_seconds and file_seconds is not None and file_seconds < _PREVIEW_MAX_SECONDS
                and page_seconds - file_seconds > _PREVIEW_GAP_SECONDS)


def _progress_hook(progress: Callable[[float], None] | None) -> Callable[[dict[str, Any]], None]:
    def hook(d: dict[str, Any]) -> None:
        if not progress:
            return
        if d.get("status") == "downloading":
            if hasattr(progress, "detail"):
                progress.detail(d.get("speed"), d.get("eta"))
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                progress(min(d.get("downloaded_bytes", 0) / total, 1.0))
        elif d.get("status") == "finished" and hasattr(progress, "converting"):
            progress.converting()

    return hook


def download_audio(video_id: str, out_dir: Path, progress: Callable[[float], None] | None = None, source_url: str | None = None) -> dict[str, Any]:
    """Download one song's audio (m4a); reports progress (0..1) via the callback."""
    out_dir.mkdir(parents=True, exist_ok=True)
    hook = _progress_hook(progress)

    if source_of(video_id) == "soundcloud":
        return _download_soundcloud(video_id, out_dir, hook, source_url)
    opts = {
        "quiet": True,
        "noplaylist": True,
        "format": "bestaudio[ext=m4a]/140",
        "outtmpl": str(out_dir / f"{video_id}.%(ext)s"),
        "progress_hooks": [hook],
    }
    page = watch_url(parse_video_id(source_url) or video_id) if source_url and source_of(video_id) == "youtube" else watch_url(video_id)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(page, download=True)
    artist, title, remixer = split_title(
        info.get("artist") or info.get("creator") or info.get("uploader") or "",
        info.get("track") or info.get("title") or "",
    )
    return {"id": video_id, "title": title, "artist": artist, "remixer": remixer, "duration": info.get("duration")}


def _download_soundcloud(video_id: str, out_dir: Path, hook: Callable[[dict[str, Any]], None], source_url: str | None) -> dict[str, Any]:
    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(out_dir / f"{video_id}.%(ext)s"),
        "progress_hooks": [hook],
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a", "preferredquality": "192"}],
    }
    info = _soundcloud_info(watch_url(video_id, source_url), download=True, opts=opts)
    target = out_dir / f"{video_id}.m4a"
    chosen = str(info.get("format_id") or "")
    if "preview" in chosen or _looks_like_preview(info.get("duration"), _file_seconds(target)):
        target.unlink(missing_ok=True)
        raise PreviewOnly()
    title, remixer = cut_remix(info.get("track") or info.get("title") or "")
    return {
        "id": video_id,
        "title": title,
        "remixer": remixer,
        "artist": _first(info.get("artists")) or info.get("artist") or info.get("creator") or info.get("uploader") or "",
        "duration": info.get("duration"),
        "thumbnail": _artwork_of(info),
    }


def fetch_cover(video_id: str, dest: Path, artwork: str | None = None) -> None:
    """Download the cover for a song id to dest (fixed ytimg host, or sndcdn.com for SoundCloud artwork)."""
    import urllib.request

    url = cover_url(video_id, artwork)
    if not url:
        raise ValueError("no cover available")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=20) as r:
        data = r.read()
    write_bytes_atomic(dest, data)


def error_code(exc: Exception) -> str | None:
    """Map a yt-dlp failure to `not_found` / `private` when its message says so."""
    text = str(exc).lower()
    if "404" in text or "not found" in text or "does not exist" in text:
        return "not_found"
    if "403" in text or "401" in text or "private" in text or "forbidden" in text:
        return "private"
    return None
