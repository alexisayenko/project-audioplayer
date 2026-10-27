import urllib.error

import pytest

from app import album_masters, discogs_lookup
from tests.test_library import H, client  # noqa: F401

MASTER_HIT = {"id": 3001, "type": "master", "title": "Delta Aquarids - Total Eclipse", "year": "1995", "thumb": "https://i.discogs.com/m-thumb.jpg", "style": ["Psy-Trance"], "genre": ["Electronic"]}
MASTER = {"title": "Total Eclipse", "year": 1995, "main_release": 7001, "artists": [{"name": "Delta Aquarids"}], "genres": ["Electronic"], "styles": ["Psy-Trance", "Goa Trance"],
          "images": [{"type": "primary", "uri": "https://i.discogs.com/m-primary.jpg"}], "tracklist": [{"title": f"Track {i}", "duration": "5:00"} for i in range(1, 12)]}
MAIN = {"title": "Total Eclipse", "year": 1996, "formats": [{"name": "CD", "descriptions": ["Album"]}], "tracklist": MASTER["tracklist"][:10], "artists": [{"name": "Delta Aquarids"}]}


def pressing(ident, year, **extra):
    return {"id": ident, "type": "release", "title": "Delta Aquarids - Total Eclipse", "year": str(year), "country": "UK", "format": ["CD", "Album"], "label": ["Blue Room Released"], **extra}


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    album_masters._cache.clear()
    state = {"calls": [], "masters": [MASTER_HIT], "releases": [], "data": {"masters/3001": MASTER, "releases/7001": MAIN}}

    def get(path, params=None):
        state["calls"].append(path if path != "database/search" else f"search:{params['type']}")
        if path == "database/search":
            return {"results": state["masters"] if params["type"] == "master" else state["releases"]}
        if path not in state["data"]:
            raise urllib.error.HTTPError(path, 404, "nf", {}, None)
        return state["data"][path]

    monkeypatch.setattr(discogs_lookup, "_get", get)
    yield state
    album_masters._cache.clear()


def ask(client, **body):
    return client.post("/albums/discogs/search", json={"artist": "Delta Aquarids", "title": "Total Eclipse", **body}, headers=H).json()


def test_one_master_row_replaces_every_pressing(client, fake):
    fake["releases"] = [pressing(i, 1995 + i % 3, master_id=3001) for i in range(7001, 7014)]
    data = ask(client)
    assert data["searchError"] is None
    assert [c["id"] for c in data["candidates"]] == [3001]
    row = data["candidates"][0]
    assert (row["kind"], row["url"], row["year"], row["artist"], row["title"], row["trackCount"], row["mainRelease"]) == ("master", "https://www.discogs.com/master/3001", 1995, "Delta Aquarids", "Total Eclipse", 11, 7001)
    assert row["cover"] == "https://i.discogs.com/m-primary.jpg" and row["genres"] == ["Psy-Trance", "Goa Trance", "Electronic"] and row["type"] is None
    assert fake["calls"] == ["search:master", "masters/3001"]


def test_masters_rank_by_match_and_cap_the_details(client, fake):
    fake["masters"] = [{**MASTER_HIT, "id": 3002, "title": "Delta Aquarids - Total Eclipse Remixes", "year": "1997"}, MASTER_HIT, {**MASTER_HIT, "id": 3003, "title": "Somebody Else - Other"}]
    fake["data"]["masters/3002"] = {**MASTER, "title": "Total Eclipse Remixes", "year": 1997}
    ids = [c["id"] for c in ask(client)["candidates"]]
    assert ids == [3001, 3002]
    assert "masters/3003" not in fake["calls"]


def test_the_year_of_the_request_puts_that_master_first(client, fake):
    fake["masters"] = [MASTER_HIT, {**MASTER_HIT, "id": 3002, "year": "2005"}]
    fake["data"]["masters/3002"] = {**MASTER, "year": 2005}
    assert [c["id"] for c in ask(client, year=2005)["candidates"]] == [3002, 3001]


def test_a_failed_master_detail_keeps_the_row_from_the_search_hit(client, fake):
    del fake["data"]["masters/3001"]
    row = ask(client)["candidates"][0]
    assert (row["id"], row["year"], row["trackCount"], row["cover"], row["mainRelease"], row["genres"]) == (3001, 1995, None, "https://i.discogs.com/m-thumb.jpg", None, ["Psy-Trance", "Electronic"])


def test_without_a_master_the_pressings_collapse_to_the_earliest_richest_release(client, fake):
    fake["masters"] = []
    fake["releases"] = [pressing(9003, 1996, thumb="https://i.discogs.com/a.jpg"), pressing(9002, 1995), pressing(9001, 1995, thumb="https://i.discogs.com/b.jpg", catno="BR 1"), pressing(9004, 2001)]
    for ident in (9001, 9002, 9003, 9004):
        fake["data"][f"releases/{ident}"] = {**MAIN, "year": 1995}
    data = ask(client)
    assert [c["id"] for c in data["candidates"]] == [9001]
    assert data["candidates"][0]["kind"] == "release" and data["candidates"][0]["url"] == "https://www.discogs.com/release/9001"
    assert fake["calls"].count("releases/9001") == 1 and "releases/9003" not in fake["calls"]


def test_releases_of_other_albums_stay_separate_rows(client, fake):
    fake["masters"] = []
    fake["releases"] = [pressing(9001, 1995), {**pressing(9005, 1995), "title": "Delta Aquarids - Total Eclipse (Remixes)"}]
    fake["data"].update({"releases/9001": MAIN, "releases/9005": {**MAIN, "title": "Total Eclipse (Remixes)"}})
    assert sorted(c["id"] for c in ask(client)["candidates"]) == [9001, 9005]


def test_a_weak_master_is_followed_by_the_releases_that_have_no_master(client, fake):
    fake["masters"] = [{**MASTER_HIT, "title": "Delta Aquarids - Zzz"}]
    fake["data"]["masters/3001"] = {**MASTER, "title": "Zzz"}
    fake["releases"] = [pressing(9001, 1995, master_id=3001), pressing(9002, 1995, master_id=0)]
    fake["data"].update({"releases/9001": MAIN, "releases/9002": MAIN})
    assert [c["kind"] for c in ask(client)["candidates"]] == ["master", "release"]
    assert [c["id"] for c in ask(client)["candidates"]] == [3001, 9002]


def test_show_all_lists_every_release_as_before(client, fake):
    fake["releases"] = [pressing(9001, 1995), pressing(9002, 1996), pressing(9003, 1997)]
    for ident in (9001, 9002, 9003):
        fake["data"][f"releases/{ident}"] = MAIN
    data = ask(client, all=True)
    assert sorted(c["id"] for c in data["candidates"]) == [9001, 9002, 9003]
    assert {c["kind"] for c in data["candidates"]} == {"release"}
    assert "search:master" not in fake["calls"]


def test_find_without_a_token_or_on_failure_is_an_empty_list(client, fake, monkeypatch):
    fake["masters"], fake["releases"] = [], []
    assert ask(client) == {"candidates": [], "searchError": None}
    monkeypatch.setattr(discogs_lookup, "_get", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    assert ask(client) == {"candidates": [], "searchError": "discogs_failed"}
    monkeypatch.delenv("DISCOGS_TOKEN")
    assert ask(client) == {"candidates": [], "searchError": "discogs_unavailable"}
    assert album_masters.find("", "") == {"candidates": [], "searchError": "discogs_unavailable"}


def test_a_failed_release_fallback_keeps_the_masters(monkeypatch, fake):
    fake["masters"] = [{**MASTER_HIT, "title": "Delta Aquarids - Zzz"}]
    fake["data"]["masters/3001"] = {**MASTER, "title": "Zzz"}
    real = discogs_lookup._get

    def get(path, params=None):
        if params and params.get("type") == "release":
            raise OSError("down")
        return real(path, params)

    monkeypatch.setattr(discogs_lookup, "_get", get)
    data = album_masters.find("Delta Aquarids", "Total Eclipse")
    assert ([c["id"] for c in data["candidates"]], data["searchError"]) == ([3001], None)


def resolve(client, **body):
    return client.post("/albums/discogs/resolve", json={"kind": "master", "id": 3001, **body}, headers=H)


def test_resolve_reads_the_type_from_the_main_release_and_is_cached(client, fake):
    data = resolve(client).json()
    row = data["candidate"]
    assert (data["searchError"], row["type"], row["year"], row["url"], row["trackCount"], row["cover"]) == (None, "album", 1995, "https://www.discogs.com/master/3001", 11, "https://i.discogs.com/m-primary.jpg")
    first = len(fake["calls"])
    assert first == 2 and resolve(client).json() == data and len(fake["calls"]) == first


def test_rows_carry_the_ids_links_and_styles_the_wizard_needs(client, fake):
    row = ask(client)["candidates"][0]
    assert (row["masterId"], row["releaseId"], row["links"], row["styles"]) == (3001, 7001, {"discogs": "https://www.discogs.com/master/3001"}, ["Psy-Trance", "Goa Trance"])
    fake["masters"] = []
    fake["releases"] = [pressing(9001, 1995, master_id=3999)]
    fake["data"]["releases/9001"] = {**MAIN, "styles": ["Goa Trance"], "master_id": 3999}
    rel = ask(client)["candidates"][0]
    assert (rel["kind"], rel["masterId"], rel["releaseId"], rel["links"], rel["styles"]) == ("release", 3999, 9001, {"discogs": "https://www.discogs.com/release/9001"}, ["Goa Trance"])


def test_resolve_a_master_returns_the_tracklist_with_lengths(client, fake):
    row = resolve(client).json()["candidate"]
    assert len(row["tracks"]) == 11 and row["tracks"][0] == {"no": 1, "title": "Track 1", "durationS": 300} and (row["masterId"], row["releaseId"]) == (3001, 7001)


def test_a_master_without_lengths_takes_the_main_releases_tracklist(client, fake):
    fake["data"]["masters/3001"] = {**MASTER, "tracklist": [{"title": f"Track {i}"} for i in range(1, 11)]}
    tracks = resolve(client).json()["candidate"]["tracks"]
    assert len(tracks) == 10 and all(t["durationS"] == 300 for t in tracks)
    fake["data"]["masters/3001"] = {**MASTER, "tracklist": []}
    fake["data"]["releases/7001"] = {**MAIN, "tracklist": []}
    album_masters._cache.clear()
    assert resolve(client).json()["candidate"]["tracks"] == []


def test_resolve_a_release_reads_its_tracklist_type_and_ids(client, fake):
    fake["data"]["releases/9001"] = {**MAIN, "year": 1996, "country": "UK", "master_id": 3001, "labels": [{"name": "Blue Room Released"}], "styles": ["Psy-Trance"], "genres": ["Electronic"], "images": [{"uri": "https://i.discogs.com/r.jpg"}]}
    data = client.post("/albums/discogs/resolve", json={"kind": "release", "id": 9001}, headers=H).json()
    row = data["candidate"]
    assert data["searchError"] is None and (row["kind"], row["url"], row["masterId"], row["releaseId"], row["type"], row["year"], row["label"], row["country"], row["trackCount"]) == ("release", "https://www.discogs.com/release/9001", 3001, 9001, "album", 1996, "Blue Room Released", "UK", 10)
    assert row["tracks"][0]["durationS"] == 300 and row["cover"] == "https://i.discogs.com/r.jpg" and row["genres"] == ["Psy-Trance", "Electronic"]
    assert fake["calls"] == ["releases/9001"]
    del fake["data"]["releases/9001"]
    album_masters._cache.clear()
    assert client.post("/albums/discogs/resolve", json={"kind": "release", "id": 9001}, headers=H).json() == {"candidate": None, "searchError": "discogs_failed"}


def test_resolve_survives_a_missing_main_release_and_reports_failures(client, fake):
    del fake["data"]["releases/7001"]
    assert resolve(client).json()["candidate"]["type"] is None
    fake["data"].pop("masters/3001")
    album_masters._cache.clear()
    assert resolve(client).json() == {"candidate": None, "searchError": "discogs_failed"}


def test_resolve_refuses_bad_input_and_a_missing_token(client, fake, monkeypatch):
    for body in ({"kind": "label"}, {"id": "3001"}, {"id": True}, {"id": 0}):
        assert resolve(client, **body).status_code == 422
    monkeypatch.delenv("DISCOGS_TOKEN")
    assert resolve(client).json() == {"candidate": None, "searchError": "discogs_unavailable"}


def test_the_cache_is_bounded(fake, monkeypatch):
    monkeypatch.setattr(album_masters, "CACHE_SIZE", 2)
    for i in (1, 2, 3):
        fake["data"][f"masters/{i}"] = MASTER
        album_masters._cached(f"masters/{i}")
    assert list(album_masters._cache) == ["masters/2", "masters/3"]
