import pytest

from datetime import UTC, datetime

from app import album_covers, deps, features, readiness as readiness_mod, genre_lookup, guest, httpjson, limits, previewcache, timeutil, wiki_lookup

ENV = (
    "OWNER_EMAIL", "ALLOWED_EMAIL", "ALLOWED_APPLE_SUB", "SIGNUP_OPEN", "USER_MAX_SONGS", "USER_MAX_BYTES",
    "USER_ADDS_PER_HOUR", "USER_MAX_CONCURRENT_DOWNLOADS", "GLOBAL_MAX_CONCURRENT_DOWNLOADS", "POOL_MAX_BYTES",
    "PUBLIC_VIEW", "PUBLIC_AUDIO", "PUBLIC_VIEW_EMAIL", "GUEST_REQ_PER_MIN", "GUEST_AUDIO_MB_PER_HOUR", "GUEST_MAX_STREAMS",
)


def _no_network(*args, **kwargs):
    raise OSError("network disabled in tests")


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", _no_network)
    monkeypatch.setattr(album_covers, "fetch_jpeg", _no_network)
    monkeypatch.setattr(features, "record_startup", lambda: None)
    monkeypatch.setattr(genre_lookup.time, "sleep", lambda s: None)
    genre_lookup._cache.clear()
    previewcache.clear()
    for cache in (wiki_lookup._entities, wiki_lookup._claims, wiki_lookup._labels, wiki_lookup._qid_of_page):
        cache.clear()
    for name in ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(timeutil, "_utc_now", lambda: datetime(2026, 6, 1, tzinfo=UTC))
    monkeypatch.setattr(deps.SCHED, "inline", True)
    monkeypatch.setenv("AUDIO_STARTUP_SYNC", "1")
    monkeypatch.delenv("AUDIO_STARTUP_MAX_S", raising=False)
    readiness_mod.readiness.reset()
    limits.RATE.reset()
    deps.SUBS.clear()
    guest.reset()
