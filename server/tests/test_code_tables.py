import json
import re
from pathlib import Path

import pytest

from app import countrycodes as cc
from app import langcodes as lc

WEB = Path(__file__).resolve().parents[2] / "web" / "js" / "countries-data.js"


def _literal(text, name):
    m = re.search(rf"export const {name} = (\{{.*?\}}|\[.*?\]);", text, re.S)
    assert m, f"{name} not found"
    return json.loads(m.group(1))


def test_every_country_code_is_two_lowercase_letters_with_a_name():
    assert len(cc.NAMES) > 240
    for code, name in cc.NAMES.items():
        assert re.fullmatch(r"[a-z]{2}", code)
        assert name.strip() == name
        assert name


def test_alpha3_codes_are_unique_and_well_formed():
    rows = [r.split("|") for r in (cc._ROWS + cc._HISTORICAL_ROWS).splitlines() if r.strip()]
    a3 = [r[1] for r in rows]
    assert all(re.fullmatch(r"[A-Z]{3}", x) for x in a3)
    assert len(a3) == len(set(a3))
    assert len([r[0] for r in rows]) == len({r[0] for r in rows})
    assert all(len(r) in (3, 4) for r in rows)


def test_every_alias_resolves_to_a_known_code():
    assert set(cc._LOOKUP.values()) <= cc.CODES
    for key, code in cc._LOOKUP.items():
        assert cc.canonical_country(key) == code


def test_no_alias_claims_two_different_countries():
    claims = {}
    for rows in (cc._ROWS, cc._HISTORICAL_ROWS):
        for row in rows.strip().splitlines():
            p = row.split("|")
            for k in (p[0], p[1], p[2], *(p[3].split(",") if len(p) > 3 else [])):
                claims.setdefault(cc._norm(k), set()).add(p[0])
    conflicts = {k: v for k, v in claims.items() if len(v) > 1}
    assert not conflicts, conflicts


@pytest.mark.parametrize("value,code", [
    ("US", "us"), ("usa", "us"), ("United States", "us"), ("The Netherlands", "nl"), ("  germany ", "de"), ("DEU", "de"),
    ("Côte d'Ivoire", "ci"), ("ussr", "su"), ("su", "su"), ("U.S.S.R.", "su"),
])
def test_country_lookup_is_normalised(value, code):
    assert cc.canonical_country(value) == code


@pytest.mark.parametrize("value", ["", "  ", None, "Atlantis", "xx", "zz", "Narnia", "u", "united", "1", "\u0000"])
def test_unknown_countries_are_rejected(value):
    assert cc.canonical_country(value) is None


def test_only_su_is_historical():
    assert cc.is_historical("su")
    assert cc.is_historical("SU")
    assert not cc.is_historical("us")
    assert not cc.is_historical("")
    assert not cc.is_historical(None)
    assert [c for c in cc.NAMES if cc.is_historical(c)] == ["su"]


def test_norm_strips_diacritics_punctuation_and_the():
    assert cc._norm("The  Gambia") == "gambia"
    assert cc._norm("St. Kitts-Nevis") == "st kitts nevis"
    assert cc._norm("Åland") == "aland"


@pytest.fixture(scope="module")
def web():
    if not WEB.is_file():
        pytest.skip("web/js/countries-data.js not present")
    return WEB.read_text(encoding="utf-8")


def test_web_country_names_match_server(web):
    assert _literal(web, "COUNTRY_NAMES") == cc.NAMES


def test_web_country_aliases_match_server(web):
    assert _literal(web, "COUNTRY_ALIASES") == cc._LOOKUP


def test_web_historical_list_matches_server(web):
    assert _literal(web, "HISTORICAL_COUNTRIES") == sorted(c for c in cc.NAMES if cc.is_historical(c))


# ---- languages -----------------------------------------------------------------------

def test_iso3_table_maps_to_two_letter_codes_without_duplicates():
    for three, two in lc.ISO3_TO_1.items():
        assert re.fullmatch(r"[a-z]{3}", three)
        assert re.fullmatch(r"[a-z]{2}", two)
        assert three not in lc.IGNORED
    assert len(set(lc.ISO3_TO_1)) == len(lc.ISO3_TO_1)


def test_every_language_name_maps_to_a_code_that_has_a_row():
    rows = {line.split()[0] for line in lc._NAMES.strip().splitlines()}
    assert set(lc.NAME_TO_1.values()) <= rows
    for line in lc._NAMES.strip().splitlines():
        code, *names = line.split()
        assert re.fullmatch(r"[a-z]{2}", code)
        for n in names:
            assert lc.canonical_lang(n) == lc.NAME_TO_1[n.casefold()]


def test_no_language_alias_is_claimed_by_two_codes():
    claims = {}
    for line in lc._NAMES.strip().splitlines():
        code, *names = line.split()
        for n in names:
            claims.setdefault(n.casefold(), set()).add(code)
    assert {k: v for k, v in claims.items() if len(v) > 1} == {}


@pytest.mark.parametrize("raw,expected", [
    ("en", "en"), ("EN", "en"), ("eng", "en"), ("en-GB", "en"), ("pt_BR", "pt"), ("Russian", "ru"), ("русский", "ru"), ("日本語", "ja"),
    ("deu", "de"), ("xyz", "xyz"), ("tlh", "tlh"),
])
def test_canonical_lang_accepts(raw, expected):
    assert lc.canonical_lang(raw) == expected


@pytest.mark.parametrize("raw", ["", "  ", None, "und", "mul", "zxx", "mis", "e", "12", "klingon language", "en-", "english-ish"])
def test_canonical_lang_rejects(raw):
    assert lc.canonical_lang(raw) is None
