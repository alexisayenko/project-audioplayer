"""Request bodies of the HTTP API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_ID_TOKEN_LEN = 8192
MIN_BPM, MAX_BPM = 20, 300
MAX_PASTE_ITEM = 100_000


class SessionRequest(BaseModel):
    id_token: str = Field(min_length=1, max_length=MAX_ID_TOKEN_LEN)


class DownloadRequest(BaseModel):
    video_id: str


class PreviewRequest(BaseModel):
    url: str


class VersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str | None = None
    releaseYear: int | None = None
    originalArtists: str | list[str] | None = None
    artists: list[str] | None = None
    kind: str | None = None
    name: str | None = None
    by: list[str] | None = None
    year: int | None = None
    of: str | list[str] | None = None


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
    artists: list[str] | None = None
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


class CreateSongRequest(BaseModel):
    url: str
    audio: bool = True
    metadata: SongMeta = SongMeta()
    tags: list[str] = []
    genres: list[str] = []
    keep_title: bool = False
    source_raw: SourceRaw | None = None


class PatchSongRequest(SongMeta):
    tags: list[str] | None = None
    genres: list[str] | None = None
    youtube_url: str | None = None
    soundcloud_url: str | None = None
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


class DraftLinesRequest(BaseModel):
    lines: list[str] = Field(max_length=1000)

    @field_validator("lines")
    @classmethod
    def _bounded(cls, lines: list[str]) -> list[str]:
        if any(len(line) > MAX_PASTE_ITEM for line in lines):
            raise ValueError("a pasted item is too long")
        return lines


class DraftPatchRequest(BaseModel):
    text: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=300)
