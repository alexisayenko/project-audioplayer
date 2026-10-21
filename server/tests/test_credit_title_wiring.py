import json

import pytest

from app import credits, discogs_lookup, extractor, genre_lookup, guest, playlist_import, wiki_lookup
from tests.test_extractor_mapping import SC_INFO, SC_URL, ydl  # noqa: F401
from tests.test_guest import web
from tests.test_library import H, ODIR, VID, client  # noqa: F401
from tests.test_playlist_import import A, B, C, fake, flat, post as post_list, by_id  # noqa: F401

REAL_PREVIEW = extractor.preview


@pytest.fixture
def real_preview(client, monkeypatch, ydl):  # noqa: F811
    monkeypatch.setattr(extractor, "preview", REAL_PREVIEW)
    monkeypatch.setattr(genre_lookup, "lookup", lambda a, t, f=None: genre_lookup._empty())
    monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, mb=None: {"tags": [], "releaseYear": None, "wikipedia_song": None, "wikipedia_artist": None})
    monkeypatch.setattr(discogs_lookup, "suggest", lambda a, t: {"tags": [], "releaseYear": None, "url": None, "country": None, "artist": "", "title": ""})
    return ydl


def preview(real_preview, client, title, uploader="Chan", **info):
    real_preview.info = {"title": title, "uploader": uploader, **info}
    r = client.post("/preview", json={"url": VID}, headers=H)
    assert r.status_code == 200
    return r.json()


def post(client, metadata, vid=VID):
    return client.post("/songs", json={"url": f"https://youtu.be/{vid}", "audio": False, "metadata": metadata, "tags": []}, headers=H)


def on_disk(tmp_path):
    doc = json.loads((ODIR(tmp_path) / "library.json").read_text(encoding="utf-8"))
    return next(s for s in doc["songs"] if s["id"] == VID)


class TestPreview:
    def test_trailing_feat_group_moves_to_featured(self, real_preview, client):
        body = preview(real_preview, client, "Somebody That I Used To Know (feat. Kimbra)", artist="Gotye")
        assert body["title"] == "Somebody That I Used To Know"
        assert (body["mainArtists"], body["featuredArtists"], body["withArtists"]) == (["Gotye"], ["Kimbra"], [])
        assert body["artist"] == "Gotye feat. Kimbra"
        assert body["raw"]["title"] == "Somebody That I Used To Know (feat. Kimbra)"

    def test_title_raw_keeps_noise_but_not_the_credit(self, real_preview, client):
        body = preview(real_preview, client, "Go feat. Q-Tip [Free Download]", artist="The Chemical Brothers")
        assert body["title"] == "Go"
        assert body["title_raw"] == "Go [Free Download]"
        assert body["featuredArtists"] == ["Q-Tip"]

    def test_pill_with_a_feat_keyword_is_split(self, real_preview, client):
        body = preview(real_preview, client, "Turn The Lights Off", artist="Kato Feat. Jon")
        assert (body["mainArtists"], body["featuredArtists"], body["artist"]) == (["Kato"], ["Jon"], "Kato feat. Jon")

    def test_with_group_goes_to_with_artists(self, real_preview, client):
        body = preview(real_preview, client, "Song (with Bob)", artist="Amy")
        assert (body["title"], body["withArtists"], body["artist"]) == ("Song", ["Bob"], "Amy with Bob")

    def test_feat_group_before_a_cut_version(self, real_preview, client):
        body = preview(real_preview, client, "Song (feat. X) (Foo Remix)", artist="A")
        assert (body["title"], body["featuredArtists"], body["remixer"]) == ("Song", ["X"], "Foo Remix")

    @pytest.mark.parametrize(
        "raw,uploader,title,artist,featured,remixer",
        [
            ("Kato Feat. Jon - Turn The Lights Off | DEEPO Remix Long Version", "Chan", "Turn The Lights Off", "Kato", ["Jon"], "DEEPO Remix Long Version"),
            ("Song [Foo Remix] feat. Bar - Artist", "Artist", "Song", "Artist", ["Bar"], "Foo Remix"),
            ("Artist - T (feat. C) (D Remix)", "Artist", "T", "Artist", ["C"], "D Remix"),
            ("Artist - T (D Remix) feat. C", "Artist", "T", "Artist", ["C"], "D Remix"),
            ("Heroes (we could be) feat. Tove Lo (Official Video)", "Alesso", "Heroes (we could be)", "Alesso", ["Tove Lo"], None),
        ],
    )
    def test_forms_of_crd_012(self, real_preview, client, raw, uploader, title, artist, featured, remixer):
        body = preview(real_preview, client, raw, uploader=uploader)
        assert (body["title"], body["mainArtists"], body["featuredArtists"], body["remixer"]) == (title, [artist], featured, remixer)

    @pytest.mark.parametrize("title", ["Come With Me", "Sticks & Stones", "Defeat", "Dancing with Myself", "5 ft tall"])
    def test_ambiguous_titles_are_left_alone(self, real_preview, client, title):
        body = preview(real_preview, client, title, artist="A")
        assert body["title"] == title
        assert body["featuredArtists"] == []
        assert body["withArtists"] == []
        assert body["artist"] == "A"

    def test_soundcloud_probe_moves_the_credit_too(self, ydl):  # noqa: F811
        ydl.info = {**SC_INFO, "title": "Some Track (feat. Guest)", "track": None}
        got = extractor.soundcloud_probe(SC_URL)
        assert (got["title"], got["featuredArtists"], got["artist"]) == ("Some Track", ["Guest"], "some-artist feat. Guest")


class TestPlaylistImport:
    def test_rows_carry_featured_and_with(self, client, fake):  # noqa: F811
        fake["entries"] = [
            flat(A, "Heroes (we could be) feat. Tove Lo", channel="Alesso"),
            flat(B, "Song (with Bob)", channel="Amy"),
            flat(C, "Daft Punk - Around the World (feat. Guest)", channel="Wave"),
        ]
        rows = by_id(post_list(client).json())
        assert (rows[A]["title"], rows[A]["mainArtists"], rows[A]["featuredArtists"], rows[A]["withArtists"]) == ("Heroes (we could be)", ["Alesso"], ["Tove Lo"], [])
        assert (rows[B]["title"], rows[B]["featuredArtists"], rows[B]["withArtists"]) == ("Song", [], ["Bob"])
        assert (rows[C]["title"], rows[C]["mainArtists"], rows[C]["featuredArtists"]) == ("Around the World", ["Daft Punk"], ["Guest"])

    def test_unavailable_rows_have_empty_lists(self):
        row = playlist_import._unavailable_view("x", {"title": "[Private video]"}, "Private")
        assert row["featuredArtists"] == []
        assert row["withArtists"] == []


class TestWithArtistsStorage:
    def test_stored_returned_and_derived_into_the_legacy_artist(self, client, tmp_path):
        r = post(client, {"mainArtists": ["A"], "featuredArtists": ["B"], "withArtists": ["W", "X"]})
        assert r.status_code == 201
        got = r.json()["song"]
        assert got["withArtists"] == ["W", "X"]
        assert got["artist"] == "A feat. B with W & X"
        assert on_disk(tmp_path)["withArtists"] == ["W", "X"]
        assert list(on_disk(tmp_path))[:5] == ["id", "title", "mainArtists", "featuredArtists", "withArtists"]

    def test_empty_with_is_omitted(self, client, tmp_path):
        post(client, {"mainArtists": ["A"], "withArtists": []})
        assert "withArtists" not in on_disk(tmp_path)

    def test_patch_sets_and_clears(self, client, tmp_path):
        post(client, {"mainArtists": ["A"]})
        assert client.patch(f"/songs/{VID}", json={"withArtists": ["W"]}, headers=H).status_code == 200
        assert on_disk(tmp_path)["withArtists"] == ["W"]
        assert client.patch(f"/songs/{VID}", json={"withArtists": []}, headers=H).status_code == 200
        assert "withArtists" not in on_disk(tmp_path)

    def test_limits_are_the_featured_limits(self, client):
        assert post(client, {"mainArtists": ["A"], "withArtists": [f"n{i}" for i in range(31)]}).status_code == 422
        assert post(client, {"mainArtists": ["A"], "withArtists": ["x" * 201]}).status_code == 422

    def test_legacy_artist_with_a_feat_keyword_is_split(self, client, tmp_path):
        r = post(client, {"artist": "Kato feat. Jon"})
        got = r.json()["song"]
        assert (got["mainArtists"], got["featuredArtists"], got["artist"]) == (["Kato"], ["Jon"], "Kato feat. Jon")

    def test_legacy_artist_without_a_keyword_is_unchanged(self, client):
        got = post(client, {"artist": "Pharrell Williams, Nile Rodgers"}).json()["song"]
        assert got["mainArtists"] == ["Pharrell Williams, Nile Rodgers"]
        assert got["featuredArtists"] == []

    def test_guest_sees_with_artists(self, client, monkeypatch):
        monkeypatch.setenv("PUBLIC_VIEW", "1")
        post(client, {"mainArtists": ["A"], "withArtists": ["W"]})
        assert web().get("/library").json()["songs"][0]["withArtists"] == ["W"]
        assert "withArtists" in guest.SONG_KEYS

    def test_projection_of_a_with_only_song(self):
        assert credits.project({"mainArtists": ["A"], "featuredArtists": [], "withArtists": ["W"], "albums": []})["artist"] == "A with W"
