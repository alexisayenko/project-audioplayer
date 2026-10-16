import json
from pathlib import Path

from tests.test_library import H, client  # noqa: F401

DATA = Path(__file__).resolve().parent.parent / "data"
STYLES = json.loads((DATA / "genre_styles.json").read_text(encoding="utf-8"))
EXTRAS = json.loads((DATA / "genre_extras.json").read_text(encoding="utf-8"))["extras"]
LEVELS = json.loads((DATA / "genre_levels.json").read_text(encoding="utf-8"))
GENRES = LEVELS["genres"]
FLAVOURS = LEVELS["flavours"]
ENTRIES = {k: v for k, v in LEVELS.items() if k not in ("_meta", "genres", "flavours")}


def test_every_vocabulary_style_appears_once():
    assert set(ENTRIES) == set(STYLES["styles"]) | set(EXTRAS)


def test_genres_are_among_the_fifteen():
    assert all(v["genre"] in STYLES["genres"] for v in ENTRIES.values())


def test_genre_matches_the_vocabulary():
    for k, v in ENTRIES.items():
        assert v["genre"] == STYLES["styles"].get(k, (EXTRAS.get(k) or {}).get("family")), k


def test_depth_at_most_three():
    for k, v in ENTRIES.items():
        p = v["parent"]
        if p is None:
            continue
        assert p in ENTRIES and p != k, k
        assert ENTRIES[p]["parent"] is None, f"{k} -> {p} is not level 2"
        assert ENTRIES[p]["genre"] == v["genre"] or v["genre"] in ENTRIES[p].get("also_in_genres", []), k


def test_also_under_keys_exist_and_are_level_two():
    for k, v in ENTRIES.items():
        for a in v.get("also_under", []):
            assert a in ENTRIES and a != k and a != v["parent"], (k, a)


def test_discogs_flag_matches_styles_file():
    for k, v in ENTRIES.items():
        assert v["discogs"] is (k in STYLES["styles"]), k


def test_only_electronic_is_drafted():
    for k, v in ENTRIES.items():
        if v["genre"] != "Electronic":
            assert v["parent"] is None and v.get("provisional") is True, k
        else:
            assert "provisional" not in v, k


def test_genres_block_names_match_the_fifteen():
    assert list(GENRES) == STYLES["genres"]
    assert all(v["name"] == k for k, v in GENRES.items())


def test_synonyms_are_lowercase_and_collision_free():
    names = {g.lower() for g in STYLES["genres"]}
    seen = {}
    pairs = [(g, s) for g, v in GENRES.items() for s in v["synonyms"]]
    pairs += [(k, s) for k, v in ENTRIES.items() for s in v.get("synonyms", [])]
    for owner, s in pairs:
        assert s == s.lower() and s.strip() == s and s, s
        assert s not in ENTRIES and s not in names, s
        assert s not in seen, (s, owner, seen.get(s))
        seen[s] = owner


def test_electronic_synonyms():
    assert GENRES["Electronic"]["synonyms"] == [
        "electronic dance music", "edm", "dance music", "club music", "electronic music",
        "dance", "electronic dance", "electronica", "indietronica", "alternative dance", "rave", "dance & edm",
    ]


REMOVED = {
    "electronic dance": "electronic", "dance": "electronic", "electronica": "electronic", "indietronica": "electronic", "alternative dance": "electronic",
    "chillout": "downtempo", "afro house": "house", "big room house": "house", "bubblegum dance": "eurodance", "techstep": "drum and bass",
    "liquid funk": "liquid drum and bass", "breakbeat hardcore": "breakbeat", "jersey club": "breakbeat", "rave": "electronic",
    "techno pop": "synthpop", "french touch": "house", "electropop": "synthpop", "french house": "house", "melodic house": "house",
}
APPROVED = {"dark psytrance", "forest psytrance", "progressive psytrance", "full-on psytrance", "vocal trance", "melodic techno", "psybient", "darksynth", "uplifting trance", "sunshine house", "dreamsynth", "dreamwave", "neurofunk",
            "spacesynth", "nu-nrg", "liquid drum and bass"}
QUESTION = {"deep trance", "acid trance"}


def test_removed_styles_are_gone_and_fold_to_a_vocabulary_target():
    from app import genre_filter as gf
    from app import genre_vocab

    genre_vocab.reset()
    for old, target in REMOVED.items():
        assert old not in ENTRIES and old not in EXTRAS and old not in STYLES["styles"], old
        assert genre_vocab.lookup(old) is None, old
        assert gf.canonical(old) == target, old
        assert gf.vocabulary_name(old) == target, old
        assert genre_vocab.lookup(target) == target
        assert not gf.unmappable(old)
    assert gf.canonical("club") == "electronic" and gf.canonical("Club Music") == "electronic" and not gf.is_dropped("club")
    assert gf.canonical("dance music") == "electronic" and gf.canonical("EDM") == "electronic"
    assert gf.canonical("Liquid DnB") == "liquid drum and bass"
    for loose in ("russian electro pop", "electronic pop"):
        assert gf.canonical(loose) == "synthpop"


def test_removed_names_are_synonyms_of_their_target_or_dropped_as_redundant():
    for old, target in REMOVED.items():
        if target == "electronic":
            assert old in GENRES["Electronic"]["synonyms"], old
        else:
            assert old in ENTRIES[target]["synonyms"], old
    assert "electropop" in ENTRIES["synthpop"]["synonyms"]


def test_status_values():
    for k, v in ENTRIES.items():
        assert v.get("status") in (None, "approved", "question"), k
    assert {k for k, v in ENTRIES.items() if v.get("status") == "approved"} == APPROVED
    assert {k for k, v in ENTRIES.items() if v.get("status") == "question"} == QUESTION


def test_approved_never_sits_on_a_discogs_style():
    for k, v in ENTRIES.items():
        if v.get("status") == "approved":
            assert v["discogs"] is False, k
    assert "status" not in ENTRIES["tropical house"] and "status" not in ENTRIES["chillwave"]


def test_liquid_drum_and_bass_entry():
    e = ENTRIES["liquid drum and bass"]
    assert (e["genre"], e["parent"], e["discogs"]) == ("Electronic", "drum and bass", False)
    assert EXTRAS["liquid drum and bass"]["parent"] == "drum and bass"
    assert "liquid funk" in e["synonyms"] and len(set(e["synonyms"])) == len(e["synonyms"])


def test_flavours_block_and_assignments():
    assert FLAVOURS
    for k, f in FLAVOURS.items():
        assert k == k.lower() and k.strip() == k and k, k
        assert f["kind"] in ("sound", "scene") and f["name"] and f["description"], k
    assert not any(v.get("flavours") for v in ENTRIES.values()), "flavours are defined but not attached (awaiting Alex)"
    assert any(f["kind"] == "scene" for f in FLAVOURS.values()) and any(f["kind"] == "sound" for f in FLAVOURS.values())


def _payload_with(doc):
    from app import genre_vocab

    return genre_vocab.parse_levels(doc)


def test_vocabulary_payload_carries_levels_and_genre_synonyms():
    from app import genre_vocab

    genre_vocab.reset()
    body = genre_vocab.vocabulary()
    assert set(body["levels"]) == set(ENTRIES)
    assert set(body["genre_synonyms"]) == set(STYLES["genres"])
    dh = body["levels"]["deep house"]
    assert dh == {"genre": "Electronic", "parent": "house", "also_under": [], "discogs": True, "synonyms": [], "provisional": False, "status": ENTRIES["deep house"].get("status"), "flavours": ENTRIES["deep house"].get("flavours", []), "display": ENTRIES["deep house"].get("display"), "also_in_genres": []}
    assert body["levels"]["jungle"]["also_under"] == ENTRIES["jungle"]["also_under"]
    nd = next(k for k, v in ENTRIES.items() if v["discogs"] is False)
    assert body["levels"][nd]["discogs"] is False
    assert body["levels"]["rock and roll"]["provisional"] is True
    assert "edm" in body["genre_synonyms"]["Electronic"]
    assert body["flavours"] == FLAVOURS
    assert body["levels"]["deep trance"]["status"] == "question"
    assert len(json.dumps(body["levels"])) < 120_000


def test_vocabulary_endpoint_serves_levels_to_guests(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    r = client.get("/genres/vocabulary", headers=H)
    assert r.status_code == 200
    assert "levels" in r.json() and "genre_synonyms" in r.json()


def test_display_name_passes_through_the_parser():
    doc = {"genres": {"Rock": {"name": "Rock", "synonyms": []}}, "a": {"genre": "Rock", "parent": None, "discogs": True, "display": "A & B"}, "b": {"genre": "Rock", "parent": None, "discogs": True}}
    levels = _payload_with(doc)[0]
    assert levels["a"]["display"] == "A & B" and levels["b"]["display"] is None


def test_flavours_pass_through_the_parser():
    doc = {"genres": {"Rock": {"name": "Rock", "synonyms": []}}, "flavours": {"dark": {"name": "Dark", "kind": "sound", "description": "d"}},
           "a": {"genre": "Rock", "parent": None, "discogs": True, "flavours": ["dark"]}}
    levels, _, flavours = _payload_with(doc)
    assert flavours == {"dark": {"name": "Dark", "kind": "sound", "description": "d"}}
    assert levels["a"]["flavours"] == ["dark"]


def test_malformed_levels_files_raise_a_clear_error(tmp_path, monkeypatch):
    import copy

    import pytest
    from app import genre_vocab

    base = {"genres": {"Rock": {"name": "Rock", "synonyms": []}}, "a": {"genre": "Rock", "parent": None, "discogs": True}, "b": {"genre": "Rock", "parent": "a", "discogs": False}}
    assert set(_payload_with(base)[0]) == {"a", "b"}

    def broken(mutate):
        d = copy.deepcopy(base)
        mutate(d)
        return d

    bad = [
        ([], "genres"),
        ({}, "genres"),
        (broken(lambda d: d["a"].update(genre="Nope")), "unknown genre"),
        (broken(lambda d: d["a"].pop("discogs")), "discogs"),
        (broken(lambda d: d["b"].update(parent="zzz")), "parent"),
        (broken(lambda d: d["a"].update(parent="b")), "parent"),
        (broken(lambda d: d["a"].update(synonyms="x")), "synonyms"),
        (broken(lambda d: d["b"].update(also_under=["b"])), "also_under"),
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
            assert isinstance(d, str) and d.strip() == d and d, k
            assert d.lower() == k or d.lower() not in ENTRIES, k
    for syn in ("dnb", "d&b", "drum n bass", "drum'n'bass", "drum and bass music", "drum & bass music"):
        assert syn in ENTRIES["drum and bass"]["synonyms"], syn
    assert "drum and bass" not in ENTRIES["drum and bass"]["synonyms"]


def test_display_is_validated_and_served():
    import pytest
    from app import genre_vocab

    base = {"genres": {"Rock": {"name": "Rock", "synonyms": []}}, "a": {"genre": "Rock", "parent": None, "discogs": True, "display": "A!"}, "b": {"genre": "Rock", "parent": None, "discogs": True}}
    levels = genre_vocab.parse_levels(base)[0]
    assert levels["a"]["display"] == "A!" and levels["b"]["display"] is None
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
    songs = {s["id"]: s["tags"] for s in json.loads(lib.read_text())["songs"]}
    assert songs["a"] == ["genre:house", "genre:electronic", "x"]
    assert songs["c"] == ["genre:electronic"]
    assert songs["b"] == list(dict.fromkeys(f"genre:{t}" for t in REMOVED.values()))
    assert (tmp_path / "backups-genre-merge" / "u1" / "library.json").read_text() == original
    assert migrate_tags.run() == 0
    assert {s["id"]: s["tags"] for s in json.loads(lib.read_text())["songs"]} == songs


def test_disco_umbrella_spans_funk_soul_and_electronic():
    assert ENTRIES["disco"]["genre"] == "Funk / Soul" and ENTRIES["disco"]["parent"] is None
    assert ENTRIES["disco"]["also_in_genres"] == ["Electronic"]
    kids = {k for k, v in ENTRIES.items() if v["parent"] == "disco"}
    assert kids == {"euro disco", "italo disco", "hi-nrg", "nu-disco"}
    assert all(ENTRIES[k]["genre"] == "Electronic" for k in kids)
    assert "italo disco" in ENTRIES["spacesynth"]["also_under"]
    assert "disco polo" not in kids
    for k, v in ENTRIES.items():
        for g in v.get("also_in_genres", []):
            assert g in STYLES["genres"] and g != v["genre"] and v["parent"] is None, k


def test_also_in_genres_is_validated_and_served():
    import copy

    import pytest
    from app import genre_vocab

    base = {"genres": {"Rock": {"name": "Rock", "synonyms": []}, "Pop": {"name": "Pop", "synonyms": []}},
            "a": {"genre": "Rock", "parent": None, "discogs": True, "also_in_genres": ["Pop"]},
            "b": {"genre": "Pop", "parent": "a", "discogs": True}}
    assert genre_vocab.parse_levels(base)[0]["a"]["also_in_genres"] == ["Pop"]
    nope = copy.deepcopy(base)
    nope["a"]["also_in_genres"] = []
    with pytest.raises(ValueError, match="parent"):
        genre_vocab.parse_levels(nope)
    for bad in (["Rock"], ["Nope"]):
        d = copy.deepcopy(base)
        d["a"]["also_in_genres"] = bad
        with pytest.raises(ValueError, match="also_in_genres"):
            genre_vocab.parse_levels(d)
    genre_vocab.reset()
    body = genre_vocab.vocabulary()["levels"]
    assert body["disco"]["also_in_genres"] == ["Electronic"] and body["deep house"]["also_in_genres"] == []


def test_psytrance_branch_is_a_level_two_umbrella_apart_from_trance():
    p = ENTRIES["psytrance"]
    assert (p["parent"], p["discogs"], p["display"]) == (None, True, "Psy-Trance") and not p.get("also_under")
    kids = {k for k, v in ENTRIES.items() if v["parent"] == "psytrance"}
    assert kids == {"dark psytrance", "forest psytrance", "progressive psytrance", "full-on psytrance", "goa trance", "psybient"}
    for k in kids:
        assert ENTRIES[k]["genre"] == "Electronic"
    assert "psytrance" not in ENTRIES["goa trance"].get("also_under", []) and "trance" not in ENTRIES["goa trance"].get("also_under", [])
    assert ENTRIES["goa trance"]["discogs"] is True and ENTRIES["psybient"]["also_under"] == ["ambient"]
    assert ENTRIES["progressive trance"]["parent"] == "trance"
    assert not any(v["parent"] == "trance" and k in kids for k, v in ENTRIES.items())
    new = ["dark psytrance", "forest psytrance", "progressive psytrance", "full-on psytrance"]
    for k in new:
        e = ENTRIES[k]
        assert e["discogs"] is False and e["status"] == "approved" and k in EXTRAS and k not in STYLES["styles"], k
        assert e["display"].endswith("Psy-Trance"), k
    assert "darkpsy" in ENTRIES["dark psytrance"]["synonyms"] and "prog psy" in ENTRIES["progressive psytrance"]["synonyms"]
