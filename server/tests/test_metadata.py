import threading
import time

import pytest

from app import genre_lookup as gl, metadata, wiki_lookup as wl


def test_cap_tags_dedupes_normalises_and_drops_lang():
    gs = [f"genre:g{i}" for i in range(9)]
    tags = ["genre:Rock", "genre:rock", *gs, "country:AU", "country:fr", "lang:en", "Plain", "decade:1990s"]
    assert metadata.cap_tags(tags) == ["genre:rock", *gs[:7], "country:au", "Plain", "decade:1990s"]


def test_merge_precedence():
    out = metadata.merge(
        sources=[{"album": "", "year": 2005, "tags": ["genre:Pop"]}, {"album": "Src Album", "year": 2001, "tags": ["genre:pop", "genre:house"]}],
        mb={"album": "MB Album", "year": 1999, "tags": ["genre:funk", "country:AU"]},
        links={"year": 1997, "tags": ["genre:disco", "country:fr"]},
        guess={"year": 1980, "tags": ["genre:soul"]},
    )
    assert out == {"album": "Src Album", "year": 1997, "tags": ["genre:pop", "genre:house", "genre:funk", "country:au", "genre:disco", "genre:soul"]}


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
    monkeypatch.setattr(wl, "from_links", lambda s, a: {"tags": ["genre:blues rock"], "year": 1980, "wikipedia_song": "https://en.wikipedia.org/wiki/X", "wikipedia_artist": None})


def test_gather_merges_all_sources(upstream):
    out = metadata.gather("T", "A", [lambda: {"album": None, "year": 2015, "tags": ["genre:Rock", "lang:en"]}], "https://en.wikipedia.org/wiki/X", None, source_urls=["https://youtu.be/dQw4w9WgXcQ"])
    assert out == {
        "suggest": {"artist": None, "title": None},
        "album": "Highway to Hell",
        "year": 1980,
        "tags": ["genre:rock", "country:au", "genre:blues rock", "genre:hard rock"],
        "services": {
            "youtube": {"found": True, "url": "https://youtu.be/dQw4w9WgXcQ"},
            "soundcloud": {"found": False, "url": None},
            "wikipedia": {"found": True, "url": "https://en.wikipedia.org/wiki/X"},
            "spotify": {"found": False, "url": None},
        },
    }


def test_gather_skips_failing_sources(monkeypatch):
    def boom(*a):
        raise OSError("down")

    monkeypatch.setattr(gl, "lookup", boom)
    monkeypatch.setattr(wl, "suggest", boom)
    monkeypatch.setattr(wl, "from_links", boom)
    out = metadata.gather("T", "A", [boom, lambda: {"album": "Alb", "year": 2000, "tags": ["genre:pop"]}], "x", "y")
    assert {k: out[k] for k in ("album", "year", "tags")} == {"album": "Alb", "year": 2000, "tags": ["genre:pop"]}
    assert out["services"]["wikipedia"] == {"found": False, "url": None}


def test_gather_without_artist_or_links_skips_lookups(monkeypatch):
    for mod, name in ((gl, "lookup"), (wl, "suggest"), (wl, "from_links")):
        monkeypatch.setattr(mod, name, lambda *a: pytest.fail("called"))
    out = metadata.gather("", "", [], None, None)
    assert {k: out[k] for k in ("album", "year", "tags")} == {"album": None, "year": None, "tags": []}
    assert all(v == {"found": False, "url": None} for v in out["services"].values())


def test_services_soundcloud_wikidata_fallback_and_failed_source():
    svc = metadata.services(
        ["https://soundcloud.com/a/b", "https://youtu.be/xxxxxxxxxxx", "https://on.soundcloud.com/z"],
        {0: {"tags": ["genre:pop"]}, 1: {"album": None, "year": None, "tags": []}},
        None,
        {"tags": [], "year": None, "wikipedia_song": None, "wikipedia_artist": "https://www.wikidata.org/wiki/Q42"},
    )
    assert svc["soundcloud"] == {"found": True, "url": "https://soundcloud.com/a/b"}
    assert svc["youtube"] == {"found": False, "url": None}
    assert svc["wikipedia"] == {"found": True, "url": "https://www.wikidata.org/wiki/Q42"}


def test_gather_timeout_returns_what_finished(upstream):
    release = threading.Event()

    def slow():
        release.wait(2)
        return {"album": "Late", "tags": ["genre:late"]}

    start = time.monotonic()
    out = metadata.gather("T", "A", [slow], timeout=0.3)
    release.set()
    assert time.monotonic() - start < 1.5
    assert out["album"] == "Highway to Hell"
    assert "genre:late" not in out["tags"]
    assert out["services"]["youtube"]["found"] is False


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
    body_out = r.json()
    assert {k: body_out[k] for k in ("album", "year", "tags")} == {"album": "Yt Album", "year": 2001, "tags": ["genre:pop", "country:au"]}
    assert body_out["services"]["youtube"] == {"found": True, "url": "https://youtu.be/dQw4w9WgXcQ"}
    assert body_out["services"]["spotify"] == {"found": False, "url": None}
    empty = client.post("/metadata", json={}, headers={"X-API-Token": "secret"}).json()
    assert (empty["album"], empty["year"], empty["tags"]) == (None, None, [])


def test_merge_song_genres_first_and_all_artist_after():
    song = [f"genre:s{i}" for i in range(7)]
    out = metadata.merge(
        sources=[{"tags": ["genre:src"]}],
        mb={"tags": ["genre:hip hop", "genre:alt hip hop", "genre:exp hip hop", "country:us"]},
        links={"tags": [*song, "genre:art1", "genre:art2"], "song_genres": song},
        guess=None,
    )
    assert out["tags"][:7] == song
    assert out["tags"][7] == "genre:src"
    assert len([t for t in out["tags"] if t.startswith("genre:")]) == 8
    assert "genre:art1" not in out["tags"]


def test_merge_song_genres_exceed_cap_up_to_all():
    song = [f"genre:s{i}" for i in range(10)]
    out = metadata.merge([{"tags": ["genre:src"]}], None, None, {"tags": song, "song_genres": song})
    assert out["tags"] == song


def test_services_wikipedia_found_from_infobox_genres(monkeypatch):
    monkeypatch.setattr(wl, "qid_of_page", lambda u: None)
    monkeypatch.setattr(wl, "_infobox_cache", {})
    monkeypatch.setattr(wl, "_fetch_json", lambda url: {"parse": {"wikitext": "{{Infobox song\n| genre = [[Neo soul]], [[funk]]\n}}"}})
    out = metadata.gather("T", "", [], "https://en.wikipedia.org/wiki/Crazy_(Gnarls_Barkley_song)", None)
    assert out["tags"] == ["genre:neo soul", "genre:funk"]
    assert out["services"]["wikipedia"] == {"found": True, "url": "https://en.wikipedia.org/wiki/Crazy_(Gnarls_Barkley_song)"}


def test_infobox_genres_beyond_cap_kept():
    song = [f"genre:g{i}" for i in range(11)]
    out = metadata.merge([{"tags": ["genre:x"]}], None, {"song_genres": song, "tags": song}, None)
    assert out["tags"] == song


def test_merge_album_infobox_between_ytdlp_and_musicbrainz():
    links = {"infobox_album": "Box Album"}
    assert metadata.merge([{"album": "Yt"}], {"album": "MB"}, links, None)["album"] == "Yt"
    assert metadata.merge([{}], {"album": "MB"}, links, None)["album"] == "Box Album"
    assert metadata.merge([], {"album": "MB"}, None, {"infobox_album": "Guess Box"})["album"] == "Guess Box"
    assert metadata.merge([], {"album": "MB"}, {"infobox_album": None}, None)["album"] == "MB"


def test_merge_year_infobox_after_wikidata_links():
    box = {"infobox_year": 2009, "year": None}
    assert metadata.merge([{"year": 2001}], {"year": 1999}, {**box, "year": 2010}, {"year": 1980})["year"] == 2010
    assert metadata.merge([{"year": 2001}], {"year": 1999}, box, {"year": 1980})["year"] == 2009
    assert metadata.merge([{"year": 2001}], {"year": 1999}, None, {"infobox_year": 2009, "year": 1980})["year"] == 2009
    assert metadata.merge([{"year": 2001}], {"year": 1999}, {"year": None, "infobox_year": None}, None)["year"] == 1999


def test_services_wikipedia_found_from_infobox_album_or_year():
    for key, val in (("infobox_album", "A"), ("infobox_year", 2009)):
        out = metadata.services([], {}, {key: val, "wikipedia_song": "https://en.wikipedia.org/wiki/S"}, None)
        assert out["wikipedia"] == {"found": True, "url": "https://en.wikipedia.org/wiki/S"}


def test_gather_infobox_album_and_year_end_to_end(monkeypatch):
    monkeypatch.setattr(wl, "qid_of_page", lambda u: None)
    monkeypatch.setattr(wl, "_infobox_cache", {})
    text = "{{Infobox song\n| album = [[Invaders Must Die]]\n| released = {{Start date|df=yes|2009|5|11}}\n| genre = [[Big beat]]\n}}"
    monkeypatch.setattr(wl, "_fetch_json", lambda url: {"parse": {"wikitext": text}})
    out = metadata.gather("T", "", [], "https://en.wikipedia.org/wiki/Warrior%27s_Dance", None)
    assert (out["album"], out["year"], out["tags"]) == ("Invaders Must Die", 2009, ["genre:big beat"])
    assert out["services"]["wikipedia"]["found"] is True


def _gather_with_box(monkeypatch, text, **kw):
    monkeypatch.setattr(wl, "qid_of_page", lambda u: None)
    monkeypatch.setattr(wl, "_infobox_cache", {})
    monkeypatch.setattr(wl, "_fetch_json", lambda url: {"parse": {"wikitext": text}})
    return metadata.gather("T", "", [], "https://en.wikipedia.org/wiki/Warrior%27s_Dance", None, **kw)


def test_gather_suggest_from_song_infobox(monkeypatch):
    out = _gather_with_box(monkeypatch, "{{Infobox song\n| name = Warrior's Dance\n| artist = [[the Prodigy]]\n| album = X\n}}")
    assert out["suggest"] == {"artist": "The Prodigy", "title": "Warrior's Dance"}
    assert out["album"] == "X"
    assert set(out) == {"album", "year", "tags", "suggest", "services"}


def test_gather_suggest_nulls_without_name_artist_or_infobox(monkeypatch):
    nulls = {"artist": None, "title": None}
    assert _gather_with_box(monkeypatch, "{{Infobox song\n| artist = [[the Prodigy]]\n}}")["suggest"] == nulls
    assert _gather_with_box(monkeypatch, "{{Infobox song\n| name = Only\n}}")["suggest"] == nulls
    assert _gather_with_box(monkeypatch, "no infobox here")["suggest"] == nulls
    assert metadata.gather("T", "", [], None, None)["suggest"] == nulls
