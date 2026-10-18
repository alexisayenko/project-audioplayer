import pytest

from app import credits_split, discogs_lookup, extractor, genre_lookup, wiki_lookup
from tests.test_extractor_mapping import ydl  # noqa: F401
from tests.test_library import H, VID, client  # noqa: F401

REAL_PREVIEW = extractor.preview


@pytest.fixture
def real_preview(client, monkeypatch, ydl):  # noqa: F811
    monkeypatch.setattr(extractor, "preview", REAL_PREVIEW)
    monkeypatch.setattr(genre_lookup, "lookup", lambda a, t, f=None: genre_lookup._empty())
    monkeypatch.setattr(wiki_lookup, "suggest", lambda a, t, mb=None: {"tags": [], "releaseYear": None, "wikipedia_song": None, "wikipedia_artist": None})
    monkeypatch.setattr(discogs_lookup, "suggest", lambda a, t: {"tags": [], "releaseYear": None, "url": None, "country": None, "artist": "", "title": ""})
    return ydl


def preview(real_preview, client, title, **info):
    real_preview.info = {"title": title, "uploader": "Chan", "upload_date": "20190301", **info}
    r = client.post("/preview", json={"url": VID}, headers=H)
    assert r.status_code == 200
    return r.json()


@pytest.mark.parametrize(
    "raw,title,name,kind",
    [
        ("My Heart Is on Fire (Special Extended Version)", "My Heart Is on Fire", "Special Extended Version", "extended"),
        ("Memory Reboot (Slowed)", "Memory Reboot", "Slowed", "other"),
        ("Passion (Moreno J Remix)", "Passion", "Moreno J Remix", "remix"),
        ("Song [Sped Up] (Official Video)", "Song", "Sped Up", "other"),
        ("Song (Live at Wembley)", "Song", "Live at Wembley", "live"),
    ],
)
def test_single_link_preview_moves_the_version_word_group_out_of_the_title(real_preview, client, raw, title, name, kind):
    body = preview(real_preview, client, raw)
    assert (body["title"], body["remixer"], body["version_year"]) == (title, name, None)
    assert body["raw"]["title"] == raw and body["raw"]["remixer"] == name
    assert body["published_year"] == 2019
    sug = body["suggested_credits"]["version"]
    assert (sug["type"], sug["name"]) == (kind, name)
    assert sug["artists"] == (["Moreno J"] if kind == "remix" else [])


@pytest.mark.parametrize("raw", ["Song (Official Video)", "Song (Lyrics)", "Song (Music Video)", "Alive", "Delivery (Visualizer)", "Song (Olive Oil)"])
def test_single_link_preview_leaves_unrelated_brackets_alone(real_preview, client, raw):
    body = preview(real_preview, client, raw)
    assert body["remixer"] is None and body["version_year"] is None and body["suggested_credits"]["version"] is None
    assert "Official" not in body["title"] and "Lyrics" not in body["title"]


def test_single_link_preview_moves_a_feat_credit_out_of_the_title_and_cuts_the_version(real_preview, client):
    body = preview(real_preview, client, "Song (feat. X) (Slowed)")
    assert (body["title"], body["remixer"], body["featuredArtists"]) == ("Song", "Slowed", ["X"])


@pytest.mark.parametrize("raw,year", [("Song (2011 Remaster)", 2011), ("Song [Remastered 2011]", 2011), ("Song (Remastered)", None), ("Song (Live 1994)", None)])
def test_remaster_year_in_the_bracket_is_the_version_year_suggestion_only(real_preview, client, raw, year):
    body = preview(real_preview, client, raw)
    assert body["version_year"] == year
    assert body["year"] is None and body["suggested_year"] is None
    assert body["published_year"] == 2019


def test_version_year_needs_a_remaster_and_a_valid_year():
    assert credits_split.version_year("2011 Remaster") == 2011
    assert credits_split.version_year("Remastered 2011") == 2011
    assert credits_split.version_year("1850 Remaster") is None
    assert credits_split.version_year("2011 Remix") is None
    assert credits_split.version_year("Remastered") is None
    assert credits_split.version_year(None) is None


@pytest.mark.parametrize(
    "raw,name,kind,by",
    [
        ("Song (Extended Mix)", "Extended Mix", "extended", []),
        ("Song (Extended Version)", "Extended Version", "extended", []),
        ("Song (Radio Mix)", "Radio Mix", "edit", []),
        ("Song [Radio Edit]", "Radio Edit", "edit", []),
        ("Song (Club Mix)", "Club Mix", "other", []),
        ("Song (Dub Mix)", "Dub Mix", "other", []),
        ("Song (VIP Mix)", "VIP Mix", "other", []),
        ("Song (Instrumental Mix)", "Instrumental Mix", "instrumental", []),
        ("Song (Acoustic Mix)", "Acoustic Mix", "acoustic", []),
        ('Song (12" Mix)', '12" Mix', "other", []),
        ("Song (Short Edit)", "Short Edit", "other", []),
        ("Song (Moreno J Mix)", "Moreno J Mix", "remix", ["Moreno J"]),
        ("Song (Hardwell Dub Mix)", "Hardwell Dub Mix", "remix", ["Hardwell"]),
        ("Song (Foo Rework)", "Foo Rework", "remix", ["Foo"]),
        ("Song [Foo Bootleg]", "Foo Bootleg", "remix", ["Foo"]),
    ],
)
def test_mix_and_edit_versions_are_classified_by_their_descriptor_words(real_preview, client, raw, name, kind, by):
    body = preview(real_preview, client, raw)
    assert (body["title"], body["remixer"]) == ("Song", name)
    sug = body["suggested_credits"]["version"]
    assert (sug["type"], sug["name"], sug["artists"]) == (kind, name, by)


@pytest.mark.parametrize("raw", ["Song (Original Mix)", "Song [Original Version]"])
def test_original_mix_is_no_version_and_the_bracket_is_dropped(real_preview, client, raw):
    body = preview(real_preview, client, raw)
    assert body["title"] == "Song" and body["remixer"] is None and body["suggested_credits"]["version"] is None


def test_descriptor_kinds():
    kind = credits_split.kind_of
    assert [kind(t) for t in ("Extended Mix", "Radio Edit", "Club Mix", "Alesso Club Mix", "Edit", "Mix", "Club Remix")] == ["extended", "edit", "other", "remix", "edit", "remix", "remix"]
