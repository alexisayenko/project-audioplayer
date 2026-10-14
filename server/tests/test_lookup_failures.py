import io
import json
import urllib.error

import pytest

from app import discogs_lookup as dl
from app import genre_lookup as gl
from app import wiki_lookup as wl
from app import httpjson, ratelimit


class Resp:
    def __init__(self, body):
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.body


def http_error(code):
    return urllib.error.HTTPError("https://x", code, "err", {}, io.BytesIO(b""))


# ---- MusicBrainz (genre_lookup._get) -------------------------------------------------------

@pytest.fixture
def mb_clock(monkeypatch):
    state = {"now": 100.0, "sleeps": []}
    monkeypatch.setattr(gl.time, "monotonic", lambda: state["now"])
    monkeypatch.setattr(gl.time, "sleep", lambda s: state["sleeps"].append(s))
    monkeypatch.setattr(gl._limiter, "last_call", 0.0)
    return state


def test_mb_503_is_retried_once_after_a_delay(monkeypatch, mb_clock):
    calls = []

    def fake(req, timeout):
        calls.append(req.full_url)
        if len(calls) == 1:
            raise http_error(503)
        return Resp({"ok": 1})

    monkeypatch.setattr(httpjson.urllib.request, "urlopen", fake)
    assert gl._get("recording", {"query": "a b"}) == {"ok": 1}
    assert len(calls) == 2
    assert gl.RETRY_DELAY in mb_clock["sleeps"]
    assert "query=a+b" in calls[0]


def test_mb_503_twice_raises(monkeypatch, mb_clock):
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: (_ for _ in ()).throw(http_error(503)))
    with pytest.raises(urllib.error.HTTPError):
        gl._get("recording", {})


@pytest.mark.parametrize("code", [400, 404, 429, 500])
def test_mb_other_http_errors_are_not_retried(monkeypatch, mb_clock, code):
    calls = []
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: calls.append(1) or (_ for _ in ()).throw(http_error(code)))
    with pytest.raises(urllib.error.HTTPError):
        gl._get("recording", {})
    assert len(calls) == 1


def test_mb_rate_limiter_waits_the_remaining_interval(monkeypatch, mb_clock):
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: Resp({}))
    gl._get("a", {})
    gl._get("b", {})
    assert mb_clock["sleeps"] == [pytest.approx(gl.MIN_INTERVAL)]


@pytest.mark.parametrize("body", [b"", b"<html>", b"\xff"])
def test_mb_malformed_body_raises_and_lookup_degrades_to_empty(monkeypatch, mb_clock, body):
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: Resp(body))
    with pytest.raises(ValueError):
        gl._get("recording", {})
    assert gl.lookup("Some Artist", "Some Title")["tags"] == []


def test_mb_lookup_with_empty_title_or_artist_does_no_request(monkeypatch):
    monkeypatch.setattr(gl, "_get", lambda *a, **k: pytest.fail("network used"))
    assert gl.lookup("", "Title") == gl._empty()
    assert gl.lookup("Artist", "") == gl._empty()


def test_mb_release_key_requires_a_title():
    assert gl._release_key({"title": "  "}, "A") is None
    assert gl._release_key({}, "A") is None


def test_mb_disabled_switches(monkeypatch):
    monkeypatch.setenv("AUDIO_TAG_LOOKUP", "off")
    assert not gl.enabled()
    monkeypatch.setenv("AUDIO_TAG_LOOKUP", "1")
    monkeypatch.setenv("AUDIO_GENRE_LOOKUP", "0")
    assert not gl.enabled()
    monkeypatch.delenv("AUDIO_GENRE_LOOKUP")
    assert gl.enabled()


# ---- Discogs -------------------------------------------------------------------------------

@pytest.fixture
def discogs(monkeypatch):
    monkeypatch.setenv("DISCOGS_TOKEN", "tok")
    dl._cache.clear()
    dl._limiter.window.clear()
    yield
    dl._cache.clear()
    dl._limiter.window.clear()


def test_discogs_off_without_token(monkeypatch):
    monkeypatch.delenv("DISCOGS_TOKEN", raising=False)
    assert not dl.enabled()
    assert dl.suggest("A", "T") == dl._empty()


def test_discogs_rate_limiter_waits_then_refuses(monkeypatch, discogs):
    now = {"t": 1000.0}
    sleeps = []
    monkeypatch.setattr(ratelimit.time, "monotonic", lambda: now["t"])
    monkeypatch.setattr(ratelimit.time, "sleep", lambda s: (sleeps.append(s), now.__setitem__("t", now["t"] + s)))
    for _ in range(dl.MAX_PER_MINUTE):
        dl._acquire()
    assert sleeps == []
    now["t"] += 50
    dl._acquire()
    assert sleeps == [pytest.approx(10)]
    dl._limiter.window.clear()
    dl._limiter.window.extend([now["t"]] * dl.MAX_PER_MINUTE)
    now["t"] += 1
    monkeypatch.setattr(dl._limiter, "max_wait", 5.0)
    with pytest.raises(RuntimeError, match="rate limit"):
        dl._acquire()


def test_discogs_window_expires_after_a_minute(monkeypatch, discogs):
    now = {"t": 5000.0}
    monkeypatch.setattr(ratelimit.time, "monotonic", lambda: now["t"])
    monkeypatch.setattr(ratelimit.time, "sleep", lambda s: pytest.fail("should not wait"))
    dl._limiter.window.extend([now["t"] - 60] * dl.MAX_PER_MINUTE)
    dl._acquire()
    assert len(dl._limiter.window) == 1


def test_discogs_get_sends_token_and_accept_headers(monkeypatch, discogs):
    seen = {}
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: seen.update(req=req, timeout=timeout) or Resp({"a": 1}))
    assert dl._get("database/search", {"q": "x y"}) == {"a": 1}
    assert seen["req"].get_header("Authorization") == "Discogs token=tok"
    assert "q=x+y" in seen["req"].full_url
    assert seen["timeout"] == dl.TIMEOUT


@pytest.mark.parametrize("value,expected", [("1999", 1999), (1999, 1999), ("x", None), (None, None), ("999", None), ("3000", None), (2999, 2999), ("", None)])
def test_discogs_year_bounds(value, expected):
    assert dl._year(value) == expected


def test_discogs_similarity_empty_names_never_match():
    assert not dl._similar("", "A")
    assert not dl._similar("A", "")
    assert not dl._similar("!!!", "A")
    assert dl._similar("Daft Punk", "Daft Punk (2)")


def test_discogs_rank_drops_foreign_non_release_and_idless_results():
    results = [
        {"id": 1, "title": "Daft Punk - X", "year": "2001", "type": "release"},
        {"id": 2, "title": "Daft Punk - Y", "year": "1997", "type": "master"},
        {"title": "Daft Punk - Z", "year": "1990"},
        {"id": 3, "title": "Someone Else - Q", "year": "1980"},
        {"id": 4, "title": "Various - Comp", "year": "1995"},
        {"id": 5, "title": "Daft Punk - W", "year": "oops"},
    ]
    assert [r["id"] for r in dl.rank(results, "Daft Punk")] == [1, 5, 4]


def _search(items):
    return {"results": items}


def test_discogs_failed_verification_of_every_candidate_raises_and_suggest_is_empty(monkeypatch, discogs):
    items = [{"id": i, "title": "Artist - T", "year": str(2000 + i)} for i in range(5)]
    calls = []

    def fake(path, params=None):
        calls.append(path)
        if path == "database/search":
            return _search(items)
        raise OSError("down")

    monkeypatch.setattr(dl, "_get", fake)
    assert dl.suggest("Artist", "T") == dl._empty()
    assert len([c for c in calls if c.startswith("releases/")]) == dl.VERIFY_TRIES


def test_discogs_one_failure_then_a_match_is_accepted(monkeypatch, discogs):
    items = [{"id": 1, "title": "Artist - T", "year": "2000"}, {"id": 2, "title": "Artist - T", "year": "2001"}]

    def fake(path, params=None):
        if path == "database/search":
            return _search(items)
        if path == "releases/1":
            raise OSError("boom")
        return {"id": 2, "year": 2001, "country": "Germany", "styles": ["House"], "artists": [{"name": "Artist"}], "tracklist": [{"title": "T"}]}

    monkeypatch.setattr(dl, "_get", fake)
    got = dl.suggest("Artist", "T")
    assert got["url"] == "https://www.discogs.com/release/2"
    assert got["year"] == 2001
    assert "country:de" in got["tags"]
    assert "genre:house" in got["tags"]
    assert got["country"] == "country:de"


def test_discogs_various_compilation_has_no_year_or_country(monkeypatch, discogs):
    def fake(path, params=None):
        if path == "database/search":
            return _search([{"id": 9, "title": "Various - Hits", "year": "1999"}])
        return {"id": 9, "year": 1999, "country": "UK", "genres": ["Electronic"], "master_id": 77, "tracklist": [{"title": "T"}]}

    monkeypatch.setattr(dl, "_get", fake)
    got = dl.suggest("Artist", "T")
    assert got["year"] is None
    assert got["country"] is None
    assert got["url"] == "https://www.discogs.com/master/77"
    assert got["tags"] == ["genre:electronic"]


def test_discogs_no_tracklist_match_and_empty_search_give_empty(monkeypatch, discogs):
    monkeypatch.setattr(dl, "_get", lambda path, params=None: _search([{"id": 1, "title": "Artist - Other", "year": "2000"}]) if path.startswith("database") else {"tracklist": [{"title": "Completely Different Song"}]})
    assert dl.suggest("Artist", "Zebra") == dl._empty()
    dl._cache.clear()
    monkeypatch.setattr(dl, "_get", lambda path, params=None: {"results": None})
    assert dl.suggest("Artist", "Zebra") == dl._empty()


def test_discogs_result_is_cached_per_query(monkeypatch, discogs):
    n = []

    def fake(path, params=None):
        n.append(path)
        if path == "database/search":
            return _search([{"id": 1, "title": "Artist - T", "year": "2000"}])
        return {"id": 1, "year": 2000, "styles": ["Techno"], "tracklist": [{"title": "T"}]}

    monkeypatch.setattr(dl, "_get", fake)
    first = dl.suggest("Artist", "T")
    first["tags"].append("mutated")
    again = dl.suggest("Artist", "T")
    assert again["tags"] == ["genre:techno"]
    assert len(n) == 2


def test_discogs_empty_names_short_circuit(monkeypatch, discogs):
    monkeypatch.setattr(dl, "_get", lambda *a, **k: pytest.fail("network used"))
    assert dl.suggest("", "T") == dl._empty()
    assert dl.suggest("A", "") == dl._empty()


@pytest.mark.parametrize("value,expected", [
    ("https://www.discogs.com/release/12-Name", "https://www.discogs.com/release/12"),
    ("https://discogs.com/de/master/5", "https://www.discogs.com/master/5"),
    ("https://www.discogs.com/artist/5", None), ("https://evil.example/release/5", None), ("https://www.discogs.com.evil.io/release/5", None),
    ("javascript:alert(1)", None), (None, None), (5, None), ("", None),
])
def test_discogs_clean_url(value, expected):
    assert dl.clean_url(value) == expected


def test_discogs_tags_cap_dedupe_and_genre_fallback():
    assert dl._tags({"styles": ["A", "a", "B", "C", "D", "E"]}) == ["genre:a", "genre:b", "genre:c", "genre:d"]
    assert dl._tags({"genres": ["Rock", "Folk, World, & Country"]}) == ["genre:rock"]
    assert dl._tags({}) == []


# ---- Wikidata / Wikipedia failure paths ----------------------------------------------------

@pytest.fixture
def wiki(monkeypatch):
    for c in (wl._entities, wl._claims, wl._labels, wl._qid_of_page, wl._infobox_cache):
        c.clear()
    yield
    for c in (wl._entities, wl._claims, wl._labels, wl._qid_of_page, wl._infobox_cache):
        c.clear()


def boom(*a, **k):
    raise OSError("down")


def test_wiki_entity_failure_is_none_and_not_cached(monkeypatch, wiki):
    monkeypatch.setattr(wl, "_fetch_json", boom)
    assert wl._entity("Q1") is None
    assert "Q1" not in wl._entities
    monkeypatch.setattr(wl, "_fetch_json", lambda url: {"entities": {"Q1": {"claims": {}}}})
    assert wl._entity("Q1") == {"claims": {}}


def test_wiki_entity_redirect_uses_the_only_entity(monkeypatch, wiki):
    monkeypatch.setattr(wl, "_fetch_json", lambda url: {"entities": {"Q2": {"id": "Q2"}}})
    assert wl._entity("Q1") == {"id": "Q2"}


def test_wiki_claims_and_labels_failures_degrade_to_empty(monkeypatch, wiki):
    monkeypatch.setattr(wl, "_fetch_json", boom)
    assert wl._claims_map(["Q1"]) == {}
    assert wl._label_map(["Q1"]) == {}


def test_wiki_labels_without_english_label_are_skipped(monkeypatch, wiki):
    monkeypatch.setattr(wl, "_fetch_json", lambda url: {"entities": {"Q1": {"labels": {}}, "Q2": {"labels": {"en": {"value": "Rock"}}}}})
    assert wl._label_map(["Q1", "Q2"]) == {"Q2": "Rock"}


def test_wiki_country_from_invalid_iso_code_is_ignored(monkeypatch, wiki):
    def entity(code):
        return {"Q9": {"claims": {"P297": [{"mainsnak": {"snaktype": "value", "datavalue": {"value": code}}}]}}}

    artist = {"P495": [{"mainsnak": {"snaktype": "value", "datavalue": {"value": {"id": "Q9"}}}}]}
    for code in ("ZZ", "USA", "1", "Atlantis"):
        wl._claims.clear()
        monkeypatch.setattr(wl, "_fetch_json", lambda url, code=code: {"entities": entity(code)})
        assert wl._country_tags(artist, {}) == []
    wl._claims.clear()
    monkeypatch.setattr(wl, "_fetch_json", lambda url: {"entities": entity("DE")})
    assert wl._country_tags(artist, {}) == ["country:de"]


def test_wiki_year_needs_day_or_better_precision_and_takes_the_earliest():
    def c(time, precision):
        return {"mainsnak": {"snaktype": "value", "datavalue": {"value": {"time": time, "precision": precision}}}}

    assert wl._year({"P577": [c("+2001-05-01T00:00:00Z", 11), c("+1999-01-01T00:00:00Z", 9), c("+1980-00-00T00:00:00Z", 8)]}) == 1999
    assert wl._year({"P577": [c("garbage", 11)]}) is None
    assert wl._year({}) is None


def test_wiki_values_prefer_preferred_rank_and_drop_deprecated():
    def c(v, rank):
        return {"rank": rank, "mainsnak": {"snaktype": "value", "datavalue": {"value": v}}}

    assert wl._values({"P": [c("a", "normal"), c("b", "preferred"), c("c", "deprecated")]}, "P") == ["b"]
    assert wl._values({"P": [c("a", "normal"), c("c", "deprecated")]}, "P") == ["a"]
    assert wl._values({"P": [{"mainsnak": {"snaktype": "novalue"}}]}, "P") == []


@pytest.mark.parametrize("wikitext,expected", [
    ("{{Infobox song\n| name = [[File:x.jpg|thumb]]Title\n| genre = {{hlist|[[House music|House]]|Disco}}\n}}", ["house", "disco"]),
    ("{{Infobox song\n| genre = {{nowrap|[[Pop]]}}\n}}", ["pop"]),
    ("{{Infobox song\n| genre = {{unknowntpl|zzz}}\n}}", []),
    ("{{Infobox song\n| genre = Rock\n| genre = Metal\n}}", ["rock"]),
    ("{{Infobox song\n| no equals sign\n| genre = Jazz\n}}", ["jazz"]),
    ("no infobox here", []),
    ("{{Infobox song\n| genre = never closed", []),
    ("", []),
])
def test_wiki_infobox_genres(wikitext, expected):
    assert [g.lower() for g in wl.parse_infobox(wikitext)["genres"]] == expected


def test_wiki_parse_infobox_swallows_internal_errors(monkeypatch):
    monkeypatch.setattr(wl, "_split_top", boom)
    assert wl.parse_infobox("{{Infobox song\n| genre = Rock\n}}") == wl._empty_infobox()


def test_wiki_infobox_only_for_english_wikipedia_and_failures_are_empty(monkeypatch, wiki):
    monkeypatch.setattr(wl, "_fetch_json", lambda url: pytest.fail("fetched " + url))
    for url in (None, "", "https://de.wikipedia.org/wiki/X", "https://evil.example/wiki/X", "https://en.wikipedia.org/other"):
        assert wl.infobox(url) == wl._empty_infobox()
    monkeypatch.setattr(wl, "_fetch_json", boom)
    assert wl.infobox("https://en.wikipedia.org/wiki/X") == wl._empty_infobox()
    monkeypatch.setattr(wl, "_fetch_json", lambda url: {"parse": {"wikitext": 5}})
    assert wl.infobox("https://en.wikipedia.org/wiki/Y") == wl._empty_infobox()


def test_wiki_infobox_is_cached_and_callers_cannot_mutate_it(monkeypatch, wiki):
    n = []
    monkeypatch.setattr(wl, "_fetch_json", lambda url: n.append(url) or {"parse": {"wikitext": "{{Infobox song\n| genre = Rock\n}}"}})
    wl.infobox("https://en.wikipedia.org/wiki/Z")["genres"].append("hacked")
    assert wl.infobox("https://en.wikipedia.org/wiki/Z")["genres"] == ["rock"]
    assert len(n) == 1


def test_wiki_facts_degrade_on_failure(monkeypatch, wiki):
    monkeypatch.setattr(wl, "_entity", lambda q: {"claims": {"P136": [{"mainsnak": {"snaktype": "value", "datavalue": {"value": {"id": "Q5"}}}}]}})
    monkeypatch.setattr(wl, "_label_map", boom)
    assert wl.facts("Q1", "Q2") == {"tags": [], "song_genres": [], "year": None}
    assert wl.facts(None, None) == {"tags": [], "song_genres": [], "year": None}


def test_wiki_suggest_and_from_links_never_raise(monkeypatch, wiki):
    monkeypatch.setattr(gl, "lookup", boom)
    got = wl.suggest("A", "T")
    assert got["tags"] == []
    assert got["wikipedia_song"] is None
    monkeypatch.setattr(wl, "facts", boom)
    got = wl.from_links("https://en.wikipedia.org/wiki/Song", "https://en.wikipedia.org/wiki/Artist")
    assert got["tags"] == []
    assert got["year"] is None


def test_wiki_suggest_disabled_makes_no_requests(monkeypatch, wiki):
    monkeypatch.setenv("AUDIO_TAG_LOOKUP", "0")
    monkeypatch.setattr(gl, "lookup", boom)
    assert wl.suggest("A", "T")["wikipedia_song"] is None
    assert wl.from_links("https://en.wikipedia.org/wiki/S", None)["wikipedia_song"] is None


def test_wiki_qid_of_page_failure_and_bad_qid(monkeypatch, wiki):
    url = "https://en.wikipedia.org/wiki/Some_Page"
    monkeypatch.setattr(wl, "_fetch_json", boom)
    assert wl.qid_of_page(url) is None
    monkeypatch.setattr(wl, "_fetch_json", lambda u: {"query": {"pages": {"1": {"pageprops": {"wikibase_item": "not-a-qid"}}}}})
    assert wl.qid_of_page(url) is None
    wl._qid_of_page.clear()
    monkeypatch.setattr(wl, "_fetch_json", lambda u: {"query": {"pages": {"1": {"pageprops": {"wikibase_item": "Q42"}}}}})
    assert wl.qid_of_page(url) == "Q42"
    assert wl.qid_of_page("") is None


@pytest.mark.parametrize("value", [
    "javascript:alert(1)", "https://evil.example/wiki/X", "https://wikipedia.org.evil.io/wiki/X", "https://en.wikipedia.org/x", "",
    None, 5, "https://www.wikidata.org/wiki/Special:Search", "https://en.wikipedia.org/wiki/",
])
def test_wiki_clean_link_rejects(value):
    assert wl.clean_link(value) is None


def test_wiki_clean_link_accepts_and_normalises_wikidata():
    assert wl.clean_link("https://en.wikipedia.org/wiki/Daft_Punk") == "https://en.wikipedia.org/wiki/Daft_Punk"
    assert wl.clean_link("https://m.wikidata.org/wiki/Q42") == "https://www.wikidata.org/wiki/Q42"


# ---- remaining small branches ----------------------------------------------------------------

def test_wiki_fetch_json_sends_agent_and_parses(monkeypatch):
    seen = {}
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: seen.update(req=req, timeout=timeout) or Resp({"a": 1}))
    monkeypatch.setenv("AUDIO_MB_USER_AGENT", "ua/2")
    assert wl._fetch_json("https://www.wikidata.org/x") == {"a": 1}
    assert seen["req"].get_header("User-agent") == "ua/2"
    assert seen["timeout"] == wl.TIMEOUT


def test_mb_work_relation_failure_and_artist_without_id(monkeypatch):
    full = {"relations": [{"work": {"id": "w1"}}, {"work": {"id": "w2"}}]}
    calls = []
    monkeypatch.setattr(gl, "_get", lambda path, params: calls.append(path) or (_ for _ in ()).throw(OSError("down")))
    assert gl._work_rels(full) == []
    assert calls == ["work/w1"]
    assert gl._work_rels({"relations": [{"url": {}}, {"work": {}}]}) == []
    assert gl._artist_info("X", [{"name": "X", "artist": {}}], ["genre:rock"]) == (["genre:rock"], [], [])
    assert gl._artist_info("X", [{"name": "X", "artist": {"id": "a1", "name": "X"}}], ["genre:rock"]) == (["genre:rock"], [], [])


def test_metadata_cap_tags_drops_unknown_countries():
    from app import metadata
    assert metadata.cap_tags(["country:Atlantis", "country:de", "country:fr", "lang:ru", "rock"]) == ["country:de", "rock"]


def test_discogs_short_titles_match_exactly_only():
    assert not dl._title_similar("A", "Alone")
    assert not dl._title_similar("Ab", "Abba")
    assert not dl._title_similar("", "A")
    assert dl._title_similar("A", "A")
    assert dl._title_similar("Ab", "ab!")
    assert dl._title_similar("Intro", "Intro (Remastered)")
    assert not dl._has_track({"tracklist": [{"title": "Alone"}, {"title": "Blue"}]}, "A")
    assert dl._has_track({"tracklist": [{"title": "A"}]}, "A")
