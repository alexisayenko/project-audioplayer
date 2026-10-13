import pytest

from app import extractor, library
from app.titles import remix_hint
from test_library import H, VID, add, client  # noqa: F401


@pytest.mark.parametrize(
    "title,original,remixer",
    [
        ("Delerium - Innocente (Sadrican 2026 Remix)", "Delerium - Innocente", "Sadrican"),
        ("Lasgo - Something (Sadrican Remix)", "Lasgo - Something", "Sadrican"),
        ("Delerium - Innocente [Sadrican Bootleg]", "Delerium - Innocente", "Sadrican"),
        ("A - B (X Rework)", "A - B", "X"),
        ("A - B (X flip)", "A - B", "X"),
        ("A - B (X Refix)", "A - B", "X"),
        ("A - B (X VIP)", "A - B", "X"),
        ("Something (Sadrican Remix)", None, "Sadrican"),
        ("A - B (Tiësto Remix) (Official Video)", "A - B", "Tiësto"),
        ("A - B (Official Video) (Tiësto Remix)", "A - B", "Tiësto"),
        ("A - B (DJ Tiësto's Remix)", "A - B", "DJ Tiësto"),
        ("A - B (Tiesto Remix)", "A - B", "Tiesto"),
    ],
)
def test_hint_found(title, original, remixer):
    assert remix_hint(title) == {"original": original, "remixer": remixer}


@pytest.mark.parametrize(
    "title",
    [
        "A - B (Remix)", "A - B [Bootleg]", "A - B (Extended Mix)", "A - B (Radio Edit)", "A - B (Club Mix)",
        "A - B (Official Video)", "A - B (Remastered 2009)", "A - B (Official Remix)", "A - B (2026 Remix)",
        "A - B Remix", "Remix", "", "()", "(", "A - B (Remix", None, 42,
    ],
)
def test_hint_none(title):
    assert remix_hint(title) is None


def test_hint_ignores_artist():
    assert remix_hint("Something (Sadrican Remix)", "Lasgo") == {"original": None, "remixer": "Sadrican"}


def test_fields_normalised_and_old_records_valid():
    songs = library.normalize({"songs": [{"id": VID, "title": "T", "original": "  A - B ", "remixer": "  "}, {"id": "x", "title": "O"}]})["songs"]
    assert songs[0]["original"] == "A - B"
    assert songs[0]["remixer"] is None
    assert "original" not in songs[1] and "remixer" not in songs[1]


def test_post_patch_and_listings(client):
    r = add(client, metadata={"title": "S", "original": " Lasgo - Something ", "remixer": "Sadrican"})
    assert r.status_code == 202
    s = client.get("/library", headers=H).json()["songs"][0]
    assert (s["original"], s["remixer"]) == ("Lasgo - Something", "Sadrican")
    p = client.patch(f"/songs/{VID}", json={"original": "", "remixer": " Bob "}, headers=H).json()
    assert (p["original"], p["remixer"]) == (None, "Bob")
    cat = client.get("/catalog", headers=H).json()["songs"][0]
    assert (cat["original"], cat["remixer"]) == (None, "Bob")


def test_post_audio_false(client):
    body = {"url": f"https://youtu.be/{VID}", "audio": False, "metadata": {"title": "S", "original": "A - B", "remixer": "R"}}
    r = client.post("/songs", json=body, headers=H)
    assert r.status_code == 201
    assert (r.json()["song"]["original"], r.json()["song"]["remixer"]) == ("A - B", "R")


def test_preview_key_always_present(client, monkeypatch):
    assert client.post("/preview", json={"url": f"https://youtu.be/{VID}"}, headers=H).json()["remix_hint"] is None
    real = extractor.preview
    monkeypatch.setattr(extractor, "preview", lambda v: {**real(v), "remix_hint": remix_hint("A - B (R Remix)")})
    assert client.post("/preview", json={"url": f"https://youtu.be/{VID}"}, headers=H).json()["remix_hint"] == {"original": "A - B", "remixer": "R"}


def test_metadata_remix_hint(client):
    h = client.post("/metadata", json={"title": "A - B (R Remix)"}, headers=H).json()["remix_hint"]
    assert h == {"original": "A - B", "remixer": "R"}
    assert client.post("/metadata", json={"title": "A - B"}, headers=H).json()["remix_hint"] is None
    assert client.post("/metadata", json={}, headers=H).json()["remix_hint"] is None
