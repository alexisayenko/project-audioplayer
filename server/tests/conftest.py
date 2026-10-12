import pytest

from app import genre_lookup, wiki_lookup


def _no_network(*args, **kwargs):
    raise OSError("network disabled in tests")


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setattr(genre_lookup.urllib.request, "urlopen", _no_network)
    monkeypatch.setattr(genre_lookup.time, "sleep", lambda s: None)
    genre_lookup._cache.clear()
    for cache in (wiki_lookup._entities, wiki_lookup._claims, wiki_lookup._labels, wiki_lookup._qid_of_page):
        cache.clear()
