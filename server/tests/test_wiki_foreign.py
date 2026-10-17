import urllib.parse

import pytest

from app import wiki_lookup as wl

BAND = "Форум (группа)"
BAND_URL = "https://ru.wikipedia.org/wiki/" + urllib.parse.quote("Форум_(группа)", safe="_(),!'~*-.:")

CLAIMS = {
    "Q1": {"P31": ["Q2088357", "Q215380"], "P136": ["Q9"]},
    "Q2": {"P31": ["Q4167410"]},
    "Q3": {"P31": ["Q5"], "P106": ["Q177220"]},
    "Q4": {"P31": ["Q134556"], "P175": ["Q1"]},
}


def claim_set(props):
    return {p: [{"rank": "normal", "mainsnak": {"snaktype": "value", "datavalue": {"value": {"id": v} if v.startswith("Q") else v}}} for v in vs] for p, vs in props.items()}


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    for name in ("_infobox_cache", "_search_cache", "_entities", "_qid_of_page", "_foreign_cache", "_claims"):
        monkeypatch.setattr(wl, name, {})


def make_fetch(calls, pages=None, hits=None, claims=CLAIMS, lead=""):
    pages = pages if pages is not None else {"ru": {BAND: "Q1", "Форум": "Q2"}}
    hits = hits if hits is not None else {"ru": ["Форум", BAND]}

    def fetch(url):
        calls.append(url)
        parts = urllib.parse.urlsplit(url)
        q = urllib.parse.parse_qs(parts.query)
        lang = parts.hostname.split(".")[0]
        if "wikidata" in parts.hostname:
            ids = q["ids"][0].split("|")
            return {"entities": {i: {"claims": claim_set(claims[i])} for i in ids if i in claims}}
        if q.get("list") == ["search"]:
            return {"query": {"search": [{"title": t} for t in hits.get(lang, [])]}}
        if q.get("prop") == ["extracts"]:
            return {"query": {"pages": [{"title": q["titles"][0], "extract": lead}]}}
        if q.get("prop") == ["pageprops"]:
            titles = q["titles"][0].split("|")
            known = pages.get(lang, {})
            out = [{"title": t, "pageprops": {"wikibase_item": known[t]}} if t in known else {"title": t, "missing": True} for t in titles]
            return {"query": {"pages": out}}
        raise OSError("not stubbed: " + url)

    return fetch


def hosts(calls):
    return [urllib.parse.urlsplit(u).hostname for u in calls]


def test_prefix_and_quotes_find_the_russian_band_not_the_generic_article(monkeypatch):
    calls = []
    monkeypatch.setattr(wl, "_fetch_json", make_fetch(calls))
    assert wl.find_artist('Группа "Форум"') == BAND_URL


def test_generic_article_alone_is_rejected(monkeypatch):
    monkeypatch.setattr(wl, "_fetch_json", make_fetch([], pages={"ru": {"Форум": "Q2"}}, hits={"ru": ["Форум"]}))
    assert wl.find_artist("Форум") is None


def test_guillemets_and_via_prefix_are_stripped():
    assert wl._wiki_names("ВИА «Самоцветы»", "artist") == ["Самоцветы", "ВИА Самоцветы"]
    assert wl._wiki_names("Вокально-инструментальный ансамбль  “Синяя птица”", "artist")[0] == "Синяя птица"
    assert wl._wiki_names("Группа крови", "artist") == ["Группа крови", "крови"]
    assert wl._wiki_names("Виандра", "artist") == ["Виандра"]


def test_latin_name_makes_no_extra_requests(monkeypatch):
    calls = []
    monkeypatch.setattr(wl, "_fetch_json", make_fetch(calls, hits={}))
    assert wl.find_artist("Some Unknown Band") is None
    assert hosts(calls) == ["en.wikipedia.org"]
    assert wl.find_song("Some Unknown Band", "Some Song", ["Some Unknown Band"]) is None
    assert set(hosts(calls)) == {"en.wikipedia.org"}


def test_failure_returns_none_and_is_not_cached(monkeypatch):
    def boom(url):
        raise OSError("down")

    monkeypatch.setattr(wl, "_fetch_json", boom)
    assert wl.find_artist("Форум") is None
    calls = []
    monkeypatch.setattr(wl, "_fetch_json", make_fetch(calls, pages={"ru": {BAND: "Q1"}}, hits={"ru": [BAND]}))
    assert wl.find_artist("Форум") == BAND_URL


def test_claims_failure_returns_none(monkeypatch):
    monkeypatch.setattr(wl, "_fetch_json", make_fetch([], claims={}))
    assert wl.find_artist("Форум") is None


def test_ukrainian_letters_select_the_ukrainian_edition_first(monkeypatch):
    calls = []
    pages = {"uk": {"Океан Ельзи": "Q1"}}
    monkeypatch.setattr(wl, "_fetch_json", make_fetch(calls, pages=pages, hits={}))
    assert wl.find_artist("Океан Ельзи") == "https://uk.wikipedia.org/wiki/" + urllib.parse.quote("Океан_Ельзи")
    assert wl._wiki_langs("Мої ґанки") == ["uk", "ru"]
    assert wl._wiki_langs("Слова") == ["ru", "uk"]
    assert wl._wiki_langs("Янка Дягілева ў") == ["be", "ru"]
    assert wl._wiki_langs("Haddaway") == []
    calls.clear()
    monkeypatch.setattr(wl, "_foreign_cache", {})
    assert wl.find_artist("Їжак") is None
    assert [h for h in hosts(calls) if h.endswith("wikipedia.org") and h != "en.wikipedia.org"][0] == "uk.wikipedia.org"


def test_second_lookup_is_served_from_cache(monkeypatch):
    calls = []
    monkeypatch.setattr(wl, "_fetch_json", make_fetch(calls))
    first = wl.find_artist('Группа "Форум"')
    calls.clear()
    assert wl.find_artist('Группа "Форум"') == first
    assert [h for h in hosts(calls) if h != "en.wikipedia.org"] == []


def test_person_with_music_occupation_qualifies(monkeypatch):
    monkeypatch.setattr(wl, "_fetch_json", make_fetch([], pages={"ru": {"Виктор Цой": "Q3"}}, hits={"ru": ["Виктор Цой"]}))
    assert wl.find_artist("Виктор Цой") == "https://ru.wikipedia.org/wiki/" + urllib.parse.quote("Виктор_Цой")


def test_song_needs_a_music_work_item_and_the_artist_in_the_lead(monkeypatch):
    title = "Что сравнится с юностью (Отпустите, мамы)"
    pages = {"ru": {"Что сравнится с юностью": "Q4"}}
    hits = {"ru": ["Что сравнится с юностью"]}
    monkeypatch.setattr(wl, "_fetch_json", make_fetch([], pages=pages, hits=hits, lead="«Что сравнится с юностью» — песня группы «Форум»."))
    assert wl.find_song("Форум", title, ["Форум"]) == "https://ru.wikipedia.org/wiki/" + urllib.parse.quote("Что_сравнится_с_юностью")
    monkeypatch.setattr(wl, "_foreign_cache", {})
    monkeypatch.setattr(wl, "_fetch_json", make_fetch([], pages=pages, hits=hits, lead="Песня группы «Кино»."))
    assert wl.find_song("Форум", title, ["Форум"]) is None


def test_album_is_found_with_its_suffix(monkeypatch):
    pages = {"ru": {"Белая ночь (альбом)": "Q5"}}
    claims = {**CLAIMS, "Q5": {"P31": ["Q482994"]}}
    monkeypatch.setattr(wl, "_fetch_json", make_fetch([], pages=pages, hits={}, claims=claims, lead="«Белая ночь» — альбом группы «Форум»."))
    assert wl.find_album("Форум", "Белая ночь", ["Форум"]) == "https://ru.wikipedia.org/wiki/" + urllib.parse.quote("Белая_ночь_(альбом)", safe="_(),!'~*-.:")
