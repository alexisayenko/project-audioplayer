import copy
import json
from collections import Counter
from pathlib import Path

import pytest

from app import genre_filter as gf
from app import genre_vocab, library

from tests.test_library import H, client  # noqa: F401

DATA = Path(__file__).resolve().parent.parent / "data"
DISCOGS = json.loads((DATA / "genre_discogs.json").read_text(encoding="utf-8"))
EXTRAS = json.loads((DATA / "genre_extras.json").read_text(encoding="utf-8"))["extras"]
LEVELS = json.loads((DATA / "genre_levels.json").read_text(encoding="utf-8"))
FAMILIES = LEVELS["families"]
MODIFIERS = LEVELS["modifiers"]
RAW = {k: v for k, v in LEVELS.items() if k not in ("_meta", "families", "modifiers", "subfamilies")}
ENTRIES = genre_vocab.parse_levels(LEVELS)[0]
FORMS = {k for k, v in FAMILIES.items() if "discogs" in v}


def descent(k):
    out = set()
    for p in ENTRIES[k]["parents"]:
        out |= {p} if p in FAMILIES else descent(p)
    return out


def broken(base, fn):
    d = copy.deepcopy(base)
    fn(d)
    return d


def test_every_vocabulary_genre_appears_once():
    assert set(ENTRIES) == set(DISCOGS["genres"]) | set(EXTRAS)


def test_families_of_a_genre_are_listed_in_the_fixed_family_order_and_the_first_is_the_legacy_family():
    for k, v in ENTRIES.items():
        assert v["families"], k
        assert set(v["families"]) <= set(FAMILIES), k
        assert v["families"] == [f for f in FAMILIES if f in v["families"]], k
        assert v["family"] == v["families"][0], k


def test_families_match_the_vocabulary():
    entries = genre_vocab.load().entries
    for k, v in ENTRIES.items():
        assert list(entries[k].families) == v["families"], k
        assert entries[k].family == v["family"], k


def test_level_is_the_shortest_path_depth_and_has_no_cap():
    for k, v in ENTRIES.items():
        want = min(2 if p in FAMILIES else 1 + ENTRIES[p]["level"] for p in v["parents"])
        assert v["level"] == want, k
        assert k not in v["parents"], k
        assert len(set(v["parents"])) == len(v["parents"]), k
        assert all(p in FAMILIES or p in ENTRIES for p in v["parents"]), k
    assert min(v["level"] for v in ENTRIES.values()) == 2
    assert max(v["level"] for v in ENTRIES.values()) < genre_vocab.MAX_LEVEL


def test_the_families_of_a_genre_are_every_family_it_descends_from_and_there_is_no_override():
    assert not any("family" in v for v in RAW.values())
    for k, v in ENTRIES.items():
        assert set(v["families"]) == descent(k), k
    assert "genre" not in next(iter(RAW.values()))
    assert not any(("parent" in v or "also_under" in v or "also_in_genres" in v) for v in RAW.values())


def test_no_cycle_through_any_parent():
    def ancestors(k, seen=()):
        out = set()
        for p in ENTRIES[k]["parents"]:
            if p in ENTRIES and p not in seen:
                out |= {p} | ancestors(p, (*seen, k))
        return out

    for k in ENTRIES:
        assert k not in ancestors(k), k


def test_discogs_flag_matches_the_discogs_file():
    for k, v in ENTRIES.items():
        assert v["discogs"] is (k in DISCOGS["genres"]), k


def test_provisional_is_a_flag_and_an_approved_genre_is_never_provisional():
    for k, v in ENTRIES.items():
        assert isinstance(v["provisional"], bool), k
        if v["status"] == "approved":
            assert v["provisional"] is False, k
    assert set(LEVELS["_meta"]["drafted"]) <= set(FAMILIES)


def test_families_block_names_match_the_discogs_families_and_the_promoted_forms():
    assert [k for k in FAMILIES if k not in FORMS] == DISCOGS["families"]
    assert FORMS
    assert all(v["name"] == k for k, v in FAMILIES.items())
    assert not FORMS & set(ENTRIES), "a promoted form is a level 1 node, never an entry"


def test_synonyms_are_lowercase_and_collision_free():
    names = {g.lower() for g in DISCOGS["families"]}
    seen = {}
    pairs = [(g, s) for g, v in FAMILIES.items() for s in v["synonyms"]]
    pairs += [(k, s) for k, v in ENTRIES.items() for s in v["synonyms"]]
    for owner, s in pairs:
        assert s == s.lower(), s
        assert s.strip() == s, s
        assert s, s
        assert s not in ENTRIES, s
        assert s not in names, s
        assert s not in seen, (s, owner, seen.get(s))
        seen[s] = owner


@pytest.mark.parametrize("name, spellings", [
    ("sovietwave", ["soviet wave", "Soviet-Wave", "советская волна"]),
    ("french house", ["french touch", "French Touch", "french-touch"]),
    ("dream trance", ["dream house", "Dream Dance", "dream-house"]),
    ("uplifting trance", ["anthem trance", "Epic Trance", "euphoric-trance"]),
])
def test_synonyms_fold_to_the_genre_and_are_served_as_aliases(name, spellings):
    genre_vocab.reset()
    assert name in ENTRIES
    assert genre_vocab.lookup(name) == name
    aliases = genre_vocab.vocabulary()["aliases"]
    for raw in (name, *spellings):
        assert gf.canonical(raw) == name, raw
        assert gf.vocabulary_name(raw) == name, raw
        assert not gf.unmappable(raw), raw
    assert ENTRIES[name]["synonyms"]
    assert name not in aliases


REMOVED = {"electronic dance": "edm", "dance": "edm", "eurobeat": "eurodance", "chillout": "downtempo", "liquid funk": "liquid drum and bass"}


def test_removed_styles_are_gone_and_fold_to_a_vocabulary_target():
    genre_vocab.reset()
    for old, target in REMOVED.items():
        assert old not in ENTRIES, old
        assert old not in EXTRAS, old
        assert old not in DISCOGS["genres"], old
        assert genre_vocab.lookup(old) is None, old
        assert gf.canonical(old) == target, old
        assert gf.vocabulary_name(old) == target, old
        assert genre_vocab.lookup(target) == target
        assert not gf.unmappable(old)
        assert old in (ENTRIES.get(target) or FAMILIES[target])["synonyms"], old
    assert gf.canonical("Club Music") == "edm"
    assert gf.canonical("EDM") == "edm"
    assert gf.canonical("Liquid DnB") == "liquid drum and bass"
    for loose in ("russian electro pop", "electronic pop", "electropop"):
        assert gf.canonical(loose) == "synthpop"


def test_the_group_names_are_not_genres_and_their_loose_aliases_are_dropped():
    for loose in ("club", "electronica", "indietronica", "alternative dance", "rave", "dance & edm"):
        assert gf.is_dropped(loose), f"{loose} was an alias of electronic, which is not a genre: dropped"
    assert genre_vocab.lookup("electronic") is None
    assert not genre_vocab.is_canonical("electronic")
    assert genre_vocab.lookup("others") is None
    assert gf.unmappable("electronic")
    assert gf.vocabulary_name("Electronic Music") is None


def test_status_values():
    for k, v in ENTRIES.items():
        assert v["status"] in (None, "approved", "question"), k
        if v["status"] == "approved":
            assert v["discogs"] is False, k


def test_modifiers_block_and_assignments():
    assert MODIFIERS
    for k, f in MODIFIERS.items():
        assert k == k.lower(), k
        assert k.strip() == k, k
        assert k, k
        assert f["kind"] in ("sound", "mood", "scene"), k
        assert f["name"], k
        assert f["description"], k
    assert not any(v["modifiers"] for v in ENTRIES.values()), "modifiers are defined but not attached (awaiting Alex)"


def test_vocabulary_payload_carries_levels_and_family_synonyms():
    genre_vocab.reset()
    body = genre_vocab.vocabulary()
    assert set(body["levels"]) == set(ENTRIES)
    assert set(body["family_synonyms"]) == set(DISCOGS["families"]) | FORMS
    assert "genre_synonyms" not in body
    required = {"family", "families", "parents", "level", "discogs", "synonyms", "provisional", "status", "modifiers", "flavours", "display"}
    for name, lv in body["levels"].items():
        assert required <= set(lv), name
        assert lv["parents"] == RAW[name]["parents"], name
        assert not any(x in lv for x in ("genre", "parent", "also_under", "also_in_genres")), name
    assert body["modifiers"] == MODIFIERS
    assert body["flavours"] == body["modifiers"]
    assert all(v["flavours"] == v["modifiers"] for v in body["levels"].values())
    assert genre_vocab.DEPRECATED_ALIASES == {"modifiers": "flavours"}


def test_vocabulary_endpoint_serves_levels_to_guests(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    r = client.get("/genres/vocabulary", headers=H)
    assert r.status_code == 200
    assert "levels" in r.json()
    assert "family_synonyms" in r.json()


def test_modifiers_pass_through_the_parser():
    doc = {"families": {"Rock": {"name": "Rock", "synonyms": []}}, "modifiers": {"dark": {"name": "Dark", "kind": "sound", "description": "d"}},
           "a": {"parents": ["Rock"], "discogs": True, "modifiers": ["dark"]}}
    levels, _, modifiers = genre_vocab.parse_levels(doc)
    assert modifiers == {"dark": {"name": "Dark", "kind": "sound", "description": "d"}}
    assert levels["a"]["modifiers"] == ["dark"]


def test_malformed_levels_files_raise_a_clear_error(tmp_path, monkeypatch):
    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}}, "a": {"parents": ["Rock"], "discogs": True}, "b": {"parents": ["a"], "discogs": False}}
    assert set(genre_vocab.parse_levels(base)[0]) == {"a", "b"}

    bad = [
        ([], "families"),
        ({}, "families"),
        (broken(base, lambda d: d["a"].update(family="Rock")), "family' override"),
        (broken(base, lambda d: d["a"].pop("discogs")), "discogs"),
        (broken(base, lambda d: d["b"].update(parents=["zzz"])), "parent"),
        (broken(base, lambda d: d["a"].update(parents=["b"])), "own ancestor"),
        (broken(base, lambda d: d["a"].update(parents=[])), "parents"),
        (broken(base, lambda d: d["a"].pop("parents")), "parents"),
        (broken(base, lambda d: d["b"].update(parents=["b"])), "parents"),
        (broken(base, lambda d: d["b"].update(parents=["a", "a"])), "unique"),
        (broken(base, lambda d: d["a"].update(synonyms="x")), "synonyms"),
        (broken(base, lambda d: d.update(c="x")), "not an object"),
        (broken(base, lambda d: d["a"].update(status="maybe")), "status"),
        (broken(base, lambda d: d["a"].update(display=3)), "display"),
        (broken(base, lambda d: d["a"].update(modifiers=["nope"])), "unknown modifiers"),
        (broken(base, lambda d: d.update(modifiers={"x": {"name": "X", "kind": "vibe"}})), "kind"),
        (broken(base, lambda d: d.update(modifiers=[])), "modifiers"),
    ]
    for doc, word in bad:
        with pytest.raises(ValueError, match=word):
            genre_vocab.parse_levels(doc)

    path = tmp_path / "genre_levels.json"
    path.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(genre_vocab, "LEVELS_FILE", path)
    with pytest.raises(ValueError, match="genre_levels.json"):
        genre_vocab.load_levels()
    monkeypatch.setattr(genre_vocab, "LEVELS_FILE", tmp_path / "missing.json")
    with pytest.raises(ValueError, match="unreadable"):
        genre_vocab.load_levels()


def test_display_names_are_lowercase_trimmed_and_never_a_vocabulary_name_of_another_genre():
    assert not [k for k, v in ENTRIES.items() if v["display"] and v["display"] != v["display"].lower()]
    assert not [k for k, v in ENTRIES.items() if v["display"] == k]
    for k, v in ENTRIES.items():
        d = v.get("display")
        if d is not None:
            assert isinstance(d, str), k
            assert d.strip() == d, k
            assert d, k
            assert d.lower() == k or d.lower() not in ENTRIES, k
    for k in FORMS:
        assert genre_vocab.vocabulary()["forms"][k]["display"] == FAMILIES[k].get("display"), k


def test_display_is_validated_and_served():
    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}}, "a": {"parents": ["Rock"], "discogs": True, "display": "A!"}, "b": {"parents": ["Rock"], "discogs": True}}
    levels = genre_vocab.parse_levels(base)[0]
    assert levels["a"]["display"] == "A!"
    assert levels["b"]["display"] is None
    for bad in (5, "", "B"):
        d = {**base, "a": {**base["a"], "display": bad}}
        with pytest.raises(ValueError, match="display"):
            genre_vocab.parse_levels(d)


def test_migration_folds_removed_styles_idempotently_and_keeps_a_backup(tmp_path, monkeypatch):
    from app import migrate_tags

    monkeypatch.setattr(migrate_tags.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(migrate_tags.deps, "SYNC", None)
    d = tmp_path / "users" / "u1"
    d.mkdir(parents=True)
    lib = d / "library.json"
    old = [f"genre:{k}" for k in REMOVED]
    original = json.dumps({"songs": [
        {"id": "a", "title": "A", "tags": ["genre:house", "genre:dance music", "genre:electronic", "genre:dance", "genre:club music", "x"]},
        {"id": "b", "title": "B", "tags": old},
        {"id": "c", "title": "C", "tags": ["genre:rave"]},
    ]})
    lib.write_text(original)
    assert migrate_tags.run() == 1
    songs = {s["id"]: library.tag_list(s) for s in json.loads(lib.read_text())["songs"]}
    assert songs["a"] == ["genre:house", "genre:edm", "genre:electronic", "x"]
    assert songs["c"] == [], "rave is dropped now"
    assert songs["b"] == list(dict.fromkeys(f"genre:{t}" for t in REMOVED.values()))
    assert (tmp_path / "backups-genre-merge" / "u1" / "library.json").read_text() == original
    assert migrate_tags.run() == 0
    assert {s["id"]: library.tag_list(s) for s in json.loads(lib.read_text())["songs"]} == songs


def test_parents_are_validated_and_served():
    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}, "Pop": {"name": "Pop", "synonyms": []}},
            "a": {"parents": ["Rock", "Pop"], "discogs": True},
            "b": {"parents": ["a"], "discogs": True},
            "x": {"parents": ["Pop", "b"], "discogs": True}}
    levels = genre_vocab.parse_levels(base)[0]
    assert (levels["a"]["level"], levels["a"]["families"]) == (2, ["Rock", "Pop"])
    assert (levels["b"]["level"], levels["b"]["families"]) == (3, ["Rock", "Pop"])
    assert (levels["x"]["level"], levels["x"]["families"]) == (2, ["Rock", "Pop"])
    assert levels["x"]["family"] == "Rock"
    reordered = copy.deepcopy(base)
    reordered["x"]["parents"] = ["b", "Pop"]
    reordered["a"]["parents"] = ["Pop", "Rock"]
    assert {k: (v["level"], v["families"]) for k, v in genre_vocab.parse_levels(reordered)[0].items()} == {k: (v["level"], v["families"]) for k, v in levels.items()}
    deep = copy.deepcopy(base)
    deep["c"] = {"parents": ["b"], "discogs": True}
    deep["d"] = {"parents": ["c"], "discogs": True}
    got = genre_vocab.parse_levels(deep)[0]
    assert (got["c"]["level"], got["d"]["level"]) == (4, 5)
    chain = copy.deepcopy(base)
    prev = "b"
    for i in range(genre_vocab.MAX_LEVEL):
        chain[f"n{i}"] = {"parents": [prev], "discogs": True}
        prev = f"n{i}"
    with pytest.raises(ValueError, match="sanity bound"):
        genre_vocab.parse_levels(chain)

    bad = [
        (broken(base, lambda d: d["a"].update(parents=["Rock", "x"])), "own ancestor"),
        (broken(base, lambda d: d["b"].update(parents=["a", "x"])), "own ancestor"),
        (broken(base, lambda d: d["b"].update(parents=["a", "Nope"])), "parent"),
    ]
    for doc, word in bad:
        with pytest.raises(ValueError, match=word):
            genre_vocab.parse_levels(doc)


RM_GENRES = (
    "soundtrack", "trailer", "score", "musical", "theme", "incidental music", "vaudeville", "video game music",
    "audiobook", "speech", "spoken word", "poetry", "field recording", "interview", "radioplay", "education",
    "brass band", "marches", "military", "pipe & drum", "concert band", "educational", "lullaby", "nursery rhymes", "story",
)
RM_FAMILIES = ("Stage & Screen", "Children's", "Brass & Military", "Non-Music")


def test_removed_genres_and_families_are_gone_from_the_vocabulary_files():
    genre_vocab.reset()
    assert not set(RM_GENRES) & (set(ENTRIES) | set(DISCOGS["genres"]) | set(EXTRAS))
    assert not set(RM_FAMILIES) & (set(DISCOGS["families"]) | set(FAMILIES) | {v["family"] for v in ENTRIES.values()})
    assert not any(p in RM_GENRES for v in ENTRIES.values() for p in v["parents"])
    assert all(genre_vocab.lookup(n) is None for n in RM_GENRES), [n for n in RM_GENRES if genre_vocab.lookup(n)]


def test_removed_genres_are_dropped_from_songs_by_the_tag_cleaner():
    for name in (*RM_GENRES, "soundtracks", "film score", "kids"):
        assert gf.is_dropped(name), name
        assert not gf.is_genre(name), name
    assert library.clean_tags(["genre:Soundtrack", "genre:trailer", "genre:Score", "genre:house", "genre:epic"]) == ["genre:house"]
    assert library.clean_tags(["genre:trailer"]) == []


@pytest.mark.parametrize("name, kept", [("epic", "epic trance"), ("industrial", "industrial metal"), ("ethereal", "darkwave")])
def test_a_removed_descriptor_is_dropped_everywhere_and_the_related_genre_stays(name, kept):
    genre_vocab.reset()
    assert name not in ENTRIES
    assert name not in DISCOGS["genres"]
    assert name not in EXTRAS
    assert genre_vocab.lookup(name) is None
    assert gf.is_dropped(name)
    assert gf.is_dropped(name.title())
    assert not gf.is_dropped(kept)
    assert not any(name in v["parents"] or name in v.get("related", []) for v in ENTRIES.values())
    assert name not in genre_vocab.vocabulary()["aliases"].values()
    assert library.clean_tags([f"genre:{name.title()}", "genre:house"]) == ["genre:house"]


def test_counts_in_the_meta_block_match_the_data():
    counts = LEVELS["_meta"]["counts"]
    assert set(counts) == set(FAMILIES)
    for family in counts:
        mine = [v for v in ENTRIES.values() if family in v["families"]]
        by_level = Counter(v["level"] for v in mine)
        assert counts[family] == {"total": len(mine), "level2": by_level[2], "level3": by_level[3], "level4": by_level[4]}, family
    assert LEVELS["_meta"]["total"] == len(ENTRIES)
    assert sum(c["total"] for c in counts.values()) == sum(len(v["families"]) for v in ENTRIES.values())


def test_fusion_genres_belong_to_at_least_two_families():
    flagged = {k for k, v in ENTRIES.items() if v.get("fusion")}
    assert flagged
    assert all(len(ENTRIES[k]["families"]) >= 2 for k in flagged)
    assert all(v.get("fusion", True) is True for v in ENTRIES.values())


def test_a_genre_with_a_family_parent_and_a_genre_parent_takes_the_shorter_level():
    blends = [k for k, v in ENTRIES.items() if any(p in FAMILIES for p in v["parents"]) and any(p not in FAMILIES for p in v["parents"])]
    assert blends
    for k in blends:
        assert ENTRIES[k]["level"] == 2, k


def test_fusion_is_validated_and_served():
    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}, "Pop": {"name": "Pop", "synonyms": []}},
            "a": {"parents": ["Rock", "Pop"], "discogs": True, "fusion": True},
            "b": {"parents": ["Rock"], "discogs": True},
            "c": {"parents": ["b", "Pop"], "discogs": True, "fusion": False}}
    levels = genre_vocab.parse_levels(base)[0]
    assert levels["a"]["fusion"] is True
    assert "fusion" not in levels["b"]
    assert "fusion" not in levels["c"]

    for doc, word in [
        (broken(base, lambda d: d["b"].update(fusion=True)), "fewer than two"),
        (broken(base, lambda d: d["a"].update(fusion="yes")), "boolean"),
        (broken(base, lambda d: d["a"].update(fusion=1)), "boolean"),
        (broken(base, lambda d: d["a"].update(parents=["Rock", "b"])), "fewer than two"),
    ]:
        with pytest.raises(ValueError, match=word):
            genre_vocab.parse_levels(doc)
    genre_vocab.reset()
    body = genre_vocab.vocabulary()["levels"]
    for k, v in ENTRIES.items():
        assert body[k].get("fusion") == v.get("fusion"), k


def test_related_names_exist_and_are_never_a_parent():
    for k, v in ENTRIES.items():
        for r in v.get("related", []):
            assert r in FAMILIES or r in ENTRIES, (k, r)
            assert r not in v["parents"], (k, r)


def test_related_is_validated_and_served():
    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}, "Pop": {"name": "Pop", "synonyms": []}},
            "a": {"parents": ["Rock"], "discogs": True, "related": ["Pop", "c"]},
            "b": {"parents": ["a"], "discogs": True},
            "c": {"parents": ["Pop"], "discogs": True, "related": []}}
    levels = genre_vocab.parse_levels(base)[0]
    assert levels["a"]["related"] == ["Pop", "c"]
    assert "related" not in levels["b"]
    assert "related" not in levels["c"]
    assert (levels["a"]["level"], levels["a"]["family"]) == (2, "Rock")

    bad = [
        (broken(base, lambda d: d["a"].update(related=["a"])), "related"),
        (broken(base, lambda d: d["a"].update(related=["Rock"])), "related"),
        (broken(base, lambda d: d["a"].update(related=["c", "c"])), "unique"),
        (broken(base, lambda d: d["a"].update(related=["zzz"])), "not a family or an entry"),
        (broken(base, lambda d: d["a"].update(related=["b"])), "descendant"),
        (broken(base, lambda d: d["a"].update(related="c")), "related"),
        (broken(base, lambda d: d["a"].update(related=[""])), "related"),
    ]
    for doc, word in bad:
        with pytest.raises(ValueError, match=word):
            genre_vocab.parse_levels(doc)
    genre_vocab.reset()
    body = genre_vocab.vocabulary()["levels"]
    for k, v in ENTRIES.items():
        assert body[k].get("related") == v.get("related"), k


def test_subfamilies_are_ordered_labels_of_one_family_and_every_label_is_declared():
    subs = LEVELS["subfamilies"]
    assert [s["order"] for s in subs.values()] == list(range(1, len(subs) + 1))
    assert all(s["family"] in FAMILIES for s in subs.values())
    assert all(v["subfamily"] in subs for v in RAW.values() if v.get("subfamily"))
    assert all(FAMILIES[k]["subfamily"] in subs for k in FORMS if FAMILIES[k].get("subfamily"))
    for k, v in ENTRIES.items():
        if v.get("subfamily"):
            assert v["subfamily"] in subs, k


def test_a_child_inherits_the_subfamily_of_its_parent_unless_it_sets_its_own():
    for k, v in ENTRIES.items():
        own = RAW[k].get("subfamily")
        if own:
            assert v["subfamily"] == own, k
        elif v.get("subfamily"):
            assert any((ENTRIES.get(p) or FAMILIES[p]).get("subfamily") == v["subfamily"] for p in v["parents"]), k


def test_subfamily_is_validated_and_served():
    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}, "Pop": {"name": "Pop", "synonyms": []}},
            "subfamilies": {"S1": {"family": "Rock", "order": 1}, "S2": {"family": "Rock", "order": 2}},
            "a": {"parents": ["Rock"], "discogs": True, "subfamily": "S2"},
            "b": {"parents": ["a"], "discogs": True},
            "c": {"parents": ["Pop"], "discogs": True}}
    levels = genre_vocab.parse_levels(base)[0]
    assert levels["a"]["subfamily"] == "S2"
    assert levels["b"]["subfamily"] == "S2"
    assert "subfamily" not in levels["c"]
    both = copy.deepcopy(base)
    both["d"] = {"parents": ["Pop", "Rock"], "discogs": True, "subfamily": "S1"}
    both["e"] = {"parents": ["d"], "discogs": True}
    got = genre_vocab.parse_levels(both)[0]
    assert (got["d"]["family"], got["d"]["subfamily"], got["e"]["family"], "subfamily" in got["e"]) == ("Rock", "S1", "Rock", True)

    bad = [
        (broken(base, lambda d: d["a"].update(subfamily="Nope")), "unknown subfamily"),
        (broken(base, lambda d: d["c"].update(subfamily="S1")), "not one of the families"),
        (broken(base, lambda d: d["subfamilies"].update(S3={"family": "Rock"})), "order"),
        (broken(base, lambda d: d["subfamilies"].update(S3={"family": "Nope", "order": 3})), "unknown family"),
        (broken(base, lambda d: d.update(subfamilies=[])), "subfamilies"),
    ]
    for doc, word in bad:
        with pytest.raises(ValueError, match=word):
            genre_vocab.parse_levels(doc)
    genre_vocab.reset()
    body = genre_vocab.vocabulary()
    assert [(s["name"], s["family"], s["order"]) for s in body["subfamilies"]] == [(n, s["family"], s["order"]) for n, s in LEVELS["subfamilies"].items()]
    for k, v in ENTRIES.items():
        assert body["levels"][k].get("subfamily") == v.get("subfamily"), k
