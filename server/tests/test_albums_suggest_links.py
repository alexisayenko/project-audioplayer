import pytest

from app import discogs_lookup, wiki_lookup
from tests.test_library import H, client  # noqa: F401

MASTER = {"id": 3001, "type": "master", "title": "Hallucinogen - Twisted", "year": "1995"}
RELEASE = {"title": "Twisted", "artists": [{"name": "Hallucinogen"}], "year": 1995, "genres": ["Electronic"], "styles": ["Psy-Trance"], "formats": [{"name": "CD", "descriptions": ["Album"]}], "tracklist": []}


def ask(client, **body):
    return client.post("/albums/suggest-links", json={"artist": "Hallucinogen", "title": "Twisted", "year": 1995, **body}, headers=H)


@pytest.fixture
def discogs_search(monkeypatch):
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    state = {"masters": [MASTER], "releases": []}

    def get(path, params=None):
        if path == "database/search":
            return {"results": state["masters"] if params["type"] == "master" else state["releases"]}
        if path == "masters/3001":
            return {"main_release": 77001}
        if path == "releases/77001":
            return RELEASE
        return {}

    monkeypatch.setattr(discogs_lookup, "_get", get)
    return state


@pytest.fixture
def wiki(monkeypatch):
    state = {"hits": [], "infobox": {}}
    monkeypatch.setattr(wiki_lookup, "_search", lambda query: state["hits"])
    monkeypatch.setattr(wiki_lookup, "infobox", lambda url: state["infobox"])
    return state


def test_a_master_and_a_disambiguated_article_are_found(client, discogs_search, wiki):
    wiki["hits"] = ["Twisted (Other band album)", "Twisted (Hallucinogen album)"]
    body = ask(client).json()
    assert body["discogs"] == "https://www.discogs.com/master/3001"
    assert body["wikipedia"] == "https://en.wikipedia.org/wiki/Twisted_(Hallucinogen_album)"
    assert (body["candidates"], body["searchError"]) == ([], None)


def test_a_bare_title_needs_the_artist_in_its_infobox(client, discogs_search, wiki):
    wiki["hits"] = ["Twisted"]
    wiki["infobox"] = {"artist": "Somebody Else"}
    assert ask(client).json()["wikipedia"] is None
    wiki["infobox"] = {"artist": "Hallucinogen"}
    assert ask(client).json()["wikipedia"] == "https://en.wikipedia.org/wiki/Twisted"


def test_other_titles_and_other_pages_are_refused(client, discogs_search, wiki):
    wiki["hits"] = ["Twisted (film)", "Twisted Sister", "Twisted (album)x", "Twisted Tour (album)"]
    assert ask(client).json()["wikipedia"] is None
    wiki["hits"] = ["Twisted (album)"]
    assert ask(client).json()["wikipedia"] == "https://en.wikipedia.org/wiki/Twisted_(album)"


def test_without_a_master_a_matching_release_is_taken(client, discogs_search, wiki):
    discogs_search["masters"] = []
    discogs_search["releases"] = [{"id": 77001, "type": "release", "title": "Hallucinogen - Twisted", "year": "1995", "format": ["CD", "Album"]}]
    body = ask(client).json()
    assert body["discogs"] == "https://www.discogs.com/release/77001"


def test_a_different_year_or_title_gives_candidates_not_a_link(client, discogs_search, wiki):
    discogs_search["masters"] = []
    discogs_search["releases"] = [{"id": 77001, "type": "release", "title": "Hallucinogen - Twisted", "year": "1995", "format": ["CD"]}]
    body = ask(client, year=2010).json()
    assert body["discogs"] is None
    assert [c["id"] for c in body["candidates"]] == [77001]


def test_without_a_token_discogs_is_unavailable_but_wikipedia_still_answers(client, monkeypatch, wiki):
    monkeypatch.delenv("DISCOGS_TOKEN", raising=False)
    wiki["hits"] = ["Twisted (Hallucinogen album)"]
    body = ask(client).json()
    assert (body["discogs"], body["searchError"]) == (None, "discogs_unavailable")
    assert body["wikipedia"]


def test_failures_are_silent(client, monkeypatch):
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    monkeypatch.setattr(discogs_lookup, "_get", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    monkeypatch.setattr(wiki_lookup, "_search", lambda query: (_ for _ in ()).throw(OSError("down")))
    r = ask(client)
    assert r.status_code == 200
    assert (r.json()["discogs"], r.json()["wikipedia"]) == (None, None)
    assert ask(client, artist=None, title=None, year="x").status_code == 200


def test_the_route_needs_a_login(client):
    assert client.post("/albums/suggest-links", json={"artist": "a", "title": "b"}).status_code == 401
