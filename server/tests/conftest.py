import pytest

from app import deps, genre_lookup, guest, httpjson, limits, wiki_lookup

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
    monkeypatch.setattr(genre_lookup.time, "sleep", lambda s: None)
    genre_lookup._cache.clear()
    for cache in (wiki_lookup._entities, wiki_lookup._claims, wiki_lookup._labels, wiki_lookup._qid_of_page):
        cache.clear()
    for name in ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(deps.SCHED, "inline", True)
    limits.RATE.reset()
    deps.SUBS.clear()
    guest.reset()
