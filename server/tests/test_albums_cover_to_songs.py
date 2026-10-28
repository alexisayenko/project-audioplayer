from app import album_covers, coverimg, deps, library
from tests.test_albums import discogs, link, made_album, preview  # noqa: F401
from tests.test_albums_covers import cover_file, covers  # noqa: F401
from tests.test_library import H, OWNER_UID, VID, VID2, add, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who  # noqa: F401


def url(album):
    return f"/albums/{album['id']}/cover/to-songs"


def song_of(vid):
    return library.find_song(library.load(deps.library_path(OWNER_UID)), vid)


def linked_album(client, *vids):
    for v in vids:
        add(client, v)
    album = made_album(client)
    for no, v in enumerate(vids, 1):
        assert link(client, album, no, v).status_code == 200
    return album


def test_the_album_cover_goes_to_every_linked_song(client, covers, tmp_path):
    album = linked_album(client, VID, VID2)
    version = coverimg.version_of(cover_file(tmp_path, album["id"]).read_bytes())
    r = client.post(url(album), json={}, headers=H)
    assert r.status_code == 200
    assert r.json() == {"linked": 2, "applied": 2, "unchanged": 0, "skipped": 0, "failed": 0}
    for vid in (VID, VID2):
        song = song_of(vid)
        assert (song["cover"], song["cover_v"], song["cover_source"]) == (f"covers/{vid}.jpg", version, "custom")
        assert (tmp_path / "users" / OWNER_UID / "covers" / f"{vid}.jpg").read_bytes() == cover_file(tmp_path, album["id"]).read_bytes()
    assert client.get(f"/covers/{VID}", headers=H).status_code == 200
    again = client.post(url(album), json={}, headers=H).json()
    assert again == {"linked": 2, "applied": 0, "unchanged": 2, "skipped": 0, "failed": 0}


def covers_path(vid):
    return deps.covers_dir(OWNER_UID) / f"{vid}.jpg"


def test_a_mix_of_same_art_and_a_video_thumbnail_counts_each_honestly(client, covers, tmp_path):
    album = linked_album(client, VID, VID2)
    client.post(url(album), json={}, headers=H)
    songs = library.load(deps.library_path(OWNER_UID))
    songs[1].update(cover=f"covers/{VID2}.jpg", cover_v="thumb", cover_source=None)
    deps.save_songs(OWNER_UID, songs)
    covers_path(VID2).write_bytes(b"youtube-thumbnail")
    r = client.post(url(album), json={}, headers=H).json()
    assert r == {"linked": 2, "applied": 1, "unchanged": 1, "skipped": 0, "failed": 0}
    assert covers_path(VID2).read_bytes() == cover_file(tmp_path, album["id"]).read_bytes()
    assert song_of(VID2)["cover_source"] == "custom"


def test_a_record_that_says_the_art_is_there_over_another_file_is_rewritten(client, covers, tmp_path):
    album = linked_album(client, VID, VID2)
    client.post(url(album), json={}, headers=H)
    for vid in (VID, VID2):
        covers_path(vid).write_bytes(b"youtube-thumbnail")
    for overwrite in (False, True):
        covers_path(VID).write_bytes(b"youtube-thumbnail")
        r = client.post(url(album), json={"overwrite": overwrite}, headers=H).json()
        assert r["unchanged"] == 0
        assert r["applied"] == 2
        assert covers_path(VID).read_bytes() == cover_file(tmp_path, album["id"]).read_bytes()
        covers_path(VID2).write_bytes(b"youtube-thumbnail")


def test_a_cover_the_user_chose_is_kept_unless_overwrite(client, covers, tmp_path):
    album = linked_album(client, VID, VID2)
    songs = library.load(deps.library_path(OWNER_UID))
    songs[0].update(cover=f"covers/{VID}.jpg", cover_v="mine", cover_source="custom")
    songs[1].update(cover=None, cover_v=None, cover_source="default")
    deps.save_songs(OWNER_UID, songs)
    first = client.post(url(album), json={"overwrite": False}, headers=H).json()
    assert first == {"linked": 2, "applied": 0, "unchanged": 0, "skipped": 2, "failed": 0}
    assert song_of(VID)["cover_v"] == "mine"
    assert song_of(VID2)["cover_source"] == "default"
    second = client.post(url(album), json={"overwrite": True}, headers=H).json()
    assert second == {"linked": 2, "applied": 2, "unchanged": 0, "skipped": 0, "failed": 0}
    assert song_of(VID)["cover_v"] != "mine"
    assert song_of(VID2)["cover_source"] == "custom"


def test_automatic_covers_are_replaced_without_asking(client, covers):
    album = linked_album(client, VID, VID2)
    songs = library.load(deps.library_path(OWNER_UID))
    songs[0].update(cover=f"covers/{VID}.jpg", cover_v="auto", cover_source=None)
    songs[1].update(cover=None, cover_v=None, cover_source=None, cover_off=True)
    deps.save_songs(OWNER_UID, songs)
    assert client.post(url(album), json={}, headers=H).json()["applied"] == 2
    assert song_of(VID2)["cover_off"] is None


def test_an_unlinked_track_or_a_missing_song_is_not_counted(client, covers):
    add(client)
    album = made_album(client)
    assert client.post(url(album), json={}, headers=H).json() == {"linked": 0, "applied": 0, "unchanged": 0, "skipped": 0, "failed": 0}
    assert link(client, album, 1, VID).status_code == 200
    assert client.post(url(album), json={}, headers=H).json()["linked"] == 1


def test_no_own_cover_is_a_409_and_the_cover_of_a_song_does_not_count(client, covers):
    album = linked_album(client, VID)
    bare = client.delete(f"/albums/{album['id']}/cover", headers=H).json()
    assert bare["coverFrom"] != "album"
    r = client.post(url(album), json={}, headers=H)
    assert (r.status_code, r.json()["detail"]) == (409, "no_cover")


def test_one_failing_write_is_counted_and_the_others_are_saved(client, covers, monkeypatch):
    album = linked_album(client, VID, VID2)
    real = album_covers.write_bytes_atomic

    def flaky(dest, data):
        if dest.name == f"{VID}.jpg":
            raise OSError("disk")
        real(dest, data)

    monkeypatch.setattr(album_covers, "write_bytes_atomic", flaky)
    r = client.post(url(album), json={}, headers=H).json()
    assert (r["applied"], r["failed"]) == (1, 1)
    assert song_of(VID).get("cover_source") != "custom"
    assert song_of(VID2)["cover_source"] == "custom"


def test_unknown_bad_or_foreign_album_and_bad_body(client, covers):
    album = linked_album(client, VID)
    assert client.post("/albums/alb_nope/cover/to-songs", json={}, headers=H).status_code == 404
    assert client.post("/albums/BAD!/cover/to-songs", json={}, headers=H).status_code == 404
    assert client.post(url(album), json={"overwrite": "maybe"}, headers=H).status_code == 422
    assert client.post(url(album), json={}).status_code == 401


def test_it_is_per_user(multi, covers, discogs):
    c = multi
    a, b = who(c, ALICE), who(c, BOB)
    album = c.post("/albums", json=preview(c, headers=a).json(), headers=a).json()
    assert c.post(url(album), json={}, headers=b).status_code == 404
    assert c.post(url(album), json={}, headers=a).status_code == 200
