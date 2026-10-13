import time

import pytest

from app import genre_lookup as gl, metadata, wiki_lookup as wl


def test_cap_tags_dedupes_normalises_and_drops_lang():
    tags = ["genre:Rock", "genre:rock", "genre:a", "genre:b", "genre:c", "country:AU", "country:fr", "lang:en", "Plain", "decade:1990s"]
    assert metadata.cap_tags(tags) == ["genre:rock", "genre:a", "genre:b", "country:au", "Plain", "decade:1990s"]


def test_merge_precedence():
    out = metadata.merge(
        sources=[{"album": "", "year": 2005, "tags": ["genre:Pop"]}, {"album": "Src Album", "year": 2001, "tags": ["genre:pop", "genre:house"]}],
        mb={"album": "MB Album", "year": 1999, "tags": ["genre:funk", "country:AU"]},
        links={"year": 1997, "tags": ["genre:disco", "country:fr"]},
        guess={"year": 1980, "tags": ["genre:soul"]},
    )
    assert out == {"album": "Src Album", "year": 1997, "tags": ["genre:pop", "genre:house", "genre:funk", "country:au"]}


def test_merge_falls_back_through_sources():
    assert metadata.merge([], {"album": "MB", "year": 1999}, None, {"year": 1980}) == {"album": "MB", "year": 1980, "tags": []}
    assert metadata.merge([{"year": 2003}], None, None, None) == {"album": None, "year": 2003, "tags": []}
    assert metadata.merge([], None, None, None) == {"album": None, "year": None, "tags": []}


def test_merge_ignores_bad_years():
    assert metadata.merge([{"year": "1999"}, {"year": True}, {"year": 0}], None, None, None)["year"] is None


@pytest.fixture
def upstream(monkeypatch):
    monkeypatch.setattr(gl, "lookup", lambda a, t: {"tags": ["genre:rock", "country:au"], "year": 1979, "album": "Highway to Hell"})
    monkeypatch.setattr(wl, "suggest", lambda a, t: {"tags": ["genre:hard rock", "country:gb"], "year": 1979})
    monkeypatch.setattr(wl, "from_links", lambda s, a: {"tags": ["genre:blues rock"], "year": 1980})


def test_gather_merges_all_sources(upstream):
    out = metadata.gather("T", "A", [lambda: {"album": None, "year": 2015, "tags": ["genre:Rock", "lang:en"]}], "https://en.wikipedia.org/wiki/X", None)
    assert out == {"album": "Highway to Hell", "year": 1980, "tags": ["genre:rock", "country:au", "genre:blues rock", "genre:hard rock"]}


def test_gather_skips_failing_sources(monkeypatch):
    def boom(*a):
        raise OSError("down")

    monkeypatch.setattr(gl, "lookup", boom)
    monkeypatch.setattr(wl, "suggest", boom)
    monkeypatch.setattr(wl, "from_links", boom)
    out = metadata.gather("T", "A", [boom, lambda: {"album": "Alb", "year": 2000, "tags": ["genre:pop"]}], "x", "y")
    assert out == {"album": "Alb", "year": 2000, "tags": ["genre:pop"]}


def test_gather_without_artist_or_links_skips_lookups(monkeypatch):
    for mod, name in ((gl, "lookup"), (wl, "suggest"), (wl, "from_links")):
        monkeypatch.setattr(mod, name, lambda *a: pytest.fail("called"))
    assert metadata.gather("", "", [], None, None) == {"album": None, "year": None, "tags": []}


def test_gather_timeout_returns_what_finished(upstream):
    def slow():
        time.sleep(2)
        return {"album": "Late", "tags": ["genre:late"]}

    start = time.monotonic()
    out = metadata.gather("T", "A", [slow], timeout=0.3)
    assert time.monotonic() - start < 1.5
    assert out["album"] == "Highway to Hell" and "genre:late" not in out["tags"]


def test_metadata_endpoint(monkeypatch):
    from fastapi.testclient import TestClient

    from app import extractor, main

    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(extractor, "preview", lambda v: {"id": v, "album": "Yt Album", "year": 2001, "tags": ["genre:pop"]})
    monkeypatch.setattr(gl, "lookup", lambda a, t: {"tags": ["country:au"], "year": None, "album": None})
    monkeypatch.setattr(wl, "suggest", lambda a, t: {"tags": [], "year": None})
    client = TestClient(main.app)
    body = {"title": "T", "artist": "A", "sources": [{"url": "https://youtu.be/dQw4w9WgXcQ"}, {"url": "nonsense"}]}
    assert client.post("/metadata", json=body).status_code in (401, 403)
    r = client.post("/metadata", json=body, headers={"X-API-Token": "secret"})
    assert r.status_code == 200
    assert r.json() == {"album": "Yt Album", "year": 2001, "tags": ["genre:pop", "country:au"]}
    assert client.post("/metadata", json={}, headers={"X-API-Token": "secret"}).json() == {"album": None, "year": None, "tags": []}
