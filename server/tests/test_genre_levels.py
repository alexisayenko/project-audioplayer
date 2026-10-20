import json

from app import genre_vocab, library
from pathlib import Path

from tests.test_library import H, client  # noqa: F401

DATA = Path(__file__).resolve().parent.parent / "data"
DISCOGS = json.loads((DATA / "genre_discogs.json").read_text(encoding="utf-8"))
EXTRAS = json.loads((DATA / "genre_extras.json").read_text(encoding="utf-8"))["extras"]
LEVELS = json.loads((DATA / "genre_levels.json").read_text(encoding="utf-8"))
FAMILIES = LEVELS["families"]
MODIFIERS = LEVELS["modifiers"]
RAW = {k: v for k, v in LEVELS.items() if k not in ("_meta", "families", "modifiers")}
ENTRIES = genre_vocab.parse_levels(LEVELS)[0]


def family_parents(k):
    return [p for p in ENTRIES[k]["parents"] if p in FAMILIES]


def descent(k, seen=()):
    out = set()
    for p in ENTRIES[k]["parents"]:
        out |= {p} if p in FAMILIES else descent(p)
    return out


def test_every_vocabulary_genre_appears_once():
    assert set(ENTRIES) == set(DISCOGS["genres"]) | set(EXTRAS)


def test_families_are_among_the_eleven_in_the_fixed_order_and_the_first_is_the_legacy_family():
    for k, v in ENTRIES.items():
        assert v["families"] and set(v["families"]) <= set(DISCOGS["families"]), k
        assert v["families"] == [f for f in DISCOGS["families"] if f in v["families"]], k
        assert v["family"] == v["families"][0], k


def test_families_match_the_vocabulary():
    entries = genre_vocab.load().entries
    for k, v in ENTRIES.items():
        assert list(entries[k].families) == v["families"] and entries[k].family == v["family"], k


def test_level_is_the_shortest_path_depth_and_has_no_cap():
    for k, v in ENTRIES.items():
        want = min(2 if p in FAMILIES else 1 + ENTRIES[p]["level"] for p in v["parents"])
        assert v["level"] == want, k
        assert k not in v["parents"], k
        assert len(set(v["parents"])) == len(v["parents"]), k
        assert all(p in FAMILIES or p in ENTRIES for p in v["parents"]), k
    assert {v["level"] for v in ENTRIES.values()} == {2, 3, 4}
    assert genre_vocab.MAX_LEVEL == 12


def test_the_families_of_a_genre_are_every_family_it_descends_from_and_there_is_no_override():
    assert not any("family" in v for v in RAW.values())
    for k, v in ENTRIES.items():
        assert set(v["families"]) == descent(k), k
    assert "genre" not in next(iter(RAW.values())) and not any(("parent" in v or "also_under" in v or "also_in_genres" in v) for v in RAW.values())


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


def test_only_electronic_and_rock_are_drafted_and_rock_keeps_the_held_genres_provisional():
    assert LEVELS["_meta"]["drafted"] == ["Others", "Rock"]
    for k, v in ENTRIES.items():
        if k in NINE:
            assert v["provisional"] is False, k
        elif v["families"] == ["Rock"]:
            assert v["provisional"] is (k in HELD_ROCK), k
        elif "Others" not in v["families"] and "Rock" not in v["families"]:
            assert v["provisional"] is True, k


def test_families_block_names_match_the_eleven():
    assert list(FAMILIES) == DISCOGS["families"]
    assert all(v["name"] == k for k, v in FAMILIES.items())


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


def test_electronic_synonyms():
    assert FAMILIES["Others"]["synonyms"] == [
        "electronic music", "electronica", "indietronica", "alternative dance", "rave", "dance & edm", "electronic",
    ]


REMOVED = {
    "electronic dance": "edm", "dance": "edm", "eurobeat": "eurodance",
    "chillout": "downtempo", "afro house": "house", "big room house": "house", "bubblegum dance": "eurodance", "techstep": "drum and bass",
    "liquid funk": "liquid drum and bass", "breakbeat hardcore": "breakbeat", "jersey club": "breakbeat",
    "techno pop": "synthpop", "electropop": "synthpop", "melodic house": "house",
}
APPROVED = {"dark psytrance", "forest psytrance", "progressive psytrance", "full-on psytrance", "vocal trance", "melodic techno", "psybient", "darksynth", "uplifting trance", "sunshine house", "dreamsynth", "dreamwave", "neurofunk",
            "spacesynth", "nu-nrg", "liquid drum and bass", "sovietwave", "dream trance", "space disco"} | {"hardcore punk", "experimental rock", "extreme metal", "noise rock", "roots rock", "neo-psychedelia", "glam metal", "college rock", "death-doom", "edm"}
QUESTION = {"deep trance", "acid trance"}


def test_removed_styles_are_gone_and_fold_to_a_vocabulary_target():
    from app import genre_filter as gf
    from app import genre_vocab

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
    assert gf.canonical("Club Music") == "edm"
    for loose in ("club", "electronica", "indietronica", "alternative dance", "rave", "dance & edm"):
        assert gf.is_dropped(loose), f"{loose} was an alias of electronic, which is not a genre: dropped"
    assert genre_vocab.lookup("electronic") is None and not genre_vocab.is_canonical("electronic") and genre_vocab.lookup("others") is None
    assert gf.unmappable("electronic") and gf.vocabulary_name("Electronic Music") is None
    assert gf.canonical("dance music") == "edm"
    assert gf.canonical("EDM") == "edm"
    assert gf.canonical("Liquid DnB") == "liquid drum and bass"
    for loose in ("russian electro pop", "electronic pop"):
        assert gf.canonical(loose) == "synthpop"


def test_removed_names_are_synonyms_of_their_target_or_dropped_as_redundant():
    for old, target in REMOVED.items():
        if target == "electronic":
            assert old in FAMILIES["Others"]["synonyms"], old
        else:
            assert old in ENTRIES[target]["synonyms"], old
    assert "electropop" in ENTRIES["synthpop"]["synonyms"]


def test_status_values():
    for k, v in ENTRIES.items():
        assert v["status"] in (None, "approved", "question"), k
    assert {k for k, v in ENTRIES.items() if v["status"] == "approved"} == APPROVED
    assert {k for k, v in ENTRIES.items() if v["status"] == "question"} == QUESTION


def test_approved_never_sits_on_a_discogs_genre():
    for k, v in ENTRIES.items():
        if v["status"] == "approved":
            assert v["discogs"] is False, k
    assert "status" not in RAW["tropical house"]
    assert "status" not in RAW["chillwave"]


def test_liquid_drum_and_bass_entry():
    e = ENTRIES["liquid drum and bass"]
    assert (e["family"], e["parents"], e["discogs"]) == ("Others", ["drum and bass"], False)
    assert EXTRAS["liquid drum and bass"]["parents"] == ["drum and bass"]
    assert "liquid funk" in e["synonyms"]
    assert len(set(e["synonyms"])) == len(e["synonyms"])


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
    assert any(f["kind"] == "scene" for f in MODIFIERS.values())
    assert any(f["kind"] == "sound" for f in MODIFIERS.values())
    assert {k for k, f in MODIFIERS.items() if f["kind"] == "mood"} == {"dark", "deep", "uplifting"}


def _payload_with(doc):
    from app import genre_vocab

    return genre_vocab.parse_levels(doc)


def test_vocabulary_payload_carries_levels_and_family_synonyms():
    from app import genre_vocab

    genre_vocab.reset()
    body = genre_vocab.vocabulary()
    assert set(body["levels"]) == set(ENTRIES)
    assert set(body["family_synonyms"]) == set(DISCOGS["families"])
    assert "genre_synonyms" not in body
    dh = body["levels"]["deep house"]
    assert dh == {"family": "Others", "families": ["Others"], "parents": ["house"], "level": 3, "discogs": True, "synonyms": [], "provisional": False, "subfamily": "House", "status": ENTRIES["deep house"]["status"], "modifiers": ENTRIES["deep house"]["modifiers"], "flavours": ENTRIES["deep house"]["modifiers"], "display": ENTRIES["deep house"]["display"]}
    assert body["levels"]["jungle"]["parents"] == RAW["jungle"]["parents"] == ["breakbeat"]
    assert not any(k in dh for k in ("genre", "parent", "also_under", "also_in_genres"))
    nd = next(k for k, v in ENTRIES.items() if v["discogs"] is False)
    assert body["levels"][nd]["discogs"] is False
    assert body["levels"]["rock and roll"]["provisional"] is False and body["levels"]["mod"]["provisional"] is True
    assert "edm" not in body["family_synonyms"]["Others"] and "edm" in body["levels"]
    assert body["modifiers"] == MODIFIERS
    assert body["flavours"] == body["modifiers"]
    assert body["levels"]["deep trance"]["status"] == "question"
    assert len(json.dumps(body["levels"])) < 130_000


def test_vocabulary_endpoint_serves_levels_to_guests(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    r = client.get("/genres/vocabulary", headers=H)
    assert r.status_code == 200
    assert "levels" in r.json()
    assert "family_synonyms" in r.json()


def test_display_name_passes_through_the_parser():
    doc = {"families": {"Rock": {"name": "Rock", "synonyms": []}}, "a": {"parents": ["Rock"], "discogs": True, "display": "A & B"}, "b": {"parents": ["Rock"], "discogs": True}}
    levels = _payload_with(doc)[0]
    assert levels["a"]["display"] == "A & B"
    assert levels["b"]["display"] is None


def test_modifiers_pass_through_the_parser():
    doc = {"families": {"Rock": {"name": "Rock", "synonyms": []}}, "modifiers": {"dark": {"name": "Dark", "kind": "sound", "description": "d"}},
           "a": {"parents": ["Rock"], "discogs": True, "modifiers": ["dark"]}}
    levels, _, modifiers = _payload_with(doc)
    assert modifiers == {"dark": {"name": "Dark", "kind": "sound", "description": "d"}}
    assert levels["a"]["modifiers"] == ["dark"]


def test_malformed_levels_files_raise_a_clear_error(tmp_path, monkeypatch):
    import copy

    import pytest
    from app import genre_vocab

    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}}, "a": {"parents": ["Rock"], "discogs": True}, "b": {"parents": ["a"], "discogs": False}}
    assert set(_payload_with(base)[0]) == {"a", "b"}

    def broken(mutate):
        d = copy.deepcopy(base)
        mutate(d)
        return d

    bad = [
        ([], "families"),
        ({}, "families"),
        (broken(lambda d: d["a"].update(family="Rock")), "family' override"),
        (broken(lambda d: d["a"].pop("discogs")), "discogs"),
        (broken(lambda d: d["b"].update(parents=["zzz"])), "parent"),
        (broken(lambda d: d["a"].update(parents=["b"])), "own ancestor"),
        (broken(lambda d: d["a"].update(parents=[])), "parents"),
        (broken(lambda d: d["a"].pop("parents")), "parents"),
        (broken(lambda d: d["b"].update(parents=["b"])), "parents"),
        (broken(lambda d: d["b"].update(parents=["a", "a"])), "unique"),
        (broken(lambda d: d["a"].update(synonyms="x")), "synonyms"),
        (broken(lambda d: d.update(c="x")), "not an object"),
        (broken(lambda d: d["a"].update(status="maybe")), "status"),
        (broken(lambda d: d["a"].update(display=3)), "display"),
        (broken(lambda d: d["a"].update(modifiers=["nope"])), "unknown modifiers"),
        (broken(lambda d: d.update(modifiers={"x": {"name": "X", "kind": "vibe"}})), "kind"),
        (broken(lambda d: d.update(modifiers=[])), "modifiers"),
    ]
    for doc, word in bad:
        with pytest.raises(ValueError, match=word):
            _payload_with(doc)

    path = tmp_path / "genre_levels.json"
    path.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(genre_vocab, "LEVELS_FILE", path)
    with pytest.raises(ValueError, match="genre_levels.json"):
        genre_vocab.load_levels()
    monkeypatch.setattr(genre_vocab, "LEVELS_FILE", tmp_path / "missing.json")
    with pytest.raises(ValueError, match="unreadable"):
        genre_vocab.load_levels()


def test_display_names():
    assert ENTRIES["drum and bass"]["display"] == "drum & bass"
    assert ENTRIES["liquid drum and bass"]["display"] == "liquid drum & bass"
    assert [k for k, v in ENTRIES.items() if v["display"] and v["display"] != v["display"].lower()] == []
    assert not [k for k, v in ENTRIES.items() if v["display"] == k]
    for k, v in ENTRIES.items():
        d = v.get("display")
        if d is not None:
            assert isinstance(d, str), k
            assert d.strip() == d, k
            assert d, k
            assert d.lower() == k or d.lower() not in ENTRIES, k
    for syn in ("dnb", "d&b", "drum n bass", "drum'n'bass", "drum and bass music", "drum & bass music"):
        assert syn in ENTRIES["drum and bass"]["synonyms"], syn
    assert "drum and bass" not in ENTRIES["drum and bass"]["synonyms"]


def test_display_is_validated_and_served():
    import pytest
    from app import genre_vocab

    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}}, "a": {"parents": ["Rock"], "discogs": True, "display": "A!"}, "b": {"parents": ["Rock"], "discogs": True}}
    levels = genre_vocab.parse_levels(base)[0]
    assert levels["a"]["display"] == "A!"
    assert levels["b"]["display"] is None
    for bad in (5, "", "B"):
        d = {**base, "a": {**base["a"], "display": bad}}
        with pytest.raises(ValueError, match="display"):
            genre_vocab.parse_levels(d)
    genre_vocab.reset()
    assert genre_vocab.vocabulary()["levels"]["drum and bass"]["display"] == "drum & bass"


def test_migration_folds_removed_styles_idempotently_and_keeps_a_backup(tmp_path, monkeypatch):
    from app import migrate_tags

    monkeypatch.setattr(migrate_tags.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(migrate_tags.deps, "SYNC", None)
    d = tmp_path / "users" / "u1"
    d.mkdir(parents=True)
    lib = d / "library.json"
    old = [f"genre:{k}" for k in REMOVED]
    original = json.dumps({"songs": [
        {"id": "a", "title": "A", "tags": ["genre:house", "genre:afro house", "genre:dance music", "genre:electronic", "genre:dance", "genre:club music", "x"]},
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


def test_disco_belongs_to_funk_soul_and_electronic_and_so_do_its_children():
    assert ENTRIES["disco"]["families"] == ["Others", "Funk / Soul"]
    assert set(ENTRIES["disco"]["parents"]) == {"Funk / Soul", "Others"}
    assert ENTRIES["disco"]["level"] == 2
    kids = {k for k, v in ENTRIES.items() if "disco" in v["parents"]}
    assert kids == {"euro disco", "italo disco", "hi-nrg", "nu-disco", "space disco", "post-disco"}
    assert not any("family" in RAW[k] for k in kids)
    assert all(ENTRIES[k]["families"] == ["Others", "Funk / Soul"] and ENTRIES[k]["level"] == 3 for k in kids)
    assert ENTRIES["post-disco"]["parents"] == ["disco"] == EXTRAS["post-disco"]["parents"]
    assert "italo disco" in ENTRIES["spacesynth"]["parents"]
    assert "disco polo" not in kids


def test_a_blend_is_level_two_through_its_family_parent_and_level_three_through_its_genre_parent():
    for k in ("hip house", "trip hop", "folk metal", "folk punk", "rap metal", "funk metal"):
        assert ENTRIES[k]["level"] == 2, k
        assert any(p in FAMILIES for p in ENTRIES[k]["parents"]) and any(p not in FAMILIES for p in ENTRIES[k]["parents"]), k
        assert min(1 + ENTRIES[p]["level"] for p in ENTRIES[k]["parents"] if p not in FAMILIES) == 3, k


def test_parents_are_validated_and_served():
    import copy

    import pytest

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

    def broken(fn):
        d = copy.deepcopy(base)
        fn(d)
        return d

    bad = [
        (broken(lambda d: d["a"].update(parents=["Rock", "x"])), "own ancestor"),
        (broken(lambda d: d["b"].update(parents=["a", "x"])), "own ancestor"),
        (broken(lambda d: d["b"].update(parents=["a", "Nope"])), "parent"),
    ]
    for doc, word in bad:
        with pytest.raises(ValueError, match=word):
            genre_vocab.parse_levels(doc)
    genre_vocab.reset()
    body = genre_vocab.vocabulary()["levels"]
    assert set(body["disco"]["parents"]) == {"Funk / Soul", "Others"} and body["disco"]["families"] == ["Others", "Funk / Soul"]
    assert body["deep house"]["parents"] == ["house"]


def test_psytrance_sits_under_trance_and_its_branch_goes_down_to_level_four():
    p = ENTRIES["psytrance"]
    assert (p["parents"], p["discogs"], p["display"], p["level"], p["families"]) == (["trance"], True, "psy-trance", 3, ["Others"])
    assert [k for k, v in ENTRIES.items() if v["level"] == 4] == sorted(k for k in ENTRIES if ENTRIES[k]["level"] == 4) == ["dark psytrance", "forest psytrance", "full-on psytrance", "goa trance", "progressive psytrance"]
    assert ENTRIES["psybient"]["level"] == 3 and RAW["psytrance"]["subfamily"] == "Trance"
    kids = {k for k, v in ENTRIES.items() if "psytrance" in v["parents"]}
    assert kids == {"dark psytrance", "forest psytrance", "progressive psytrance", "full-on psytrance", "goa trance", "psybient"}
    for k in kids:
        assert ENTRIES[k]["family"] == "Others"
    assert ENTRIES["goa trance"]["parents"] == ["psytrance"]
    assert ENTRIES["goa trance"]["discogs"] is True
    assert ENTRIES["psybient"]["parents"] == ["psytrance", "ambient"]
    assert ENTRIES["progressive trance"]["parents"] == ["trance"]
    assert not any("trance" in v["parents"] and k in kids for k, v in ENTRIES.items() if k != "psytrance")
    new = ["dark psytrance", "forest psytrance", "progressive psytrance", "full-on psytrance"]
    for k in new:
        e = ENTRIES[k]
        assert e["discogs"] is False, k
        assert e["status"] == "approved", k
        assert k in EXTRAS, k
        assert k not in DISCOGS["genres"], k
        assert e["display"].endswith("psy-trance"), k
    assert "darkpsy" in ENTRIES["dark psytrance"]["synonyms"]
    assert "prog psy" in ENTRIES["progressive psytrance"]["synonyms"]


def test_sovietwave_is_an_approved_extra_under_synthwave():
    e = ENTRIES["sovietwave"]
    assert e["family"] == "Others"
    assert e["parents"] == ["synthwave"]
    assert e["display"] is None
    assert "soviet wave" not in ENTRIES
    assert e["discogs"] is False
    assert e["status"] == "approved"
    assert "sovietwave" in EXTRAS and "soviet wave" not in EXTRAS
    assert "sovietwave" not in DISCOGS["genres"]
    assert "советская волна" in e["synonyms"]
    assert e["synonyms"] == ["soviet wave", "soviet-wave", "советская волна", "советская-волна"]


def test_french_house_is_an_extra_under_house_and_french_touch_is_its_alias():
    from app import genre_filter as gf
    from app import genre_vocab

    genre_vocab.reset()
    e = ENTRIES["french house"]
    assert e["family"] == "Others"
    assert e["parents"] == ["house"]
    assert e["discogs"] is False
    assert "french house" in EXTRAS
    assert "french house" not in DISCOGS["genres"]
    assert EXTRAS["french house"]["parents"] == ["house"]
    assert genre_vocab.entry("french house").family == "Others"
    assert "french touch" in e["synonyms"]
    assert "french touch" not in ENTRIES["house"]["synonyms"]
    assert "french house" not in ENTRIES["house"]["synonyms"]
    assert genre_vocab.lookup("French House") == "french house"
    assert genre_vocab.lookup("french touch") is None
    for raw in ("french touch", "French Touch", "french-touch", "french house"):
        assert gf.canonical(raw) == "french house", raw
        assert gf.vocabulary_name(raw) == "french house", raw
        assert not gf.unmappable(raw), raw
    assert genre_vocab.vocabulary()["aliases"]["french touch"] == "french house"
    assert "french house" not in genre_vocab.vocabulary()["aliases"]


def test_dream_trance_is_an_approved_extra_under_trance_with_two_synonyms():
    from app import genre_filter as gf
    from app import genre_vocab

    genre_vocab.reset()
    e = ENTRIES["dream trance"]
    assert (e["family"], e["parents"], e["discogs"], e["status"]) == ("Others", ["trance"], False, "approved")
    assert e["synonyms"] == ["dream house", "dream dance"]
    assert "dream trance" in EXTRAS
    assert "dream trance" not in DISCOGS["genres"]
    assert EXTRAS["dream trance"]["parents"] == ["trance"]
    assert ENTRIES["trance"]["parents"] == ["Others"]
    assert "dream" not in ENTRIES
    assert "dream" not in gf.ALIASES
    assert genre_vocab.lookup("Dream Trance") == "dream trance"
    assert genre_vocab.lookup("dream house") is None
    for raw in ("dream house", "Dream Dance", "dream-house", "dream trance"):
        assert gf.canonical(raw) == "dream trance", raw
        assert gf.vocabulary_name(raw) == "dream trance", raw
        assert not gf.unmappable(raw), raw
    payload = genre_vocab.vocabulary()
    assert payload["aliases"]["dream house"] == payload["aliases"]["dream dance"] == "dream trance"
    assert "dream trance" not in payload["aliases"]
    assert payload["levels"]["dream trance"]["synonyms"] == ["dream house", "dream dance"]
    assert payload["levels"]["dream trance"]["parents"] == ["trance"]
    assert payload["levels"]["dream trance"]["status"] == "approved"
    assert payload["levels"]["dream trance"]["discogs"] is False


def test_uplifting_trance_has_three_synonyms_that_do_not_touch_epic():
    from app import genre_filter as gf
    from app import genre_vocab

    genre_vocab.reset()
    assert ENTRIES["uplifting trance"]["synonyms"] == ["anthem trance", "epic trance", "euphoric trance"]
    assert ENTRIES["uplifting trance"]["parents"] == ["trance"]
    assert ENTRIES["uplifting trance"]["status"] == "approved"
    for raw in ("anthem trance", "Epic Trance", "euphoric-trance", "uplifting trance"):
        assert gf.canonical(raw) == "uplifting trance", raw
        assert gf.vocabulary_name(raw) == "uplifting trance", raw
        assert not gf.unmappable(raw), raw
    for name in ("commercial trance", "stadium trance"):
        assert name not in gf.ALIASES
    payload = genre_vocab.vocabulary()
    assert payload["aliases"]["epic trance"] == "uplifting trance"
    assert payload["levels"]["uplifting trance"]["synonyms"] == ["anthem trance", "epic trance", "euphoric trance"]


RM_GENRES = (
    "soundtrack", "trailer", "score", "musical", "theme", "incidental music", "vaudeville", "video game music",
    "audiobook", "speech", "spoken word", "poetry", "field recording", "interview", "radioplay", "education",
    "brass band", "marches", "military", "pipe & drum", "concert band", "educational", "lullaby", "nursery rhymes", "story",
)
RM_FAMILIES = ("Stage & Screen", "Children's", "Brass & Military", "Non-Music")


def test_removed_genres_and_families_are_gone_from_the_vocabulary_files():
    from app import genre_vocab

    genre_vocab.reset()
    assert not set(RM_GENRES) & (set(ENTRIES) | set(DISCOGS["genres"]) | set(EXTRAS))
    assert not set(RM_FAMILIES) & (set(DISCOGS["families"]) | set(FAMILIES) | {v["family"] for v in ENTRIES.values()})
    assert not any(p in RM_GENRES for v in ENTRIES.values() for p in v["parents"])
    assert all(genre_vocab.lookup(n) is None for n in RM_GENRES), [n for n in RM_GENRES if genre_vocab.lookup(n)]


def test_removed_genres_are_dropped_from_songs_by_the_tag_cleaner():
    from app import genre_filter as gf
    from app import library

    for name in (*RM_GENRES, "soundtracks", "film score", "kids"):
        assert gf.is_dropped(name), name
        assert not gf.is_genre(name), name
    assert library.clean_tags(["genre:Soundtrack", "genre:trailer", "genre:Score", "genre:house", "genre:epic"]) == ["genre:house"]
    assert library.clean_tags(["genre:trailer"]) == []


def test_epic_is_a_descriptor_and_is_removed_everywhere_and_its_tag_is_dropped():
    from app import genre_filter as gf
    from app import genre_vocab
    from app import library

    assert "epic" not in ENTRIES and "epic" not in DISCOGS["genres"] and "epic" not in EXTRAS
    assert genre_vocab.lookup("epic") is None
    assert gf.is_dropped("epic") and gf.is_dropped("Epic") and not gf.is_dropped("epic trance")
    assert library.clean_tags(["genre:epic", "genre:modern classical"]) == ["genre:modern classical"]


def test_space_disco_is_an_approved_extra_level_three_under_disco_in_electronic():
    e = ENTRIES["space disco"]
    assert (e["parents"], e["level"], e["family"], e["discogs"], e["status"], e["display"], e["synonyms"]) == (["disco"], 3, "Others", False, "approved", None, ["space-disco"])
    assert EXTRAS["space disco"]["parents"] == ["disco"]
    assert "family" not in EXTRAS["space disco"] and e["families"] == ["Others", "Funk / Soul"]
    assert "space disco" not in DISCOGS["genres"]
    assert genre_vocab.entry("space-disco").name == "space disco"
    assert genre_vocab.entry("space disco").parents == ("disco",)
    assert len(EXTRAS) == 62


def test_electronic_counts_in_the_meta_block_match_the_data():
    counts = LEVELS["_meta"]["counts"]
    for family in DISCOGS["families"]:
        mine = [v for v in ENTRIES.values() if family in v["families"]]
        assert counts[family] == {"total": len(mine), "level2": sum(v["level"] == 2 for v in mine), "level3": sum(v["level"] == 3 for v in mine), "level4": sum(v["level"] == 4 for v in mine)}, family
    assert (counts["Others"]["level2"], counts["Others"]["level3"], counts["Others"]["level4"]) == (54, 87, 5)
    assert LEVELS["_meta"]["total"] == len(ENTRIES) == 534
    assert sum(c["total"] for c in counts.values()) == sum(len(v["families"]) for v in ENTRIES.values()) == 578


ROCK_FUSION = {"folk metal", "folk punk", "rap metal", "electronic rock"}
FUSION = {"eurodance", "blues rock", "folk rock", "country rock", "funk metal", "jazz funk", "soul jazz", "latin jazz", "hip house", "trip hop"} | ROCK_FUSION
TWO_SCENES = {"disco", "dub", "experimental", "electro", "bossa nova", "rhythm and blues"}
MOVED_TO_RELATED = {"hardcore techno": "Rock", "noise": "Rock", "grime": "Hip Hop", "trap": "Others", "acid jazz": "Others", "new wave": "Others", "modern classical": "Others", "gospel": "Funk / Soul"}


def test_fusion_genres_are_the_fourteen_blends_and_each_belongs_to_two_families():
    flagged = {k for k, v in ENTRIES.items() if v.get("fusion")}
    assert flagged == FUSION and len(flagged) == 14 and "synthpop" not in flagged
    assert all(len(ENTRIES[k]["families"]) >= 2 for k in flagged)
    assert all(v.get("fusion", True) is True for v in ENTRIES.values())


def test_the_two_family_genres_of_the_vocabulary_are_the_20_blends_plus_the_descent_ones():
    multi = {k for k, v in ENTRIES.items() if len(v["families"]) > 1}
    assert (FUSION | TWO_SCENES) <= multi and len(multi) == 37
    for k, fam in MOVED_TO_RELATED.items():
        assert fam in ENTRIES[k]["related"] and fam not in ENTRIES[k]["parents"] and k not in multi, k
    assert {k for k in multi if k not in FUSION | TWO_SCENES and len(family_parents(k)) < 2 and k not in {"post-disco"}} >= {"euro disco", "hi-nrg", "italo disco", "nu-disco", "space disco", "spacesynth"}


def test_the_second_families_left_are_appended_and_parents_zero_is_unchanged():
    got = {k: ENTRIES[k]["parents"] for k in (FUSION - {"eurodance"}) | (TWO_SCENES - {"disco"})}
    assert got["hip house"] == ["house", "Hip Hop"] and got["trip hop"] == ["downtempo", "Hip Hop"]
    assert ENTRIES["hip house"]["families"] == ["Others", "Hip Hop"] and ENTRIES["hip house"]["level"] == 2
    assert ENTRIES["trap"]["parents"] == ["Hip Hop"] and got["blues rock"] == ["Blues", "Rock"]
    assert all(len(v) == 2 for v in got.values())
    assert ENTRIES["disco"]["parents"] == ["Funk / Soul", "Others"]


def test_the_deepest_level_is_four_and_only_the_psytrance_branch_reaches_it():
    assert max(v["level"] for v in ENTRIES.values()) == 4
    assert {k for k, v in ENTRIES.items() if v["level"] == 4} == {c for c, v in ENTRIES.items() if "psytrance" in v["parents"]} - {"psybient"}


def test_fusion_is_validated_and_served():
    import copy

    import pytest

    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}, "Pop": {"name": "Pop", "synonyms": []}},
            "a": {"parents": ["Rock", "Pop"], "discogs": True, "fusion": True},
            "b": {"parents": ["Rock"], "discogs": True},
            "c": {"parents": ["b", "Pop"], "discogs": True, "fusion": False}}
    levels = genre_vocab.parse_levels(base)[0]
    assert levels["a"]["fusion"] is True and "fusion" not in levels["b"] and "fusion" not in levels["c"]

    def broken(fn):
        d = copy.deepcopy(base)
        fn(d)
        return d

    for doc, word in [
        (broken(lambda d: d["b"].update(fusion=True)), "fewer than two"),
        (broken(lambda d: d["a"].update(fusion="yes")), "boolean"),
        (broken(lambda d: d["a"].update(fusion=1)), "boolean"),
        (broken(lambda d: d["a"].update(parents=["Rock", "b"])), "fewer than two"),
    ]:
        with pytest.raises(ValueError, match=word):
            genre_vocab.parse_levels(doc)
    genre_vocab.reset()
    body = genre_vocab.vocabulary()["levels"]
    assert body["blues rock"]["fusion"] is True and body["blues rock"]["parents"] == ["Blues", "Rock"]
    assert "fusion" not in body["dub"] and body["dub"]["parents"] == ["Reggae", "Others"]


RELATED_MOVES = {
    "minimal": ["house"], "breakcore": ["breakbeat"], "chillwave": ["downtempo"], "vaporwave": ["downtempo"], "dark electro": ["electro"],
    "dungeon synth": ["synthwave"], "future bass": ["house"], "jungle": ["drum and bass"], "melodic techno": ["trance"], "microhouse": ["techno"], "minimal techno": ["house"],
    **{k: [v] for k, v in MOVED_TO_RELATED.items()},
}


def test_the_19_remaining_reviewed_associations_are_related_and_no_longer_parents():
    assert len(RELATED_MOVES) == 19
    for k, rel in RELATED_MOVES.items():
        assert ENTRIES[k]["related"] == rel, k
        assert not set(rel) & set(ENTRIES[k]["parents"]), k
    assert {k for k, v in ENTRIES.items() if v.get("related")} == set(RELATED_MOVES) | set(ROCK_RELATED)
    assert ENTRIES["chillwave"]["parents"] == ["synthwave"] and ENTRIES["vaporwave"]["parents"] == ["synthwave"]
    assert ENTRIES["jungle"]["parents"] == ["breakbeat"] and ENTRIES["trap"]["parents"] == ["Hip Hop"] and "fusion" not in ENTRIES["trap"] and "fusion" not in ENTRIES["acid jazz"]


def test_related_is_validated_and_served():
    import copy

    import pytest

    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}, "Pop": {"name": "Pop", "synonyms": []}},
            "a": {"parents": ["Rock"], "discogs": True, "related": ["Pop", "c"]},
            "b": {"parents": ["a"], "discogs": True},
            "c": {"parents": ["Pop"], "discogs": True, "related": []}}
    levels = genre_vocab.parse_levels(base)[0]
    assert levels["a"]["related"] == ["Pop", "c"] and "related" not in levels["b"] and "related" not in levels["c"]
    assert (levels["a"]["level"], levels["a"]["family"]) == (2, "Rock")

    def broken(fn):
        d = copy.deepcopy(base)
        fn(d)
        return d

    bad = [
        (broken(lambda d: d["a"].update(related=["a"])), "related"),
        (broken(lambda d: d["a"].update(related=["Rock"])), "related"),
        (broken(lambda d: d["a"].update(related=["c", "c"])), "unique"),
        (broken(lambda d: d["a"].update(related=["zzz"])), "not a family or an entry"),
        (broken(lambda d: d["a"].update(related=["b"])), "descendant"),
        (broken(lambda d: d["a"].update(related="c")), "related"),
        (broken(lambda d: d["a"].update(related=[""])), "related"),
    ]
    for doc, word in bad:
        with pytest.raises(ValueError, match=word):
            genre_vocab.parse_levels(doc)
    genre_vocab.reset()
    body = genre_vocab.vocabulary()["levels"]
    assert body["chillwave"]["related"] == ["downtempo"] and body["gospel"]["related"] == ["Funk / Soul"]
    assert "related" not in body["deep house"]



HELD_ROCK = {
    "acoustic", "aor", "arena rock", "beat", "british invasion", "dance-rock", "dark metal", "jangle pop", "mod",
    "paisley underground", "psychobilly", "pub rock", "rock opera", "sadcore", "shock rock", "soft rock", "southern rock", "stoner rock", "synth-rock",
}
ROCK_RELATED = {
    "krautrock": ["psychedelic rock"], "no wave": ["experimental rock", "post-punk"], "post-hardcore": ["hardcore punk", "noise rock"], "mathcore": ["math rock", "post-hardcore"],
    "crust": ["grindcore"], "melodic hardcore": ["pop punk", "emo"], "groove metal": ["hardcore punk"], "viking metal": ["folk metal"],
    "dance-punk": ["disco", "new wave"], "industrial rock": ["noise rock"], "nu metal": ["rap metal", "industrial metal"],
}

NINE = {
    "hardcore punk": (["punk"], "punk", []), "experimental rock": (["Rock"], None, []), "extreme metal": (["heavy metal"], "heavy metal", []), "noise rock": (["Rock"], None, []),
    "roots rock": (["Rock"], None, []), "neo-psychedelia": (["psychedelic rock"], "psychedelic rock", []), "glam metal": (["heavy metal"], "heavy metal", ["hair metal", "pop metal"]),
    "college rock": (["alternative rock"], "alternative rock", []), "death-doom": (["death metal", "doom metal"], "death metal", ["death/doom", "death doom"]),
}


def test_the_nine_reviewed_rock_extras():
    for k, (parents, first, syn) in NINE.items():
        e = ENTRIES[k]
        assert (e["parents"], e["family"], e["level"], e["discogs"], e["status"], e["display"], e["synonyms"]) == (parents, "Rock", e["level"], False, "approved", None, syn), k
        assert e["level"] == (3 if first else 2), k
        assert k in EXTRAS and k not in DISCOGS["genres"] and "reviewed 2026-10-19" in EXTRAS[k]["note"], k
    assert "hardcore" not in ENTRIES["hardcore punk"]["synonyms"] and ENTRIES["hardcore techno"]["family"] == "Others"
    assert max(v["level"] for v in ENTRIES.values()) <= 4
    for spelling, want in [("Hair Metal", "glam metal"), ("pop metal", "glam metal"), ("death/doom", "death-doom"), ("Death Doom", "death-doom"), ("hardcore techno", "hardcore techno"), ("Hardcore Punk", "hardcore punk"), ("Neo Psychedelia", "neo-psychedelia")]:
        from app import genre_filter as gf
        assert gf.vocabulary_name(spelling) == want, spelling
    assert {k for k, v in ENTRIES.items() if v["parents"][0] in NINE} == {"krautrock", "post-rock"}


def test_electro_funk_is_a_synonym_of_electro_and_electropop_stays_on_synthpop():
    from app import genre_filter as gf

    assert ENTRIES["electro"]["synonyms"] == ["electro-funk", "electrofunk"]
    for raw in ("Electro-Funk", "electro funk", "electrofunk", "electro-funk"):
        assert gf.vocabulary_name(raw) == "electro", raw
    for raw in ("electropop", "electro-pop", "electronic pop"):
        assert gf.vocabulary_name(raw) == "synthpop", raw


SUBFAMILIES = ["House", "Techno", "Trance", "Breaks & bass", "Synth & wave", "Experimental, industrial & noise", "Ambient & downtempo", "Eurodance & disco"]
SUBFAMILY_COUNTS = {"House": 26, "Techno": 20, "Trance": 19, "Breaks & bass": 24, "Synth & wave": 12, "Experimental, industrial & noise": 21, "Ambient & downtempo": 10, "Eurodance & disco": 12}


def test_edm_is_an_approved_extra_level_two_under_electronic():
    from app import genre_filter as gf

    e = ENTRIES["edm"]
    assert (e["parents"], e["family"], e["level"], e["discogs"], e["status"], e["display"], e["subfamily"]) == (["Others"], "Others", 2, False, "approved", None, "House")
    assert e["synonyms"] == ["electronic dance music", "dance music", "club music", "electronic dance", "dance"]
    assert "edm" in EXTRAS and "edm" not in DISCOGS["genres"] and "house" not in [k for k, v in ENTRIES.items() if v["parents"][0] == "edm"]
    assert not [k for k, v in ENTRIES.items() if v["parents"][0] == "edm"]
    for raw in ("edm", "EDM", "Electronic Dance Music", "dance music", "club music", "electronic dance", "dance"):
        assert gf.vocabulary_name(raw) == "edm", raw
    assert gf.vocabulary_name("electronica") is None and gf.vocabulary_name("Electronic Music") is None
    syn = FAMILIES["Others"]["synonyms"]
    assert not {"edm", "dance", "dance music", "club music", "electronic dance", "electronic dance music"} & set(syn)


def test_every_electronic_level_two_genre_has_exactly_one_subfamily():
    names = [n for n, s in LEVELS["subfamilies"].items()]
    assert names == SUBFAMILIES and [s["order"] for s in LEVELS["subfamilies"].values()] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert all(s["family"] == "Others" for s in LEVELS["subfamilies"].values())
    lvl2 = {k for k, v in ENTRIES.items() if "Others" in v["parents"] and k not in {"dub", "electronic rock"}}
    assert len(lvl2) == 49
    for k in lvl2:
        assert RAW[k].get("subfamily") in SUBFAMILIES, k
    assert {k for k, v in RAW.items() if v.get("subfamily")} == lvl2 | {"psytrance", "eurodance", "ebm"}
    for k, v in ENTRIES.items():
        if "Others" not in v["families"]:
            assert "subfamily" not in v, k


def test_subfamily_inheritance_counts_and_the_disco_children():
    from collections import Counter

    c = Counter(v["subfamily"] for v in ENTRIES.values() if v.get("subfamily"))
    assert dict(c) == SUBFAMILY_COUNTS and sum(c.values()) == 144
    assert ENTRIES["deep house"]["subfamily"] == "House" and "subfamily" not in RAW["deep house"]
    assert ENTRIES["spacesynth"]["subfamily"] == "Synth & wave" and ENTRIES["hardstyle"]["subfamily"] == "Techno"
    assert RAW["disco"]["subfamily"] == "Eurodance & disco" and ENTRIES["disco"]["families"] == ["Others", "Funk / Soul"]
    for k in ("euro disco", "hi-nrg", "italo disco", "nu-disco", "space disco"):
        assert "subfamily" not in RAW[k] and ENTRIES[k]["subfamily"] == "Eurodance & disco" and ENTRIES[k]["parents"] == ["disco"], k
    assert ENTRIES["hands up"]["subfamily"] == "Eurodance & disco" and ENTRIES["freestyle"]["subfamily"] == "Eurodance & disco"
    assert "eurobeat" not in ENTRIES and "eurobeat" in ENTRIES["eurodance"]["synonyms"] and ENTRIES["kuduro"]["subfamily"] == "Breaks & bass" and ENTRIES["disco polo"]["subfamily"] == "Eurodance & disco"
    want = {"disco": "Eurodance & disco", "dub": None, "trip hop": "Ambient & downtempo", "hip house": "House", "electro house": "House"}
    for k, sub in want.items():
        assert ENTRIES[k].get("subfamily") == sub, k
    assert ENTRIES["hardcore techno"]["subfamily"] == "Techno" and ENTRIES["breakcore"]["subfamily"] == "Techno" and ENTRIES["psytrance"]["subfamily"] == "Trance" and ENTRIES["psybient"]["subfamily"] == "Trance"
    small = {"acid": "House", "balearic": "House", "ghetto": "House", "tribal": "House", "electro swing": "House", "ghettotech": "House", "bleep": "Techno", "minimal": "Techno", "lento violento": "Techno", "edm": "House"}
    assert {k: ENTRIES[k]["subfamily"] for k in small} == small and ENTRIES["grime"]["subfamily"] == "Breaks & bass"


def test_subfamily_is_validated_and_served():
    import copy

    import pytest

    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}, "Pop": {"name": "Pop", "synonyms": []}},
            "subfamilies": {"S1": {"family": "Rock", "order": 1}, "S2": {"family": "Rock", "order": 2}},
            "a": {"parents": ["Rock"], "discogs": True, "subfamily": "S2"},
            "b": {"parents": ["a"], "discogs": True},
            "c": {"parents": ["Pop"], "discogs": True}}
    levels = genre_vocab.parse_levels(base)[0]
    assert levels["a"]["subfamily"] == "S2" and levels["b"]["subfamily"] == "S2" and "subfamily" not in levels["c"]
    both = copy.deepcopy(base)
    both["d"] = {"parents": ["Pop", "Rock"], "discogs": True, "subfamily": "S1"}
    both["e"] = {"parents": ["d"], "discogs": True}
    got = genre_vocab.parse_levels(both)[0]
    assert (got["d"]["family"], got["d"]["subfamily"], got["e"]["family"], "subfamily" in got["e"]) == ("Rock", "S1", "Rock", True)

    def broken(fn):
        d = copy.deepcopy(base)
        fn(d)
        return d

    bad = [
        (broken(lambda d: d["a"].update(subfamily="Nope")), "unknown subfamily"),
        (broken(lambda d: d["c"].update(subfamily="S1")), "not one of the families"),
        (broken(lambda d: d["subfamilies"].update(S3={"family": "Rock"})), "order"),
        (broken(lambda d: d["subfamilies"].update(S3={"family": "Nope", "order": 3})), "unknown family"),
        (broken(lambda d: d.update(subfamilies=[])), "subfamilies"),
    ]
    for doc, word in bad:
        with pytest.raises(ValueError, match=word):
            genre_vocab.parse_levels(doc)
    genre_vocab.reset()
    body = genre_vocab.vocabulary()
    assert [(s["name"], s["family"], s["order"]) for s in body["subfamilies"]] == [(n, "Others", i + 1) for i, n in enumerate(SUBFAMILIES)]
    assert body["levels"]["deep house"]["subfamily"] == "House" and "subfamily" not in body["levels"]["rock and roll"]


def test_eurodance_has_house_euro_disco_and_pop_as_equal_parents():
    e = ENTRIES["eurodance"]
    assert set(e["parents"]) == {"house", "euro disco", "Pop"} and len(e["parents"]) == 3
    assert (e["level"], e["families"], e["fusion"], e["subfamily"]) == (2, ["Others", "Funk / Soul", "Pop"], True, "Eurodance & disco")
    assert {k for k, v in ENTRIES.items() if "eurodance" in v["parents"]} == {"hands up", "italodance"}
    assert all(ENTRIES[k]["level"] == 3 and ENTRIES[k]["families"] == e["families"] for k in ("hands up", "italodance"))
    assert "eurobeat" in e["synonyms"]


def test_industrial_is_removed_everywhere_and_only_its_parent_links_are_gone():
    from app import genre_filter as gf
    from app import library

    genre_vocab.reset()
    assert "industrial" not in ENTRIES and "industrial" not in DISCOGS["genres"] and "industrial" not in EXTRAS
    assert genre_vocab.lookup("industrial") is None and genre_vocab.lookup("Industrial music") is None
    assert not any("industrial" in v["parents"] or "industrial" in v.get("related", []) for v in ENTRIES.values())
    assert gf.is_dropped("industrial") and gf.is_dropped("Industrial music") and not gf.is_dropped("industrial metal") and not gf.is_dropped("industrial rock")
    assert library.clean_tags(["genre:Industrial", "genre:industrial metal", "genre:house"]) == ["genre:industrial metal", "genre:house"]
    assert ENTRIES["industrial metal"]["parents"] == ["heavy metal", "industrial rock"] and ENTRIES["industrial rock"]["parents"] == ["Rock"]
    assert ENTRIES["ebm"]["parents"] == ["synthpop"] and ENTRIES["rhythmic noise"]["parents"] == ["noise"]
    for k in ("dark electro", "harsh noise wall", "power electronics"):
        assert ENTRIES[k]["parents"] == ["Others"] and ENTRIES[k]["level"] == 2, k
    for k in ("dark electro", "ebm", "harsh noise wall", "power electronics", "rhythmic noise"):
        assert ENTRIES[k]["subfamily"] == "Experimental, industrial & noise", k
    assert "related" not in ENTRIES["witch house"] and "related" not in ENTRIES["neurofunk"] and "related" not in ENTRIES["darksynth"]
    assert "industrial" not in genre_vocab.vocabulary()["aliases"].values()


def test_darkwave_has_post_punk_and_new_wave_as_equal_parents_and_is_only_in_rock():
    e = ENTRIES["darkwave"]
    assert set(e["parents"]) == {"post-punk", "new wave"} and len(e["parents"]) == 2
    assert (e["level"], e["families"]) == (3, ["Rock"]) and "subfamily" not in e
    assert ENTRIES["post-punk"]["level"] == 2 and ENTRIES["new wave"]["level"] == 2
    assert set(ENTRIES["coldwave"]["parents"]) == {"post-punk", "darkwave"} and ENTRIES["coldwave"]["families"] == ["Rock"]
    assert {k for k, v in ENTRIES.items() if "darkwave" in v["parents"]} == {"coldwave"}


def test_synthpop_has_electronic_pop_and_new_wave_as_equal_parents_and_its_children_follow():
    e = ENTRIES["synthpop"]
    assert set(e["parents"]) == {"Others", "Pop", "new wave"} and "fusion" not in e
    assert (e["level"], e["families"], e["subfamily"]) == (2, ["Others", "Pop", "Rock"], "Synth & wave")
    assert {k for k, v in ENTRIES.items() if "synthpop" in v["parents"]} == {"ebm", "electroclash"}
    assert ENTRIES["electroclash"]["families"] == ["Others", "Hip Hop", "Pop", "Rock"] and ENTRIES["ebm"]["families"] == ["Others", "Pop", "Rock"]


def test_ethereal_is_removed_everywhere_and_its_alias_is_gone():
    from app import genre_filter as gf
    from app import library

    genre_vocab.reset()
    assert "ethereal" not in ENTRIES and "ethereal" not in DISCOGS["genres"] and "ethereal" not in EXTRAS
    assert genre_vocab.lookup("ethereal") is None and genre_vocab.lookup("Ethereal wave") is None
    assert "ethereal wave" not in gf.ALIASES and "ethereal" not in gf.ALIASES.values()
    assert gf.is_dropped("ethereal") and gf.is_dropped("Ethereal wave") and not gf.is_dropped("darkwave")
    assert library.clean_tags(["genre:Ethereal", "genre:ethereal wave", "genre:darkwave"]) == ["genre:darkwave"]
    assert not any("ethereal" in v["parents"] or "ethereal" in v.get("related", []) for v in ENTRIES.values())
    assert not [k for k in ENTRIES if "ethereal" in k]


def test_deprecated_flavours_alias_equals_modifiers():
    from app import genre_vocab

    genre_vocab.reset()
    body = genre_vocab.vocabulary()
    assert genre_vocab.DEPRECATED_ALIASES == {"modifiers": "flavours"}
    assert body["flavours"] == body["modifiers"]
    assert all(v["flavours"] == v["modifiers"] for v in body["levels"].values())
