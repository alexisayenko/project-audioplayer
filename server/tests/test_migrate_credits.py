import json
import logging
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import credits, deps, gitstore, library, main, migrate_credits, users
from tests.test_gitstore import git, make_remote
from tests.test_library import H, ODIR, OWNER_UID, client  # noqa: F401

SAMPLE = Path(__file__).parent / "fixtures" / "legacy_library_sample.json"
LEGACY_KEYS = ("artist", "remixer", "remix_year", "year")


def seed(tmp_path, text=None):
    path = ODIR(tmp_path) / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text if text is not None else SAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    return path


def stored(path):
    return json.loads(path.read_text(encoding="utf-8"))


def by_id(doc):
    return {s["id"]: s for s in doc["songs"]}


def test_golden_migration_and_second_run_changes_nothing(client, tmp_path):
    path = seed(tmp_path)
    assert migrate_credits.migrate(path) is True
    first = path.read_bytes()
    assert migrate_credits.migrate(path) is False
    assert path.read_bytes() == first
    assert migrate_credits.run() == 0
    assert path.read_bytes() == first


def test_every_song_is_structured_and_no_legacy_key_remains(client, tmp_path):
    path = seed(tmp_path)
    migrate_credits.migrate(path)
    doc = stored(path)
    assert doc["settings"] == {"music_root": "perkunas://data/music/", "credits_schema": 1}
    assert len(doc["songs"]) == 25
    for song in doc["songs"]:
        assert isinstance(song["artists"], list) and song["featured"] == []
        assert "released" in song
        for key in LEGACY_KEYS:
            assert key not in song, (song["id"], key)


def test_known_songs_migrate_as_documented(client, tmp_path):
    path = seed(tmp_path)
    migrate_credits.migrate(path)
    songs = by_id(stored(path))
    assert songs["aaaaaaaaaa1"]["artists"] == ["Martin Garrix & Tiesto"]
    assert songs["aaaaaaaaaa1"]["released"] is None
    assert songs["aaaaaaaaaa2"]["released"] == 1993
    assert songs["aaaaaaaaaa3"]["artists"] == ["Dua Lipa", "Elton John"]
    assert songs["aaaaaaaaaa3"]["title"] == "Cold Heart (Live, Royal Albert Hall)"
    g = songs["aaaaaaaaaa4"]
    assert g["artists"] == ["Nadia Ali, Starkillers & Alex Kenji"]
    assert g["version"] == {"kind": "remix", "name": "Alesso Remix", "by": [], "year": 2012}
    assert g["raw"] == {"title": "Pressure", "artist": "Nadia Ali, Starkillers & Alex Kenji", "remixer": "Alesso Remix", "year": 2009, "remix_year": 2012}
    assert songs["aaaaaaaaaa6"]["artists"] == ["Kato feat. Jon"]
    assert songs["aaaaaaaaaa7"]["version"]["kind"] == "other"
    assert songs["aaaaaaaaaa9"]["version"] == {"kind": "other", "name": None, "by": [], "year": 2012}
    assert songs["aaaaaaaaab1"]["artists"] == [] and songs["aaaaaaaaab2"]["artists"] == []
    assert songs["aaaaaaaaab3"]["released"] == 2999
    assert songs["aaaaaaaaac2"]["artists"] == ["Земфира, CarMan"]
    assert songs["aaaaaaaaac3"]["artists"] == ["A", "B", "C"]
    assert songs["aaaaaaaaac4"]["artists"] == ["Padded Name"] and songs["aaaaaaaaac4"]["released"] == 1999
    assert "version" not in songs["aaaaaaaaac4"]
    assert songs["aaaaaaaaac5"]["released"] is None and "version" not in songs["aaaaaaaaac5"]
    assert songs["soundcloud-100"]["version"]["name"] == "Foo Bar Remix"


def test_updated_at_and_other_keys_are_untouched(client, tmp_path):
    path = seed(tmp_path)
    before = by_id(json.loads(SAMPLE.read_text(encoding="utf-8")))
    migrate_credits.migrate(path)
    after = by_id(stored(path))
    for sid, old in before.items():
        for key, value in old.items():
            if key not in LEGACY_KEYS and not (sid == "aaaaaaaaac4" and key == "tags"):
                assert after[sid][key] == value, (sid, key)
        assert ("updated_at" in old) == ("updated_at" in after[sid])


def test_the_legacy_projection_survives_the_migration(client, tmp_path):
    path = seed(tmp_path)
    old = json.loads(SAMPLE.read_text(encoding="utf-8"))["songs"]
    migrate_credits.migrate(path)
    after = by_id(stored(path))
    for song in old:
        proj = credits.project(after[song["id"]])
        text = lambda v: v.strip() if isinstance(v, str) and v.strip() else None  # noqa: E731
        year = lambda v: int(v) if isinstance(v, (int, str)) and not isinstance(v, bool) and str(v).isdigit() else None  # noqa: E731
        assert proj == {"artist": text(song.get("artist")), "remixer": text(song.get("remixer")), "year": year(song.get("year")), "remix_year": year(song.get("remix_year"))}, song["id"]


def test_backup_is_created_once_and_never_overwritten(client, tmp_path):
    path = seed(tmp_path)
    original = path.read_text(encoding="utf-8")
    migrate_credits.migrate(path)
    backup = migrate_credits.backup_path(path)
    assert backup == tmp_path / "backups-credits" / OWNER_UID / "library.json"
    assert backup.read_text(encoding="utf-8") == original
    songs = stored(path)
    songs["songs"][0]["artist"] = "Legacy Again"
    songs["songs"][0].pop("artists")
    path.write_text(json.dumps(songs), encoding="utf-8")
    assert migrate_credits.migrate(path) is True
    assert backup.read_text(encoding="utf-8") == original
    assert by_id(stored(path))["aaaaaaaaaa1"]["artists"] == ["Legacy Again"]


def test_a_song_written_by_an_older_build_is_migrated_again(client, tmp_path):
    path = seed(tmp_path)
    migrate_credits.migrate(path)
    doc = stored(path)
    doc["songs"].append({"id": "aaaaaaaaad1", "title": "Old Build", "artist": "Old Artist", "year": 2001, "file": None})
    path.write_text(json.dumps(doc), encoding="utf-8")
    assert migrate_credits.migrate(path) is True
    new = by_id(stored(path))["aaaaaaaaad1"]
    assert new["artists"] == ["Old Artist"] and new["released"] == 2001 and "artist" not in new


def test_the_lazy_path_migrates_in_memory_without_touching_the_file(client, tmp_path):
    path = seed(tmp_path)
    before = path.read_bytes()
    songs = library.load(path)
    assert all(isinstance(s["artists"], list) for s in songs)
    assert path.read_bytes() == before


def test_missing_and_broken_files_are_not_stale(tmp_path):
    assert migrate_credits.migrate(tmp_path / "nope.json") is False
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    assert migrate_credits.migrate(broken) is False


def test_review_file_lists_flagged_songs_with_suggestions(client, tmp_path):
    path = seed(tmp_path)
    migrate_credits.migrate(path)
    migrate_credits.write_review(path)
    review = json.loads(migrate_credits.review_path(path).read_text(encoding="utf-8"))
    assert migrate_credits.review_path(path) == tmp_path / "backups-credits" / f"review-credits-{OWNER_UID}.json"
    assert (review["uid"], review["schema"]) == (OWNER_UID, 1)
    items = {i["id"]: i for i in review["items"]}
    assert set(items["aaaaaaaaaa4"]["flags"]) == {"multi_artist_in_one_pill"}
    assert items["aaaaaaaaaa4"]["suggested"]["artists"] == ["Nadia Ali", "Starkillers", "Alex Kenji"]
    assert items["aaaaaaaaaa4"]["suggested"]["version"] == {"kind": "remix", "by": ["Alesso"]}
    assert items["aaaaaaaaaa5"]["flags"] == ["feat_in_title"]
    assert items["aaaaaaaaaa5"]["suggested"] == {"featured": ["Jon"], "title": "Turn The Lights Off"}
    assert "feat_in_artist" in items["aaaaaaaaaa6"]["flags"]
    assert items["aaaaaaaaaa6"]["suggested"]["artists"] == ["Kato"] and items["aaaaaaaaaa6"]["suggested"]["featured"] == ["Jon"]
    assert items["aaaaaaaaaa7"]["flags"] == ["mixed_by", "remixer_without_remix_word"]
    assert items["aaaaaaaaaa9"]["flags"] == ["remix_year_without_remixer"]
    assert "blank_artist" in items["aaaaaaaaab1"]["flags"] and "blank_artist" in items["aaaaaaaaab2"]["flags"]
    assert "year_out_of_range" in items["aaaaaaaaab3"]["flags"]
    assert "live" in items["aaaaaaaaaa3"]["flags"]
    assert {"remaster", "extended", "unplugged", "acoustic", "edit", "instrumental", "cover"} <= {f for i in items.values() for f in i["flags"]}
    assert "aaaaaaaaac6" not in items and "aaaaaaaaaa2" not in items
    for song in stored(path)["songs"]:
        assert song["artists"] == by_id(stored(path))[song["id"]]["artists"]


def test_review_is_never_applied_to_the_library(client, tmp_path):
    path = seed(tmp_path)
    migrate_credits.migrate(path)
    before = path.read_bytes()
    migrate_credits.write_review(path)
    assert path.read_bytes() == before


def test_review_is_rewritten_only_when_its_content_changed(client, tmp_path, monkeypatch):
    path = seed(tmp_path)
    migrate_credits.migrate(path)
    writes = []
    real = migrate_credits.write_json_atomic
    monkeypatch.setattr(migrate_credits, "write_json_atomic", lambda p, data: (writes.append(p), real(p, data))[1])
    migrate_credits.write_review(path)
    migrate_credits.write_review(path)
    assert len(writes) == 1
    doc = stored(path)
    doc["songs"].append({"id": "aaaaaaaaad2", "title": "Extra (feat. X)", "artists": ["A"], "featured": [], "released": None, "raw": {"title": "Extra (feat. X)", "artist": "A"}})
    path.write_text(json.dumps(doc), encoding="utf-8")
    migrate_credits.write_review(path)
    assert len(writes) == 2


def test_run_logs_a_summary_per_user(client, tmp_path, caplog):
    seed(tmp_path)
    with caplog.at_level(logging.WARNING, logger="app.migrate_credits"):
        assert migrate_credits.run() == 1
    assert any("credits review" in r.message and "multi_artist_in_one_pill" in r.message for r in caplog.records)


def test_one_failing_user_does_not_stop_the_others(client, tmp_path, monkeypatch, caplog):
    first, second = "a" * 16, "b" * 16
    for uid in (first, second):
        d = tmp_path / "users" / uid
        d.mkdir(parents=True)
        (d / "library.json").write_text(json.dumps({"songs": [{"id": "aaaaaaaaaa1", "title": "T", "artist": "A"}]}), encoding="utf-8")
    real = migrate_credits.migrate

    def flaky(path):
        if path.parent.name == first:
            raise RuntimeError("disk on fire")
        return real(path)

    monkeypatch.setattr(migrate_credits, "migrate", flaky)
    with caplog.at_level(logging.ERROR, logger="app.migrate_credits"):
        assert migrate_credits.run() == 1
    assert "credits migration failed" in caplog.text
    assert stored(tmp_path / "users" / second / "library.json")["songs"][0]["artists"] == ["A"]
    assert "artists" not in stored(tmp_path / "users" / first / "library.json")["songs"][0]


def test_every_user_is_migrated_not_only_the_owner(client, tmp_path):
    seed(tmp_path)
    other = tmp_path / "users" / ("c" * 16)
    other.mkdir(parents=True)
    (other / "library.json").write_text(json.dumps({"songs": [{"id": "aaaaaaaaaa1", "title": "T", "artist": "A", "year": 1999}]}), encoding="utf-8")
    assert migrate_credits.run() == 2
    assert stored(other / "library.json")["songs"][0]["released"] == 1999
    assert (tmp_path / "backups-credits" / ("c" * 16) / "library.json").is_file()


def test_startup_migrates(client, tmp_path):
    path = seed(tmp_path)
    with TestClient(main.app):
        pass
    doc = stored(path)
    assert doc["settings"]["credits_schema"] == 1
    assert all("artists" in s for s in doc["songs"])
    assert migrate_credits.review_path(path).is_file()


def test_the_api_serves_the_legacy_projection_before_and_after_the_migration(client, tmp_path):
    path = seed(tmp_path)
    before = client.get("/catalog", headers=H).json()
    migrate_credits.migrate(path)
    after = client.get("/catalog", headers=H).json()
    keys = ("title", "artist", "remixer", "year", "remix_year")
    assert {s["id"]: {k: s[k] for k in keys} for s in before["songs"]} == {s["id"]: {k: s[k] for k in keys} for s in after["songs"]}


@pytest.fixture
def synced(tmp_path, monkeypatch):
    monkeypatch.setenv("GIT_AUTHOR_NAME", "t")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "t@t")
    monkeypatch.setenv("GIT_COMMITTER_NAME", "t")
    monkeypatch.setenv("GIT_COMMITTER_EMAIL", "t@t")
    data_bare, data = make_remote(tmp_path, "data")
    sync = gitstore.GitSync(data, None, backoff=(0.05, 0.1))
    monkeypatch.setattr(deps, "SYNC", sync)
    yield data_bare, data
    sync.stop()


def test_the_migration_is_committed_per_user_and_the_backup_stays_outside_git(synced):
    data_bare, data = synced
    uid = "d" * 16
    lib = data / "audioplayer" / "users" / uid / "library.json"
    lib.parent.mkdir(parents=True)
    lib.write_text(json.dumps({"settings": {}, "songs": [{"id": "aaaaaaaaaa1", "title": "T", "artist": "A", "year": 2000}]}), encoding="utf-8")
    git(data, "add", "-A")
    git(data, "commit", "-m", "seed")
    git(data, "push", "origin", "main")
    assert migrate_credits.run() == 1
    assert git(data_bare, "log", "main", "--format=%s").splitlines()[0] == f"audioplayer: {uid[:8]} migrate credits"
    shipped = json.loads(git(data_bare, "show", f"main:audioplayer/users/{uid}/library.json"))
    assert shipped["songs"][0]["artists"] == ["A"] and shipped["settings"]["credits_schema"] == 1
    assert (data / "backups-credits" / uid / "library.json").is_file()
    tracked = subprocess.run(["git", "ls-files"], cwd=data, capture_output=True, text=True).stdout
    assert "backups-credits" not in tracked
    assert migrate_credits.run() == 0
    assert len(git(data_bare, "log", "main", "--format=%s").splitlines()) == 3
