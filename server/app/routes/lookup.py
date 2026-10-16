"""Link preview and the metadata/tag suggestion lookups used by the add form."""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from .. import credits, deps, discogs_lookup, extractor, genre_lookup, library, metadata, timeutil, titleclean, wiki_lookup
from ..links import Refused, resolve_link, short_error
from ..schemas import MetadataRequest, PreviewRequest, WikipediaLookupRequest

router = APIRouter()

MAX_METADATA_SOURCES = 5


def clean_preview_title(meta: dict[str, Any]) -> dict[str, str]:
    raw = str(meta.get("title") or "")
    return {"title": titleclean.clean(raw), "title_raw": raw}


def source_info(url: str) -> dict[str, Any]:
    """album, year and tags yt-dlp reports for one YouTube/SoundCloud link; raises when the link is unusable."""
    link = resolve_link(url)
    if link.probe is not None:
        return link.probe
    return extractor.preview(link.vid)


async def _genre_stage(meta: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    artist, title = meta.get("artist", ""), meta.get("title", "")
    found = await run_in_threadpool(genre_lookup.suggest_tags, artist, title)
    mb = await run_in_threadpool(genre_lookup.lookup, artist, title)
    return found, mb


async def _wiki_stage(meta: dict[str, Any]) -> dict[str, Any]:
    return await run_in_threadpool(wiki_lookup.suggest, meta.get("artist", ""), meta.get("title", ""))


async def _discogs_stage(meta: dict[str, Any]) -> dict[str, Any]:
    return await run_in_threadpool(discogs_lookup.suggest, meta.get("artist", ""), meta.get("title", ""))


async def _apply_suggestions(meta: dict[str, Any]) -> None:
    found, mb = await _genre_stage(meta)
    wiki = await _wiki_stage(meta)
    disc = await _discogs_stage(meta)
    _merge_suggestions(meta, found, mb, wiki, disc)


def _merge_suggestions(meta: dict[str, Any], found: list[str], mb: dict[str, Any], wiki: dict[str, Any], disc: dict[str, Any]) -> None:
    disc_genres = [t for t in disc["tags"] if t.startswith("genre:")]
    disc_rest = [t for t in disc["tags"] if not t.startswith("genre:")]
    yt = list(meta.get("youtube_genres") or [])
    own = list(meta.get("tags", []))
    remixer_is_artist = metadata.artist_is_remixer(meta.get("artist", ""), meta.get("title_raw") or meta.get("title", ""), meta.get("remixer"))
    if meta.get("remixer") or remixer_is_artist:
        meta["tags"], meta["original_genres"] = metadata.split_for_version([*own, *yt], [*disc_genres, *found, *wiki["tags"], *disc_rest], wiki.get("song_genres"))
    else:
        meta["tags"] = metadata.finalize_tags([*meta.get("tags", []), *disc_genres, *found, *wiki["tags"], *yt, *disc_rest], wiki.get("song_genres"))
        meta["original_genres"] = []
    others = {*own, *disc_genres, *found, *wiki["tags"]}
    meta["tag_sources"] = {t: "youtube" for t in meta["tags"] if t in yt and t not in others}
    meta["wikipedia_song"] = wiki["wikipedia_song"]
    meta["wikipedia_artist"] = None if remixer_is_artist else wiki["wikipedia_artist"]
    meta["wikipedia_album"] = wiki.get("wikipedia_album")
    meta["discogs_url"] = disc["url"]
    meta["remixer"] = meta.get("remixer")
    suggestion = _released_suggestion(wiki, mb, disc)
    meta["released_suggestion"] = suggestion
    meta["suggested_year"] = suggestion["year"] if suggestion else None
    if meta.get("year") is None:
        meta["year"] = meta["suggested_year"]


def _released_suggestion(wiki: dict[str, Any], mb: dict[str, Any], disc: dict[str, Any]) -> dict[str, Any] | None:
    """First released year of the original recording: Wikipedia, then MusicBrainz, then Discogs; never a platform date (DATA-126)."""
    for source, value in (("wikipedia", wiki.get("year")), ("musicbrainz", mb.get("year")), ("discogs", disc.get("year"))):
        year = timeutil.valid_year(value)
        if year:
            return {"year": year, "source": source}
    return None


@router.post("/preview", responses=deps.responses(502))
async def preview(req: PreviewRequest, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    try:
        link = await run_in_threadpool(resolve_link, req.url)
    except Refused as refused:
        return refused.response
    vid = link.vid
    if link.probe is not None:
        meta = {k: v for k, v in link.probe.items() if k != "preview_only"}
    else:
        try:
            meta = await run_in_threadpool(extractor.preview, vid)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"preview failed: {short_error(exc)}") from exc
    meta.update(clean_preview_title(meta))
    await _apply_suggestions(meta)
    meta["in_library"] = library.find_song(deps.load_songs(user["uid"]), vid) is not None
    return meta


PREVIEW_STAGES = (
    ("link", "Reading the link"),
    ("details", "Getting title and artist"),
    ("genres", "Looking up genres and the first release"),
    ("wiki", "Checking Wikipedia and Wikidata"),
    ("discogs", "Checking Discogs"),
)


def _line(event: dict[str, Any]) -> bytes:
    return (json.dumps(event, separators=(",", ":")) + "\n").encode()


async def _preview_events(req: PreviewRequest, user: dict[str, Any]) -> AsyncIterator[bytes]:
    yield _line({"event": "stages", "stages": [{"id": i, "label": label} for i, label in PREVIEW_STAGES]})
    stage = "link"
    t0 = time.monotonic()

    def mark(state: str) -> bytes:
        return _line({"event": "stage", "id": stage, "state": state, "at": round(time.monotonic() - t0, 2)})

    try:
        yield mark("start")
        try:
            link = await run_in_threadpool(resolve_link, req.url)
        except Refused as refused:
            body = json.loads(refused.response.body)
            yield _line({"event": "error", "stage": stage, "status": refused.response.status_code, **body})
            return
        yield mark("done")
        stage = "details"
        yield mark("start")
        if link.probe is not None:
            meta = {k: v for k, v in link.probe.items() if k != "preview_only"}
        else:
            try:
                meta = await run_in_threadpool(extractor.preview, link.vid)
            except Exception as exc:
                yield _line({"event": "error", "stage": stage, "status": 502, "error": "failed", "detail": f"preview failed: {short_error(exc)}"})
                return
        meta.update(clean_preview_title(meta))
        yield mark("done")
        stage = "genres"
        yield mark("start")
        found, mb = await _genre_stage(meta)
        yield mark("done")
        stage = "wiki"
        yield mark("start")
        wiki = await _wiki_stage(meta)
        yield mark("done")
        stage = "discogs"
        yield mark("start")
        disc = await _discogs_stage(meta)
        yield mark("done")
        _merge_suggestions(meta, found, mb, wiki, disc)
        meta["in_library"] = library.find_song(deps.load_songs(user["uid"]), link.vid) is not None
        yield _line({"event": "result", "data": meta})
    except Exception as exc:
        yield _line({"event": "error", "stage": stage, "status": 500, "error": "failed", "detail": short_error(exc) or "lookup failed"})


@router.post("/preview/stream", responses=deps.responses(502))
async def preview_stream(req: PreviewRequest, user: Annotated[dict[str, Any], Depends(deps.require_token)]):
    """Same lookup as /preview, as NDJSON events so the web can show the step being worked on (API-138)."""
    return StreamingResponse(_preview_events(req, user), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.post("/metadata", dependencies=[Depends(deps.require_token)])
async def get_metadata(req: MetadataRequest):
    if req.version_kind is not None and req.version_kind not in credits.KINDS:
        raise HTTPException(status_code=422, detail=f"version_kind must be one of {', '.join(credits.KINDS)}")
    urls = [src.url.strip() for src in req.sources[:MAX_METADATA_SOURCES] if src.url.strip()]
    fetchers = [(lambda u=u: source_info(u)) for u in urls]
    return await run_in_threadpool(
        metadata.gather, req.title.strip(), req.artist.strip(), fetchers, req.wiki_song, req.wiki_artist, metadata.TIMEOUT, urls, req.wiki_album,
        req.version_kind,
    )


@router.post("/lookup/wikipedia", dependencies=[Depends(deps.require_token)])
async def lookup_wikipedia(req: WikipediaLookupRequest):
    found = await run_in_threadpool(wiki_lookup.from_links, req.wikipedia_song, req.wikipedia_artist, req.wikipedia_album)
    return {"tags": metadata.finalize_tags(found["tags"], found.get("song_genres")), "year": found["year"]}
