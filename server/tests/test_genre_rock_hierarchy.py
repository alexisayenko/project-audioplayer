"""The Rock tree (ADR-0030 note, GEN-067): 91 Rock genres placed from the Wikipedia review, 19 held at [Rock] and still provisional."""

import json
from pathlib import Path

from app import genre_vocab

DATA = Path(__file__).resolve().parent.parent / "data"
LEVELS = json.loads((DATA / "genre_levels.json").read_text(encoding="utf-8"))
ENTRIES = genre_vocab.parse_levels(LEVELS)[0]
FAMILIES = set(LEVELS["families"])
ROCK = {k: v for k, v in ENTRIES.items() if "Rock" in v["families"]}
ROCK_ONLY = {k for k, v in ROCK.items() if v["families"] == ["Rock"]}

HELD = {
    "acoustic", "aor", "arena rock", "beat", "british invasion", "dance-rock", "dark metal", "jangle pop", "mod",
    "paisley underground", "psychobilly", "pub rock", "rock opera", "sadcore", "shock rock", "soft rock", "southern rock", "stoner rock", "synth-rock",
}
EXCEPTIONS = {
    "death metal": ["Rock", "heavy metal", "extreme metal"], "black metal": ["Rock", "heavy metal", "extreme metal"],
    "post-punk": ["Rock", "punk"],
}
NINE_LEVEL3 = {"hardcore punk", "extreme metal", "neo-psychedelia", "glam metal", "college rock", "death-doom"}


def test_rock_has_123_member_genres_and_the_counts_match():
    assert len(ROCK) == 123
    level2 = sum(v["level"] == 2 for v in ROCK.values())
    assert LEVELS["_meta"]["counts"]["Rock"] == {"total": 123, "level2": level2, "level3": 123 - level2, "level4": 0}
    assert (level2, 123 - level2) == (50, 73)


def test_the_level_is_the_shortest_path():
    assert max(v["level"] for k, v in ENTRIES.items() if k != "chillstep") == 3, "no level 4 once trance is level 1, except chillstep under dubstep"
    for k, v in ENTRIES.items():
        assert v["level"] == min(2 if p in FAMILIES else 1 + ENTRIES[p]["level"] for p in v["parents"]), k


def test_every_held_genre_kept_parents_rock_and_stays_provisional():
    assert len(HELD) == 19
    for k in HELD:
        assert ENTRIES[k]["parents"] == ["Rock"] and ENTRIES[k]["level"] == 2 and ENTRIES[k]["provisional"] is True, k
    assert not [k for k, v in ROCK.items() if v["provisional"] and k in ROCK_ONLY and k not in HELD]


def test_nothing_is_placed_under_a_held_genre():
    assert not [k for k, v in ENTRIES.items() if set(v["parents"]) & HELD]


def test_the_depth_cap_exceptions_stay_level_two_with_their_children_at_level_three():
    for k, parents in EXCEPTIONS.items():
        assert ENTRIES[k]["parents"] == parents and ENTRIES[k]["level"] == 2, k
        kids = [c for c, v in ENTRIES.items() if v["parents"][0] == k]
        assert kids and all(ENTRIES[c]["level"] == 3 for c in kids), k
    assert ENTRIES["post-punk"]["parents"] == ["Rock", "punk"]


def test_children_of_hardcore_punk_and_other_level_three_parents_keep_a_level_two_placement_parent():
    for k in NINE_LEVEL3:
        assert ENTRIES[k]["level"] == 3 and not [c for c, v in ENTRIES.items() if v["parents"][0] == k], k
    for k in ("melodic hardcore", "emo", "metalcore", "grindcore", "sludge metal", "mathcore", "noisecore"):
        assert "hardcore punk" in ENTRIES[k]["parents"][1:], k
    assert ENTRIES["mathcore"]["parents"] == ["heavy metal", "metalcore", "hardcore punk"]
    assert ENTRIES["funeral doom metal"]["parents"] == ["death metal", "death-doom", "doom metal"]
    assert ENTRIES["dream pop"]["parents"] == ["alternative rock", "neo-psychedelia"]


def test_experimental_rock_holds_krautrock_post_rock_and_math_rock():
    assert ENTRIES["krautrock"]["parents"] == ["experimental rock"] and ENTRIES["post-rock"]["parents"] == ["experimental rock"]
    assert "experimental rock" in ENTRIES["math rock"]["parents"][1:] and ENTRIES["math rock"]["parents"][0] == "indie rock"
    assert ENTRIES["no wave"]["parents"] == ["Rock"] and "experimental rock" in ENTRIES["no wave"]["related"]


def test_extreme_metal_is_an_extra_parent_of_thrash_doom_death_and_black_metal_and_crust():
    for k in ("thrash", "doom metal", "death metal", "black metal", "crust"):
        assert "extreme metal" in ENTRIES[k]["parents"][1:], k
    assert ENTRIES["thrash"]["parents"][0] == "heavy metal" and ENTRIES["doom metal"]["parents"][0] == "heavy metal"


def test_rock_blends_with_another_family_carry_the_family_and_the_fusion_flag():
    want = {"rap metal": "Hip Hop", "funk metal": "Funk / Soul", "electronic rock": "Others"}
    for k, fam in want.items():
        assert fam in ENTRIES[k]["parents"] and ENTRIES[k]["fusion"] is True and "Rock" in ENTRIES[k]["families"] and fam in ENTRIES[k]["families"], k
    for k in ("folk metal", "folk punk"):
        assert not ENTRIES[k].get("fusion") and ENTRIES[k]["families"] == ["Rock"], k
    for k in ("coldwave", "industrial metal", "industrial rock"):
        assert not [p for p in ENTRIES[k]["parents"] if p in FAMILIES and p != "Rock"] and not ENTRIES[k].get("fusion"), k
        assert ENTRIES[k]["families"] == ["Rock"], k
    assert ENTRIES["coldwave"]["parents"] == ["post-punk", "darkwave"]
    assert ENTRIES["industrial metal"]["parents"] == ["heavy metal", "industrial rock"] and ENTRIES["industrial rock"]["parents"] == ["Rock"]
