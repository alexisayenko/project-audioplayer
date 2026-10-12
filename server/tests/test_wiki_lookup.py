import pytest
from fastapi.testclient import TestClient

from app import extractor, genre_lookup as gl, library, main, wiki_lookup as wl

H = {"X-API-Token": "secret"}
VID = "dQw4w9WgXcQ"
REC = {"id": "r1", "score": 100, "artist-credit": [{"name": "Daft Punk", "artist": {"id": "a1", "name": "Daft Punk"}}]}


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(gl.time, "sleep", lambda s: None)
    monkeypatch.delenv("AUDIO_GENRE_LOOKUP", raising=False)
    monkeypatch.delenv("AUDIO_TAG_LOOKUP", raising=False)


def urlrel(kind, url):
    return {"type": kind, "url": {"resource": url}}


def claim(value, rank="normal"):
    return {"rank": rank, "mainsnak": {"snaktype": "value", "datavalue": {"value": value}}}


def item(qid):
    return claim({"entity-type": "item", "id": qid})


def date(year, precision=11):
    return claim({"time": f"+{year}-01-01T00:00:00Z", "precision": precision})


SONG = {
    "claims": {"P136": [item("Q1"), item("Q2")], "P407": [item("Q10")], "P577": [date(1997)]},
    "sitelinks": {"enwiki": {"title": "Around the World (Daft Punk song)", "url": "https://en.wikipedia.org/wiki/Around_the_World_(Daft_Punk_song)"}},
}
ARTIST = {
    "claims": {"P136": [item("Q3"), item("Q1")], "P495": [item("Q20")], "P571": [date(1993)]},
    "sitelinks": {"dewiki": {"title": "Daft Punk", "url": "https://de.wikipedia.org/wiki/Daft_Punk"}},
}
ENTITIES = {"Q100": SONG, "Q200": ARTIST}
LABELS = {"Q1": "House Music", "Q2": "electronic", "Q3": "Disco", "Q4": "Funk"}
CLAIMS = {
    "Q10": {"P218": [claim("fr")]},
    "Q20": {"P297": [claim("FR")]},
    "Q30": {"P17": [item("Q20")]},
    "Q11": {"P220": [claim("eng")]},
}


def fake_fetch(calls=None, entities=None, labels=None, claims=None, pages=None):
    entities = ENTITIES if entities is None else entities
    labels = LABELS if labels is None else labels
    claims = CLAIMS if claims is None else claims
    pages = {} if pages is None else pages

    def _fetch(url):
        if calls is not None:
            calls.append(url)
        if "Special:EntityData/" in url:
            q = url.rsplit("/", 1)[1][:-5]
            if q not in entities:
                raise OSError("404")
            return {"entities": {q: entities[q]}}
        if "wbgetentities" in url:
            ids = url.split("ids=")[1].split("&")[0].replace("%7C", "|").split("|")
            if "props=labels" in url:
                return {"entities": {i: {"labels": {"en": {"value": labels[i]}}} for i in ids if i in labels}}
            return {"entities": {i: {"claims": claims.get(i, {})} for i in ids}}
        if "prop=pageprops" in url:
            for title, q in pages.items():
                if f"titles={title}" in url:
                    return {"query": {"pages": {"1": {"pageprops": {"wikibase_item": q}}}}}
            return {"query": {"pages": {"-1": {"missing": ""}}}}
        raise AssertionError(url)

    return _fetch


def fake_mb(rec_full=None, artist_full=None, work_full=None, calls=None):
    def _get(path, params):
        if calls is not None:
            calls.append((path, params.get("inc")))
        if path == "recording/":
            return {"recordings": [REC]}
        if path.startswith("recording/"):
            return rec_full or {}
        if path.startswith("work/"):
            return work_full or {}
        return artist_full or {}

    return _get


def test_clean_link_host_validation():
    ok = wl.clean_link
    assert ok(" https://en.wikipedia.org/wiki/Daft_Punk ") == "https://en.wikipedia.org/wiki/Daft_Punk"
    assert ok("http://de.wikipedia.org/wiki/Daft_Punk") == "https://de.wikipedia.org/wiki/Daft_Punk"
    assert ok("https://en.wikipedia.org/wiki/AC/DC") == "https://en.wikipedia.org/wiki/AC/DC"
    assert ok("https://en.m.wikipedia.org/wiki/Daft_Punk") == "https://en.m.wikipedia.org/wiki/Daft_Punk"
    assert ok("https://www.wikidata.org/wiki/Q42?uselang=en") == "https://www.wikidata.org/wiki/Q42"
    assert ok("https://wikidata.org/wiki/Q42") == "https://www.wikidata.org/wiki/Q42"
    for bad in (
        None, 5, "", "  ", "javascript:alert(1)", "https://evil.example/wiki/X",
        "https://en.wikipedia.org.evil.example/wiki/X", "https://evil.example/?u=https://en.wikipedia.org/wiki/X",
        "https://wikipedia.org/wiki/X", "https://en.wikipedia.org/w/index.php?title=X", "https://en.wikipedia.org/",
        "https://www.wikidata.org/wiki/Special:Random", "https://www.wikidata.org/wiki/P31",
        "https://user@en.wikipedia.org/wiki/X", "ftp://en.wikipedia.org/wiki/X", "https://en.wikipedia.org:8443/wiki/X",
        "https://en.wikipedia.org:bad/wiki/X",
    ):
        assert ok(bad) is None, bad


def test_pick_prefers_english_then_any_then_sitelink(monkeypatch):
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch())
    de, en = "https://de.wikipedia.org/wiki/X", "https://en.wikipedia.org/wiki/X"
    assert wl._pick([de, en]) == (en, None)
    assert wl._pick([de]) == (de, None)
    assert wl._pick(["https://evil.example/wiki/X"]) == (None, None)
    assert wl._pick(["https://www.wikidata.org/wiki/Q100"]) == (SONG["sitelinks"]["enwiki"]["url"], "Q100")
    assert wl._pick(["https://www.wikidata.org/wiki/Q200"]) == ("https://de.wikipedia.org/wiki/Daft_Punk", "Q200")
    assert wl._pick([de, "https://www.wikidata.org/wiki/Q100"]) == (de, "Q100")


def test_pick_keeps_wikidata_url_when_no_sitelink(monkeypatch):
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(entities={"Q9": {"sitelinks": {"commonswiki": {"title": "x"}}}}))
    assert wl._pick(["https://www.wikidata.org/wiki/Q9"]) == ("https://www.wikidata.org/wiki/Q9", "Q9")
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(entities={}))
    wl._entities.clear()
    assert wl._pick(["https://www.wikidata.org/wiki/Q9"]) == ("https://www.wikidata.org/wiki/Q9", "Q9")


def test_sitelink_built_from_title_without_url(monkeypatch):
    ent = {"Q5": {"sitelinks": {"frwiki": {"title": "Les Rois du Monde"}}}}
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(entities=ent))
    assert wl.sitelink("Q5") == "https://fr.wikipedia.org/wiki/Les_Rois_du_Monde"


def test_qid_of_page_via_pageprops(monkeypatch):
    calls = []
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(calls, pages={"Daft+Punk": "Q200"}))
    assert wl.qid_of_page("https://en.wikipedia.org/wiki/Daft_Punk") == "Q200"
    assert wl.qid_of_page("https://en.wikipedia.org/wiki/Daft_Punk") == "Q200"
    assert len(calls) == 1 and calls[0].startswith("https://en.wikipedia.org/w/api.php?") and "wikibase_item" in calls[0]
    assert wl.qid_of_page("https://en.wikipedia.org/wiki/Nope") is None
    assert wl.qid_of_page("https://www.wikidata.org/wiki/Q7") == "Q7"
    assert wl.qid_of_page("https://evil.example/wiki/X") is None


def test_facts_mapping(monkeypatch):
    calls = []
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(calls))
    out = wl.facts("Q100", "Q200")
    assert out == {"tags": ["genre:house music", "genre:electronic", "genre:disco", "country:fr", "lang:fr"], "year": 1997}
    label_calls = [c for c in calls if "props=labels" in c]
    assert len(label_calls) == 1 and "languages=en" in label_calls[0]


def test_facts_cache_by_qid(monkeypatch):
    calls = []
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(calls))
    wl.facts("Q100", "Q200")
    n = len(calls)
    wl.facts("Q100", "Q200")
    assert len(calls) == n


def test_country_fallbacks(monkeypatch):
    ents = {
        "QA": {"claims": {"P27": [item("Q20")]}},
        "QB": {"claims": {"P740": [item("Q30")]}},
        "QC": {"claims": {}},
        "QS": {"claims": {"P495": [item("Q20")]}},
    }
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(entities=ents))
    assert wl.facts(None, "QA")["tags"] == ["country:fr"]
    assert wl.facts(None, "QB")["tags"] == ["country:fr"]
    assert wl.facts("QS", "QC")["tags"] == ["country:fr"]


def test_language_639_3_fallback_and_cap(monkeypatch):
    ents = {"QS": {"claims": {"P407": [item("Q10"), item("Q11"), item("Q10")]}}}
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(entities=ents))
    assert wl.facts("QS", None)["tags"] == ["lang:fr", "lang:en"]


def test_year_rules(monkeypatch):
    ents = {
        "QS": {"claims": {"P577": [date(2001), date(1999), date(1990, 7)]}},
        "QD": {"claims": {"P577": [claim("x", rank="deprecated")]}},
        "QA": {"claims": {"P571": [date(1993)]}},
    }
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(entities=ents))
    assert wl.facts("QS", None)["year"] == 1999
    assert wl.facts("QD", None)["year"] is None
    assert wl.facts(None, "QA")["year"] is None


def test_preferred_rank_wins(monkeypatch):
    ents = {"QS": {"claims": {"P577": [date(1990), date(1995)]}}}
    ents["QS"]["claims"]["P577"][1]["rank"] = "preferred"
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(entities=ents))
    assert wl.facts("QS", None)["year"] == 1995


def test_genre_cap_three(monkeypatch):
    ents = {"QS": {"claims": {"P136": [item("Q1"), item("Q2"), item("Q3"), item("Q4")]}}}
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(entities=ents))
    assert wl.facts("QS", None)["tags"] == ["genre:house music", "genre:electronic", "genre:disco"]


def test_failures_give_nothing(monkeypatch):
    def boom(url):
        raise OSError("down")

    monkeypatch.setattr(wl, "_fetch_json", boom)
    assert wl.facts("Q100", "Q200") == {"tags": [], "year": None}
    assert wl.from_links("https://en.wikipedia.org/wiki/X", None) == {"tags": [], "year": None}
    monkeypatch.setattr(gl, "_get", fake_mb({}, {}))
    assert wl.suggest("Daft Punk", "X")["tags"] == []


def test_labels_failure_keeps_other_facts(monkeypatch):
    base = fake_fetch()

    def partial(url):
        if "props=labels" in url:
            raise OSError("down")
        return base(url)

    monkeypatch.setattr(wl, "_fetch_json", partial)
    assert wl.facts("Q100", "Q200") == {"tags": ["country:fr", "lang:fr"], "year": 1997}


def test_suggest_from_musicbrainz_relations(monkeypatch):
    calls = []
    rec = {
        "first-release-date": "1997-03-17",
        "relations": [urlrel("wikidata", "https://www.wikidata.org/wiki/Q100"), urlrel("official homepage", "https://x.y")],
    }
    art = {"relations": [urlrel("wikipedia", "https://de.wikipedia.org/wiki/Daft_Punk"), urlrel("wikidata", "https://www.wikidata.org/wiki/Q200")]}
    monkeypatch.setattr(gl, "_get", fake_mb(rec, art, calls=calls))
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch())
    out = wl.suggest("Daft Punk", "Around the World")
    assert out["wikipedia_song"] == "https://en.wikipedia.org/wiki/Around_the_World_(Daft_Punk_song)"
    assert out["wikipedia_artist"] == "https://de.wikipedia.org/wiki/Daft_Punk"
    assert out["year"] == 1997 and "country:fr" in out["tags"]
    assert ("recording/r1", "genres+tags+work-rels+url-rels") in calls
    assert ("artist/a1", "genres+tags+url-rels") in calls


def test_suggest_uses_work_relations_when_recording_has_none(monkeypatch):
    calls = []
    rec = {"relations": [{"type": "performance", "work": {"id": "w1", "languages": ["fra"]}}]}
    work = {"relations": [urlrel("wikipedia", "https://en.wikipedia.org/wiki/Around_the_World")]}
    monkeypatch.setattr(gl, "_get", fake_mb(rec, {}, work, calls))
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(pages={"Around+the+World": "Q100"}))
    out = wl.suggest("Daft Punk", "Around the World")
    assert out["wikipedia_song"] == "https://en.wikipedia.org/wiki/Around_the_World"
    assert out["year"] == 1997
    assert ("work/w1", "url-rels") in calls


def test_year_falls_back_to_musicbrainz_first_release(monkeypatch):
    rec = {"first-release-date": "1997-03", "relations": []}
    monkeypatch.setattr(gl, "_get", fake_mb(rec, {}))
    assert wl.suggest("Daft Punk", "X")["year"] == 1997


def test_suggest_disabled(monkeypatch):
    monkeypatch.setenv("AUDIO_TAG_LOOKUP", "0")
    monkeypatch.setattr(wl, "_fetch_json", lambda u: pytest.fail("called"))
    assert wl.suggest("Daft Punk", "X") == {"wikipedia_song": None, "wikipedia_artist": None, "tags": [], "year": None}
    assert wl.from_links("https://en.wikipedia.org/wiki/X", None) == {"tags": [], "year": None}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(main, "DOWNLOAD_DIR", tmp_path / "downloads")
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "JOBS", {})

    def fake_download(video_id, out_dir, progress=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{video_id}.m4a").write_bytes(b"audio")
        return {"id": video_id, "title": "Yt", "artist": "A", "duration": 7}

    monkeypatch.setattr(extractor, "download_audio", fake_download)
    monkeypatch.setattr(extractor, "fetch_cover", lambda v, d: None)
    monkeypatch.setattr(main.bpm_detect, "detect_bpm", lambda p: 100.0)
    monkeypatch.setattr(
        extractor, "preview",
        lambda vid: {"id": vid, "source_url": extractor.watch_url(vid), "title": "Around the World", "artist": "Daft Punk",
                     "album": None, "year": None, "tags": [], "duration": 9, "thumbnail": ""},
    )
    return TestClient(main.app)


def test_preview_returns_links_tags_and_year(client, monkeypatch):
    rec = {"relations": [urlrel("wikidata", "https://www.wikidata.org/wiki/Q100")]}
    art = {"relations": [urlrel("wikipedia", "https://en.wikipedia.org/wiki/Daft_Punk"), urlrel("wikidata", "https://www.wikidata.org/wiki/Q200")]}
    monkeypatch.setattr(gl, "_get", fake_mb(rec, art))
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch())
    body = client.post("/preview", json={"url": VID}, headers=H).json()
    assert body["wikipedia_song"].endswith("Around_the_World_(Daft_Punk_song)")
    assert body["wikipedia_artist"] == "https://en.wikipedia.org/wiki/Daft_Punk"
    assert body["suggested_year"] == 1997 and body["year"] == 1997
    assert body["tags"] == ["genre:house music", "genre:electronic", "genre:disco", "country:fr", "lang:fr"]


def test_preview_survives_total_failure(client):
    body = client.post("/preview", json={"url": VID}, headers=H).json()
    assert body["wikipedia_song"] is None and body["wikipedia_artist"] is None
    assert body["tags"] == [] and body["suggested_year"] is None


def test_preview_keeps_existing_year(client, monkeypatch):
    monkeypatch.setattr(extractor, "preview", lambda vid: {"id": vid, "title": "T", "artist": "A", "year": 2010, "tags": []})
    monkeypatch.setattr(gl, "_get", fake_mb({"first-release-date": "1997-01-01"}, {}))
    body = client.post("/preview", json={"url": VID}, headers=H).json()
    assert body["year"] == 2010 and body["suggested_year"] == 1997


def test_post_songs_persists_and_validates_links(client):
    meta = {"title": "S", "wikipedia_song": "https://en.wikipedia.org/wiki/Song", "wikipedia_artist": "https://evil.example/wiki/Band"}
    assert client.post("/songs", json={"url": VID, "metadata": meta, "tags": []}, headers=H).status_code == 202
    song = client.get("/library", headers=H).json()["songs"][0]
    assert song["wikipedia_song"] == "https://en.wikipedia.org/wiki/Song"
    assert song["wikipedia_artist"] is None


def test_patch_sets_clears_and_drops_links(client):
    client.post("/songs", json={"url": VID, "metadata": {"title": "S"}, "tags": []}, headers=H)
    url = f"/songs/{VID}"
    r = client.patch(url, json={"wikipedia_song": "https://www.wikidata.org/wiki/Q100", "wikipedia_artist": "https://de.wikipedia.org/wiki/Daft_Punk"}, headers=H)
    assert r.json()["wikipedia_song"] == "https://www.wikidata.org/wiki/Q100"
    assert r.json()["wikipedia_artist"] == "https://de.wikipedia.org/wiki/Daft_Punk"
    r = client.patch(url, json={"title": "Renamed"}, headers=H)
    assert r.json()["wikipedia_artist"] == "https://de.wikipedia.org/wiki/Daft_Punk"
    r = client.patch(url, json={"wikipedia_song": None, "wikipedia_artist": "https://evil.example/x"}, headers=H)
    assert r.json()["wikipedia_song"] is None and r.json()["wikipedia_artist"] is None
    assert client.get("/library", headers=H).json()["songs"][0]["wikipedia_artist"] is None


def test_old_records_load_with_null_links(tmp_path):
    path = tmp_path / "library.json"
    path.write_text('{"songs":[{"id":"%s","title":"Old","wikipedia_song":"https://evil.example/x"}]}' % VID, encoding="utf-8")
    song = library.load(path)[0]
    assert song["wikipedia_song"] is None and song["wikipedia_artist"] is None


def test_lookup_endpoint(client, monkeypatch):
    monkeypatch.setattr(wl, "_fetch_json", fake_fetch(pages={"Around+the+World+%28Daft+Punk+song%29": "Q100"}))
    body = {"wikipedia_song": "https://en.wikipedia.org/wiki/Around_the_World_(Daft_Punk_song)", "wikipedia_artist": "https://www.wikidata.org/wiki/Q200"}
    r = client.post("/lookup/wikipedia", json=body, headers=H)
    assert r.status_code == 200
    assert r.json() == {"tags": ["genre:house music", "genre:electronic", "genre:disco", "country:fr", "lang:fr"], "year": 1997}


def test_lookup_endpoint_empty_bad_and_failing(client):
    assert client.post("/lookup/wikipedia", json={}, headers=H).json() == {"tags": [], "year": None}
    bad = {"wikipedia_song": "https://evil.example/wiki/X", "wikipedia_artist": ""}
    assert client.post("/lookup/wikipedia", json=bad, headers=H).json() == {"tags": [], "year": None}
    ok = {"wikipedia_song": "https://en.wikipedia.org/wiki/X"}
    assert client.post("/lookup/wikipedia", json=ok, headers=H).json() == {"tags": [], "year": None}
    assert client.post("/lookup/wikipedia", json={}).status_code == 401
