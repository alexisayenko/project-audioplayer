from tests.test_library import client  # noqa: F401

H = {"X-API-Token": "secret"}


def test_unknown_playlist_is_404_on_read_and_export(client):
    assert client.get("/playlists/nope", headers=H).status_code == 404
    assert client.get("/playlists/nope/export", headers=H).status_code == 404


def test_listing_and_reading_a_created_playlist(client):
    made = client.post("/playlists", json={"name": "Mix", "song_ids": []}, headers=H)
    assert made.status_code == 201
    pid = made.json()["id"]
    assert [p["id"] for p in client.get("/playlists", headers=H).json()["playlists"]] == [pid]
    assert client.get(f"/playlists/{pid}", headers=H).json()["name"] == "Mix"
    assert client.get(f"/playlists/{pid}/export", headers=H).status_code == 200
