import json

import pytest

from app import discogs_lookup, genre_filter, genre_vocab, library, migrate_renames as mr

OWNER = "owneruid"


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(mr.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(mr.deps, "SYNC", None)
    return tmp_path


def lib(root, uid, songs):
    path = root / "users" / uid / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"settings": {}, "songs": songs}), encoding="utf-8")
    return path


def song(sid, genres):
    return {"id": sid, "title": sid.upper(), "mainArtists": ["A"], "featuredArtists": [], "genres": genres, "updated_at": "2026-02-02T00:00:00Z"}


def tags_of(path):
    return {s["id"]: library.tag_list(s) for s in json.loads(path.read_text(encoding="utf-8"))["songs"]}


def test_hardcore_becomes_hardcore_techno_for_every_user_with_backup_and_marker(datadir):
    a = lib(datadir, OWNER, [song("a", ["techno", "hardcore", "big beat"]), song("b", ["house"])])
    b = lib(datadir, "other", [song("c", ["hardcore"])])
    assert mr.run() == 2
    assert tags_of(a)["a"] == ["genre:techno", "genre:hardcore techno", "genre:big beat"]
    for path, sid in ((a, "a"), (b, "c")):
        assert "hardcore techno" in json.dumps(json.loads(path.read_text(encoding="utf-8"))["songs"])
    assert (datadir / "backups-genre-rename" / OWNER / "library.json").is_file()
    assert json.loads((datadir / "backups-genre-rename" / "other" / "applied.json").read_text())["songs"] == 1
    assert mr.run() == 0


def test_rerun_changes_nothing_and_other_hardcore_genres_stay(datadir):
    path = lib(datadir, OWNER, [song("a", ["hardcore punk", "happy hardcore", "post-hardcore"])])
    before = path.read_bytes()
    assert mr.run() == 0
    assert path.read_bytes() == before


def test_rename_tags_dedupes_and_keeps_order():
    assert mr.rename_tags(["genre:hardcore techno", "genre:house", "genre:hardcore"]) == ["genre:hardcore techno", "genre:house"]
    assert mr.rename_tags(["genre: Hardcore ", "decade:90s"]) == ["genre:hardcore techno", "decade:90s"]


def test_bare_hardcore_is_not_a_genre_name_or_a_synonym():
    assert genre_vocab.lookup("hardcore") is None
    assert "hardcore" not in genre_vocab.load().entries
    assert genre_filter.vocabulary_name("hardcore") is None
    assert library.clean_tag("genre:hardcore") == "genre:hardcore"
    assert "hardcore" not in genre_vocab._aliases(genre_vocab.load())
    assert genre_vocab.lookup("hardcore techno") == "hardcore techno"


def test_hardcore_is_a_sound_modifier():
    levels, _, _ = genre_vocab.load_levels()
    mods = genre_vocab.vocabulary()["modifiers"]
    assert mods["hardcore"]["kind"] == "sound"
    assert levels["happy hardcore"]["parents"] == ["hardcore techno"]


def test_discogs_hardcore_style_is_the_electronic_one():
    assert discogs_lookup._tags({"styles": ["Hardcore", "Techno"]}) == ["genre:hardcore techno", "genre:techno"]
