import pytest

from app import deps, library, metafill, users
from tests.test_library import H, OWNER_UID, VID, VID2, add, client  # noqa: F401
from tests.test_users import ALICE, BOB, key, multi, who  # noqa: F401
from tests.test_users import add as add_as

URL = "/me/backfill/metadata"
RESP = {"album": "Found Album", "year": 1999, "tags": ["genre:house", "country:fr"], "wikipedia_album": "https://en.wikipedia.org/wiki/Found",
        "services": {"musicbrainz": {"found": True, "url": "https://musicbrainz.org/recording/11111111-1111-1111-1111-111111111111"}}}


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    monkeypatch.setenv("AUDIO_METADATA_SLEEP", "0")
    monkeypatch.setattr(metafill, "MAX_PAUSE", 0.0)
    metafill.reset()
    yield
    metafill.reset()


def edit(uid, vid, **fields):
    songs = library.load(deps.library_path(uid))
    library.find_song(songs, vid).update(fields)
    deps.save_songs(uid, songs)


def song(uid, vid):
    return library.find_song(library.load(deps.library_path(uid)), vid)


def wait(uid):
    job = metafill._jobs[uid]
    job.thread.join(10)
    assert not job.thread.is_alive()
    return job


def bare(uid, *ids):
    for v in ids:
        edit(uid, v, albums=[], releaseYear=None, tags=[])


def test_anonymous_is_refused(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL).status_code == 401
    assert client.delete(URL).status_code == 401


def test_nothing_to_do_when_complete(client):
    add(client)
    edit(OWNER_UID, VID, album="A", released=2000, tags=["genre:pop"])
    r = client.post(URL, headers=H)
    assert r.status_code == 200
    assert r.json()["candidates"] == 0


def test_candidates_need_audio_gaps_and_no_stamp(client):
    add(client, VID)
    add(client, VID2, audio=False)
    bare(OWNER_UID, VID, VID2)
    assert metafill.candidates(OWNER_UID) == [VID]
    edit(OWNER_UID, VID, metadata_checked_at="2026-01-01T00:00:00Z")
    assert metafill.candidates(OWNER_UID) == []


def test_run_fills_only_empty_fields(client, monkeypatch):
    add(client, VID)
    bare(OWNER_UID, VID)
    edit(OWNER_UID, VID, albums=["Mine"], tags=["genre:jazz"])
    monkeypatch.setattr(metafill, "_fetch", lambda s: RESP)
    assert client.post(URL, headers=H).status_code == 202
    job = wait(OWNER_UID)
    assert (job.state, job.updated, job.nothing, job.failed) == ("done", 1, 0, 0)
    s = song(OWNER_UID, VID)
    assert s["albums"] == ["Mine"]
    assert s["releaseYear"] == 1999
    assert s["tags"] == ["genre:jazz", "genre:house"]
    assert s["wikipedia_album"].endswith("/Found")
    assert s["musicbrainz_url"].startswith("https://musicbrainz.org/")
    assert s["metadata_checked_at"]
    assert client.get(URL, headers=H).json()["candidates"] == 0


def test_nothing_found_is_stamped_and_not_asked_again(client, monkeypatch):
    add(client, VID)
    bare(OWNER_UID, VID)
    monkeypatch.setattr(metafill, "_fetch", lambda s: {"album": None, "year": None, "tags": [], "services": {}})
    client.post(URL, headers=H)
    job = wait(OWNER_UID)
    assert (job.updated, job.nothing) == (0, 1)
    assert client.post(URL, headers=H).status_code == 200


def test_failure_is_counted_not_stamped(client, monkeypatch):
    add(client, VID)
    add(client, VID2)
    bare(OWNER_UID, VID, VID2)

    def fetch(s):
        if s["id"] == VID:
            raise RuntimeError("429")
        return RESP

    monkeypatch.setattr(metafill, "_fetch", fetch)
    client.post(URL, headers=H)
    job = wait(OWNER_UID)
    assert (job.updated, job.failed) == (1, 1)
    assert not song(OWNER_UID, VID).get("metadata_checked_at")
    assert client.get(URL, headers=H).json()["candidates"] == 1


def test_conflict_and_cancel(client, monkeypatch):
    import threading

    add(client, VID)
    add(client, VID2)
    bare(OWNER_UID, VID, VID2)
    gate, seen = threading.Event(), threading.Event()

    def slow(s):
        seen.set()
        gate.wait(5)
        return RESP

    monkeypatch.setattr(metafill, "_fetch", slow)
    assert client.post(URL, headers=H).status_code == 202
    assert seen.wait(5)
    again = client.post(URL, headers=H)
    assert (again.status_code, again.json()["error"]) == (409, "metadata_running")
    assert client.delete(URL, headers=H).status_code == 200
    gate.set()
    job = wait(OWNER_UID)
    assert (job.state, job.updated) == ("cancelled", 1)
    assert client.delete(URL, headers=H).json()["state"] == "cancelled"


def test_other_user_gets_busy_and_isolation(multi, monkeypatch):
    import threading

    a, b = who(multi, ALICE), who(multi, BOB)
    add_as(multi, a, VID)
    add_as(multi, b, VID2)
    ua, ub = users.uid_for_email(ALICE), users.uid_for_email(BOB)
    bare(ua, VID)
    bare(ub, VID2)
    gate, seen = threading.Event(), threading.Event()
    monkeypatch.setattr(metafill, "_fetch", lambda s: (seen.set(), gate.wait(5), RESP)[2])
    assert multi.post(URL, headers=a).status_code == 202
    assert seen.wait(5)
    busy = multi.post(URL, headers=b)
    assert (busy.status_code, busy.json()["error"]) == (409, "metadata_busy")
    gate.set()
    wait(ua)
    assert song(ub, VID2)["albums"] == []


def test_apply_respects_caps_and_blank_values():
    s = {"mainArtists": ["A"], "albums": [], "releaseYear": None, "tags": [f"genre:g{i}" for i in range(12)]}
    table = [{"name": "A", "countries": ["de"]}]
    changed = metafill.apply(s, {"album": "X", "year": 2001, "tags": ["genre:new", "country:fr"]}, table)
    assert changed and s["albums"] == ["X"] and s["releaseYear"] == 2001
    assert "genre:new" not in s["tags"]
    assert table == [{"name": "A", "countries": ["de"]}]


def test_apply_fills_the_country_of_a_single_main_artist_without_one():
    s = {"mainArtists": ["A"], "albums": ["x"], "releaseYear": 1990, "tags": ["genre:house"]}
    table = [{"name": "A", "countries": []}]
    assert metafill.apply(s, {"tags": ["country:fr", "country:de"]}, table)
    assert table == [{"name": "A", "countries": ["fr"]}]
    two = {"mainArtists": ["A", "B"], "albums": ["x"], "releaseYear": 1990, "tags": ["genre:house"]}
    assert not metafill.apply(two, {"tags": ["country:fr"]}, [])


def test_fetch_builds_sources_and_links(monkeypatch):
    seen = {}

    def gather(title, artist, fetchers, ws, wa, timeout, urls, wal):
        seen.update(title=title, artist=artist, n=len(fetchers), ws=ws, wal=wal, urls=urls)
        return {}

    monkeypatch.setattr(metafill.metadata, "gather", gather)
    metafill._fetch({"id": VID, "title": " T ", "artist": "A", "source_url": "https://youtu.be/" + VID, "wikipedia_song": "https://en.wikipedia.org/wiki/S"})
    assert (seen["title"], seen["artist"], seen["n"], seen["ws"]) == ("T", "A", 1, "https://en.wikipedia.org/wiki/S")
