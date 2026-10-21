import json

import pytest

from app import library, migrate_sources as ms

OWNER = "owneruid"
VID = "dQw4w9WgXcQ"
VID2 = "9bZkp7q19f0"


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(ms.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(ms.deps, "SYNC", None)
    monkeypatch.delenv("AUDIO_SOURCES_SHAPE", raising=False)
    return tmp_path


def song(sid, **extra):
    return {"id": sid, "title": "T", "mainArtists": ["A"], "featuredArtists": [], "updated_at": "2026-02-02T00:00:00Z", **extra}


def lib(root, uid, songs):
    path = root / "users" / uid / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"settings": {}, "songs": songs}), encoding="utf-8")
    return path


def stored(path):
    return {s["id"]: s for s in json.loads(path.read_text(encoding="utf-8"))["songs"]}


OLD = [
    song(VID, source_url=f"https://www.youtube.com/watch?v={VID}", sources=[
        {"source": "youtube", "id": VID, "url": f"https://www.youtube.com/watch?v={VID}"},
        {"source": "soundcloud", "id": "a/b", "url": "https://soundcloud.com/a/b"},
    ]),
    song(VID2, sources=[{"platform": "youtube", "url": f"https://youtu.be/{VID2}?t=5"}, {"platform": "other", "url": "https://example.com/x?utm_source=q"}]),
    song("soundcloud-123", source="soundcloud", source_url="https://soundcloud.com/x/y"),
]


def test_converts_every_song_keeps_order_and_drops_nothing(datadir):
    path = lib(datadir, OWNER, OLD)
    assert ms.run() == 3
    rows = stored(path)
    assert rows[VID]["sources"] == [
        {"type": "youtube", "ref": VID, "trim_start": None, "trim_end": None},
        {"type": "soundcloud", "ref": "a/b", "trim_start": None, "trim_end": None},
    ]
    assert [(e["type"], e["ref"]) for e in rows[VID2]["sources"]] == [("youtube", VID2), ("url", "https://example.com/x")]
    assert [(e["type"], e["ref"]) for e in rows["soundcloud-123"]["sources"]] == [("soundcloud", "x/y")]
    assert rows["soundcloud-123"]["source"] == "soundcloud"
    assert all("source_url" not in s for s in rows.values())


def test_unparseable_address_becomes_type_url(datadir):
    path = lib(datadir, OWNER, [song(VID, sources=[{"platform": "youtube", "url": f"https://www.youtube.com/watch?v={VID}"}, {"platform": "web", "url": "weird thing"}])])
    ms.run()
    assert [(e["type"], e["ref"]) for e in stored(path)[VID]["sources"]] == [("youtube", VID), ("url", "weird thing")]


def test_backup_marker_and_second_run_changes_nothing(datadir):
    path = lib(datadir, OWNER, OLD)
    before = path.read_text(encoding="utf-8")
    ms.run()
    backup = datadir / "backups-sources" / OWNER / "library.json"
    assert backup.read_text(encoding="utf-8") == before
    after = path.read_text(encoding="utf-8")
    assert ms.run() == 0
    assert path.read_text(encoding="utf-8") == after
    marker = json.loads((datadir / "backups-sources" / OWNER / "applied.json").read_text(encoding="utf-8"))
    assert marker["marker"] == ms.MARKER_VERSION


def test_already_converted_library_gets_no_backup(datadir):
    path = lib(datadir, OWNER, [song(VID, sources=[{"type": "youtube", "ref": VID, "trim_start": 5, "trim_end": None}])])
    assert ms.run() == 0
    assert not (datadir / "backups-sources" / OWNER / "library.json").exists()
    assert stored(path)[VID]["sources"][0]["trim_start"] == 5


def test_trims_survive_and_conversion_is_idempotent_on_the_data(datadir):
    path = lib(datadir, OWNER, OLD)
    ms.run()
    first = stored(path)
    songs = library.load(path)
    assert [library.clean_sources(s["sources"], s["id"]) for s in songs] == [s["sources"] for s in songs]
    assert stored(path) == first


def test_disabled_by_env(datadir, monkeypatch):
    path = lib(datadir, OWNER, OLD)
    before = path.read_text(encoding="utf-8")
    monkeypatch.setenv("AUDIO_SOURCES_SHAPE", "0")
    assert ms.run() == 0
    assert path.read_text(encoding="utf-8") == before
    assert not (datadir / "backups-sources").exists()


def test_a_broken_library_is_left_alone_and_others_still_run(datadir):
    bad = datadir / "users" / "baduser" / "library.json"
    bad.parent.mkdir(parents=True)
    bad.write_text("{not json", encoding="utf-8")
    path = lib(datadir, OWNER, OLD)
    assert ms.run() == 3
    assert bad.read_text(encoding="utf-8") == "{not json"
    assert stored(path)[VID]["sources"][0]["type"] == "youtube"


def test_live_sample_keeps_titles_artists_genres_ids_and_count(datadir):
    from pathlib import Path

    fixture = Path(__file__).parent / "fixtures" / "live_library_sample.json"
    original = json.loads(fixture.read_text(encoding="utf-8"))["library"]
    path = datadir / "users" / OWNER / "library.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(original), encoding="utf-8")
    before = {s["id"]: library.public_song(s, None) for s in library.load(path)}
    assert ms.run() == len(original["songs"])
    after_raw = json.loads(path.read_text(encoding="utf-8"))["songs"]
    assert [s["id"] for s in after_raw] == [s["id"] for s in original["songs"]]
    assert all("source_url" not in s and all({"type", "ref"} <= set(e) for e in s["sources"]) for s in after_raw)
    after = {s["id"]: library.public_song(s, None) for s in library.load(path)}
    for sid, b in before.items():
        for key in ("title", "artist", "genres", "tags", "source_url"):
            assert after[sid][key] == b[key], (sid, key)
        assert [e["url"] for e in after[sid]["sources"]] == [e["url"] for e in b["sources"]]
    assert ms.run() == 0


def test_a_source_with_only_an_id_is_kept(datadir):
    path = lib(datadir, OWNER, [song(VID, sources=[{"source": "youtube", "id": VID}, {"source": "youtube", "id": VID2}])])
    ms.run()
    assert [(e["type"], e["ref"]) for e in stored(path)[VID]["sources"]] == [("youtube", VID), ("youtube", VID2)]
