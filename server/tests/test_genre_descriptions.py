import json

import pytest

from app import genre_vocab
from tests.test_library import H, client  # noqa: F401


def names() -> set[str]:
    return set(genre_vocab.load().entries)


def test_the_file_loads_and_every_key_is_a_canonical_genre():
    d = genre_vocab.load_descriptions()
    assert len(d) >= 18
    assert set(d) <= names()
    assert all(t == t.strip() and 0 < len(t) <= genre_vocab.DESCRIPTION_MAX for t in d.values())


def test_parse_trims_the_text():
    assert genre_vocab.parse_descriptions({"house": "  Four on the floor.  "}, ["house"]) == {"house": "Four on the floor."}


@pytest.mark.parametrize("doc, message", [
    ({"nonsense genre": "x"}, "unknown genre"),
    ({"house": "   "}, "non-empty"),
    ({"house": 3}, "non-empty"),
    ({"house": "x" * (genre_vocab.DESCRIPTION_MAX + 1)}, "limit"),
    (["house"], "not a JSON object"),
])
def test_parse_rejects_bad_data(doc, message):
    with pytest.raises(ValueError, match=message):
        genre_vocab.parse_descriptions(doc, ["house"])


def test_a_text_at_the_limit_is_accepted():
    t = "x" * genre_vocab.DESCRIPTION_MAX
    assert genre_vocab.parse_descriptions({"house": t}, ["house"]) == {"house": t}


def test_a_bad_file_stops_startup(tmp_path, monkeypatch):
    f = tmp_path / "d.json"
    f.write_text(json.dumps({"no such genre": "x"}), encoding="utf-8")
    monkeypatch.setattr(genre_vocab, "DESCRIPTIONS_FILE", f)
    with pytest.raises(RuntimeError, match="genre descriptions invalid"):
        genre_vocab.check()


def test_a_missing_file_means_no_descriptions(tmp_path, monkeypatch):
    monkeypatch.setattr(genre_vocab, "DESCRIPTIONS_FILE", tmp_path / "none.json")
    assert genre_vocab.load_descriptions() == {}


def test_the_vocabulary_serves_description_on_rows_levels_and_forms(client):
    body = client.get("/genres/vocabulary", headers=H).json()
    rows = {r["name"]: r for r in body["genres"]}
    assert rows["outrun"]["description"].startswith("A synthwave subgenre")
    assert "description" not in rows["blues"]
    assert body["levels"]["outrun"]["description"] == rows["outrun"]["description"]
    assert body["forms"]["house"]["description"] == rows["house"]["description"]
    assert {r["name"] for r in body["genres"] if "description" in r} == set(genre_vocab.load_descriptions())


def test_goa_trance_description_is_a_ten_line_summary():
    t = genre_vocab.load_descriptions()["goa trance"]
    assert len(t.split("\n")) == 10
    assert t.startswith("Tempo: about 135-150 BPM")


def test_a_multi_line_text_is_accepted():
    assert genre_vocab.parse_descriptions({"house": "a\nb"}, ["house"]) == {"house": "a\nb"}
