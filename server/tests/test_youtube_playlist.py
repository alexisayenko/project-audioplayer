import pytest
from fastapi.testclient import TestClient

from app import deps, extractor, main, playlist_import, previewcache

H = {"X-API-Token": "secret"}
LIST = "PLabcdefghijklmnop"
URL = f"https://www.youtube.com/playlist?list={LIST}"


def vid(n):
    return f"v{n:010d}"


def flat(n, title="Song", **extra):
    return {"id": vid(n), "title": f"{title} {n}", "channel": "Chan", "duration": 200, **extra}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(deps, "DOWNLOAD_DIR", tmp_path / "downloads")
    monkeypatch.setattr(deps, "DATA_DIR", tmp_path)
    monkeypatch.setattr(deps, "JOBS", {})
    playlist_import.reset_limits()
    previewcache.clear()
    return TestClient(main.app)


@pytest.fixture
def fake(monkeypatch):
    state = {"entries": [], "total": None, "calls": [], "error": None}

    def playlist(list_id, limit):
        state["calls"].append((list_id, limit))
        if state["error"]:
            raise state["error"]
        entries = state["entries"][:limit]
        return {"title": "Mix tape", "uploader": "Alex", "total": state["total"] or len(entries), "entries": entries}

    monkeypatch.setattr(extractor, "playlist", playlist)
    return state


def get(client, url=URL, headers=H):
    return client.get("/youtube/playlist", params={"url": url}, headers=headers)


def test_contract_and_watch_urls(client, fake):
    fake["entries"] = [flat(1), flat(2, duration=None)]
    body = get(client).json()
    assert body["playlist_id"] == LIST
    assert body["title"] == "Mix tape"
    assert body["channel"] == "Alex"
    assert body["count"] == 2
    assert body["truncated"] is False
    assert body["skipped"] == 0
    assert body["entries"][0] == {"id": vid(1), "title": "Song 1", "channel": "Chan", "duration": 200,
                                  "url": f"https://www.youtube.com/watch?v={vid(1)}", "available": True}
    assert body["entries"][1]["duration"] is None


def test_private_deleted_are_skipped_and_duplicates_dropped(client, fake):
    fake["entries"] = [flat(1), flat(1), {"id": vid(2), "title": "[Private video]"}, {"id": vid(3), "title": "[Deleted video]"}, flat(4)]
    body = get(client).json()
    assert [e["id"] for e in body["entries"]] == [vid(1), vid(4)]
    assert body["count"] == 2
    assert body["skipped"] == 2


def test_cap_at_500_sets_truncated(client, fake):
    fake["entries"] = [flat(n) for n in range(600)]
    fake["total"] = 600
    body = get(client).json()
    assert body["count"] == 500
    assert body["truncated"] is True
    assert fake["calls"] == [(LIST, 501)]


def test_exactly_500_is_not_truncated(client, fake):
    fake["entries"] = [flat(n) for n in range(500)]
    body = get(client).json()
    assert body["count"] == 500
    assert body["truncated"] is False


def test_result_is_cached(client, fake):
    fake["entries"] = [flat(1)]
    get(client)
    get(client)
    assert len(fake["calls"]) == 1


@pytest.mark.parametrize("url", [
    "", "not a url", "http://www.youtube.com/playlist?list=" + LIST,
    "https://evil.example/playlist?list=" + LIST, "https://youtube.com.evil.example/playlist?list=" + LIST,
    "https://127.0.0.1/playlist?list=" + LIST, "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    "https://www.youtube.com/playlist?list=bad%20id",
])
def test_bad_urls_are_400_and_never_fetched(client, fake, url):
    r = get(client, url)
    assert r.status_code == 400
    assert r.json()["error"] == "bad_url"
    assert fake["calls"] == []


@pytest.mark.parametrize("url", [
    "https://music.youtube.com/playlist?list=OLAKabcdefghij",
    "https://youtu.be/aaaaaaaaaaa?list=" + LIST,
    "https://m.youtube.com/watch?v=aaaaaaaaaaa&list=" + LIST,
])
def test_accepted_hosts(client, fake, url):
    fake["entries"] = [flat(1)]
    assert get(client, url).status_code == 200


@pytest.mark.parametrize("list_id", ["RDabcdefghijk", "WL", "LL"])
def test_mix_and_login_lists_are_422(client, fake, list_id):
    r = get(client, f"https://www.youtube.com/playlist?list={list_id}")
    assert r.status_code == 422
    assert r.json()["error"] == "playlist_unavailable"
    assert fake["calls"] == []


def test_ytdlp_private_or_missing_is_422(client, fake):
    fake["error"] = Exception("ERROR: HTTP Error 404: Not Found")
    r = get(client)
    assert r.status_code == 422
    assert r.json()["error"] == "playlist_unavailable"


def test_timeout_is_504_and_other_failure_502(client, fake):
    fake["error"] = Exception("read operation timed out")
    assert get(client).status_code == 504
    fake["error"] = Exception("boom")
    assert get(client).status_code == 502


def test_requires_signed_in_caller(client, fake):
    assert get(client, headers={}).status_code == 401


def test_rate_limited_per_user_and_not_for_owner(client, fake, monkeypatch):
    fake["entries"] = [flat(1)]
    monkeypatch.setenv("PLAYLIST_IMPORTS_PER_HOUR", "2")
    overrides = main.app.dependency_overrides
    user = {"method": "session", "uid": "u1", "email": "u@x", "provider": "google", "owner": False}
    overrides[deps.require_token] = lambda: user
    try:
        assert get(client, headers={}).status_code == 200
        assert get(client, headers={}).status_code == 200
        r = get(client, headers={})
        assert r.status_code == 429
        assert r.json()["error"] == "import_limit"
        overrides[deps.require_token] = lambda: {**user, "uid": "owner", "owner": True}
        assert all(get(client, headers={}).status_code == 200 for _ in range(5))
    finally:
        overrides.clear()
