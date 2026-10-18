import threading
import time

import pytest

from tests.vocab import REAL
from app import genre_lookup as gl, metadata, wiki_lookup as wl


def test_cap_tags_dedupes_normalises_and_drops_lang():
    gs = [f"genre:{REAL[i]}" for i in range(9)]
    tags = ["genre:Rock", "genre:rock", *gs, "country:AU", "country:fr", "lang:en", "Plain", "decade:1990s"]
    assert metadata.cap_tags(tags) == ["genre:rock", *gs[:7], "country:au", "Plain", "decade:1990s"]


def test_merge_precedence():
    out = metadata.merge(
        sources=[{"album": "", "year": 2005, "tags": ["genre:Pop"]}, {"album": "Src Album", "year": 2001, "tags": ["genre:pop", "genre:house"]}],
        mb={"album": "MB Album", "year": 1999, "tags": ["genre:funk", "country:AU"]},
        links={"year": 1997, "tags": ["genre:disco", "country:fr"]},
        guess={"year": 1980, "tags": ["genre:soul"]},
    )
    assert out == {"album": "Src Album", "year": 1997, "published_year": None, "remix_year": None, "version_year": None, "tags": ["genre:pop", "genre:house", "genre:funk", "country:au", "genre:disco", "genre:soul"], "original_genres": []}


def test_merge_falls_back_through_sources():
    assert metadata.merge([], {"album": "MB", "year": 1999}, None, {"year": 1980}) == {"album": "MB", "year": 1980, "published_year": None, "remix_year": None, "version_year": None, "tags": [], "original_genres": []}
    assert metadata.merge([{"year": 2003}], None, None, None) == {"album": None, "year": None, "published_year": None, "remix_year": None, "version_year": None, "tags": [], "original_genres": []}
    assert metadata.merge([], None, None, None) == {"album": None, "year": None, "published_year": None, "remix_year": None, "version_year": None, "tags": [], "original_genres": []}


def test_merge_ignores_bad_years():
    assert metadata.merge([{"year": "1999"}, {"year": True}, {"year": 0}], None, None, None)["year"] is None


@pytest.fixture
def upstream(monkeypatch):
    monkeypatch.setattr(gl, "lookup", lambda a, t: {"tags": ["genre:rock", "country:au"], "year": 1979, "album": "Highway to Hell"})
    monkeypatch.setattr(wl, "suggest", lambda a, t: {"tags": ["genre:hard rock", "country:gb"], "year": 1979})
    monkeypatch.setattr(wl, "from_links", lambda s, a, al=None: {"tags": ["genre:blues rock"], "year": 1980, "wikipedia_song": "https://en.wikipedia.org/wiki/X", "wikipedia_artist": None})


def test_gather_merges_all_sources(upstream, monkeypatch):
    monkeypatch.delenv("DISCOGS_TOKEN", raising=False)
    out = metadata.gather("T", "A", [lambda: {"album": None, "year": 2015, "tags": ["genre:Rock", "lang:en"]}], "https://en.wikipedia.org/wiki/X", None, source_urls=["https://youtu.be/dQw4w9WgXcQ"])
    assert out == {
        "suggest": {"artist": None, "title": None},
        "wikipedia_song": "https://en.wikipedia.org/wiki/X",
        "wikipedia_artist": None,
        "wikipedia_album": None,
        "album": "Highway to Hell",
        "year": 1980,
        "published_year": None,
        "remix_year": None,
        "version_year": None,
        "tags": ["genre:rock", "country:au", "genre:blues rock", "genre:hard rock"],
        "original_genres": [],
        "services": {
            "youtube": {"found": True, "url": "https://youtu.be/dQw4w9WgXcQ"},
            "soundcloud": {"found": False, "url": None},
            "wikipedia": {"found": True, "url": "https://en.wikipedia.org/wiki/X"},
            "spotify": {"found": False, "url": None},
            "musicbrainz": {"found": False, "url": None},
            "discogs": {"found": False, "url": None, "skipped": "not_configured"},
        },
    }


def test_gather_skips_failing_sources(monkeypatch):
    def boom(*a):
        raise OSError("down")

    monkeypatch.setattr(gl, "lookup", boom)
    monkeypatch.setattr(wl, "suggest", boom)
    monkeypatch.setattr(wl, "from_links", boom)
    out = metadata.gather("T", "A", [boom, lambda: {"album": "Alb", "year": 2000, "tags": ["genre:pop"]}], "x", "y")
    assert {k: out[k] for k in ("album", "year", "tags")} == {"album": "Alb", "year": None, "tags": ["genre:pop"]}
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
    monkeypatch.delenv("DISCOGS_TOKEN", raising=False)
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
    assert {k: body_out[k] for k in ("album", "year", "tags")} == {"album": "Yt Album", "year": None, "tags": ["genre:pop", "country:au"]}
    assert body_out["services"]["youtube"] == {"found": True, "url": "https://youtu.be/dQw4w9WgXcQ"}
    for inert in ("spotify", "musicbrainz"):
        assert body_out["services"][inert] == {"found": False, "url": None}
    assert body_out["services"]["discogs"] == {"found": False, "url": None, "skipped": "not_configured"}
    empty = client.post("/metadata", json={}, headers={"X-API-Token": "secret"}).json()
    assert (empty["album"], empty["year"], empty["tags"]) == (None, None, [])


def test_merge_song_genres_first_and_all_artist_after():
    song = [f"genre:{REAL[i]}" for i in range(7)]
    out = metadata.merge(
        sources=[{"tags": ["genre:folk"]}],
        mb={"tags": ["genre:hip hop", "genre:trap", "genre:rap", "country:us"]},
        links={"tags": [*song, "genre:soul", "genre:funk"], "song_genres": song},
        guess=None,
    )
    assert out["tags"][:7] == song
    assert out["tags"][7] == "genre:folk"
    assert len([t for t in out["tags"] if t.startswith("genre:")]) == 8
    assert "genre:soul" not in out["tags"]


def test_merge_song_genres_exceed_cap_up_to_all():
    song = [f"genre:{REAL[i]}" for i in range(10)]
    out = metadata.merge([{"tags": ["genre:folk"]}], None, None, {"tags": song, "song_genres": song})
    assert out["tags"] == song


def test_services_wikipedia_found_from_infobox_genres(monkeypatch):
    monkeypatch.setattr(wl, "qid_of_page", lambda u: None)
    monkeypatch.setattr(wl, "_infobox_cache", {})
    monkeypatch.setattr(wl, "_fetch_json", lambda url: {"parse": {"wikitext": "{{Infobox song\n| genre = [[Neo soul]], [[funk]]\n}}"}})
    out = metadata.gather("T", "", [], "https://en.wikipedia.org/wiki/Crazy_(Gnarls_Barkley_song)", None)
    assert out["tags"] == ["genre:neo soul", "genre:funk"]
    assert out["services"]["wikipedia"] == {"found": True, "url": "https://en.wikipedia.org/wiki/Crazy_(Gnarls_Barkley_song)"}


def test_infobox_genres_beyond_cap_kept():
    song = [f"genre:{REAL[i]}" for i in range(11)]
    out = metadata.merge([{"tags": ["genre:folk"]}], None, {"song_genres": song, "tags": song}, None)
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
    assert set(out) == {"album", "year", "published_year", "remix_year", "version_year", "tags", "original_genres", "wikipedia_song", "wikipedia_artist", "wikipedia_album", "suggest", "services"}


def test_gather_suggest_nulls_without_name_artist_or_infobox(monkeypatch):
    nulls = {"artist": None, "title": None}
    assert _gather_with_box(monkeypatch, "{{Infobox song\n| artist = [[the Prodigy]]\n}}")["suggest"] == nulls
    assert _gather_with_box(monkeypatch, "{{Infobox song\n| name = Only\n}}")["suggest"] == nulls
    assert _gather_with_box(monkeypatch, "no infobox here")["suggest"] == nulls
    assert metadata.gather("T", "", [], None, None)["suggest"] == nulls


MBID = "5f1e7d9a-0b2c-4d3e-8f4a-6b7c8d9e0f1a"


def test_services_musicbrainz_lit_by_matched_recording():
    url = f"https://musicbrainz.org/recording/{MBID}"
    assert metadata.services([], {}, None, None, {"mb_url": url})["musicbrainz"] == {"found": True, "url": url}
    for mb in (None, {}, {"mb_url": None}):
        assert metadata.services([], {}, None, None, mb)["musicbrainz"] == {"found": False, "url": None}


def test_gather_reports_musicbrainz_match(monkeypatch, upstream):
    monkeypatch.delenv("DISCOGS_TOKEN", raising=False)
    url = f"https://musicbrainz.org/recording/{MBID}"
    monkeypatch.setattr(gl, "lookup", lambda a, t: {"tags": [], "year": None, "album": None, "mb_url": url})
    out = metadata.gather("T", "A", [], None, None)
    assert out["services"]["musicbrainz"] == {"found": True, "url": url}
    assert out["services"]["discogs"] == {"found": False, "url": None, "skipped": "not_configured"}


def test_merge_reports_the_platform_publish_year_apart_from_year():
    out = metadata.merge([{"year": None, "published_year": 2014}, {"published_year": 2016}], None, None, None)
    assert out["year"] is None
    assert out["published_year"] == 2014
    assert out["remix_year"] is None


def test_merge_passes_a_remix_specific_date_and_discards_out_of_range():
    assert metadata.merge([], {"remix_year": 2012}, None, None)["remix_year"] == 2012
    assert metadata.merge([{"published_year": 1850}], {"remix_year": 1850}, None, None)["published_year"] is None
    assert metadata.merge([], {"remix_year": 1850}, None, None)["remix_year"] is None


def test_merge_year_chain_is_wiki_then_musicbrainz_then_discogs():
    assert metadata.merge([], {"year": 1999}, None, None, {"year": 2001})["year"] == 1999
    assert metadata.merge([], None, None, None, {"year": 2001})["year"] == 2001
    assert metadata.merge([{"year": 1990, "published_year": 2014}], None, None, None, None)["year"] is None
    assert metadata.merge([{"year": 1990, "published_year": 2014}], None, None, None, None)["published_year"] == 2014


def test_gather_for_a_version_withholds_the_musicbrainz_and_discogs_links(monkeypatch):
    monkeypatch.setattr(gl, "lookup", lambda a, t: {"tags": [], "year": 1999, "album": "Orig", "mb_url": "https://musicbrainz.org/recording/6f0a4f30-6a6f-4f1c-8a9c-0b1d1d1d1d1d"})
    monkeypatch.setattr(wl, "suggest", lambda a, t: {"tags": [], "year": None})
    monkeypatch.setattr(metadata.discogs_lookup, "suggest", lambda a, t: {"tags": [], "year": 1998, "url": "https://www.discogs.com/release/1"})
    plain = metadata.gather("T", "A", [])
    version = metadata.gather("T", "A", [], version_kind="remix")
    assert plain["services"]["musicbrainz"]["found"]
    assert plain["services"]["discogs"]["found"]
    assert version["services"]["musicbrainz"] == {"found": False, "url": None}
    assert version["services"]["discogs"] == {"found": False, "url": None}
    assert version["year"] == 1999


def _orig_sources(monkeypatch):
    monkeypatch.setattr(gl, "lookup", lambda a, t: {"tags": ["genre:synthpop", "country:gb"], "year": 1985, "album": "Hounds of Love"})
    monkeypatch.setattr(wl, "suggest", lambda a, t: {"tags": ["genre:art pop"], "song_genres": ["art pop", "new wave"], "year": None})
    monkeypatch.setattr(metadata.discogs_lookup, "suggest", lambda a, t: {"tags": [], "year": None, "url": None})


def test_gather_for_a_remix_applies_only_the_sources_own_genres(monkeypatch):
    _orig_sources(monkeypatch)
    src = lambda: {"tags": ["genre:trance", "genre:progressive trance"], "youtube_genres": []}
    plain = metadata.gather("T", "A", [src])
    remix = metadata.gather("T", "A", [src], version_kind="remix")
    assert "genre:art pop" in plain["tags"]
    assert plain["original_genres"] == []
    assert remix["tags"] == ["genre:trance", "genre:progressive trance", "country:gb"]
    assert remix["original_genres"] == ["genre:art pop", "genre:new wave", "genre:synthpop"]


def test_a_version_with_no_own_source_has_no_genres_and_the_original_is_a_hint(monkeypatch):
    _orig_sources(monkeypatch)
    out = metadata.gather("T", "A", [], version_kind="cover")
    assert [t for t in out["tags"] if t.startswith("genre:")] == []
    assert out["original_genres"]


def test_a_same_recording_version_keeps_the_original_genres(monkeypatch):
    _orig_sources(monkeypatch)
    out = metadata.gather("T", "A", [], version_kind="remaster")
    assert "genre:art pop" in out["tags"]
    assert out["original_genres"] == []


@pytest.mark.parametrize("artist, title, remixer, expect", [
    ("Orkidea", "Kate Bush - Running Up That Hill (Orkidea Pure Progressive Mix)", None, True),
    ("Orkidea", "Kate Bush - Running Up That Hill", "Orkidea Remix", True),
    ("Kate Bush", "Running Up That Hill (Orkidea Pure Progressive Mix)", None, False),
    ("Kate Bush", "Running Up That Hill (Kate Bush Live)", None, False),
    ("Café del Mar", "Song [Cafe Del Mar Edit]", None, True),
    ("Delerium", "Innocente", "Sadrican 2026 Remix", False),
    ("", "T (X Mix)", None, False),
])
def test_artist_is_remixer(artist, title, remixer, expect):
    assert metadata.artist_is_remixer(artist, title, remixer) is expect


DISC_LINK = "https://www.discogs.com/master/101179-Kermesse-Mrs-Moon"


def _no_other_lookups(monkeypatch):
    monkeypatch.setattr(gl, "lookup", lambda a, t: {"tags": [], "year": None, "album": None})
    monkeypatch.setattr(wl, "suggest", lambda a, t: {"tags": [], "year": None})


def _disc_hit(**kw):
    return {"tags": ["genre:italo-disco"], "year": 1983, "country": None, "url": "https://www.discogs.com/master/101179", "artist": "Kermesse", "title": "Mrs Moon", **kw}


def test_gather_uses_the_discogs_link_before_searching(monkeypatch):
    _no_other_lookups(monkeypatch)
    monkeypatch.setattr(metadata.discogs_lookup, "from_url", lambda u: _disc_hit(from_link=True))
    monkeypatch.setattr(metadata.discogs_lookup, "suggest", lambda a, t: pytest.fail("searched"))
    out = metadata.gather("Mrs. Moon", "Kermesse", [], discogs_url=DISC_LINK)
    assert out["services"]["discogs"] == {"found": True, "url": "https://www.discogs.com/master/101179", "from_link": True}
    assert out["year"] == 1983
    assert "genre:italo disco" in out["tags"]


def test_gather_with_only_a_discogs_link_needs_no_artist(monkeypatch):
    _no_other_lookups(monkeypatch)
    monkeypatch.setattr(metadata.discogs_lookup, "from_url", lambda u: _disc_hit(from_link=True))
    out = metadata.gather("", "", [], discogs_url=DISC_LINK)
    assert out["services"]["discogs"]["from_link"] is True


def test_gather_falls_back_to_the_search_when_the_link_gives_nothing(monkeypatch):
    _no_other_lookups(monkeypatch)
    monkeypatch.setattr(metadata.discogs_lookup, "from_url", lambda u: {**_disc_hit(url=None), "error": True})
    monkeypatch.setattr(metadata.discogs_lookup, "suggest", lambda a, t: _disc_hit())
    out = metadata.gather("Mrs. Moon", "Kermesse", [], discogs_url=DISC_LINK)
    assert out["services"]["discogs"] == {"found": True, "url": "https://www.discogs.com/master/101179"}


def test_gather_ignores_a_discogs_link_on_another_host(monkeypatch):
    _no_other_lookups(monkeypatch)
    monkeypatch.setattr(metadata.discogs_lookup, "from_url", lambda u: pytest.fail("fetched"))
    monkeypatch.setattr(metadata.discogs_lookup, "suggest", lambda a, t: _disc_hit())
    out = metadata.gather("T", "A", [], discogs_url="https://evil.example/master/1")
    assert out["services"]["discogs"]["found"]
    assert "from_link" not in out["services"]["discogs"]


@pytest.mark.parametrize("token, result, reason", [
    ("", {"tags": [], "year": None, "url": None}, "not_configured"),
    ("t", {"tags": [], "year": None, "url": None}, "no_match"),
    ("t", {"tags": [], "year": None, "url": None, "error": True}, "error"),
])
def test_gather_reports_why_discogs_was_skipped(monkeypatch, token, result, reason):
    _no_other_lookups(monkeypatch)
    monkeypatch.setenv("DISCOGS_TOKEN", token)
    monkeypatch.setattr(metadata.discogs_lookup, "suggest", lambda a, t: result)
    out = metadata.gather("T", "A", [])
    assert out["services"]["discogs"] == {"found": False, "url": None, "skipped": reason}


def test_gather_reports_a_crashed_discogs_task_as_an_error(monkeypatch):
    _no_other_lookups(monkeypatch)
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    monkeypatch.setattr(metadata.discogs_lookup, "suggest", lambda a, t: (_ for _ in ()).throw(RuntimeError("x")))
    assert metadata.gather("T", "A", [])["services"]["discogs"]["skipped"] == "error"


def test_gather_link_without_a_token_is_not_reported_as_unconfigured(monkeypatch):
    _no_other_lookups(monkeypatch)
    monkeypatch.delenv("DISCOGS_TOKEN", raising=False)
    monkeypatch.setattr(metadata.discogs_lookup, "from_url", lambda u: _disc_hit(url=None))
    monkeypatch.setattr(metadata.discogs_lookup, "suggest", lambda a, t: _disc_hit(url=None))
    assert metadata.gather("T", "A", [], discogs_url=DISC_LINK)["services"]["discogs"]["skipped"] == "no_match"


def test_gather_for_a_version_reports_no_discogs_skip(monkeypatch):
    _no_other_lookups(monkeypatch)
    monkeypatch.delenv("DISCOGS_TOKEN", raising=False)
    out = metadata.gather("T", "A", [], version_kind="remix")
    assert out["services"]["discogs"] == {"found": False, "url": None}


def test_merge_takes_discogs_genres_first_and_its_country_last():
    out = metadata.merge([], {"tags": ["genre:house", "country:fr"]}, None, None, {"tags": ["genre:italo-disco", "country:it"]})
    assert out["tags"] == ["genre:italo disco", "genre:house", "country:fr"]


def test_metadata_endpoint_passes_the_discogs_link(monkeypatch):
    from fastapi.testclient import TestClient

    from app import main

    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    _no_other_lookups(monkeypatch)
    monkeypatch.setattr(metadata.discogs_lookup, "from_url", lambda u: _disc_hit(from_link=True))
    r = TestClient(main.app).post("/metadata", json={"title": "Mrs. Moon", "artist": "Kermesse", "discogs_url": DISC_LINK}, headers={"X-API-Token": "secret"})
    assert r.status_code == 200
    assert r.json()["services"]["discogs"]["from_link"] is True
    assert r.json()["year"] == 1983
