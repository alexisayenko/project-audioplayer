import json
from pathlib import Path

import pytest

from app import titleclean
from app.titleclean import clean, clean_ex

CASES = json.loads((Path(__file__).parent / "fixtures" / "title_clean_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("raw,want", CASES)
def test_table(raw, want):
    assert clean(raw) == want


@pytest.mark.parametrize("raw,want", CASES)
def test_idempotent(raw, want):
    assert clean(clean(raw)) == clean(raw)


def test_enough_cases():
    assert len(CASES) >= 40


def test_removed_pieces():
    assert clean_ex("De Hofnar - Zonnestraal [Free Download]") == ("De Hofnar - Zonnestraal", ["[Free Download]"])
    assert clean_ex("Song") == ("Song", [])


def test_never_empty():
    assert clean_ex("[Free Download]") == ("[Free Download]", [])


def test_preview_fields(monkeypatch):
    from app import main
    assert main._clean_preview_title({"title": "A - B [Free Download]"}) == {"title": "A - B", "title_raw": "A - B [Free Download]"}


def test_lookup_title_uses_it():
    from app.titles import lookup_title
    assert lookup_title("Song [Free Download]") == "Song"
    assert titleclean.clean("Song (Live) [HD]") == "Song (Live)"
