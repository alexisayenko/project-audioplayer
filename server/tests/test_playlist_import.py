import threading

import pytest
from fastapi.testclient import TestClient

from app import deps, extractor, main, playlist_import, previewcache, urlclean

H = {"X-API-Token": "secret"}
LIST = "PLabcdefghijklmnop"
URL = f"https://www.youtube.com/playlist?list={LIST}"
A, B, C, D, E = "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd", "eeeeeeeeeee"


def flat(vid, title, channel="Chan", duration=200, **extra):
    return {"id": vid, "title": title, "uploader": channel, "channel": channel, "duration": duration, **extra}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(deps, "DOWNLOAD_DIR", tmp_path / "downloads")
    monkeypatch.setattr(deps, "DATA_DIR", tmp_path)
    monkeypatch.setattr(deps, "JOBS", {})
    monkeypatch.setattr(playlist_import, "DETAIL_DELAY_S", (0, 0))
    playlist_import.reset_limits()
    return TestClient(main.app)


@pytest.fixture
def fake(monkeypatch):
    state = {"entries": [], "total": None, "calls": []}

    def playlist(list_id, limit):
        state["calls"].append((list_id, limit))
        entries = state["entries"][:limit]
        return {"title": "Mix tape", "uploader": "Alex", "total": state["total"] or len(entries), "entries": entries}

    monkeypatch.setattr(extractor, "playlist", playlist)
    return state


def post(client, url=URL, headers=H):
    return client.post("/import/youtube-playlist", json={"url": url}, headers=headers)


def by_id(body):
    return {e["id"]: e for e in body["entries"]}


def test_listing_parses_credits_title_and_year_only_from_youtube_data(client, fake):
    fake["entries"] = [
        flat(A, "Daft Punk - Around the World (Official Video)", channel="Daft Punk"),
        flat(B, "Song (Foo Remix)", channel="Bar"),
    ]
    body = post(client).json()
    assert body["playlist"] == {"id": LIST, "url": URL, "title": "Mix tape", "uploader": "Alex", "total": 2, "shown": 2, "limit": 200, "truncated": False}
    rows = by_id(body)
    first = rows[A]
    assert (first["title"], first["mainArtists"], first["version"], first["state"]) == ("Around the World", ["Daft Punk"], None, "ok")
    assert first["releaseYear"] is None
    assert first["url"] == f"https://www.youtube.com/watch?v={A}"
    assert first["duration"] == 200 and first["detailed"] is False
    second = rows[B]
    assert second["title"] == "Song"
    assert second["mainArtists"] == ["Bar"]
    assert second["version"] == {"type": "remix", "name": "Foo Remix", "artists": ["Foo"], "releaseYear": None}


def test_listing_turns_version_word_brackets_into_the_version(client, fake):
    fake["entries"] = [
        flat(A, "My Heart Is on Fire (Special Extended Version)", upload_date="20190301"),
        flat(B, "Memory Reboot (Slowed)", upload_date="20200101"),
        flat(C, "Passion (Moreno J Remix)", upload_date="20210101"),
        flat(D, "Song (2011 Remaster)", upload_date="20190101"),
        flat(E, "Song (Official Video)", upload_date="20190101"),
    ]
    rows = by_id(post(client).json())
    assert (rows[A]["title"], rows[A]["version"]) == ("My Heart Is on Fire", {"type": "extended", "name": "Special Extended Version", "artists": [], "releaseYear": 2019})
    assert (rows[B]["title"], rows[B]["version"]) == ("Memory Reboot", {"type": "other", "name": "Slowed", "artists": [], "releaseYear": 2020})
    assert (rows[C]["title"], rows[C]["version"]) == ("Passion", {"type": "remix", "name": "Moreno J Remix", "artists": ["Moreno J"], "releaseYear": 2021})
    assert (rows[D]["title"], rows[D]["version"]) == ("Song", {"type": "remaster", "name": "2011 Remaster", "artists": [], "releaseYear": 2011})
    assert (rows[E]["title"], rows[E]["version"], rows[E]["releaseYear"]) == ("Song", None, None)


def test_listing_classifies_mix_and_edit_brackets_by_their_descriptor_words(client, fake):
    fake["entries"] = [
        flat(A, "Song (Extended Mix)", upload_date="20190301"),
        flat(B, "Song (Radio Edit)", upload_date="20190301"),
        flat(C, "Song (Club Mix)", upload_date="20190301"),
        flat(D, "Song (Original Mix)", upload_date="20190301"),
        flat(E, "Song (Moreno J Mix)", upload_date="20190301"),
    ]
    rows = by_id(post(client).json())
    got = {k: (r["title"], r["version"] and (r["version"]["type"], r["version"]["name"], r["version"]["artists"])) for k, r in rows.items()}
    assert got == {
        A: ("Song", ("extended", "Extended Mix", [])),
        B: ("Song", ("edit", "Radio Edit", [])),
        C: ("Song", ("other", "Club Mix", [])),
        D: ("Song", None),
        E: ("Song", ("remix", "Moreno J Mix", ["Moreno J"])),
    }


def test_listing_makes_no_lookup_calls(client, fake, monkeypatch):
    from app import acoustid_lookup, discogs_lookup, genre_lookup, wiki_lookup

    def forbidden(*args, **kwargs):
        raise AssertionError("lookup called")

    for module, name in ((genre_lookup, "suggest_tags"), (genre_lookup, "lookup"), (wiki_lookup, "suggest"), (discogs_lookup, "suggest")):
        monkeypatch.setattr(module, name, forbidden)
    monkeypatch.setattr(acoustid_lookup, "lookup", forbidden, raising=False)
    fake["entries"] = [flat(A, "Artist - Title")]
    assert post(client).status_code == 200


def test_songs_over_five_minutes_are_flagged_long(client, fake):
    fake["entries"] = [flat(A, "A - Short", duration=300), flat(B, "A - Long", duration=301), flat(C, "A - Unknown", duration=None)]
    rows = by_id(post(client).json())
    assert [rows[i]["long"] for i in (A, B, C)] == [False, True, False]


def test_unavailable_entries_are_marked_not_parsed(client, fake):
    fake["entries"] = [flat(A, "[Private video]", duration=None), flat(B, "[Deleted video]", duration=None), flat(C, "[Unavailable video]"), flat(D, "Fine - One")]
    rows = by_id(post(client).json())
    assert [(rows[i]["state"], rows[i]["reason"]) for i in (A, B, C)] == [("unavailable", "Private"), ("unavailable", "Deleted"), ("unavailable", "Unavailable")]
    assert rows[A]["title"] == "[Private video]" and rows[A]["mainArtists"] == []
    assert rows[D]["state"] == "ok"


def test_entries_without_title_and_length_are_private_or_deleted_videos(client, fake):
    fake["entries"] = [
        {"id": A, "title": None, "duration": None, "channel": None, "uploader": None, "availability": None, "thumbnails": [{"url": "x"}]},
        {"id": B, "title": "", "duration": 0},
        {"id": C, "title": None, "duration": 190},
        {"id": D, "title": "Lonely Title", "duration": None},
    ]
    rows = by_id(post(client).json())
    assert (rows[A]["state"], rows[A]["reason"], rows[B]["state"], rows[B]["reason"]) == ("unavailable", "Private or deleted", "unavailable", "Private or deleted")
    assert rows[A]["mainArtists"] == [] and rows[A]["duration"] is None and rows[A]["long"] is False and rows[A]["duplicate"] is None
    assert rows[C]["state"] == "ok" and rows[D]["state"] == "ok"


def test_artist_title_in_the_video_title_is_split_when_the_channel_is_not_the_artist(client, fake):
    fake["entries"] = [
        flat(A, "The Midnight - Love Is An Ocean (Lyrics)", channel="WaveMusic"),
        flat(B, "Xalv - Oblivion | Ana de Armas (Music Video)", channel="Xalv"),
        flat(C, "The Flirts - Passion (Moreno J Remix)", channel="Retro Channel"),
        flat(D, "Live - Anything", channel="Chan"),
        flat(E, "Song - Live at Wembley", channel="Chan"),
    ]
    rows = by_id(post(client).json())
    assert (rows[A]["title"], rows[A]["mainArtists"], rows[A]["version"]) == ("Love Is An Ocean", ["The Midnight"], None)
    assert (rows[B]["title"], rows[B]["mainArtists"]) == ("Oblivion | Ana de Armas", ["Xalv"])
    assert (rows[C]["title"], rows[C]["mainArtists"]) == ("Passion", ["The Flirts"])
    assert rows[C]["version"] == {"type": "remix", "name": "Moreno J Remix", "artists": ["Moreno J"], "releaseYear": None}
    assert (rows[D]["title"], rows[D]["mainArtists"]) == ("Live - Anything", ["Chan"])
    assert (rows[E]["title"], rows[E]["mainArtists"]) == ("Song - Live at Wembley", ["Chan"])


def test_titles_with_two_separators_or_a_listed_artist_field_are_not_split(client, monkeypatch, fake):
    fake["entries"] = [flat(A, "One - Two - Three", channel="Chan")]
    assert by_id(post(client).json())[A]["mainArtists"] == ["Chan"]
    monkeypatch.setattr(extractor, "preview", lambda vid: extractor.meta_from_info(vid, {"title": "Around the World - Radio Edit", "track": "Around the World - Radio Edit", "artist": "Daft Punk", "uploader": "Chan"}))
    row = by_id(client.post("/import/youtube-playlist/details", json={"ids": [A]}, headers=H).json())[A]
    assert (row["mainArtists"], row["title"]) == (["Daft Punk"], "Around the World - Radio Edit")


def test_details_split_the_artist_from_the_title_like_the_listing(client, monkeypatch):
    monkeypatch.setattr(extractor, "preview", lambda vid: extractor.meta_from_info(vid, {"title": "The Midnight - Love Is An Ocean (Lyrics)", "uploader": "WaveMusic", "channel": "WaveMusic", "upload_date": "20200101"}))
    row = by_id(client.post("/import/youtube-playlist/details", json={"ids": [A]}, headers=H).json())[A]
    assert (row["mainArtists"], row["title"], row["detailed"]) == (["The Midnight"], "Love Is An Ocean", True)


def test_duplicates_by_video_id_source_and_title_artist_version(client, fake):
    client.post("/songs", json={"url": A, "audio": False, "metadata": {"title": "Known", "mainArtists": ["Daft Punk"]}}, headers=H)
    client.post("/songs", json={"url": B, "audio": False, "metadata": {"title": "Other Song", "mainArtists": ["Foo"], "version": {"type": "remix", "name": "Bar Remix"}}}, headers=H)
    fake["entries"] = [
        flat(A, "Whatever - Else"),
        flat(C, "Daft Punk - known", channel="Daft Punk"),
        flat(D, "Other Song (Bar Remix)", channel="Foo"),
        flat(E, "Other Song", channel="Foo"),
    ]
    rows = by_id(post(client).json())
    assert rows[A]["duplicate"] == "id"
    assert rows[C]["duplicate"] == "match"
    assert rows[D]["duplicate"] == "match"
    assert rows[E]["duplicate"] is None


def test_repeated_video_ids_are_listed_once(client, fake):
    fake["entries"] = [flat(A, "X - One"), flat(A, "X - One"), flat("short", "bad id")]
    assert [e["id"] for e in post(client).json()["entries"]] == [A]


def test_cap_of_200_entries_reports_the_playlist_total(client, fake):
    fake["entries"] = [flat(f"{i:011d}", f"Artist - Song {i}") for i in range(250)]
    fake["total"] = 250
    body = post(client).json()
    assert fake["calls"] == [(LIST, 200)]
    assert len(body["entries"]) == 200
    assert body["playlist"]["total"] == 250 and body["playlist"]["shown"] == 200 and body["playlist"]["truncated"] is True


def test_exactly_200_is_not_truncated(client, fake):
    fake["entries"] = [flat(f"{i:011d}", f"Artist - Song {i}") for i in range(200)]
    assert post(client).json()["playlist"]["truncated"] is False


@pytest.mark.parametrize("url, error", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "unsupported"),
    ("https://example.com/playlist?list=PLabc123", "unsupported"),
    ("not a link", "unsupported"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ", "mix"),
    ("https://www.youtube.com/playlist?list=RDCLAK5uy_abc", "mix"),
    ("https://www.youtube.com/playlist?list=WL", "private"),
])
def test_invalid_mix_and_private_list_links_are_refused_before_any_lookup(client, fake, url, error):
    r = post(client, url)
    assert r.status_code in (403, 422)
    assert r.json()["error"] == error
    assert r.json()["detail"]
    assert fake["calls"] == []


def test_watch_link_with_a_list_uses_the_list(client, fake):
    fake["entries"] = [flat(A, "A - B")]
    assert post(client, f"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list={LIST}&index=3").status_code == 200
    assert fake["calls"] == [(LIST, 200)]


def test_requests_without_credentials_or_as_guest_are_refused(client, fake, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    assert post(client, headers={}).status_code == 401
    assert client.post("/import/youtube-playlist/details", json={"ids": [A]}).status_code == 401
    assert fake["calls"] == []


def test_not_found_and_private_playlists_map_to_statuses(client, monkeypatch):
    def boom(list_id, limit):
        raise RuntimeError("ERROR: [youtube:tab] x: The playlist does not exist.")

    monkeypatch.setattr(extractor, "playlist", boom)
    r = post(client)
    assert (r.status_code, r.json()["error"]) == (404, "not_found")
    monkeypatch.setattr(extractor, "playlist", lambda *a: (_ for _ in ()).throw(RuntimeError("ERROR: HTTP Error 500")))
    r = post(client)
    assert (r.status_code, r.json()["error"]) == (502, "failed")
    assert "playlist lookup failed" in r.json()["detail"]


def test_listing_is_rate_limited_per_user_but_not_for_the_owner(client, fake, monkeypatch):
    fake["entries"] = [flat(A, "A - B")]
    monkeypatch.setenv("PLAYLIST_IMPORTS_PER_HOUR", "2")
    monkeypatch.setattr(deps, "authenticate", deps.authenticate)
    app_dep = main.app.dependency_overrides
    user = {"method": "session", "uid": "u1", "email": "u@x", "provider": "google", "owner": False}
    app_dep[deps.require_token] = lambda: user
    try:
        assert post(client, headers={}).status_code == 200
        assert post(client, headers={}).status_code == 200
        r = post(client, headers={})
        assert r.status_code == 429
        assert r.json()["error"] == "import_limit"
        assert int(r.headers["Retry-After"]) > 0
        app_dep[deps.require_token] = lambda: {**user, "uid": "owner", "owner": True}
        assert all(post(client, headers={}).status_code == 200 for _ in range(5))
    finally:
        app_dep.clear()


def full_meta(vid, **extra):
    return {"id": vid, "title": "Song (Foo Remix)", "artist": "Bar", "remixer": "Foo Remix", "published_year": 2021, "tags": [],
            "youtube_genres": ["genre:house"], "duration": 250, "thumbnail": "t", "raw": {"title": "Song (Foo Remix)", "artist": "Bar", "remixer": "Foo Remix"}, **extra}


def test_details_return_year_for_a_version_and_genres_from_youtube(client, monkeypatch):
    monkeypatch.setattr(extractor, "preview", lambda vid: full_meta(vid))
    body = client.post("/import/youtube-playlist/details", json={"ids": [A, B]}, headers=H).json()
    assert body["failed"] == []
    row = by_id(body)[A]
    assert row["version"] == {"type": "remix", "name": "Foo Remix", "artists": ["Foo"], "releaseYear": 2021}
    assert row["releaseYear"] is None
    assert row["publishedYear"] == 2021
    assert row["tags"] == ["genre:house"]
    assert row["detailed"] is True


def test_details_year_without_a_version_stays_out_of_the_original_year(client, monkeypatch):
    monkeypatch.setattr(extractor, "preview", lambda vid: full_meta(vid, remixer=None, title="Plain"))
    row = by_id(client.post("/import/youtube-playlist/details", json={"ids": [A]}, headers=H).json())[A]
    assert row["version"] is None and row["releaseYear"] is None and row["publishedYear"] == 2021


def test_details_seed_the_preview_cache_so_adding_does_not_ask_youtube_again(client, monkeypatch):
    calls = []
    monkeypatch.setattr(extractor, "preview", lambda vid: calls.append(vid) or full_meta(vid))
    client.post("/import/youtube-playlist/details", json={"ids": [A]}, headers=H)
    assert previewcache.youtube(A)["id"] == A
    assert calls == [A]


def test_details_report_failed_ids_and_keep_the_rest(client, monkeypatch):
    def preview(vid):
        if vid == B:
            raise RuntimeError("ERROR: Video unavailable")
        return full_meta(vid)

    monkeypatch.setattr(extractor, "preview", preview)
    body = client.post("/import/youtube-playlist/details", json={"ids": [A, B]}, headers=H).json()
    assert [e["id"] for e in body["entries"]] == [A]
    assert body["failed"] == [B]
    assert body["unavailable"] == [B]


def test_details_do_not_call_a_network_failure_unavailable(client, monkeypatch):
    def preview(vid):
        raise RuntimeError("ERROR: Unable to download webpage: Connection reset by peer")

    monkeypatch.setattr(extractor, "preview", preview)
    body = client.post("/import/youtube-playlist/details", json={"ids": [A]}, headers=H).json()
    assert body == {"entries": [], "failed": [A], "unavailable": [], "rate_limited": False}


def test_details_treat_a_content_block_as_unavailable(client, monkeypatch):
    def preview(vid):
        raise RuntimeError("ERROR: [youtube] x: It was blocked due to the claimed content by Someone.")

    monkeypatch.setattr(extractor, "preview", preview)
    assert client.post("/import/youtube-playlist/details", json={"ids": [A]}, headers=H).json()["unavailable"] == [A]


def test_details_stop_after_a_rate_limit_and_say_so(client, monkeypatch):
    ids = [f"{i:011d}" for i in range(6)]
    calls = []

    def preview(vid):
        calls.append(vid)
        if len(calls) == 3:
            raise RuntimeError("ERROR: [youtube] x: Sign in to confirm you\u2019re not a bot.")
        return full_meta(vid, remixer=None, title="Plain")

    monkeypatch.setattr(playlist_import, "DETAIL_WORKERS", 1)
    monkeypatch.setattr(extractor, "preview", preview)
    body = client.post("/import/youtube-playlist/details", json={"ids": ids}, headers=H).json()
    assert body["rate_limited"] is True
    assert [e["id"] for e in body["entries"]] == ids[:2]
    assert body["failed"] == ids[2:]
    assert body["unavailable"] == []
    assert calls == ids[:3]


def test_a_429_error_is_also_a_rate_limit(client, monkeypatch):
    def preview(vid):
        raise RuntimeError("ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests")

    monkeypatch.setattr(extractor, "preview", preview)
    body = client.post("/import/youtube-playlist/details", json={"ids": [A, B]}, headers=H).json()
    assert body["rate_limited"] is True and body["unavailable"] == []


def test_details_pause_between_one_workers_fetches(client, monkeypatch):
    pauses = []
    monkeypatch.setattr(playlist_import, "DETAIL_DELAY_S", (0.5, 1.5))
    monkeypatch.setattr(playlist_import, "DETAIL_WORKERS", 1)
    monkeypatch.setattr(playlist_import.time, "sleep", lambda seconds: pauses.append(seconds))
    monkeypatch.setattr(extractor, "preview", lambda vid: full_meta(vid))
    ids = [f"{i:011d}" for i in range(5)]
    assert len(client.post("/import/youtube-playlist/details", json={"ids": ids}, headers=H).json()["entries"]) == 5
    assert len(pauses) == 4
    assert all(0.5 <= p <= 1.5 for p in pauses)


def test_details_use_few_workers_and_small_batches():
    assert playlist_import.DETAIL_WORKERS == 2 and playlist_import.MAX_DETAIL_IDS == 10 and playlist_import.DETAIL_DELAY_S == (0.5, 1.5)


def test_details_time_out_per_batch(client, monkeypatch):
    monkeypatch.setattr(playlist_import, "DETAIL_TIMEOUT_S", 0.05)
    release = threading.Event()
    monkeypatch.setattr(extractor, "preview", lambda vid: release.wait(5) and full_meta(vid))
    body = client.post("/import/youtube-playlist/details", json={"ids": [A]}, headers=H).json()
    release.set()
    assert body == {"entries": [], "failed": [A], "unavailable": [], "rate_limited": False}


def test_details_validate_ids_and_batch_size(client, monkeypatch):
    monkeypatch.setattr(extractor, "preview", lambda vid: full_meta(vid))
    assert client.post("/import/youtube-playlist/details", json={"ids": ["nope"]}, headers=H).status_code == 422
    assert client.post("/import/youtube-playlist/details", json={"ids": []}, headers=H).status_code == 422
    assert client.post("/import/youtube-playlist/details", json={"ids": [f"{i:011d}" for i in range(11)]}, headers=H).status_code == 422
    assert client.post("/import/youtube-playlist/details", json={"ids": ["soundcloud-123"]}, headers=H).status_code == 422


def test_details_are_rate_limited_by_video_count(client, monkeypatch):
    monkeypatch.setenv("PLAYLIST_DETAILS_PER_HOUR", "3")
    monkeypatch.setattr(extractor, "preview", lambda vid: full_meta(vid))
    user = {"method": "session", "uid": "u2", "email": "u@x", "provider": "google", "owner": False}
    main.app.dependency_overrides[deps.require_token] = lambda: user
    try:
        assert client.post("/import/youtube-playlist/details", json={"ids": [A, B]}).status_code == 200
        r = client.post("/import/youtube-playlist/details", json={"ids": [C, D]})
        assert (r.status_code, r.json()["error"]) == (429, "import_limit")
    finally:
        main.app.dependency_overrides.clear()


def test_parse_playlist_forms():
    assert urlclean.parse_playlist("youtube.com/playlist?list=PLabc123") == ("playlist", "PLabc123")
    assert urlclean.parse_playlist("https://music.youtube.com/playlist?list=OLAK5uy_x&si=1") == ("playlist", "OLAK5uy_x")
    assert urlclean.parse_playlist("https://youtu.be/dQw4w9WgXcQ?list=PLq1") == ("playlist", "PLq1")
    assert urlclean.parse_playlist("https://www.youtube.com/watch?v=dQw4w9WgXcQ") is None
    assert urlclean.parse_playlist("https://www.youtube.com/playlist?list=a%20b") is None
    assert urlclean.parse_playlist("https://www.youtube.com.evil.com/playlist?list=PLq1") is None
    assert urlclean.parse_playlist("http://[::1") is None
    assert urlclean.parse_playlist("https://www.youtube.com/@chan/playlist?list=PLq1") is None


class FakeYDL:
    info: object = None
    seen: list = []

    def __init__(self, opts):
        FakeYDL.seen.append(opts)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=False):
        FakeYDL.seen.append((url, download))
        return FakeYDL.info


def test_extractor_playlist_is_one_flat_bounded_call_on_the_canonical_url(monkeypatch):
    FakeYDL.seen = []
    FakeYDL.info = {"title": "T", "channel": "C", "playlist_count": 300, "entries": [{"id": A}, None, {"id": B}]}
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    got = extractor.playlist(LIST, 200)
    opts, call = FakeYDL.seen
    assert opts["extract_flat"] and opts["playlistend"] == 200 and opts["socket_timeout"] == extractor.PLAYLIST_TIMEOUT_S
    assert call == (URL, False)
    assert got == {"title": "T", "uploader": "C", "total": 300, "entries": [{"id": A}, {"id": B}]}


def test_extractor_playlist_without_a_count_uses_the_entries(monkeypatch):
    FakeYDL.info = {"entries": [{"id": A}]}
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    assert extractor.playlist(LIST, 200)["total"] == 1
    FakeYDL.info = None
    with pytest.raises(ValueError):
        extractor.playlist(LIST, 200)
