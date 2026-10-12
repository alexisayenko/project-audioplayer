import pytest
from fastapi.testclient import TestClient

from app import extractor, genre_lookup as gl, main


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    gl._cache.clear()
    monkeypatch.setattr(gl.time, "sleep", lambda s: None)
    monkeypatch.delenv("AUDIO_GENRE_LOOKUP", raising=False)


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
    assert gl.suggest_genres("Daft Punk", "Around the World") == ["genre:electronic", "genre:house", "genre:french house"]


def test_artist_fallback(monkeypatch):
    monkeypatch.setattr(gl, "_get", fake_get([REC], {}, {"genres": [{"name": "disco", "count": 2}]}))
    assert gl.suggest_genres("Daft Punk", "X") == ["genre:disco"]


def test_no_match_low_score_wrong_artist(monkeypatch):
    monkeypatch.setattr(gl, "_get", fake_get([]))
    assert gl.suggest_genres("A", "B") == []
    monkeypatch.setattr(gl, "_get", fake_get([{**REC, "score": 70}], {"genres": [{"name": "x", "count": 1}]}))
    assert gl.suggest_genres("Daft Punk", "Low") == []
    monkeypatch.setattr(gl, "_get", fake_get([REC], {"genres": [{"name": "x", "count": 1}]}))
    assert gl.suggest_genres("Someone Else", "Wrong") == []


def test_noise_cleaning():
    assert gl.split_artist_title("Daft Punk - Topic", "Around the World (Official Video) ft. X") == ("Daft Punk", "Around the World")
    assert gl.split_artist_title("", "Daft Punk - Around the World [Official Audio]") == ("Daft Punk", "Around the World")
    assert gl.split_artist_title("Daft Punk", "Daft Punk - Around the World") == ("Daft Punk", "Around the World")


def test_cache(monkeypatch):
    calls = []
    monkeypatch.setattr(gl, "_get", fake_get([REC], {"genres": [{"name": "house", "count": 1}]}, calls=calls))
    gl.suggest_genres("Daft Punk", "Around the World")
    gl.suggest_genres("daft punk", "around the world")
    assert calls == ["recording/", "recording/r1"]


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
    assert gl.suggest_genres("Daft Punk", "Around the World") == []


def test_disabled(monkeypatch):
    monkeypatch.setenv("AUDIO_GENRE_LOOKUP", "0")
    monkeypatch.setattr(gl, "_get", lambda *a: pytest.fail("called"))
    assert gl.suggest_genres("Daft Punk", "Around the World") == []


def test_preview_merges_tags(monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    meta = {"id": "dQw4w9WgXcQ", "title": "T", "artist": "A", "tags": ["genre:pop", "genre:rock"]}
    monkeypatch.setattr(extractor, "preview", lambda v: dict(meta))
    monkeypatch.setattr(gl, "suggest_genres", lambda a, t: ["genre:Pop", "genre:house", "genre:disco", "genre:funk"])
    r = TestClient(main.app).post("/preview", json={"url": "https://youtu.be/dQw4w9WgXcQ"}, headers={"X-API-Token": "secret"})
    assert r.status_code == 200
    assert r.json()["tags"] == ["genre:pop", "genre:rock", "genre:house", "genre:disco"]
