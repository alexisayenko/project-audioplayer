import json

import pytest

from app import genre_eras as eras, migrate_genre_eras_seed as seedmod
from tests.test_genre_references import owned, post  # noqa: F401
from tests.test_library import H, client  # noqa: F401
from tests.test_users import ALICE, key, multi, who  # noqa: F401


def put(client, genre, eras_list, headers=H):
    return client.put(f"/genres/{genre}/eras", json={"eras": eras_list}, headers=headers)


def get(client, genre="trance", headers=H):
    return client.get(f"/genres/{genre}/references", headers=headers).json()


def test_put_creates_ids_sorts_by_start_then_name_and_roundtrips(owned, tmp_path):
    r = put(owned, "trance", [
        {"name": "Late", "start": 2000, "end": None, "note": "n", "sources": [{"type": "rym", "url": "https://x.example/a"}]},
        {"name": "Zed", "start": 1990},
        {"name": "Alpha", "start": 1990, "end": 1995},
        {"name": "Undated"},
    ])
    assert r.status_code == 200
    assert r.json()["genre"] == "trance"
    got = r.json()["eras"]
    assert [e["name"] for e in got] == ["Alpha", "Zed", "Late", "Undated"]
    assert all(len(e["id"]) == 8 for e in got)
    assert len({e["id"] for e in got}) == 4
    assert got[2]["end"] is None
    assert got[2]["sources"] == [{"type": "rym", "url": "https://x.example/a"}]
    assert got[1]["sources"] == []
    assert got[1]["note"] is None
    assert get(owned)["eras"] == got
    stored = json.loads((tmp_path / "genre_eras.json").read_text(encoding="utf-8"))
    assert [e["name"] for e in stored["trance"]] == ["Late", "Zed", "Alpha", "Undated"]


def test_put_keeps_given_ids_and_replaces_the_list(owned):
    first = put(owned, "trance", [{"name": "A", "start": 1990}, {"name": "B", "start": 2000}]).json()["eras"]
    again = put(owned, "trance", [{"id": first[0]["id"], "name": "A renamed", "start": 1991}, {"name": "C"}]).json()["eras"]
    assert again[0]["id"] == first[0]["id"]
    assert again[0]["name"] == "A renamed"
    assert {e["name"] for e in again} == {"A renamed", "C"}
    assert put(owned, "trance", []).json()["eras"] == []
    assert get(owned)["eras"] == []


def test_validation(owned):
    ok = {"name": "A", "start": 1990}
    assert put(owned, "no-such-genre-xyz", [ok]).status_code == 404
    bads = [{"name": ""}, {"start": 1990}, {"name": "x" * 61}, {"name": "A", "start": 1899}, {"name": "A", "end": 2101}, {"name": "A", "start": 1990.5}, {"name": "A", "start": 2000, "end": 1999}, {"name": "A", "note": "x" * 301}, {"name": "A", "id": "nothex!!"}, {"name": "A", "sources": [{"type": "blog", "url": "https://x.example/"}]}, {"name": "A", "sources": [{"type": "other", "url": f"https://x.example/{i}"} for i in range(9)]}]
    for bad in bads:
        assert put(owned, "trance", [bad]).status_code == 422, bad
    assert put(owned, "trance", [{"name": f"E{i}"} for i in range(13)]).json()["error"] == "too_many_eras"
    assert put(owned, "trance", [{"id": "aaaaaaaa", "name": "A"}, {"id": "aaaaaaaa", "name": "B"}]).status_code == 422
    assert owned.put("/genres/trance/eras", json={"nope": []}, headers=H).status_code == 422
    assert put(owned, "trance", [{"name": "ok", "start": 1990, "end": 1990}]).status_code == 200


def test_entry_era_linkage_post_patch_and_unknown_era(owned):
    era = put(owned, "trance", [{"name": "A", "start": 1990}]).json()["eras"][0]["id"]
    body = {"artist": "A", "title": "B", "role": "origin"}
    assert post(owned, "trance", {**body, "era": "ffffffff"}).json()["error"] == "unknown_era"
    entry = post(owned, "trance", {**body, "era": era}).json()
    assert entry["era"] == era
    plain = post(owned, "trance", {"artist": "C", "title": "D", "role": "origin"}).json()
    assert plain["era"] is None
    url = f"/genres/trance/references/{plain['id']}"
    assert owned.patch(url, json={"era": "ffffffff"}, headers=H).json()["error"] == "unknown_era"
    assert owned.patch(url, json={"era": era}, headers=H).json()["era"] == era
    assert owned.patch(url, json={"era": None}, headers=H).json()["era"] is None
    assert owned.patch(url, json={"era": era}, headers=H).status_code == 200
    assert post(owned, "dream trance", {**body, "era": era}).json()["error"] == "unknown_era"
    refs = get(owned)["references"]
    assert {r["id"]: r["era"] for r in refs} == {entry["id"]: era, plain["id"]: era}
    summ = owned.get("/genres/references", headers=H).json()["references"]["trance"]
    assert {r["id"]: r["era"] for r in summ} == {entry["id"]: era, plain["id"]: era}


def test_removing_an_era_clears_it_on_entries_in_the_same_call(owned):
    a, b = [e["id"] for e in put(owned, "trance", [{"name": "A", "start": 1990}, {"name": "B", "start": 2000}]).json()["eras"]]
    e1 = post(owned, "trance", {"artist": "A", "title": "B", "role": "origin", "era": a}).json()
    e2 = post(owned, "trance", {"artist": "C", "title": "D", "role": "origin", "era": b}).json()
    put(owned, "trance", [{"id": b, "name": "B", "start": 2000}])
    assert {r["id"]: r["era"] for r in get(owned)["references"]} == {e1["id"]: None, e2["id"]: b}
    put(owned, "trance", [])
    assert {r["era"] for r in get(owned)["references"]} == {None}


def test_missing_or_corrupt_file_is_empty_and_malformed_eras_are_skipped(owned):
    assert get(owned)["eras"] == []
    eras.path().write_text("not json", encoding="utf-8")
    assert get(owned)["eras"] == []
    eras.path().write_text(json.dumps({"trance": [{"id": "aaaaaaaa", "name": "Ok"}, {"name": "no id"}, "junk"], "x": "y"}), encoding="utf-8")
    assert [e["name"] for e in get(owned)["eras"]] == ["Ok"]


def test_only_the_owner_writes_and_signed_in_users_read(multi):
    assert put(multi, "trance", [{"name": "A", "start": 1990}]).status_code == 200
    alice = who(multi, ALICE)
    refused = put(multi, "trance", [{"name": "B"}], headers=alice)
    assert refused.status_code == 403
    assert refused.json()["error"] == "owner_only"
    assert [e["name"] for e in get(multi, headers=alice)["eras"]] == ["A"]


def test_nobody_without_credentials_writes(client):
    assert client.put("/genres/trance/eras", json={"eras": []}).status_code == 401


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(seedmod.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(seedmod.deps, "SYNC", None)
    return tmp_path


def test_seed_creates_the_goa_and_forest_eras_once(datadir):
    assert seedmod.run() == 8
    doc = json.loads((datadir / "genre_eras.json").read_text(encoding="utf-8"))
    names = [e["name"] for e in doc["goa trance"]]
    assert names == ["Proto-goa", "Origins", "Golden era", "Transition to psytrance", "New school goa"]
    assert "end" not in doc["goa trance"][4]
    assert doc["goa trance"][0]["start"] == 1983
    assert all(len(e["id"]) == 8 and e["sources"] for e in doc["goa trance"])
    forest = doc["forest psytrance"]
    assert [e["name"] for e in forest] == ["Nordic roots", "Tumult and the dark turn", "Swamp psytrance"]
    assert "start" not in forest[2]
    assert "end" not in forest[1]
    assert all(len(e["id"]) == 8 and e["sources"] for e in forest)
    assert seedmod.run() == 0
    assert json.loads((datadir / "genre_eras.json").read_text(encoding="utf-8")) == doc


def test_seed_does_not_overwrite_existing_eras(datadir):
    original = {"goa trance": [{"id": "aaaaaaaa", "name": "Mine"}], "forest psytrance": [{"id": "cccccccc", "name": "Mine too"}], "trance": [{"id": "bbbbbbbb", "name": "T"}]}
    (datadir / "genre_eras.json").write_text(json.dumps(original), encoding="utf-8")
    assert seedmod.run() == 0
    assert json.loads((datadir / "genre_eras.json").read_text(encoding="utf-8")) == original


def test_seed_keeps_other_genres_backs_up_and_a_deleted_set_does_not_return(datadir):
    (datadir / "genre_eras.json").write_text(json.dumps({"trance": [{"id": "bbbbbbbb", "name": "T"}]}), encoding="utf-8")
    assert seedmod.run() == 8
    assert (datadir / "backups-genre-eras-seed" / "genre_eras.json").is_file()
    doc = json.loads((datadir / "genre_eras.json").read_text(encoding="utf-8"))
    assert set(doc) == {"goa trance", "forest psytrance", "trance"}
    del doc["goa trance"]
    del doc["forest psytrance"]
    (datadir / "genre_eras.json").write_text(json.dumps(doc), encoding="utf-8")
    assert seedmod.run() == 0
    assert set(json.loads((datadir / "genre_eras.json").read_text(encoding="utf-8"))) == {"trance"}


def test_seed_after_the_old_marker_adds_only_forest(datadir):
    goa = [{"id": "aaaaaaaa", "name": "Mine"}]
    (datadir / "genre_eras.json").write_text(json.dumps({"goa trance": goa}), encoding="utf-8")
    seedmod.marker_path().parent.mkdir(parents=True)
    seedmod.marker_path().write_text(json.dumps({"marker": 1, "eras": 5}), encoding="utf-8")
    assert seedmod.run() == 3
    doc = json.loads((datadir / "genre_eras.json").read_text(encoding="utf-8"))
    assert doc["goa trance"] == goa
    assert len(doc["forest psytrance"]) == 3
    assert json.loads(seedmod.marker_path().read_text(encoding="utf-8"))["genres"] == ["forest psytrance", "goa trance"]
    assert seedmod.run() == 0


def test_seed_after_the_old_marker_does_not_bring_goa_back(datadir):
    seedmod.marker_path().parent.mkdir(parents=True)
    seedmod.marker_path().write_text(json.dumps({"marker": 1, "eras": 5}), encoding="utf-8")
    assert seedmod.run() == 3
    assert set(json.loads((datadir / "genre_eras.json").read_text(encoding="utf-8"))) == {"forest psytrance"}


def test_seed_disabled_by_env(datadir, monkeypatch):
    monkeypatch.setenv("AUDIO_GENRE_ERAS_SEED", "0")
    assert seedmod.run() == 0
    assert not (datadir / "genre_eras.json").exists()
