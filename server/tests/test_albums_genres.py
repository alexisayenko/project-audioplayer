import threading
import urllib.parse

import pytest

from app import album_genres, wiki_lookup
from tests.test_library import H, client  # noqa: F401
from tests.test_users import ALICE, key, multi, who  # noqa: F401

BOX = """{{Infobox album
| name = Twisted
| type = studio
| artist = [[Hallucinogen]]
| genre = {{flatlist|
* [[Psychedelic trance|psytrance]]
* [[Goa trance]]
* Zork core
}}
}}"""
DISAMBIGUATION = "'''Twisted''' may refer to:\n* [[Twisted (film)]]"
OTHER_ARTIST = BOX.replace("[[Hallucinogen]]", "[[Somebody Else]]")


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(wiki_lookup, "_infobox_cache", {})
    monkeypatch.setattr(wiki_lookup, "_search_cache", {})
    album_genres._cache.clear()


@pytest.fixture
def wiki(monkeypatch):
    state = {"hits": ["Twisted (Hallucinogen album)"], "pages": {"Twisted (Hallucinogen album)": BOX}, "fail": False, "calls": []}

    def fetch(url):
        state["calls"].append(url)
        if state["fail"]:
            raise OSError("down")
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        if q.get("list") == ["search"]:
            return {"query": {"search": [{"title": t} for t in state["hits"]]}}
        title = q["page"][0].replace("_", " ")
        return {"parse": {"wikitext": state["pages"].get(title, "")}}

    monkeypatch.setattr(wiki_lookup, "_fetch_json", fetch)
    return state


def ask(client, **body):
    return client.post("/albums/genres/suggest", json={"artist": "Hallucinogen", "title": "Twisted", **body}, headers=H)


def pairs(body):
    return [(s["name"], s["source"], s["mapped"]) for s in body["suggestions"]]


def test_infobox_genres_are_mapped_and_unmappable_ones_flagged(client, wiki):
    r = ask(client)
    assert r.status_code == 200
    body = r.json()
    assert body["wikipediaPage"] == "https://en.wikipedia.org/wiki/Twisted_(Hallucinogen_album)"
    assert body["searchError"] is None
    assert pairs(body) == [("psytrance", "wikipedia", "psytrance"), ("goa trance", "wikipedia", "goa trance"), ("zork core", "wikipedia", None)]
    assert [s["unmapped"] for s in body["suggestions"]] == [False, False, True]


def test_synonyms_resolve_and_sources_dedupe_in_order(client, wiki):
    body = ask(client, discogs=["Psy-Trance", "Electronic", "Goa Trance"], rym="Genres\nPsychedelic Trance, Techno").json()
    assert pairs(body) == [
        ("Psychedelic Trance", "rym", "psytrance"),
        ("Techno", "rym", "techno"),
        ("Electronic", "discogs", None),
        ("Goa Trance", "discogs", "goa trance"),
        ("zork core", "wikipedia", None),
    ]


def test_a_disambiguation_or_wrong_artist_page_is_refused(client, wiki):
    wiki["pages"]["Twisted (Hallucinogen album)"] = DISAMBIGUATION
    body = ask(client, discogs=["Ambient"]).json()
    assert body["wikipediaPage"] is None and body["searchError"] is None
    assert pairs(body) == [("Ambient", "discogs", "ambient")]
    album_genres._cache.clear()
    wiki["pages"]["Twisted (Hallucinogen album)"] = OTHER_ARTIST
    assert ask(client).json() == {"suggestions": [], "wikipediaPage": None, "searchError": None}


def test_not_found_is_not_an_error(client, wiki):
    wiki["hits"] = []
    assert ask(client).json() == {"suggestions": [], "wikipediaPage": None, "searchError": None}


def test_a_network_failure_keeps_the_other_sources(client, wiki):
    wiki["fail"] = True
    body = ask(client, discogs=["Ambient"], rym="Goa Trance").json()
    assert body["searchError"] == "wikipedia_failed"
    assert body["wikipediaPage"] is None
    assert pairs(body) == [("Goa Trance", "rym", "goa trance"), ("Ambient", "discogs", "ambient")]


def test_a_timeout_is_a_search_error(client, wiki, monkeypatch):
    monkeypatch.setattr(album_genres, "BUDGET_S", 0.05)
    release = threading.Event()

    def slow(artist, title):
        release.wait(2)
        return None, [], None

    monkeypatch.setattr(album_genres, "_lookup", slow)
    try:
        body = ask(client, discogs=["Ambient"]).json()
    finally:
        release.set()
    assert body["searchError"] == "wikipedia_failed"
    assert pairs(body) == [("Ambient", "discogs", "ambient")]


def test_an_unexpected_exception_never_raises(client, wiki, monkeypatch):
    def boom(artist, title):
        raise ValueError("bad")

    monkeypatch.setattr(album_genres, "_lookup", boom)
    r = ask(client)
    assert r.status_code == 200 and r.json()["searchError"] == "wikipedia_failed"


def test_rym_text_parsing():
    parse = album_genres.parse_rym
    assert parse("Genres\nPsychedelic Trance, Goa Trance\nTechno") == ["Psychedelic Trance", "Goa Trance", "Techno"]
    assert parse("Genres: Ambient; Dub • Drone | Noise") == ["Ambient", "Dub", "Drone", "Noise"]
    assert parse("Primary Genres Ambient\nSecondary Genres\nDrone\nDescriptors\nmeditative, calm") == ["Ambient", "Drone"]
    assert parse("https://rateyourmusic.com/release/album/x/, 1995, , " + "x" * 200 + ", Trance") == ["Trance"]
    assert parse(None) == parse(42) == parse("") == []


def test_rym_duplicates_and_junk_through_the_route(client, wiki):
    wiki["hits"] = []
    body = ask(client, rym="Genres, Ambient, ambient, 1995, https://x.example/a\nPsy-Trance\nPsychedelic Trance").json()
    assert pairs(body) == [("Ambient", "rym", "ambient"), ("Psy-Trance", "rym", "psytrance")]


def test_suggestions_are_capped(client, wiki):
    wiki["hits"] = []
    names = [f"made up genre {i}" for i in range(40)]
    body = ask(client, discogs=names).json()
    assert len(body["suggestions"]) == album_genres.MAX_SUGGESTIONS
    assert all(s["unmapped"] for s in body["suggestions"])


def test_the_second_call_uses_the_cache(client, wiki):
    ask(client)
    calls = len(wiki["calls"])
    assert calls > 0
    again = ask(client, artist="  HALLUCINOGEN ", title="twisted").json()
    assert len(wiki["calls"]) == calls
    assert again["wikipediaPage"] is not None


def test_not_found_is_cached_until_its_shorter_ttl_ends(client, wiki, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(album_genres, "_now", lambda: clock[0])
    wiki["hits"] = []
    ask(client)
    calls = len(wiki["calls"])
    ask(client)
    assert len(wiki["calls"]) == calls
    clock[0] += album_genres.MISSING_TTL_S + 1
    wiki["hits"] = ["Twisted (Hallucinogen album)"]
    wiki_lookup._search_cache.clear()
    assert ask(client).json()["wikipediaPage"] is not None
    assert album_genres.FAILED_TTL_S < album_genres.MISSING_TTL_S < album_genres.FOUND_TTL_S


def test_a_failure_is_cached_briefly(client, wiki, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(album_genres, "_now", lambda: clock[0])
    wiki["fail"] = True
    ask(client)
    calls = len(wiki["calls"])
    ask(client)
    assert len(wiki["calls"]) == calls
    clock[0] += album_genres.FAILED_TTL_S + 1
    wiki["fail"] = False
    assert ask(client).json()["searchError"] is None


def test_the_cache_is_bounded(monkeypatch):
    monkeypatch.setattr(album_genres, "CACHE_MAX", 3)
    for i in range(5):
        album_genres._put(str(i), (None, [], None))
    assert list(album_genres._cache) == ["2", "3", "4"]


def test_a_bad_body_gets_a_tolerant_empty_answer(client, wiki):
    r = client.post("/albums/genres/suggest", json={"artist": 5, "title": None, "discogs": "x", "rym": 7}, headers=H)
    assert r.json() == {"suggestions": [], "wikipediaPage": None, "searchError": None}
    assert wiki["calls"] == []
    assert client.post("/albums/genres/suggest", json=[1], headers=H).status_code == 422


def test_a_guest_or_anonymous_caller_gets_401(multi):
    assert multi.post("/albums/genres/suggest", json={"artist": "A", "title": "B"}).status_code == 401
    assert multi.post("/albums/genres/suggest", json={"artist": "A", "title": "B"}, headers=who(multi, ALICE)).status_code == 200
