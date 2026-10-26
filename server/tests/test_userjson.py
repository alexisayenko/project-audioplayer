import json
import logging

import pytest

from app import albums, drafts, genre_layout, playlists, userjson
from app.problems import Problem
from tests.test_albums import discogs, preview  # noqa: F401
from tests.test_library import H, OWNER_UID, client  # noqa: F401

BROKEN = b'{"drafts": [{"id": "d_0000000000'
LOADERS = {
    "drafts.json": drafts.load,
    "playlists.json": playlists.load,
    "albums.json": albums.load,
    "genre_layout.json": genre_layout.load,
}
EMPTY = {"drafts.json": [], "playlists.json": [], "albums.json": [], "genre_layout.json": genre_layout.empty()}


def user_file(tmp_path, name):
    path = tmp_path / "users" / OWNER_UID / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def copies(path):
    return sorted(path.parent.glob(f"{path.name}.corrupt-*"))


@pytest.mark.parametrize("name", LOADERS)
def test_a_missing_file_is_empty(tmp_path, name):
    assert LOADERS[name](tmp_path / name) == EMPTY[name]
    assert userjson.flagged(tmp_path) == []


@pytest.mark.parametrize("body", [BROKEN, b"", b"\x00\xff", b"[]", b"3", b'"x"'])
@pytest.mark.parametrize("name", LOADERS)
def test_a_corrupt_file_is_refused_and_kept_with_a_copy(tmp_path, name, body):
    path = user_file(tmp_path, name)
    path.write_bytes(body)
    with pytest.raises(Problem) as err:
        LOADERS[name](path)
    assert (err.value.status, err.value.code) == (500, userjson.CODE)
    assert path.read_bytes() == body
    kept = copies(path)
    assert [c.read_bytes() for c in kept] == [body]
    assert userjson.flagged(tmp_path) == [{"file": f"users/{OWNER_UID}/{name}", "copy": kept[0].name}]


@pytest.mark.parametrize("name", LOADERS)
def test_the_same_corruption_is_copied_and_logged_once(tmp_path, caplog, name):
    path = user_file(tmp_path, name)
    path.write_bytes(BROKEN)
    with caplog.at_level(logging.ERROR, logger="audioplayer.userjson"):
        for _ in range(3):
            with pytest.raises(Problem):
                LOADERS[name](path)
    assert len(copies(path)) == 1
    assert [r.levelno for r in caplog.records] == [logging.ERROR]


@pytest.mark.parametrize("name", LOADERS)
def test_a_new_corruption_gets_its_own_copy_and_a_fixed_file_is_read_again(tmp_path, name):
    path = user_file(tmp_path, name)
    path.write_bytes(BROKEN)
    with pytest.raises(Problem):
        LOADERS[name](path)
    path.write_bytes(BROKEN + b"x")
    with pytest.raises(Problem):
        LOADERS[name](path)
    assert len(copies(path)) == 2
    path.write_text("{}", encoding="utf-8")
    assert LOADERS[name](path) == EMPTY[name]
    assert userjson.flagged(tmp_path) == []


@pytest.mark.parametrize("name", LOADERS)
def test_an_unreadable_file_is_refused_without_a_copy(tmp_path, name):
    path = user_file(tmp_path, name)
    path.mkdir()
    with pytest.raises(Problem) as err:
        LOADERS[name](path)
    assert err.value.code == userjson.CODE
    assert copies(path) == []
    assert userjson.flagged(tmp_path) == [{"file": f"users/{OWNER_UID}/{name}", "copy": None}]


@pytest.mark.parametrize("name", LOADERS)
def test_a_copy_that_cannot_be_written_still_refuses(tmp_path, monkeypatch, name):
    def full(path, data):
        raise OSError("disk full")

    monkeypatch.setattr(userjson, "write_bytes_atomic", full)
    path = user_file(tmp_path, name)
    path.write_bytes(BROKEN)
    with pytest.raises(Problem):
        LOADERS[name](path)
    assert userjson.flagged(tmp_path) == [{"file": f"users/{OWNER_UID}/{name}", "copy": None}]


def test_a_good_file_still_loads(tmp_path):
    path = user_file(tmp_path, "playlists.json")
    path.write_text(json.dumps({"playlists": [{"id": "pl_abcdefgh", "name": "Mix", "songs": []}]}), encoding="utf-8")
    assert [p["id"] for p in playlists.load(path)] == ["pl_abcdefgh"]


def test_the_drafts_routes_refuse_and_leave_the_file(client, tmp_path):
    path = user_file(tmp_path, "drafts.json")
    path.write_bytes(BROKEN)
    assert client.get("/drafts", headers=H).status_code == 500
    r = client.post("/drafts", json={"lines": ["A - B"]}, headers=H)
    assert (r.status_code, r.json()["error"]) == (500, userjson.CODE)
    assert path.read_bytes() == BROKEN
    assert len(copies(path)) == 1


def test_the_playlist_routes_refuse_and_leave_the_file(client, tmp_path):
    path = user_file(tmp_path, "playlists.json")
    path.write_bytes(BROKEN)
    assert client.get("/playlists", headers=H).status_code == 500
    r = client.post("/playlists", json={"name": "Mix", "song_ids": []}, headers=H)
    assert (r.status_code, r.json()["error"]) == (500, userjson.CODE)
    assert path.read_bytes() == BROKEN
    assert len(copies(path)) == 1


def test_the_album_routes_refuse_and_leave_the_file(client, discogs, tmp_path):
    payload = preview(client).json()
    path = user_file(tmp_path, "albums.json")
    path.write_bytes(BROKEN)
    assert client.get("/albums", headers=H).status_code == 500
    r = client.post("/albums", json=payload, headers=H)
    assert (r.status_code, r.json()["error"]) == (500, userjson.CODE)
    assert path.read_bytes() == BROKEN
    assert len(copies(path)) == 1


def test_the_genre_layout_is_not_read_as_empty_but_a_save_may_replace_it_after_the_copy(client, tmp_path):
    path = user_file(tmp_path, "genre_layout.json")
    path.write_bytes(BROKEN)
    r = client.get("/me/genre-layout", headers=H)
    assert (r.status_code, r.json()["error"]) == (500, userjson.CODE)
    assert path.read_bytes() == BROKEN
    saved = client.put("/me/genre-layout", json={"positions": {"house": [1, 2]}}, headers=H)
    assert saved.status_code == 200
    assert [c.read_bytes() for c in copies(path)] == [BROKEN]
    assert client.get("/me/genre-layout", headers=H).json()["positions"] == {"house": [1, 2]}
    assert userjson.flagged(tmp_path) == []


def test_the_genre_layout_save_is_refused_when_no_copy_could_be_kept(client, tmp_path, monkeypatch):
    def full(path, data):
        raise OSError("disk full")

    monkeypatch.setattr(userjson, "write_bytes_atomic", full)
    path = user_file(tmp_path, "genre_layout.json")
    path.write_bytes(BROKEN)
    r = client.put("/me/genre-layout", json={"positions": {"house": [1, 2]}}, headers=H)
    assert r.status_code == 500
    assert path.read_bytes() == BROKEN


def test_clearing_a_corrupt_genre_layout_keeps_a_copy_first(client, tmp_path):
    path = user_file(tmp_path, "genre_layout.json")
    path.write_bytes(BROKEN)
    assert client.put("/me/genre-layout", json={"positions": {}, "families": {}}, headers=H).status_code == 200
    assert not path.exists()
    assert [c.read_bytes() for c in copies(path)] == [BROKEN]


def test_health_lists_the_refused_files_for_the_owner_only(client, tmp_path):
    assert "corrupt_files" not in client.get("/health", headers=H).json()
    path = user_file(tmp_path, "drafts.json")
    path.write_bytes(BROKEN)
    client.get("/drafts", headers=H)
    body = client.get("/health", headers=H).json()
    assert body["status"] == "ok"
    assert [f["file"] for f in body["corrupt_files"]] == [f"users/{OWNER_UID}/drafts.json"]
    assert "corrupt_files" not in client.get("/health").json()
    path.write_text("{}", encoding="utf-8")
    client.get("/drafts", headers=H)
    assert "corrupt_files" not in client.get("/health", headers=H).json()

