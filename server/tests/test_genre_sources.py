"""Genre sources (GEN-066, ADR-0033): the loader, the link helper, the payload field and the committed data file."""

import json
import re
from pathlib import Path

import pytest

from app import genre_sources, genre_vocab

DATA = Path(__file__).resolve().parent.parent / "data" / "genre_sources.json"
REVIEW = Path(__file__).resolve().parent.parent / "data" / "genre_sources_review.json"

DOC = {
    "_meta": {"generated_at": "2026-10-19T00:00:00Z"},
    "house": {"discogs": True, "musicbrainz": {"id": "mb-1", "name": "house", "match": "name"}, "wikipedia": {"title": "House music", "wikidata": "Q11", "match": "name"}},
    "funk / soul": {"discogs": True, "apple_music": {"id": "7", "name": "Funk / Soul", "match": "name"}},
    "neurofunk": {"discogs": False},
    "dub": {"discogs": True, "discogs_name": "Dub (x)"},
}


@pytest.fixture
def sources_file(tmp_path, monkeypatch):
    def put(doc=DOC, raw=None):
        p = tmp_path / "genre_sources.json"
        p.write_text(raw if raw is not None else json.dumps(doc), encoding="utf-8")
        monkeypatch.setattr(genre_sources, "SOURCES_FILE", p)
        monkeypatch.setattr(genre_sources, "RYM_FILE", tmp_path / "genre_rym.json")
        genre_vocab.reset()
        return p

    yield put
    monkeypatch.undo()
    genre_vocab.reset()


def links(key, sources):
    return {x["source"]: x for x in genre_sources.genre_source_links(key, sources)}


def test_links_for_a_genre_matched_everywhere_in_the_fixed_order():
    sources = {
        "discogs": {"name": "tech house", "family": False},
        "rym": {"url": "https://rateyourmusic.com/genre/tech-house/"},
        "musicbrainz": {"id": "abc-1", "name": "tech house", "match": "name"},
        "wikipedia": {"title": "Tech house", "wikidata": "Q5", "match": "name"},
        "apple_music": {"id": "21", "name": "Tech House", "match": "name"},
    }
    got = genre_sources.genre_source_links("tech house", sources)
    assert [x["source"] for x in got] == ["wikipedia", "apple_music", "spotify", "discogs", "rym", "musicbrainz"]
    by = {x["source"]: x for x in got}
    assert (by["wikipedia"]["url"], by["wikipedia"]["kind"]) == ("https://en.wikipedia.org/wiki/Tech_house", "page")
    assert (by["apple_music"]["url"], by["apple_music"]["kind"]) == ("https://music.apple.com/us/search?term=Tech%20House", "search")
    assert (by["spotify"]["url"], by["spotify"]["kind"]) == ("https://open.spotify.com/search/genre%3A%22tech%20house%22", "search")
    assert (by["discogs"]["url"], by["discogs"]["kind"]) == ("https://www.discogs.com/search/?style=tech%20house&type=release", "search")
    assert (by["musicbrainz"]["url"], by["musicbrainz"]["kind"]) == ("https://musicbrainz.org/genre/abc-1", "page")
    assert (by["rym"]["url"], by["rym"]["kind"]) == ("https://rateyourmusic.com/genre/tech-house/", "page")


def test_links_for_an_unmatched_genre_fall_back_to_searches_and_omit_musicbrainz():
    by = links("neurofunk", {})
    assert list(by) == ["wikipedia", "apple_music", "spotify", "discogs"]
    assert by["discogs"]["url"] == "https://www.discogs.com/search/?q=neurofunk&type=release"
    assert by["wikipedia"]["kind"] == "search"
    assert by["wikipedia"]["url"] == "https://en.wikipedia.org/w/index.php?search=neurofunk%20music%20genre"
    assert by["apple_music"]["url"] == "https://music.apple.com/us/search?term=neurofunk"
    assert all(x["kind"] == "search" for x in by.values())


def test_a_family_uses_the_discogs_genre_filter():
    by = links("funk / soul", {"discogs": {"name": "Funk / Soul", "family": True}})
    assert by["discogs"]["url"] == "https://www.discogs.com/search/?genre=Funk%20%2F%20Soul&type=release"


def test_names_with_ampersand_slash_and_quotes_are_percent_encoded():
    by = links("drum & bass/jungle", {"wikipedia": {"title": "Rhythm & blues (music)", "wikidata": "Q1", "match": "name"}})
    assert by["spotify"]["url"] == "https://open.spotify.com/search/genre%3A%22drum%20%26%20bass%2Fjungle%22"
    assert by["wikipedia"]["url"] == "https://en.wikipedia.org/wiki/Rhythm_%26_blues_(music)"
    assert by["apple_music"]["url"].endswith("term=drum%20%26%20bass%2Fjungle")
    assert "#" not in links("c# funk", {})["spotify"]["url"]


def test_sources_for_returns_stored_ids_without_urls(sources_file):
    sources_file()
    got = genre_sources.sources_for("house")
    assert set(got) == {"discogs", "musicbrainz", "wikipedia"}
    assert got["musicbrainz"] == {"id": "mb-1", "name": "house", "match": "name"}
    assert got["wikipedia"]["wikidata"] == "Q11"
    assert "http" not in json.dumps(got)
    assert genre_sources.sources_for("neurofunk") == {}
    assert genre_sources.sources_for("nowhere") == {}
    assert genre_sources.sources_for("dub")["discogs"]["name"] == "Dub (x)"
    assert genre_sources.sources_for("funk / soul", True)["discogs"] == {"name": "funk / soul", "family": True}


def test_payload_rows_carry_sources(sources_file):
    sources_file()
    rows = {r["name"]: r for r in genre_vocab.vocabulary()["genres"]}
    assert rows["house"]["sources"]["musicbrainz"]["id"] == "mb-1"
    assert rows["funk / soul"]["sources"]["apple_music"]["name"] == "Funk / Soul"
    assert rows["funk / soul"]["source_links"][3]["url"].startswith("https://www.discogs.com/search/?genre=")
    assert rows["house"]["level"] == "family" and rows["house"]["sources"]["discogs"]["family"] is False, "house is a level 1 genre (promoted), not a Discogs family"
    assert "electronic" not in rows and "others" not in rows
    assert rows["neurofunk"]["sources"] == {}
    assert [x["source"] for x in rows["neurofunk"]["source_links"]] == ["wikipedia", "apple_music", "spotify", "discogs"]
    assert rows["house"]["source_links"][0]["url"] == "https://en.wikipedia.org/wiki/House_music"
    assert all("sources" in r and r["source_links"] for r in rows.values())


def test_payload_without_the_file_has_empty_sources(sources_file):
    sources_file().unlink()
    body = genre_vocab.vocabulary()
    assert body["count"] > 500
    assert all(r["sources"] == {} for r in body["genres"])
    assert all([x["source"] for x in r["source_links"]][:3] == ["wikipedia", "apple_music", "spotify"] for r in body["genres"])
    assert genre_sources.meta() == {}


def test_a_malformed_file_is_ignored_not_fatal(sources_file):
    sources_file(raw="{not json")
    assert all(r["sources"] == {} for r in genre_vocab.vocabulary()["genres"])
    sources_file({"house": {"discogs": "yes"}})
    assert genre_sources.sources_for("house") == {}


@pytest.mark.parametrize(
    "doc,fragment",
    [
        ({"house": {"discogs": "yes"}}, "discogs"),
        ({"house": {"discogs": True, "musicbrainz": {"id": "x", "name": "y", "match": "fuzzy"}}}, "musicbrainz"),
        ({"house": {"discogs": True, "wikipedia": {"title": "x", "match": "name"}}}, "wikipedia"),
        ({"house": {"discogs": True, "apple_music": {"id": "", "name": "y", "match": "name"}}}, "apple_music"),
        ([], "not an object"),
    ],
)
def test_parse_rejects_bad_shapes(doc, fragment):
    with pytest.raises(ValueError, match=fragment):
        genre_sources.parse(doc)


def _committed():
    if not DATA.exists():
        pytest.skip("genre_sources.json not built")
    return json.loads(DATA.read_text(encoding="utf-8"))


def test_committed_file_validates_and_has_one_row_per_vocabulary_name():
    doc = _committed()
    rows, meta = genre_sources.parse(doc)
    genre_vocab.reset()
    names = set(genre_vocab.load().entries)
    assert set(rows) == names, sorted(names ^ set(rows))
    assert meta["generated_at"]


def test_committed_file_stores_no_urls_and_ids_have_the_right_shape():
    doc = _committed()
    mbid = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    for key, row in doc.items():
        if key == "_meta":
            continue
        assert "http" not in json.dumps(row), key
        if "musicbrainz" in row:
            assert mbid.match(row["musicbrainz"]["id"]), key
        if "wikipedia" in row:
            assert re.fullmatch(r"Q[1-9]\d*", row["wikipedia"]["wikidata"]), key
        if "apple_music" in row:
            assert row["apple_music"]["id"].isdigit(), key


def test_committed_discogs_flag_agrees_with_the_levels_file():
    doc = _committed()
    levels, families, _ = genre_vocab.load_levels()
    family_keys = {f.lower() for f in families}
    for key, row in doc.items():
        if key == "_meta":
            continue
        want = True if key in family_keys else levels[key]["discogs"]
        assert row["discogs"] is want, key


def test_committed_counts_match_the_rows():
    doc = _committed()
    counts = doc["_meta"]["counts"]
    rows = [v for k, v in doc.items() if k != "_meta"]
    assert counts["genres"] == len(rows)
    for src in ("musicbrainz", "wikipedia", "apple_music"):
        assert counts[src] == sum(1 for r in rows if src in r), src
    assert counts["discogs_true"] == sum(1 for r in rows if r["discogs"] is True)
    assert counts["discogs_false"] == sum(1 for r in rows if r["discogs"] is False)


def test_no_catalogue_entry_is_matched_to_two_genres():
    doc = _committed()
    for src, field in (("musicbrainz", "id"), ("apple_music", "id"), ("wikipedia", "wikidata")):
        seen: dict[str, str] = {}
        for key, row in doc.items():
            if key == "_meta" or src not in row:
                continue
            target = row[src][field]
            assert target not in seen, (src, key, seen.get(target))
            seen[target] = key


def test_review_file_names_real_genres():
    if not REVIEW.exists():
        pytest.skip("no review file")
    doc = json.loads(REVIEW.read_text(encoding="utf-8"))
    genre_vocab.reset()
    names = set(genre_vocab.load().entries)
    for item in doc["review"]:
        assert item["genre"] in names
        assert item["candidate"] and item["reason"] and item["source"]


def test_hierarchy_evidence_keys_are_vocabulary_names_and_it_is_not_in_the_payload():
    path = DATA.parent / "genre_hierarchy_evidence.json"
    if not path.exists():
        pytest.skip("no evidence file")
    doc = json.loads(path.read_text(encoding="utf-8"))
    genre_vocab.reset()
    names = set(genre_vocab.load().entries)
    sources = _committed()
    for key, ev in doc.items():
        if key == "_meta":
            continue
        assert key in names
        assert ev["wikidata"] == sources[key]["wikipedia"]["wikidata"]
        for ref in [*ev["subclass_of"], *ev["lead_parents"], *ev["origins"], *ev["derivatives"]]:
            assert ref["key"] is None or ref["key"] in names
    assert "hierarchy" not in json.dumps(genre_vocab.vocabulary())


def test_rym_link_comes_only_from_the_curated_file(sources_file, tmp_path, monkeypatch):
    sources_file()
    rym = tmp_path / "genre_rym.json"
    rym.write_text(json.dumps({"house": "https://rateyourmusic.com/genre/house/", "bad": "http://evil.example/x"}), encoding="utf-8")
    monkeypatch.setattr(genre_sources, "RYM_FILE", rym)
    genre_sources.reset()
    assert genre_sources.sources_for("house")["rym"] == {"url": "https://rateyourmusic.com/genre/house/"}
    assert "rym" not in genre_sources.sources_for("bad")
    assert "rym" not in [x["source"] for x in genre_sources.payload_fields("neurofunk")["source_links"]]
    got = {x["source"]: x for x in genre_sources.payload_fields("house")["source_links"]}
    assert (got["rym"]["url"], got["rym"]["kind"]) == ("https://rateyourmusic.com/genre/house/", "page")
    monkeypatch.setattr(genre_sources, "RYM_FILE", tmp_path / "missing.json")
    genre_sources.reset()
    assert "rym" not in genre_sources.sources_for("house")
