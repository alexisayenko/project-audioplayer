import pytest

from app import discogs_lookup as dl


def hit(rid, title, year, **kw):
    return {"id": rid, "type": "release", "title": title, "year": str(year) if year else "", **kw}


def release(rid, artist, tracks, year, genres=("Electronic",), styles=(), country="Germany", master=None):
    return {
        "id": rid, "year": year, "country": country, "genres": list(genres), "styles": list(styles), "master_id": master,
        "artists": [{"name": artist}], "tracklist": [{"title": t} for t in tracks],
    }


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setenv("DISCOGS_TOKEN", "test-token")
    monkeypatch.delenv("AUDIO_TAG_LOOKUP", raising=False)
    monkeypatch.delenv("AUDIO_GENRE_LOOKUP", raising=False)
    dl._cache.clear()
    dl._window.clear()


def fake(results, details, calls=None):
    def _get(path, params=None):
        if calls is not None:
            calls.append(path)
        if path == "database/search":
            return {"results": results}
        return details[int(path.rsplit("/", 1)[1])]

    return _get


def test_off_without_a_token_and_with_the_lookup_switch(monkeypatch):
    monkeypatch.delenv("DISCOGS_TOKEN")
    assert not dl.enabled() and dl.suggest("A", "B")["tags"] == []
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    monkeypatch.setenv("AUDIO_TAG_LOOKUP", "0")
    assert not dl.enabled()


def test_styles_win_over_genres_year_country_and_master_url(monkeypatch):
    res = [hit(1, "Armin van Buuren - A State of Trance", 2004)]
    det = {1: release(1, "Armin van Buuren", ["Intro", "Burned With Desire"], 2004, ("Electronic",), ("Trance", "Progressive Trance"), "Netherlands", master=77)}
    monkeypatch.setattr(dl, "_get", fake(res, det))
    out = dl.suggest("Armin van Buuren", "Burned With Desire")
    assert out["tags"] == ["genre:trance", "genre:progressive trance", "country:nl"]
    assert out["year"] == 2004 and out["country"] == "country:nl"
    assert out["url"] == "https://www.discogs.com/master/77"


def test_broad_genre_only_when_there_are_no_styles_and_cap_four(monkeypatch):
    res = [hit(1, "Band - Album", 1990)]
    det = {1: release(1, "Band", ["Song"], 1990, ("Rock", "Pop", "Folk, World, & Country", "Funk / Soul", "Jazz"), (), "")}
    monkeypatch.setattr(dl, "_get", fake(res, det))
    assert dl.suggest("Band", "Song")["tags"] == ["genre:rock", "genre:pop", "genre:funk / soul", "genre:jazz"]
    dl._cache.clear()
    det[1]["styles"] = ["A", "B", "C", "D", "E"]
    assert dl.suggest("Band", "Song")["tags"] == ["genre:a", "genre:b", "genre:c", "genre:d"]


def test_earliest_year_among_strong_matches_and_fuzzy_artist(monkeypatch):
    res = [hit(1, "Daft Punk - Homework (Reissue)", 2010), hit(2, "Daft Punk - Homework", 1997), hit(3, "Other Artist - Thing", 1980)]
    det = {1: release(1, "Daft Punk", ["Around The World"], 2010, styles=("House",)), 2: release(2, "Daft Punk", ["Around The World"], 1997, styles=("French House",))}
    calls = []
    monkeypatch.setattr(dl, "_get", fake(res, det, calls))
    out = dl.suggest("daft punk", "Around the World (Official Video)")
    assert out["year"] == 1997 and out["tags"][0] == "genre:french house"
    assert calls == ["database/search", "releases/2"]


def test_artist_number_suffix_and_the_prefix_match(monkeypatch):
    res = [hit(1, "The Prodigy (2) - Music", 1997)]
    det = {1: release(1, "The Prodigy", ["Firestarter"], 1997, styles=("Breakbeat",))}
    monkeypatch.setattr(dl, "_get", fake(res, det))
    assert dl.suggest("Prodigy", "Firestarter")["tags"][0] == "genre:breakbeat"


def test_track_must_be_on_the_release_next_candidate_is_tried(monkeypatch):
    res = [hit(1, "Artist - Early", 1990), hit(2, "Artist - Later", 1995)]
    det = {1: release(1, "Artist", ["Something Else"], 1990, styles=("Wrong",)), 2: release(2, "Artist", ["Wanted Song"], 1995, styles=("Right",))}
    monkeypatch.setattr(dl, "_get", fake(res, det))
    out = dl.suggest("Artist", "Wanted Song")
    assert out["tags"][0] == "genre:right" and out["year"] == 1995


def test_various_is_used_only_without_a_direct_match_and_gives_no_year(monkeypatch):
    res = [hit(1, "Various - Club Hits 2005", 2005), hit(2, "Artist - Single", 2001)]
    det = {1: release(1, "Various", ["Song"], 2005, styles=("Hardstyle",)), 2: release(2, "Artist", ["Song"], 2001, styles=("Trance",))}
    monkeypatch.setattr(dl, "_get", fake(res, det))
    assert dl.suggest("Artist", "Song")["year"] == 2001
    dl._cache.clear()
    monkeypatch.setattr(dl, "_get", fake(res[:1], det))
    out = dl.suggest("Artist", "Song")
    assert out["tags"] == ["genre:hardstyle"] and out["year"] is None and out["country"] is None
    assert dl.rank(res, "Artist")[0]["id"] == 2


def test_unknown_country_dropped(monkeypatch):
    res = [hit(1, "A - B", 2000)]
    det = {1: release(1, "A", ["S"], 2000, styles=("Techno",), country="Atlantis")}
    monkeypatch.setattr(dl, "_get", fake(res, det))
    out = dl.suggest("A", "S")
    assert out["tags"] == ["genre:techno"] and out["country"] is None


def test_no_match_other_artists_and_empty_results(monkeypatch):
    monkeypatch.setattr(dl, "_get", fake([hit(1, "Someone Else - X", 2000)], {}))
    assert dl.suggest("Artist", "Song")["url"] is None
    monkeypatch.setattr(dl, "_get", fake([], {}))
    assert dl.suggest("Artist", "Song2")["tags"] == []


def test_cache_makes_one_search_and_no_match_is_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(dl, "_get", fake([], {}, calls))
    dl.suggest("A", "B")
    dl.suggest("a", "b")
    assert calls == ["database/search"]


@pytest.mark.parametrize("exc", [OSError("timeout"), ValueError("bad json"), RuntimeError("401")])
def test_failures_are_silent_and_not_cached(monkeypatch, exc):
    calls = []

    def boom(path, params=None):
        calls.append(path)
        raise exc

    monkeypatch.setattr(dl, "_get", boom)
    assert dl.suggest("A", "B") == dl._empty()
    dl.suggest("A", "B")
    assert len(calls) == 2


def test_limiter_never_exceeds_fifty_per_minute(monkeypatch):
    now = [1000.0]
    slept = []

    def sleep(s):
        slept.append(s)
        now[0] += s

    monkeypatch.setattr(dl.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(dl.time, "sleep", sleep)
    for i in range(50):
        now[0] = 1000.0 + i
        dl._acquire()
    assert slept == []
    dl._acquire()
    assert sum(slept) == pytest.approx(11, abs=0.01)
    assert len(dl._window) <= 50


def test_limiter_refuses_instead_of_waiting_too_long(monkeypatch):
    monkeypatch.setattr(dl.time, "monotonic", lambda: 1000.0)
    monkeypatch.setattr(dl.time, "sleep", lambda s: None)
    for _ in range(50):
        dl._acquire()
    with pytest.raises(RuntimeError):
        dl._acquire()


def test_request_carries_the_token_and_a_user_agent(monkeypatch):
    seen = {}

    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"results": []}'

    def urlopen(req, timeout):
        seen["h"] = dict(req.header_items())
        seen["timeout"] = timeout
        seen["url"] = req.full_url
        return Resp()

    monkeypatch.setattr(dl.urllib.request, "urlopen", urlopen)
    assert dl._get("database/search", {"type": "release"}) == {"results": []}
    assert seen["h"]["Authorization"] == "Discogs token=test-token"
    assert "audioplayer" in seen["h"]["User-agent"] and seen["timeout"] == 8
    assert "test-token" not in seen["url"]


@pytest.mark.parametrize("value,want", [
    ("https://www.discogs.com/release/123-Some-Title", "https://www.discogs.com/release/123"),
    ("http://discogs.com/master/9", "https://www.discogs.com/master/9"),
    ("https://www.discogs.com/de/release/5/", "https://www.discogs.com/release/5"),
])
def test_clean_url(value, want):
    assert dl.clean_url(value) == want


@pytest.mark.parametrize("value", [None, 3, "", "https://evil.example/release/1", "https://www.discogs.com/artist/1", "https://discogs.com.evil.example/release/1", "https://www.discogs.com/release/x", "javascript:1"])
def test_clean_url_rejects_others(value):
    assert dl.clean_url(value) is None
