import pytest
from fastapi.testclient import TestClient

from app import extractor, genre_lookup as gl, main


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
    assert gl.split_artist_title("Daft Punk - Topic", "Around the World (Official Video) ft. X") == ("Daft Punk", "Around the World")
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
    assert sleeps and abs(sleeps[0] - gl.MIN_INTERVAL) < 1e-6
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
    assert r.json()["tags"] == ["genre:pop", "genre:rock", "genre:house"]


def work(*langs, language=None):
    return {"relations": [{"work": {"languages": list(langs), "language": language}}]}


def test_country_and_language_mapping(monkeypatch):
    full = {"genres": [{"name": "pop", "count": 1}], **work("rus", "eng", "lit")}
    monkeypatch.setattr(gl, "_get", fake_get([REC], full, {"country": "LT"}))
    assert gl.suggest_tags("Daft Punk", "X") == ["genre:pop", "country:lt", "lang:ru", "lang:en"]


def test_language_keeps_unmapped_639_3_and_ignores_mul_zxx(monkeypatch):
    monkeypatch.setattr(gl, "_get", fake_get([REC], work("mul", "zxx", "und", "xyz")))
    assert gl.suggest_tags("Daft Punk", "X") == ["lang:xyz"]


def test_work_single_language_field(monkeypatch):
    monkeypatch.setattr(gl, "_get", fake_get([REC], work(language="fra")))
    assert gl.suggest_tags("Daft Punk", "X") == ["lang:fr"]


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
            return {"genres": [{"name": "house", "count": 1}], **work("eng")}
        raise OSError("down")

    monkeypatch.setattr(gl, "_get", _get)
    assert gl.suggest_tags("Daft Punk", "X") == ["genre:house", "lang:en"]


def test_either_switch_disables(monkeypatch):
    monkeypatch.setattr(gl, "_get", lambda *a: pytest.fail("called"))
    for var in ("AUDIO_TAG_LOOKUP", "AUDIO_GENRE_LOOKUP"):
        monkeypatch.setenv(var, "off")
        assert gl.suggest_tags("Daft Punk", "Around the World") == []
        monkeypatch.delenv(var)


def test_yt_dlp_language_tag():
    assert extractor.suggest_tags({"genre": "Pop", "language": "ru"}) == ["genre:pop", "lang:ru"]
    assert extractor.suggest_tags({"language": "en-US"}) == ["lang:en"]
    assert extractor.suggest_tags({"language": "eng"}) == ["lang:en"]
    assert extractor.suggest_tags({"language": "mul"}) == []
    assert extractor.suggest_tags({}) == []


def test_clean_tag_namespaces():
    from app import library

    assert library.clean_tag(" Country : LT ") == "country:lt"
    assert library.clean_tag("LANG:RUS") == "lang:ru"
    assert library.clean_tag("lang:ru-RU") == "lang:ru"
    assert library.clean_tag("lang:Klingon") == "lang:klingon"
    assert library.clean_tag("country:Lithuania") == "country:lithuania"


def test_preview_caps_per_namespace(monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(extractor, "preview", lambda v: {"id": "dQw4w9WgXcQ", "title": "T", "artist": "A", "tags": ["lang:ru"]})
    monkeypatch.setattr(gl, "suggest_tags", lambda a, t: ["genre:a", "genre:b", "genre:c", "genre:d", "country:lt", "country:lv", "lang:en", "lang:de"])
    r = TestClient(main.app).post("/preview", json={"url": "https://youtu.be/dQw4w9WgXcQ"}, headers={"X-API-Token": "secret"})
    assert r.json()["tags"] == ["lang:ru", "genre:a", "genre:b", "genre:c", "country:lt", "lang:en"]
