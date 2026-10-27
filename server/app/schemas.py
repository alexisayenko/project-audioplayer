"""Request bodies of the HTTP API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import genre_layout, playlists

MAX_ID_TOKEN_LEN = 8192
MIN_BPM, MAX_BPM = 20, 300
MAX_PASTE_ITEM = 100_000


class SessionRequest(BaseModel):
    id_token: str = Field(min_length=1, max_length=MAX_ID_TOKEN_LEN)


class TrimIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: float | None = None
    end: float | None = None


class AlbumPreviewRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


class AlbumVideoTextRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    text: str = Field(max_length=60000)


class AlbumPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rymUrl: str | None = Field(default=None, max_length=2000)
    links: dict[str, str | None] | None = None
    title: Any = None
    artist: Any = None
    year: Any = None
    genres: Any = None


class AlbumPlaylistTrack(BaseModel):
    model_config = ConfigDict(extra="ignore")

    position: int = Field(ge=1)
    title: str = Field(default="", max_length=500)
    durationS: float | None = None


class AlbumCoverRequest(BaseModel):
    source: str = Field(max_length=20)
    url: str = Field(min_length=1, max_length=2048)


class AlbumLinkRequest(BaseModel):
    songId: str = Field(min_length=1, max_length=64)


class DownloadRequest(BaseModel):
    video_id: str
    trim: TrimIn | None = None


class AudioRequest(BaseModel):
    trim: TrimIn | None = None


class PreviewRequest(BaseModel):
    url: str


class VersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str | None = None
    releaseYear: int | None = None
    originalArtists: str | list[str] | None = None
    artists: list[str] | None = None
    name: str | None = None


class SourceRaw(BaseModel):
    title: str | None = None
    artist: str | None = None
    remixer: str | None = None


class SongMeta(BaseModel):
    title: str | None = None
    mainArtists: list[str] | None = None
    featuredArtists: list[str] | None = None
    withArtists: list[str] | None = None
    releaseYear: int | None = None
    albums: list[str] | None = None
    artists: list[str] | None = None  # retired ADR-0024 names stay declared so credits.canon_request can answer 422 instead of the key being dropped
    featured: list[str] | None = None
    released: int | None = None
    version: VersionIn | None = None
    artist: str | None = None
    album: str | None = None
    remixer: str | None = None
    year: int | None = None
    remix_year: int | None = None
    bpm: float | None = Field(default=None, ge=MIN_BPM, le=MAX_BPM)
    wikipedia_song: str | None = None
    wikipedia_artist: str | None = None
    wikipedia_album: str | None = None
    musicbrainz_url: str | None = None
    discogs_url: str | None = None
    spotify_url: str | None = None


class SourceIn(BaseModel):
    url: str | None = Field(default=None, max_length=2048)
    type: str | None = Field(default=None, max_length=32)
    ref: str | None = Field(default=None, max_length=2048)
    trim_start: float | None = None
    trim_end: float | None = None
    duration: float | None = None


class CreateSongRequest(BaseModel):
    url: str
    audio: bool = True
    metadata: SongMeta = SongMeta()
    tags: list[str] = []
    genres: list[str] = []
    keep_title: bool = False
    source_raw: SourceRaw | None = None
    trim: TrimIn | None = None


class PatchSongRequest(SongMeta):
    tags: list[str] | None = None
    genres: list[str] | None = None
    youtube_url: str | None = None
    soundcloud_url: str | None = None
    url: str | None = Field(default=None, max_length=2048)
    trim: TrimIn | None = None
    sources: list[SourceIn] | None = Field(default=None, max_length=20)
    loops: list[dict[str, Any]] | None = None


class WikipediaLookupRequest(BaseModel):
    wikipedia_song: str | None = None
    wikipedia_artist: str | None = None
    wikipedia_album: str | None = None


class MetadataSource(BaseModel):
    url: str = ""


class MetadataRequest(BaseModel):
    title: str = ""
    artist: str = ""
    sources: list[MetadataSource] = Field(default_factory=list)
    wiki_song: str | None = None
    wiki_artist: str | None = None
    wiki_album: str | None = None
    version_kind: str | None = None
    version_type: str | None = None
    discogs_url: str | None = Field(default=None, max_length=2048)


class PlaylistImportRequest(BaseModel):
    url: str = Field(max_length=2048)


class PlaylistDetailsRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=10)


class DraftOrigin(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{2,80}$")
    title: str = Field(default="", max_length=300)
    position: int = Field(ge=0, le=100000)


class DraftLinesRequest(BaseModel):
    lines: list[str] = Field(max_length=1000)
    origins: list[DraftOrigin | None] | None = Field(default=None, max_length=1000)

    @field_validator("lines")
    @classmethod
    def _bounded(cls, lines: list[str]) -> list[str]:
        if any(len(line) > MAX_PASTE_ITEM for line in lines):
            raise ValueError("a pasted item is too long")
        return lines

    @model_validator(mode="after")
    def _aligned(self) -> "DraftLinesRequest":
        if self.origins is not None and len(self.origins) != len(self.lines):
            raise ValueError("origins must have one entry per line")
        return self


class DraftPlaylistRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    song_id: str | None = Field(default=None, max_length=200)


class DraftPatchRequest(BaseModel):
    text: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=300)


def _song_ids(ids: list[str]) -> list[str]:
    if any(not sid or len(sid) > 64 for sid in ids):
        raise ValueError("a song id has 1 to 64 characters")
    return ids


class PlaylistCreateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(max_length=2000)
    description: str | None = Field(default=None, max_length=20000)
    song_ids: list[str] = Field(default_factory=list, max_length=playlists.MAX_REQUEST_IDS)

    _ids = field_validator("song_ids")(_song_ids)


class PlaylistPatchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(default=None, max_length=2000)
    description: str | None = Field(default=None, max_length=20000)


class PlaylistSongsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    song_ids: list[str] = Field(max_length=playlists.MAX_REQUEST_IDS)

    _ids = field_validator("song_ids")(_song_ids)


class GenreLayoutRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    positions: dict[str, Any] = Field(default_factory=dict)
    families: dict[str, Any] = Field(default_factory=dict)

    @field_validator("positions", "families")
    @classmethod
    def _points(cls, table: dict[str, Any]) -> dict[str, tuple[int, int]]:
        out: dict[str, tuple[int, int]] = {}
        for name, value in table.items():
            if not 0 < len(name) <= genre_layout.NAME_MAX:
                raise ValueError(f"a genre name needs 1 to {genre_layout.NAME_MAX} characters")
            p = genre_layout.point(value)
            if p is None:
                raise ValueError(f"a position is [x, y], two finite numbers within {genre_layout.COORD_MAX}")
            out[name] = p
        return out

    @model_validator(mode="after")
    def _bounded(self) -> "GenreLayoutRequest":
        if len(self.positions) + len(self.families) > genre_layout.MAX_ENTRIES:
            raise ValueError(f"at most {genre_layout.MAX_ENTRIES} positions")
        return self


class PlayIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    timestamp: str = Field(max_length=64)
    song_id: str = Field(max_length=64)
    listened_s: float
    cont: bool = False


class PlaysRequest(BaseModel):
    batch_key: str = Field(min_length=1, max_length=128)
    plays: list[PlayIn] = Field(max_length=500)


class AlbumSearchRequest(BaseModel):
    artist: str | None = Field(default=None, max_length=300)
    album: str | None = Field(default=None, max_length=300)
    trackCount: int | None = Field(default=None, ge=0, le=1000)
    durationsS: list[float | None] | None = Field(default=None, max_length=1000)
    playlistTracks: list[AlbumPlaylistTrack] | None = Field(default=None, max_length=500)
