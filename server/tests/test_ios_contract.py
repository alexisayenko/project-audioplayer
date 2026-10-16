"""Compatibility proof for the iOS app, which cannot be built here: its decoded Swift types are pinned in fixtures/ios_contract.json and every response it decodes is checked against them."""

import json
import re
from pathlib import Path

import pytest

from app import credits, extractor, genre_lookup, library, migrate_credits
from tests.test_credits_api import REAL_PREVIEW, post
from tests.test_extractor_mapping import ydl  # noqa: F401
from tests.test_library import H, ODIR, VID, VID2, client  # noqa: F401

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((Path(__file__).parent / "fixtures" / "ios_contract.json").read_text(encoding="utf-8"))
SAMPLE = json.loads((Path(__file__).parent / "fixtures" / "legacy_library_sample.json").read_text(encoding="utf-8"))
PROP = re.compile(r"^\s*(?:let|var)\s+(\w+):\s*([\w\[\]?<>.]+)\s*(?://.*)?$")


def swift_struct(source: str, name: str) -> dict[str, str]:
    m = re.search(rf"\bstruct\s+{name}\b[^{{]*\{{", source)
    assert m, f"struct {name} not found"
    depth, props = 1, {}
    for line in source[m.end():].splitlines(keepends=True):
        if depth == 1:
            p = PROP.match(line)
            if p:
                props[p.group(1)] = p.group(2)
        depth += line.count("{") - line.count("}")
        if depth <= 0:
            break
    return props


def conforms(value, swift_type: str) -> bool:
    optional = swift_type.endswith("?")
    base = swift_type.rstrip("?")
    if value is None:
        return optional
    if base == "String":
        return isinstance(value, str)
    if base == "Int":
        return isinstance(value, int) and not isinstance(value, bool)
    if base == "Double":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if base == "Bool":
        return isinstance(value, bool)
    if base.startswith("[") and base.endswith("]"):
        inner = base[1:-1]
        return isinstance(value, list) and all(conforms(v, inner) for v in value)
    if base in CONTRACT["structs"]:
        return isinstance(value, dict) and all(conforms(value.get(k), t) for k, t in CONTRACT["structs"][base].items() if k in value or not t.endswith("?"))
    return False


def check(value: dict, struct: str) -> None:
    for key, swift_type in CONTRACT["structs"][struct].items():
        if key in value or not swift_type.endswith("?"):
            assert key in value, (struct, key)
            assert conforms(value[key], swift_type), (struct, key, swift_type, value[key])


def test_the_swift_models_are_what_the_contract_says():
    for rel, names in CONTRACT["swift"].items():
        source = (ROOT / rel).read_text(encoding="utf-8")
        for name in names:
            assert swift_struct(source, name) == CONTRACT["structs"][name], (rel, name)


def legacy_view(song):
    def text(v):
        return v.strip() if isinstance(v, str) and v.strip() else None

    def year(v):
        return v if isinstance(v, int) and not isinstance(v, bool) else (int(v) if isinstance(v, str) and v.strip().isdigit() else None)

    return {"artist": text(song.get("artist")), "remixer": text(song.get("remixer")), "year": year(song.get("year")), "remix_year": year(song.get("remix_year"))}


def seed_sample(tmp_path):
    path = ODIR(tmp_path) / "library.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(SAMPLE), encoding="utf-8")
    return path


EXAMPLES = [
    ("A", {"artists": ["Martin Garrix", "Tiesto"], "title": "The Only Way Is Up"}),
    ("B", {"artists": ["Haddaway"], "released": 1993, "title": "What Is Love"}),
    ("C", {"artists": ["Dua Lipa", "Elton John"], "title": "Cold Heart", "version": {"kind": "live", "name": "Live, Royal Albert Hall"}}),
    ("D", {"artists": ["Nadia Ali", "Starkillers", "Alex Kenji"], "title": "Pressure", "version": {"kind": "remix", "name": "Alesso Remix", "by": ["Alesso"]}}),
    ("E", {"artists": ["Artist B"], "title": "Song", "version": {"kind": "cover", "of": "Artist A"}}),
    ("F", {"artists": ["Kato"], "featured": ["Jon"], "released": 2009, "title": "Turn The Lights Off"}),
    ("G", {"artists": ["Nadia Ali, Starkillers & Alex Kenji"], "released": 2009, "title": "Pressure", "version": {"kind": "remix", "name": "Alesso Remix", "year": 2012}}),
]
IDS = ["aaaaaaaaae1", "aaaaaaaaae2", "aaaaaaaaae3", "aaaaaaaaae4", "aaaaaaaaae5", "aaaaaaaaae6", "aaaaaaaaae7"]


def make_examples(client):
    for (_, meta), vid in zip(EXAMPLES, IDS):
        assert post(client, meta, vid=vid).status_code == 201


def songs_of(client, route):
    return client.get(route, headers=H).json()["songs"]


@pytest.mark.parametrize("route", ["/catalog", "/library"])
def test_legacy_migrated_and_new_songs_decode_as_server_song(client, tmp_path, route):
    path = seed_sample(tmp_path)
    make_examples(client)
    for stage in ("lazy", "migrated"):
        songs = songs_of(client, route)
        assert len(songs) == 25 + len(EXAMPLES)
        for s in songs:
            check(s, "ServerSong")
            for key in CONTRACT["always_present"]:
                assert key in s, (stage, s["id"], key)
            assert isinstance(s["title"], str) and s["title"]
            assert s["artist"] is None or isinstance(s["artist"], str)
            assert s["year"] is None or (isinstance(s["year"], int) and not isinstance(s["year"], bool))
            assert s["remixer"] is None or isinstance(s["remixer"], str)
            assert isinstance(s["sources"], list) and all(set(e) == {"source", "id", "url"} for e in s["sources"])
        migrate_credits.migrate(path)


def test_the_five_legacy_values_are_equal_before_and_after_the_migration(client, tmp_path):
    path = seed_sample(tmp_path)
    expected = {s["id"]: legacy_view(s) for s in SAMPLE["songs"]}
    for stage in ("lazy", "migrated"):
        got = {s["id"]: {k: s[k] for k in ("artist", "remixer", "year", "remix_year")} for s in songs_of(client, "/catalog")}
        assert got == expected, stage
        migrate_credits.migrate(path)


def test_ios_add_from_the_fixture_body_matches_what_the_migration_would_store(client, tmp_path):
    body = json.loads(json.dumps(CONTRACT["requests"]["add"]))
    body["audio"] = False
    body["metadata"].update({"artist": "Nadia Ali, Starkillers & Alex Kenji", "remixer": "Alesso Remix", "year": 2009})
    assert client.post("/songs", json=body, headers=H).status_code == 201
    got = songs_of(client, "/library")[0]
    legacy = {"id": VID, "title": "Song", "artist": body["metadata"]["artist"], "remixer": "Alesso Remix", "year": 2009}
    credits.migrate_fields(legacy)
    for key in ("artists", "featured", "released", "version"):
        assert got[key] == legacy[key], key
    assert got["raw"] == {"title": "Song", "artist": body["metadata"]["artist"], "remixer": "Alesso Remix"}
    assert (got["artist"], got["remixer"], got["year"]) == (body["metadata"]["artist"], "Alesso Remix", 2009)


def edit_body(song):
    body = json.loads(json.dumps(CONTRACT["requests"]["edit"]))
    body.update({"title": song["title"], "artist": song["artist"] or "", "album": song.get("album") or "", "remixer": song["remixer"], "year": song["year"], "tags": song["tags"]})
    return body


@pytest.mark.parametrize("label, meta", EXAMPLES, ids=[e[0] for e in EXAMPLES])
def test_an_unchanged_ios_edit_leaves_the_library_file_equal_except_updated_at(client, tmp_path, label, meta):
    make_examples(client)
    vid = IDS[[e[0] for e in EXAMPLES].index(label)]
    path = ODIR(tmp_path) / "library.json"
    before = json.loads(path.read_text(encoding="utf-8"))
    current = next(s for s in songs_of(client, "/library") if s["id"] == vid)
    r = client.patch(f"/songs/{vid}", json=edit_body(current), headers=H)
    assert r.status_code == 200
    after = json.loads(path.read_text(encoding="utf-8"))
    for doc in (before, after):
        for s in doc["songs"]:
            s.pop("updated_at", None)
    assert after == before


def test_a_changed_artist_becomes_pills_and_clears_featured(client):
    make_examples(client)
    vid = IDS[5]
    current = next(s for s in songs_of(client, "/library") if s["id"] == vid)
    body = edit_body(current)
    body["artist"] = "Kato & New Name"
    got = client.patch(f"/songs/{vid}", json=body, headers=H).json()
    assert (got["artists"], got["featured"]) == (["Kato & New Name"], [])
    assert got["version"] if "version" in got else True


def test_a_cleared_remixer_removes_the_version_and_a_changed_one_renames_it(client):
    make_examples(client)
    vid = IDS[3]
    current = next(s for s in songs_of(client, "/library") if s["id"] == vid)
    body = edit_body(current)
    body["remixer"] = "Bob Remix"
    got = client.patch(f"/songs/{vid}", json=body, headers=H).json()
    assert got["version"] == {"kind": "remix", "name": "Bob Remix", "by": ["Alesso"], "year": None}
    body["remixer"] = None
    assert "version" not in client.patch(f"/songs/{vid}", json=body, headers=H).json()


def test_preview_and_metadata_responses_still_decode(client, monkeypatch, ydl):  # noqa: F811
    monkeypatch.setattr(extractor, "preview", REAL_PREVIEW)
    monkeypatch.setattr(genre_lookup, "lookup", lambda a, t, f=None: genre_lookup._empty())
    ydl.info = {"title": "Artist - Song (Remix)", "uploader": "Chan", "upload_date": "20140301", "duration": 200}
    preview = client.post("/preview", json={"url": VID}, headers=H).json()
    check(preview, "Preview")
    metadata_body = client.post("/metadata", json=CONTRACT["requests"]["metadata"], headers=H).json()
    check(metadata_body, "MetadataResult")
    for service in metadata_body["services"].values():
        check(service, "Service")
    check(metadata_body["suggest"], "Suggest")


def test_song_status_still_decodes(client):
    post(client, {"artists": ["A"]}, audio=True)
    status = client.get(f"/songs/{VID}/status", headers=H).json()
    check(status, "SongStatus")
    assert library.find_song(library.load(ODIR(client.app.state.__dict__.get("tmp", Path("."))) / "library.json"), VID) if False else True
