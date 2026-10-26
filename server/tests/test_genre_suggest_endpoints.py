"""R11: /preview, /preview/stream, /metadata and /lookup/wikipedia share one rule and return the same tags and genre_suggestions for the same evidence (TAG-107)."""

import json

import pytest
from fastapi.testclient import TestClient

from app import deps, discogs_lookup as dl, extractor, genre_lookup as gl, main, wiki_lookup as wl

VID = "dQw4w9WgXcQ"
H = {"X-API-Token": "secret"}
URL = f"https://youtu.be/{VID}"

WIKI = {
    "tags": ["genre:dance pop", "genre:synthpop", "genre:freestyle", "genre:hi-nrg", "genre:pop", "genre:soul", "genre:house", "country:us"],
    "song_genres": ["genre:dance pop", "genre:synthpop", "genre:freestyle", "genre:hi-nrg"],
    "artist_genres": ["genre:pop", "genre:soul", "genre:house"],
    "year": 1987, "wikipedia_song": "https://en.wikipedia.org/wiki/Tell_It_to_My_Heart_(Taylor_Dayne_song)", "wikipedia_artist": "https://en.wikipedia.org/wiki/Taylor_Dayne",
}
MB = ["genre:dance pop", "genre:pop", "genre:electronic"]
APPLIED = ["genre:dance pop", "genre:synthpop", "genre:pop", "country:us"]
SUGGESTED = {"freestyle": ["wikipedia_song"], "hi-nrg": ["wikipedia_song"], "soul": ["wikipedia_artist"], "house": ["wikipedia_artist"]}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIO_API_TOKEN", "secret")
    monkeypatch.setattr(deps, "DOWNLOAD_DIR", tmp_path / "downloads")
    monkeypatch.setattr(deps, "DATA_DIR", tmp_path)
    monkeypatch.setattr(deps, "JOBS", {})
    monkeypatch.setattr(extractor, "preview", lambda vid: {"id": vid, "source_url": extractor.watch_url(vid), "title": "Tell It to My Heart", "artist": "Taylor Dayne", "album": None, "year": None, "tags": ["lang:en"], "duration": 9, "thumbnail": ""})
    monkeypatch.setattr(gl, "suggest_tags", lambda a, t: [*MB, "country:us"])
    monkeypatch.setattr(gl, "lookup", lambda a, t: {"tags": [*MB, "country:us"], "year": 1987, "album": None, "mb_url": None})
    monkeypatch.setattr(wl, "suggest", lambda a, t: dict(WIKI))
    monkeypatch.setattr(wl, "from_links", lambda s, a, al=None: {**WIKI, "infobox_album": None, "infobox_year": None, "infobox_suggest": None})
    monkeypatch.setattr(dl, "suggest", lambda a, t: dl._empty())
    monkeypatch.setattr(dl, "enabled", lambda: False)
    return TestClient(main.app)


def view(body):
    return {"tags": body["tags"], "genre_suggestions": {s["genre"]: s["sources"] for s in body["genre_suggestions"]}}


def test_preview_applies_the_owner_genres_and_suggests_the_rest(client):
    body = client.post("/preview", json={"url": URL}, headers=H).json()
    assert sorted(body["tags"]) == sorted(APPLIED)
    assert view(body)["genre_suggestions"] == SUGGESTED
    assert body["original_genres"] == []
    assert {s["reason"] for s in body["genre_suggestions"]} == {"ambiguous_name", "single_source", "no_shared_family"}, "hi-nrg left Others (2026-10-20): the agreed group no longer covers it"


def test_preview_stream_result_equals_preview(client):
    plain = client.post("/preview", json={"url": URL}, headers=H).json()
    lines = [json.loads(x) for x in client.post("/preview/stream", json={"url": URL}, headers=H).text.splitlines() if x]
    assert lines[-1]["data"]["tags"] == plain["tags"]
    assert lines[-1]["data"]["genre_suggestions"] == plain["genre_suggestions"]


def test_metadata_gives_the_same_tags_and_suggestions_as_preview(client):
    preview = client.post("/preview", json={"url": URL}, headers=H).json()
    meta = client.post("/metadata", json={"title": "Tell It to My Heart", "artist": "Taylor Dayne", "sources": [{"url": URL}]}, headers=H).json()
    assert view(meta) == view(preview)
    assert meta["original_genres"] == preview["original_genres"] == []


def test_lookup_wikipedia_applies_the_same_rule_to_the_wikipedia_evidence(client):
    body = client.post("/lookup/wikipedia", json={"wikipedia_song": WIKI["wikipedia_song"], "wikipedia_artist": WIKI["wikipedia_artist"]}, headers=H).json()
    assert body["year"] == 1987
    assert sorted(t for t in body["tags"] if t.startswith("genre:")) == ["genre:dance pop", "genre:pop", "genre:synthpop"]
    assert "country:us" in body["tags"]
    assert {s["genre"]: s["sources"] for s in body["genre_suggestions"]} == {
        "freestyle": ["wikipedia_song"], "hi-nrg": ["wikipedia_song"], "soul": ["wikipedia_artist"], "house": ["wikipedia_artist"],
    }, "synthpop is also a Pop genre (all parents are equal), so it shares the family Pop with the agreed genres and is applied; without MusicBrainz no Electronic genre agrees, so nothing else in that family is rescued"


def test_a_version_gives_the_same_split_on_preview_and_metadata(client, monkeypatch):
    monkeypatch.setattr(extractor, "preview", lambda vid: {"id": vid, "source_url": extractor.watch_url(vid), "title": "Tell It to My Heart (Pendulum Remix)", "artist": "Taylor Dayne", "album": None, "year": None, "tags": ["genre:dubstep"], "remixer": "Pendulum", "duration": 9, "thumbnail": ""})
    preview = client.post("/preview", json={"url": URL}, headers=H).json()
    meta = client.post("/metadata", json={"title": "Tell It to My Heart", "artist": "Taylor Dayne", "version_type": "remix", "sources": [{"url": URL}]}, headers=H).json()
    assert preview["tags"][0] == "genre:dubstep"
    assert meta["tags"][0] == "genre:dubstep"
    assert [t for t in preview["tags"] if t.startswith("genre:")] == ["genre:dubstep"]
    assert [t for t in meta["tags"] if t.startswith("genre:")] == ["genre:dubstep"]
    assert sorted(preview["original_genres"]) == sorted(meta["original_genres"])
    assert "genre:pop" in preview["original_genres"]
    assert all(s["sources"][0] == "original" for s in preview["genre_suggestions"])


def test_the_payload_never_lists_electronic_as_a_suggestion_or_a_source(client):
    body = client.post("/preview", json={"url": URL}, headers=H).json()
    assert "genre:electronic" not in body["tags"]
    assert all(s["genre"] != "electronic" and "electronic" not in s["sources"] for s in body["genre_suggestions"])
