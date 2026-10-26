import json
import time
from pathlib import Path

import pytest

from app import tracklist

FIXTURES = Path(__file__).parent / "fixtures"
CASES = json.loads((FIXTURES / "tracklist_cases.json").read_text(encoding="utf-8"))
REFERENCE = (FIXTURES / "tracklist_reference.txt").read_text(encoding="utf-8")


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_cases(case):
    got = tracklist.parse_tracklist(case["text"], case["duration"])
    assert len(got.tracks) == len(case["tracks"])
    for track, want in zip(got.tracks, case["tracks"]):
        for key, value in want.items():
            assert getattr(track, key) == value, (track.raw_line, key)
    assert got.warnings == case.get("warnings", [])


def test_indexes_are_zero_based_and_raw_line_is_kept():
    got = tracklist.parse_tracklist("0:00 A - One\n3:00 B - Two", 600)
    assert [t.index for t in got.tracks] == [0, 1]
    assert got.tracks[1].raw_line == "3:00 B - Two"


def test_reference_fixture():
    got = tracklist.parse_tracklist(REFERENCE, 5861)
    starts = [0, 505, 1031, 1374, 1822, 2280, 2768, 3191, 3583, 4001, 4469, 4955, 5408]
    assert [t.start for t in got.tracks] == starts
    assert [t.end for t in got.tracks] == [*starts[1:], 5861]
    assert [t.track_no for t in got.tracks] == list(range(1, 14))
    assert got.warnings == []
    by_no = {t.track_no: t for t in got.tracks}
    assert by_no[2].artists == ["Offlabel"]
    assert by_no[2].title == "X-Plora"
    assert by_no[4].artists == ["Guwanej", "Rustlerfari"]
    assert by_no[5].artists == ["Immanu-El", "Nioka"]
    assert by_no[8].artists == ["San and Tac"]
    assert by_no[8].warnings == ["Check the artist"]
    assert by_no[9].artists == ["Teorema"]
    assert by_no[9].title == "If"
    assert by_no[10].artists == ["Eeriegeist", "Astronom"]
    assert by_no[11].artists == ["Klaada", "Blastbit"]
    assert by_no[12].artists == ["Shanti"]
    assert by_no[12].title == "Wychwood Haunted"
    assert by_no[13].artists == ["Bocara", "Blend"]
    assert sum(1 for t in got.tracks if t.warnings) == 1


def test_more_than_two_hundred_lines_are_capped():
    text = "\n".join(f"{i // 60}:{i % 60:02d} A - T{i}" for i in range(250))
    got = tracklist.parse_tracklist(text, 10000)
    assert len(got.tracks) == tracklist.MAX_TRACKS
    assert got.warnings == [tracklist.W_CAPPED]


def test_empty_and_none_text():
    assert tracklist.parse_tracklist("", 100).tracks == []
    assert tracklist.parse_tracklist(None, 100).warnings == [tracklist.W_NOT_LIST]


def test_hostile_input_is_linear():
    started = time.perf_counter()
    for text in ("0:00 " + " " * 50000 + "x", "1." * 20000, "(" * 20000 + "3:00", "0:00 " + "a & " * 20000, "[" + " " * 50000):
        tracklist.parse_tracklist(f"{text}\n3:00 B - Two", 600)
    assert time.perf_counter() - started < 5


def test_chapters_become_tracks():
    chapters = [
        {"start_time": 0, "end_time": 180, "title": "01. Artist A - Title A"},
        {"start_time": 180, "end_time": 400, "title": "Artist B - Title B (C Remix)"},
        {"start_time": 400, "end_time": 590, "title": "Intro"},
    ]
    got = tracklist.from_chapters(chapters, 600)
    assert [t.start for t in got.tracks] == [0, 180, 400]
    assert [t.end for t in got.tracks] == [180, 400, 600]
    assert got.tracks[0].artists == ["Artist A"]
    assert got.tracks[0].track_no == 1
    assert got.tracks[1].version == "C Remix"
    assert got.tracks[2].artists == []
    assert got.tracks[2].title == "Intro"


def test_chapters_without_duration_end_at_the_last_chapter():
    chapters = [{"start_time": 0, "end_time": 100, "title": "A - One"}, {"start_time": 100, "end_time": 250, "title": "B - Two"}]
    assert [t.end for t in tracklist.from_chapters(chapters, None).tracks] == [100, 250]


def test_chapters_skip_bad_items_and_need_two():
    assert tracklist.from_chapters([], 100).warnings == [tracklist.W_NOT_LIST]
    assert tracklist.from_chapters([{"title": "x"}, "x", {"start_time": True, "title": "y"}, {"start_time": 0, "title": "A - One"}], 100).tracks == []
    assert tracklist.from_chapters(None, 100).tracks == []


def test_chapters_flag_order_and_end():
    chapters = [{"start_time": 0, "title": "A - One"}, {"start_time": 50, "title": "B - Two"}, {"start_time": 40, "title": "C - Three"}, {"start_time": 900, "title": "D - Four"}]
    got = tracklist.from_chapters(chapters, 600)
    assert got.tracks[2].warnings == [tracklist.W_ORDER]
    assert got.tracks[3].warnings == [tracklist.W_PAST_END]
    assert got.tracks[1].end == 600


def test_rows_are_plain_dicts():
    got = tracklist.parse_tracklist("0:00 A feat. B - One\n3:00 C - Two", 600)
    first = tracklist.rows(got.tracks)[0]
    assert first["artists"] == ["A"]
    assert first["featured"] == ["B"]
    assert first["end"] == 180
