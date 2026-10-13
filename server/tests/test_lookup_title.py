import pytest

from app import genre_lookup as gl
from app.titles import clean_title, lookup_title, split_artist_title


@pytest.mark.parametrize(
    "raw,want",
    [
        ("Cold Heart (Live from the Royal Albert Hall)", "Cold Heart (Live from the Royal Albert Hall)"),
        ("Cold Heart (Acoustic)", "Cold Heart (Acoustic)"),
        ("Song (Official Video)", "Song"),
        ("Song (Remastered 2009)", "Song"),
        ("Song (Official Live Video)", "Song"),
    ],
)
def test_clean_title_keeps_version_info(raw, want):
    assert clean_title(raw) == want


@pytest.mark.parametrize(
    "raw,want",
    [
        ("Cold Heart (Live from the Royal Albert Hall)", "Cold Heart"),
        ("Cold Heart (Acoustic)", "Cold Heart"),
        ("Song [Unplugged]", "Song"),
        ("Song (Session)", "Song"),
        ("Song (At Wembley)", "Song"),
        ("Song (Official Video)", "Song"),
        ("Song - Live at Wembley", "Song"),
        ("Song Live at Wembley 1986", "Song"),
        ("Song (Live) (Official Video)", "Song"),
        ("Plain Song", "Plain Song"),
        ("Alive", "Alive"),
    ],
)
def test_lookup_title(raw, want):
    assert lookup_title(raw) == want


def test_split_keeps_live_for_display():
    assert split_artist_title("", "Dua Lipa and Elton John - Cold Heart (Live from the Royal Albert Hall)")[1] == "Cold Heart (Live from the Royal Albert Hall)"


def test_musicbrainz_query_has_no_live(monkeypatch):
    monkeypatch.setattr(gl.time, "sleep", lambda s: None)
    monkeypatch.delenv("AUDIO_GENRE_LOOKUP", raising=False)
    monkeypatch.delenv("AUDIO_TAG_LOOKUP", raising=False)
    gl._cache.clear()
    queries = []

    def fake_get(path, params):
        queries.append(params.get("query"))
        return {"recordings": []}

    monkeypatch.setattr(gl, "_get", fake_get)
    gl.lookup("Dua Lipa", "Cold Heart (Live from the Royal Albert Hall)")
    assert queries == ['recording:"Cold Heart" AND artist:"Dua Lipa"']
