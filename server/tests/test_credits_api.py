import json

import pytest

from app import credits, discogs_lookup, extractor, genre_lookup, guest, identify, library, metadata, metafill, wiki_lookup
from tests.test_extractor_mapping import ydl  # noqa: F401
from tests.test_guest import web
from tests.test_identify import MB_URL, wire
from tests.test_library import H, ODIR, OWNER_UID, VID, VID2, client  # noqa: F401

REAL_PREVIEW = extractor.preview
LEGACY = ("artist", "remixer", "remix_year", "year")


def post(client, metadata=None, *, vid=VID, audio=False, **extra):
    body = {"url": f"https://youtu.be/{vid}", "audio": audio, "metadata": {"title": "Song", **(metadata or {})}, "tags": [], **extra}
    return client.post("/songs", json=body, headers=H)


def song(client, vid=VID):
    return next(s for s in client.get("/library", headers=H).json()["songs"] if s["id"] == vid)


def on_disk(tmp_path, vid=VID):
    doc = json.loads((ODIR(tmp_path) / "library.json").read_text(encoding="utf-8"))
    return next(s for s in doc["songs"] if s["id"] == vid)


class TestCreate:
    def test_structure_keys_are_stored_and_projected(self, client, tmp_path):
        r = post(client, {"artists": ["Dua Lipa", "Elton John"], "featured": ["Jon"], "released": 2021,
                          "version": {"kind": "live", "name": "Live, Royal Albert Hall", "year": 2022}})
        assert r.status_code == 201
        got = r.json()["song"]
        assert (got["artists"], got["featured"], got["released"]) == (["Dua Lipa", "Elton John"], ["Jon"], 2021)
        assert got["version"] == {"kind": "live", "name": "Live, Royal Albert Hall", "by": [], "year": 2022}
        assert (got["artist"], got["remixer"], got["year"], got["remix_year"]) == ("Dua Lipa & Elton John feat. Jon", "Live, Royal Albert Hall", 2021, 2022)
        stored = on_disk(tmp_path)
        assert all(k not in stored for k in LEGACY)
        assert list(stored)[:6] == ["id", "title", "artists", "featured", "released", "version"]
        assert "decade:20s" in got["tags"]

    def test_legacy_keys_from_ios_become_structure(self, client, tmp_path):
        r = post(client, {"artist": "Band", "album": "", "remixer": "Alesso Remix", "year": 1999, "remix_year": 2012,
                          "wikipedia_song": None, "wikipedia_artist": None, "musicbrainz_url": None})
        got = r.json()["song"]
        assert got["artists"] == ["Band"] and got["released"] == 1999
        assert got["version"] == {"kind": "remix", "name": "Alesso Remix", "by": [], "year": 2012}
        assert on_disk(tmp_path)["raw"] == {"title": "Song", "artist": "Band", "remixer": "Alesso Remix"}

    def test_structure_wins_over_legacy_keys_in_the_same_body(self, client):
        got = post(client, {"artist": "Legacy", "artists": ["New"], "year": 1990, "released": 2001, "remixer": "Old Remix", "version": None}).json()["song"]
        assert (got["artists"], got["released"], got["artist"], got["year"]) == (["New"], 2001, "New", 2001)
        assert "version" not in got and got["remixer"] is None

    def test_unsent_keys_do_not_become_nulls_that_wipe_structure(self, client):
        got = post(client, {"artists": ["A"]}).json()["song"]
        assert got["artists"] == ["A"] and got["released"] == 1987 and "version" not in got

    def test_source_raw_is_stored_verbatim_and_never_edited_later(self, client, tmp_path):
        raw = {"title": "Song (Alesso Remix) [Official]", "artist": "Band - Topic", "remixer": "Alesso Remix"}
        post(client, {"artists": ["Band"], "version": {"kind": "remix", "name": "Alesso Remix", "by": ["Alesso"]}}, source_raw=raw)
        assert on_disk(tmp_path)["raw"] == raw
        client.patch(f"/songs/{VID}", json={"title": "Other", "artists": ["Z"], "version": None}, headers=H)
        assert on_disk(tmp_path)["raw"] == raw

    def test_with_audio_the_source_artist_fills_an_empty_artist(self, client, tmp_path):
        assert post(client, audio=True).status_code == 202
        got = song(client)
        assert got["artists"] == ["Yt Artist"] and got["artist"] == "Yt Artist"
        assert "artist" not in on_disk(tmp_path)

    def test_without_audio_the_source_year_fills_released_only_when_unsent(self, client):
        assert post(client).json()["song"]["released"] == 1987
        assert post(client, {"released": 2001}, vid=VID2).json()["song"]["released"] == 2001

    @pytest.mark.parametrize("meta, message", [
        ({"version": {"kind": "bogus"}}, "version.kind must be one of remix, live, acoustic, extended, instrumental, remaster, edit, cover, other"),
        ({"version": {"kind": "remix", "of": "X"}}, "version.of is only for covers"),
        ({"artists": [f"n{i}" for i in range(31)]}, "artists must be a list of at most 30 names"),
        ({"released": 1899}, "released must be from 1900 to 2027"),
        ({"version": {"kind": "live", "year": 2028}}, "version.year must be from 1900 to 2027"),
        ({"year": 2028}, "year must be from 1900 to 2027"),
        ({"remix_year": 1800}, "remix_year must be from 1900 to 2027"),
    ])
    def test_rejections(self, client, meta, message):
        r = post(client, meta)
        assert r.status_code == 422
        assert r.json()["detail"] == message
        assert client.get("/library", headers=H).json()["songs"] == []

    def test_unknown_version_keys_are_a_422(self, client):
        assert post(client, {"version": {"kind": "remix", "colour": "red"}}).status_code == 422


class TestPatch:
    @pytest.fixture
    def structured(self, client):
        post(client, {"artists": ["A", "B"], "featured": ["C"], "released": 1999, "version": {"kind": "remix", "name": "Alesso Remix", "by": ["Alesso"], "year": 2012}},
             source_raw={"title": "Song", "artist": "A - B"})
        return client

    def test_title_only_keeps_all_structure(self, structured, tmp_path):
        before = on_disk(tmp_path)
        got = structured.patch(f"/songs/{VID}", json={"title": "New"}, headers=H).json()
        assert (got["artists"], got["featured"], got["released"], got["version"]) == (before["artists"], before["featured"], before["released"], before["version"])
        assert on_disk(tmp_path)["raw"] == before["raw"]

    def test_structure_keys_replace(self, structured, tmp_path):
        got = structured.patch(f"/songs/{VID}", json={"artists": ["X"], "released": 2005, "version": {"kind": "cover", "of": "Orig"}}, headers=H).json()
        assert got["artists"] == ["X"] and got["featured"] == ["C"] and got["released"] == 2005
        assert got["version"] == {"kind": "cover", "name": None, "by": [], "year": None, "of": "Orig"}
        assert (got["artist"], got["remixer"], got["year"], got["remix_year"]) == ("X feat. C", "Cover", 2005, None)
        assert "decade:00s" in got["tags"]
        assert all(k not in on_disk(tmp_path) for k in LEGACY)

    def test_version_null_removes_the_version(self, structured):
        got = structured.patch(f"/songs/{VID}", json={"version": None}, headers=H).json()
        assert "version" not in got and got["remixer"] is None and got["remix_year"] is None
        assert "version" not in song(structured)

    def test_structure_shadows_legacy_in_the_same_patch(self, structured):
        got = structured.patch(f"/songs/{VID}", json={"artists": ["Only"], "artist": "Ignored", "released": 2001, "year": 1950}, headers=H).json()
        assert (got["artists"], got["released"]) == (["Only"], 2001)

    def test_ios_edit_of_an_unchanged_song_is_a_no_op_on_structure(self, structured, tmp_path):
        current = song(structured)
        before = on_disk(tmp_path)
        body = {"title": current["title"], "artist": current["artist"], "album": "", "remixer": current["remixer"], "year": current["year"],
                "wikipedia_song": None, "wikipedia_artist": None, "musicbrainz_url": None, "tags": current["tags"]}
        assert structured.patch(f"/songs/{VID}", json=body, headers=H).status_code == 200
        after = on_disk(tmp_path)
        for key in ("artists", "featured", "released", "version", "raw", "title"):
            assert after[key] == before[key]

    def test_ios_changed_artist_flattens_to_pills_and_clears_featured(self, structured):
        got = structured.patch(f"/songs/{VID}", json={"artist": "Brand - New"}, headers=H).json()
        assert (got["artists"], got["featured"]) == (["Brand", "New"], [])

    def test_ios_cleared_remixer_removes_the_version(self, structured):
        got = structured.patch(f"/songs/{VID}", json={"remixer": None}, headers=H).json()
        assert "version" not in got

    def test_legacy_remix_year_sets_the_version_year(self, structured):
        assert structured.patch(f"/songs/{VID}", json={"remix_year": 2020}, headers=H).json()["version"]["year"] == 2020

    @pytest.mark.parametrize("body, message", [
        ({"artists": [f"n{i}" for i in range(31)]}, "artists must be a list of at most 30 names"),
        ({"version": {"kind": "nope"}}, "version.kind must be one of"),
        ({"version": {"kind": "live", "of": "X"}}, "version.of is only for covers"),
        ({"released": 2028}, "released must be from 1900 to 2027"),
        ({"version": {"kind": "live", "year": 1899}}, "version.year must be from 1900 to 2027"),
        ({"year": 1899}, "year must be from 1900 to 2027"),
    ])
    def test_rejections_leave_the_song_unchanged(self, structured, tmp_path, body, message):
        before = on_disk(tmp_path)
        r = structured.patch(f"/songs/{VID}", json=body, headers=H)
        assert r.status_code == 422
        assert message in str(r.json()["detail"])
        assert on_disk(tmp_path) == before

    def test_an_unchanged_out_of_range_stored_year_does_not_block_other_edits(self, client, tmp_path):
        post(client, {"artists": ["A"]})
        path = ODIR(tmp_path) / "library.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["songs"][0]["released"] = 1850
        path.write_text(json.dumps(doc), encoding="utf-8")
        assert client.patch(f"/songs/{VID}", json={"title": "T2", "year": 1850, "released": 1850}, headers=H).status_code == 200
        assert client.patch(f"/songs/{VID}", json={"released": 1851}, headers=H).status_code == 422


class TestListsAndGuest:
    def test_library_and_catalog_carry_the_schema_and_always_present_keys(self, client):
        post(client, {"artists": ["A"], "version": {"kind": "live"}})
        post(client, {"title": "Plain"}, vid=VID2)
        lib = client.get("/library", headers=H).json()
        cat = client.get("/catalog", headers=H).json()
        assert lib["credits_schema"] == 1 and cat["credits_schema"] == 1
        for body in (lib, cat):
            for s in body["songs"]:
                for key in ("title", "artists", "featured", "released", "artist", "remixer", "year", "remix_year"):
                    assert key in s, key
            assert "version" in next(s for s in body["songs"] if s["id"] == VID)
            assert "version" not in next(s for s in body["songs"] if s["id"] == VID2)

    def test_catalog_revision_etag_and_since_follow_edits(self, client):
        post(client, {"artists": ["A"]})
        first = client.get("/catalog", headers=H)
        etag = first.headers["ETag"]
        assert client.get("/catalog", headers={**H, "If-None-Match": etag}).status_code == 304
        client.patch(f"/songs/{VID}", json={"artists": ["B"]}, headers=H)
        again = client.get("/catalog", headers={**H, "If-None-Match": etag})
        assert again.status_code == 200 and again.headers["ETag"] != etag
        stamp = song(client)["updated_at"]
        assert [s["id"] for s in client.get("/catalog", params={"since": stamp}, headers=H).json()["songs"]] == [VID]

    def test_guest_gets_the_structure_but_not_raw(self, client, monkeypatch):
        post(client, {"artists": ["A"], "featured": ["B"], "released": 1999, "version": {"kind": "remix", "name": "X Remix", "by": ["X"]}}, source_raw={"title": "Original Upload Title"})
        owner = song(client)
        assert "raw" in owner
        seen = web().get("/library").json()["songs"][0]
        assert "raw" not in seen and "metadata_checked_at" not in seen
        assert (seen["artists"], seen["featured"], seen["released"], seen["version"]["kind"]) == (["A"], ["B"], 1999, "remix")
        assert seen["artist"] == "A feat. B" and seen["remixer"] == "X Remix" and seen["year"] == 1999
        assert {"artists", "featured", "released", "version"} <= guest.SONG_KEYS and "raw" not in guest.SONG_KEYS


class TestPreviewAndMetadata:
    @pytest.fixture
    def real_preview(self, client, monkeypatch, ydl):  # noqa: F811
        monkeypatch.setattr(extractor, "preview", REAL_PREVIEW)
        for mod, name in ((genre_lookup, "lookup"),):
            monkeypatch.setattr(mod, name, lambda a, t, f=None: genre_lookup._empty())
        monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, mb=None: {"tags": [], "year": None, "wikipedia_song": None, "wikipedia_artist": None})
        monkeypatch.setattr(discogs_lookup, "suggest", lambda a, t: {"tags": [], "year": None, "url": None, "country": None, "artist": "", "title": ""})
        return ydl

    def test_an_upload_only_video_gives_no_year_and_no_decade(self, real_preview, client):
        real_preview.info = {"title": "Kato feat. Jon - Turn The Lights Off (Alesso Remix)", "uploader": "Chan", "upload_date": "20140301"}
        body = client.post("/preview", json={"url": VID}, headers=H).json()
        assert body["year"] is None and body["suggested_year"] is None and body["released_suggestion"] is None
        assert body["published_year"] == 2014
        assert body["raw"]["title"] == "Kato feat. Jon - Turn The Lights Off (Alesso Remix)"
        assert body["raw"]["remixer"] == "Alesso Remix" and body["remixer"] == "Alesso Remix"
        sug = body["suggested_credits"]
        assert sug["featured"] == ["Jon"] and sug["version"]["by"] == ["Alesso"]
        assert not any(t.startswith("decade:") for t in body["tags"])

    @pytest.mark.parametrize("wiki, mb, disc, expect", [
        (1990, 1991, 1992, (1990, "wikipedia")), (None, 1991, 1992, (1991, "musicbrainz")), (None, None, 1992, (1992, "discogs")), (None, None, None, None),
        (2999, 1991, None, (1991, "musicbrainz")),
    ])
    def test_released_suggestion_chain(self, real_preview, client, monkeypatch, wiki, mb, disc, expect):
        real_preview.info = {"title": "T", "uploader": "A", "upload_date": "20140301", "release_year": 2005}
        monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, m=None: {"tags": [], "year": wiki, "wikipedia_song": None, "wikipedia_artist": None})
        monkeypatch.setattr(genre_lookup, "lookup", lambda a, t, f=None: {**genre_lookup._empty(), "year": mb})
        monkeypatch.setattr(discogs_lookup, "suggest", lambda a, t: {"tags": [], "year": disc, "url": None, "country": None, "artist": "", "title": ""})
        body = client.post("/preview", json={"url": VID}, headers=H).json()
        if expect is None:
            assert body["released_suggestion"] is None and body["year"] is None
        else:
            assert body["released_suggestion"] == {"year": expect[0], "source": expect[1]}
            assert body["suggested_year"] == expect[0] and body["year"] == expect[0]

    def test_metadata_for_a_version_withholds_the_original_links(self, client, monkeypatch):
        mb = {**genre_lookup._empty(), "year": 1999, "mb_url": MB_URL}
        monkeypatch.setattr(genre_lookup, "lookup", lambda a, t, f=None: mb)
        monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, m=None: {"tags": [], "year": None})
        monkeypatch.setattr(discogs_lookup, "suggest", lambda a, t: {"tags": [], "year": 1998, "url": "https://www.discogs.com/release/5"})
        body = {"title": "T", "artist": "A", "sources": []}
        plain = client.post("/metadata", json=body, headers=H).json()
        version = client.post("/metadata", json={**body, "version_kind": "remix"}, headers=H).json()
        assert plain["services"]["musicbrainz"]["url"] == MB_URL and plain["services"]["discogs"]["url"]
        assert version["services"]["musicbrainz"] == {"found": False, "url": None}
        assert version["services"]["discogs"] == {"found": False, "url": None}
        assert version["year"] == 1999 and "version_year" in version and version["version_year"] == version["remix_year"]

    def test_unknown_version_kind_is_a_422(self, client):
        assert client.post("/metadata", json={"title": "T", "version_kind": "bogus"}, headers=H).status_code == 422


class TestEnrichmentOfVersions:
    RESP = {"album": "Original Album", "year": 1999, "tags": ["genre:house"], "wikipedia_album": "https://en.wikipedia.org/wiki/Found",
            "services": {"musicbrainz": {"found": True, "url": MB_URL}}}

    def version_song(self, **over):
        return {"id": VID, "title": "T", "artists": ["A"], "featured": [], "released": None, "album": None, "tags": [],
                "version": {"kind": "remix", "name": "X Remix", "by": [], "year": None}, **over}

    def test_metafill_fills_released_and_genres_but_never_album_or_links_for_a_version(self):
        s = self.version_song()
        assert metafill.apply(s, self.RESP) is True
        assert s["released"] == 1999 and "genre:house" in s["tags"] and "decade:90s" in s["tags"]
        assert s["album"] is None and "musicbrainz_url" not in s and "wikipedia_album" not in s

    def test_metafill_fills_everything_for_a_song_without_a_version(self):
        s = self.version_song()
        s.pop("version")
        metafill.apply(s, self.RESP)
        assert s["album"] == "Original Album" and s["musicbrainz_url"].startswith("https://musicbrainz.org/")

    def test_metafill_asks_for_the_original_work(self, monkeypatch):
        seen = {}
        monkeypatch.setattr(metafill.metadata, "gather", lambda title, artist, fetchers, *a, **kw: seen.update(title=title, artist=artist, kw=kw) or {})
        cover = self.version_song(artists=["Covering Band"], version={"kind": "cover", "name": None, "by": [], "year": None, "of": "Original Band"})
        metafill._fetch(cover)
        assert (seen["title"], seen["artist"], seen["kw"]) == ("T", "Original Band", {"version_kind": "cover"})
        metafill._fetch(self.version_song())
        assert seen["artist"] == "A" and seen["kw"] == {"version_kind": "remix"}

    def test_metafill_needs_released_not_album_for_a_version(self):
        s = self.version_song(tags=["genre:house"])
        assert metafill._needs(s)
        s["released"] = 2000
        assert not metafill._needs(s)

    def test_identify_offers_no_musicbrainz_or_discogs_link_for_a_version(self, monkeypatch):
        wire(monkeypatch)
        monkeypatch.setattr(genre_lookup, "lookup", lambda a, t, f=None: {**genre_lookup._empty(), "mb_url": MB_URL, "year": 1997})
        plain = {"id": "x", "title": "around the world", "artists": ["daft punk"], "featured": [], "released": None}
        assert identify.run(plain, None)["links"]["musicbrainz"] == MB_URL
        version = {**plain, "version": {"kind": "remix", "name": "R", "by": [], "year": None}}
        out = identify.run(version, None)
        assert out["links"]["musicbrainz"] is None and out["links"]["discogs"] is None
        assert out["suggested_year"] == 1997

    def test_download_name_uses_the_credited_artists(self):
        s = self.version_song(artists=["A", "B"], featured=["C"])
        assert library.download_name(s, VID) == "A & B feat. C - T.m4a"
        assert credits.artist_string(s) == "A & B feat. C"
