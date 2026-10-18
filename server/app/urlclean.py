"""Canonical, tracking-free song URLs and song ids (YouTube and SoundCloud)."""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
SOUNDCLOUD_ID_RE = re.compile(r"^soundcloud-\d{1,20}$", re.ASCII)
SOUNDCLOUD_PREFIX = "soundcloud-"
CATALOG_ID_RE = re.compile(r"^(spotify|applemusic|shazam)-[A-Za-z0-9_-]{1,64}$")

UNSUPPORTED_MESSAGE = "Only single tracks are supported"

_ID = r"([A-Za-z0-9_-]{11})"
_URL_ID_RES = [
    re.compile(rf"^(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:.*&)?v={_ID}(?:[&#].*)?$", re.I),
    re.compile(rf"^(?:https?://)?(?:www\.|m\.|music\.)?youtube\.com/(?:shorts|embed|live)/{_ID}(?:[/?#].*)?$", re.I),
    re.compile(rf"^(?:https?://)?youtu\.be/{_ID}(?:[/?#].*)?$", re.I),
]

_TRACKING = {"si", "feature", "pp", "fbclid", "gclid"}


def is_valid_video_id(video_id: str) -> bool:
    """A song id: an 11-char YouTube id, `soundcloud-<numeric track id>`, or a metadata-only `spotify-`/`applemusic-`/`shazam-` id."""
    if video_id.startswith(SOUNDCLOUD_PREFIX):
        return bool(SOUNDCLOUD_ID_RE.fullmatch(video_id))
    return bool(VIDEO_ID_RE.fullmatch(video_id) or CATALOG_ID_RE.fullmatch(video_id))


def source_of(song_id: str) -> str:
    if SOUNDCLOUD_ID_RE.fullmatch(song_id):
        return "soundcloud"
    m = CATALOG_ID_RE.fullmatch(song_id)
    return m.group(1) if m else "youtube"


def soundcloud_song_id(track_id: str | int) -> str:
    return f"{SOUNDCLOUD_PREFIX}{track_id}"


_SC_HOSTS = {"soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"}
_SC_SHORT_HOST = "on.soundcloud.com"
_SC_NAME = r"[A-Za-z0-9_-]+"
_SC_RESERVED_USERS = {
    "discover", "stations", "you", "charts", "search", "upload", "feed", "pages", "popular",
    "mobile", "settings", "notifications", "messages", "jobs", "terms-of-use", "creators", "go",
}
_SC_RESERVED_SECOND = {"tracks", "albums", "sets", "reposts", "likes", "spotlight", "comments", "popular-tracks", "following", "followers", "playlists"}
_SC_PRIVATE_RE = re.compile(r"^s-[A-Za-z0-9]+$")
_SC_SHORT_CODE_RE = re.compile(r"^[A-Za-z0-9]{3,32}$")
_SC_FIND_RE = re.compile(r"(?:https?://)?(?:(?:www\.|m\.)?soundcloud\.com|on\.soundcloud\.com)/[^\s<>\"']+", re.I)


def classify_soundcloud(text: str) -> tuple[str, str] | None:
    """`("track", canonical)`, `("short", https://on.soundcloud.com/<code>)`, `("unsupported", "")` or None (not SoundCloud).

    A track is soundcloud.com/<artist>/<track>[/s-<secret>]; the query and fragment are dropped.
    """
    text = text.strip()
    m = re.match(r"^(?:https?://)?([a-z0-9.-]+)(/[^?#]*)?(?:[?#].*)?$", text, re.I)
    if not m:
        return None
    host, path = m.group(1).lower(), (m.group(2) or "")
    parts = [p for p in path.split("/") if p]
    if host == _SC_SHORT_HOST:
        if len(parts) == 1 and _SC_SHORT_CODE_RE.fullmatch(parts[0]):
            return ("short", f"https://{_SC_SHORT_HOST}/{parts[0]}")
        return ("unsupported", "")
    if host not in _SC_HOSTS:
        return None
    if len(parts) < 2 or len(parts) > 3:
        return ("unsupported", "")
    url = _soundcloud_track_url(parts)
    return ("track", url) if url else ("unsupported", "")


def _soundcloud_track_url(parts: list[str]) -> str:
    user, track = parts[0], parts[1]
    if user.lower() in _SC_RESERVED_USERS or track.lower() in _SC_RESERVED_SECOND:
        return ""
    if not re.fullmatch(_SC_NAME, user) or not re.fullmatch(_SC_NAME, track):
        return ""
    url = f"https://soundcloud.com/{user}/{track}"
    if len(parts) == 3:
        return f"{url}/{parts[2]}" if _SC_PRIVATE_RE.fullmatch(parts[2]) else ""
    return url


def find_soundcloud_url(text: str) -> str | None:
    m = _SC_FIND_RE.search(text)
    return m.group(0) if m else None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def _open_no_redirect(url: str) -> Any:
    """HEAD without following redirects; returns the HTTPError (or response) carrying the Location header."""
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
    try:
        return opener.open(req, timeout=15)
    except urllib.error.HTTPError as exc:
        return exc


def resolve_soundcloud_short(url: str) -> str:
    """Follow an on.soundcloud.com link once (https, soundcloud.com only) and return the canonical track URL.

    Raises ValueError when the link does not lead to a single SoundCloud track.
    """
    kind = classify_soundcloud(url)
    if not kind or kind[0] != "short":
        raise ValueError(UNSUPPORTED_MESSAGE)
    try:
        resp = _open_no_redirect(kind[1])
    except Exception as exc:
        raise ValueError("could not resolve the SoundCloud short link") from exc
    location = (resp.headers.get("Location") or "").strip() if getattr(resp, "headers", None) else ""
    parts = urlsplit(location)
    if parts.scheme.lower() != "https" or (parts.hostname or "").lower() not in _SC_HOSTS:
        raise ValueError("could not resolve the SoundCloud short link")
    target = classify_soundcloud(location)
    if not target or target[0] != "track":
        raise ValueError(UNSUPPORTED_MESSAGE)
    return target[1]


def parse_video_id(url_or_id: str) -> str | None:
    """Extract a YouTube video id from a URL (or accept a bare id)."""
    text = url_or_id.strip()
    if is_valid_video_id(text):
        return text
    for rx in _URL_ID_RES:
        m = rx.match(text)
        if m:
            return m.group(1)
    return None


def watch_url(video_id: str, source_url: str | None = None) -> str:
    """Page URL of a song: YouTube from the id; SoundCloud from its stored link, else the track API URL."""
    if source_of(video_id) not in ("youtube", "soundcloud"):
        return source_url or ""
    if source_of(video_id) == "soundcloud":
        if source_url and (c := classify_soundcloud(source_url)) and c[0] == "track":
            return c[1]
        return f"https://api.soundcloud.com/tracks/{video_id[len(SOUNDCLOUD_PREFIX):]}"
    return f"https://www.youtube.com/watch?v={video_id}"


def _is_tracking(name: str) -> bool:
    name = name.lower()
    return name in _TRACKING or name.startswith("utm_")


def clean_url(text: str) -> str:
    """YouTube links become https://www.youtube.com/watch?v=<id>, SoundCloud track links https://soundcloud.com/<artist>/<track>; other http(s) links lose tracking params."""
    text = text.strip()
    vid = parse_video_id(text)
    if vid:
        return watch_url(vid)
    sc = classify_soundcloud(text)
    if sc and sc[0] in ("track", "short"):
        return sc[1]
    parts = urlsplit(text)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc or not parts.query:
        return text
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _is_tracking(k)]
    return urlunsplit(parts._replace(query=urlencode(kept)))


_SPOTIFY_RE = re.compile(r"^https?://open\.spotify\.com/(?:intl-[a-z]{2}(?:-[a-z]{2,4})?/)?(track|album)/([a-z0-9]{22})(?:[/?#].*)?$", re.I)


def clean_spotify_url(value: Any) -> str | None:
    """https://open.spotify.com/<track|album>/<22-char id>; any other host, kind or id is None."""
    m = _SPOTIFY_RE.fullmatch(value.strip()) if isinstance(value, str) else None
    return f"https://open.spotify.com/{m.group(1).lower()}/{m.group(2)}" if m else None


def clean_youtube_link(value: Any) -> str | None:
    """A YouTube watch link (youtube.com, music.youtube.com, youtu.be; http or https) as https://www.youtube.com/watch?v=<id>; else None. A bare id is not a link."""
    text = value.strip() if isinstance(value, str) else ""
    if not re.match(r"^https?://", text, re.I):
        return None
    vid = parse_video_id(text)
    return watch_url(vid) if vid else None


def clean_soundcloud_link(value: Any) -> str | None:
    """A SoundCloud track link as https://soundcloud.com/<artist>/<track>[/s-<secret>]; short links, other pages and other hosts are None."""
    text = value.strip() if isinstance(value, str) else ""
    if not re.match(r"^https?://", text, re.I):
        return None
    c = classify_soundcloud(text)
    return c[1] if c and c[0] == "track" else None


PLAYLIST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{2,80}$")
_PLAYLIST_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
_PRIVATE_LISTS = {"WL", "LL"}
MIX_MESSAGE = "This is a YouTube Mix (an automatic radio list), not a playlist. Open a real playlist and paste its link."
PRIVATE_LIST_MESSAGE = "Liked videos and Watch later are private lists. Put the songs in a public or unlisted playlist and paste that link."


def parse_playlist(text: str) -> tuple[str, str] | None:
    """`("playlist", id)`, `("mix", id)` (an automatic `RD...` radio list) or `("private", id)` (Liked, Watch later) for a YouTube link that names a list: youtube.com/playlist?list=, youtube.com/watch?v=..&list=, youtu.be/<id>?list=; None for anything else."""
    try:
        parts = urlsplit(text.strip() if re.match(r"^\s*https?://", text, re.I) else f"https://{text.strip()}")
        host = (parts.hostname or "").lower()
    except ValueError:
        return None
    path = parts.path.rstrip("/")
    if host in _PLAYLIST_HOSTS:
        if path not in ("/playlist", "/watch"):
            return None
    elif host != "youtu.be" or not path[1:]:
        return None
    ids = [v for k, v in parse_qsl(parts.query, keep_blank_values=True) if k == "list"]
    list_id = ids[0] if ids else ""
    if not PLAYLIST_ID_RE.fullmatch(list_id):
        return None
    if list_id.startswith("RD"):
        return ("mix", list_id)
    return ("private", list_id) if list_id in _PRIVATE_LISTS else ("playlist", list_id)


def playlist_url(list_id: str) -> str:
    return f"https://www.youtube.com/playlist?list={list_id}"
