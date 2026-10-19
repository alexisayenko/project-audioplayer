"""ADR-0030: the `parents` lists reproduce the old parent/also_under/also_in_genres data exactly.

`fixtures/genre_parents_snapshot_server.json` was taken from the data and code at commit 78b3457, before the change, and holds the old fields of every vocabulary row and every levels entry.
The two data edits of 2026-10-19 that came after it (spacesynth, space disco) are listed in EDITED and are the only expected differences.
"""

import json
from pathlib import Path

from app import genre_vocab

SNAP = json.loads((Path(__file__).parent / "fixtures" / "genre_parents_snapshot_server.json").read_text(encoding="utf-8"))
EDITED = {"spacesynth", "space disco"}


def payload():
    genre_vocab.reset()
    return genre_vocab.vocabulary()


def old_fields(entry, families):
    """The old `parent`, `also_under`, `also_in_genres` of a levels entry, recovered from its parents list."""
    first, rest = entry["parents"][0], entry["parents"][1:]
    return {
        "family": entry["family"],
        "parent": None if first in families else first,
        "also_under": [p for p in rest if p not in families],
        "also_in_genres": [p for p in rest if p in families],
    }


def test_levels_entries_match_the_snapshot_taken_before_the_change():
    body = payload()
    families = set(body["families"])
    assert set(body["levels"]) - set(SNAP["levels"]) == {"space disco"}
    assert set(SNAP["levels"]) <= set(body["levels"])
    for name, old in SNAP["levels"].items():
        if name in EDITED:
            continue
        assert old_fields(body["levels"][name], families) == old, name


def test_the_two_data_edits_of_2026_10_19():
    levels = payload()["levels"]
    assert (levels["spacesynth"]["parents"], levels["spacesynth"]["level"], levels["spacesynth"]["status"]) == (["synthwave", "italo disco"], 3, "approved")
    sd = levels["space disco"]
    assert (sd["parents"], sd["family"], sd["level"], sd["discogs"], sd["status"], sd["display"], sd["synonyms"]) == (["disco"], "Electronic", 3, False, "approved", "Space Disco", ["space-disco"])


def test_vocabulary_rows_match_the_snapshot_taken_before_the_change():
    body = payload()
    families = set(body["families"])
    rows = {r["name"]: r for r in body["genres"]}
    assert set(rows) - set(SNAP["rows"]) == {"space disco"}
    for name, old in SNAP["rows"].items():
        if name in EDITED:
            continue
        row = rows[name]
        assert (row["family"], row["level"], row["extra"]) == (old["family"], old["level"], old["extra"]), name
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
