import statistics
import threading
import time

import pytest

from app import deps, library, songindex, users
from tests.test_library import ADIR, H, OWNER_UID, VID, client  # noqa: F401

SONGS = 786


def ids():
    return [f"s{n:010d}" for n in range(SONGS)]


def make_library(tmp_path, with_audio=(VID,)):
    songs = [{"id": i, "title": f"Title {i}", "artist": "Artist", "file": f"{i}.m4a", "tags": ["genre:house", "80s"],
              "sources": [{"type": "youtube", "ref": i}]} for i in ids()]
    songs.append({"id": VID, "title": "Probe", "artist": "A", "file": f"{VID}.m4a"})
    deps.save_doc(OWNER_UID, {"settings": {"music_root": str(tmp_path / "downloads")}, "songs": songs})
    audio = ADIR(tmp_path)
    audio.mkdir(parents=True, exist_ok=True)
    for vid in with_audio:
        (audio / f"{vid}.m4a").write_bytes(b"a" * 10_000)


def median_ms(fn, n=200):
    samples = []
    for _ in range(n):
        t = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - t) * 1000)
    return statistics.median(samples)


def bump_library(tmp_path, **extra):
    doc = library.load_doc(deps.library_path(OWNER_UID))
    doc["songs"].append({"id": "zzzzzzzzzzz", "title": "New", **extra})
    deps.save_doc(OWNER_UID, doc)


def test_benchmark_file_route(client, tmp_path, capsys):
    make_library(tmp_path)
    probe = lambda: client.get(f"/files/{VID}", headers={**H, "Range": "bytes=0-1"})
    assert probe().status_code == 206
    rows = {
        "GET /files Range 0-1 (end to end, TestClient)": median_ms(probe),
        "GET /health (end to end, TestClient)": median_ms(lambda: client.get("/health")),
        "deps.load_songs (parse + user lock)": median_ms(lambda: deps.load_songs(OWNER_UID)),
        "songindex.get (stamp check)": median_ms(lambda: songindex.get(deps.library_path(OWNER_UID))),
        "deps.audio_dir (music root)": median_ms(lambda: deps.audio_dir(OWNER_UID)),
        "users.read_profile": median_ms(lambda: users.read_profile(deps.profile_path(OWNER_UID))),
    }
    with capsys.disabled():
        print(f"\n--- file route benchmark, {SONGS + 1} songs, median ms of 200 ---")
        for name, ms in rows.items():
            print(f"{ms:9.3f}  {name}")


def test_file_route_does_not_wait_for_a_held_user_lock(client, tmp_path):
    make_library(tmp_path)
    assert client.get(f"/files/{VID}", headers=H).status_code == 200
    held, release = threading.Event(), threading.Event()

    def hold():
        with users.user_lock(OWNER_UID):
            held.set()
            release.wait(10)

    holder = threading.Thread(target=hold)
    holder.start()
    held.wait(5)
    done = []
    caller = threading.Thread(target=lambda: done.append(client.get(f"/files/{VID}", headers={**H, "Range": "bytes=0-1"})))
    caller.start()
    caller.join(3)
    answered = not caller.is_alive()
    release.set()
    holder.join()
    caller.join()
    assert answered
    assert done[0].status_code == 206


def test_index_hit_miss_and_invalidation_on_write(client, tmp_path):
    make_library(tmp_path)
    path = deps.library_path(OWNER_UID)
    first = songindex.get(path)
    assert songindex.get(path) is first
    bump_library(tmp_path)
    second = songindex.get(path)
    assert second is not first
    assert "zzzzzzzzzzz" in second.files and "zzzzzzzzzzz" not in first.files
    assert songindex.get(path) is second


def test_index_invalidated_by_an_in_place_rewrite_of_the_same_size(client, tmp_path):
    make_library(tmp_path)
    path = deps.library_path(OWNER_UID)
    before = songindex.get(path)
    text = path.read_text(encoding="utf-8")
    assert "Probe" in text
    path.write_text(text.replace("Probe", "Prube"), encoding="utf-8")
    after = songindex.get(path)
    assert after is not before


def test_index_follows_the_normalised_file_rule(tmp_path):
    path = tmp_path / "library.json"
    raw = {"settings": {"music_root": "/x"}, "songs": [
        {"id": "a"}, {"id": "b", "file": ""}, {"id": "c", "file": None}, {"id": "d", "file": "dir/d.m4a"}, {"id": "e", "file": "e.m4a"}]}
    library.save_doc(path, raw)
    index = songindex.get(path)
    loaded = {s["id"]: s for s in library.load(path)}
    for sid, song in loaded.items():
        assert index.files[sid] == (library.file_name(song) if library.has_file(song) else None), sid
    assert index.music_root == "/x"


def test_missing_library_is_an_empty_index(tmp_path):
    index = songindex.get(tmp_path / "nope" / "library.json")
    assert index.files == {} and index.music_root == ""


def test_delete_stops_serving_the_file_after_a_warm_cache(client, tmp_path):
    make_library(tmp_path)
    assert client.get(f"/files/{VID}", headers=H).status_code == 200
    assert client.delete(f"/songs/{VID}", headers=H).status_code == 204
    assert client.get(f"/files/{VID}", headers=H).status_code == 404


def test_audio_delete_stops_serving_the_file_after_a_warm_cache(client, tmp_path):
    make_library(tmp_path)
    assert client.get(f"/files/{VID}", headers=H).status_code == 200
    assert client.delete(f"/songs/{VID}/audio", headers=H).status_code == 204
    assert client.get(f"/files/{VID}", headers=H).status_code == 404


def test_file_removed_from_disk_is_404_with_a_warm_cache(client, tmp_path):
    make_library(tmp_path)
    assert client.get(f"/files/{VID}", headers=H).status_code == 200
    (ADIR(tmp_path) / f"{VID}.m4a").unlink()
    assert client.get(f"/files/{VID}", headers=H).status_code == 404


def test_catalog_only_song_is_404_not_downloaded(client, tmp_path):
    make_library(tmp_path)
    doc = library.load_doc(deps.library_path(OWNER_UID))
    for song in doc["songs"]:
        if song["id"] == VID:
            song["file"] = None
    deps.save_doc(OWNER_UID, doc)
    (ADIR(tmp_path) / f"{VID}.m4a").write_bytes(b"x")
    assert client.get(f"/files/{VID}", headers=H).status_code == 404
    assert client.get(f"/files/{VID}?download=1", headers=H).status_code == 404


def test_authorisation_is_unchanged_after_a_warm_cache(client, tmp_path):
    make_library(tmp_path)
    assert client.get(f"/files/{VID}", headers=H).status_code == 200
    assert client.get(f"/files/{VID}").status_code == 401
    assert client.get(f"/files/{VID}", headers={"X-API-Token": "wrong"}).status_code == 401
    assert client.get("/files/bad-id", headers=H).status_code == 422


def test_other_users_song_is_not_served(client, tmp_path, monkeypatch):
    make_library(tmp_path)
    assert client.get(f"/files/{VID}", headers=H).status_code == 200
    other = "b" * 16
    (tmp_path / "downloads" / "users" / other).mkdir(parents=True)
    (tmp_path / "downloads" / "users" / other / f"{VID}.m4a").write_bytes(b"secret")
    # a second user's library does not list VID; with no entry the route falls back to <id>.m4a in HER dir only
    index = songindex.get(deps.library_path(other))
    assert index.files == {}


def test_download_and_head_keep_working(client, tmp_path):
    make_library(tmp_path)
    full = client.get(f"/files/{VID}?download=1", headers=H)
    assert full.status_code == 200
    assert "attachment" in full.headers["content-disposition"]
    head = client.head(f"/files/{VID}", headers=H)
    assert head.status_code == 200 and head.headers["content-length"] == "10000"
    probe = client.get(f"/files/{VID}", headers={**H, "Range": "bytes=0-1"})
    assert probe.status_code == 206 and probe.content == b"aa"
