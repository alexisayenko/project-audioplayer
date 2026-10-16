import json

from app import extractor, library, urlclean
from tests.test_library import ADIR, H, ODIR, VID, VID2, add, client  # noqa: F401

LEGACY = {
    "id": VID, "file": f"{VID}.m4a", "title": "Old", "artist": "A", "album": None, "year": 1987,
    "bpm": 113, "source_url": f"https://www.youtube.com/watch?v={VID}", "cover": None,
    "duration": 213, "added_at": "2026-10-01T00:00:00Z", "tags": ["genre:pop", "decade:80s"],
}


def seed(tmp_path, songs, audio=()):
    ODIR(tmp_path).mkdir(parents=True, exist_ok=True)
    (ODIR(tmp_path) / "library.json").write_text(json.dumps({"settings": {}, "songs": songs}))
    music = ADIR(tmp_path)
    music.mkdir(parents=True, exist_ok=True)
    for name in audio:
        (music / name).write_bytes(b"audio")


def meta_only(vid, **kw):
    return {**LEGACY, "id": vid, "file": None, "sources": [], "duration": None, **kw}


def test_legacy_record_unchanged_on_disk_and_derived_at_read(client, tmp_path):
    seed(tmp_path, [LEGACY], audio=[f"{VID}.m4a"])
    before = (ODIR(tmp_path) / "library.json").read_bytes()
    song = client.get("/library", headers=H).json()["songs"][0]
    assert (ODIR(tmp_path) / "library.json").read_bytes() == before
    assert song["audio_state"] == "server"
    assert song["sources"] == [{"platform": "youtube", "url": LEGACY["source_url"], "source": "youtube", "id": VID}]
    assert song["audio"] == {"file": f"{VID}.m4a", "format": "m4a", "size": 5, "duration": 213}
    assert {k: song[k] for k in LEGACY} == LEGACY


def test_state_none_without_file_and_with_missing_file(client, tmp_path):
    seed(tmp_path, [LEGACY, meta_only(VID2)])
    songs = {s["id"]: s for s in client.get("/library", headers=H).json()["songs"]}
    assert songs[VID]["audio_state"] == "none"
    assert "audio" not in songs[VID]
    assert songs[VID2]["audio_state"] == "none"
    assert songs[VID2]["file"] is None
    assert client.get(f"/files/{VID2}", headers=H).status_code == 404


def test_old_record_without_file_key_still_defaults(tmp_path):
    seed(tmp_path, [{k: v for k, v in LEGACY.items() if k != "file"}])
    assert library.load(ODIR(tmp_path) / "library.json")[0]["file"] == f"{VID}.m4a"


def test_metadata_only_add(client, tmp_path):
    r = add(client, audio=False)
    assert r.status_code == 201
    body = r.json()
    assert body["audio_state"] == "none"
    assert body["status"] == "done"
    song = client.get("/library", headers=H).json()["songs"][0]
    assert song["title"] == "Song"
    assert song["file"] is None
    assert song["audio_state"] == "none"
    assert song["sources"][0]["source"] == "youtube"
    assert song["year"] == 1987
    assert not (ADIR(tmp_path) / f"{VID}.m4a").exists()
    stored = json.loads((ODIR(tmp_path) / "library.json").read_text())["songs"][0]
    assert "audio_state" not in stored
    assert "audio" not in stored
    assert stored["file"] is None
    assert add(client, audio=False).status_code == 409
    assert add(client).status_code == 409


def test_default_add_still_downloads_and_records_sources(client, tmp_path):
    assert add(client).status_code == 202
    stored = json.loads((ODIR(tmp_path) / "library.json").read_text())["songs"][0]
    assert stored["sources"] == [{"platform": "youtube", "url": stored["source_url"]}]
    assert client.get("/library", headers=H).json()["songs"][0]["audio_state"] == "server"


def test_delete_audio_keeps_entry_then_delete_song(client, tmp_path):
    add(client)
    assert client.delete(f"/songs/{VID}/audio", headers=H).status_code == 204
    assert not (ADIR(tmp_path) / f"{VID}.m4a").exists()
    song = client.get("/library", headers=H).json()["songs"][0]
    assert song["audio_state"] == "none"
    assert song["file"] is None
    assert song["title"] == "Song"
    assert client.get(f"/files/{VID}", headers=H).status_code == 404
    assert client.delete(f"/songs/{VID}/audio", headers=H).status_code == 204
    assert client.delete(f"/songs/{VID2}/audio", headers=H).status_code == 404
    assert client.delete(f"/songs/{VID}", headers=H).status_code == 204
    assert client.get("/library", headers=H).json()["songs"] == []


def test_delete_song_removes_both(client, tmp_path):
    add(client)
    assert client.delete(f"/songs/{VID}", headers=H).status_code == 204
    assert not (ADIR(tmp_path) / f"{VID}.m4a").exists()
    assert client.get("/library", headers=H).json()["songs"] == []


def test_file_removed_outside_the_api_turns_state_none(client, tmp_path):
    add(client)
    (ADIR(tmp_path) / f"{VID}.m4a").unlink()
    assert client.get("/library", headers=H).json()["songs"][0]["audio_state"] == "none"


def test_catalog_etag_and_304(client):
    add(client)
    r = client.get("/catalog", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["ids"] == [VID]
    assert body["songs"][0]["audio_state"] == "server"
    assert r.headers["etag"] == f'"{body["revision"]}"'
    again = client.get("/catalog", headers={**H, "If-None-Match": r.headers["etag"]})
    assert again.status_code == 304
    assert again.content == b""
    client.patch(f"/songs/{VID}", json={"title": "Changed"}, headers=H)
    changed = client.get("/catalog", headers={**H, "If-None-Match": r.headers["etag"]})
    assert changed.status_code == 200
    assert changed.json()["revision"] != body["revision"]
    add(client, VID2)
    assert client.get("/catalog", headers=H).json()["revision"] != changed.json()["revision"]


def test_catalog_revision_changes_when_audio_removed(client):
    add(client)
    rev = client.get("/catalog", headers=H).json()["revision"]
    client.delete(f"/songs/{VID}/audio", headers=H)
    assert client.get("/catalog", headers=H).json()["revision"] != rev


def test_catalog_since(client, tmp_path):
    old = {**LEGACY, "added_at": "2026-01-01T00:00:00Z"}
    new = meta_only(VID2, added_at="2026-10-10T00:00:00Z")
    seed(tmp_path, [old, new])
    body = client.get("/catalog", params={"since": "2026-06-01T00:00:00Z"}, headers=H).json()
    assert [s["id"] for s in body["songs"]] == [VID2]
    assert body["ids"] == [VID, VID2]
    r = client.get("/catalog", params={"since": "2026-06-01T00:00:00Z"}, headers=H)
    assert client.get(
        "/catalog", params={"since": "2026-06-01T00:00:00Z"}, headers={**H, "If-None-Match": r.headers["etag"]}
    ).status_code == 304
    other = client.get("/catalog", params={"since": "2026-07-01T00:00:00Z"}, headers={**H, "If-None-Match": r.headers["etag"]})
    assert other.status_code == 200
    client.patch(f"/songs/{VID}", json={"title": "Edited"}, headers=H)
    body = client.get("/catalog", params={"since": "2026-06-01T00:00:00Z"}, headers=H).json()
    assert [s["id"] for s in body["songs"]] == [VID, VID2]
    assert client.get("/catalog", params={"since": "yesterday"}, headers=H).status_code == 422


def test_catalog_requires_token(client):
    assert client.get("/catalog").status_code == 401
    assert client.delete(f"/songs/{VID}/audio").status_code == 401


def test_mixed_source_ids(client, tmp_path):
    sc = "soundcloud-123456"
    sp = "spotify-4uLU6hMCjMI75M1A2tKUQC"
    seed(tmp_path, [LEGACY, meta_only(sc, source="soundcloud", source_url="https://soundcloud.com/a/b"),
                    meta_only(sp, source_url="https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC")])
    songs = client.get("/library", headers=H).json()["songs"]
    assert [s["audio_state"] for s in songs] == ["none"] * 3
    assert songs[1]["sources"][0]["source"] == "soundcloud"
    assert songs[2]["sources"][0]["source"] == "spotify"
    assert client.patch(f"/songs/{sp}", json={"title": "Edited"}, headers=H).json()["title"] == "Edited"
    assert client.delete(f"/songs/{sp}", headers=H).status_code == 204
    assert urlclean.source_of(sp) == "spotify"
    assert urlclean.source_of(sc) == "soundcloud"
    assert urlclean.source_of(VID) == "youtube"
    assert not urlclean.is_valid_video_id("spotify-")
    assert not urlclean.is_valid_video_id("spotify-../x")


def test_one_song_carries_several_sources(client, tmp_path):
    song = {**LEGACY, "sources": [
        {"source": "youtube", "id": VID, "url": LEGACY["source_url"]},
        {"source": "spotify", "id": "abc", "url": "https://open.spotify.com/track/abc"},
        {"source": "soundcloud", "id": "soundcloud-9", "url": "https://soundcloud.com/a/b"},
    ]}
    seed(tmp_path, [song])
    out = client.get("/library", headers=H).json()["songs"][0]
    assert [s["source"] for s in out["sources"]] == ["youtube", "spotify", "soundcloud"]
    client.patch(f"/songs/{VID}", json={"title": "X"}, headers=H)
    assert len(json.loads((ODIR(tmp_path) / "library.json").read_text())["songs"][0]["sources"]) == 3


def test_unconfigured_music_root_does_not_break_library(client, tmp_path, monkeypatch):
    seed(tmp_path, [LEGACY, meta_only(VID2)])
    monkeypatch.setenv("AUDIO_MUSIC_ROOT", "nohost://data/")
    monkeypatch.setattr(library, "load_hosts", lambda: {})
    states = [s["audio_state"] for s in client.get("/library", headers=H).json()["songs"]]
    assert states == ["server", "none"]


def test_titles_with_commas_are_stored_verbatim(client, tmp_path):
    title = "Лондон, гуд бай"
    artist = "Земфира, CarMan"
    r = add(client, metadata={"title": title, "artist": artist}, audio=False)
    assert r.status_code == 201
    stored0 = client.get("/library", headers=H).json()["songs"][0]
    assert (stored0["title"], stored0["artist"]) == (title, artist)
    patched = client.patch(f"/songs/{VID}", json={"title": title, "artist": artist, "year": 1999}, headers=H).json()
    assert (patched["title"], patched["artist"]) == (title, artist)
    stored = client.get("/library", headers=H).json()["songs"][0]
    assert (stored["title"], stored["artist"]) == (title, artist)
    raw = json.loads((ODIR(tmp_path) / "library.json").read_text(encoding="utf-8"))["songs"][0]
    assert (raw["title"], raw["mainArtists"], raw["rawTitle"]) == (title, [artist], title)
