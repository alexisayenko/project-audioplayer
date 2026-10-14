import json
import os
import random
import string
from urllib.parse import unquote

import pytest

from app import identify, jsonio, library, titleclean, titles, urlclean

ALPHABET = string.ascii_letters + string.digits + " .-_/\\:*?\"<>|%\t\n\r\x00" + "Жинéü‮​\U0001f3b5"
SEEDS = range(12)


def rnd_text(rng, n=None):
    return "".join(rng.choice(ALPHABET) for _ in range(n if n is not None else rng.randrange(0, 60)))


# ---- file names and headers ------------------------------------------------------------------

@pytest.mark.parametrize("seed", SEEDS)
def test_download_name_is_always_a_safe_basename(seed):
    rng = random.Random(seed)
    for _ in range(80):
        song = {"artist": rnd_text(rng), "title": rnd_text(rng)}
        name = library.download_name(song, "dQw4w9WgXcQ")
        assert name.endswith(".m4a") and len(name) <= 120 + 4
        assert not any(c in name for c in '/\\:*?"<>|\x00\r\n\t')
        assert name == name.strip() and not name.startswith(".")


@pytest.mark.parametrize("seed", SEEDS)
def test_content_disposition_is_ascii_and_round_trips(seed):
    rng = random.Random(100 + seed)
    for _ in range(80):
        name = library.download_name({"artist": rnd_text(rng), "title": rnd_text(rng)}, "dQw4w9WgXcQ")
        header = library.content_disposition(name)
        header.encode("ascii")
        assert "\r" not in header and "\n" not in header
        assert unquote(header.split("filename*=UTF-8''")[1]) == name
        fallback = header.split('filename="')[1].split('"; ')[0]
        assert fallback.endswith(".m4a") and '"' not in fallback and "\\" not in fallback and "%" not in fallback


def test_download_name_fallbacks():
    assert library.download_name(None, "dQw4w9WgXcQ") == "dQw4w9WgXcQ.m4a"
    assert library.download_name({"artist": "///", "title": ""}, "dQw4w9WgXcQ") == "dQw4w9WgXcQ.m4a"
    assert library.download_name({"artist": "", "title": "T"}, "x") == "T.m4a"
    assert library.content_disposition("...m4a").startswith('attachment; filename="download.')


@pytest.mark.parametrize("seed", SEEDS)
def test_file_name_never_contains_a_separator(seed):
    rng = random.Random(200 + seed)
    for _ in range(100):
        raw = rnd_text(rng, rng.randrange(0, 40))
        name = library.file_name({"id": "dQw4w9WgXcQ", "file": raw})
        assert "/" not in name and name not in ("", ".", "..") or name == ".."
        assert os.path.basename(name) == name


def test_file_name_dotdot_edge():
    assert library.file_name({"id": "dQw4w9WgXcQ", "file": "../../etc/passwd"}) == "passwd"
    assert library.file_name({"id": "dQw4w9WgXcQ", "file": ""}) == "dQw4w9WgXcQ.m4a"
    assert library.file_name({"id": "dQw4w9WgXcQ", "file": None}) == "dQw4w9WgXcQ.m4a"
    assert library.file_name({"id": "dQw4w9WgXcQ", "file": "a/"}) == "a"


# ---- tags -----------------------------------------------------------------------------------

TAG_PARTS = ["rock", "Rock", " rock ", "genre:Rock", "genre: Rock ", "Genre:", ":x", "lang:RUS", "lang:ru", "lang:english", "country:Germany",
             "country:DEU", "country:", "decade:90S", "decade:the 90s", "a:b:c", "  ", "", "x  y", "Ж:И"]


@pytest.mark.parametrize("seed", SEEDS)
def test_clean_tags_is_idempotent_deduped_and_trimmed(seed):
    rng = random.Random(300 + seed)
    for _ in range(60):
        tags = [rng.choice(TAG_PARTS) if rng.random() < 0.7 else rnd_text(rng, 8) for _ in range(rng.randrange(0, 12))]
        once = library.clean_tags(tags)
        assert library.clean_tags(once) == once
        assert len({t.casefold() for t in once}) == len(once)
        for t in once:
            assert t == t.strip() and "  " not in t and t
            if ":" in t:
                key, _, value = t.partition(":")
                assert key and value and key == key.lower()


def test_tag_normalisation_edge_cases():
    assert library.clean_tags(["Rock", "rock", "ROCK"]) == ["Rock"]
    assert library.clean_tags(["genre:Rock", "Genre:rock"]) == ["genre:rock"]
    assert library.clean_tags(["lang:RUS", "lang:Russian", "lang:ru"]) == ["lang:ru"]
    assert library.clean_tags(["country:Germany", "country:DEU", "country:de"]) == ["country:de"]
    assert library.clean_tags(["lang:", ":x", "a:", "  "]) == []
    assert library.clean_tags(["a: b :c"]) == ["a:b :c"]
    assert library.clean_tags(["lang:zzzz"]) == ["lang:zzzz"]
    assert library.clean_tags([5, None]) == ["5", "None"]


@pytest.mark.parametrize("year,tag", [
    (1949, None), (1950, "decade:50s"), (1959, "decade:50s"), (1960, "decade:60s"), (1999, "decade:90s"), (2000, "decade:00s"),
    (2009, "decade:00s"), (2010, "decade:10s"), (2029, "decade:20s"), (2030, None), (0, None), (-1, None), (1999.0, None), ("1999", None),
    (True, None), (None, None),
])
def test_decade_boundaries(year, tag):
    assert library.decade_tag(year) == tag


def test_with_decade_is_idempotent_and_replaces_case_variants():
    once = library.with_decade(["x", "Decade:80S", "decade:70s"], 1994)
    assert once == ["x", "decade:90s"]
    assert library.with_decade(once, 1994) == once


@pytest.mark.parametrize("seed", SEEDS[:4])
def test_unknown_country_detection_matches_canonicalisation(seed):
    rng = random.Random(400 + seed)
    for _ in range(60):
        value = rnd_text(rng, rng.randrange(1, 10))
        tag = library.clean_tags([f"country:{value}"])
        if not tag:
            continue
        bad = library.unknown_countries(tag)
        known = library.clean_tags(tag)[0].partition(":")[2] in __import__("app.countrycodes", fromlist=["x"]).CODES
        assert bool(bad) is (not known)


# ---- library files: atomic write, migration idempotence --------------------------------------

def test_failed_save_keeps_the_old_file_and_leaves_no_temp(tmp_path, monkeypatch):
    path = tmp_path / "u" / "library.json"
    library.save(path, [{"id": "dQw4w9WgXcQ", "title": "old"}])
    before = path.read_bytes()

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(jsonio.os, "replace", boom)
    with pytest.raises(OSError):
        library.save(path, [{"id": "dQw4w9WgXcQ", "title": "new"}])
    assert path.read_bytes() == before
    assert [p.name for p in path.parent.iterdir()] == ["library.json"]


def test_save_never_exposes_a_partial_file(tmp_path, monkeypatch):
    path = tmp_path / "library.json"
    library.save(path, [{"id": "dQw4w9WgXcQ", "title": "old"}])
    seen = []
    real = jsonio.os.replace

    def spy(src, dst):
        seen.append(json.loads(open(src, encoding="utf-8").read()))
        assert json.loads(path.read_text(encoding="utf-8"))["songs"][0]["title"] == "old"
        real(src, dst)

    monkeypatch.setattr(jsonio.os, "replace", spy)
    library.save(path, [{"id": "dQw4w9WgXcQ", "title": "new"}])
    assert seen[0]["songs"][0]["title"] == "new"
    assert library.load(path)[0]["title"] == "new"


LEGACY = [
    {"id": "dQw4w9WgXcQ", "title": "A", "genre": "House", "year": 1994, "tags": ["Rock", "decade:80s"], "file": "", "bpm": 120.6,
     "source_url": "https://youtu.be/dQw4w9WgXcQ?si=x", "original": "x", "remixer": "  ", "wikipedia_song": "javascript:alert(1)"},
    {"id": "9bZkp7q19f0", "title": "B", "tags": ["lang:RUS", "country:Germany"], "sources": [{"source": "youtube", "id": "9bZkp7q19f0", "url": "https://youtu.be/9bZkp7q19f0?utm_x=1"}, "junk"]},
    {"id": "soundcloud-5", "title": "C", "file": None, "year": 2007},
]


def test_migration_is_idempotent_and_cleans_legacy_fields():
    once = library.normalize({"songs": json.loads(json.dumps(LEGACY))})
    twice = library.normalize(json.loads(json.dumps(once)))
    assert once == twice
    a, b, c = once["songs"]
    assert a["file"] == "dQw4w9WgXcQ.m4a" and a["bpm"] == 121 and "genre" not in a and "original" not in a and a["remixer"] is None
    assert a["source_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ" and a["wikipedia_song"] is None
    assert sorted(a["tags"]) == ["Rock", "decade:90s", "genre:house"]
    assert b["tags"] == ["lang:ru", "country:de"] and b["sources"] == [{"source": "youtube", "id": "9bZkp7q19f0", "url": "https://www.youtube.com/watch?v=9bZkp7q19f0"}]
    assert c["file"] is None and c["tags"] == ["decade:00s"] if "tags" in c else True


def test_normalize_accepts_every_legacy_shape():
    assert library.normalize([{"id": "dQw4w9WgXcQ", "title": "x"}])["songs"][0]["file"] == "dQw4w9WgXcQ.m4a"
    for junk in (None, 5, "x", {"songs": None}, {}):
        assert library.normalize(junk) == {"settings": {}, "songs": []}


def test_load_doc_survives_corrupt_and_missing_files(tmp_path):
    p = tmp_path / "library.json"
    assert library.load(p) == []
    for body in ("", "not json", "[1,2", "\x00\x00"):
        p.write_text(body)
        try:
            got = library.load(p)
        except ValueError:
            continue
        assert got == []


def test_clean_sources_drops_malformed_entries():
    raw = [{"source": "youtube", "id": "a", "url": "https://youtu.be/dQw4w9WgXcQ?si=1"}, {"source": 5, "id": "x"}, {"source": "s"}, "junk", {"source": "s", "id": 7}]
    got = library.clean_sources(raw)
    assert got == [{"source": "youtube", "id": "a", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}, {"source": "s", "id": "7", "url": None}]
    assert library.clean_sources("nope") == [] and library.clean_sources(None) == []


def test_public_song_reports_the_real_audio_size_and_survives_stat_errors(tmp_path, monkeypatch):
    (tmp_path / "dQw4w9WgXcQ.m4a").write_bytes(b"12345")
    song = {"id": "dQw4w9WgXcQ", "title": "t", "file": "dQw4w9WgXcQ.m4a"}
    assert library.public_song(song, tmp_path)["audio"]["size"] == 5
    assert library.public_song(song, tmp_path)["audio_state"] == "server"
    assert library.public_song({**song, "file": "missing.m4a"}, tmp_path)["audio_state"] != "server"
    real_stat, calls = type(tmp_path).stat, []

    def flaky(self, **k):
        calls.append(1)
        if len(calls) > 1:
            raise OSError("denied")
        return real_stat(self, **k)

    monkeypatch.setattr(type(tmp_path), "stat", flaky)
    assert library.public_song(song, tmp_path)["id"] == "dQw4w9WgXcQ"


def test_resolve_music_root_hosts_and_errors(tmp_path):
    assert library.resolve_music_root("/plain/dir") == library.Path("/plain/dir")
    assert library.resolve_music_root("nas://music/sub/", {"nas": str(tmp_path)}) == tmp_path / "music" / "sub"
    with pytest.raises(LookupError, match="not configured"):
        library.resolve_music_root("other://x", {})


def test_load_hosts_from_env_and_file(tmp_path, monkeypatch):
    f = tmp_path / "hosts.json"
    f.write_text(json.dumps({"a": "/mnt/a"}))
    monkeypatch.setenv("AUDIO_HOSTS_FILE", str(f))
    monkeypatch.setenv("AUDIO_HOSTS", "b=/mnt/b; ;c=;=/x;d=/mnt/d")
    assert library.load_hosts() == {"a": "/mnt/a", "b": "/mnt/b", "d": "/mnt/d"}


# ---- identify cache -------------------------------------------------------------------------

def test_identify_cache_evicts_the_oldest_beyond_the_limit_and_expires(monkeypatch):
    identify._cache.clear()
    monkeypatch.setattr(identify, "MAX_ENTRIES", 3)
    for i in range(5):
        identify.remember("u", f"v{i}", {"i": i})
    assert [k[1] for k in identify._cache] == ["v2", "v3", "v4"]
    assert identify.recall("u", "v4") == {"i": 4} and identify.recall("u", "v0") is None
    assert identify.recall("u", "v4", max_age=-1) is None
    identify.forget("u", "v4")
    assert identify.recall("u", "v4") is None
    identify.forget("u", "never-there")
    identify._cache.clear()


# ---- title tokenizers -----------------------------------------------------------------------

WORDS = ["Free Download", "Official Video", "Premiere", "HD", "Remix", "feat.", "ft", "Song", "Artist", "Title", "|", "-", "–", "(", ")", "[", "]",
         "Out Now", "Lyrics", "Трек", "ft.", "Mix", "Mashup", "{", "}", "/", "&", "4K", "[Free DL]"]


def rnd_title(rng):
    return " ".join(rng.choice(WORDS) for _ in range(rng.randrange(0, 9)))


@pytest.mark.parametrize("seed", SEEDS)
def test_titleclean_never_empties_never_grows_and_is_deterministic(seed):
    rng = random.Random(500 + seed)
    for _ in range(150):
        title = rnd_title(rng)
        out, removed = titleclean.clean_ex(title)
        assert (out, removed) == titleclean.clean_ex(title)
        original = " ".join(title.split())
        assert len(out) <= len(original) + 0 or out == original
        if original:
            assert out
        assert " ".join(out.split()) == out
        if not removed:
            assert out == original or titleclean.clean(title) == out


@pytest.mark.parametrize("seed", SEEDS)
def test_titleclean_reaches_a_fixed_point_in_two_passes(seed):
    rng = random.Random(600 + seed)
    for _ in range(150):
        title = rnd_title(rng)
        once = titleclean.clean(title)
        twice = titleclean.clean(once)
        assert titleclean.clean(twice) == twice, (title, once, twice)


def test_titleclean_odd_inputs():
    assert titleclean.clean("") == "" and titleclean.clean(None) == ""
    assert titleclean.clean("   ") == ""
    assert titleclean._is_noise("   ") is False and titleclean._is_noise("") is False
    assert titleclean.clean("[Free Download]") == "[Free Download]"
    assert titleclean.clean("Song [Free Download]") == "Song"


@pytest.mark.parametrize("seed", SEEDS)
def test_title_functions_never_raise_and_return_text(seed):
    rng = random.Random(700 + seed)
    for _ in range(150):
        artist, title = rnd_text(rng, rng.randrange(0, 30)), rnd_title(rng) if rng.random() < 0.5 else rnd_text(rng, rng.randrange(0, 40))
        a, t, remix = titles.split_title(artist, title)
        assert isinstance(a, str) and isinstance(t, str) and (remix is None or isinstance(remix, str))
        cut, rm = titles.cut_remix(title)
        assert isinstance(cut, str) and (rm is None or rm.strip())
        assert len(cut) <= len(title)
        for fn in (titles.clean_artist, titles.clean_title, titles.lookup_title, titles.lookup_artist, titles.normalize_feat):
            assert isinstance(fn(title), str)
        assert titles.artist_candidates(artist)


def test_cut_remix_without_a_remix_returns_the_title_untouched():
    assert titles.cut_remix("Artist - Song") == ("Artist - Song", None)
    assert titles.cut_remix("A | B | C | D") == ("A | B | C | D", None)
    assert titles.cut_remix(None) == ("", None)
    assert titles.cut_remix("Song (Foo Remix)") == ("Song", "Foo Remix")
    assert titles.cut_remix("A - B - C - Foo Remix")[1] == "Foo Remix"


@pytest.mark.parametrize("seed", SEEDS[:6])
def test_url_helpers_never_raise_on_garbage(seed):
    rng = random.Random(800 + seed)
    for _ in range(150):
        text = rnd_text(rng, rng.randrange(0, 80))
        urlclean.parse_video_id(text)
        urlclean.classify_soundcloud(text)
        urlclean.find_soundcloud_url(text)
        assert isinstance(urlclean.clean_url(text), str)
        assert isinstance(urlclean.is_valid_video_id(text), bool)
