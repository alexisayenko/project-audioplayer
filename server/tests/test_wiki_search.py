import json
import pathlib
import urllib.parse

import pytest

from app import genre_lookup as gl, wiki_lookup as wl

FIX = json.loads((pathlib.Path(__file__).parent / "fixtures" / "wikipedia_haddaway.json").read_text(encoding="utf-8"))
REC = {"id": "r1", "score": 100, "artist-credit": [{"name": "Haddaway", "artist": {"id": "a1", "name": "Haddaway"}}]}


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(wl, "_infobox_cache", {})
    monkeypatch.setattr(wl, "_search_cache", {})
    monkeypatch.setattr(wl, "_entities", {})
    monkeypatch.setattr(wl, "_qid_of_page", {})
    monkeypatch.delenv("AUDIO_TAG_LOOKUP", raising=False)
    monkeypatch.delenv("AUDIO_GENRE_LOOKUP", raising=False)


def fake_wikipedia(calls=None):
    def fetch(url):
        if calls is not None:
            calls.append(url)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        if q.get("list") == ["search"]:
            hits = FIX["search"].get(q["srsearch"][0])
            if hits is None:
                return {"query": {"search": []}}
            return {"query": {"search": hits}}
        if q.get("action") == ["parse"]:
            title = q["page"][0].replace("_", " ")
            return {"parse": {"wikitext": FIX["parse"].get(title, "")}}
        raise OSError("not recorded: " + url)

    return fetch


def mb_without_wiki_links(monkeypatch, album=None):
    monkeypatch.setattr(wl.genre_lookup, "lookup", lambda a, t: {"tags": [], "song_rels": [], "artist_rels": [], "album_rels": [], "year": 2002, "album": album, "mb_url": "https://musicbrainz.org/recording/x"})


def test_song_page_found_by_search_when_musicbrainz_has_no_link(monkeypatch):
    mb_without_wiki_links(monkeypatch)
    monkeypatch.setattr(wl, "_fetch_json", fake_wikipedia())
    out = wl.suggest("Haddaway", "What Is Love")
    assert out["wikipedia_song"] == "https://en.wikipedia.org/wiki/What_Is_Love"
    assert out["wikipedia_artist"] == "https://en.wikipedia.org/wiki/Haddaway"
    assert out["wikipedia_album"] == "https://en.wikipedia.org/wiki/The_Album_(Haddaway_album)"
    assert out["infobox_album"] == "The Album"
    assert out["infobox_year"] == 1993


def test_disambiguation_page_and_other_artist_are_rejected(monkeypatch):
    monkeypatch.setattr(wl, "_fetch_json", fake_wikipedia())
    assert wl.find_song("Someone Else", "What Is Love", ["Someone Else"]) is None
    monkeypatch.setattr(wl, "_search_cache", {"What Is Love Haddaway": ["What Is Love (disambiguation)"]})
    assert wl.find_song("Haddaway", "What Is Love", ["Haddaway"]) is None


def test_artist_search_needs_title_equal_to_name_and_a_musician_infobox(monkeypatch):
    monkeypatch.setattr(wl, "_fetch_json", fake_wikipedia())
    assert wl.find_artist("Haddaway") == "https://en.wikipedia.org/wiki/Haddaway"
    assert wl.find_artist("Unknown Band") is None
    monkeypatch.setattr(wl, "_search_cache", {"The Album": ["The Album"]})
    assert wl.find_artist("The Album") is None


def test_album_search_needs_album_infobox_credited_to_artist(monkeypatch):
    monkeypatch.setattr(wl, "_fetch_json", fake_wikipedia())
    assert wl.find_album("Haddaway", "The Album", ["Haddaway"]) == "https://en.wikipedia.org/wiki/The_Album_(Haddaway_album)"
    assert wl.find_album("Haddaway", "The Album", ["Another Band"]) is None


def test_search_failure_gives_no_links(monkeypatch):
    mb_without_wiki_links(monkeypatch)

    def boom(url):
        raise OSError("down")

    monkeypatch.setattr(wl, "_fetch_json", boom)
    out = wl.suggest("Haddaway", "What Is Love")
    assert (out["wikipedia_song"], out["wikipedia_artist"], out["wikipedia_album"]) == (None, None, None)


def test_musicbrainz_links_win_over_search(monkeypatch):
    calls = []
    monkeypatch.setattr(wl.genre_lookup, "lookup", lambda a, t: {"tags": [], "song_rels": ["https://en.wikipedia.org/wiki/What_Is_Love"], "artist_rels": ["https://en.wikipedia.org/wiki/Haddaway"], "album_rels": ["https://en.wikipedia.org/wiki/The_Album_(Haddaway_album)"], "year": 1993, "album": "The Album", "mb_url": None})
    monkeypatch.setattr(wl, "_fetch_json", fake_wikipedia(calls))
    out = wl.suggest("Haddaway", "What Is Love")
    assert out["wikipedia_song"].endswith("/What_Is_Love")
    assert not any("list=search" in u for u in calls)


def test_gather_reports_guessed_links(monkeypatch):
    from app import metadata

    guess = {"wikipedia_song": "https://en.wikipedia.org/wiki/What_Is_Love", "wikipedia_artist": "https://en.wikipedia.org/wiki/Haddaway", "wikipedia_album": None, "tags": [], "year": None}
    monkeypatch.setattr(metadata.genre_lookup, "lookup", lambda a, t: {})
    monkeypatch.setattr(metadata.wiki_lookup, "suggest", lambda a, t: guess)
    out = metadata.gather("What Is Love", "Haddaway", [], timeout=2)
    assert out["wikipedia_song"] == guess["wikipedia_song"]
    assert out["wikipedia_artist"] == guess["wikipedia_artist"]
    assert out["wikipedia_album"] is None
