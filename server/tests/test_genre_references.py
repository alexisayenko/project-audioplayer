import json

import pytest

from app import genre_references as refs
from tests.test_library import H, ODIR, VID, VID2, client  # noqa: F401
from tests.test_users import ALICE, key, multi, who  # noqa: F401


def song(sid, title="Insomnia", artist="Faithless", year=1995, **extra):
    return {"id": sid, "title": title, "mainArtists": [artist], "featuredArtists": [], "releaseYear": year, "updated_at": "2026-02-02T00:00:00Z", **extra}


def write_owner_library(tmp_path, songs):
    path = ODIR(tmp_path) / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"settings": {}, "songs": songs}), encoding="utf-8")


@pytest.fixture
def owned(client, tmp_path):
    write_owner_library(tmp_path, [song(VID), song(VID2, "Strobe", "deadmau5", 2009)])
    return client


def post(client, genre, body, headers=H):
    return client.post(f"/genres/{genre}/references", json=body, headers=headers)


def test_manual_entry_roundtrip_and_read_shape(owned):
    r = post(owned, "trance", {"artist": "  Robert  Miles ", "title": "Children", "year": 1995, "role": "origin", "note": "the dream trance blueprint"})
    assert r.status_code == 201
    entry = r.json()
    assert len(entry["id"]) == 8 and entry["artist"] == "Robert Miles" and entry["reviewed"] is True
    assert entry["in_library"] is False and "song" not in entry and entry["sources"] == [] and entry["source_count"] == 0
    got = owned.get("/genres/trance/references", headers=H).json()
    assert got["genre"] == "trance" and [e["id"] for e in got["references"]] == [entry["id"]]


def test_from_library_song_takes_artist_title_year_and_resolves_in_library(owned):
    r = post(owned, "progressive house", {"song_id": VID, "role": "archetype"})
    assert r.status_code == 201
    entry = r.json()
    assert (entry["artist"], entry["title"], entry["year"], entry["song_id"]) == ("Faithless", "Insomnia", 1995, VID)
    assert entry["in_library"] is True and entry["song"]["id"] == VID and entry["song"]["title"] == "Insomnia"
    assert set(entry["song"]) >= {"artist", "cover", "audio_state"}


def test_synonym_and_case_resolve_to_the_canonical_genre(owned):
    r = post(owned, "Ambient%20Techno%20Music", {"artist": "A", "title": "B", "role": "landmark"})
    assert r.status_code == 201
    assert owned.get("/genres/ambient techno/references", headers=H).json()["genre"] == "ambient techno"


def test_validation(owned):
    ok = {"artist": "A", "title": "B", "role": "origin"}
    assert post(owned, "no-such-genre-xyz", ok).status_code == 404
    assert post(owned, "trance", {**ok, "role": "classic"}).json()["error"] == "bad_role"
    assert post(owned, "trance", {"title": "B", "role": "origin"}).status_code == 422
    assert post(owned, "trance", {**ok, "title": "x" * 201}).status_code == 422
    assert post(owned, "trance", {**ok, "note": "x" * 1001}).status_code == 422
    assert post(owned, "trance", {**ok, "year": 1700}).status_code == 422
    assert post(owned, "trance", {**ok, "song_id": "zzzzzzzzzzz"}).json()["error"] == "unknown_song"
    assert post(owned, "trance", {**ok, "source_url": "javascript:alert(1)"}).status_code == 422
    assert post(owned, "trance", {**ok, "sources": [{"type": "blog", "url": "https://x.example/"}]}).json()["error"] == "bad_sources"
    assert post(owned, "trance", {**ok, "sources": [{"type": "rym", "url": "ftp://x.example/"}]}).status_code == 422
    assert post(owned, "trance", {**ok, "sources": [{"type": "rym", "url": "https://x.example/", "note": "n" * 201}]}).status_code == 422
    assert post(owned, "trance", {**ok, "sources": [{"type": "other", "url": f"https://x.example/{i}"} for i in range(9)]}).status_code == 422


def test_sources_replace_whole_list_dedupe_urls_and_count(owned):
    sources = [{"type": "wikipedia", "url": "https://en.wikipedia.org/wiki/X"}, {"type": "rym", "url": "https://rateyourmusic.com/x", "note": "key release"}, {"type": "chart", "url": "https://en.wikipedia.org/wiki/X"}]
    entry = post(owned, "trance", {"artist": "A", "title": "B", "role": "origin", "sources": sources}).json()
    assert [s["type"] for s in entry["sources"]] == ["wikipedia", "rym"] and entry["source_count"] == 2
    patched = owned.patch(f"/genres/trance/references/{entry['id']}", json={"sources": [{"type": "discogs", "url": "https://discogs.com/y"}]}, headers=H).json()
    assert patched["sources"] == [{"type": "discogs", "url": "https://discogs.com/y"}] and patched["source_count"] == 1
    cleared = owned.patch(f"/genres/trance/references/{entry['id']}", json={"sources": []}, headers=H).json()
    assert cleared["sources"] == [] and cleared["source_count"] == 0


def test_legacy_source_url_input_becomes_an_other_source_and_old_files_are_read(owned):
    entry = post(owned, "trance", {"artist": "A", "title": "B", "role": "origin", "source_url": "https://example.com/a"}).json()
    assert entry["sources"] == [{"type": "other", "url": "https://example.com/a"}] and "source_url" not in entry
    refs.path().write_text(json.dumps({"trance": [{"id": "old1", "artist": "X", "title": "Y", "role": "origin", "source_url": "https://example.com/old", "reviewed": True}]}), encoding="utf-8")
    old = owned.get("/genres/trance/references", headers=H).json()["references"][0]
    assert old["sources"] == [{"type": "other", "url": "https://example.com/old"}] and old["source_count"] == 1 and "source_url" not in old


def test_dedupe_per_genre_by_normalised_artist_and_title_but_not_across_genres(owned):
    assert post(owned, "trance", {"artist": "Robert Miles", "title": "Children", "role": "origin"}).status_code == 201
    dup = post(owned, "trance", {"artist": "robert  MILES", "title": "children!", "role": "landmark"})
    assert dup.status_code == 409 and dup.json()["error"] == "reference_exists"
    assert post(owned, "dream trance", {"artist": "Robert Miles", "title": "Children", "role": "archetype"}).status_code == 201


def test_patch_and_delete(owned):
    entry = post(owned, "trance", {"artist": "A", "title": "B", "role": "origin", "year": 1999, "note": "n"}).json()
    url = f"/genres/trance/references/{entry['id']}"
    patched = owned.patch(url, json={"role": "landmark", "note": None, "year": None, "reviewed": False}, headers=H).json()
    assert patched["role"] == "landmark" and "note" not in patched and "year" not in patched and patched["reviewed"] is False
    assert owned.patch(url, json={"role": "nope"}, headers=H).status_code == 422
    assert owned.patch(url, json={"title": "C"}, headers=H).status_code == 422
    assert owned.patch("/genres/trance/references/ffffffff", json={"role": "origin"}, headers=H).status_code == 404
    assert owned.delete(url, headers=H).status_code == 204
    assert owned.delete(url, headers=H).status_code == 404
    assert owned.get("/genres/trance/references", headers=H).json()["references"] == []


def test_all_and_by_song(owned):
    post(owned, "progressive house", {"song_id": VID, "role": "archetype"})
    post(owned, "trance", {"song_id": VID, "role": "landmark"})
    post(owned, "trance", {"artist": "A", "title": "B", "role": "origin"})
    data = owned.get("/genres/references", headers=H).json()
    assert set(data["references"]) == {"progressive house", "trance"} and len(data["references"]["trance"]) == 2
    assert {"id", "artist", "title", "role", "reviewed", "source_count"} <= set(data["references"]["trance"][0])
    assert data["by_song"] == {VID: [{"genre": "progressive house", "role": "archetype"}, {"genre": "trance", "role": "landmark"}]}


def test_missing_file_is_an_empty_catalogue_and_a_corrupt_one_too(owned):
    assert owned.get("/genres/references", headers=H).json() == {"references": {}, "by_song": {}}
    refs.path().parent.mkdir(parents=True, exist_ok=True)
    refs.path().write_text("not json", encoding="utf-8")
    assert owned.get("/genres/trance/references", headers=H).json()["references"] == []


def test_stored_under_the_data_root_with_stable_ids(owned, tmp_path):
    entry = post(owned, "trance", {"artist": "A", "title": "B", "role": "origin"}).json()
    stored = json.loads((tmp_path / "genre_references.json").read_text(encoding="utf-8"))
    assert stored["trance"][0]["id"] == entry["id"]
    post(owned, "trance", {"artist": "C", "title": "D", "role": "origin"})
    assert json.loads((tmp_path / "genre_references.json").read_text(encoding="utf-8"))["trance"][0]["id"] == entry["id"]


def test_signed_in_users_read_but_only_the_owner_writes(multi):
    entry = post(multi, "trance", {"artist": "A", "title": "B", "role": "origin"}).json()
    alice = who(multi, ALICE)
    assert multi.get("/genres/trance/references", headers=alice).json()["references"][0]["in_library"] is False
    assert multi.get("/genres/references", headers=alice).status_code == 200
    refused = post(multi, "trance", {"artist": "C", "title": "D", "role": "origin"}, headers=alice)
    assert refused.status_code == 403 and refused.json()["error"] == "owner_only"
    assert multi.patch(f"/genres/trance/references/{entry['id']}", json={"role": "landmark"}, headers=alice).status_code == 403
    assert multi.delete(f"/genres/trance/references/{entry['id']}", headers=alice).status_code == 403


def test_nobody_without_credentials_reads_or_writes(client):
    assert client.get("/genres/references").status_code == 401
    assert client.get("/genres/trance/references").status_code == 401
    assert client.post("/genres/trance/references", json={}).status_code == 401


def test_in_library_follows_the_requesters_own_library(multi, tmp_path):
    write_owner_library(tmp_path, [song(VID)])
    post(multi, "trance", {"song_id": VID, "role": "archetype"})
    assert multi.get("/genres/trance/references", headers=H).json()["references"][0]["in_library"] is True
    assert multi.get("/genres/trance/references", headers=who(multi, ALICE)).json()["references"][0]["in_library"] is False
