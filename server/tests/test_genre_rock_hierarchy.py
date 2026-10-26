"""The Rock tree (ADR-0030 note, GEN-067): the current Rock counts come from the vocabulary metadata; provisional level-2 genres remain explicitly reviewed."""

import json
from pathlib import Path

from app import genre_vocab

DATA = Path(__file__).resolve().parent.parent / "data"
LEVELS = json.loads((DATA / "genre_levels.json").read_text(encoding="utf-8"))
ENTRIES = genre_vocab.parse_levels(LEVELS)[0]
FAMILIES = set(LEVELS["families"])
ROCK = {k: v for k, v in ENTRIES.items() if "Rock" in v["families"]}
ROCK_ONLY = {k for k, v in ROCK.items() if v["families"] == ["Rock"]}

EXCEPTIONS = {
    "death metal": ["Rock", "heavy metal", "extreme metal"], "black metal": ["Rock", "heavy metal", "extreme metal"],
    "post-punk": ["Rock", "punk"],
}
NINE_LEVEL3 = {"hardcore punk", "extreme metal", "neo-psychedelia", "glam metal", "college rock", "death-doom"}


def test_a_provisional_rock_only_genre_sits_directly_under_rock_and_has_no_children():
    held = {k for k in ROCK_ONLY if ROCK[k]["provisional"]}
    assert held
    for k in held:
        assert ROCK[k]["parents"] == ["Rock"], k
        assert ROCK[k]["level"] == 2, k
    assert not [k for k, v in ENTRIES.items() if set(v["parents"]) & held]


def test_the_depth_cap_exceptions_stay_level_two_with_their_children_at_level_three():
    for k, parents in EXCEPTIONS.items():
        assert ENTRIES[k]["parents"] == parents, k
        assert ENTRIES[k]["level"] == 2, k
        kids = [c for c, v in ENTRIES.items() if v["parents"][0] == k]
        assert kids, k
        assert all(ENTRIES[c]["level"] == 3 for c in kids), k
    assert ENTRIES["post-punk"]["parents"] == ["Rock", "punk"]


def test_children_of_hardcore_punk_and_other_level_three_parents_keep_a_level_two_placement_parent():
    for k in NINE_LEVEL3:
        assert ENTRIES[k]["level"] == 3, k
        assert not [c for c, v in ENTRIES.items() if v["parents"][0] == k], k
    for k in ("melodic hardcore", "emo", "metalcore", "grindcore", "sludge metal", "mathcore", "noisecore"):
        assert "hardcore punk" in ENTRIES[k]["parents"][1:], k
    assert ENTRIES["mathcore"]["parents"] == ["heavy metal", "metalcore", "hardcore punk"]
    assert ENTRIES["funeral doom metal"]["parents"] == ["death metal", "death-doom", "doom metal"]
    assert ENTRIES["dream pop"]["parents"] == ["alternative rock", "neo-psychedelia"]


def test_experimental_rock_holds_krautrock_post_rock_and_math_rock():
    assert ENTRIES["krautrock"]["parents"] == ["experimental rock"]
    assert ENTRIES["post-rock"]["parents"] == ["experimental rock"]
    assert "experimental rock" in ENTRIES["math rock"]["parents"][1:]
    assert ENTRIES["math rock"]["parents"][0] == "indie rock"
    assert ENTRIES["no wave"]["parents"] == ["Rock"]
    assert "experimental rock" in ENTRIES["no wave"]["related"]


def test_extreme_metal_is_an_extra_parent_of_thrash_doom_death_and_black_metal_and_crust():
    for k in ("thrash", "doom metal", "death metal", "black metal", "crust"):
        assert "extreme metal" in ENTRIES[k]["parents"][1:], k
    assert ENTRIES["thrash"]["parents"][0] == "heavy metal"
    assert ENTRIES["doom metal"]["parents"][0] == "heavy metal"


def test_rock_blends_with_another_family_carry_the_family_and_the_fusion_flag():
    want = {"rap metal": "Hip Hop", "funk metal": "Funk / Soul", "electronic rock": "Others"}
    for k, fam in want.items():
        assert fam in ENTRIES[k]["parents"], k
        assert ENTRIES[k]["fusion"] is True, k
        assert "Rock" in ENTRIES[k]["families"], k
        assert fam in ENTRIES[k]["families"], k
    for k in ("folk metal", "folk punk"):
        assert not ENTRIES[k].get("fusion"), k
        assert ENTRIES[k]["families"] == ["Rock"], k
    for k in ("coldwave", "industrial metal", "industrial rock"):
        assert not [p for p in ENTRIES[k]["parents"] if p in FAMILIES and p != "Rock"], k
        assert not ENTRIES[k].get("fusion"), k
        assert ENTRIES[k]["families"] == ["Rock"], k
    assert ENTRIES["coldwave"]["parents"] == ["post-punk", "darkwave"]
    assert ENTRIES["industrial metal"]["parents"] == ["heavy metal", "industrial rock"]
    assert ENTRIES["industrial rock"]["parents"] == ["Rock"]
