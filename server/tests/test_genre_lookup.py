import pytest
from fastapi.testclient import TestClient

from app import extractor, genre_lookup as gl, main, wiki_lookup as wl


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    gl._cache.clear()
    monkeypatch.setattr(gl.time, "sleep", lambda s: None)
    monkeypatch.delenv("AUDIO_GENRE_LOOKUP", raising=False)
    monkeypatch.delenv("AUDIO_TAG_LOOKUP", raising=False)


def fake_get(recs, rec_full=None, artist_full=None, calls=None):
    def _get(path, params):
        if calls is not None:
            calls.append(path)
        if path == "recording/":
            return {"recordings": recs}
        if path.startswith("recording/"):
            return rec_full or {}
        return artist_full or {}

    return _get


REC = {"id": "r1", "score": 100, "artist-credit": [{"name": "Daft Punk", "artist": {"id": "a1", "name": "Daft Punk"}}]}


def test_match_top_three_by_votes(monkeypatch):
    full = {
        "genres": [{"name": "House", "count": 5}, {"name": "electronic", "count": 9}],
        "tags": [{"name": "french house", "count": 3}, {"name": "pop", "count": 1}],
    }
    monkeypatch.setattr(gl, "_get", fake_get([REC], full))
    assert gl.suggest_tags("Daft Punk", "Around the World") == ["genre:electronic", "genre:house", "genre:french house"]


def test_artist_fallback(monkeypatch):
    monkeypatch.setattr(gl, "_get", fake_get([REC], {}, {"genres": [{"name": "disco", "count": 2}]}))
    assert gl.suggest_tags("Daft Punk", "X") == ["genre:disco"]


def test_no_match_low_score_wrong_artist(monkeypatch):
    monkeypatch.setattr(gl, "_get", fake_get([]))
    assert gl.suggest_tags("A", "B") == []
    monkeypatch.setattr(gl, "_get", fake_get([{**REC, "score": 70}], {"genres": [{"name": "x", "count": 1}]}))
    assert gl.suggest_tags("Daft Punk", "Low") == []
    monkeypatch.setattr(gl, "_get", fake_get([REC], {"genres": [{"name": "x", "count": 1}]}))
    assert gl.suggest_tags("Someone Else", "Wrong") == []


def test_noise_cleaning():
    assert gl.split_artist_title("Daft Punk - Topic", "Around the World (Official Video) ft. X") == ("Daft Punk", "Around the World ft. X")
    assert gl.split_artist_title("", "Daft Punk - Around the World [Official Audio]") == ("Daft Punk", "Around the World")
    assert gl.split_artist_title("Daft Punk", "Daft Punk - Around the World") == ("Daft Punk", "Around the World")


def test_cache(monkeypatch):
    calls = []
    monkeypatch.setattr(gl, "_get", fake_get([REC], {"genres": [{"name": "house", "count": 1}]}, calls=calls))
    gl.suggest_tags("Daft Punk", "Around the World")
    gl.suggest_tags("daft punk", "around the world")
    assert calls == ["recording/", "recording/r1", "artist/a1"]


def test_rate_limiter_and_user_agent(monkeypatch):
    sleeps = []
    monkeypatch.setattr(gl.time, "monotonic", lambda: 100.0)
    monkeypatch.setattr(gl.time, "sleep", lambda s: sleeps.append(s))

    class R:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"{}"

    seen = {}

    def fake_urlopen(req, timeout):
        seen["ua"] = req.get_header("User-agent")
        seen["timeout"] = timeout
        return R()

    monkeypatch.setattr(gl.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setenv("AUDIO_MB_USER_AGENT", "test/1 (x@y.z)")
    monkeypatch.setattr(gl, "_last_call", 100.0)
    gl._get("recording/", {"query": "q"})
    assert sleeps
    assert abs(sleeps[0] - gl.MIN_INTERVAL) < 1e-6
    assert seen == {"ua": "test/1 (x@y.z)", "timeout": 5}


def test_failure_returns_empty(monkeypatch):
    def boom(path, params):
        raise OSError("down")

    monkeypatch.setattr(gl, "_get", boom)
    assert gl.suggest_tags("Daft Punk", "Around the World") == []


def test_disabled(monkeypatch):
    monkeypatch.setenv("AUDIO_GENRE_LOOKUP", "0")
    monkeypatch.setattr(gl, "_get", lambda *a: pytest.fail("called"))
    assert gl.suggest_tags("Daft Punk", "Around the World") == []


def test_preview_merges_tags(monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    meta = {"id": "dQw4w9WgXcQ", "title": "T", "artist": "A", "tags": ["genre:pop", "genre:rock"]}
    monkeypatch.setattr(extractor, "preview", lambda v: dict(meta))
    monkeypatch.setattr(gl, "suggest_tags", lambda a, t: ["genre:Pop", "genre:house", "genre:disco", "genre:funk"])
    r = TestClient(main.app).post("/preview", json={"url": "https://youtu.be/dQw4w9WgXcQ"}, headers={"X-API-Token": "secret"})
    assert r.status_code == 200
    assert r.json()["tags"] == ["genre:pop", "genre:rock", "genre:house", "genre:disco", "genre:funk"]


def work(*langs, language=None):
    return {"relations": [{"work": {"languages": list(langs), "language": language}}]}


def test_country_mapping_ignores_work_languages(monkeypatch):
    full = {"genres": [{"name": "pop", "count": 1}], **work("rus", "eng", "lit")}
    monkeypatch.setattr(gl, "_get", fake_get([REC], full, {"country": "LT"}))
    assert gl.suggest_tags("Daft Punk", "X") == ["genre:pop", "country:lt"]


def rel(title, date, primary="Album", secondary=(), artist="Daft Punk", status="Official"):
    return {"title": title, "status": status, "date": date,
            "artist-credit": [{"name": artist, "artist": {"name": artist}}],
            "release-group": {"primary-type": primary, "secondary-types": list(secondary)}}


def test_album_prefers_album_then_earliest(monkeypatch):
    full = {"releases": [
        rel("Single X", "1996", primary="Single"),
        rel("Reissue", "2010"),
        rel("Homework", "1997-01-20"),
    ]}
    monkeypatch.setattr(gl, "_get", fake_get([REC], full))
    assert gl.lookup("Daft Punk", "X")["album"] == "Homework"


def test_album_never_a_single(monkeypatch):
    full = {"releases": [rel("Warrior's Dance", "2009", primary="Single")]}
    monkeypatch.setattr(gl, "_get", fake_get([REC], full))
    assert gl.lookup("Daft Punk", "X")["album"] is None


def test_album_skips_other_artist_and_mixtapes(monkeypatch):
    full = {"releases": [
        rel("Lane 8 Winter 2015 Mixtape", "2015", artist="Lane 8"),
        rel("Mix", "2014", secondary=["Mixtape/Street"]),
        rel("Best Of", "2015", secondary=["Compilation"]),
        rel("Live!", "2016", secondary=["Live"]),
        rel("Bootleg", "1990", primary="Broadcast"),
    ]}
    monkeypatch.setattr(gl, "_get", fake_get([REC], full))
    assert gl.lookup("Daft Punk", "X")["album"] is None


def test_retries_once_on_503(monkeypatch):
    import urllib.error
    calls = []

    class Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ok": 1}'

    def fake_open(req, timeout=None):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(req.full_url, 503, "busy", {}, None)
        return Resp()

    monkeypatch.setattr(gl.urllib.request, "urlopen", fake_open)
    assert gl._get("recording/", {}) == {"ok": 1}
    assert len(calls) == 2


def test_album_missing_is_none(monkeypatch):
    monkeypatch.setattr(gl, "_get", fake_get([REC], {}))
    assert gl.lookup("Daft Punk", "X")["album"] is None


def test_missing_or_bad_country_is_nothing(monkeypatch):
    for art in ({}, {"country": ""}, {"country": "XW1"}):
        gl._cache.clear()
        monkeypatch.setattr(gl, "_get", fake_get([REC], {}, art))
        assert gl.suggest_tags("Daft Punk", "X") == []


def test_artist_call_failure_keeps_recording_tags(monkeypatch):
    def _get(path, params):
        if path == "recording/":
            return {"recordings": [REC]}
        if path.startswith("recording/"):
            return {"genres": [{"name": "house", "count": 1}]}
        raise OSError("down")

    monkeypatch.setattr(gl, "_get", _get)
    assert gl.suggest_tags("Daft Punk", "X") == ["genre:house"]


def test_either_switch_disables(monkeypatch):
    monkeypatch.setattr(gl, "_get", lambda *a: pytest.fail("called"))
    for var in ("AUDIO_TAG_LOOKUP", "AUDIO_GENRE_LOOKUP"):
        monkeypatch.setenv(var, "off")
        assert gl.suggest_tags("Daft Punk", "Around the World") == []
        monkeypatch.delenv(var)


def test_yt_dlp_language_is_not_suggested():
    assert extractor.suggest_tags({"genre": "Pop", "language": "ru"}) == ["genre:pop"]
    assert extractor.suggest_tags({"language": "en-US"}) == []
    assert extractor.suggest_tags({}) == []


def test_clean_tag_namespaces():
    from app import library

    assert library.clean_tag(" Country : LT ") == "country:lt"
    assert library.clean_tag("LANG:RUS") == "lang:ru"
    assert library.clean_tag("lang:ru-RU") == "lang:ru"
    assert library.clean_tag("lang:Klingon") == "lang:klingon"
    assert library.clean_tag("country:Lithuania") == "country:lt"
    assert library.clean_tag("country:Atlantis") == "country:atlantis"


_MIXED = ["genre:danish", "genre:dj", "genre:house music", "genre:house", *[f"genre:g{i}" for i in range(9)], "country:lt", "country:lv", "lang:en", "lang:de"]
_EXPECTED = ["genre:house", *[f"genre:g{i}" for i in range(7)], "country:lt"]


def _mock_preview(monkeypatch, found, wiki_tags=(), song_genres=()):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(extractor, "preview", lambda v: {"id": "dQw4w9WgXcQ", "title": "T", "artist": "A", "tags": ["lang:ru"]})
    monkeypatch.setattr(gl, "suggest_tags", lambda a, t: list(found))
    monkeypatch.setattr(wl, "suggest", lambda a, t: {"tags": list(wiki_tags), "song_genres": list(song_genres), "year": None, "wikipedia_song": None, "wikipedia_artist": None})


def test_preview_filters_caps_and_drops_lang(monkeypatch):
    _mock_preview(monkeypatch, _MIXED)
    r = TestClient(main.app).post("/preview", json={"url": "https://youtu.be/dQw4w9WgXcQ"}, headers={"X-API-Token": "secret"})
    assert r.json()["tags"] == _EXPECTED


def test_preview_and_metadata_give_same_tags(monkeypatch):
    _mock_preview(monkeypatch, [], wiki_tags=_MIXED, song_genres=["genre:z1", "genre:z2"])
    c = TestClient(main.app)
    h = {"X-API-Token": "secret"}
    prev = c.post("/preview", json={"url": "https://youtu.be/dQw4w9WgXcQ"}, headers=h).json()["tags"]
    monkeypatch.setattr(extractor, "preview", lambda v: {"id": v, "title": "T", "artist": "A", "tags": ["lang:ru"], "year": None, "album": None})
    monkeypatch.setattr(gl, "lookup", lambda a, t: {"tags": [], "year": None, "album": None})
    meta = c.post("/metadata", json={"title": "T", "artist": "A", "sources": [{"url": "https://youtu.be/dQw4w9WgXcQ"}]}, headers=h).json()["tags"]
    assert prev == meta
    assert prev[:2] == ["genre:z1", "genre:z2"]
    assert len([t for t in prev if t.startswith("genre:")]) == 8


def test_lookup_wikipedia_uses_same_rule(monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(wl, "from_links", lambda s, a: {"tags": _MIXED, "song_genres": [], "year": 1999})
    r = TestClient(main.app).post("/lookup/wikipedia", json={"wikipedia_song": "https://en.wikipedia.org/wiki/X"}, headers={"X-API-Token": "secret"})
    assert r.json() == {"tags": _EXPECTED, "year": 1999}


@pytest.mark.parametrize(
    "channel,title,expected",
    [
        ("RÜFÜS DU SOL", "RÜFÜS DU SOL ●● Innerbloom (Official Video)", ("RÜFÜS DU SOL", "Innerbloom")),
        ("Daft Punk", "Daft Punk - Around the World [Official Video]", ("Daft Punk", "Around the World")),
        ("", "Daft Punk - Around the World (Official Video)", ("Daft Punk", "Around the World")),
        ("Some Label", "Daft Punk - Around the World", ("Some Label", "Daft Punk - Around the World")),
        ("Gnarls Barkley Official", "Gnarls Barkley - Crazy (Official Video)", ("Gnarls Barkley", "Crazy")),
        ("Gnarls Barkley Official", "Gnarls Barkley - Crazy", ("Gnarls Barkley", "Crazy")),
        ("gnarls barkley OFFICIAL", "GNARLS BARKLEY ●● Crazy", ("gnarls barkley", "Crazy")),
        ("Gnarls Barkley", "Gnarls Barkley - Crazy (Official Video)", ("Gnarls Barkley", "Crazy")),
        ("Official", "Official - Crazy", ("Official", "Crazy")),
        ("The Official Band", "The Official Band - Crazy", ("The Official Band", "Crazy")),
    ],
)
def test_split_artist_title_cases(channel, title, expected):
    assert gl.split_artist_title(channel, title) == expected


def test_musicbrainz_query_drops_feat_and_remix_text(monkeypatch):
    monkeypatch.setattr(gl.time, "sleep", lambda s: None)
    monkeypatch.delenv("AUDIO_GENRE_LOOKUP", raising=False)
    monkeypatch.delenv("AUDIO_TAG_LOOKUP", raising=False)
    gl._cache.clear()
    queries = []

    def fake_get(path, params):
        queries.append(params.get("query"))
        return {"recordings": []}

    monkeypatch.setattr(gl, "_get", fake_get)
    gl.lookup("Kato Feat. Jon", "Turn The Lights Off")
    assert queries == ['recording:"Turn The Lights Off" AND artist:"Kato"']
    assert "Remix Long Version" not in queries[0]


def test_concurrent_lookups_of_one_track_share_one_fetch(monkeypatch):
    import threading
    import time as _time

    calls = []

    def slow(path, params):
        calls.append(path)
        _time.sleep(0.05)
        return {"recordings": []}

    monkeypatch.setattr(gl, "_get", slow)
    threads = [threading.Thread(target=gl.lookup, args=("Daft Punk", "Around the World")) for _ in range(3)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert calls == ["recording/"]


def _feat_get(calls):
    recs = [
        {"id": "r-us", "score": 100, "artist-credit": [{"name": "KATO", "artist": {"id": "a-us", "name": "KATO"}}]},
        {
            "id": "r-dk",
            "score": 100,
            "artist-credit": [
                {"name": "Kato", "joinphrase": ", ", "artist": {"id": "a-dk", "name": "Kato"}},
                {"name": "Jon", "artist": {"id": "a-jon", "name": "Jon"}},
            ],
        },
    ]
    arts = {
        "a-us": {"country": "US", "genres": [{"name": "metal", "count": 3}]},
        "a-dk": {"country": "DK", "genres": [{"name": "house", "count": 3}]},
    }

    def _get(path, params):
        calls.append(path)
        if path == "recording/":
            return {"recordings": recs}
        if path.startswith("recording/"):
            return {"first-release-date": "2010-05-01"}
        return arts[path.split("/")[1]]

    return _get


def test_featured_names_pick_the_right_artist(monkeypatch):
    calls = []
    monkeypatch.setattr(gl, "_get", _feat_get(calls))
    out = gl.lookup("Kato feat. Jon", "Turn The Lights Off")
    assert out["tags"] == ["genre:house", "country:dk"]
    assert out["year"] == 2010
    assert "recording/r-dk" in calls
    assert "artist/a-dk" in calls
    assert "artist/a-us" not in calls


def test_without_featured_names_first_match_unchanged(monkeypatch):
    monkeypatch.setattr(gl, "_get", _feat_get([]))
    assert gl.lookup("Kato", "Turn The Lights Off")["tags"] == ["genre:metal", "country:us"]


def test_featured_argument_and_fallback(monkeypatch):
    monkeypatch.setattr(gl, "_get", _feat_get([]))
    assert gl.lookup("Kato", "Turn The Lights Off", ["Jon"])["tags"] == ["genre:house", "country:dk"]
    gl._cache.clear()
    assert gl.lookup("Kato feat. Nobody", "Turn The Lights Off")["tags"] == ["genre:metal", "country:us"]


MBID = "5f1e7d9a-0b2c-4d3e-8f4a-6b7c8d9e0f1a"


def test_lookup_exposes_matched_recording_url_and_caches_it(monkeypatch):
    calls = []
    monkeypatch.setattr(gl, "_get", fake_get([{**REC, "id": MBID}], {"genres": [{"name": "house", "count": 1}]}, None, calls))
    first = gl.lookup("Daft Punk", "Around the World")
    assert first["mb_url"] == f"https://musicbrainz.org/recording/{MBID}"
    n = len(calls)
    assert gl.lookup("Daft Punk", "Around the World")["mb_url"] == first["mb_url"]
    assert len(calls) == n


def test_lookup_without_match_or_with_odd_id_has_no_url(monkeypatch):
    monkeypatch.setattr(gl, "_get", fake_get([]))
    assert gl.lookup("A", "B")["mb_url"] is None
    gl._cache.clear()
    monkeypatch.setattr(gl, "_get", fake_get([REC], {"genres": [{"name": "x", "count": 1}]}))
    assert gl.lookup("Daft Punk", "Odd")["mb_url"] is None
    assert gl.recording_url(None) is None


@pytest.mark.parametrize("value", [f"https://musicbrainz.org/recording/{MBID}", f"http://www.musicbrainz.org/recording/{MBID.upper()}/", f"  https://musicbrainz.org/recording/{MBID}  "])
def test_clean_recording_url_normalises(value):
    assert gl.clean_recording_url(value) == f"https://musicbrainz.org/recording/{MBID}"


@pytest.mark.parametrize("value", [None, 5, "", "https://musicbrainz.org/artist/" + MBID, "https://evil.example/recording/" + MBID, "https://musicbrainz.org/recording/nope", "javascript:alert(1)"])
def test_clean_recording_url_rejects_others(value):
    assert gl.clean_recording_url(value) is None


def test_musicbrainz_su_is_suggested_other_pseudo_codes_dropped(monkeypatch):
    gl._cache.clear()
    monkeypatch.setattr(gl, "_get", fake_get([REC], {}, {"country": "SU"}))
    assert gl.suggest_tags("Daft Punk", "X") == ["country:su"]
    for code in ("XU", "XW"):
        gl._cache.clear()
        monkeypatch.setattr(gl, "_get", fake_get([REC], {}, {"country": code}))
        assert gl.suggest_tags("Daft Punk", "X") == []
