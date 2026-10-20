"""ADR-0030: the `parents` lists reproduce the old parent/also_under/also_in_genres data exactly (as sets: since ADR-0037 the order of `parents` has no meaning, and the old `family` and level fields are no longer compared).

`fixtures/genre_parents_snapshot_server.json` was taken from the data and code at commit 78b3457, before the change, and holds the old fields of every vocabulary row and every levels entry.
The two data edits of 2026-10-19 that came after it (spacesynth, space disco) are listed in EDITED and are the only expected differences.
"""

import json
from pathlib import Path

from app import genre_vocab

SNAP = json.loads((Path(__file__).parent / "fixtures" / "genre_parents_snapshot_server.json").read_text(encoding="utf-8").replace('"Others"', '"Others"'))  # the snapshot predates the rename of the Electronic family to the group Others
RELATED_MOVED = {
    "minimal": ["house"], "witch house": ["industrial"], "breakcore": ["breakbeat"], "chillwave": ["downtempo"], "vaporwave": ["downtempo"], "dark electro": ["electro"],
    "dungeon synth": ["synthwave"], "future bass": ["house"], "jungle": ["drum and bass"], "melodic techno": ["trance"], "microhouse": ["techno"], "minimal techno": ["house"],
    "neurofunk": ["industrial"], "darksynth": ["industrial"], "hardcore techno": ["Rock"], "noise": ["Rock"], "grime": ["Hip Hop"], "trap": ["Others"], "acid jazz": ["Others"],
    "new wave": ["Others"], "modern classical": ["Others"], "gospel": ["Funk / Soul"],
}
ADDED = {"edm", "hardcore punk", "experimental rock", "extreme metal", "noise rock", "roots rock", "neo-psychedelia", "glam metal", "college rock", "death-doom"}
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
EDITED = {*INDUSTRIAL_AFFECTED, *INDUSTRIAL_REMOVED, "spacesynth", "space disco", "soviet wave", "sovietwave", "eurobeat", *RELATED_MOVED, *ROCK_EDITED}
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
    return {old["parent"] or old["family"], *old["also_under"], *old["also_in_genres"]}


def test_levels_entries_match_the_snapshot_taken_before_the_change():
    body = payload()
    assert set(body["levels"]) - set(SNAP["levels"]) == {"space disco", "sovietwave"} | ADDED
    assert set(SNAP["levels"]) - set(body["levels"]) == {"soviet wave", "eurobeat"} | INDUSTRIAL_REMOVED | LOFI_REMOVED
    for name, old in SNAP["levels"].items():
        if name in EDITED or name in {"post-disco", "psytrance", "eurodance", "darkwave", "synthpop"} | INDUSTRIAL_AFFECTED | INDUSTRIAL_REMOVED:
            continue
        want = old_set(old) | ({SECOND_FAMILY[name]} if name in SECOND_FAMILY else set())
        assert set(body["levels"][name]["parents"]) == want, name
        assert old["family"] in body["levels"][name]["families"], name


def test_the_tree_changes_only_by_the_links_moved_to_related():
    body = payload()
    families = set(body["families"])
    assert len(RELATED_MOVED) == 22
    for name, moved in RELATED_MOVED.items():
        old = SNAP["levels"][name]
        before = old_set(old) | ({SECOND_FAMILY[name]} if name in SECOND_FAMILY else set())
        lv = body["levels"][name]
        assert set(lv["parents"]) == (before - set(moved) - INDUSTRIAL_REMOVED or {"Others"}), name
        assert lv.get("related", []) == [m for m in moved if m not in INDUSTRIAL_REMOVED], name
        assert len(lv["parents"]) == len(set(lv["parents"])) and lv["parents"], name
    assert body["levels"]["gospel"]["families"] == ["Folk, World, & Country"] and families >= {"Folk, World, & Country"}
    assert {n for n, lv in body["levels"].items() if lv.get("related")} == set(RELATED_MOVED) - {"witch house", "neurofunk", "darksynth"} | ROCK_RELATED


def test_the_second_family_additions_left_are_the_only_other_differences():
    assert len(SECOND_FAMILY) == 23
    levels = payload()["levels"]
    for name, family in SECOND_FAMILY.items():
        if name in RELATED_MOVED:
            assert (family in levels[name]["parents"]) == (name == "gospel"), name
            continue
        if name in {"eurodance", "synthpop"}:
            assert family in levels[name]["parents"], name
            continue
        assert levels[name]["parents"][-1] == family and levels[name]["parents"][0] not in (family,), name


def test_the_data_edits_of_2026_10_19():
    levels = payload()["levels"]
    assert (levels["spacesynth"]["parents"], levels["spacesynth"]["level"], levels["spacesynth"]["status"]) == (["synthwave", "italo disco"], 3, "approved")
    sd = levels["space disco"]
    assert (sd["parents"], sd["family"], sd["level"], sd["discogs"], sd["status"], sd["display"], sd["synonyms"]) == (["disco"], "Others", 3, False, "approved", None, ["space-disco"])
    sw = levels["sovietwave"]
    assert (sw["parents"], sw["family"], sw["level"], sw["display"]) == (["synthwave"], "Others", 3, None)


def test_vocabulary_rows_match_the_snapshot_taken_before_the_change():
    body = payload()
    families = set(body["families"])
    rows = {r["name"]: r for r in body["genres"]}
    assert set(rows) - set(SNAP["rows"]) == {"space disco", "sovietwave"} | ADDED
    for name, old in SNAP["rows"].items():
        if name in EDITED:
            continue
        row = rows[name]
        assert (row["level"], row["extra"]) == (old["level"], old["extra"]), name
        assert old["family"] in row["families"] or old["level"] == "family", name
        first, rest = row["parents"][:1], row["parents"][1:]
        if old["level"] == "family":
            assert row["parents"] == [], name
            continue
        assert rest == old["also_under"], name
        if first[0] in families:
            assert old["parent"] in (None, first[0].lower()), name
        else:
            assert old["parent"] == first[0], name
        assert "parent" not in row and "also_under" not in row, name


def test_the_rock_edits_are_exactly_the_genres_whose_parents_changed():
    body = payload()
    assert len(ROCK_EDITED) == 68
    for name in ROCK_EDITED - {"industrial rock"}:
        assert "Rock" in body["levels"][name]["families"] and SNAP["levels"][name]["family"] == "Rock", name
        assert set(body["levels"][name]["parents"]) != old_set(SNAP["levels"][name]), name
