import json

import pytest

from app import migrate_reference_tags as mr, users

OWNER = users.owner_uid()


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(mr.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(mr.deps, "SYNC", None)
    return tmp_path


def song(sid, tags, title="Insomnia", artist="Faithless", year=1995):
    return {"id": sid, "title": title, "mainArtists": [artist], "featuredArtists": [], "releaseYear": year, "tags": tags, "updated_at": "2026-02-02T00:00:00Z"}


def lib(root, uid, songs):
    path = root / "users" / uid / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"settings": {}, "songs": songs}), encoding="utf-8")
    return path


def stored(path):
    return {s["id"]: s for s in json.loads(path.read_text(encoding="utf-8"))["songs"]}


def tags_of(row):
    return [*(f"genre:{g}" for g in row.get("genres", [])), *row.get("tags", [])]


def test_converts_bare_and_genre_prefixed_tags_and_leaves_the_rest(datadir):
    path = lib(datadir, OWNER, [
        song("a", ["classical progressive house", "genre:house", "mood:night"]),
        song("b", ["genre:classical trance", "genre:modern classical", "genre:classical music"]),
        song("c", ["classical no such genre xyz"]),
    ])
    assert mr.run() == 2
    rows = stored(path)
    assert tags_of(rows["a"]) == ["genre:house", "mood:night"]
    assert tags_of(rows["b"]) == ["genre:modern classical", "genre:classical"]
    assert tags_of(rows["c"]) == ["classical no such genre xyz"]
    cat = json.loads((datadir / "genre_references.json").read_text(encoding="utf-8"))
    assert set(cat) == {"progressive house", "trance"}
    entry = cat["progressive house"][0]
    assert (entry["role"], entry["reviewed"], entry["song_id"], entry["artist"], entry["title"], entry["year"]) == ("archetype", False, "a", "Faithless", "Insomnia", 1995)
    assert "sources" not in entry and len(entry["id"]) == 8
    assert (datadir / mr.BACKUP_DIR / OWNER / "library.json").exists()


def test_only_the_owners_library_is_touched(datadir):
    other = lib(datadir, "otheruid", [song("x", ["classical trance"])])
    before = other.read_bytes()
    lib(datadir, OWNER, [song("a", [])])
    assert mr.run() == 0
    assert other.read_bytes() == before and not (datadir / "genre_references.json").exists()


def test_idempotent_marker_and_second_run_changes_nothing(datadir):
    path = lib(datadir, OWNER, [song("a", ["classical trance"])])
    assert mr.run() == 1
    snap = (path.read_bytes(), (datadir / "genre_references.json").read_bytes())
    assert mr.run() == 0
    assert (path.read_bytes(), (datadir / "genre_references.json").read_bytes()) == snap
    assert json.loads(mr.marker_path(OWNER).read_text(encoding="utf-8"))["converted"] == 1


def test_an_existing_reference_is_kept_and_the_tag_still_removed(datadir):
    path = lib(datadir, OWNER, [song("a", ["classical trance"])])
    (datadir / "genre_references.json").write_text(json.dumps({"trance": [{"id": "keep0001", "artist": "faithless", "title": "insomnia", "role": "origin", "reviewed": True}]}), encoding="utf-8")
    assert mr.run() == 0
    cat = json.loads((datadir / "genre_references.json").read_text(encoding="utf-8"))
    assert [e["id"] for e in cat["trance"]] == ["keep0001"] and cat["trance"][0]["role"] == "origin"
    assert tags_of(stored(path)["a"]) == []


def test_disabled_by_env_and_missing_library_are_noops(datadir, monkeypatch):
    path = lib(datadir, OWNER, [song("a", ["classical trance"])])
    monkeypatch.setenv("AUDIO_REFERENCE_TAGS", "0")
    assert mr.run() == 0 and "classical trance" in path.read_text(encoding="utf-8")
    monkeypatch.delenv("AUDIO_REFERENCE_TAGS")
    path.unlink()
    assert mr.run() == 0


def test_logs_counts(datadir, caplog):
    lib(datadir, OWNER, [song("a", ["classical trance", "classical nonsense xyz"])])
    with caplog.at_level("INFO", logger="app.migrate_reference_tags"):
        mr.run()
    assert "1 converted" in caplog.text and "1 left untouched" in caplog.text


def test_parse_tag():
    assert mr.parse_tag("classical trance") == "trance" and mr.parse_tag("genre:Classical  Trance") == "Trance"
    assert mr.parse_tag("modern classical") is None and mr.parse_tag("mood:classical x") is None and mr.parse_tag("classical") is None
