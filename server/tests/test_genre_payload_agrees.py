"""The served vocabulary payload (`genre_vocab.vocabulary()`, behind GET /genres/vocabulary) keeps its flat `genres` rows (from genre_discogs.json and genre_extras.json) in step with the tree in `levels` (from genre_levels.json). The rows are the legacy view: Discogs rows list their Discogs families and an extra lists only its old primary parent, so `parents` are not compared in general, only where the tree has a genre as primary parent."""

import json
from pathlib import Path

import pytest

from app import genre_vocab

FIXTURE = Path(__file__).parent / "fixtures" / "genre_payload_levels.json"
LEGACY_PRIMARY = {"nu-nrg": ("hard trance", "trance")}


@pytest.fixture(scope="module")
def body():
    genre_vocab.reset()
    return genre_vocab.vocabulary()


def test_every_row_is_in_levels_with_the_same_family_and_a_level_of_two_or_three(body):
    for row in body["genres"]:
        if row["level"] == "family":
            continue
        lv = body["levels"][row["name"]]
        assert row["family"] == lv["family"], row["name"]
        assert lv["level"] in (2, 3, 4), row["name"]
    assert {r["name"] for r in body["genres"] if r["level"] != "family"} == set(body["levels"])


def test_an_extra_whose_tree_parent_is_a_genre_has_that_parent_in_its_row(body):
    families = set(body["families"])
    for row in body["genres"]:
        if not row["extra"]:
            continue
        tree = body["levels"][row["name"]]["parents"]
        if tree[0] in families:
            continue
        want = LEGACY_PRIMARY.get(row["name"], (tree[0], tree[0]))
        assert (row["parents"][0], tree[0]) == want, row["name"]


def test_spacesynth_and_space_disco_in_the_payload(body):
    rows = {r["name"]: r for r in body["genres"]}
    for src in (rows["spacesynth"], body["levels"]["spacesynth"]):
        assert src["parents"] == ["synthwave", "italo disco"]
    assert body["levels"]["spacesynth"]["level"] == 3
    assert rows["spacesynth"]["family"] == "Others"
    assert rows["space disco"]["parents"] == ["disco"]
    assert body["levels"]["space disco"]["parents"] == ["disco"]
    assert body["levels"]["space disco"]["level"] == 3


def test_levels_equal_genre_levels_json_for_parents_family_and_level(body):
    levels, _, _ = genre_vocab.load_levels()
    for name, lv in levels.items():
        got = body["levels"][name]
        assert (got["parents"], got["family"], got["level"]) == (lv["parents"], lv["family"], lv["level"]), name


def test_web_fixture_is_the_payload(body):
    keys = ("families", "family_synonyms", "modifiers", "flavours", "levels", "subfamilies")
    want = {k: body[k] for k in keys}
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == want, "regenerate the fixture from genre_vocab.vocabulary() (keys families, family_synonyms, modifiers, flavours, levels; json sort_keys, indent 1)"


def test_every_row_and_level_carries_all_families_and_the_legacy_family_is_the_first(body):
    order = body["families"]
    for row in body["genres"]:
        lv = body["levels"].get(row["name"])
        assert row["families"] and row["family"] == row["families"][0], row["name"]
        assert row["families"] == [f for f in order if f in row["families"]], row["name"]
        if lv:
            assert row["families"] == lv["families"] and lv["family"] == lv["families"][0], row["name"]
    rows = {r["name"]: r for r in body["genres"]}
    assert rows["disco"]["families"] == ["Others", "Funk / Soul"] == body["levels"]["euro disco"]["families"]
    assert rows["post-disco"]["families"] == ["Others", "Funk / Soul"] and body["levels"]["post-disco"]["parents"] == ["disco"]
    assert "electronic" not in rows and "others" not in rows, "Others is a group and electronic is not a genre: neither is a vocabulary row"
    assert "Others" in body["families"] and body["groups"]["Others"]["assignable"] is False and body["groups"]["Others"]["temporary"] is True


def test_the_graph_table_families_list_every_family_of_the_genre():
    from app import genre_graph

    assert genre_graph.table_families("Disco") == ("Electronic", "Funk / Soul")
    assert genre_graph.table_families("Zorbo", ["hip house"]) == ("Electronic", "Hip Hop")
    assert genre_graph.table_families("Zorbo") == ()
    assert genre_graph.table_family("disco") == "Electronic"
