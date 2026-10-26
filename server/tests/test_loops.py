import json

import pytest

from app import library, loops
from tests.test_guest import web
from tests.test_ios_contract import check
from tests.test_library import H, ODIR, VID, client  # noqa: F401
from tests.test_users import add


def patch(client, body, vid=VID):
    return client.patch(f"/songs/{vid}", json=body, headers=H)


@pytest.fixture
def song(client):
    assert add(client, H, VID).status_code == 202
    return client


def test_clean_rounds_names_defaults_and_keeps_order():
    out = loops.clean([{"name": " Solo ", "start": 12.3456, "end": 27.35}, {"name": "", "start": 1, "end": 2}])
    assert out == [{"name": "Solo", "start": 12.346, "end": 27.35}, {"name": "Loop 2", "start": 1.0, "end": 2.0}]


@pytest.mark.parametrize("bad", [
    [{"name": "a", "start": 5, "end": 5}],
    [{"name": "a", "start": 5, "end": 4}],
    [{"name": "a", "start": -1, "end": 4}],
    [{"name": "a", "start": 0, "end": 0.05}],
    [{"name": "a", "start": "x", "end": 4}],
    [{"name": "a", "start": True, "end": 4}],
    [{"name": "a", "start": 0, "end": float("inf")}],
    [{"name": "x" * 41, "start": 0, "end": 4}],
    [{"name": "a", "start": 0, "end": 400}],
    ["nope"],
    [{"name": "a"}],
])
def test_clean_rejects(bad):
    with pytest.raises(ValueError):
        loops.clean(bad, duration=200)


def test_limits_and_duration_slack():
    many = [{"name": str(i), "start": i, "end": i + 1} for i in range(loops.MAX_LOOPS)]
    assert len(loops.clean(many)) == 20
    with pytest.raises(ValueError):
        loops.clean(many + [{"name": "21", "start": 30, "end": 31}])
    assert loops.clean([{"name": "end", "start": 190, "end": 200.9}], duration=200)
    with pytest.raises(ValueError):
        loops.clean([{"name": "end", "start": 190, "end": 201.5}], duration=200)
    assert loops.clean(None) == []


def test_tolerant_drops_bad_entries_and_never_raises():
    raw = [{"name": "ok", "start": 1, "end": 2}, {"name": "bad", "start": 3, "end": 3}, 7, None]
    assert loops.tolerant(raw) == [{"name": "ok", "start": 1.0, "end": 2.0}]
    assert loops.tolerant("x") == []
    assert loops.tolerant(None) == []


def test_patch_saves_loops_with_the_song_and_returns_them(song, tmp_path):
    body = {"loops": [{"name": "Solo", "start": 2.5, "end": 5.5}]}
    r = patch(song, body)
    assert r.status_code == 200
    assert r.json()["loops"] == body["loops"]
    stored = json.loads((ODIR(tmp_path) / "library.json").read_text(encoding="utf-8"))
    assert stored["songs"][0]["loops"] == body["loops"]
    assert song.get("/library", headers=H).json()["songs"][0]["loops"] == body["loops"]
    assert song.get("/catalog", headers=H).json()["songs"][0]["loops"] == body["loops"]


def test_an_other_edit_keeps_the_loops_and_an_empty_list_removes_them(song, tmp_path):
    patch(song, {"loops": [{"name": "A", "start": 1, "end": 2}]})
    assert patch(song, {"title": "New"}).json()["loops"][0]["name"] == "A"
    r = patch(song, {"loops": []})
    assert r.status_code == 200
    assert "loops" not in r.json()
    stored = json.loads((ODIR(tmp_path) / "library.json").read_text(encoding="utf-8"))
    assert "loops" not in stored["songs"][0]
    assert "loops" not in patch(song, {"loops": None}).json()


def test_patch_rejects_with_422_and_changes_nothing(song):
    ok = {"loops": [{"name": "A", "start": 1, "end": 2}]}
    assert patch(song, ok).status_code == 200
    bad_lists = (
        [{"name": "A", "start": 3, "end": 2}],
        [{"name": "x" * 41, "start": 1, "end": 2}],
        [{"name": str(i), "start": 1, "end": 2} for i in range(21)],
    )
    for bad in bad_lists:
        assert patch(song, {"loops": bad}).status_code == 422
    assert song.get("/library", headers=H).json()["songs"][0]["loops"] == ok["loops"]


def test_loops_longer_than_the_stored_duration_are_refused(song):
    dur = song.get("/library", headers=H).json()["songs"][0]["duration"]
    assert dur
    assert patch(song, {"loops": [{"name": "A", "start": 0, "end": dur + 5}]}).status_code == 422
    assert patch(song, {"loops": [{"name": "A", "start": 0, "end": dur}]}).status_code == 200


def test_a_caller_without_credentials_cannot_save_and_guests_do_not_see_loops(song, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    assert song.patch(f"/songs/{VID}", json={"loops": []}, headers={"X-API-Token": "wrong"}).status_code in (401, 403)
    patch(song, {"loops": [{"name": "A", "start": 1, "end": 2}]})
    assert "loops" not in web().get("/library").json()["songs"][0]


def test_the_normalizer_drops_garbage_from_a_file():
    s = library.normalize_song({"id": VID, "title": "t", "loops": [{"name": "ok", "start": 1, "end": 2}, {"start": 5, "end": 1}]})
    assert s["loops"] == [{"name": "ok", "start": 1.0, "end": 2.0}]
    assert "loops" not in library.normalize_song({"id": VID, "title": "t", "loops": "junk"})


def test_a_song_with_loops_still_decodes_for_ios(song):
    patch(song, {"loops": [{"name": "Solo", "start": 2.5, "end": 5.5}]})
    for route in ("/library", "/catalog"):
        for s in song.get(route, headers=H).json()["songs"]:
            assert "loops" in s
            check(s, "ServerSong")
    check(patch(song, {"title": "T"}).json(), "ServerSong")
