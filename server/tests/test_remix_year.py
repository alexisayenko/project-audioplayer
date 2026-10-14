import json

import pytest

from tests.test_library import H, ODIR, VID, VID2, client  # noqa: F401
from tests.test_users import ALICE, BOB, add, key, multi, who  # noqa: F401


def song(client, vid=VID, headers=H):
    return next(s for s in client.get("/library", headers=headers).json()["songs"] if s["id"] == vid)


def test_create_stores_remix_year_and_year_stays_separate(client):
    assert add(client, H, metadata={"title": "S", "year": 2003, "remix_year": 2024}).status_code == 202
    s = song(client)
    assert (s["year"], s["remix_year"]) == (2003, 2024)
    assert "decade:00s" in s["tags"]


def test_create_without_audio_keeps_remix_year(client):
    assert add(client, H, audio=False, metadata={"title": "S", "remix_year": 2011}).status_code in (200, 201, 202)
    assert song(client)["remix_year"] == 2011


def test_create_without_it_is_null(client):
    add(client, H)
    assert song(client)["remix_year"] is None


@pytest.mark.parametrize("value, ok", [(1899, False), (1900, True), (2100, True), (2101, False), (0, False), (-5, False),
                                       ("abc", False), (2024.5, False), ([2024], False)])
def test_patch_boundaries(client, value, ok):
    add(client, H)
    r = client.patch(f"/songs/{VID}", json={"remix_year": value}, headers=H)
    assert (r.status_code == 200) is ok
    assert r.status_code in (200, 422)
    assert song(client)["remix_year"] == (value if ok else None)


@pytest.mark.parametrize("value, ok", [(1899, False), (1900, True), (2100, True), (2101, False), ("x", False)])
def test_create_boundaries(client, value, ok):
    r = client.post("/songs", json={"url": VID, "metadata": {"title": "S", "remix_year": value}, "tags": []}, headers=H)
    assert (r.status_code == 202) is ok
    if not ok:
        assert r.status_code == 422


def test_numeric_string_is_accepted_like_year(client):
    add(client, H)
    assert client.patch(f"/songs/{VID}", json={"year": "1999"}, headers=H).status_code == 200
    assert client.patch(f"/songs/{VID}", json={"remix_year": "2024"}, headers=H).status_code == 200
    assert song(client)["remix_year"] == 2024


def test_null_clears_and_absent_keeps(client):
    add(client, H, metadata={"title": "S", "remix_year": 2020})
    assert client.patch(f"/songs/{VID}", json={"title": "T"}, headers=H).json()["remix_year"] == 2020
    r = client.patch(f"/songs/{VID}", json={"remix_year": None}, headers=H)
    assert r.status_code == 200 and r.json()["remix_year"] is None
    assert song(client)["remix_year"] is None


def test_patch_remix_year_does_not_touch_year_or_decade(client):
    add(client, H, metadata={"title": "S", "year": 1994})
    client.patch(f"/songs/{VID}", json={"remix_year": 2024}, headers=H)
    s = song(client)
    assert s["year"] == 1994
    assert s["tags"].count("decade:90s") == 1
    assert not any(t == "decade:20s" for t in s["tags"])


def test_old_library_without_the_field_reads_null_and_is_not_rewritten(client, tmp_path):
    ODIR(tmp_path).mkdir(parents=True)
    path = ODIR(tmp_path) / "library.json"
    raw = json.dumps({"songs": [{"id": VID, "title": "t", "file": None, "year": 2000}]})
    path.write_text(raw)
    assert song(client)["remix_year"] is None
    assert path.read_text() == raw


def test_isolation_between_users(multi):
    a, b = who(multi, ALICE), who(multi, BOB)
    add(multi, a, metadata={"title": "S", "remix_year": 2024})
    add(multi, b)
    assert song(multi, VID, a)["remix_year"] == 2024
    assert song(multi, VID, b)["remix_year"] is None
    assert multi.patch(f"/songs/{VID}", json={"remix_year": 1999}, headers=b).status_code == 200
    assert song(multi, VID, a)["remix_year"] == 2024
