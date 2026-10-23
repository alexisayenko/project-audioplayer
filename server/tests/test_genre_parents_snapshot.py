"""ADR-0030: the `parents` lists reproduce the old parent/also_under/also_in_genres data exactly (as sets: since ADR-0037 the order of `parents` has no meaning, and the old `family` and level fields are no longer compared).

`fixtures/genre_parents_snapshot_server.json` was taken from the data and code at commit 78b3457, before the change, and holds the old fields of every vocabulary row and every levels entry.
The changes after it are listed in EDITED and are the only expected differences, including the Oct 20–21 group/form promotions and removal of the Latin and Folk, World, & Country families.
"""

import json
from pathlib import Path

from app import genre_vocab

SNAP = json.loads((Path(__file__).parent / "fixtures" / "genre_parents_snapshot_server.json").read_text(encoding="utf-8").replace('"Others"', '"Others"'))  # the snapshot predates the rename of the Electronic family to the group Others
RELATED_MOVED = {
    "minimal": ["house"], "witch house": ["industrial"], "breakcore": ["breakbeat"], "chillwave": ["downtempo"], "vaporwave": ["downtempo"], "dark electro": ["electro"],
    "dungeon synth": ["synthwave"], "future bass": ["house"], "jungle": ["drum and bass"], "melodic techno": ["trance"], "microhouse": ["techno"], "minimal techno": ["house"],
    "neurofunk": ["industrial"], "darksynth": ["industrial"], "hardcore techno": ["Rock"], "noise": ["Rock"], "grime": ["Hip Hop"], "trap": ["Others"], "acid jazz": ["Others"],
    "new wave": ["Others"], "modern classical": ["Others"], "gospel": ["Funk / Soul"], "electro house": ["electro"],
}
ADDED = {"edm", "hardcore punk", "experimental rock", "extreme metal", "noise rock", "roots rock", "neo-psychedelia", "glam metal", "college rock", "death-doom", "hardcore techno", "chillstep", "outrun", "ambient techno", "twilight psytrance", "hi-tech psytrance", "psycore"}
# Rock hierarchy (ADR-0030 note, GEN-067): every Rock genre whose parents changed from [Rock] or the old pair; the 20 held genres and everything else are unchanged.
ROCK_EDITED = {
    "acid rock", "alternative metal", "anarcho-punk", "atmospheric black metal", "black metal", "blackgaze", "britpop", "brutal death metal", "coldwave", "crust",
    "dance-punk", "death metal", "deathcore", "deathrock", "depressive black metal", "doom metal", "dream pop", "electronic rock", "emo", "folk metal", "folk punk",
    "funeral doom metal", "funk metal", "garage rock", "goregrind", "goth rock", "gothic metal", "grindcore", "groove metal", "grunge", "industrial metal",
    "industrial rock", "krautrock", "math rock", "mathcore", "melodic death metal", "melodic hardcore", "metalcore", "midwest emo", "noisecore", "nu metal", "oi",
    "pop punk", "pornogrind", "post-britpop", "post-grunge", "post-hardcore", "post-metal", "post-punk", "post-punk revival", "post-rock", "power metal", "power pop",
    "progressive metal", "rap metal", "rockabilly", "screamo", "shoegaze", "slowcore", "sludge metal", "space rock", "speed metal", "surf", "symphonic metal",
    "symphonic rock", "technical death metal", "thrash", "viking metal",
}
ROCK_RELATED = {"krautrock", "no wave", "post-hardcore", "mathcore", "crust", "melodic hardcore", "groove metal", "viking metal", "dance-punk", "industrial rock", "nu metal"}
INDUSTRIAL_REMOVED = {"industrial", "ethereal"}
INDUSTRIAL_AFFECTED = {"dark electro", "ebm", "harsh noise wall", "power electronics", "rhythmic noise", "industrial metal", "industrial rock", "witch house", "neurofunk", "darksynth"}
EDITED = {*INDUSTRIAL_AFFECTED, *INDUSTRIAL_REMOVED, "spacesynth", "space disco", "soviet wave", "sovietwave", "eurobeat", "disco", "epic", "hardcore", "drum and bass", "house", "synthwave", "techno", "trance", "acid", "acid trance", "dark psytrance", "acid house", "deep house", "alternative r&b", "ambient house", "latin jazz", *RELATED_MOVED, *ROCK_EDITED}
SECOND_FAMILY = {
    "acid jazz": "Others", "blues rock": "Rock", "bossa nova": "Jazz", "country rock": "Rock", "dub": "Others", "electro": "Hip Hop",
    "experimental": "Rock", "folk rock": "Rock", "funk metal": "Funk / Soul", "gospel": "Folk, World, & Country", "grime": "Hip Hop",
    "hardcore techno": "Rock", "hip house": "Hip Hop", "jazz funk": "Funk / Soul", "latin jazz": "Latin", "modern classical": "Others",
    "new wave": "Others", "noise": "Rock", "rhythm and blues": "Blues", "soul jazz": "Funk / Soul", "synthpop": "Pop", "trap": "Others",
    "trip hop": "Hip Hop",
}
LOFI_REMOVED = {"lo-fi"}
EDITED |= LOFI_REMOVED


def payload():
    genre_vocab.reset()
    return genre_vocab.vocabulary()


def old_set(old):
    values = {old["parent"] or old["family"], *old["also_under"], *old["also_in_genres"]}
    return {"Others" if p in {"Electronic", "Latin", "Folk, World, & Country"} else "hardcore techno" if p == "hardcore" else p for p in values}


KILLED = {"Latin", "Folk, World, & Country"}
KILLED_ROWS = {"latin", "folk, world, & country"}
KILLED_EDITED = {n for n, o in SNAP["levels"].items() if KILLED & {o["parent"] or o["family"], *o["also_under"], *o["also_in_genres"]}}
EDITED |= KILLED_EDITED


def after_kill(parents):
    return (set(parents) - KILLED) or {"Others"}


EDITED |= {name for name, old in SNAP["levels"].items() if "Electronic" in old_set(old) or "hardcore" in old_set(old)}
CURRENT = payload()
CURRENT_ROWS = {row["name"]: row for row in CURRENT["genres"]}
EDITED |= {
    name for name, old in SNAP["levels"].items()
    if name in CURRENT["levels"] and (
        old["family"] not in CURRENT["levels"][name]["families"]
        and not (old["family"] == "Electronic" and "Others" in CURRENT["levels"][name]["families"])
        or old_set(old) != set(CURRENT["levels"][name]["parents"])
    )
}
EDITED |= {
    name for name, old in SNAP["rows"].items()
    if name not in CURRENT_ROWS or (
        CURRENT_ROWS[name]["parents"][1:] != old["also_under"]
        or CURRENT_ROWS[name]["parents"][:1] != [old["parent"]] and old["parent"] is not None
    )
}


def test_levels_entries_match_the_snapshot_taken_before_the_change():
    body = payload()
    assert set(body["levels"]) - set(SNAP["levels"]) == {"space disco", "sovietwave"} | ADDED
    assert set(SNAP["levels"]) - set(body["levels"]) == {"soviet wave", "eurobeat", "house", "techno", "trance", "synthwave", "drum and bass", "epic", "hardcore"} | INDUSTRIAL_REMOVED | LOFI_REMOVED
    for name, old in SNAP["levels"].items():
        if name in EDITED or name in {"post-disco", "psytrance", "eurodance", "darkwave", "synthpop"} | INDUSTRIAL_AFFECTED | INDUSTRIAL_REMOVED:
            continue
        want = old_set(old) | ({SECOND_FAMILY[name]} if name in SECOND_FAMILY else set())
        assert set(body["levels"][name]["parents"]) == want, name
        expected_family = "Others" if old["family"] == "Electronic" else old["family"]
        if name in {"acid house", "acid trance"}:
            expected_family = body["levels"][name]["families"][0]
        assert expected_family in body["levels"][name]["families"], name


def test_the_tree_changes_only_by_the_links_moved_to_related():
    body = payload()
    families = set(body["families"])
    assert len(RELATED_MOVED) == 23
    for name, moved in RELATED_MOVED.items():
        if name == "hardcore techno":
            assert body["levels"][name]["parents"] == ["Others"]
            assert body["levels"][name].get("related") == moved
            continue
        old = SNAP["levels"][name]
        before = old_set(old) | ({SECOND_FAMILY[name]} if name in SECOND_FAMILY else set())
        lv = body["levels"][name]
        assert set(lv["parents"]) == after_kill(before - set(moved) - INDUSTRIAL_REMOVED), name
        expected_related = ["hardcore techno" if m == "hardcore" else m for m in moved if m not in INDUSTRIAL_REMOVED]
        assert lv.get("related", []) == expected_related, name
        assert len(lv["parents"]) == len(set(lv["parents"])) and lv["parents"], name
    assert body["levels"]["gospel"]["families"] == ["Others"] and families >= {"Others"}
    assert {n for n, lv in body["levels"].items() if lv.get("related")} == set(RELATED_MOVED) - {"witch house", "neurofunk", "darksynth"} | ROCK_RELATED | {"outrun", "ambient techno", "spacesynth", "chillstep", "twilight psytrance", "hi-tech psytrance", "psycore"}


def test_the_second_family_additions_left_are_the_only_other_differences():
    assert len(SECOND_FAMILY) == 23
    levels = payload()["levels"]
    for name, family in SECOND_FAMILY.items():
        if family in KILLED:
            assert family not in levels[name]["parents"], name
            continue
        if name in RELATED_MOVED:
            assert (family in levels[name]["parents"]) == (name == "gospel"), name
            continue
        if name in {"eurodance", "synthpop"}:
            assert family in levels[name]["parents"], name
            continue
        retired_family_reparents = {"bossa nova": ["Jazz"], "country rock": ["Rock"], "folk rock": ["Rock"], "folk metal": ["heavy metal"], "folk punk": ["punk"]}
        if name in retired_family_reparents:
            assert levels[name]["parents"] == retired_family_reparents[name], name
        else:
            assert levels[name]["parents"][-1] == family and levels[name]["parents"][0] not in (family,), name


def test_the_data_edits_of_2026_10_19():
    levels = payload()["levels"]
    assert (levels["spacesynth"]["parents"], levels["spacesynth"]["level"], levels["spacesynth"]["status"]) == (["synthwave", "italo disco"], 2, "approved")  # level 2: synthwave is level 1 since 2026-10-20 (task-0066)
    sd = levels["space disco"]
    assert (sd["parents"], sd["family"], sd["level"], sd["discogs"], sd["status"], sd["display"], sd["synonyms"]) == (["disco"], "Funk / Soul", 3, False, "approved", None, ["space-disco"])  # disco left Others (task-0066, 2026-10-20)
    sw = levels["sovietwave"]
    assert (sw["parents"], sw["family"], sw["level"], sw["display"]) == (["synthwave"], "synthwave", 2, None)  # synthwave is level 1 (task-0066, 2026-10-20)


def test_vocabulary_rows_match_the_snapshot_taken_before_the_change():
    body = payload()
    families = set(body["families"])
    rows = {r["name"]: r for r in body["genres"]}
    assert set(rows) - set(SNAP["rows"]) == {"space disco", "sovietwave"} | ADDED
    for name, old in SNAP["rows"].items():
        if name in EDITED or name in KILLED_ROWS:
            continue
        row = rows[name]
        assert (row["level"], row["extra"]) == (old["level"], old["extra"]), name
        expected_family = "Others" if old["family"] == "Electronic" else old["family"]
        if name == "acid house":
            expected_family = "house"
        assert expected_family in row["families"] or old["level"] == "family", name
        first, rest = row["parents"][:1], row["parents"][1:]
        if old["level"] == "family":
            assert row["parents"] == [], name
            continue
        assert rest == old["also_under"], name
        if first[0] in families:
            expected_parent = "others" if old["parent"] == "electronic" else old["parent"]
            assert expected_parent in (None, first[0].lower()), name
        else:
            assert old["parent"] == first[0], name
        assert "parent" not in row and "also_under" not in row, name


def test_the_rock_edits_are_exactly_the_genres_whose_parents_changed():
    body = payload()
    assert len(ROCK_EDITED) == 68
    for name in ROCK_EDITED - {"industrial rock"}:
        assert "Rock" in body["levels"][name]["families"] and SNAP["levels"][name]["family"] == "Rock", name
        assert set(body["levels"][name]["parents"]) != old_set(SNAP["levels"][name]), name


def test_the_killed_families_2026_10_21_left_no_genre_without_a_parent():
    body = payload()
    assert len(KILLED_EDITED) >= 100
    assert not KILLED & set(body["families"]) and not KILLED_ROWS & {r["name"] for r in body["genres"]}
    for name in KILLED_EDITED & set(body["levels"]):
        parents = set(body["levels"][name]["parents"])
        assert parents and not parents & KILLED, name
    keep = {"bossa nova": ["Jazz"], "latin jazz": ["Jazz"], "country rock": ["Rock"], "folk rock": ["Rock"], "folk metal": ["heavy metal"], "folk punk": ["punk"]}
    for name, parents in keep.items():
        assert body["levels"][name]["parents"] == parents, name
        assert "fusion" not in body["levels"][name] or not body["levels"][name]["fusion"], name
    assert body["levels"]["folk"]["parents"] == ["Others"] and "latin" not in body["levels"]
