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
    assert "Others" in v.families
    assert "others" not in v.entries
    assert "electronic" not in v.entries
    assert set(v.groups) == {"Others"}
    assert v.groups["Others"]["temporary"] is True
    assert v.groups["Others"]["kind"] == "organisational"
    assert genre_vocab.lookup("others") is None
    assert not genre_vocab.is_canonical("others")
    body = genre_vocab.vocabulary()
    assert "Others" in body["families"]
    assert all(body["families"].index(f) < body["families"].index("Others") for f in body["forms"]), "the promoted genres sit before the group Others in the families list"
    g = body["groups"]["Others"]
    assert (g["assignable"], g["temporary"], g["colour"], g["kind"]) == (False, True, "Electronic", "organisational")
    assert set(g["members"]) == {k for k, lv in genre_vocab.load_levels()[0].items() if "Others" in lv["parents"]}
    assert "electronic" not in g["members"]
    assert not {"house", "techno", "trance", "drum and bass", "synthwave", "synthpop", "disco"} & set(g["members"]), "level 1 forms, synthpop and disco are no members of Others (2026-10-20)"
    assert {"breakbeat", "ambient", "dub", "edm", "uk garage"} <= set(g["members"])
    assert not {r["name"] for r in body["genres"]} & {"others", "electronic"}
    assert set(body["forms"]) == {"house", "techno", "trance", "drum and bass", "synthwave"}
    assert "flavours" in body
    assert "family_synonyms" in body
    assert "Others" in body["family_synonyms"]
    assert "electronic" in body["family_synonyms"]["Others"]


def test_the_former_electronic_genres_after_house_techno_trance_dnb_synthwave_left_others_and_synthpop_and_disco_lost_the_parent():
    levels, forms = genre_vocab.load_levels()[0], genre_vocab.load_forms()
    assert any("Others" in v["families"] for v in levels.values())
    assert set(forms) == {"house", "techno", "trance", "drum and bass", "synthwave"}
    assert all(f["level"] == 1 and f["families"][0] == k and f["colour"] == "Others" for k, f in forms.items())
    assert "house" not in levels
    assert levels["deep house"]["parents"] == ["house"]
    assert levels["goa trance"]["parents"] == ["psytrance"]
    assert (levels["deep house"]["level"], levels["deep house"]["families"], levels["psytrance"]["level"], levels["goa trance"]["level"]) == (2, ["house"], 2, 3)
    assert levels["synthpop"]["parents"] == ["Pop", "new wave"]
    assert levels["synthpop"]["level"] == 2
    assert levels["synthpop"]["families"] == ["Pop", "Rock"]
    assert "Others" not in levels["synthpop"]["families"]
    assert levels["disco"]["parents"] == ["Funk / Soul"]
    assert levels["disco"]["level"] == 2
    assert levels["disco"]["families"] == ["Funk / Soul"]
    assert all(levels[k]["parents"] == ["disco"] and levels[k]["families"] == ["Funk / Soul"] for k in ("italo disco", "euro disco", "nu-disco", "hi-nrg", "space disco", "post-disco"))
    assert levels["dub"]["parents"] == ["Reggae", "Others"]
    assert not [k for k, v in levels.items() if "Electronic" in v["parents"] or "Electronic" in v.get("related", [])]
    assert levels["deep house"]["subfamily"] == "House", "the subfamily labels are kept"
    assert forms["house"]["subfamily"] == "House", "the subfamily labels are kept"


def test_the_five_level_1_forms_are_listed_and_the_level_counts_moved_as_recorded():
    body = genre_vocab.vocabulary()
    assert list(body["forms"]) == ["house", "techno", "trance", "drum and bass", "synthwave"]
    assert [f for f in body["families"] if f in body["forms"]] == list(body["forms"])
    assert genre_vocab.load().entries["trance"].level == "family"
    assert genre_vocab.family_of("goa trance") == "trance"


def test_genres_under_several_forms_keep_all_their_families():
    levels = genre_vocab.load_levels()[0]
    assert levels["acid"]["families"] == ["house", "techno", "Others"]
    assert levels["tech house"]["families"] == ["house", "techno"]
    assert levels["hands up"]["families"] == ["house", "trance", "Funk / Soul", "Pop"]
    assert levels["hands up"]["level"] == 2


def test_electronic_is_not_a_genre_it_is_unmappable_and_writes_are_rejected():
    assert not genre_vocab.is_canonical("electronic")
    assert gf.vocabulary_name("Electronic") is None
    assert gf.vocabulary_name("electronic music") is None
    assert gf.unmappable("electronic"), "stored tags are kept and reported, not dropped"
    assert not gf.is_dropped("electronic"), "stored tags are kept and reported, not dropped"
    reject = __import__("app.downloads", fromlist=["reject_unknown_genre"]).reject_unknown_genre
    with pytest.raises(Problem) as err:
        reject(["genre:electronic"])
    body = err.value.body()
    assert err.value.status == 422
    assert body["error"] == "unknown_genre"
    assert body["value"] == "electronic"
    assert "Others" in body["detail"]
    assert "not a genre" in body["detail"]
    __import__("app.downloads", fromlist=["x"]).reject_unknown_genre(["genre:electronic"], ["genre:electronic"])


def test_the_aliases_of_electronic_are_dropped_not_mapped():
    for loose in ("electronica", "indietronica", "alternative dance", "rave", "club", "dance & edm"):
        assert loose not in gf.ALIASES, loose
        assert gf.is_dropped(loose), loose
    assert "electronic" not in gf.ALIASES.values()
    assert gf.canonical("dance") == "edm", "edm stays a genre under Others"
    assert gf.vocabulary_name("edm") == "edm", "edm stays a genre under Others"


def test_a_source_naming_electronic_or_others_never_applies_or_suggests_it():
    d = genre_suggest.decide({genre_suggest.MUSICBRAINZ: ["electronic", "house"], genre_suggest.WIKIPEDIA_ARTIST: ["Electronic", "Others", "house"]})
    assert "electronic" not in d.applied
    assert "others" not in d.applied
    assert "electronic" not in [s["genre"] for s in d.suggestions]
    assert "others" not in [s["genre"] for s in d.suggestions]
    assert d.applied == ["house"]


def test_an_agreed_group_name_unlocks_nothing_for_the_song_page():
    S = genre_suggest
    for song in ("breakbeat", "techno"):
        d = genre_suggest.decide({S.MUSICBRAINZ: ["electronic"], S.WIKIPEDIA_ARTIST: ["electronic"], S.WIKIPEDIA_SONG: [song]})
        assert d.applied == [], "electronic is ignored evidence (CZ, 2026-10-20)"
    assert genre_suggest.decide({S.WIKIPEDIA_SONG: ["breakbeat"]}).applied == []


def test_the_graph_payload_keeps_the_legacy_families():
    assert genre_graph.table_family("house") == "Electronic" == genre_graph.table_family("Electronic music")
    assert set(genre_graph.families().values()) == set(genre_graph.FAMILIES)
    assert genre_graph.table_families("disco") == ("Funk / Soul",)
    assert genre_graph.table_family("disco") == "Funk / Soul"
    assert genre_graph.table_families("synthpop") == ("Pop", "Rock")
    for form in ("house", "techno", "trance", "drum and bass", "synthwave"):
        assert genre_graph.table_family(form) == "Electronic" == genre_graph.table_families(form)[0], form
        assert genre_graph.table_families(form) == ("Electronic",), form


def test_promote_makes_a_level_1_genre_and_its_children_rise_one_level(docs, data_dir):
    ops = _ops()
    levels, discogs, extras = (copy.deepcopy(d) for d in docs)
    before = genre_vocab.parse_levels(levels)[0]
    assert before["jungle"]["level"] == 3
    assert before["breakbeat"]["level"] == 2
    ops.promote(levels, discogs, extras, "breakbeat", None)
    ops.refresh_meta(levels)
    entries, forms, _, _ = genre_vocab.parse_all(levels)
    assert "breakbeat" not in entries
    assert forms["breakbeat"]["level"] == 1
    assert forms["breakbeat"]["families"] == ["breakbeat"]
    assert forms["breakbeat"]["parents"] == []
    assert forms["breakbeat"]["synonyms"] == before["breakbeat"]["synonyms"]
    assert forms["breakbeat"]["subfamily"] == "Breaks & bass"
    assert (entries["jungle"]["level"], entries["jungle"]["families"], entries["jungle"]["parents"]) == (2, ["breakbeat"], ["breakbeat"])
    assert entries["jungle"]["subfamily"] == "Breaks & bass", "the children keep the subfamily label of the promoted genre"
    assert entries["baltimore club"]["families"] == ["house", "breakbeat"]
    assert entries["baltimore club"]["level"] == 2
    assert levels["_meta"]["counts"]["breakbeat"]["total"] == len([k for k, v in entries.items() if "breakbeat" in v["families"]])
    assert levels["_meta"]["total"] == len(entries) == len(before) - 1
    data_dir(levels, discogs, extras)
    v = genre_vocab.load()
    assert v.entries["breakbeat"].level == "family"
    assert v.entries["breakbeat"].form
    assert v.entries["breakbeat"].family == "breakbeat"
    assert genre_vocab.is_canonical("breakbeat")
    assert genre_vocab.is_below_family("breakbeat") is False
    assert genre_vocab.family_of("jungle") == "breakbeat"
    body = genre_vocab.vocabulary()
    assert "breakbeat" in body["families"]
    assert body["forms"]["breakbeat"]["level"] == 1
    assert "breakbeat" not in body["levels"]
    assert genre_vocab.colour_family("breakbeat") == "Electronic", "a promoted genre keeps the legacy colour of Others"
    assert genre_graph.table_family("jungle") == "Electronic"
    assert genre_suggest.get_tree().depth["breakbeat"] == 1
    assert "breakbeat" not in genre_suggest.get_tree().families


def test_promote_keeps_extra_parents_and_stays_level_1(docs, data_dir):
    ops = _ops()
    levels, discogs, extras = (copy.deepcopy(d) for d in docs)
    ops.promote(levels, discogs, extras, "eurodance", None)
    entries, forms, _, _ = genre_vocab.parse_all(levels)
    assert forms["eurodance"]["parents"] == ["house", "euro disco", "Pop"]
    assert forms["eurodance"]["level"] == 1
    assert forms["eurodance"]["families"] == ["house", "eurodance", "Funk / Soul", "Pop"]
    assert entries["italodance"]["level"] == 2
    assert "eurodance" in entries["italodance"]["families"]


def test_promote_refuses_what_is_not_a_genre_or_already_level_1(docs):
    ops = _ops()
    levels, discogs, extras = (copy.deepcopy(d) for d in docs)
    with pytest.raises(SystemExit):
        ops.promote(levels, discogs, extras, "rock", None)
    with pytest.raises(SystemExit):
        ops.promote(levels, discogs, extras, "nonsense genre", None)
    with pytest.raises(SystemExit):
        ops.promote(levels, discogs, extras, "house", None)
    ops.promote(levels, discogs, extras, "breakbeat", None)
    with pytest.raises(SystemExit):
        ops.promote(levels, discogs, extras, "breakbeat", None)


def test_unparent_removes_one_parent_and_keeps_the_rest(docs):
    ops = _ops()
    levels, discogs, extras = (copy.deepcopy(d) for d in docs)
    levels["synthpop"]["parents"] = ["Others", "Pop", "new wave"]
    levels["disco"]["parents"] = ["Funk / Soul", "Others"]
    before = genre_vocab.parse_levels(levels)[0]
    assert before["synthpop"]["families"] == ["Others", "Pop", "Rock"]
    assert before["disco"]["families"] == ["Others", "Funk / Soul"]
    ops.unparent(levels, "synthpop", "Others")
    ops.unparent(levels, "disco", "Others")
    after = genre_vocab.parse_levels(levels)[0]
    assert levels["synthpop"]["parents"] == ["Pop", "new wave"]
    assert levels["disco"]["parents"] == ["Funk / Soul"]
    assert (after["synthpop"]["level"], after["synthpop"]["families"]) == (2, ["Pop", "Rock"])
    assert (after["disco"]["level"], after["disco"]["families"]) == (2, ["Funk / Soul"])
    assert after["euro disco"]["families"] == ["Funk / Soul"], "the children follow"
    assert after["ebm"]["families"] == ["Pop", "Rock"], "the children follow"
    with pytest.raises(SystemExit):
        ops.unparent(levels, "synthpop", "Others")
    with pytest.raises(SystemExit):
        ops.unparent(levels, "deep house", "house")
    with pytest.raises(SystemExit):
        ops.unparent(levels, "nonsense genre", "Others")


def test_unparent_works_on_a_promoted_genre_too(docs):
    ops = _ops()
    levels, discogs, extras = (copy.deepcopy(d) for d in docs)
    ops.promote(levels, discogs, extras, "eurodance", None)
    ops.unparent(levels, "eurodance", "Pop")
    forms = genre_vocab.parse_all(levels)[1]
    assert forms["eurodance"]["parents"] == ["house", "euro disco"]
    assert forms["eurodance"]["level"] == 1


def test_move_replaces_the_group_parent_and_a_bad_move_is_rejected(docs):
    ops = _ops()
    levels, discogs, extras = (copy.deepcopy(d) for d in docs)
    ops.reparent(levels, "downtempo", ["ambient"])
    entries = genre_vocab.parse_levels(levels)[0]
    assert entries["downtempo"]["parents"] == ["ambient"]
    assert entries["downtempo"]["level"] == 3
    assert entries["downtempo"]["families"] == ["Others"]
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
    assert out["nodes"]
    assert {n["family"] for n in out["nodes"]} <= legacy
    assert all(set(n["families"]) <= legacy for n in out["nodes"])
    assert not [n for n in out["nodes"] if "Others" in (n["family"], *n["families"])]
    by_label = {n["label"].lower(): n for n in out["nodes"]}
    for form in ("house", "techno", "trance", "drum and bass", "synthwave"):
        assert by_label[form]["family"] == "Electronic", form
    assert "Others" not in {n["family"] for n in out["nodes"]}


def test_the_hex_table_is_served_and_the_legacy_families_are_unchanged():
    body = genre_vocab.vocabulary()
    assert body["hex"] == {"Blues": "#0068F7", "Jazz": "#C900E0", "Pop": "#F664A5", "house": "#F7DF6A", "techno": "#535353", "drum and bass": "#E8BD0C", "synthwave": "#881DF7", "trance": "#51F724", "Funk / Soul": "#F7690A", "Hip Hop": "#FFFFFF", "Others": "#FFFFFF"}
    assert genre_graph.table_family("drum and bass") == "Electronic"
    assert genre_graph.table_family("jazz") == "Jazz"
    assert set(genre_graph.families().values()) == set(genre_graph.FAMILIES)


@pytest.mark.parametrize("key,bad", [("Jazz", "red"), ("Jazz", "#fff"), ("Jazz", 5), ("nonsense", "#112233")])
def test_a_malformed_hex_entry_is_rejected(key, bad):
    doc = json.loads((DATA / "genre_levels.json").read_text(encoding="utf-8"))
    doc["hex"] = {key: bad}
    with pytest.raises(ValueError, match="hex"):
        genre_vocab.parse_hex(doc)
