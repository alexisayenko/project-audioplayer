import copy
import json
import random
import string

import pytest

from app import credits

SEEDS = range(15)
NAMES = ["Alesso", "Dua Lipa", "Земфира", "AC/DC", "Nadia Ali", "DJ X", "Kato", "Mr. Oizo", "A", "B"]
JOINERS = [" - ", " & ", ", ", " feat. ", " / ", " | ", " x ", " and ", "  ", " – "]
YEARS = [None, 1850, 1900, 1999, 2027, 2999, "1999", "x", True, False, 0, 12.0]
ALPHABET = string.ascii_letters + " -&,/|.Жé\t "


def text(rng):
    if rng.random() < 0.15:
        return rng.choice([None, "", "   ", "-", " - ", 5, ["A"]])
    if rng.random() < 0.2:
        return "".join(rng.choice(ALPHABET) for _ in range(rng.randrange(0, 30)))
    parts = [rng.choice(NAMES)]
    for _ in range(rng.randrange(0, 4)):
        parts += [rng.choice(JOINERS), rng.choice(NAMES)]
    return rng.choice(["", " ", "  "]) + "".join(parts) + rng.choice(["", " ", "  "])


def legacy_song(rng, i):
    song = {"id": f"id{i}", "title": text(rng) or "T", "tags": ["x"], "updated_at": "2026-01-01T00:00:00Z"}
    for key in ("artist", "remixer"):
        if rng.random() < 0.9:
            song[key] = text(rng)
    for key in ("year", "remix_year"):
        if rng.random() < 0.8:
            song[key] = rng.choice(YEARS)
    return song


def norm_text(v):
    if isinstance(v, str):
        return v.strip() or None
    return None


def norm_year(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and float(v).is_integer():
        return int(v)
    if isinstance(v, str) and v.strip().isdigit():
        return int(v.strip())
    return None


def expected(song):
    return {"artist": norm_text(song.get("artist")), "remixer": norm_text(song.get("remixer")),
            "year": norm_year(song.get("year")), "remix_year": norm_year(song.get("remix_year"))}


def dumps(song):
    return json.dumps(song, sort_keys=False, ensure_ascii=False)


@pytest.mark.parametrize("seed", SEEDS)
def test_migrate_is_idempotent(seed):
    rng = random.Random(seed)
    for i in range(60):
        song = legacy_song(rng, i)
        credits.ensure(song)
        once = dumps(song)
        assert credits.ensure(song) is False
        assert dumps(song) == once


@pytest.mark.parametrize("seed", SEEDS)
def test_projection_of_a_migrated_song_equals_the_trimmed_legacy_values(seed):
    rng = random.Random(100 + seed)
    for i in range(80):
        song = legacy_song(rng, i)
        want = expected(song)
        credits.ensure(song)
        got = credits.project(song)
        assert got == want, song
        for key in credits.LEGACY_KEYS:
            assert key not in song


@pytest.mark.parametrize("seed", SEEDS)
def test_legacy_input_equal_to_the_projection_leaves_the_song_byte_equal(seed):
    rng = random.Random(200 + seed)
    for i in range(60):
        song = legacy_song(rng, i)
        credits.ensure(song)
        before = dumps(song)
        credits.apply_changes(song, credits.project(song))
        assert dumps(song) == before


@pytest.mark.parametrize("seed", SEEDS)
def test_structure_edits_then_legacy_round_trip_keep_the_structure(seed):
    rng = random.Random(300 + seed)
    for i in range(40):
        song = legacy_song(rng, i)
        credits.ensure(song)
        names = [rng.choice(NAMES) for _ in range(rng.randrange(0, 4))]
        credits.apply_changes(song, {"artists": names, "featured": [rng.choice(NAMES)] if rng.random() < 0.5 else [],
                                     "version": rng.choice([None, {"kind": "remix", "name": "X Remix", "by": ["X"]}, {"kind": "live"}])})
        snapshot = copy.deepcopy(song)
        credits.apply_changes(song, credits.project(song))
        assert song == snapshot


@pytest.mark.parametrize("seed", SEEDS)
def test_never_a_legacy_key_after_any_write_path(seed):
    rng = random.Random(400 + seed)
    for i in range(40):
        song = legacy_song(rng, i)
        credits.ensure(song)
        junk = {k: rng.choice([None, "A - B", "Z Remix", 1999, 2012]) for k in rng.sample(list(credits.LEGACY_KEYS), 2)}
        try:
            credits.apply_changes(song, junk)
        except ValueError:
            continue
        for key in credits.LEGACY_KEYS:
            assert key not in song
