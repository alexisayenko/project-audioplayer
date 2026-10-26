import json
from pathlib import Path

import pytest

from app import deps, drafts, extractor, previewcache
from tests.test_guest import web
from tests.test_library import H, OWNER_UID, VID, VID2, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who  # noqa: F401

CASES = json.loads((Path(__file__).parent / "fixtures" / "draft_lines.json").read_text(encoding="utf-8"))
V1, V2, V3 = "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"
YT = "https://www.youtube.com/watch?v={}"


def info(title, channel="Chan", duration=200, date="20190305", **extra):
    return {"title": title, "uploader": channel, "channel": channel, "duration": duration, "upload_date": date, **extra}


@pytest.fixture
def fake(monkeypatch, client):
    state = {"infos": {}, "calls": [], "errors": {}}

    def preview(vid):
        state["calls"].append(vid)
        if vid in state["errors"]:
            raise state["errors"][vid]
        return extractor.meta_from_info(vid, state["infos"].get(vid) or info(f"Video {vid}"))

    monkeypatch.setattr(extractor, "preview", preview)
    monkeypatch.setattr(drafts, "FETCH_DELAY_S", (0, 0))
    drafts.reset_limits()
    return state


def paste(client, *lines, headers=H):
    return client.post("/drafts", json={"lines": list(lines)}, headers=headers)


def listed(client, headers=H):
    return client.get("/drafts", headers=headers).json()


def stored(tmp_path, uid=OWNER_UID):
    return json.loads((tmp_path / "users" / uid / "drafts.json").read_text(encoding="utf-8"))["drafts"]


@pytest.mark.parametrize("case", CASES, ids=[c["line"] for c in CASES])
def test_a_line_is_split_into_text_and_a_cleaned_link(case):
    text, url = drafts.line_parts(case["line"])
    assert (text, url, drafts.source_of(url)) == (case["text"], case["url"], case["source"])


def test_split_input_trims_drops_empty_lines_and_splits_multi_line_items():
    assert drafts.split_input(["  a  \n\n b ", "", "   ", "c"]) == ["a", "b", "c"]


def test_mixed_lines_become_drafts_with_parsed_credits_in_paste_order(client, fake, tmp_path):
    fake["infos"][V1] = info("Sunny Day", channel="Chan", duration=215, thumbnail=None)
    body = paste(
        client,
        "Daft Punk - Around the World",
        "",
        f"  Foo vs Bar - Song (feat. Baz) (Qux Remix)  {YT.format(V2)}",
        YT.format(V1),
        "https://example.com/page?utm_source=x",
        "just a title",
    ).json()
    c = body["counts"]
    assert (c["lines"], c["created"], c["updated"], c["duplicates"], c["total"], c["rateLimited"]) == (5, 5, 0, 0, 5, False)
    rows = body["created"]
    assert [r["text"] for r in rows] == ["Daft Punk - Around the World", "Foo vs Bar - Song (feat. Baz) (Qux Remix)", "", "", "just a title"]
    first, typed, url_only, link, bare = rows
    assert (first["title"], first["mainArtists"], first["state"], first["source"], first["url"]) == ("Around the World", ["Daft Punk"], "new", None, "")
    assert (typed["title"], typed["mainArtists"], typed["featuredArtists"], typed["version"]["type"], typed["version"]["artists"]) == ("Song", ["Foo", "Bar"], ["Baz"], "remix", ["Qux"])
    assert (typed["state"], typed["source"], typed["year"], typed["duration"]) == ("fetched", "youtube", 2019, 200)
    assert (url_only["title"], url_only["mainArtists"], url_only["year"], url_only["duration"], url_only["state"]) == ("Sunny Day", ["Chan"], 2019, 215, "fetched")
    assert url_only["thumbnail"].endswith(f"/{V1}/hqdefault.jpg")
    assert (link["source"], link["url"], link["title"], link["state"]) == ("link", "https://example.com/page", "", "new")
    assert (bare["title"], bare["mainArtists"]) == ("just a title", [])
    assert set(first) == {"id", "text", "url", "source", "title", "mainArtists", "featuredArtists", "withArtists", "version", "year", "duration", "thumbnail", "state", "inLibrary", "createdAt", "playlist"}
    assert sorted(fake["calls"]) == [V1, V2]


def test_the_list_is_per_user_in_its_own_file_and_never_in_library_json(client, fake, tmp_path):
    paste(client, "A - B")
    assert [d["text"] for d in listed(client)["drafts"]] == ["A - B"]
    assert stored(tmp_path)[0]["text"] == "A - B"
    assert not (tmp_path / "users" / OWNER_UID / "library.json").exists()
    assert deps.drafts_path(OWNER_UID) == tmp_path / "users" / OWNER_UID / "drafts.json"
    assert client.get("/library", headers=H).json()["songs"] == []
    assert "A - B" not in client.get("/library", headers=H).text


def test_every_user_has_their_own_drafts(multi, fake):
    a, b = who(multi, ALICE), who(multi, BOB)
    created = paste(multi, "A - B", headers=a).json()["created"][0]
    assert listed(multi, b)["drafts"] == []
    assert listed(multi, H)["drafts"] == []
    assert multi.delete(f"/drafts/{created['id']}", headers=b).status_code == 404
    assert multi.patch(f"/drafts/{created['id']}", json={"text": "x"}, headers=b).status_code == 404
    assert multi.post(f"/drafts/{created['id']}/refresh", headers=b).status_code == 404
    assert multi.delete("/drafts", headers=b).status_code == 204
    assert [d["id"] for d in listed(multi, a)["drafts"]] == [created["id"]]


def test_nobody_without_credentials_and_no_public_viewer_reaches_the_drafts(client, fake, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    paste(client, "A - B")
    deps.save_songs(OWNER_UID, [])
    anon = web()
    for method, path, kw in (("get", "/drafts", {}), ("post", "/drafts", {"json": {"lines": ["x"]}}), ("delete", "/drafts", {}), ("delete", "/drafts/d_000000000000", {}),
                             ("patch", "/drafts/d_000000000000", {"json": {"text": "x"}}), ("post", "/drafts/d_000000000000/refresh", {})):
        assert getattr(anon, method)(path, **kw).status_code == 401, (method, path)
    assert getattr(client, "get")("/drafts", headers={"X-API-Token": "wrong"}).status_code == 401
    shown = anon.get("/library")
    assert shown.status_code == 200
    assert "A - B" not in shown.text


def test_a_failed_lookup_never_fails_the_paste(client, fake, tmp_path):
    fake["errors"][V1] = RuntimeError("ERROR: [youtube] aaaaaaaaaaa: Video unavailable")
    body = paste(client, YT.format(V1), "A - B " + YT.format(V2)).json()
    assert body["counts"]["created"] == 2
    by_url = {d["url"]: d for d in body["created"]}
    assert by_url[YT.format(V1)]["state"] == "failed"
    assert by_url[YT.format(V2)]["state"] == "fetched"
    assert body["counts"]["unfetched"] == 1
    assert len(stored(tmp_path)) == 2


def test_a_429_stops_fetching_and_keeps_the_rest_unfetched(client, fake, tmp_path, monkeypatch):
    monkeypatch.setattr(drafts, "FETCH_WORKERS", 1)
    fake["errors"][V2] = RuntimeError("HTTP Error 429: Too Many Requests")
    body = paste(client, YT.format(V1), YT.format(V2), YT.format(V3), "plain - text").json()
    states = {d["url"] or d["text"]: d["state"] for d in body["created"]}
    assert states == {YT.format(V1): "fetched", YT.format(V2): "new", YT.format(V3): "new", "plain - text": "new"}
    assert body["counts"]["rateLimited"] is True
    assert body["counts"]["created"] == 4
    assert fake["calls"] == [V1, V2]
    assert len(stored(tmp_path)) == 4


def test_a_bot_check_counts_as_rate_limited(client, fake, monkeypatch):
    monkeypatch.setattr(drafts, "FETCH_WORKERS", 1)
    fake["errors"][V1] = RuntimeError("ERROR: Sign in to confirm you're not a bot")
    body = paste(client, YT.format(V1), YT.format(V2)).json()
    assert body["counts"]["rateLimited"] is True
    assert [d["state"] for d in body["created"]] == ["new", "new"]


def test_at_most_two_lookups_run_at_once(client, fake, monkeypatch):
    import threading

    lock = threading.Lock()
    now = {"n": 0, "max": 0}
    original = extractor.preview

    def slow(vid):
        with lock:
            now["n"] += 1
            now["max"] = max(now["max"], now["n"])
        threading.Event().wait(0.03)
        try:
            return original(vid)
        finally:
            with lock:
                now["n"] -= 1

    monkeypatch.setattr(extractor, "preview", slow)
    ids = [f"{chr(97 + i)}{'x' * 10}" for i in range(6)]
    body = paste(client, *[YT.format(i) for i in ids]).json()
    assert body["counts"]["created"] == 6
    assert now["max"] == 2


def test_the_hourly_lookup_budget_saves_the_drafts_unfetched(client, fake, monkeypatch, multi):
    monkeypatch.setenv("DRAFT_FETCHES_PER_HOUR", "2")
    a = who(multi, ALICE)
    body = paste(multi, YT.format(V1), YT.format(V2), YT.format(V3), headers=a).json()
    assert body["counts"]["created"] == 3
    assert body["counts"]["rateLimited"] is True
    assert body["counts"]["retryAfterMinutes"] >= 1
    assert [d["state"] for d in body["created"]] == ["new"] * 3
    assert fake["calls"] == []
    first, second, third = (d["id"] for d in body["created"])
    assert multi.post(f"/drafts/{first}/refresh", headers=a).json()["fetched"] is True
    assert multi.post(f"/drafts/{second}/refresh", headers=a).json()["fetched"] is True
    refused = multi.post(f"/drafts/{third}/refresh", headers=a)
    assert refused.status_code == 429
    assert refused.json()["error"] == "draft_limit"
    assert paste(client, YT.format(V1), YT.format(V2), YT.format(V3)).json()["counts"]["rateLimited"] is False


def test_caps_on_lines_line_length_and_drafts(client, fake, tmp_path, monkeypatch):
    long_line = "x" * 301
    body = paste(client, long_line, "y" * 300).json()
    assert (body["counts"]["tooLong"], body["counts"]["created"]) == (1, 1)
    lines = [f"Artist - Song {i}" for i in range(130)]
    body = paste(client, *lines).json()
    assert (body["counts"]["lines"], body["counts"]["overLineCap"], body["counts"]["created"], body["counts"]["total"]) == (130, 30, 100, 101)
    monkeypatch.setattr(drafts, "MAX_DRAFTS", 105)
    body = paste(client, *[f"New - Song {i}" for i in range(10)]).json()
    assert (body["counts"]["created"], body["counts"]["overCap"], body["counts"]["total"]) == (4, 6, 105)
    assert len(stored(tmp_path)) == 105
    assert listed(client)["limit"] == 105


def test_a_oversized_paste_item_is_a_422(client, fake):
    assert paste(client, "x" * 100_001).status_code == 422
    assert client.post("/drafts", json={"lines": ["a"] * 1001}, headers=H).status_code == 422
    assert client.post("/drafts", json={}, headers=H).status_code == 422


def test_duplicates_are_dropped_within_a_paste_and_across_pastes(client, fake, tmp_path):
    first = paste(client, "A - B", "a  -  b", YT.format(V1), f"https://youtu.be/{V1}?si=1", "Other - Song").json()
    assert (first["counts"]["created"], first["counts"]["duplicates"]) == (3, 2)
    again = paste(client, "A - B", f"{YT.format(V1)}", "A - B " + YT.format(V2)).json()
    assert (again["counts"]["created"], again["counts"]["duplicates"]) == (1, 2)
    assert len(stored(tmp_path)) == 4


def test_a_known_link_with_new_text_gives_the_text_to_the_draft(client, fake):
    created = paste(client, YT.format(V1)).json()["created"][0]
    assert created["text"] == ""
    body = paste(client, f"Foo - Bar {YT.format(V1)}").json()
    assert (body["counts"]["created"], body["counts"]["updated"], body["counts"]["duplicates"]) == (0, 1, 0)
    row = body["updated"][0]
    assert (row["id"], row["text"], row["title"], row["mainArtists"]) == (created["id"], "Foo - Bar", "Bar", ["Foo"])
    assert (row["year"], row["state"]) == (2019, "fetched")


def test_only_youtube_and_soundcloud_links_are_looked_up(client, fake, monkeypatch):
    seen = []
    monkeypatch.setattr(extractor, "soundcloud_probe", lambda url: seen.append(url) or {
        "id": "soundcloud-1", "source_url": url, "source": "soundcloud", "title": "Track", "artist": "Dj", "mainArtists": ["Dj"], "featuredArtists": [], "withArtists": [],
        "remixer": None, "published_year": 2020, "tags": [], "duration": 99, "thumbnail": "https://i1.sndcdn.com/a.jpg", "preview_only": False})
    body = paste(client, "https://soundcloud.com/dj/track", "Song - Name https://example.com/a", "https://vimeo.com/1").json()
    rows = {d["source"]: d for d in body["created"]}
    assert seen == ["https://soundcloud.com/dj/track"]
    assert (rows["soundcloud"]["title"], rows["soundcloud"]["mainArtists"], rows["soundcloud"]["year"], rows["soundcloud"]["state"]) == ("Track", ["Dj"], 2020, "fetched")
    assert rows["link"]["state"] == "new"
    assert fake["calls"] == []


def test_a_preview_only_soundcloud_track_is_a_failed_lookup(client, fake, monkeypatch):
    monkeypatch.setattr(extractor, "soundcloud_probe", lambda url: {"id": "soundcloud-1", "source_url": url, "preview_only": True})
    body = paste(client, "Foo - Bar https://soundcloud.com/dj/track").json()
    assert body["created"][0]["state"] == "failed"
    assert body["created"][0]["title"] == "Bar"


def test_a_draft_already_in_the_library_is_marked(client, fake):
    deps.save_songs(OWNER_UID, [
        {"id": VID, "title": "Known Song", "mainArtists": ["Known Artist"], "file": None},
        {"id": VID2, "title": "Other", "mainArtists": ["Someone"], "file": None, "sources": [{"platform": "youtube", "url": YT.format(V3)}]},
    ])
    body = paste(client, YT.format(VID), "known  artist - KNOWN song", "Nobody - Known Song", YT.format(V3), YT.format(V1)).json()
    marks = [d["inLibrary"] for d in body["created"]]
    assert marks == [True, True, False, True, False]
    deps.save_songs(OWNER_UID, [])
    assert [d["inLibrary"] for d in listed(client)["drafts"]] == [False] * 5


def test_patch_reparses_the_text_and_keeps_the_lookup(client, fake):
    created = paste(client, YT.format(V1)).json()["created"][0]
    assert created["title"] == f"Video {V1}"
    edited = client.patch(f"/drafts/{created['id']}", json={"text": "Real Artist - Real Title (feat. Guest)"}, headers=H).json()
    assert (edited["title"], edited["mainArtists"], edited["featuredArtists"], edited["year"], edited["state"]) == ("Real Title", ["Real Artist"], ["Guest"], 2019, "fetched")
    assert fake["calls"] == [V1]
    cleared = client.patch(f"/drafts/{created['id']}", json={"text": ""}, headers=H).json()
    assert (cleared["text"], cleared["title"]) == ("", f"Video {V1}")


def test_patching_the_link_looks_the_new_one_up_and_drops_the_old_lookup(client, fake):
    created = paste(client, f"A - B {YT.format(V1)}").json()["created"][0]
    moved = client.patch(f"/drafts/{created['id']}", json={"url": f"https://youtu.be/{V2}?si=z"}, headers=H).json()
    assert (moved["url"], moved["state"], moved["text"], moved["title"]) == (YT.format(V2), "fetched", "A - B", "B")
    assert fake["calls"] == [V1, V2]
    plain = client.patch(f"/drafts/{created['id']}", json={"url": "https://example.com/x"}, headers=H).json()
    assert (plain["source"], plain["state"], plain["year"], plain["thumbnail"]) == ("link", "new", None, None)
    gone = client.patch(f"/drafts/{created['id']}", json={"url": ""}, headers=H).json()
    assert (gone["url"], gone["source"]) == ("", None)


def test_patch_refusals(client, fake):
    one = paste(client, f"A - B {YT.format(V1)}").json()["created"][0]
    two = paste(client, "C - D").json()["created"][0]
    path = f"/drafts/{two['id']}"
    assert client.patch(path, json={"url": YT.format(V1)}, headers=H).status_code == 409
    assert client.patch(path, json={"url": "not a link"}, headers=H).status_code == 422
    assert client.patch(path, json={"url": "Artist - x https://example.com"}, headers=H).status_code == 422
    assert client.patch(path, json={"text": ""}, headers=H).status_code == 422
    assert client.patch(path, json={"text": "x" * 301}, headers=H).status_code == 422
    assert client.patch("/drafts/d_ffffffffffff", json={"text": "x"}, headers=H).status_code == 404
    assert client.patch("/drafts/nope", json={"text": "x"}, headers=H).status_code == 404
    assert client.patch(f"/drafts/{one['id']}", json={}, headers=H).json()["text"] == "A - B"


def test_refresh_fetches_again(client, fake, monkeypatch):
    monkeypatch.setattr(drafts, "FETCH_WORKERS", 1)
    fake["errors"][V1] = RuntimeError("ERROR: [youtube] x: Video unavailable")
    created = paste(client, YT.format(V1), "plain - text").json()["created"]
    row, text_only = created[0], created[1]
    assert row["state"] == "failed"
    failed = client.post(f"/drafts/{row['id']}/refresh", headers=H).json()
    assert failed["draft"]["state"] == "failed"
    assert (failed["fetched"], failed["rateLimited"]) == (False, False)
    assert "Video unavailable" in failed["error"]
    del fake["errors"][V1]
    fake["infos"][V1] = info("Fresh Title", channel="Fresh Band")
    ok = client.post(f"/drafts/{row['id']}/refresh", headers=H).json()
    assert (ok["fetched"], ok["error"], ok["draft"]["state"], ok["draft"]["title"], ok["draft"]["mainArtists"]) == (True, None, "fetched", "Fresh Title", ["Fresh Band"])
    previewcache.clear()
    fake["errors"][V1] = RuntimeError("HTTP Error 429: Too Many Requests")
    limited = client.post(f"/drafts/{row['id']}/refresh", headers=H).json()
    assert (limited["rateLimited"], limited["fetched"], limited["draft"]["state"]) == (True, False, "fetched")
    assert client.post(f"/drafts/{text_only['id']}/refresh", headers=H).status_code == 422
    assert client.post("/drafts/d_ffffffffffff/refresh", headers=H).status_code == 404


def test_delete_one_and_clear_all(client, fake, tmp_path):
    rows = paste(client, "A - B", "C - D", "E - F").json()["created"]
    assert client.delete(f"/drafts/{rows[1]['id']}", headers=H).status_code == 204
    assert [d["text"] for d in listed(client)["drafts"]] == ["A - B", "E - F"]
    assert client.delete(f"/drafts/{rows[1]['id']}", headers=H).status_code == 404
    assert client.delete("/drafts", headers=H).status_code == 204
    assert listed(client) == {"drafts": [], "counts": {"total": 0, "unfetched": 0}, "limit": 500}
    assert stored(tmp_path) == []
    assert client.delete("/drafts", headers=H).status_code == 204


def test_new_pastes_go_first_and_keep_their_own_order(client, fake):
    paste(client, "1 - a", "2 - b")
    paste(client, "3 - c", "4 - d")
    assert [d["text"] for d in listed(client)["drafts"]] == ["3 - c", "4 - d", "1 - a", "2 - b"]


def test_the_song_schema_and_library_routes_are_untouched(client, fake):
    paste(client, "A - B " + YT.format(V1))
    assert client.get("/library", headers=H).json() == {"credits_schema": client.get("/library", headers=H).json()["credits_schema"], "songs": []}
    assert client.get("/catalog", headers=H).json()["total"] == 0
    assert client.get("/tags", headers=H).json() == []


def test_a_malformed_drafts_file_keeps_its_good_rows(client, fake, tmp_path):
    path = tmp_path / "users" / OWNER_UID / "drafts.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"drafts": [{"id": "d_000000000000", "text": "A - B", "url": "", "source": None, "state": "weird"}, "junk", {"no": "id"}]}), encoding="utf-8")
    rows = listed(client)["drafts"]
    assert [(r["id"], r["state"], r["mainArtists"], r["inLibrary"]) for r in rows] == [("d_000000000000", "new", [], False)]
    assert paste(client, "C - D").json()["counts"]["total"] == 2


def test_the_sync_checks_an_incoming_drafts_file():
    from app import gitstore

    assert gitstore.check_inbound_json("audioplayer/users/x/drafts.json", json.dumps({"drafts": []})) is None
    assert gitstore.check_inbound_json("audioplayer/users/x/drafts.json", json.dumps({"drafts": {}})) == "not a draft list"
    assert gitstore.check_inbound_json("audioplayer/users/x/drafts.json", "[]") == "not an object"
    assert gitstore.check_inbound_json("audioplayer/users/x/drafts.json", "nope") == "not valid JSON"
    assert "drafts.json" in gitstore.WATCHED_JSON
