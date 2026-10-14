import pytest

from app import acoustid_lookup as ac
from app import discogs_lookup as dl
from app import genre_lookup as gl
from app import identify, users, wiki_lookup
from tests.test_library import ADIR, H, VID, VID2, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who, add as add_as, uid  # noqa: F401

MBID = "11111111-1111-1111-1111-111111111111"
MB_URL = f"https://musicbrainz.org/recording/{MBID}"


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    identify._cache.clear()
    gl._rec_cache.clear()
    dl._cache.clear()
    for name in ("ACOUSTID_API_KEY", "DISCOGS_TOKEN", "ACOUSTID_MIN_SCORE", "AUDIO_FPCALC"):
        monkeypatch.delenv(name, raising=False)


def mb_result(**over):
    return {"tags": ["genre:house", "genre:electronic", "country:fr"], "song_rels": [], "artist_rels": [], "year": 1997, "album": "Homework",
            "mb_url": MB_URL, "artist": "Daft Punk", "title": "Around the World", "langs": ["en", "fr", "de"], **over}


def wiki_result(**over):
    return {"wikipedia_song": "https://en.wikipedia.org/wiki/Around_the_World_(Daft_Punk_song)", "wikipedia_artist": "https://en.wikipedia.org/wiki/Daft_Punk",
            "tags": ["genre:french house", "country:fr"], "song_genres": ["house"], "year": None, **over}


def disc_result(**over):
    return {"tags": ["genre:french house", "genre:disco", "country:fr"], "year": 1996, "country": "country:fr", "url": "https://www.discogs.com/release/5",
            "artist": "Daft Punk", "title": "Around the World", **over}


def wire(monkeypatch, *, fp=True, discogs=True, mb=None, wiki=None, disc=None, title_mb=None):
    monkeypatch.setattr(ac, "available", lambda: fp)
    monkeypatch.setattr(dl, "enabled", lambda: discogs)
    monkeypatch.setattr(ac, "identify", lambda path, artist="", title="": {"status": "ok", "match": {"mbid": MBID, "artist": "Daft Punk", "title": "Around the World", "confidence": 0.974}} if fp else {"status": "unavailable", "match": None})
    monkeypatch.setattr(gl, "lookup_recording", lambda mbid, artist="": mb or mb_result())
    monkeypatch.setattr(gl, "lookup", lambda a, t, f=None: title_mb or gl._empty())
    monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, mb=None: wiki or wiki_result())
    monkeypatch.setattr(dl, "suggest", lambda a, t: disc or disc_result())


SONG = {"id": "x", "artist": "daft punk", "title": "around the world"}


def test_unavailable_when_no_source_is_configured(monkeypatch):
    out = identify.run(SONG, None)
    assert out["status"] == "unavailable" and out["available"] == {"acoustid": False, "discogs": False}
    assert out["suggested_tags"] == [] and not identify.configured()


def test_full_merge_priorities_and_caps(monkeypatch):
    wire(monkeypatch)
    out = identify.run(SONG, "x.m4a")
    assert out["status"] == "ok"
    assert out["matched"] == {"artist": "Daft Punk", "title": "Around the World", "confidence": 0.974, "source": "acoustid"}
    assert out["suggested_tags"] == ["genre:french house", "genre:disco", "genre:house", "genre:electronic", "country:fr", "lang:en", "lang:fr"]
    assert out["suggested_year"] == 1997
    assert out["links"] == {"musicbrainz": MB_URL, "discogs": "https://www.discogs.com/release/5",
                            "wikipedia_song": "https://en.wikipedia.org/wiki/Around_the_World_(Daft_Punk_song)", "wikipedia_artist": "https://en.wikipedia.org/wiki/Daft_Punk"}
    assert out["sources"] == ["acoustid", "musicbrainz", "wikidata", "discogs"]


def test_caps_per_namespace_and_dedupe():
    mb = {"tags": ["genre:a", "genre:b", "genre:A", "country:fr", "country:de"], "langs": ["en", "fr", "de"]}
    disc = {"tags": ["genre:c", "genre:d", "genre:e", "country:us"]}
    tags = identify.merge_tags(mb, disc, {})
    assert tags == ["genre:c", "genre:d", "genre:e", "genre:a", "country:fr", "lang:en", "lang:fr"]


def test_non_genres_and_unknown_countries_are_dropped():
    tags = identify.merge_tags({"tags": ["genre:seen live", "country:atlantis", "country:de", "decade:90s"]}, {"tags": ["genre:Trance"]}, {})
    assert tags == ["genre:Trance", "country:de"] or tags == ["genre:trance", "country:de"]


def test_discogs_only_run_without_fingerprint(monkeypatch):
    wire(monkeypatch, fp=False, title_mb=mb_result(langs=[]))
    out = identify.run(SONG, "x.m4a")
    assert out["status"] == "ok" and out["matched"] is None
    assert out["sources"] == ["musicbrainz", "wikidata", "discogs"]
    assert out["suggested_tags"][:2] == ["genre:french house", "genre:disco"]


def test_fingerprint_without_match_falls_back_to_the_title_lookup(monkeypatch):
    wire(monkeypatch, title_mb=mb_result(), disc={})
    monkeypatch.setattr(ac, "identify", lambda path, artist="", title="": {"status": "no_match", "match": None})
    out = identify.run(SONG, "x.m4a")
    assert out["matched"] is None and out["sources"][0] == "musicbrainz" and "acoustid" not in out["sources"]
    assert out["suggested_year"] == 1997


def test_no_match_status_when_nothing_is_found(monkeypatch):
    wire(monkeypatch)
    monkeypatch.setattr(ac, "identify", lambda path, artist="", title="": {"status": "no_match", "match": None})
    monkeypatch.setattr(gl, "lookup", lambda a, t, f=None: gl._empty())
    monkeypatch.setattr(dl, "suggest", lambda a, t: dl._empty())
    out = identify.run(SONG, "x.m4a")
    assert out["status"] == "no_match" and out["suggested_tags"] == [] and out["sources"] == []


def test_a_failing_source_is_skipped(monkeypatch):
    wire(monkeypatch)

    def boom(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(dl, "suggest", boom)
    monkeypatch.setattr(wiki_lookup, "suggest", boom)
    out = identify.run(SONG, "x.m4a")
    assert out["status"] == "ok" and "discogs" not in out["sources"]
    assert out["suggested_tags"][:2] == ["genre:house", "genre:electronic"]


def test_year_priority_wiki_then_musicbrainz_then_discogs(monkeypatch):
    wire(monkeypatch, wiki=wiki_result(year=1995))
    assert identify.run(SONG, "x")["suggested_year"] == 1995
    wire(monkeypatch, mb=mb_result(year=None), wiki=wiki_result(year=None))
    assert identify.run(SONG, "x")["suggested_year"] == 1996


def test_cache_and_cooldown(monkeypatch):
    wire(monkeypatch)
    n = []
    real = identify.run
    monkeypatch.setattr(identify, "run", lambda s, p: n.append(1) or real(s, p))
    identify.run_cached("u", "x", SONG, "p")
    identify.run_cached("u", "x", SONG, "p")
    assert len(n) == 1
    identify._cache[("u", "x")] = (identify._cache[("u", "x")][0] - 100, identify._cache[("u", "x")][1])
    identify.run_cached("u", "x", SONG, "p")
    assert len(n) == 2
    assert identify.recall("u", "x") is not None
    assert identify.recall("u", "x", max_age=-1) is None
    identify.forget("u", "x")
    assert identify.recall("u", "x") is None


def test_cache_expires_after_24_hours(monkeypatch):
    identify.remember("u", "x", {"status": "ok"})
    t0, val = identify._cache[("u", "x")]
    identify._cache[("u", "x")] = (t0 - identify.TTL - 1, val)
    assert identify.recall("u", "x") is None


def test_lookup_recording_derives_the_same_suggestions_as_the_title_lookup(monkeypatch):
    full = {
        "title": "Around the World", "first-release-date": "1997-03-17",
        "artist-credit": [{"name": "Daft Punk", "artist": {"id": "a1", "name": "Daft Punk"}}],
        "genres": [{"name": "house", "count": 5}], "tags": [],
        "relations": [{"type": "wikipedia", "url": {"resource": "https://en.wikipedia.org/wiki/Around_the_World_(Daft_Punk_song)"}}],
        "releases": [
            {"title": "Homework", "date": "1997-01-20", "status": "Official", "artist-credit": [{"name": "Daft Punk"}],
             "release-group": {"primary-type": "Album", "secondary-types": []}, "text-representation": {"language": "eng"}},
            {"title": "Single", "date": "1997-03-01", "text-representation": {"language": "eng"}},
            {"title": "Instr", "text-representation": {"language": "zxx"}},
        ],
    }
    calls = []

    def _get(path, params):
        calls.append(path)
        return full if path.startswith("recording/") else {"country": "FR", "genres": [], "relations": []}

    monkeypatch.setattr(gl, "_get", _get)
    out = gl.lookup_recording(MBID.upper())
    assert out["tags"] == ["genre:house", "country:fr"]
    assert out["year"] == 1997 and out["album"] == "Homework" and out["mb_url"] == MB_URL
    assert out["artist"] == "Daft Punk" and out["title"] == "Around the World" and out["langs"] == ["en"]
    assert out["song_rels"] == ["https://en.wikipedia.org/wiki/Around_the_World_(Daft_Punk_song)"]
    gl.lookup_recording(MBID)
    assert calls == [f"recording/{MBID}", "artist/a1"]


def test_lookup_recording_rejects_bad_ids_and_swallows_errors(monkeypatch):
    def boom(path, params):
        raise OSError("down")

    monkeypatch.setattr(gl, "_get", boom)
    assert gl.lookup_recording("not-an-id")["mb_url"] is None
    assert gl.lookup_recording(MBID)["mb_url"] is None
    monkeypatch.setenv("AUDIO_TAG_LOOKUP", "0")
    assert gl.lookup_recording(MBID)["tags"] == []


def has_audio(client, vid=VID):
    r = client.post("/songs", json={"url": f"https://youtu.be/{vid}", "metadata": {"title": "Song"}, "tags": []}, headers=H)
    assert r.status_code == 202
    return r


def test_endpoint_statuses(client, monkeypatch):
    assert client.post(f"/songs/{VID}/identify", headers=H).status_code == 404
    has_audio(client)
    r = client.get(f"/songs/{VID}/identify", headers=H)
    assert r.json() == {"status": "not_run", "available": {"acoustid": False, "discogs": False}}
    r = client.post(f"/songs/{VID}/identify", headers=H)
    assert r.status_code == 200 and r.json()["status"] == "unavailable"
    wire(monkeypatch)
    out = client.post(f"/songs/{VID}/identify", headers=H).json()
    assert out["status"] == "ok" and out["matched"]["confidence"] == 0.974
    assert client.get(f"/songs/{VID}/identify", headers=H).json()["status"] == "ok"
    assert client.get(f"/songs/{VID}/identify").status_code in (401, 403)
    assert client.post("/songs/short/identify", headers=H).status_code == 422


def test_endpoint_needs_audio_on_the_server(client, monkeypatch):
    wire(monkeypatch)
    client.post("/songs", json={"url": f"https://youtu.be/{VID}", "metadata": {"title": "Song"}, "tags": [], "audio": False}, headers=H)
    r = client.post(f"/songs/{VID}/identify", headers=H)
    assert r.status_code == 404 and r.json()["detail"] == "not downloaded"


def test_suggestions_are_never_applied(client, monkeypatch):
    wire(monkeypatch)
    has_audio(client)
    before = client.get("/library", headers=H).json()
    client.post(f"/songs/{VID}/identify", headers=H)
    assert client.get("/library", headers=H).json() == before


def test_isolation_between_users(multi, monkeypatch):
    wire(monkeypatch)
    a, b = who(multi, ALICE), who(multi, BOB)
    assert add_as(multi, a).status_code == 202
    assert multi.post(f"/songs/{VID}/identify", headers=a).status_code == 200
    assert multi.post(f"/songs/{VID}/identify", headers=b).status_code == 404
    assert multi.get(f"/songs/{VID}/identify", headers=b).status_code == 404
    assert add_as(multi, b).status_code == 202
    assert identify.recall(uid(ALICE), VID) is not identify.recall(uid(BOB), VID)
    assert identify.recall(uid(BOB), VID) is not None and multi.get(f"/songs/{VID}/identify", headers=b).json()["status"] == "ok"


def test_download_triggers_one_background_run_that_costs_no_quota(multi, monkeypatch):
    wire(monkeypatch)
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "2")
    runs = []
    real = identify.run
    monkeypatch.setattr(identify, "run", lambda s, p: runs.append(s["id"]) or real(s, p))
    a = who(multi, ALICE)
    assert add_as(multi, a, VID).status_code == 202
    assert runs == [VID] and identify.recall(uid(ALICE), VID)["status"] == "ok"
    assert add_as(multi, a, VID2).status_code == 202
    assert add_as(multi, a, "abcdefghijk").status_code == 429
    assert multi.post(f"/songs/{VID}/identify", headers=a).status_code == 200


def test_download_skips_the_run_when_both_keys_are_missing(client, monkeypatch):
    ran = []
    monkeypatch.setattr(identify, "run", lambda s, p: ran.append(1))
    has_audio(client)
    assert ran == [] and identify.recall(users.uid_for_email("alex.isayenko@gmail.com"), VID) is None


def test_deleting_a_song_forgets_its_result(client, monkeypatch):
    wire(monkeypatch)
    has_audio(client)
    client.post(f"/songs/{VID}/identify", headers=H)
    client.delete(f"/songs/{VID}", headers=H)
    assert not identify._cache


def test_discogs_url_is_stored_cleaned_and_listed(client):
    url = "https://www.discogs.com/release/123"
    has_audio(client)
    assert client.patch(f"/songs/{VID}", json={"discogs_url": "http://discogs.com/release/123-Some-Title"}, headers=H).json()["discogs_url"] == url
    assert client.patch(f"/songs/{VID}", json={"discogs_url": "https://evil.example/release/1"}, headers=H).json()["discogs_url"] is None
    client.patch(f"/songs/{VID}", json={"discogs_url": url}, headers=H)
    assert client.get("/library", headers=H).json()["songs"][0]["discogs_url"] == url
    assert client.patch(f"/songs/{VID}", json={"title": "Other"}, headers=H).json()["discogs_url"] == url


def test_preview_includes_discogs_when_the_token_is_set(client, monkeypatch):
    monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, mb=None: {"tags": [], "song_genres": [], "wikipedia_song": None, "wikipedia_artist": None, "year": None})
    monkeypatch.setattr(gl, "suggest_tags", lambda a, t: ["genre:house", "country:fr"])
    monkeypatch.setattr(dl, "suggest", lambda a, t: disc_result())
    body = client.post("/preview", json={"url": f"https://youtu.be/{VID}"}, headers=H).json()
    assert body["tags"][:2] == ["genre:french house", "genre:disco"] and "genre:house" in body["tags"]
    assert body["discogs_url"] == "https://www.discogs.com/release/5" and body["suggested_year"] == 1996
    monkeypatch.setattr(dl, "suggest", lambda a, t: dl._empty())
    body = client.post("/preview", json={"url": f"https://youtu.be/{VID}"}, headers=H).json()
    assert body["tags"] == ["genre:house", "country:fr"] and body["discogs_url"] is None
