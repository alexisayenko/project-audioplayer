import pytest

from app import credits_split, extractor, titleclean, titles, yt_genres
from app.routes import lookup

TITLE = "Twin & Elise Lieberth - In The End (Magic Cover Release)"
DESCRIPTION = (
    "Twin & Elise Lieberth - In The End (Magic Cover Release)\n\n➤ SUBSCRIBE HERE → https://www.youtube.com/c/MagicClub295?sub_confirmation=1\n"
    "✔️ Stream/Download: https://fanlink.tv/MRC079\n📧 Contact us: hi@magicmusic.io\n\n#MagicClub #Intheend #MagicRecords #DeepHouse"
)
INFO = {"title": TITLE, "uploader": "Magic Club", "tags": [], "categories": ["Music"], "description": DESCRIPTION}


def test_hashtag_deephouse_becomes_deep_house_and_the_rest_is_ignored():
    assert yt_genres.suggest(INFO, "Twin & Elise Lieberth", "In The End") == ["genre:deep house"]


@pytest.mark.parametrize("raw,expected", [
    ("DeepHouse", "deep house"), ("deep house", "deep house"), ("#Techno", "techno"), ("Music", None), ("Intheend", None),
    ("MagicClub", None), ("Live", None), ("cover", None),
])
def test_genre_of(raw, expected):
    assert yt_genres.genre_of(raw) == expected


def test_tags_categories_and_title_hashtags_are_sources_capped_and_unique():
    info = {"title": "x #house", "tags": ["Deep House", "techno", "trance", "house"], "categories": ["Music"], "description": "#DeepHouse"}
    assert yt_genres.suggest(info) == ["genre:deep house", "genre:techno", "genre:trance"]


def test_names_equal_to_artist_or_title_are_skipped_and_urls_anchors_are_not_hashtags():
    assert yt_genres.suggest({"tags": ["House"]}, "House", "Song") == []
    assert yt_genres.suggest({"description": "see https://x.com/a#house and &#39;techno"}) == []


def test_empty_or_odd_info():
    assert yt_genres.suggest({}) == []
    assert yt_genres.suggest({"tags": None, "categories": "Music", "description": 5}) == []


class FakeYDL:
    def __init__(self, opts):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=False):
        return INFO


def test_preview_returns_youtube_genres_title_and_cover_credits(monkeypatch):
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    got = extractor.preview("XAX3ZQ5eNaM")
    assert got["youtube_genres"] == ["genre:deep house"]
    assert got["artist"] == "Twin & Elise Lieberth"
    assert got["title"] == "In The End (Magic Cover Release)"
    assert got["raw"]["title"] == TITLE
    sc = got["suggested_credits"]
    assert sc["artists"] == ["Twin", "Elise Lieberth"]
    assert sc["version"] == {"kind": "cover", "name": "Cover", "by": []}
    assert "of" not in sc["version"]
    assert sc["title"] == "In The End"
    assert "cover_release" in sc["notes"]


def _empty():
    return [], {}, {"tags": [], "wikipedia_song": None, "wikipedia_artist": None}, {"tags": [], "url": None}


def test_merge_uses_youtube_genres_last_and_names_the_source():
    meta = {"tags": [], "youtube_genres": ["genre:deep house"]}
    found, mb, wiki, disc = _empty()
    lookup._merge_suggestions(meta, found, mb, wiki, disc)
    assert meta["tags"] == ["genre:deep house"]
    assert meta["tag_sources"] == {"genre:deep house": "youtube"}


def test_merge_other_sources_win_the_label_and_the_order():
    meta = {"tags": [], "youtube_genres": ["genre:deep house", "genre:techno"]}
    found, mb, wiki, disc = _empty()
    lookup._merge_suggestions(meta, ["genre:techno"], mb, wiki, disc)
    assert meta["tags"] == ["genre:techno", "genre:deep house"]
    assert meta["tag_sources"] == {"genre:deep house": "youtube"}


def test_merge_without_youtube_genres_is_unchanged():
    meta = {"tags": ["genre:house"]}
    found, mb, wiki, disc = _empty()
    lookup._merge_suggestions(meta, found, mb, wiki, disc)
    assert meta["tags"] == ["genre:house"] and meta["tag_sources"] == {}


@pytest.mark.parametrize("title,clean", [
    ("Song (Magic Free Release)", "Song"), ("Song [NCS Release]", "Song"), ("A - B (Free Release)", "A - B"),
    ("Song (Magic Cover Release)", "Song (Magic Cover Release)"),
])
def test_release_tags_are_noise_except_cover_ones(title, clean):
    assert titleclean.clean(title) == clean


def test_release_tag_never_a_version_or_original_artist():
    s = credits_split.suggest("A", "Song [NCS Release]", "")
    assert s["version"] is None and s["title"] == "Song" and "release_tag" in s["notes"]
    s = credits_split.suggest("Twin", "Song (Magic Cover Release)", "")
    assert s["version"] == {"kind": "cover", "name": "Cover", "by": []}
    s = credits_split.suggest("A", "Song (Foo Remix) (Free Release)", "")
    assert s["version"]["kind"] == "remix" and s["title"] == "Song"
    assert credits_split.suggest("A", "Song (Release)", "")["version"] is None


def test_label_channel_title_splits_only_with_a_release_tag():
    assert titles.split_title("Magic Club", TITLE) == ("Twin & Elise Lieberth", "In The End (Magic Cover Release)", None)
    assert titles.split_title("Some Channel", "A - B (Live)")[0] == "Some Channel"


def test_mashup_by_title_from_the_extractor_strings():
    t = "КИНО x LXST CXNTURY - КОНЧИТСЯ ODIUM (mashup by yaukoshi)"
    a, ti, r = titles.split_title("yaukoshi", t)
    s = credits_split.suggest(a, ti, r)
    assert s["artists"] == ["yaukoshi"]
    assert s["title"] == "КОНЧИТСЯ ODIUM"
    assert s["version"] == {"kind": "mashup", "name": "mashup by yaukoshi", "by": [], "of": ["КИНО", "LXST CXNTURY"]}
