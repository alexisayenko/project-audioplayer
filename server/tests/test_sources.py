import json

import pytest

from app import sources
from tests.test_api_edges import owner_add
from tests.test_library import H, ODIR, VID, VID2  # noqa: F401
from tests.test_library import client  # noqa: F401

SP_ID = "4uLU6hMCjMI75M1A2tKUQC"


@pytest.mark.parametrize("text,want", [
    ("85", 85), ("85s", 85), ("1m25s", 85), ("1h2m3s", 3723), ("2m", 120), ("1:25", 85), ("1:02:03", 3723),
    ("", None), ("abc", None), ("-5", None), ("1:75", None), (None, None), (True, None), (85, 85),
])
def test_parse_time(text, want):
    assert sources.parse_time(text) == want


@pytest.mark.parametrize("url,want", [
    (f"https://www.youtube.com/watch?v={VID2}", {"type": "youtube", "ref": VID2}),
    (f"https://www.youtube.com/watch?v={VID2}&list=PLx&index=3", {"type": "youtube", "ref": VID2}),
    (f"https://youtu.be/{VID2}?si=abc", {"type": "youtube", "ref": VID2}),
    (f"https://youtu.be/{VID2}?t=85", {"type": "youtube", "ref": VID2, "trim_start": 85}),
    (f"https://www.youtube.com/watch?v={VID2}&t=1m25s", {"type": "youtube", "ref": VID2, "trim_start": 85}),
    (f"https://www.youtube.com/watch?t=90&v={VID2}", {"type": "youtube", "ref": VID2, "trim_start": 90}),
    (f"https://www.youtube.com/watch?v={VID2}&start=12", {"type": "youtube", "ref": VID2, "trim_start": 12}),
    (f"https://www.youtube.com/shorts/{VID2}", {"type": "youtube", "ref": VID2}),
    (f"https://www.youtube.com/embed/{VID2}?start=7", {"type": "youtube", "ref": VID2, "trim_start": 7}),
    (f"https://music.youtube.com/watch?v={VID2}&feature=share", {"type": "youtube", "ref": VID2}),
    (VID2, {"type": "youtube", "ref": VID2}),
    ("https://soundcloud.com/artist/track?utm_source=x", {"type": "soundcloud", "ref": "artist/track"}),
    ("https://soundcloud.com/artist/track#t=1:25", {"type": "soundcloud", "ref": "artist/track", "trim_start": 85}),
    ("https://soundcloud.com/artist/track/s-AbC123", {"type": "soundcloud", "ref": "artist/track/s-AbC123"}),
    (f"https://open.spotify.com/track/{SP_ID}?si=1", {"type": "spotify", "ref": SP_ID}),
    (f"https://open.spotify.com/intl-de/track/{SP_ID}", {"type": "spotify", "ref": SP_ID}),
    ("https://example.com/a/b?utm_source=x&id=7&fbclid=z", {"type": "url", "ref": "https://example.com/a/b?id=7"}),
    ("https://on.soundcloud.com/abc123", {"type": "url", "ref": "https://on.soundcloud.com/abc123"}),
    (f"https://open.spotify.com/album/{SP_ID}", {"type": "url", "ref": f"https://open.spotify.com/album/{SP_ID}"}),
])
def test_parse_source_url(url, want):
    assert sources.parse_source_url(url) == want


def test_source_url_templates_round_trip():
    assert sources.source_url("youtube", VID2) == f"https://www.youtube.com/watch?v={VID2}"
    assert sources.source_url("soundcloud", "a/b") == "https://soundcloud.com/a/b"
    assert sources.source_url("spotify", SP_ID) == f"https://open.spotify.com/track/{SP_ID}"
    assert sources.source_url("url", "https://example.com/x") == "https://example.com/x"
    assert sources.source_url("applemusic", "123") is None
    for url in (f"https://youtu.be/{VID2}?t=5", "https://soundcloud.com/a/b", f"https://open.spotify.com/track/{SP_ID}", "https://example.com/x?y=1"):
        p = sources.parse_source_url(url)
        again = sources.parse_source_url(sources.source_url(p["type"], p["ref"]))
        assert (again["type"], again["ref"]) == (p["type"], p["ref"])


def test_normalize_old_shapes_keeps_order_and_primary_and_is_idempotent():
    song = {
        "id": VID, "source_url": f"https://www.youtube.com/watch?v={VID}",
        "sources": [
            {"source": "youtube", "id": VID, "url": f"https://www.youtube.com/watch?v={VID}&t=30"},
            {"platform": "soundcloud", "url": "https://soundcloud.com/a/b?utm_x=1"},
            {"platform": "youtube", "url": f"https://youtu.be/{VID}"},
            {"platform": "weird", "url": "not a link"},
        ],
    }
    once = sources.normalize_sources(song)
    assert [(e["type"], e["ref"]) for e in once] == [("youtube", VID), ("soundcloud", "a/b"), ("url", "not a link")]
    assert all(e["trim_start"] is None and e["trim_end"] is None for e in once)
    assert sources.normalize_sources({"id": VID, "sources": once}) == once


def test_normalize_derives_from_the_id_and_legacy_fields():
    assert sources.normalize_sources({"id": VID})[0] == {"type": "youtube", "ref": VID, "trim_start": None, "trim_end": None}
    sc = sources.normalize_sources({"id": "soundcloud-123"})[0]
    assert (sc["type"], sc["ref"]) == ("url", "https://api.soundcloud.com/tracks/123")
    assert sources.platform(sc) == "soundcloud"
    old = sources.normalize_sources({"id": "soundcloud-123", "source": "soundcloud", "source_url": "https://soundcloud.com/a/b"})
    assert (old[0]["type"], old[0]["ref"]) == ("soundcloud", "a/b")


def test_dedupe_by_type_and_ref_fills_missing_trims():
    a = sources.make_entry("youtube", VID)
    b = sources.make_entry("youtube", VID, 5, 10, 100)
    c = sources.make_entry("youtube", VID2)
    out = sources.dedupe([a, c, b])
    assert [(e["type"], e["ref"]) for e in out] == [("youtube", VID), ("youtube", VID2)]
    assert out[0]["trim_start"] == 5
    assert out[0]["trim_end"] == 10
    assert out[0]["duration"] == 100


@pytest.mark.parametrize("start,end,duration,ok", [
    (None, None, None, True), (0, 10, None, True), (5, None, 100, True), (None, 50, 100, True), (10, 100, 100, True),
    (10, 10, None, False), (20, 10, None, False), (-1, 5, None, False), (0, 101, 100, False), (100, None, 100, False),
    ("a", 5, None, False), (True, 5, None, False), (float("nan"), 5, None, False),
])
def test_validate_trim(start, end, duration, ok):
    if ok:
        sources.validate_trim(start, end, duration)
    else:
        with pytest.raises(ValueError):
            sources.validate_trim(start, end, duration)


def test_api_song_returns_legacy_fields_next_to_the_new_ones(client):
    r = owner_add(client, audio=False)
    assert r.status_code == 201
    song = r.json()["song"]
    first = song["sources"][0]
    assert first["url"] == f"https://www.youtube.com/watch?v={VID}"
    assert (first["source"], first["id"], first["type"], first["ref"]) == ("youtube", VID, "youtube", VID)
    assert first["trim_start"] is None
    assert first["trim_end"] is None
    assert song["source_url"] == first["url"]


def test_stored_form_is_the_new_shape(client, tmp_path):
    assert owner_add(client).status_code == 202
    client.patch(f"/songs/{VID}", json={"trim": {"start": 5}}, headers=H)
    stored = json.loads((ODIR(tmp_path) / "library.json").read_text(encoding="utf-8"))["songs"][0]
    assert stored["sources"] == [{"type": "youtube", "ref": VID, "trim_start": 5, "trim_end": None}]
    assert "source_url" not in stored


def test_add_with_trim_and_a_start_time_in_the_link_only_hints(client, tmp_path):
    r = client.post("/songs", json={"url": f"https://youtu.be/{VID}?t=85", "audio": False, "metadata": {"title": "S"}}, headers=H)
    assert r.status_code == 201
    body = r.json()
    assert body["trim_start_hint"] == 85
    assert body["song"]["sources"][0]["trim_start"] is None
    r = client.post("/songs", json={"url": VID2, "audio": False, "metadata": {"title": "S"}, "trim": {"start": 10, "end": 90}}, headers=H)
    assert r.status_code == 201
    assert "trim_start_hint" not in r.json()
    assert (r.json()["song"]["sources"][0]["trim_start"], r.json()["song"]["sources"][0]["trim_end"]) == (10, 90)
    assert client.post("/songs", json={"url": "9bZkp7q19f1", "audio": False, "trim": {"start": 9, "end": 3}}, headers=H).status_code == 422


def test_patch_trim_on_the_primary_source_and_clear(client):
    assert owner_add(client, audio=False).status_code == 201
    assert client.patch(f"/songs/{VID}", json={"sources": [{"url": f"https://youtu.be/{VID}", "duration": 200}]}, headers=H).status_code == 200
    r = client.patch(f"/songs/{VID}", json={"trim": {"start": 5, "end": 60}}, headers=H)
    assert r.status_code == 200, r.text
    s = r.json()["sources"][0]
    assert (s["trim_start"], s["trim_end"]) == (5, 60)
    r = client.patch(f"/songs/{VID}", json={"trim": {"start": 7}}, headers=H)
    assert (r.json()["sources"][0]["trim_start"], r.json()["sources"][0]["trim_end"]) == (7, 60)
    r = client.patch(f"/songs/{VID}", json={"trim": {"start": None, "end": None}}, headers=H)
    assert (r.json()["sources"][0]["trim_start"], r.json()["sources"][0]["trim_end"]) == (None, None)


@pytest.mark.parametrize("trim", [{"start": 10, "end": 5}, {"start": -1}, {"end": 0}, {"start": 5, "end": 5}, {"bogus": 1}, {"start": "x"}])
def test_patch_trim_rejects_nonsense(client, trim):
    assert owner_add(client, audio=False).status_code == 201
    assert client.patch(f"/songs/{VID}", json={"trim": trim}, headers=H).status_code == 422


def test_patch_trim_checks_a_known_duration(client):
    assert owner_add(client).status_code == 202
    r = client.patch(f"/songs/{VID}", json={"sources": [{"url": f"https://youtu.be/{VID}", "duration": 100}]}, headers=H)
    assert r.status_code == 200
    assert r.json()["sources"][0]["duration"] == 100
    assert client.patch(f"/songs/{VID}", json={"trim": {"end": 101}}, headers=H).status_code == 422
    assert client.patch(f"/songs/{VID}", json={"trim": {"start": 100}}, headers=H).status_code == 422
    assert client.patch(f"/songs/{VID}", json={"trim": {"start": 10, "end": 100}}, headers=H).status_code == 200


def test_patch_url_adds_a_deduped_source_and_never_stores_the_start_time(client):
    assert owner_add(client).status_code == 202
    r = client.patch(f"/songs/{VID}", json={"url": f"https://youtu.be/{VID2}?t=85&si=x"}, headers=H)
    assert r.status_code == 200
    got = r.json()["sources"]
    assert [(e["type"], e["ref"], e["trim_start"]) for e in got] == [("youtube", VID, None), ("youtube", VID2, None)]
    again = client.patch(f"/songs/{VID}", json={"url": f"https://www.youtube.com/watch?v={VID2}&list=PL1"}, headers=H).json()["sources"]
    assert len(again) == 2
    third = client.patch(f"/songs/{VID}", json={"url": "https://example.com/page?utm_source=a"}, headers=H).json()["sources"]
    assert third[2]["ref"] == "https://example.com/page"


def test_patch_sources_list_replaces_and_keeps_the_own_platform(client):
    assert owner_add(client).status_code == 202
    body = {"sources": [{"type": "youtube", "ref": VID, "trim_start": 3}, {"url": "https://soundcloud.com/a/b", "trim_end": 40}]}
    got = client.patch(f"/songs/{VID}", json=body, headers=H).json()["sources"]
    assert [(e["type"], e["ref"], e["trim_start"], e["trim_end"]) for e in got] == [("youtube", VID, 3, None), ("soundcloud", "a/b", None, 40)]
    assert client.patch(f"/songs/{VID}", json={"sources": [{"url": "https://soundcloud.com/a/b"}]}, headers=H).status_code == 422
    assert client.patch(f"/songs/{VID}", json={"sources": [{"trim_start": 1}]}, headers=H).status_code == 422
    assert client.patch(f"/songs/{VID}", json={"sources": [{"type": "youtube", "ref": "short"}]}, headers=H).status_code == 422
    assert client.patch(f"/songs/{VID}", json={"sources": [{"url": f"https://youtu.be/{VID}", "trim_start": 9, "trim_end": 2}]}, headers=H).status_code == 422
