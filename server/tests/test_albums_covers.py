import io
import json

import pytest
from PIL import Image

from app import album_covers, coverimg, deps, discogs_cover, library, wiki_lookup
from app.problems import Problem
from tests.test_albums import discogs, made_album, preview, stored  # noqa: F401
from tests.test_albums_youtube import A, B, LIST, PL_URL, commit_body, sel, yt  # noqa: F401
from tests.test_library import H, OWNER_UID, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who  # noqa: F401

REAL_FETCH_JPEG = album_covers.fetch_jpeg
IMG = "https://i.discogs.com/abc/front.jpg"
THUMB = "https://i.discogs.com/abc/front150.jpg"
WIKI = "https://upload.wikimedia.org/x/Tumult.jpg"
YT = "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg"
DISCOGS_DOC = {"images": [{"type": "secondary", "uri": "https://i.discogs.com/abc/back.jpg", "uri150": "https://i.discogs.com/abc/back150.jpg", "width": 400, "height": 400},
                          {"type": "primary", "uri": IMG, "uri150": THUMB, "width": 600, "height": 600},
                          {"type": "primary", "uri": "https://evil.example/x.jpg"}]}


def picture(fmt="PNG", size=(300, 200)):
    out = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(out, fmt)
    return out.getvalue()


@pytest.fixture
def covers(monkeypatch, discogs):
    state = {"fetched": [], "fail": set(), "doc": DISCOGS_DOC, "wiki": [{"url": WIKI, "thumb": WIKI + "?t", "title": "Tumult", "source": "wikipedia", "page": "p", "width": 1024, "height": 1024}]}

    def fake_fetch(url):
        state["fetched"].append(url)
        if url in state["fail"]:
            raise Problem(502, "cover_url_unreachable", "no")
        return coverimg.normalize(picture())

    monkeypatch.setattr(album_covers, "fetch_jpeg", fake_fetch)
    monkeypatch.setattr(discogs_cover, "_api", lambda path: state["doc"])
    monkeypatch.setattr(wiki_lookup, "cover_candidates", lambda links: state["wiki"])
    return state


def patch_links(client, album, **links):
    return client.patch(f"/albums/{album['id']}", json={"links": links}, headers=H).json()


def cover_file(tmp_path, album_id, uid=OWNER_UID):
    return tmp_path / "users" / uid / "covers" / "albums" / f"{album_id}.jpg"


def test_a_new_album_gets_the_discogs_cover_first(client, covers, tmp_path):
    album = made_album(client)
    assert album["cover"] == {"source": "discogs", "url": IMG}
    assert album["coverFrom"] == "album"
    assert album["coverUrl"].startswith(f"/albums/{album['id']}/cover?v=")
    assert len(album["coverUrl"].split("=")[1]) == 10
    assert covers["fetched"] == [IMG]
    assert cover_file(tmp_path, album["id"]).is_file()
    img = Image.open(io.BytesIO(cover_file(tmp_path, album["id"]).read_bytes()))
    assert img.format == "JPEG"
    assert img.size == (300, 200)
    served = client.get(album["coverUrl"], headers=H)
    assert (served.status_code, served.headers["content-type"]) == (200, "image/jpeg")
    assert served.content[:2] == b"\xff\xd8"
    assert client.get(f"/albums/{album['id']}", headers=H).json() == album
    row = client.get("/albums", headers=H).json()[0]
    assert (row["cover"], row["coverUrl"], row["coverFrom"]) == (album["cover"], album["coverUrl"], "album")


def test_auto_cover_falls_back_wikipedia_then_youtube_and_never_fails_the_create(client, covers, tmp_path):
    covers["fail"].update({IMG, "https://i.discogs.com/abc/back.jpg"})
    base = preview(client).json()
    got = client.post("/albums", json={**base, "links": {"wikipedia": "https://en.wikipedia.org/wiki/Tumult", "youtube": "https://youtu.be/aaaaaaaaaaa"}}, headers=H)
    assert got.status_code == 201
    assert got.json()["cover"] == {"source": "wikipedia", "url": WIKI}
    assert covers["fetched"] == [IMG, "https://i.discogs.com/abc/back.jpg", WIKI]
    client.delete(f"/albums/{got.json()['id']}", headers=H)
    covers["fail"].update({IMG, "https://i.discogs.com/abc/back.jpg", WIKI})
    got = client.post("/albums", json={**base, "links": {"wikipedia": "https://en.wikipedia.org/wiki/Tumult", "youtube": "https://youtu.be/aaaaaaaaaaa"}}, headers=H).json()
    assert got["cover"] == {"source": "youtube", "url": YT}
    client.delete(f"/albums/{got['id']}", headers=H)
    covers["fail"].add(YT)
    got = client.post("/albums", json={**base, "links": {"youtube": "https://youtu.be/aaaaaaaaaaa"}}, headers=H)
    assert got.status_code == 201
    assert got.json()["cover"] == {"source": None, "url": None}
    assert got.json()["coverUrl"] is None


def test_candidates_list_what_is_available_and_write_nothing(client, covers, tmp_path):
    album = made_album(client)
    client.delete(f"/albums/{album['id']}/cover", headers=H)
    patch_links(client, album, wikipedia="https://en.wikipedia.org/wiki/Tumult", youtube="https://www.youtube.com/watch?v=aaaaaaaaaaa&list=" + LIST)
    before = stored(tmp_path)
    r = client.get(f"/albums/{album['id']}/cover/candidates", headers=H)
    assert r.status_code == 200
    got = r.json()["candidates"]
    assert [(c["source"], c["url"]) for c in got] == [("discogs", IMG), ("discogs", "https://i.discogs.com/abc/back.jpg"), ("wikipedia", WIKI), ("youtube", YT)]
    assert got[0] == {"source": "discogs", "url": IMG, "thumb": THUMB, "width": 600, "height": 600, "label": "Discogs"}
    assert got[2]["thumb"] == WIKI + "?t"
    assert got[3]["width"] == 480
    assert got[3]["label"] == "YouTube thumbnail"
    assert stored(tmp_path) == before
    assert not cover_file(tmp_path, album["id"]).exists()


def test_candidates_are_tolerant(client, covers, monkeypatch):
    album = made_album(client)
    url = f"/albums/{album['id']}/cover/candidates"
    monkeypatch.delenv("DISCOGS_TOKEN")
    assert client.get(url, headers=H).json() == {"candidates": []}
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    covers["doc"] = None
    patch_links(client, album, wikipedia="https://en.wikipedia.org/wiki/Tumult")
    monkeypatch.setattr(wiki_lookup, "cover_candidates", lambda links: (_ for _ in ()).throw(OSError("down")))
    assert client.get(url, headers=H).json() == {"candidates": []}
    assert client.get("/albums/alb_00000000/cover/candidates", headers=H).status_code == 404


def test_the_discogs_search_thumbnail_is_kept_as_a_fallback(client, covers):
    covers["doc"] = None
    cand = {**preview(client).json(), "thumb": THUMB}
    album = client.post("/albums", json=cand, headers=H).json()
    assert album["cover"] == {"source": "discogs", "url": THUMB}
    assert client.post("/albums", json={**cand, "source": {"type": "discogs", "id": "9"}, "thumb": "http://insecure/x.jpg"}, headers=H).json()["cover"]["source"] is None


def test_put_cover_downloads_validates_stores_and_delete_resets(client, covers, tmp_path, monkeypatch):
    covers["doc"] = None
    album = made_album(client)
    assert album["coverUrl"] is None
    monkeypatch.setattr(album_covers, "fetch_jpeg", REAL_FETCH_JPEG)
    monkeypatch.setattr(discogs_cover, "fetch", lambda address: picture("PNG", (2000, 1000)))
    r = client.put(f"/albums/{album['id']}/cover", json={"source": "url", "url": "https://example.com/c.png"}, headers=H)
    assert r.status_code == 200
    out = r.json()
    assert out["cover"] == {"source": "url", "url": "https://example.com/c.png"}
    assert out["coverFrom"] == "album"
    assert out["tracks"]
    assert Image.open(io.BytesIO(cover_file(tmp_path, album["id"]).read_bytes())).size == (1024, 512)
    assert stored(tmp_path)[0]["cover"]["v"]
    assert "v=" in out["coverUrl"]
    monkeypatch.setattr(discogs_cover, "fetch", lambda address: b"not an image")
    bad = client.put(f"/albums/{album['id']}/cover", json={"source": "wikipedia", "url": WIKI}, headers=H)
    assert (bad.status_code, bad.json()["error"]) == (422, "cover_bad_image")
    assert client.get(f"/albums/{album['id']}", headers=H).json()["cover"]["source"] == "url"
    monkeypatch.setattr(discogs_cover, "fetch", lambda address: picture("GIF"))
    assert client.put(f"/albums/{album['id']}/cover", json={"source": "url", "url": WIKI}, headers=H).json()["error"] == "cover_bad_type"
    monkeypatch.setattr(coverimg, "MAX_BYTES", 100)
    monkeypatch.setattr(discogs_cover, "fetch", lambda address: picture("PNG", (400, 400)))
    assert client.put(f"/albums/{album['id']}/cover", json={"source": "url", "url": WIKI}, headers=H).status_code == 413
    gone = client.delete(f"/albums/{album['id']}/cover", headers=H)
    assert gone.status_code == 200
    assert gone.json()["cover"] == {"source": None, "url": None}
    assert gone.json()["coverUrl"] is None
    assert not cover_file(tmp_path, album["id"]).exists()
    assert client.get(f"/albums/{album['id']}/cover", headers=H).status_code == 404
    assert client.delete(f"/albums/{album['id']}/cover", headers=H).status_code == 200


def test_put_cover_refuses_bad_requests(client, covers):
    album = made_album(client)
    url = f"/albums/{album['id']}/cover"
    assert client.put(url, json={"source": "bogus", "url": WIKI}, headers=H).json()["detail"] == {"code": "bad_field", "key": "source"}
    assert client.put(url, json={"source": "url"}, headers=H).status_code == 422
    assert client.put(url, json={"source": "url", "url": ""}, headers=H).status_code == 422
    assert client.put("/albums/alb_00000000/cover", json={"source": "url", "url": WIKI}, headers=H).status_code == 404
    covers["fail"].add(WIKI)
    assert client.put(url, json={"source": "wikipedia", "url": WIKI}, headers=H).status_code == 502
    assert client.get(f"/albums/{album['id']}", headers=H).json()["cover"]["source"] == "discogs"


def test_unsafe_addresses_are_refused_by_the_shared_fetcher(client, covers, monkeypatch):
    album = made_album(client)
    monkeypatch.setattr(album_covers, "fetch_jpeg", REAL_FETCH_JPEG)
    for address in ("http://127.0.0.1/x.png", "https://localhost/x.png", "file:///etc/passwd", "https://user:pw@example.com/x.png", "ftp://example.com/x"):
        r = client.put(f"/albums/{album['id']}/cover", json={"source": "url", "url": address}, headers=H)
        assert r.status_code == 422, address
        assert r.json()["error"] == "cover_url_refused", address


def test_display_falls_back_to_the_first_linked_song_cover(client, covers, tmp_path):
    covers["doc"] = None
    from tests.test_library import add, VID, VID2

    add(client)
    add(client, VID2)
    songs = library.load(deps.library_path(OWNER_UID))
    songs[0].update(cover=None, cover_v=None)
    songs[1].update(cover=f"covers/{VID2}.jpg", cover_v="abc123")
    deps.save_songs(OWNER_UID, songs)
    album = made_album(client)
    assert (album["coverUrl"], album["coverFrom"]) == (None, None)
    url = f"/albums/{album['id']}/tracks"
    assert client.put(f"{url}/1/song", json={"songId": VID}, headers=H).json()["coverUrl"] is None
    linked = client.put(f"{url}/2/song", json={"songId": VID2}, headers=H).json()
    assert (linked["coverUrl"], linked["coverFrom"]) == (f"/covers/{VID2}?v=abc123", "song")
    assert linked["cover"] == {"source": None, "url": None}
    assert client.get(f"/albums/{album['id']}", headers=H).json()["coverUrl"] == f"/covers/{VID2}?v=abc123"
    assert client.get("/albums", headers=H).json()[0]["coverFrom"] == "song"
    covers["fail"].clear()
    own = client.put(f"/albums/{album['id']}/cover", json={"source": "url", "url": WIKI}, headers=H).json()
    assert own["coverFrom"] == "album"
    assert own["coverUrl"].startswith("/albums/")


def test_deleting_an_album_removes_its_cover_file(client, covers, tmp_path):
    album = made_album(client)
    assert cover_file(tmp_path, album["id"]).is_file()
    assert client.delete(f"/albums/{album['id']}", headers=H).status_code == 200
    assert not cover_file(tmp_path, album["id"]).exists()


def test_the_youtube_commit_also_gets_a_cover(client, yt, covers, tmp_path):
    body = commit_body(sel((1, A, "Intro", 60), (2, B, "Two", 10)), fallback={"title": "From videos"})
    out = client.post("/albums/youtube/commit", json={**body, "playlistUrl": f"https://www.youtube.com/watch?v={A}&list={LIST}"}, headers=H).json()
    assert out["album"]["cover"] == {"source": "youtube", "url": f"https://i.ytimg.com/vi/{A}/hqdefault.jpg"}
    assert out["album"]["coverFrom"] == "album"
    assert cover_file(tmp_path, out["album"]["id"]).is_file()


def test_covers_are_per_user_and_need_a_login(multi, covers, discogs):
    c = multi
    a, b = who(c, ALICE), who(c, BOB)
    album = c.post("/albums", json=c.post("/albums/preview", json={"url": "https://www.discogs.com/release/545650"}, headers=a).json(), headers=a).json()
    assert c.get(album["coverUrl"], headers=a).status_code == 200
    assert c.get(album["coverUrl"], headers=b).status_code == 404
    for call in (lambda h: c.get(f"/albums/{album['id']}/cover/candidates", headers=h), lambda h: c.put(f"/albums/{album['id']}/cover", json={"source": "url", "url": WIKI}, headers=h),
                 lambda h: c.delete(f"/albums/{album['id']}/cover", headers=h)):
        assert call(b).status_code == 404
        assert call({}).status_code == 401
    assert c.get(album["coverUrl"]).status_code == 401


def test_upload_a_cover_as_raw_bytes_or_multipart(client, covers, tmp_path, monkeypatch):
    covers["doc"] = None
    album = made_album(client)
    url = f"/albums/{album['id']}/cover"
    r = client.put(url, content=picture("PNG", (2000, 1000)), headers={**H, "Content-Type": "image/png"})
    assert r.status_code == 200
    out = r.json()
    assert out["cover"] == {"source": "upload", "url": None}
    assert out["coverFrom"] == "album"
    assert out["tracks"]
    assert Image.open(io.BytesIO(cover_file(tmp_path, album["id"]).read_bytes())).size == (1024, 512)
    assert client.get(out["coverUrl"], headers=H).status_code == 200
    r = client.put(url, files={"file": ("c.jpg", picture("JPEG", (50, 50)), "image/jpeg")}, headers=H)
    assert r.status_code == 200
    assert r.json()["cover"]["source"] == "upload"
    assert Image.open(io.BytesIO(cover_file(tmp_path, album["id"]).read_bytes())).size == (50, 50)
    assert client.get(f"/albums/{album['id']}", headers=H).json()["cover"] == {"source": "upload", "url": None}
    assert client.get("/albums", headers=H).json()[0]["cover"]["source"] == "upload"


def test_upload_errors_match_the_song_cover_upload(client, covers, monkeypatch):
    covers["doc"] = None
    album = made_album(client)
    url = f"/albums/{album['id']}/cover"
    for body, ctype, status, code in [
        (b"x", "text/plain", 415, "cover_bad_type"), (picture("GIF"), "image/png", 415, "cover_bad_type"),
        (b"not an image", "image/jpeg", 422, "cover_bad_image"), (b"", "image/jpeg", 422, "cover_bad_image"),
    ]:
        r = client.put(url, content=body, headers={**H, "Content-Type": ctype})
        assert (r.status_code, r.json()["error"]) == (status, code), (ctype, body[:10])
    assert client.put(url, files={"other": ("c.png", picture(), "image/png")}, headers=H).json()["error"] == "cover_no_file"
    monkeypatch.setattr(coverimg, "MAX_BYTES", 100)
    assert client.put(url, content=picture("PNG", (400, 400)), headers={**H, "Content-Type": "image/png"}).status_code == 413
    assert client.put(url, content=b"{", headers={**H, "Content-Type": "application/json"}).json()["error"] == "cover_bad_body"
    assert client.put(f"/albums/alb_00000000/cover", content=picture(), headers={**H, "Content-Type": "image/png"}).status_code == 404
    assert client.put(url, content=picture(), headers={"Content-Type": "image/png"}).status_code == 401
    assert client.get(f"/albums/{album['id']}", headers=H).json()["cover"]["source"] is None
