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
    assert tags["soundcloud-168294142"] == ["genre:glitch hop"]
    assert tags["soundcloud-122880128"] == ["genre:house"]
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


def test_rave_breakbeat_hardcore_and_raggacore_folds():
    assert library.clean_tag("genre:rave") == "genre:electronic"
    assert library.clean_tag("genre:breakbeat hardcore") == "genre:breakbeat"
    assert gf.is_dropped("raggacore") and gf.is_dropped("Raggacore") and not gf.is_genre("raggacore")
    assert "raggacore" not in gf.ALIASES
    assert library.clean_tag("genre:raggacore") == ""
    assert library.clean_tags(["genre:raggacore", "genre:house"]) == ["genre:house"]
    assert library.clean_tag("genre:hardcore") == "genre:hardcore"


def _noise_songs():
    return [
        {"id": "JYIaWeVL1JM", "title": "Rhythm", "tags": ["genre:electronic", "genre:eurodance", "genre:euro house", "genre:hardcore", "decade:90s"]},
        {"id": "ylpNEb31k4U", "title": "London", "tags": ["genre:synthpop", "genre:techno", "genre:euro disco", "genre:eurodance", "genre:hardcore", "genre:dubstep", "genre:house"]},
        {"id": "soundcloud-193950580", "title": "WaVeZ", "tags": ["genre:dubstep", "genre:electronic", "genre:future bass", "genre:hardstyle", "genre:hip hop", "genre:breakbeat", "genre:trap", "genre:pop punk"]},
        {"id": "soundcloud-42327170", "title": "Voodoo", "tags": ["genre:techno", "genre:breakbeat", "genre:hardcore", "genre:electronic"]},
        {"id": "other", "title": "Other", "tags": ["genre:hardcore", "genre:hip hop"]},
    ]


def test_one_off_noise_tags_removed_once_keeping_the_rest(datadir, caplog):
    lib = _lib(datadir, OWNER, _noise_songs())
    original = lib.read_text(encoding="utf-8")
    with caplog.at_level("INFO", logger="app.migrate_tags"):
        assert migrate_tags.run() == 1
    tags = _tags(lib)
    assert tags["JYIaWeVL1JM"] == ["genre:electronic", "genre:eurodance", "genre:euro house"]
    assert tags["ylpNEb31k4U"] == ["genre:synthpop", "genre:euro disco", "genre:eurodance", "genre:house"]
    assert set(tags["soundcloud-193950580"]) == {"genre:dubstep", "genre:electronic", "genre:future bass", "genre:breakbeat", "genre:trap"}
    assert "genre:hardcore" in tags["soundcloud-42327170"]
    assert tags["soundcloud-42327170"] == _noise_songs()[3]["tags"]
    assert tags["other"] == ["genre:hardcore", "genre:hip hop"]
    for sid in ("JYIaWeVL1JM", "ylpNEb31k4U", "soundcloud-193950580"):
        assert any(t.startswith("genre:") for t in tags[sid])
        assert f"one-off genre fix applied to song {sid}" in caplog.text
    assert (datadir / "backups-genre-merge" / OWNER / "library.json").read_text(encoding="utf-8") == original


def test_one_off_noise_tags_idempotent_and_owner_only(datadir):
    mine = _lib(datadir, OWNER, _noise_songs())
    other = _lib(datadir, "someoneelse", _noise_songs())
    before = other.read_text(encoding="utf-8")
    assert migrate_tags.run() == 1
    first = mine.read_text(encoding="utf-8")
    assert migrate_tags.run() == 0
    assert mine.read_text(encoding="utf-8") == first
    assert other.read_text(encoding="utf-8") == before


def test_one_off_noise_entries_remove_only_and_leave_no_song_without_a_genre():
    for sid in ("JYIaWeVL1JM", "ylpNEb31k4U", "soundcloud-193950580"):
        remove, add = migrate_tags.ONE_OFF[sid]
        assert remove and not add
    songs = _noise_songs()[:3]
    migrate_tags.apply_one_off(songs)
    assert all(any(t.startswith("genre:") for t in s["tags"]) for s in songs)
