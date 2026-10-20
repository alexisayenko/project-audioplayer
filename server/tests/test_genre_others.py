"""The temporary group `Others` (task-0066): the former Electronic family, a level 1 node that is never a vocabulary entry or assignable; `electronic` is not a genre; the promote and move operations of scripts/genre-ops.py."""

import copy
import importlib.util
import json
from pathlib import Path

import pytest

from app import genre_filter as gf
from app import genre_graph, genre_suggest, genre_vocab
from app.problems import Problem

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "server" / "data"


def _ops():
    spec = importlib.util.spec_from_file_location("genre_ops", ROOT / "scripts" / "genre-ops.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def docs():
    return tuple(json.loads((DATA / f).read_text(encoding="utf-8")) for f in ("genre_levels.json", "genre_discogs.json", "genre_extras.json"))


@pytest.fixture
def data_dir(tmp_path, monkeypatch, docs):
    """The data files in a temp dir, so a test can edit them and reload the vocabulary."""
    def put(levels, discogs, extras):
        for name, doc in (("genre_levels.json", levels), ("genre_discogs.json", discogs), ("genre_extras.json", extras)):
            (tmp_path / name).write_text(json.dumps(doc), encoding="utf-8")
        monkeypatch.setattr(genre_vocab, "LEVELS_FILE", tmp_path / "genre_levels.json")
        monkeypatch.setattr(genre_vocab, "DISCOGS_FILE", tmp_path / "genre_discogs.json")
        monkeypatch.setattr(genre_vocab, "EXTRAS_FILE", tmp_path / "genre_extras.json")
        genre_vocab.reset()

    yield put
    monkeypatch.undo()
    genre_vocab.reset()


def test_others_is_a_level_1_group_that_is_not_a_vocabulary_entry():
    genre_vocab.reset()
    v = genre_vocab.load()
    assert "Others" in v.families and "others" not in v.entries and "electronic" not in v.entries
    assert set(v.groups) == {"Others"} and v.groups["Others"]["temporary"] is True and v.groups["Others"]["kind"] == "organisational"
    assert genre_vocab.lookup("others") is None and not genre_vocab.is_canonical("others")
    body = genre_vocab.vocabulary()
    assert "Others" in body["families"] and body["families"].index("Others") == 2, "Others keeps the slot of Electronic"
    g = body["groups"]["Others"]
    assert (g["assignable"], g["temporary"], g["colour"], g["kind"]) == (False, True, "Electronic", "organisational")
    assert len(g["members"]) == 51 and "house" in g["members"] and "disco" in g["members"] and "electronic" not in g["members"]
    assert not {r["name"] for r in body["genres"]} & {"others", "electronic"}
    assert body["forms"] == {} and "flavours" in body and "family_synonyms" in body and "Others" in body["family_synonyms"]
    assert "electronic" in body["family_synonyms"]["Others"]


def test_every_former_electronic_genre_sits_under_others_and_the_tree_below_is_unchanged():
    levels = genre_vocab.load_levels()[0]
    under = [k for k, v in levels.items() if "Others" in v["families"]]
    assert len(under) == 146
    assert levels["house"]["parents"] == ["Others"] and levels["deep house"]["parents"] == ["house"] and levels["goa trance"]["parents"] == ["psytrance"]
    assert levels["disco"]["parents"] == ["Funk / Soul", "Others"] and levels["dub"]["parents"] == ["Reggae", "Others"]
    assert levels["goa trance"]["level"] == 4 and levels["house"]["level"] == 2
    assert not [k for k, v in levels.items() if "Electronic" in v["parents"] or "Electronic" in v.get("related", [])]
    assert levels["house"]["subfamily"] == "House"


def test_electronic_is_not_a_genre_it_is_unmappable_and_writes_are_rejected():
    assert not genre_vocab.is_canonical("electronic") and gf.vocabulary_name("Electronic") is None and gf.vocabulary_name("electronic music") is None
    assert gf.unmappable("electronic") and not gf.is_dropped("electronic"), "stored tags are kept and reported, not dropped"
    with pytest.raises(Problem) as err:
        reject = __import__("app.downloads", fromlist=["reject_unknown_genre"]).reject_unknown_genre
        reject(["genre:electronic"])
    body = err.value.body()
    assert err.value.status == 422 and body["error"] == "unknown_genre" and body["value"] == "electronic"
    assert "Others" in body["detail"] and "not a genre" in body["detail"]
    __import__("app.downloads", fromlist=["x"]).reject_unknown_genre(["genre:electronic"], ["genre:electronic"])


def test_the_aliases_of_electronic_are_dropped_not_mapped():
    for loose in ("electronica", "indietronica", "alternative dance", "rave", "club", "dance & edm"):
        assert loose not in gf.ALIASES and gf.is_dropped(loose), loose
    assert "electronic" not in gf.ALIASES.values()
    assert gf.canonical("dance") == "edm" and gf.vocabulary_name("edm") == "edm", "edm stays a genre under Others"


def test_a_source_naming_electronic_or_others_never_applies_or_suggests_it():
    d = genre_suggest.decide({genre_suggest.MUSICBRAINZ: ["electronic", "house"], genre_suggest.WIKIPEDIA_ARTIST: ["Electronic", "Others", "house"]})
    assert "electronic" not in d.applied and "others" not in d.applied
    assert "electronic" not in [s["genre"] for s in d.suggestions] and "others" not in [s["genre"] for s in d.suggestions]
    assert d.applied == ["house"]


def test_an_agreed_group_still_lets_the_song_page_apply_a_genre_of_the_group():
    S = genre_suggest
    d = genre_suggest.decide({S.MUSICBRAINZ: ["electronic"], S.WIKIPEDIA_ARTIST: ["electronic"], S.WIKIPEDIA_SONG: ["techno"]})
    assert d.applied == ["techno"]
    alone = genre_suggest.decide({S.WIKIPEDIA_SONG: ["techno"]})
    assert alone.applied == []


def test_the_graph_payload_keeps_the_11_legacy_families():
    assert genre_graph.table_family("house") == "Electronic" == genre_graph.table_family("Electronic music")
    assert set(genre_graph.families().values()) == set(genre_graph.FAMILIES)
    assert genre_graph.table_families("disco") == ("Electronic", "Funk / Soul")


def test_promote_makes_a_level_1_genre_and_its_children_rise_one_level(docs, data_dir):
    ops = _ops()
    levels, discogs, extras = (copy.deepcopy(d) for d in docs)
    before = genre_vocab.parse_levels(levels)[0]
    assert before["deep house"]["level"] == 3 and before["house"]["level"] == 2
    ops.promote(levels, discogs, extras, "house", None)
    ops.refresh_meta(levels)
    entries, forms, _, _ = genre_vocab.parse_all(levels)
    assert "house" not in entries and forms["house"]["level"] == 1 and forms["house"]["families"] == ["house"] and forms["house"]["parents"] == []
    assert forms["house"]["synonyms"] == before["house"]["synonyms"] and forms["house"]["related"] == ["disco"]
    assert (entries["deep house"]["level"], entries["deep house"]["families"], entries["deep house"]["parents"]) == (2, ["house"], ["house"])
    assert entries["hip house"]["families"] == ["house", "Hip Hop"] and entries["acid"]["families"] == ["house", "Others"], "acid also sits under Others and techno (not promoted yet)"
    assert levels["_meta"]["counts"]["house"]["total"] == len([k for k, v in entries.items() if "house" in v["families"]])
    assert levels["_meta"]["total"] == len(entries) == 533
    data_dir(levels, discogs, extras)
    v = genre_vocab.load()
    assert v.entries["house"].level == "family" and v.entries["house"].form and v.entries["house"].family == "house"
    assert genre_vocab.is_canonical("house") and genre_vocab.is_below_family("house") is False and genre_vocab.family_of("deep house") == "house"
    body = genre_vocab.vocabulary()
    assert "house" in body["families"] and body["forms"]["house"]["level"] == 1 and "house" not in body["levels"]
    assert genre_vocab.colour_family("house") == "Electronic", "a promoted genre keeps the legacy colour of Others"
    assert genre_graph.table_family("deep house") == "Electronic"
    assert genre_suggest.get_tree().depth["house"] == 1 and "house" not in genre_suggest.get_tree().families


def test_promote_keeps_extra_parents_and_stays_level_1(docs, data_dir):
    ops = _ops()
    levels, discogs, extras = (copy.deepcopy(d) for d in docs)
    ops.promote(levels, discogs, extras, "eurodance", None)
    entries, forms, _, _ = genre_vocab.parse_all(levels)
    assert forms["eurodance"]["parents"] == ["house", "euro disco", "Pop"] and forms["eurodance"]["level"] == 1
    assert forms["eurodance"]["families"] == ["eurodance", "Others", "Funk / Soul", "Pop"]
    assert entries["italodance"]["level"] == 2 and "eurodance" in entries["italodance"]["families"]


def test_promote_refuses_what_is_not_a_genre_or_already_level_1(docs):
    ops = _ops()
    levels, discogs, extras = (copy.deepcopy(d) for d in docs)
    with pytest.raises(SystemExit):
        ops.promote(levels, discogs, extras, "rock", None)
    with pytest.raises(SystemExit):
        ops.promote(levels, discogs, extras, "nonsense genre", None)
    ops.promote(levels, discogs, extras, "house", None)
    with pytest.raises(SystemExit):
        ops.promote(levels, discogs, extras, "house", None)


def test_move_replaces_the_group_parent_and_a_bad_move_is_rejected(docs):
    ops = _ops()
    levels, discogs, extras = (copy.deepcopy(d) for d in docs)
    ops.reparent(levels, "downtempo", ["ambient"])
    entries = genre_vocab.parse_levels(levels)[0]
    assert entries["downtempo"]["parents"] == ["ambient"] and entries["downtempo"]["level"] == 3 and entries["downtempo"]["families"] == ["Others"]
    ops.reparent(levels, "ambient", ["downtempo"])
    with pytest.raises(ValueError):
        genre_vocab.parse_all(levels)


def test_the_data_files_are_canonical_json_so_an_op_rewrites_them_without_noise(docs):
    for name, doc in zip(("genre_levels.json", "genre_discogs.json", "genre_extras.json"), docs):
        assert json.dumps(doc, indent=1, ensure_ascii=False) + "\n" == (DATA / name).read_text(encoding="utf-8"), name


def test_a_built_graph_payload_only_carries_legacy_families_never_others():
    from app import genre_vocab as gv
    names = sorted(gv.load().entries)
    songs = [{"id": f"s{i}", "tags": [f"genre:{n}"]} for i, n in enumerate(names)]
    songs.append({"id": "grp", "tags": ["genre:Others", "genre:house"]})
    out = genre_graph.build(songs, genre_graph._empty())
    legacy = set(genre_graph.FAMILIES) | {genre_graph.OTHER}
    assert out["nodes"] and {n["family"] for n in out["nodes"]} <= legacy
    assert all(set(n["families"]) <= legacy for n in out["nodes"])
    assert not [n for n in out["nodes"] if "Others" in (n["family"], *n["families"])]
