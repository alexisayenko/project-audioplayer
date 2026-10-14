from datetime import UTC, datetime

import pytest

from app import discogs_lookup, extractor, genre_lookup, library, timeutil, wiki_lookup
from tests.test_library import H, VID, client  # noqa: F401
from tests.test_remix_year import song
from tests.test_users import add


def at(monkeypatch, year):
    monkeypatch.setattr(timeutil, "_utc_now", lambda: datetime(year, 3, 1, tzinfo=UTC))


def test_max_year_is_next_year_utc_and_injectable():
    assert timeutil.max_year() == 2027
    assert timeutil.max_year(datetime(2030, 12, 31, 23, tzinfo=UTC)) == 2031
    assert timeutil.year_range_text() == "from 1900 to 2027"


@pytest.mark.parametrize("value, ok", [(1899, False), (1900, True), (2027, True), (2028, False), (True, False), ("1999", False), (None, False)])
def test_valid_year(value, ok):
    assert (timeutil.valid_year(value) is not None) is ok


@pytest.mark.parametrize("field", ["year", "remix_year"])
@pytest.mark.parametrize("value, ok", [(1899, False), (1900, True), (2027, True), (2028, False), (0, False)])
def test_create_range(client, field, value, ok):
    r = client.post("/songs", json={"url": VID, "metadata": {"title": "S", field: value}, "tags": []}, headers=H)
    assert (r.status_code == 202) is ok
    if not ok:
        assert r.status_code == 422 and "1900 to 2027" in r.json()["detail"] and field in r.json()["detail"]


@pytest.mark.parametrize("field", ["year", "remix_year"])
@pytest.mark.parametrize("value, ok", [(1899, False), (1900, True), (2027, True), (2028, False)])
def test_patch_range(client, field, value, ok):
    add(client, H)
    r = client.patch(f"/songs/{VID}", json={field: value}, headers=H)
    assert (r.status_code == 200) is ok
    if not ok:
        assert "1900 to 2027" in r.json()["detail"]


def test_stored_year_above_limit_is_kept_and_accepted_unchanged(client, monkeypatch):
    at(monkeypatch, 2029)
    assert add(client, H, metadata={"title": "S", "year": 2030, "remix_year": 2030}).status_code == 202
    assert song(client)["tags"].count("decade:30s") == 1
    at(monkeypatch, 2026)
    s = song(client)
    assert (s["year"], s["remix_year"]) == (2030, 2030)
    assert client.patch(f"/songs/{VID}", json={"title": "T", "year": 2030, "remix_year": 2030}, headers=H).status_code == 200
    assert client.patch(f"/songs/{VID}", json={"year": 2031}, headers=H).status_code == 422
    assert song(client)["year"] == 2030


def test_decade_tag_follows_the_clock(monkeypatch):
    assert library.decade_tag(2027) == "decade:20s" and library.decade_tag(2030) is None
    at(monkeypatch, 2029)
    assert library.decade_tag(2030) == "decade:30s"
    assert library.decade_tag(1949) is None
    at(monkeypatch, 2169)
    assert library.decade_tag(2170) == "decade:70s"


def test_lookups_discard_out_of_range_years():
    assert discogs_lookup._year(2028) is None and discogs_lookup._year(1899) is None and discogs_lookup._year(2027) == 2027
    assert genre_lookup._first_year({"first-release-date": "2028-01-01"}) is None
    assert genre_lookup._first_year({"first-release-date": "1999-01-01"}) == 1999
    assert extractor._year({"release_year": 2028}) is None
    assert extractor._year({"release_date": "18990101"}) is None
    assert extractor._year({"release_date": "20210101"}) == 2021
    assert wiki_lookup._in_range(2027) and not wiki_lookup._in_range(2028)
