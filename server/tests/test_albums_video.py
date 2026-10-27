import pytest

from app import album_video, deps, extractor, limits, playlist_import, previewcache, video_split
from tests.test_albums import stored  # noqa: F401
from tests.test_library import H, OWNER_UID, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who  # noqa: F401

VID = "yeUFSnA9Puk"
URL = f"https://youtu.be/{VID}?si=abc"
TEXT = "Tracklist:\n00:00 Alpha - One\n05:00 Beta - Two (Remix)\n10:30 Alpha - Three\n"


DETAILS = {"id": VID, "title": "Various - Forest Mix (Full Album) 2019", "uploader": "Chan", "duration": 3600.0,
           "thumbnail": f"https://i.ytimg.com/vi/{VID}/hqdefault.jpg", "description": TEXT, "chapters": []}


@pytest.fixture
def video(client, monkeypatch):
    state = {"details": dict(DETAILS), "calls": 0, "plans": []}

    def details(video_id):
        state["calls"] += 1
        data = state["details"]
        if isinstance(data, Exception):
            raise data
        return data

    def run_split(uid, owner, job_id, video_id, tracks, album, fades, source_url, thumbnail, total):
        state["plans"].append((job_id, {"videoId": video_id, "tracks": tracks, "album": album, "fades": fades, "total": total}))
        job = deps.JOBS[(uid, job_id)]
        job.update(status="done", progress=1.0, done=total)

    monkeypatch.setattr(extractor, "video_details", details)
    monkeypatch.setattr(video_split, "run_split", run_split)
    monkeypatch.setattr(deps.SCHED, "inline", True)
    playlist_import.reset_limits()
    limits.RATE.reset()
    return state


def pv(client, url=URL, headers=H):
    previewcache.clear()
    return client.post("/albums/from-video/preview", json={"url": url}, headers=headers)


def track(start, end, title, artists=("Alpha",), **extra):
    return {"include": True, "start": start, "end": end, "artists": list(artists), "title": title, "version": None, "trackNo": None, "useExistingSongId": None, **extra}


def body(tracks=None, **extra):
    album = {"title": "Forest Mix", "albumArtist": "Various Artists", "type": "mix", "year": 2019, "genres": ["Psytrance"], "coverUrl": None}
    rows = tracks or [track(0, 300, "One"), track(300, 630, "Two", ("Beta",), version="Remix"), track(630, 3600, "Three")]
    return {"url": URL, "album": album, "tracks": rows, **extra}


def library_ids(client, headers=H):
    return {s["id"]: s for s in client.get("/library", headers=headers).json()["songs"]}


def test_preview_from_the_description_creates_nothing(client, video, tmp_path):
    r = pv(client)
    assert r.status_code == 200
    data = r.json()
    assert (data["videoId"], data["source"], data["duration"], data["uploader"]) == (VID, "description", 3600.0, "Chan")
    assert data["rawText"] == TEXT
    assert [(t["index"], t["start"], t["end"], t["artists"], t["title"], t["version"], t["match"]) for t in data["tracks"]] == [
        (0, 0, 300, ["Alpha"], "One", None, None), (1, 300, 630, ["Beta"], "Two", "Remix", None), (2, 630, 3600.0, ["Alpha"], "Three", None, None)]
    assert set(data["tracks"][0]) == {"index", "start", "end", "artists", "artist", "title", "version", "trackNo", "warnings", "match"}
    assert data["warnings"] == []
    assert data["album"] == {"title": "Forest Mix", "albumArtist": "Various Artists", "type": "album", "year": 2019, "coverUrl": DETAILS["thumbnail"]}
    assert library_ids(client) == {}
    assert client.get("/albums", headers=H).json() == []


def test_preview_prefers_chapters_and_a_long_video_is_not_a_mix_by_length(client, video):
    video["details"]["chapters"] = [{"start_time": i * 600, "end_time": (i + 1) * 600, "title": f"Chapter {i}"} for i in range(6)]
    data = pv(client).json()
    assert (data["source"], data["rawText"], data["album"]["type"]) == ("chapters", "", "album")
    assert len(data["tracks"]) == 6


def test_album_artist_is_the_common_artist(client, video):
    video["details"]["description"] = "00:00 Solo - A\n05:00 Solo - B\n"
    data = pv(client).json()
    assert data["album"]["albumArtist"] == "Solo"


def test_preview_text_uses_the_pasted_text(client, video):
    video["details"]["description"] = ""
    r = client.post("/albums/from-video/preview-text", json={"url": URL, "text": "00:00 X - Y\n04:00 X - Z\n"}, headers=H)
    data = r.json()
    assert (r.status_code, data["source"], data["rawText"], len(data["tracks"]), data["tracks"][1]["end"]) == (200, "pasted", "00:00 X - Y\n04:00 X - Z\n", 2, 3600.0)


def test_preview_errors(client, video):
    assert pv(client, "https://example.com/x").status_code == 400
    assert pv(client, "https://www.youtube.com/playlist?list=PLabcdefgh").status_code == 400
    video["details"]["description"] = "nothing here"
    r = pv(client)
    assert (r.status_code, r.json()["detail"]) == (422, "no tracklist found")
    video["details"] = RuntimeError("HTTP Error 404: Not Found")
    assert pv(client).status_code == 404
    video["details"] = RuntimeError("boom")
    assert pv(client).status_code == 502
    assert client.post("/albums/from-video/preview", json={"url": URL}).status_code == 401


def test_preview_limits_are_413(client, video, multi):
    a = who(multi, ALICE)
    video["details"] = {**DETAILS, "duration": 5 * 3600}
    r = pv(multi, headers=a)
    assert (r.status_code, r.json()["detail"]) == (413, "video longer than 4 hours")
    assert pv(client).status_code == 413
    video["details"] = {**DETAILS, "description": "\n".join(f"{i}:00 A - T{i}" for i in range(101))}
    r = pv(multi, headers=a)
    assert (r.status_code, r.json()["detail"]) == (413, "more than 100 tracks")
    assert pv(client).status_code == 413


def test_preview_text_rejects_a_text_without_tracks(client, video):
    r = client.post("/albums/from-video/preview-text", json={"url": URL, "text": "hello"}, headers=H)
    assert (r.status_code, r.json()["detail"]) == (422, "no tracklist found")


def test_preview_marks_a_song_already_in_the_library(client, video):
    r = client.post("/albums/from-video", json=body(), headers=H)
    ids = r.json()["songIds"]
    video["details"]["description"] = "00:00 Alpha - One\n05:00 Zed - Other\n"
    previewcache.clear()
    tracks = pv(client).json()["tracks"]
    assert tracks[0]["match"] == {"songId": ids[0], "title": "One", "artists": ["Alpha"]}
    assert tracks[1]["match"] is None


def test_create_makes_album_songs_and_runs_the_split(client, video, tmp_path):
    r = client.post("/albums/from-video", json=body(), headers=H)
    assert r.status_code == 202, r.text
    data = r.json()
    assert len(data["songIds"]) == 3
    assert data["jobId"].startswith("split_")
    songs = library_ids(client)
    first = songs[data["songIds"][0]]
    assert (first["title"], first["artist"], first["audio_state"], first["sourceVideoId"], first["sourceStartSec"], first["sourceEndSec"], first["duration"]) == ("One", "Alpha", "none", VID, 0, 300, 300)
    assert first["albums"] == ["Forest Mix"]
    assert first["sources"][0]["trim_end"] == 300
    assert songs[data["songIds"][1]]["version"]["name"]
    album = client.get(f"/albums/{data['albumId']}", headers=H).json()
    assert (album["title"], album["artist"], album["type"], album["year"], album["source"]) == ("Forest Mix", "Various Artists", "mix", 2019, {"type": "video", "id": VID, "url": f"https://www.youtube.com/watch?v={VID}"})
    assert [(t["no"], t["title"], t["songId"]) for t in album["tracks"]] == [(1, "One", data["songIds"][0]), (2, "Two", data["songIds"][1]), (3, "Three", data["songIds"][2])]
    assert album["links"]["youtube"] == f"https://youtu.be/{VID}"
    assert client.get("/albums", headers=H).json()[0]["type"] == "mix"
    [(job_id, plan)] = video["plans"]
    assert job_id == data["jobId"]
    assert plan["fades"] is True
    assert plan["album"] == {"title": "Forest Mix", "albumArtist": "Various Artists", "year": 2019}
    assert [(t["songId"], t["start"], t["end"], t["title"]) for t in plan["tracks"]] == [(sid, s, e, t) for sid, (s, e, t) in zip(data["songIds"], [(0, 300, "One"), (300, 630, "Two"), (630, 3600, "Three")])]
    status = client.get(f"/jobs/{data['jobId']}", headers=H).json()
    assert (status["state"], status["done"], status["total"]) == ("done", 3, 3)


def test_fades_default_follows_the_type_and_can_be_set(client, video):
    client.post("/albums/from-video", json=body(album={**body()["album"], "type": "album"}), headers=H)
    assert video["plans"][0][1]["fades"] is False


def test_create_is_idempotent_and_refuses_other_tracks(client, video):
    first = client.post("/albums/from-video", json=body(), headers=H).json()
    again = client.post("/albums/from-video", json=body(), headers=H)
    assert (again.status_code, again.json()) == (202, first)
    assert len(client.get("/albums", headers=H).json()) == 1
    assert len(library_ids(client)) == 3
    assert len(video["plans"]) == 1
    other = client.post("/albums/from-video", json=body([track(0, 100, "Only")]), headers=H)
    assert (other.status_code, other.json()["detail"]["code"], other.json()["detail"]["id"]) == (409, "already_exists", first["albumId"])


def test_repost_after_a_failed_job_runs_the_split_again(client, video):
    first = client.post("/albums/from-video", json=body(), headers=H).json()
    deps.JOBS[(OWNER_UID, first["jobId"])]["status"] = "error"
    client.post("/albums/from-video", json=body(), headers=H)
    assert len(video["plans"]) == 2


def test_use_existing_links_the_song_and_cuts_nothing_for_it(client, video):
    first = client.post("/albums/from-video", json=body(), headers=H).json()
    sid = first["songIds"][0]
    client.delete(f"/albums/{first['albumId']}", headers=H)
    video["plans"].clear()
    rows = [track(0, 300, "One", useExistingSongId=sid), track(300, 630, "Two", ("Beta",))]
    r = client.post("/albums/from-video", json=body(rows), headers=H).json()
    assert r["songIds"][0] == sid
    [(_, plan)] = video["plans"]
    assert [t["title"] for t in plan["tracks"]] == ["Two"]
    assert client.post("/albums/from-video", json=body([track(0, 300, "One", useExistingSongId="zzzzzzzzzzz")]), headers=H).status_code in (409, 422)


def test_all_existing_tracks_need_no_job_run(client, video):
    first = client.post("/albums/from-video", json=body(), headers=H).json()
    client.delete(f"/albums/{first['albumId']}", headers=H)
    video["plans"].clear()
    rows = [track(0, 300, "One", useExistingSongId=first["songIds"][0])]
    r = client.post("/albums/from-video", json=body(rows), headers=H).json()
    assert video["plans"] == []
    assert client.get(f"/jobs/{r['jobId']}", headers=H).json()["state"] == "done"


def test_excluded_rows_are_skipped_and_unknown_existing_is_refused(client, video):
    rows = [track(0, 300, "One"), track(300, 630, "Two", include=False), track(630, 900, "Three", useExistingSongId="aaaaaaaaaaa")]
    assert client.post("/albums/from-video", json=body(rows), headers=H).json()["detail"] == "unknown_song"
    r = client.post("/albums/from-video", json=body(rows[:2]), headers=H)
    assert len(r.json()["songIds"]) == 1


@pytest.mark.parametrize("rows,code", [
    ([track(300, 300, "x")], "bad_times"),
    ([track(-1, 10, "x")], "bad_times"),
    ([track(0, 100, "a"), track(50, 200, "b")], "bad_times"),
    ([track(0, 4000, "a")], "bad_times"),
    ([track(3600, 3700, "a")], "bad_times"),
    ([track("0", 10, "a")], "bad_times"),
    ([track(0, 10, "")], "bad_tracks"),
    ([track(0, 10, "a", artists=[1])], "bad_tracks"),
    ([track(0, 10, "a", trackNo="1")], "bad_tracks"),
    ([track(0, 10, "a", include=False)], "no_tracks"),
    ("nope", "bad_tracks"),
])
def test_create_validates_the_tracks(client, video, rows, code):
    r = client.post("/albums/from-video", json=body(rows), headers=H)
    assert (r.status_code, r.json()["detail"]) == (422, code)
    assert library_ids(client) == {}
    assert client.get("/albums", headers=H).json() == []


@pytest.mark.parametrize("album", [{"title": ""}, {"albumArtist": ""}, {"type": "playlist"}, {"year": "x"}, {"year": 1000}, {"genres": "x"}])
def test_create_validates_the_album(client, video, album):
    r = client.post("/albums/from-video", json=body(album={**body()["album"], **album}), headers=H)
    assert (r.status_code, r.json()["detail"]) == (422, "bad_album")


def test_create_rejects_a_bad_url_and_too_many_tracks(client, video, multi):
    assert client.post("/albums/from-video", json={**body(), "url": "nope"}, headers=H).status_code == 400
    a = who(multi, ALICE)
    rows = [track(i * 10, i * 10 + 10, f"T{i}") for i in range(101)]
    r = multi.post("/albums/from-video", json=body(rows), headers=a)
    assert (r.status_code, r.json()["detail"]) == (413, "more than 100 tracks")
    video["details"]["duration"] = 5 * 3600
    previewcache.clear()
    assert multi.post("/albums/from-video", json=body(), headers=a).status_code == 413


def test_the_split_costs_one_add_and_the_cap_applies(multi, video, monkeypatch):
    a, b = who(multi, ALICE), who(multi, BOB)
    monkeypatch.setenv("USER_ADDS_PER_HOUR", "1")
    assert multi.post("/albums/from-video", json=body(), headers=a).status_code == 202
    r = multi.post("/albums/from-video", json={**body(), "url": "https://youtu.be/aaaaaaaaaaa"}, headers=a)
    assert (r.status_code, r.json()["error"]) == (429, "hourly_limit")
    monkeypatch.setenv("USER_MAX_SONGS", "2")
    r = multi.post("/albums/from-video", json=body(), headers=b)
    assert (r.status_code, r.json()["error"]) == (403, "library_full_songs")
    assert multi.get("/library", headers=b).json()["songs"] == []


def test_other_users_do_not_see_the_job_or_the_album(multi, video):
    a, b = who(multi, ALICE), who(multi, BOB)
    made = multi.post("/albums/from-video", json=body(), headers=a).json()
    assert multi.get(f"/jobs/{made['jobId']}", headers=a).status_code == 200
    assert multi.get(f"/jobs/{made['jobId']}", headers=b).status_code == 404
    assert multi.get("/albums", headers=b).json() == []
    assert multi.post("/albums/from-video", json=body(), headers=b).status_code == 202


def test_cover_comes_from_the_given_url_else_the_video_thumbnail(client, video, monkeypatch):
    seen = []
    monkeypatch.setattr(album_video.album_covers, "fetch_jpeg", lambda url: seen.append(url) or b"jpeg")
    stored_calls = []
    monkeypatch.setattr(album_video.album_covers, "store", lambda uid, aid, jpeg, src, url: stored_calls.append((src, url)))
    client.post("/albums/from-video", json=body(album={**body()["album"], "coverUrl": "https://i.ytimg.com/vi/x/hq.jpg"}), headers=H)
    assert stored_calls == [("url", "https://i.ytimg.com/vi/x/hq.jpg")]
    client.post("/albums/from-video", json={**body(), "url": "https://youtu.be/aaaaaaaaaaa"}, headers=H)
    assert seen[-1] == "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg"


def test_job_status_of_an_unknown_job_is_404(client):
    assert client.get("/jobs/split_0000", headers=H).status_code == 404
    assert client.get("/jobs/split_0000").status_code == 401


def test_song_ids_are_valid_and_stable():
    one = album_video.track_song_id(VID, 12.5)
    assert one == album_video.track_song_id(VID, 12.5) != album_video.track_song_id(VID, 13)
    assert deps.extractor.is_valid_video_id(one)


def test_video_details_reads_title_description_and_chapters(monkeypatch):
    info = {"title": "T", "channel": "C", "duration": 90, "description": "d", "chapters": [{"start_time": 0, "end_time": 90, "title": "x"}, "junk"]}

    class FakeYDL:
        def __init__(self, opts):
            assert opts["skip_download"]
            assert opts["noplaylist"]

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download):
            assert url.endswith(VID)
            assert not download
            return info

    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    got = extractor.video_details(VID)
    assert (got["title"], got["uploader"], got["duration"], got["description"], len(got["chapters"])) == ("T", "C", 90, "d", 1)
    assert got["thumbnail"].endswith(VID + "/hqdefault.jpg") or VID in got["thumbnail"]
    info = None
    with pytest.raises(ValueError):
        extractor.video_details(VID)


def test_preview_guesses_the_album_from_a_full_album_video(client, video, monkeypatch):
    from app import album_youtube
    monkeypatch.setattr(album_youtube, "_suggest_genres", lambda hint, candidates, tracks: ["Psytrance", "Goa Trance"])
    video["details"].update(title="Astral Projection – For All Mankind (2025) [FULL ALBUM]", uploader="Banjankri", duration=3000.0, description="",
                            chapters=[{"start_time": i * 300, "end_time": (i + 1) * 300, "title": f"Track {i}"} for i in range(9)])
    data = pv(client).json()
    assert data["guess"] == {"artist": "Astral Projection", "album": "For All Mankind", "year": 2025, "type": "album"}
    assert (data["album"]["title"], data["album"]["albumArtist"], data["album"]["year"], data["album"]["type"]) == ("For All Mankind", "Astral Projection", 2025, "album")
    assert data["genres"] == ["Psytrance", "Goa Trance"]
    assert all(t["artist"] == "Astral Projection" and t["artists"] == ["Astral Projection"] for t in data["tracks"])


DESC_LINKS = ("Astral Projection - For All Mankind\nBuy: https://www.discogs.com/release/35142581-Astral-Projection-For-All-Mankind.\n"
              "https://en.wikipedia.org/wiki/For_All_Mankind_(album)\nhttps://example.com/x\n")


def _astral(video, description=DESC_LINKS):
    video["details"].update(title="Astral Projection – For All Mankind (2025) [FULL ALBUM]", uploader="Banjankri", duration=3000.0, description=description,
                            chapters=[{"start_time": i * 300, "end_time": (i + 1) * 300, "title": f"Track {i}"} for i in range(9)])


def test_preview_reads_links_from_the_description_and_prefills_from_discogs(client, video, monkeypatch):
    from app import discogs_lookup
    monkeypatch.setenv("DISCOGS_TOKEN", "t")
    release = {"title": "For All Mankind", "artists": [{"name": "Astral Projection"}], "year": 2025, "genres": ["Electronic"], "styles": ["Goa Trance", "Psy-Trance"],
               "formats": [{"name": "File", "descriptions": ["Album"]}], "images": [{"uri": "https://i.discogs.com/big.jpg"}], "tracklist": [{"title": "One", "type_": "track"}]}
    monkeypatch.setattr(discogs_lookup, "_get", lambda path, params=None: release if path == "releases/35142581" else {})
    _astral(video)
    data = pv(client).json()
    assert data["links"] == {"discogs": "https://www.discogs.com/release/35142581", "wikipedia": "https://en.wikipedia.org/wiki/For_All_Mankind_(album)", "rateyourmusic": None}
    assert (data["album"]["title"], data["album"]["albumArtist"], data["album"]["year"], data["album"]["type"], data["album"]["coverUrl"]) == (
        "For All Mankind", "Astral Projection", 2025, "album", "https://i.discogs.com/big.jpg")
    assert data["genres"]


def test_a_failing_discogs_link_keeps_the_guess_and_the_links(client, video, monkeypatch):
    from app import discogs_lookup
    monkeypatch.setenv("DISCOGS_TOKEN", "t")

    def boom(path, params=None):
        raise OSError("down")

    monkeypatch.setattr(discogs_lookup, "_get", boom)
    _astral(video)
    data = pv(client).json()
    assert data["links"]["discogs"] == "https://www.discogs.com/release/35142581"
    assert (data["album"]["title"], data["album"]["albumArtist"], data["album"]["year"]) == ("For All Mankind", "Astral Projection", 2025)


CRYSTAL_DESC = "Stay Retro\nTracklistings\n" + "".join(f"{i + 1}. Song {i + 1} {i * 3:02d}:00\n" for i in range(10)) + "Support: https://soundcloud.com/robertparkerofficial\n"
MASTER = {"id": 1022405, "type": "master", "title": "Robert Parker - Crystal City", "year": "2016"}
MAIN = {"title": "Crystal City", "artists": [{"name": "Robert Parker"}], "year": 2016, "genres": ["Electronic"], "styles": ["Synthwave"],
        "formats": [{"name": "Vinyl", "descriptions": ["LP", "Album"]}], "images": [{"type": "secondary", "uri": "https://i.discogs.com/b.jpg"}, {"type": "primary", "uri": "https://i.discogs.com/a.jpg"}],
        "tracklist": [{"title": f"Song {i}", "type_": "track"} for i in range(1, 11)]}


def _crystal(video, monkeypatch, search, token="t"):
    from app import discogs_lookup
    monkeypatch.setenv("DISCOGS_TOKEN", token)
    calls = []

    def get(path, params=None):
        calls.append((path, params))
        if path == "database/search":
            return search(params)
        if path == "masters/1022405":
            return {"main_release": 555}
        if path == "releases/555":
            return MAIN
        return {}

    monkeypatch.setattr(discogs_lookup, "_get", get)
    video["details"].update(title="Robert Parker - Crystal City [FULL ALBUM] 2016", uploader="NRW Records", duration=2472.0, description=CRYSTAL_DESC, chapters=[])
    return calls


def test_no_description_link_auto_matches_the_one_discogs_master(client, video, monkeypatch):
    calls = _crystal(video, monkeypatch, lambda p: {"results": [MASTER, {"id": 9, "type": "master", "title": "Robert Parker - Other", "year": "2016"}]} if p["type"] == "master" else {"results": []})
    data = pv(client).json()
    assert data["links"]["discogs"] == "https://www.discogs.com/master/1022405"
    assert data["discogsMatch"] == "https://www.discogs.com/master/1022405"
    assert (data["album"]["title"], data["album"]["albumArtist"], data["album"]["year"], data["album"]["type"]) == ("Crystal City", "Robert Parker", 2016, "album")
    assert data["album"]["coverUrl"] == "https://i.discogs.com/a.jpg"
    assert data["genres"] and data["discogsCandidates"] == []
    assert calls[0][1]["type"] == "master"


def test_ambiguous_masters_return_candidates_instead(client, video, monkeypatch):
    def search(p):
        if p["type"] == "master":
            return {"results": [MASTER, {**MASTER, "id": 77}]}
        return {"results": [{"id": 555, "type": "release", "title": "Robert Parker - Crystal City", "year": "2016"}]}

    _crystal(video, monkeypatch, search)
    data = pv(client).json()
    assert data["discogsMatch"] is None and data["links"]["discogs"] is None
    assert data["album"]["coverUrl"] == DETAILS["thumbnail"]
    assert [c["id"] for c in data["discogsCandidates"]] == [555] and data["discogsCandidates"][0]["cover"] == "https://i.discogs.com/a.jpg"


def test_a_master_with_another_year_or_track_count_is_not_applied(client, video, monkeypatch):
    _crystal(video, monkeypatch, lambda p: {"results": [{**MASTER, "year": "1999"}]} if p["type"] == "master" else {"results": []})
    assert pv(client).json()["discogsMatch"] is None


def test_discogs_failure_or_missing_token_stays_silent(client, video, monkeypatch):
    from app import discogs_lookup

    def boom(path, params=None):
        raise OSError("down")

    _crystal(video, monkeypatch, lambda p: {"results": []})
    monkeypatch.setattr(discogs_lookup, "_get", boom)
    data = pv(client).json()
    assert data["discogsMatch"] is None and data["album"]["title"] == "Crystal City"
    monkeypatch.delenv("DISCOGS_TOKEN")
    assert pv(client).json()["discogsMatch"] is None


def test_a_master_description_link_is_applied_with_its_cover(client, video, monkeypatch):
    _crystal(video, monkeypatch, lambda p: {"results": []})
    video["details"]["description"] += "https://www.discogs.com/master/1022405-Robert-Parker-Crystal-City\n"
    data = pv(client).json()
    assert data["album"]["coverUrl"] == "https://i.discogs.com/a.jpg" and data["discogsMatch"] is None
    assert data["links"]["discogs"] == "https://www.discogs.com/release/555"


def test_create_falls_back_to_the_thumbnail_when_the_discogs_cover_fails(client, video, monkeypatch):
    from app import album_covers
    tried = []

    def fetch(url):
        tried.append(url)
        if "discogs" in url:
            raise OSError("gone")
        return b"jpg"

    monkeypatch.setattr(album_covers, "fetch_jpeg", fetch)
    monkeypatch.setattr(album_covers, "store", lambda *a, **k: None)
    b = body()
    b["album"]["coverUrl"] = "https://i.discogs.com/a.jpg"
    assert client.post("/albums/from-video", json=b, headers=H).status_code == 202
    assert tried == ["https://i.discogs.com/a.jpg", DETAILS["thumbnail"]]
