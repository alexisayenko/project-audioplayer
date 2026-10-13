import pytest

from tests.test_library import client  # noqa: F401

from app import genre_filter as gf, metadata


@pytest.mark.parametrize("v", ["danish", "Danish", "dj", "seen live", "Seen-Live", "2010", "1990s", "90s", "english", "music", "uk", "usa", "female vocalists", "under 2000 listeners", "danish music", "Remix", "copenhagen"])
def test_denied(v):
    assert not gf.is_genre(v)


@pytest.mark.parametrize("v", ["house", "dance", "hip-hop", "pop", "uk garage", "chamber music", "bass music", "drum and bass", "k-pop"])
def test_kept(v):
    assert gf.is_genre(v)


def test_canonical_strips_music_and_uses_builtin_spelling():
    assert gf.canonical("house music") == "house"
    assert gf.canonical("Electronic Music") == "electronic"
    assert gf.canonical("hip-hop") == "hip hop"
    assert gf.canonical("hiphop") == "hip hop"
    assert gf.canonical("Hip Hop") == "hip hop"
    assert gf.canonical("bass music") == "bass music"
    assert gf.canonical("zzz-weird") == "zzz-weird"


def test_filter_tags_keeps_other_namespaces():
    out = gf.filter_tags(["genre:danish", "country:dk", "decade:10s", "Plain", "genre:house music", "genre:house"])
    assert out == ["country:dk", "decade:10s", "Plain", "genre:house", "genre:house"]


def test_merge_dedupes_and_does_not_waste_slots():
    junk = [f"genre:{w}" for w in ("danish", "dj", "seen live", "2010", "english", "music")]
    tags = [*junk, "genre:house music", "genre:house", *[f"genre:g{i}" for i in range(8)]]
    out = metadata.merge([], {"tags": tags}, None, None)["tags"]
    assert out == ["genre:house", *[f"genre:g{i}" for i in range(7)]]


def test_merge_song_genres_filtered_and_priority_counts_distinct():
    song = ["genre:house music", "genre:house", "genre:danish", *[f"genre:s{i}" for i in range(10)]]
    out = metadata.merge([], {"tags": ["genre:x"]}, {"song_genres": song, "tags": song}, None)["tags"]
    assert out == ["genre:house", *[f"genre:s{i}" for i in range(10)]]


def test_kato_example():
    mb = {"tags": ["genre:house", "genre:dance", "genre:hip-hop", "genre:danish", "genre:dj", "genre:house music", "country:dk"]}
    assert metadata.merge([], mb, None, None)["tags"] == ["genre:house", "genre:dance", "genre:hip hop", "country:dk"]


def test_user_entered_genre_tags_are_not_filtered():
    import app.library as library

    assert library.clean_tags(["genre:danish", "genre:house music", "genre:dj"]) == ["genre:danish", "genre:house music", "genre:dj"]


def test_patch_keeps_user_entered_genre_tags(client):
    from tests.test_library import H, VID, add

    add(client)
    tags = ["genre:danish", "genre:house music", "genre:dj"]
    r = client.patch(f"/songs/{VID}", json={"tags": tags}, headers=H)
    assert r.json()["tags"] == tags
    assert client.get("/library", headers=H).json()["songs"][0]["tags"] == tags


def test_musicbrainz_url_is_stored_cleaned_and_listed(client):
    from tests.test_library import H, VID, add

    mbid = "5f1e7d9a-0b2c-4d3e-8f4a-6b7c8d9e0f1a"
    url = f"https://musicbrainz.org/recording/{mbid}"
    add(client, metadata={"title": "Song", "musicbrainz_url": f"http://musicbrainz.org/recording/{mbid}"})
    assert client.get("/library", headers=H).json()["songs"][0]["musicbrainz_url"] == url
    assert client.patch(f"/songs/{VID}", json={"musicbrainz_url": "https://evil.example/x"}, headers=H).json()["musicbrainz_url"] is None
    assert client.patch(f"/songs/{VID}", json={"musicbrainz_url": url}, headers=H).json()["musicbrainz_url"] == url
    assert client.patch(f"/songs/{VID}", json={"title": "Other"}, headers=H).json()["musicbrainz_url"] == url
