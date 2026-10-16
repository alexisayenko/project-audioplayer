import json

import pytest

from app import genre_filter as gf, genre_vocab, library, migrate_tags

OWNER = "owneruid"


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(migrate_tags.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(migrate_tags.deps, "SYNC", None)
    monkeypatch.setattr(migrate_tags.users, "owner_uid", lambda: OWNER)
    return tmp_path


def _lib(root, uid, songs):
    d = root / "users" / uid
    d.mkdir(parents=True, exist_ok=True)
    path = d / "library.json"
    path.write_text(json.dumps({"settings": {}, "songs": songs}), encoding="utf-8")
    return path


def _tags(path):
    return {s["id"]: s["tags"] for s in json.loads(path.read_text(encoding="utf-8"))["songs"]}


@pytest.mark.parametrize("value", [
    "aaron smith", "joris", "skrux", "medley", "music video", "party", "popcorn", "functional music", "event music", "party music",
    "Party Music", "west coast swing", "West Coast Swing",
])
def test_leftover_tags_are_dropped(value):
    assert gf.is_dropped(value) and not gf.is_genre(value)
    assert library.clean_tag(f"genre:{value}") == ""


def test_west_coast_swing_is_no_longer_a_retag_but_swing_stays_valid():
    assert "west coast swing" not in gf.RETAGS
    assert gf.vocabulary_name("swing") == "swing"
    assert library.clean_tag("genre:swing") == "genre:swing"
    assert library.clean_tags(["genre:west coast swing", "genre:jazz"]) == ["genre:jazz"]


def test_symbol_tag_keeps_a_non_empty_key_and_retags_to_glitch_hop():
    assert genre_vocab.key("\u2688\u2688") == "\u2688\u2688"
    assert genre_vocab.key("\u2688\u2688") != genre_vocab.key("\u2688")
    assert library.clean_tag("genre:\u2688\u2688") == "genre:glitch hop"
    assert library.clean_tag("genre:\u2688") != "genre:glitch hop"
    assert library.clean_tag("genre:house") == "genre:house"
    assert not gf.is_dropped("\u2688\u2688") and not gf.is_dropped("house")


def _live_songs():
    return [
        {"id": "RVmG_d3HKBA", "title": "Relax", "tags": ["genre:pop", "genre:swing", "genre:glam"]},
        {"id": "soundcloud-168294142", "title": "Point", "tags": ["genre:\u2688\u2688", "decade:10s"]},
        {"id": "soundcloud-122880128", "title": "Air France", "tags": ["genre:joris", "country:fr"]},
        {"id": "soundcloud-158983912", "title": "If You", "tags": ["genre:skrux"]},
        {"id": "wL8DVHuWI7Y", "title": "Memory", "tags": ["genre:music video"]},
        {"id": "0XFudmaObLI", "title": "Dancin", "tags": ["genre:house", "genre:aaron smith"]},
        {"id": "other", "title": "Other", "tags": ["genre:swing", "genre:house"]},
    ]


def test_one_off_table_fixes_only_the_listed_songs_and_backs_up(datadir, caplog):
    lib = _lib(datadir, OWNER, _live_songs())
    original = lib.read_text(encoding="utf-8")
    with caplog.at_level("INFO", logger="app.migrate_tags"):
        assert migrate_tags.run() == 1
    tags = _tags(lib)
    assert tags["RVmG_d3HKBA"] == ["genre:pop", "genre:glam"]
    assert tags["soundcloud-168294142"] == ["genre:glitch hop", "decade:10s"]
    assert tags["soundcloud-122880128"] == ["country:fr", "genre:house"]
    assert tags["soundcloud-158983912"] == ["genre:house"]
    assert tags["wL8DVHuWI7Y"] == ["genre:electronic"]
    assert tags["0XFudmaObLI"] == ["genre:house"]
    assert tags["other"] == ["genre:swing", "genre:house"]
    assert (datadir / "backups-genre-merge" / OWNER / "library.json").read_text(encoding="utf-8") == original
    assert "one-off genre fix applied to song RVmG_d3HKBA" in caplog.text


def test_one_off_table_is_idempotent(datadir):
    lib = _lib(datadir, OWNER, _live_songs())
    migrate_tags.run()
    first = lib.read_text(encoding="utf-8")
    assert migrate_tags.run() == 0
    assert lib.read_text(encoding="utf-8") == first


def test_one_off_table_keeps_an_existing_genre_and_skips_other_users(datadir):
    songs = [{"id": "soundcloud-158983912", "title": "If You", "tags": ["genre:trance"]}]
    mine = _lib(datadir, OWNER, songs)
    other = _lib(datadir, "someoneelse", [{"id": "soundcloud-158983912", "title": "If You", "tags": ["decade:10s"]}, {"id": "RVmG_d3HKBA", "title": "R", "tags": ["genre:swing"]}])
    before = other.read_text(encoding="utf-8")
    assert migrate_tags.run() == 0
    assert _tags(mine)["soundcloud-158983912"] == ["genre:trance"]
    assert other.read_text(encoding="utf-8") == before


def test_one_off_targets_are_canonical():
    for _remove, add in migrate_tags.ONE_OFF.values():
        for t in add:
            assert genre_vocab.is_canonical(t.partition(":")[2])
