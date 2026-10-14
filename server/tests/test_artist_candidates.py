import pytest

from app import acoustid_lookup, discogs_lookup as dl, genre_lookup
from app.titles import artist_candidates


@pytest.mark.parametrize("artist,want", [
    ("Armin van Buuren, Sharon den Adel", ["Armin van Buuren, Sharon den Adel", "Armin van Buuren"]),
    ("A - B", ["A - B", "A"]),
    ("A – B — C", ["A – B — C", "A"]),
    ("Tyler, The Creator", ["Tyler, The Creator", "Tyler"]),
    ("Earth, Wind & Fire", ["Earth, Wind & Fire", "Earth"]),
    ("Jean-Michel Jarre", ["Jean-Michel Jarre"]),
    ("A-ha", ["A-ha"]),
    ("Solo", ["Solo"]),
    ("A, B feat. C", ["A, B", "A"]),
    ("", [""]),
])
def test_candidates(artist, want):
    assert artist_candidates(artist) == want


def test_discogs_tries_whole_then_first_part(monkeypatch):
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    dl._cache.clear()
    seen = []

    def fake(artist, title):
        seen.append(artist)
        found = artist == "Armin van Buuren"
        return {**dl._empty(), "url": "https://discogs.example/r/1" if found else None, "tags": ["genre:trance"] if found else []}

    monkeypatch.setattr(dl, "_lookup", fake)
    out = dl.suggest("Armin van Buuren, Sharon den Adel", "Song")
    assert seen == ["Armin van Buuren, Sharon den Adel", "Armin van Buuren"]
    assert out["url"]
    assert out["tags"] == ["genre:trance"]


def test_discogs_whole_match_stops(monkeypatch):
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    dl._cache.clear()
    seen = []

    def fake(artist, title):
        seen.append(artist)
        return {**dl._empty(), "url": "https://discogs.example/r/2"}

    monkeypatch.setattr(dl, "_lookup", fake)
    dl.suggest("Tyler, The Creator", "Song")
    assert seen == ["Tyler, The Creator"]


def test_musicbrainz_tries_whole_then_first_part(monkeypatch):
    monkeypatch.setattr(genre_lookup, "enabled", lambda: True)
    seen = []

    def fake(artist, title, feats):
        seen.append(artist)
        return {**genre_lookup._empty(), "mb_url": "https://musicbrainz.org/recording/x" if artist == "A" else None}

    monkeypatch.setattr(genre_lookup, "_lookup", fake)
    assert genre_lookup.lookup("A - B", "Song")["mb_url"]
    assert seen == ["A - B", "A"]


def test_acoustid_fit_any_artist():
    rec = {"title": "Song", "artists": [{"name": "Armin van Buuren"}]}
    assert acoustid_lookup._fits(rec, "Armin van Buuren, Sharon den Adel", "Song")
    assert not acoustid_lookup._fits(rec, "Other, Person", "Song")
