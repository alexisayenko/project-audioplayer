import pytest

from app import extractor, library, urlclean
from tests.test_api_edges import owner_add
from tests.test_library import H, VID, VID2  # noqa: F401
from tests.test_library import client  # noqa: F401

SP = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"


@pytest.mark.parametrize("raw,want", [
    (SP + "?si=abc", SP),
    ("http://open.spotify.com/intl-de/album/4uLU6hMCjMI75M1A2tKUQC", "https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC"),
    ("https://open.spotify.com/playlist/4uLU6hMCjMI75M1A2tKUQC", None),
    ("https://open.spotify.com/track/short", None),
    ("https://evil.example/track/4uLU6hMCjMI75M1A2tKUQC", None),
    ("", None), (None, None),
])
def test_clean_spotify_url(raw, want):
    assert urlclean.clean_spotify_url(raw) == want


def test_clean_youtube_and_soundcloud_links():
    assert urlclean.clean_youtube_link("https://youtu.be/9bZkp7q19f0?si=x") == f"https://www.youtube.com/watch?v={VID2}"
    assert urlclean.clean_youtube_link("https://music.youtube.com/watch?v=9bZkp7q19f0&feature=x") == f"https://www.youtube.com/watch?v={VID2}"
    assert urlclean.clean_youtube_link(VID2) is None
    assert urlclean.clean_youtube_link("https://example.com/watch?v=9bZkp7q19f0") is None
    assert urlclean.clean_soundcloud_link("https://soundcloud.com/a/b?utm_x=1") == "https://soundcloud.com/a/b"
    assert urlclean.clean_soundcloud_link("https://on.soundcloud.com/abc123") is None
    assert urlclean.clean_soundcloud_link("https://youtube.com/watch?v=" + VID2) is None


def test_spotify_url_is_stored_cleaned_and_clearable(client):
    assert owner_add(client).status_code == 202
    r = client.patch(f"/songs/{VID}", json={"spotify_url": SP + "?si=1"}, headers=H)
    assert r.json()["spotify_url"] == SP
    assert client.patch(f"/songs/{VID}", json={"spotify_url": "https://example.com/x"}, headers=H).json()["spotify_url"] is None
    assert client.patch(f"/songs/{VID}", json={"spotify_url": SP}, headers=H).json()["spotify_url"] == SP
    assert client.patch(f"/songs/{VID}", json={"spotify_url": ""}, headers=H).json()["spotify_url"] is None


def test_patch_links_edit_sources_and_keep_the_audio(client):
    assert owner_add(client).status_code == 202
    assert client.patch(f"/songs/{VID}", json={"title": "x"}, headers=H).json()["audio_state"] == "server"
    r = client.patch(f"/songs/{VID}", json={"youtube_url": f"https://youtu.be/{VID2}", "soundcloud_url": "https://soundcloud.com/a/b"}, headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["audio_state"] == "server"
    assert body["id"] == VID
    assert body["source_url"] == f"https://www.youtube.com/watch?v={VID2}"
    assert {(e["source"], e["url"]) for e in body["sources"]} == {("youtube", body["source_url"]), ("soundcloud", "https://soundcloud.com/a/b")}
    r = client.patch(f"/songs/{VID}", json={"soundcloud_url": None}, headers=H)
    assert [e["source"] for e in r.json()["sources"]] == ["youtube"]
    assert extractor.source_of(VID) == "youtube"


def test_patch_links_rejects_bad_links_and_clearing_the_own_source(client):
    assert owner_add(client).status_code == 202
    for body in ({"youtube_url": "https://example.com/watch?v=" + VID2}, {"youtube_url": VID2},
                 {"soundcloud_url": "https://youtu.be/" + VID2}, {"soundcloud_url": "https://on.soundcloud.com/abc123"},
                 {"youtube_url": ""}, {"youtube_url": None}):
        assert client.patch(f"/songs/{VID}", json=body, headers=H).status_code == 422, body
    assert client.patch(f"/songs/{VID}", json={"title": "x"}, headers=H).json()["sources"][0]["source"] == "youtube"


def test_old_records_without_sources_are_edited_from_the_derived_source(client):
    assert owner_add(client).status_code == 202
    r = client.patch(f"/songs/{VID}", json={"soundcloud_url": "https://soundcloud.com/a/b"}, headers=H)
    assert [e["source"] for e in r.json()["sources"]] == ["youtube", "soundcloud"]
    assert r.json()["sources"][1]["id"] == "a/b"


def test_download_uses_the_edited_youtube_link(monkeypatch, tmp_path):
    seen = []

    class FakeYDL:
        def __init__(self, opts):
            seen.append(opts["outtmpl"])

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, page, download):
            seen.append(page)
            return {"id": VID2, "title": "t", "duration": 1}

    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    extractor.download_audio(VID, tmp_path, None, f"https://www.youtube.com/watch?v={VID2}")
    assert seen[1] == f"https://www.youtube.com/watch?v={VID2}"
    assert seen[0].endswith(f"{VID}.%(ext)s")
    seen.clear()
    extractor.download_audio(VID, tmp_path)
    assert seen[1] == f"https://www.youtube.com/watch?v={VID}"
