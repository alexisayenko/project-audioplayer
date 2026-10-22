import copy
import json
from pathlib import Path

import pytest

from app import genre_vocab, library, migrate_removals as mr

OWNER = "owneruid"
FIXTURE = Path(__file__).parent / "fixtures" / "removal_songs.json"


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(mr.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(mr.deps, "SYNC", None)
    monkeypatch.setattr(mr.users, "owner_uid", lambda: OWNER)
    return tmp_path


@pytest.fixture
def plan_file(tmp_path, monkeypatch):
    def make(songs, name="removals.json", raw=None):
        path = tmp_path / name
        path.write_text(raw if raw is not None else json.dumps({"version": 1, "songs": songs}), encoding="utf-8")
        monkeypatch.setattr(mr, "DATA_FILE", path)
        monkeypatch.setattr(mr, "load_plan", lambda p=path, f=mr.load_plan: f(p))
        return path
    return make


def song(sid, genres, **extra):
    return {"id": sid, "title": sid.upper(), "mainArtists": ["A"], "featuredArtists": [], "genres": genres, "updated_at": "2026-02-02T00:00:00Z", **extra}


def lib(root, uid, songs):
    path = root / "users" / uid / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"settings": {}, "songs": songs}), encoding="utf-8")
    return path


def stored(path):
    return {s["id"]: s for s in json.loads(path.read_text(encoding="utf-8"))["songs"]}


def test_owner_only_present_genres_order_and_updated_at(datadir, plan_file, caplog):
    plan_file({"a": {"remove": ["pop", "rock"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "pop", "disco"], tags=["country:us"]), song("b", ["pop", "house"])])
    other = lib(datadir, "other", [song("a", ["house", "pop", "disco"])])
    before_other = other.read_bytes()
    with caplog.at_level("INFO", logger="app.migrate_removals"):
        assert mr.run() == 1
    s = stored(owner)
    assert s["a"]["genres"] == ["house", "disco"]
    assert s["a"]["updated_at"] == "2026-02-02T00:00:00Z"
    assert s["a"]["tags"] == ["country:us"]
    assert s["b"]["genres"] == ["pop", "house"]
    assert other.read_bytes() == before_other
    assert "genre removals applied for owneruid: 1 songs, 1 removed, 0 added" in caplog.text


def test_never_empties_a_song_and_logs_it(datadir, plan_file, caplog):
    plan_file({"a": {"remove": ["house", "disco"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "disco"])])
    with caplog.at_level("INFO", logger="app.migrate_removals"):
        mr.run()
    assert stored(owner)["a"]["genres"] == ["disco"]
    assert "would be left without a genre" in caplog.text
    report = json.loads(mr.report_path(OWNER).read_text(encoding="utf-8"))
    assert report["removed"] == {"a": ["house"]} and report["skipped"] == {"a": ["disco"]}


def test_backup_report_marker_and_idempotent(datadir, plan_file):
    plan_file({"a": {"remove": ["pop"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "pop"])])
    original = owner.read_bytes()
    assert mr.run() == 1
    assert mr.backup_path(OWNER).read_bytes() == original
    assert mr.marker_path(OWNER).is_file() and mr.report_path(OWNER).is_file()
    assert "backups-genre-removals" in str(mr.backup_path(OWNER)) and "audioplayer" not in str(mr.backup_path(OWNER))
    after = owner.read_bytes()
    lib(datadir, OWNER, [song("a", ["house", "pop"])])
    again = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == again != after


def test_nothing_to_remove_writes_only_the_marker(datadir, plan_file):
    plan_file({"zzz": {"remove": ["pop"]}})
    owner = lib(datadir, OWNER, [song("a", ["house"])])
    before = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == before
    assert mr.marker_path(OWNER).is_file() and not mr.backup_path(OWNER).exists()


def test_switch_off(datadir, plan_file, monkeypatch):
    monkeypatch.setenv("AUDIO_GENRE_REMOVALS", "0")
    plan_file({"a": {"remove": ["pop"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "pop"])])
    before = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == before and not mr.marker_path(OWNER).exists()


@pytest.mark.parametrize("raw", ["{not json", "[]", '{"songs": {"a": {"remove": "pop"}}}', '{"songs": []}'])
def test_malformed_file_is_tolerated(datadir, plan_file, raw, caplog):
    plan_file(None, raw=raw)
    owner = lib(datadir, OWNER, [song("a", ["house", "pop"])])
    before = owner.read_bytes()
    assert mr.run() == 0
    assert owner.read_bytes() == before
    assert "genre removals failed" in caplog.text


def test_a_failure_leaves_the_library_unchanged(datadir, plan_file, monkeypatch, caplog):
    plan_file({"a": {"remove": ["pop"]}})
    owner = lib(datadir, OWNER, [song("a", ["house", "pop"])])
    before = owner.read_bytes()

    def boom(*a, **k):
        raise OSError("disk")

    monkeypatch.setattr(mr.library, "save_doc", boom)
    assert mr.run() == 0
    assert owner.read_bytes() == before and not mr.marker_path(OWNER).exists()
    assert "genre removals failed" in caplog.text


def test_missing_owner_library_is_fine(datadir, plan_file):
    plan_file({"a": {"remove": ["pop"]}})
    assert mr.run() == 0


def test_add_appends_after_the_last_genre_validates_and_is_idempotent(datadir, plan_file, caplog):
    plan_file({"a": {"remove": ["pop"], "add": ["Deep  House", "house", "zzzz qqq"]}, "b": {"remove": [], "add": ["house"]}})
    owner = lib(datadir, OWNER, [song("a", ["pop", "house", "disco"], tags=["country:us"]), song("b", ["house"])])
    with caplog.at_level("INFO", logger="app.migrate_removals"):
        assert mr.run() == 1
    s = stored(owner)
    assert s["a"]["genres"] == ["house", "disco", "deep house"]
    assert s["a"]["tags"] == ["country:us"] and s["a"]["updated_at"] == "2026-02-02T00:00:00Z"
    assert s["b"]["genres"] == ["house"]
    assert "genre removals applied for owneruid: 1 songs, 1 removed, 1 added" in caplog.text
    assert "genre addition skipped for owneruid: song a, not in the vocabulary (zzzz qqq)" in caplog.text
    report = json.loads(mr.report_path(OWNER).read_text(encoding="utf-8"))
    assert report["added"] == {"a": ["deep house"]} and report["unknown"] == {"a": ["zzzz qqq"]}
    after = owner.read_bytes()
    assert mr.run() == 0 and owner.read_bytes() == after


def test_an_added_genre_is_never_removed_and_keeps_a_song_from_being_empty():
    songs = [{"id": "a", "tags": ["genre:pop", "decade:10s"]}]
    result = mr.apply_plan(songs, {"a": ["pop", "deep house"]}, {"a": ["deep house"]})
    assert songs[0]["tags"] == ["genre:deep house", "decade:10s"]
    assert result["removed"] == {"a": ["pop"]} and result["added"] == {"a": ["deep house"]} and not result["skipped"]


def test_clear_empties_the_genres_only_with_the_flag_and_is_idempotent(datadir, plan_file, caplog):
    plan_file({"a": {"clear": True}, "b": {"remove": ["pop", "house"]}})
    owner = lib(datadir, OWNER, [song("a", ["rock", "pop"], tags=["country:us"]), song("b", ["pop", "house"])])
    with caplog.at_level("INFO", logger="app.migrate_removals"):
        assert mr.run() == 1
    s = stored(owner)
    assert s["a"]["genres"] == [] and s["a"]["tags"] == ["country:us"]
    assert s["b"]["genres"] == ["house"]
    assert "song b would be left without a genre (house)" in caplog.text
    report = json.loads(mr.report_path(OWNER).read_text(encoding="utf-8"))
    assert report["cleared"] == {"a": ["rock", "pop"]}
    after = owner.read_bytes()
    assert mr.run() == 0 and owner.read_bytes() == after


def test_a_clear_row_with_remove_or_add_is_rejected(plan_file):
    for row in ({"clear": True, "remove": ["pop"]}, {"clear": True, "add": ["pop"]}):
        plan_file({"a": row})
        with pytest.raises(ValueError):
            mr.load_plan(mr.DATA_FILE)


def test_the_real_file_against_the_live_shape():
    plan, digest = mr.load_plan(mr.DATA_FILE)
    adds = mr.load_adds(mr.DATA_FILE)
    clears = mr.load_clears(mr.DATA_FILE)
    planned = sum(len(v) for v in plan.values())
    assert clears <= set(plan) and not clears & set(adds) and 50 <= len(plan) <= 1000 and planned >= len(plan) and len(digest) == 64 and set(adds) <= set(plan)
    doc = json.loads(mr.DATA_FILE.read_text(encoding="utf-8"))
    assert doc["scope"] == "owner" and doc["approved"] == "2026-10-19"
    assert all(row["title"] for row in doc["songs"].values())
    live = json.loads(FIXTURE.read_text(encoding="utf-8"))["songs"]
    assert {s["id"] for s in live} == set(plan)
    songs = library.normalize({"songs": copy.deepcopy(live)})["songs"]
    before = copy.deepcopy(songs)
    result = mr.apply_plan(songs, plan, adds, clears)
    assert not result["skipped"] and result["unknown"] == {"yQR_NLeXKtw": ["electronic"]}, "the owner's 2026-10-19 row added electronic, a group now (history, already applied live): reported as unknown, not added"
    present = {s["id"]: {t.partition(":")[2] for t in s["tags"] if t.startswith("genre:")} for s in before}
    assert set(result["cleared"]) == clears
    assert sum(len(v) for v in result["removed"].values()) == sum(len(set(v) & present[sid]) for sid, v in plan.items())
    assert result["added"].get("cb6WpqqN1ww") == ["deep house"]
    for old, new in zip(before, songs):
        genres = [t.partition(":")[2] for t in new["tags"] if t.startswith("genre:")]
        assert (genres or new["id"] in clears) and not (new["id"] in clears and genres) and not set(plan[new["id"]]) & set(genres)
        assert {a for a in adds.get(new["id"], []) if genre_vocab.is_canonical(a)} <= set(genres)
        assert {k: v for k, v in new.items() if k != "tags"} == {k: v for k, v in old.items() if k != "tags"}
        assert [t for t in new["tags"] if not t.startswith("genre:")] == [t for t in old["tags"] if not t.startswith("genre:")]


def test_the_real_file_owner_requested_rows():
    plan, _ = mr.load_plan(mr.DATA_FILE)
    adds = mr.load_adds(mr.DATA_FILE)
    live = json.loads(FIXTURE.read_text(encoding="utf-8"))["songs"]
    songs = library.normalize({"songs": copy.deepcopy(live)})["songs"]
    mr.apply_plan(songs, plan, adds, mr.load_clears(mr.DATA_FILE))
    after = {s["id"]: [t.partition(":")[2] for t in s["tags"] if t.startswith("genre:")] for s in songs}
    assert after["tUOpXeagVcg"] == ["synthpop", "moombahton"]
    assert after["o_1aF54DO60"] == ["indie pop", "pop", "dream pop", "baroque pop", "sadcore"]
    assert after["zCz3jDPoAtc"] == ["synthwave", "techno", "electronic", "darksynth"]
    assert after["SDfXbCwmBYg"] == ["synthwave", "spacesynth", "darksynth"]
    assert after["3L21HnrZzxc"] == ["synthwave", "dream pop", "electronic", "darksynth"]
    assert after["6OW1JJwqVRQ"] == ["pop"]
    assert after["8BphNy9ZQMU"] == ["dubstep"]
    assert after["0XFudmaObLI"] == ["deep house", "nu-disco"]
    assert after["dS7Eu05OUH8"] == ["big beat", "electronic", "house", "techno"]
    assert after["pwtT8ysDuDY"] == ["chillwave", "synthwave"]
    assert after["S_HBlzRJxaM"] == ["jazz", "blues", "soul jazz", "hard bop", "soul"]
    assert after["2zXTaB_9JQg"] == ["pop rock", "rock", "soft rock", "classic rock", "blues rock", "pub rock"]
    assert after["dQ03F36U5qg"] == ["melodic techno", "progressive trance", "new age", "electronic", "worldbeat", "trance", "ambient house", "ambient"]
    assert after["13EsiCjsssY"] == ["house", "tech house", "dance pop", "electronic", "electro house"]
    assert after["VLCPkGZ0gpw"] == ["electronic", "house", "big beat", "hip hop", "trance", "trip hop", "breakbeat"]
    assert after["RP0_8J7uxhs"] == ["pop", "ballad", "synthpop", "electronic"]
    assert after["vth-T1u7A58"] == ["pop rock", "new wave", "pop", "alternative rock"]
    assert after["X--F5b5IdqU"] == ["synthpop", "electronic", "electro", "experimental"]
    assert after["7iNbnineUCI"] == ["punk", "pop punk", "alternative rock", "pop rock"]
    assert after["aKpgb2WrGo0"] == ["punk", "folk punk", "folk rock", "romani", "rock"]
    assert after["Epj84QVw2rc"] == ["new wave", "pop", "soft rock", "dance-rock", "art pop"]
    assert after["IbxPoaTdrz0"] == ["electronic", "dance pop", "synthpop", "disco", "pop", "contemporary r&b"]
    assert after["kSIMVnPA994"] == ["ambient", "new age", "electronic", "trance", "synthpop", "techno", "electro"]
    assert after["4mtfnfQoAco"] == ["electronic", "hip hop", "dancehall", "trip hop"]
    assert after["dX3k_QDnzHE"] == ["synthpop", "dream pop", "electronic rock", "electronic", "pop"]
    assert after["ZhIsAZO5gl0"] == ["hard rock", "disco", "heavy metal", "rock", "glam"]
    assert after["TTvcivjxHNY"] == ["progressive house", "melodic techno", "trance", "electronic", "eurodance", "vocal trance", "dance pop"]
    assert after["S-smUALTlFM"] == ["horrorcore", "hip hop"]
    assert after["jxDZ-1sf9Bg"] == ["drum and bass", "electronic"]
    assert after["waS3top6nzs"] == ["gothic metal", "industrial metal", "death metal", "heavy metal"]
    assert after["sVx1mJDeUjY"] == ["synthwave", "synthpop", "witch house", "darkwave"]
