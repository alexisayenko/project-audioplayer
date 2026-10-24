"""Draft list: lines and links the user collected to add to the Library later (API-180..API-185). Per user, never visible to guests."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from .. import deps, drafts, playlists, urlclean, users
from ..schemas import DraftLinesRequest, DraftPatchRequest, DraftPlaylistRequest

router = APIRouter()

UNKNOWN_DRAFT = "unknown draft"
NOT_A_LINK = "url must be a link"
NOTHING_TO_FETCH = "this draft has no YouTube or SoundCloud link to look up"
ALREADY = "this link is already in your drafts"
NO_PLAYLIST = "this draft did not come from a YouTube playlist"
NOT_IN_LIBRARY = "this draft is not in your library yet"
User = Annotated[dict[str, Any], Depends(deps.require_token)]


def _snapshot(uid: str) -> list[dict[str, Any]]:
    with users.user_lock(uid):
        return drafts.load(deps.drafts_path(uid))


def _library(uid: str) -> drafts.Library:
    return drafts.Library(deps.load_songs(uid))


def _present(uid: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    library = _library(uid)
    return [drafts.public(d, library) for d in items]


def _one(uid: str, item: dict[str, Any]) -> dict[str, Any]:
    return _present(uid, [item])[0]


def _counts(items: list[dict[str, Any]]) -> dict[str, int]:
    return {"total": len(items), "unfetched": sum(1 for d in items if drafts.fetchable(d) and d.get("state") != "fetched")}


def _stored(draft_id: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    found = drafts.find(items, draft_id) if drafts.ID_RE.fullmatch(draft_id) else None
    if found is None:
        raise HTTPException(status_code=404, detail=UNKNOWN_DRAFT)
    return found


@router.get("/drafts")
def list_drafts(user: User):
    uid = user["uid"]
    items = _snapshot(uid)
    return {"drafts": _present(uid, items), "counts": _counts(items), "limit": drafts.MAX_DRAFTS}


def _commit_add(uid: str, built: list[dict[str, Any]], texts: list[tuple[str, str]]) -> dict[str, Any]:
    with deps.tx(uid, f"drafts add {len(built)}"):
        items = drafts.load(deps.drafts_path(uid))
        result = drafts.insert(items, built, texts)
        drafts.save(deps.drafts_path(uid), items)
        return {**result, "total": len(items)}


@router.post("/drafts", responses=deps.responses(422, 429))
async def add_drafts(req: DraftLinesRequest, user: User):
    uid, owner = user["uid"], user["owner"]
    items = await run_in_threadpool(_snapshot, uid)
    origins = [o.model_dump() if o else None for o in req.origins] if req.origins is not None else None
    plan = drafts.plan_lines(req.lines, items, origins)
    room = max(0, drafts.MAX_DRAFTS - len(items))
    built = [drafts.build(text, url, origin) for (text, url), origin in list(zip(plan["lines"], plan["origins"]))[:room]]
    owned = await run_in_threadpool(_library, uid) if any(d.get("playlist") for d in built) else None
    todo = [d for d in built if drafts.fetchable(d) and not (owned and d.get("playlist") and owned.owns_link(d))]
    todo_ids = {d["id"] for d in todo}
    wait_s = drafts.charge_fetches(uid, owner, len(todo))
    results, blocked, errors = ({}, False, {}) if wait_s or not todo else await run_in_threadpool(drafts.fetch_many, todo)
    for draft in built:
        if draft["id"] in results:
            drafts.apply_fetch(draft, results[draft["id"]])
    texts = [(match["id"], text) for match, text in plan["updates"]]
    done = await run_in_threadpool(_commit_add, uid, built, texts)
    shown = await run_in_threadpool(_present, uid, [*done["created"], *done["updated"]])
    created = shown[: len(done["created"])]
    counts = {
        **plan["counts"],
        "created": len(created),
        "updated": len(done["updated"]),
        "duplicates": plan["counts"]["duplicates"] + done["duplicates"],
        "overCap": done["overCap"] + max(0, len(plan["lines"]) - room),
        "unfetched": sum(1 for d in done["created"] if d["id"] in todo_ids and d["state"] != "fetched"),
        "total": done["total"],
        "rateLimited": bool(blocked or wait_s),
        "retryAfterMinutes": max(1, int(-(-wait_s // 60))) if wait_s else None,
        "fetchErrors": len(errors),
    }
    return {"created": created, "updated": shown[len(created):], "counts": counts}


def _read_url(raw: str) -> str:
    text = " ".join(raw.split())
    if not text:
        return ""
    found, url = drafts.line_parts(text)
    if not url or found:
        raise HTTPException(status_code=422, detail=NOT_A_LINK)
    return url


@router.patch("/drafts/{draft_id}", responses=deps.responses(404, 409, 422, 429))
async def patch_draft(draft_id: str, req: DraftPatchRequest, user: User):
    uid, owner = user["uid"], user["owner"]
    items = await run_in_threadpool(_snapshot, uid)
    before = _stored(draft_id, items)
    text = " ".join(req.text.split()) if req.text is not None else before.get("text", "")
    url = _read_url(req.url) if req.url is not None else before.get("url", "")
    if not text and not url:
        raise HTTPException(status_code=422, detail="a draft needs a text or a link")
    if url != before.get("url") and any(d.get("url") == url for d in items):
        raise HTTPException(status_code=409, detail=ALREADY)
    probe = {**before, "url": url, "source": drafts.source_of(url)}
    look = url != before.get("url") and drafts.fetchable(probe) and not drafts.charge_fetches(uid, owner, 1)
    results, _, _ = await run_in_threadpool(drafts.fetch_many, [{**probe, "id": draft_id}]) if look else ({}, False, {})

    def commit() -> dict[str, Any]:
        with deps.tx(uid, "drafts edit"):
            stored = drafts.load(deps.drafts_path(uid))
            found = _stored(draft_id, stored)
            drafts.edit(found, text, url, results.get(draft_id), draft_id in results)
            drafts.save(deps.drafts_path(uid), stored)
            return _one(uid, found)

    return await run_in_threadpool(commit)


@router.post("/drafts/{draft_id}/refresh", responses=deps.responses(404, 422, 429))
async def refresh_draft(draft_id: str, user: User):
    uid, owner = user["uid"], user["owner"]
    items = await run_in_threadpool(_snapshot, uid)
    before = _stored(draft_id, items)
    if not drafts.fetchable(before):
        raise HTTPException(status_code=422, detail=NOTHING_TO_FETCH)
    wait_s = drafts.charge_fetches(uid, owner, 1)
    if wait_s:
        raise drafts.refusal(wait_s)
    results, limited, errors = await run_in_threadpool(drafts.fetch_many, [before])

    def commit() -> dict[str, Any]:
        with deps.tx(uid, "drafts refresh"):
            stored = drafts.load(deps.drafts_path(uid))
            found = _stored(draft_id, stored)
            if draft_id in results:
                drafts.apply_fetch(found, results[draft_id])
                drafts.save(deps.drafts_path(uid), stored)
            return _one(uid, found)

    draft = await run_in_threadpool(commit)
    return {"draft": draft, "fetched": draft["state"] == "fetched" and draft_id in results, "rateLimited": limited, "error": errors.get(draft_id)}


@router.post("/drafts/{draft_id}/playlist", responses=deps.responses(404, 422))
def draft_playlist(draft_id: str, req: DraftPlaylistRequest, user: User):
    uid, owner = user["uid"], user["owner"]
    with deps.tx(uid, "drafts playlist"):
        items = drafts.load(deps.drafts_path(uid))
        found = _stored(draft_id, items)
        origin = drafts.origin_of(found)
        if origin is None:
            raise HTTPException(status_code=422, detail=NO_PLAYLIST)
        songs = deps.load_songs(uid)
        known = {s["id"] for s in songs}
        library = drafts.Library(songs)
        own = req.song_id if req.song_id is not None else library.song_id(found)
        if own is None or own not in known:
            raise HTTPException(status_code=422, detail=NOT_IN_LIBRARY)
        picks = {own: origin["position"]}
        swept: set[str] = set()
        for other in items:
            sibling = drafts.origin_of(other)
            if other is not found and sibling and sibling["id"] == origin["id"]:
                sid = library.song_id(other)
                if sid:
                    picks.setdefault(sid, sibling["position"])
                    swept.add(other["id"])
        stored = playlists.load(deps.playlists_path(uid))
        item, created, added, skipped = playlists.upsert_source(
            stored, owner, source_id=origin["id"], url=urlclean.playlist_url(origin["id"]), title=origin["title"], picks=list(picks.items()), known=known)
        playlists.save(deps.playlists_path(uid), stored)
        if swept:
            drafts.save(deps.drafts_path(uid), [d for d in items if d["id"] not in swept])
        return {"playlist": {"id": item["id"], "name": item["name"], "count": len(item["songs"])}, "created": created, "added": added, "skipped": len(skipped), "dropped": sorted(swept)}


@router.delete("/drafts/{draft_id}", status_code=204, responses=deps.responses(404))
def delete_draft(draft_id: str, user: User):
    uid = user["uid"]
    with deps.tx(uid, "drafts delete"):
        items = drafts.load(deps.drafts_path(uid))
        found = _stored(draft_id, items)
        drafts.save(deps.drafts_path(uid), [d for d in items if d is not found])


@router.delete("/drafts", status_code=204)
def clear_drafts(user: User):
    uid = user["uid"]
    with deps.tx(uid, "drafts clear"):
        if drafts.load(deps.drafts_path(uid)):
            drafts.save(deps.drafts_path(uid), [])
