import json

from app import genre_vocab, library
from pathlib import Path

from tests.test_library import H, client  # noqa: F401

DATA = Path(__file__).resolve().parent.parent / "data"
DISCOGS = json.loads((DATA / "genre_discogs.json").read_text(encoding="utf-8"))
EXTRAS = json.loads((DATA / "genre_extras.json").read_text(encoding="utf-8"))["extras"]
LEVELS = json.loads((DATA / "genre_levels.json").read_text(encoding="utf-8"))
FAMILIES = LEVELS["families"]
FLAVOURS = LEVELS["flavours"]
RAW = {k: v for k, v in LEVELS.items() if k not in ("_meta", "families", "flavours")}
ENTRIES = genre_vocab.parse_levels(LEVELS)[0]


def extra_families(k):
    return [p for p in ENTRIES[k]["parents"][1:] if p in FAMILIES]


def extra_genres(k):
    return [p for p in ENTRIES[k]["parents"][1:] if p not in FAMILIES]


def test_every_vocabulary_genre_appears_once():
    assert set(ENTRIES) == set(DISCOGS["genres"]) | set(EXTRAS)


def test_families_are_among_the_eleven():
    assert all(v["family"] in DISCOGS["families"] for v in ENTRIES.values())


def test_family_matches_the_vocabulary():
    entries = genre_vocab.load().entries
    for k, v in ENTRIES.items():
        assert v["family"] == entries[k].family, k


def test_level_follows_parents_zero_and_stops_at_three():
    for k, v in ENTRIES.items():
        first = v["parents"][0]
        want = 2 if first in FAMILIES else 1 + ENTRIES[first]["level"]
        assert v["level"] == want <= 3, k
        assert k not in v["parents"], k
        assert len(set(v["parents"])) == len(v["parents"]), k
        assert all(p in FAMILIES or p in ENTRIES for p in v["parents"]), k
    assert {v["level"] for v in ENTRIES.values()} == {2, 3}


def test_the_family_is_the_family_of_parents_zero_unless_overridden_to_another_of_its_families():
    overrides = {k for k, v in RAW.items() if "family" in v}
    assert overrides == {"euro disco", "hi-nrg", "italo disco", "nu-disco", "space disco"}
    for k, v in ENTRIES.items():
        first = v["parents"][0]
        if first in FAMILIES:
            assert v["family"] == first, k
        elif k not in overrides:
            assert v["family"] == ENTRIES[first]["family"], k
        else:
            assert v["family"] in (ENTRIES[first]["family"], *[p for p in ENTRIES[first]["parents"][1:] if p in FAMILIES]), k
    assert "genre" not in next(iter(RAW.values())) and not any(("parent" in v or "also_under" in v or "also_in_genres" in v) for v in RAW.values())


def test_extra_parents_are_cross_links_that_never_create_a_cycle():
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


def test_only_electronic_is_drafted():
    for k, v in ENTRIES.items():
        if v["family"] != "Electronic":
            assert v["parents"][0] == v["family"], k
            assert v["provisional"] is True, k
        else:
            assert v["provisional"] is False, k


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
    assert FAMILIES["Electronic"]["synonyms"] == [
        "electronic dance music", "edm", "dance music", "club music", "electronic music",
        "dance", "electronic dance", "electronica", "indietronica", "alternative dance", "rave", "dance & edm",
    ]


REMOVED = {
    "electronic dance": "electronic", "dance": "electronic", "electronica": "electronic", "indietronica": "electronic", "alternative dance": "electronic",
    "chillout": "downtempo", "afro house": "house", "big room house": "house", "bubblegum dance": "eurodance", "techstep": "drum and bass",
    "liquid funk": "liquid drum and bass", "breakbeat hardcore": "breakbeat", "jersey club": "breakbeat", "rave": "electronic",
    "techno pop": "synthpop", "electropop": "synthpop", "melodic house": "house",
}
APPROVED = {"dark psytrance", "forest psytrance", "progressive psytrance", "full-on psytrance", "vocal trance", "melodic techno", "psybient", "darksynth", "uplifting trance", "sunshine house", "dreamsynth", "dreamwave", "neurofunk",
            "spacesynth", "nu-nrg", "liquid drum and bass", "soviet wave", "dream trance", "space disco"}
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
    assert gf.canonical("club") == "electronic"
    assert gf.canonical("Club Music") == "electronic"
    assert not gf.is_dropped("club")
    assert gf.canonical("dance music") == "electronic"
    assert gf.canonical("EDM") == "electronic"
    assert gf.canonical("Liquid DnB") == "liquid drum and bass"
    for loose in ("russian electro pop", "electronic pop"):
        assert gf.canonical(loose) == "synthpop"


def test_removed_names_are_synonyms_of_their_target_or_dropped_as_redundant():
    for old, target in REMOVED.items():
        if target == "electronic":
            assert old in FAMILIES["Electronic"]["synonyms"], old
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
    assert (e["family"], e["parents"], e["discogs"]) == ("Electronic", ["drum and bass"], False)
    assert EXTRAS["liquid drum and bass"]["parents"] == ["drum and bass"]
    assert "liquid funk" in e["synonyms"]
    assert len(set(e["synonyms"])) == len(e["synonyms"])


def test_flavours_block_and_assignments():
    assert FLAVOURS
    for k, f in FLAVOURS.items():
        assert k == k.lower(), k
        assert k.strip() == k, k
        assert k, k
        assert f["kind"] in ("sound", "scene"), k
        assert f["name"], k
        assert f["description"], k
    assert not any(v["flavours"] for v in ENTRIES.values()), "flavours are defined but not attached (awaiting Alex)"
    assert any(f["kind"] == "scene" for f in FLAVOURS.values())
    assert any(f["kind"] == "sound" for f in FLAVOURS.values())


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
    assert dh == {"family": "Electronic", "parents": ["house"], "level": 3, "discogs": True, "synonyms": [], "provisional": False, "status": ENTRIES["deep house"]["status"], "flavours": ENTRIES["deep house"]["flavours"], "display": ENTRIES["deep house"]["display"]}
    assert body["levels"]["jungle"]["parents"] == RAW["jungle"]["parents"] == ["drum and bass", "breakbeat"]
    assert not any(k in dh for k in ("genre", "parent", "also_under", "also_in_genres"))
    nd = next(k for k, v in ENTRIES.items() if v["discogs"] is False)
    assert body["levels"][nd]["discogs"] is False
    assert body["levels"]["rock and roll"]["provisional"] is True
    assert "edm" in body["family_synonyms"]["Electronic"]
    assert body["flavours"] == FLAVOURS
    assert body["levels"]["deep trance"]["status"] == "question"
    assert len(json.dumps(body["levels"])) < 120_000


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


def test_flavours_pass_through_the_parser():
    doc = {"families": {"Rock": {"name": "Rock", "synonyms": []}}, "flavours": {"dark": {"name": "Dark", "kind": "sound", "description": "d"}},
           "a": {"parents": ["Rock"], "discogs": True, "flavours": ["dark"]}}
    levels, _, flavours = _payload_with(doc)
    assert flavours == {"dark": {"name": "Dark", "kind": "sound", "description": "d"}}
    assert levels["a"]["flavours"] == ["dark"]


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
        (broken(lambda d: d["a"].update(family="Nope")), "unknown family"),
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
        (broken(lambda d: d["a"].update(flavours=["nope"])), "unknown flavours"),
        (broken(lambda d: d.update(flavours={"x": {"name": "X", "kind": "mood"}})), "kind"),
        (broken(lambda d: d.update(flavours=[])), "flavours"),
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
    assert ENTRIES["drum and bass"]["display"] == "Drum & Bass"
    assert ENTRIES["liquid drum and bass"]["display"] == "Liquid Drum & Bass"
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
    assert genre_vocab.vocabulary()["levels"]["drum and bass"]["display"] == "Drum & Bass"


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
    assert songs["a"] == ["genre:house", "genre:electronic", "x"]
    assert songs["c"] == ["genre:electronic"]
    assert songs["b"] == list(dict.fromkeys(f"genre:{t}" for t in REMOVED.values()))
    assert (tmp_path / "backups-genre-merge" / "u1" / "library.json").read_text() == original
    assert migrate_tags.run() == 0
    assert {s["id"]: library.tag_list(s) for s in json.loads(lib.read_text())["songs"]} == songs


def test_disco_umbrella_spans_funk_soul_and_electronic():
    assert ENTRIES["disco"]["family"] == "Funk / Soul"
    assert ENTRIES["disco"]["parents"] == ["Funk / Soul", "Electronic"]
    assert ENTRIES["disco"]["level"] == 2
    kids = {k for k, v in ENTRIES.items() if v["parents"][0] == "disco"}
    assert kids == {"euro disco", "italo disco", "hi-nrg", "nu-disco", "space disco"}
    assert all(ENTRIES[k]["family"] == "Electronic" and ENTRIES[k]["level"] == 3 for k in kids)
    assert "italo disco" in ENTRIES["spacesynth"]["parents"]
    assert "disco polo" not in kids
    for k, v in ENTRIES.items():
        for f in extra_families(k):
            assert f != v["family"], k
            assert v["level"] == 2, k


def test_parents_are_validated_and_served():
    import copy

    import pytest

    base = {"families": {"Rock": {"name": "Rock", "synonyms": []}, "Pop": {"name": "Pop", "synonyms": []}},
            "a": {"parents": ["Rock", "Pop"], "discogs": True},
            "b": {"parents": ["a"], "discogs": True},
            "x": {"parents": ["Pop", "b"], "discogs": True}}
    levels = genre_vocab.parse_levels(base)[0]
    assert (levels["a"]["level"], levels["a"]["family"]) == (2, "Rock")
    assert (levels["b"]["level"], levels["b"]["family"]) == (3, "Rock")
    assert (levels["x"]["level"], levels["x"]["family"]) == (2, "Pop")

    def broken(fn):
        d = copy.deepcopy(base)
        fn(d)
        return d

    bad = [
        (broken(lambda d: d.update(c={"parents": ["b"], "discogs": True})), "hard cap"),
        (broken(lambda d: d["a"].update(parents=["Rock", "x"])), "own ancestor"),
        (broken(lambda d: d["b"].update(parents=["a", "x"])), "own ancestor"),
        (broken(lambda d: d["b"].update(parents=["a", "Nope"])), "parent"),
        (broken(lambda d: (d["a"].update(parents=["Rock"]), d["b"].update(family="Pop"))), "not reachable"),
    ]
    for doc, word in bad:
        with pytest.raises(ValueError, match=word):
            genre_vocab.parse_levels(doc)
    with pytest.raises(ValueError, match="not reachable"):
        genre_vocab.parse_levels(broken(lambda d: d["a"].update(family="Pop")))
    genre_vocab.reset()
    body = genre_vocab.vocabulary()["levels"]
    assert body["disco"]["parents"] == ["Funk / Soul", "Electronic"]
    assert body["deep house"]["parents"] == ["house"]


def test_psytrance_branch_is_a_level_two_umbrella_apart_from_trance():
    p = ENTRIES["psytrance"]
    assert (p["parents"], p["discogs"], p["display"]) == (["Electronic"], True, "Psy-Trance")
    kids = {k for k, v in ENTRIES.items() if v["parents"][0] == "psytrance"}
    assert kids == {"dark psytrance", "forest psytrance", "progressive psytrance", "full-on psytrance", "goa trance", "psybient"}
    for k in kids:
        assert ENTRIES[k]["family"] == "Electronic"
    assert ENTRIES["goa trance"]["parents"] == ["psytrance"]
    assert ENTRIES["goa trance"]["discogs"] is True
    assert ENTRIES["psybient"]["parents"] == ["psytrance", "ambient"]
    assert ENTRIES["progressive trance"]["parents"] == ["trance"]
    assert not any(v["parents"][0] == "trance" and k in kids for k, v in ENTRIES.items())
    new = ["dark psytrance", "forest psytrance", "progressive psytrance", "full-on psytrance"]
    for k in new:
        e = ENTRIES[k]
        assert e["discogs"] is False, k
        assert e["status"] == "approved", k
        assert k in EXTRAS, k
        assert k not in DISCOGS["genres"], k
        assert e["display"].endswith("Psy-Trance"), k
    assert "darkpsy" in ENTRIES["dark psytrance"]["synonyms"]
    assert "prog psy" in ENTRIES["progressive psytrance"]["synonyms"]


def test_soviet_wave_is_an_approved_extra_under_synthwave():
    e = ENTRIES["soviet wave"]
    assert e["family"] == "Electronic"
    assert e["parents"] == ["synthwave"]
    assert e["display"] == "Soviet Wave"
    assert e["discogs"] is False
    assert e["status"] == "approved"
    assert "soviet wave" in EXTRAS
    assert "soviet wave" not in DISCOGS["genres"]
    assert "советская волна" in e["synonyms"]
    assert "sovietwave" in e["synonyms"]


def test_french_house_is_an_extra_under_house_and_french_touch_is_its_alias():
    from app import genre_filter as gf
    from app import genre_vocab

    genre_vocab.reset()
    e = ENTRIES["french house"]
    assert e["family"] == "Electronic"
    assert e["parents"] == ["house"]
    assert e["discogs"] is False
    assert "french house" in EXTRAS
    assert "french house" not in DISCOGS["genres"]
    assert EXTRAS["french house"]["parents"] == ["house"]
    assert genre_vocab.entry("french house").family == "Electronic"
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
    assert (e["family"], e["parents"], e["discogs"], e["status"]) == ("Electronic", ["trance"], False, "approved")
    assert e["synonyms"] == ["dream house", "dream dance"]
    assert "dream trance" in EXTRAS
    assert "dream trance" not in DISCOGS["genres"]
    assert EXTRAS["dream trance"]["parents"] == ["trance"]
    assert ENTRIES["trance"]["parents"] == ["Electronic"]
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
    assert gf.canonical("epic") == "epic"
    assert ENTRIES["epic"]["family"] == "Classical"
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
    assert library.clean_tags(["genre:Soundtrack", "genre:trailer", "genre:Score", "genre:house", "genre:epic"]) == ["genre:house", "genre:epic"]
    assert library.clean_tags(["genre:trailer"]) == []


def test_epic_is_a_level_two_classical_genre_next_to_modern_classical():
    assert ENTRIES["epic"]["family"] == "Classical"
    assert ENTRIES["epic"]["parents"] == ["Classical"]
    assert ENTRIES["modern classical"]["family"] == "Classical"
    assert EXTRAS["epic"]["parents"] == ["Classical"]


def test_spacesynth_is_level_three_under_synthwave_with_italo_disco_as_a_cross_link():
    e = ENTRIES["spacesynth"]
    assert (e["parents"], e["level"], e["family"], e["status"], e["discogs"]) == (["synthwave", "italo disco"], 3, "Electronic", "approved", False)


def test_space_disco_is_an_approved_extra_level_three_under_disco_in_electronic():
    e = ENTRIES["space disco"]
    assert (e["parents"], e["level"], e["family"], e["discogs"], e["status"], e["display"], e["synonyms"]) == (["disco"], 3, "Electronic", False, "approved", "Space Disco", ["space-disco"])
    assert EXTRAS["space disco"]["parents"] == ["disco"]
    assert EXTRAS["space disco"]["family"] == "Electronic"
    assert "space disco" not in DISCOGS["genres"]
    assert genre_vocab.entry("space-disco").name == "space disco"
    assert genre_vocab.entry("space disco").parents == ("disco",)
    assert len(EXTRAS) == 53


def test_electronic_counts_in_the_meta_block_match_the_data():
    counts = LEVELS["_meta"]["counts"]
    for family in DISCOGS["families"]:
        mine = [v for v in ENTRIES.values() if v["family"] == family]
        assert counts[family] == {"total": len(mine), "level2": sum(v["level"] == 2 for v in mine), "level3": sum(v["level"] == 3 for v in mine)}, family
    assert (counts["Electronic"]["level2"], counts["Electronic"]["level3"]) == (50, 95)
