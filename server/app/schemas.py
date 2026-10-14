"""Request bodies of the HTTP API."""

from __future__ import annotations

from pydantic import BaseModel, Field

MAX_ID_TOKEN_LEN = 8192
MIN_BPM, MAX_BPM = 20, 300


class SessionRequest(BaseModel):
    id_token: str = Field(min_length=1, max_length=MAX_ID_TOKEN_LEN)


class DownloadRequest(BaseModel):
    video_id: str


class PreviewRequest(BaseModel):
    url: str


class SongMeta(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    remixer: str | None = None
    year: int | None = None
    remix_year: int | None = None
    bpm: float | None = Field(default=None, ge=MIN_BPM, le=MAX_BPM)
    wikipedia_song: str | None = None
    wikipedia_artist: str | None = None
    musicbrainz_url: str | None = None
    discogs_url: str | None = None


class CreateSongRequest(BaseModel):
    url: str
    audio: bool = True
    metadata: SongMeta = SongMeta()
    tags: list[str] = []
    keep_title: bool = False


class PatchSongRequest(SongMeta):
    tags: list[str] | None = None


class WikipediaLookupRequest(BaseModel):
    wikipedia_song: str | None = None
    wikipedia_artist: str | None = None


class MetadataSource(BaseModel):
    url: str = ""


class MetadataRequest(BaseModel):
    title: str = ""
    artist: str = ""
    sources: list[MetadataSource] = Field(default_factory=list)
    wiki_song: str | None = None
    wiki_artist: str | None = None
