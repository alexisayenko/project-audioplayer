import pytest

from tests.vocab import REAL
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
    assert gf.canonical("Electronic Dance") == "electronic dance"
    assert gf.canonical("electronic-dance-music") == "electronic dance"
    assert gf.canonical("punk rock") == "punk"
    for keep in ("trap", "chillout", "dance-pop", "pop-punk", "chillwave", "soft-rock", "synth-rock", "new age", "indie pop", "classical", "country"):
        assert gf.canonical(keep) == keep or gf.canonical(keep) == keep.replace("-", " ")
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
    tags = [*junk, "genre:house music", "genre:house", *[f"genre:{REAL[i]}" for i in range(8)]]
    out = metadata.merge([], {"tags": tags}, None, None)["tags"]
    assert out == ["genre:house", *[f"genre:{REAL[i]}" for i in range(7)]]


def test_merge_song_genres_filtered_and_priority_counts_distinct():
    song = ["genre:house music", "genre:house", "genre:danish", *[f"genre:{REAL[i]}" for i in range(10)]]
    out = metadata.merge([], {"tags": ["genre:folk"]}, {"song_genres": song, "tags": song}, None)["tags"]
    assert out == ["genre:house", *[f"genre:{REAL[i]}" for i in range(10)]]


def test_kato_example():
    mb = {"tags": ["genre:house", "genre:dance", "genre:hip-hop", "genre:danish", "genre:dj", "genre:house music", "country:dk"]}
    assert metadata.merge([], mb, None, None)["tags"] == ["genre:house", "genre:dance", "genre:hip hop", "country:dk"]


def test_user_entered_genre_tags_are_not_filtered():
    import app.library as library

    assert library.clean_tags(["genre:danish", "genre:house music", "genre:dj"]) == ["genre:danish", "genre:house", "genre:dj"]


def test_patch_canonicalises_user_entered_genre_tags(client):
    from tests.test_library import H, VID, add

    add(client)
    tags = ["genre:Trance", "genre:house music", "genre:punk"]
    r = client.patch(f"/songs/{VID}", json={"tags": tags}, headers=H)
    want = ["genre:trance", "genre:house", "genre:punk"]
    assert r.json()["tags"] == want
    assert client.get("/library", headers=H).json()["songs"][0]["tags"] == want


def test_musicbrainz_url_is_stored_cleaned_and_listed(client):
    from tests.test_library import H, VID, add

    mbid = "5f1e7d9a-0b2c-4d3e-8f4a-6b7c8d9e0f1a"
    url = f"https://musicbrainz.org/recording/{mbid}"
    add(client, metadata={"title": "Song", "musicbrainz_url": f"http://musicbrainz.org/recording/{mbid}"})
    assert client.get("/library", headers=H).json()["songs"][0]["musicbrainz_url"] == url
    assert client.patch(f"/songs/{VID}", json={"musicbrainz_url": "https://evil.example/x"}, headers=H).json()["musicbrainz_url"] is None
    assert client.patch(f"/songs/{VID}", json={"musicbrainz_url": url}, headers=H).json()["musicbrainz_url"] == url
    assert client.patch(f"/songs/{VID}", json={"title": "Other"}, headers=H).json()["musicbrainz_url"] == url


@pytest.mark.parametrize("raw,want", [
    ("euroda", "eurodance"), ("deep progressive", "progressive house"), ("mor", "middle of the road"), ("retro-synth", "synthwave"),
    ("melodic progressive house", "progressive house"), ("hip-hop & rap", "hip hop"), ("rock and indie", "indie rock"),
    ("pop and chart", "pop"), ("russian electro pop", "electropop"), ("Russian Electropop", "electropop"),
    ("dnb", "drum and bass"), ("DnB", "drum and bass"), ("drum & bass", "drum and bass"), ("drum n bass", "drum and bass"), ("Drum-and-Bass", "drum and bass"),
    ("edm", "electronic dance"), ("EDM", "electronic dance"), ("euro pop", "europop"), ("europop", "europop"), ("euro disco", "euro disco"),
    ("euro-disco", "euro disco"), ("eurodisco", "euro disco"), ("eurohouse", "euro house"), ("euro house", "euro house"), ("electronic pop", "electropop"),
    ("festival progressive house", "progressive house"), ("festival trap", "trap"), ("red disco", "disco"),
])
def test_new_aliases(raw, want):
    assert gf.canonical(raw) == want


@pytest.mark.parametrize("raw,want", [
    ("appalachian folk", "folk"), ("bard", "folk"), ("west coast swing", "swing"), ("romantic", "classical"), ("Romantic music", "classical"),
    ("psychedelic", "psychedelic rock"), ("psychedelic music", "psychedelic rock"), ("nederpop", "pop"), ("orchestral", "modern classical"),
    ("alternative", "alternative rock"), ("alternative music", "alternative rock"), ("indie", "indie rock"), ("Indie", "indie rock"),
    ("progressive", "progressive rock"), ("russian indie", "indie rock"),
])
def test_retags(raw, want):
    from app import library

    assert gf.canonical(raw) == want
    assert library.clean_tag(f"genre:{raw}") == f"genre:{want}"


@pytest.mark.parametrize("raw", ["indie rock", "indie pop", "progressive house", "progressive rock", "progressive trance", "psychedelic rock", "acid house", "alternative rock", "folk rock", "swing"])
def test_retags_match_the_whole_tag_only(raw):
    assert gf.canonical(raw) == raw


def test_targets_are_canonical_fixed_points():
    for target in {*gf.ALIASES.values(), *gf.RETAGS.values(), gf.PROGRESSIVE_ELECTRONIC}:
        assert gf.canonical(target) == target, target
        assert gf.is_genre(target) and not gf.is_dropped(target), target


def test_progressive_goes_to_house_with_an_electronic_tag_else_rock():
    from app import library

    assert library.clean_tags(["genre:progressive", "genre:house"]) == ["genre:progressive house", "genre:house"]
    assert library.clean_tags(["genre:melodic techno", "genre:progressive"]) == ["genre:melodic techno", "genre:progressive house"]
    assert library.clean_tags(["genre:progressive", "genre:edm"]) == ["genre:progressive house", "genre:electronic dance"]
    assert library.clean_tags(["genre:progressive", "genre:trance", "genre:rock"]) == ["genre:progressive house", "genre:trance", "genre:rock"]
    assert library.clean_tags(["genre:progressive", "genre:rock"]) == ["genre:progressive rock", "genre:rock"]
    assert library.clean_tags(["genre:progressive", "genre:indie"]) == ["genre:progressive rock", "genre:indie rock"]
    assert library.clean_tags(["genre:progressive"]) == ["genre:progressive rock"]
    assert library.clean_tags(["genre:progressive", "genre:progressive house"]) == ["genre:progressive house"]
    assert library.clean_tags(["genre:progressive", "genre:progressive"]) == ["genre:progressive rock"]
    assert gf.filter_tags(["genre:progressive", "genre:trance"]) == ["genre:progressive house", "genre:trance"]
    assert gf.is_electronic("house") and gf.is_electronic("Electronic") and gf.is_electronic("dance") and gf.is_electronic("eurodance")
    assert not gf.is_electronic("rock") and not gf.is_electronic("progressive") and not gf.is_electronic("zzz-weird")


@pytest.mark.parametrize("raw", ["mkj", "deb", "stadiumx", "Sam Smith", "dancin", "relaxed", "love song", "Love-Song", "progressive music", "Underground Music", "dystopian music", "comedy music", "Comedy", "novelty music", "novelty song", "novelty",
                                 "Popular", "popular music", "underground", "club", "club music", "cyberpunk", "Cyberpunk Music"])
def test_junk_dropped(raw):
    from app import library

    assert gf.is_dropped(raw) and not gf.is_genre(raw)
    assert library.clean_tag(f"genre:{raw}") == ""
    assert gf.filter_tags([f"genre:{raw}", "x"]) == ["x"]


@pytest.mark.parametrize("raw", ["dance pop", "pop punk", "sunshine house", "dreamsynth", "synth-rock", "neurofunk", "liquid funk", "techstep", "melodic techno", "melodic house", "big room house",
                                 "darksynth", "dreamwave", "raggacore", "dance-rock", "psybient", "electronica", "electronic", "dance", "singer-songwriter", "experimental", "estrada",
                                 "shock rock", "dark metal", "epic", "trailer", "chillwave", "darkwave", "nu-nrg", "uplifting trance"])
def test_real_genres_untouched(raw):
    assert gf.is_genre(raw) and not gf.is_dropped(raw)
    assert gf.canonical(raw) == raw


@pytest.mark.parametrize("raw,want", [
    ("russian pop", ("pop", "ru", "ru")), ("russian chanson", ("chanson", "ru", "ru")), ("british blues", ("blues", "gb", None)),
    ("Dutch House", ("house", "nl", "nl")), ("russian hip-hop", ("hip hop", "ru", "ru")),
    ("uk garage", None), ("french house", None), ("british invasion", None), ("russian", None), ("russian electropop", None), ("house", None),
])
def test_split_prefix(raw, want):
    assert gf.split_prefix(raw) == want


def test_prefix_cleaning_adds_country_and_lang_once():
    from app import library

    assert library.clean_tag("genre:russian pop") == "genre:pop"
    assert library.clean_tags(["genre:russian pop", "genre:russian rock"]) == ["genre:pop", "genre:rock", "country:ru", "lang:ru"]
    assert library.clean_tags(["genre:british blues", "country:us"]) == ["genre:blues", "country:us", "country:gb"]
    assert library.clean_tags(["genre:dutch house", "genre:french house", "country:nl", "lang:en"]) == ["genre:house", "genre:french house", "country:nl", "lang:en"]
    again = library.clean_tags(["genre:russian pop"])
    assert library.clean_tags(again) == again
    assert library.clean_tags(["genre:euroda", "genre:eurodance"]) == ["genre:eurodance"]
    assert library.clean_tags(["genre:mkj", "x"]) == ["x"]


def test_dystopian_is_retagged_to_darksynth_not_dropped():
    from app import library

    assert not gf.is_dropped("dystopian") and gf.is_genre("dystopian")
    assert gf.canonical("Dystopian") == "darksynth"
    assert library.clean_tag("genre:dystopian") == "genre:darksynth"
    assert library.clean_tags(["genre:dystopian", "genre:darksynth", "genre:synthwave"]) == ["genre:darksynth", "genre:synthwave"]
    assert gf.is_dropped("dystopian music")
    assert library.clean_tags(["genre:dystopian", "genre:dystopian music"]) == ["genre:darksynth"]
