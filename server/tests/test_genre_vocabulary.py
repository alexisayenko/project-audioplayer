import json
import logging
from pathlib import Path

import pytest

from app import extractor, genre_filter as gf, genre_graph as gg, genre_vocab, library, metadata, metafill, migrate_tags
from app.downloads import reject_unknown_genre
from app.problems import Problem
from tests.test_library import H, VID, VID2, add, client  # noqa: F401
from tests.vocab import REAL

DATA = Path(genre_vocab.__file__).resolve().parent.parent / "data"
DISCOGS = json.loads((DATA / "genre_discogs.json").read_text(encoding="utf-8"))
EXTRAS = json.loads((DATA / "genre_extras.json").read_text(encoding="utf-8"))["extras"]
LIVE = json.loads((Path(__file__).parent / "fixtures" / "genre_live_tags.json").read_text(encoding="utf-8"))
FAMILIES = ["Blues", "Classical", "Others", "Folk, World, & Country", "Funk / Soul", "Hip Hop", "Jazz", "Latin", "Pop", "Reggae", "Rock"]

# Tags of the live library (2026-10-16) that no rule maps: kept on the songs and listed in the review file (TAG-082).
LIVE_UNMAPPABLE: set[str] = {"electronic"}  # electronic is not a genre since the group Others replaced the Electronic family: kept on the songs and reported until the song-side strip (task-0066 T2)


def names() -> set[str]:
    return set(genre_vocab.load().entries)


# --- the data files (TAG-078, TAG-083) -------------------------------------------------------


def test_the_11_families_in_the_fixed_order():
    assert DISCOGS["families"] == FAMILIES
    assert genre_vocab.load().families == tuple(FAMILIES)


def test_discogs_genres_are_lowercase_trimmed_and_filed_under_a_family():
    genres = DISCOGS["genres"]
    assert len(genres) >= 450
    for name, parents in genres.items():
        assert name, name
        assert name == " ".join(name.lower().split()), name
        assert parents and all(p in FAMILIES for p in parents), (name, parents)


def test_no_discogs_genre_in_two_families_unless_it_lists_more_parents():
    genres = DISCOGS["genres"]
    assert all(isinstance(ps, list) for ps in genres.values())
    for name, parents in genres.items():
        assert len(set(parents)) == len(parents), name
    assert "also_under" not in DISCOGS
    for name, e in genre_vocab.load().entries.items():
        if name in genres:
            assert e.parents == tuple(genres[name]), name
            assert e.family == e.families[0], name


def test_names_are_unique_after_folding_case_spaces_hyphens_and_ampersand():
    seen: dict[str, str] = {}
    for name in [*(g.lower() for g in FAMILIES if g != "Others"), *DISCOGS["genres"], *EXTRAS]:
        k = genre_vocab.vkey(name)
        assert k not in seen, (name, seen.get(k))
        seen[k] = name
    assert len(genre_vocab.load().entries) == len(seen)


def test_discogs_names_belong_to_discogs_genres():
    for ours, theirs in DISCOGS["discogs_names"].items():
        assert ours in DISCOGS["genres"]
        assert isinstance(theirs, str)
        assert theirs.strip()


def test_extras_have_parents_and_a_family_without_cycles():
    assert len(EXTRAS) >= 25
    entries = genre_vocab.load().entries
    for name, spec in EXTRAS.items():
        assert name == " ".join(name.lower().split()), name
        assert name not in DISCOGS["genres"], name
        assert "parent" not in spec and "also_under" not in spec, name
        parents = spec["parents"]
        assert parents and len(set(parents)) == len(parents), name
        assert all(p in FAMILIES or p in names() - {name} for p in parents), (name, parents)
        assert entries[name].family in FAMILIES, name
        assert entries[name].parents == tuple(parents), name
    for name in EXTRAS:
        seen, cur = {name}, EXTRAS[name]["parents"][0]
        while cur in EXTRAS:
            assert cur not in seen, f"parent cycle at {name}"
            seen.add(cur)
            cur = EXTRAS[cur]["parents"][0]


def test_an_extra_has_every_family_it_descends_from_through_any_parent():
    entries = genre_vocab.load().entries
    flat = genre_vocab.build(json.loads(genre_vocab.DISCOGS_FILE.read_text(encoding="utf-8")), json.loads(genre_vocab.EXTRAS_FILE.read_text(encoding="utf-8")))
    parents = {n: tuple(e.parents) for n, e in flat.entries.items()}
    for name, spec in EXTRAS.items():
        assert "family" not in spec, name
        assert genre_vocab._resolve_families(name, parents, genre_vocab.load().families), name
        assert entries[name].families == tuple(f for f in genre_vocab.load().families if f in entries[name].families), name


REQUIRED_EXTRAS = (
    "singer-songwriter", "psybient", "darksynth", "dreamwave", "neurofunk", "liquid drum and bass", "melodic techno",
    "dance-rock", "estrada", "shock rock", "nu-nrg", "uplifting trance", "dream trance", "chillwave", "darkwave",
    "folk", "dark metal", "dreamsynth", "sunshine house", "synth-rock",
)


@pytest.mark.parametrize("name", REQUIRED_EXTRAS)
def test_kept_subgenres_are_canonical(name):
    assert genre_vocab.is_canonical(name)
    assert gf.canonical(name) == name


def test_electronic_and_the_group_others_are_not_vocabulary_names():
    assert not genre_vocab.is_canonical("electronic") and genre_vocab.lookup("electronic") is None
    assert not genre_vocab.is_canonical("others") and genre_vocab.lookup("others") is None
    assert gf.vocabulary_name("Electronic") is None and gf.vocabulary_name("electronic music") is None
    assert gf.unmappable("electronic")
    assert genre_vocab.group("electronic") == "Others" == genre_vocab.group("Electronic Music") == genre_vocab.group("others")
    assert genre_vocab.group("house") is None
    assert genre_vocab.suggest("electronic") == [] or "electronic" not in genre_vocab.suggest("electronic")


def test_alias_and_retag_targets_are_canonical():
    targets = {*gf.ALIASES.values(), *gf.RETAGS.values(), gf.PROGRESSIVE_ELECTRONIC}
    assert targets
    for target in sorted(targets):
        assert genre_vocab.is_canonical(target), target


def test_alias_and_retag_sources_never_shadow_a_canonical_name():
    for alias, target in gf.ALIASES.items():
        assert genre_vocab.lookup(alias) in (None, target), alias
    for old in gf.RETAGS:
        assert genre_vocab.lookup(old) is None, old
    assert not set(gf.RETAGS) & set(gf.ALIASES)


def test_no_junk_value_is_canonical():
    for entry in names():
        assert not gf.is_dropped(entry), entry
        assert gf.canonical(entry) == entry, entry


def test_canonical_names_pass_the_suggestion_filter():
    for entry in names():
        assert gf.vocabulary_name(entry) == entry, entry


def test_prefix_words_do_not_eat_canonical_names():
    for entry in names():
        assert gf.split_prefix(entry) is None or gf.split_prefix(entry)[0] in names(), entry


def test_every_family_is_used():
    assert {e.family for e in genre_vocab.load().entries.values()} == set(FAMILIES)


# --- lookup and suggestions ------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,want",
    [("House", "house"), ("hip-hop", "hip hop"), ("Hip Hop", "hip hop"), ("rhythm & blues", "rhythm and blues"), ("drum & bass", "drum and bass"),
     ("psy-trance", gf.canonical("psytrance")), ("zzz", None), ("", None)],
)
def test_lookup(raw, want):
    assert genre_vocab.lookup(raw) == want


def test_family_of_also_reads_the_music_form():
    assert genre_vocab.family_of("house") == "Others"
    assert genre_vocab.family_of("house music") == "Others"
    assert genre_vocab.family_of("zzz") is None
    assert genre_vocab.is_below_family("house")
    assert not genre_vocab.is_below_family("electronic")


def test_suggest_returns_up_to_five_close_names():
    got = genre_vocab.suggest("tecno")
    assert "techno" in got
    assert len(got) <= 5
    assert genre_vocab.suggest("prog")[0].startswith("prog")
    assert all(genre_vocab.is_canonical(g) for g in genre_vocab.suggest("trans"))
    assert genre_vocab.suggest("   ") == []
    assert genre_vocab.suggest("qqqqzzzz") == []
    assert genre_vocab.suggest("dnb", {"dnb": "drum and bass"})[:1] == ["drum and bass"]


# --- strict writes (TAG-079) -----------------------------------------------------------------


def test_reject_unknown_genre_lists_suggestions():
    with pytest.raises(Problem) as err:
        reject_unknown_genre(["genre:tecno", "genre:house"])
    body = err.value.body()
    assert err.value.status == 422
    assert body["error"] == "unknown_genre"
    assert body["value"] == "tecno"
    assert "techno" in body["suggestions"]
    assert len(body["suggestions"]) <= 5
    assert "Did you mean" in body["detail"]
    assert "techno" in body["detail"]
    assert body["unknown"][0]["value"] == "tecno"


def test_reject_unknown_genre_without_close_names_points_to_the_list():
    with pytest.raises(Problem) as err:
        reject_unknown_genre(["genre:qqqqzzzz"])
    assert err.value.body()["suggestions"] == []
    assert "/genres/vocabulary" in err.value.body()["detail"]


def test_reject_unknown_genre_passes_known_other_namespaces_and_stored_values():
    reject_unknown_genre(["genre:house", "country:lt", "mood:calm", "80s"])
    reject_unknown_genre(["genre:zzqq"], ["genre:zzqq"])
    with pytest.raises(Problem):
        reject_unknown_genre(["genre:zzqq", "genre:zzz"], ["genre:zzqq"])


def test_create_rejects_unknown_genre_and_applies_nothing(client):
    r = add(client, tags=["genre:tecno", "80s"])
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "unknown_genre"
    assert "techno" in body["suggestions"]
    assert client.get("/library", headers=H).json()["songs"] == []


def test_create_accepts_aliases_and_canonicalises(client):
    r = add(client, metadata={"title": "S"}, audio=False, tags=["genre:Drum & Bass", "genre:house music", "genre:EDM"])
    assert r.status_code == 201
    assert r.json()["song"]["tags"][:3] == ["genre:drum and bass", "genre:house", "genre:edm"]


def test_create_still_drops_junk_silently(client):
    r = add(client, audio=False, tags=["genre:popular", "genre:house"])
    assert r.status_code == 201
    assert [t for t in r.json()["song"]["tags"] if t.startswith("genre:")] == ["genre:house"]


def test_patch_rejects_unknown_genre_and_keeps_the_song(client):
    add(client, audio=False, tags=["genre:house"])
    r = client.patch(f"/songs/{VID}", json={"tags": ["genre:house", "genre:housee"], "title": "New"}, headers=H)
    assert r.status_code == 422
    assert r.json()["error"] == "unknown_genre"
    assert "house" in r.json()["suggestions"]
    song = client.get("/library", headers=H).json()["songs"][0]
    assert song["title"] == "Song"
    assert "genre:housee" not in song["tags"]


def test_patch_lets_a_stored_unmappable_tag_stay(client, tmp_path):
    from tests.test_library import ODIR

    add(client, audio=False, tags=["genre:house"])
    lib = ODIR(tmp_path) / "library.json"
    doc = json.loads(lib.read_text())
    doc["songs"][0]["genres"].append("zzqq")
    lib.write_text(json.dumps(doc))
    ok = client.patch(f"/songs/{VID}", json={"tags": ["genre:house", "genre:zzqq", "genre:trance"]}, headers=H)
    assert ok.status_code == 200
    assert ok.json()["tags"][:3] == ["genre:house", "genre:zzqq", "genre:trance"]
    bad = client.patch(f"/songs/{VID}", json={"tags": ["genre:house", "genre:zzqq", "genre:zzzz"]}, headers=H)
    assert bad.status_code == 422
    assert bad.json()["value"] == "zzzz"


def test_patch_without_tags_never_validates(client):
    add(client, audio=False, tags=["genre:house"])
    assert client.patch(f"/songs/{VID}", json={"title": "Other"}, headers=H).status_code == 200


# --- suggestions are silently narrowed to the vocabulary -------------------------------------


def test_finalize_tags_drops_names_outside_the_vocabulary():
    out = metadata.finalize_tags(["genre:house", "genre:zzzfoo", "genre:trance", "country:lt"], ["house", "zzzbar"])
    assert out == ["genre:house", "genre:trance", "country:lt"]


def test_finalize_tags_priority_counts_only_canonical_song_genres():
    song = [f"genre:{REAL[i]}" for i in range(10)]
    out = metadata.finalize_tags(["genre:zzz1", *[f"genre:{g}" for g in ("soul", "funk")]], ["zzz2", *[REAL[i] for i in range(10)]])
    assert out == song


def test_yt_dlp_genre_suggestions_are_narrowed():
    assert extractor.suggest_tags({"genre": "House, Qqqq Zzzz"}) == ["genre:house"]


def test_identify_suggestions_are_narrowed():
    from app import identify

    tags = identify.merge_tags({"tags": ["genre:qqq zzz", "genre:trance"]}, {"tags": ["genre:zzzz"]}, {})
    assert tags == ["genre:trance"]


def test_metafill_adds_only_canonical_genres():
    song = {"id": "a", "title": "A", "mainArtists": ["Z"], "tags": ["genre:house"], "albums": ["x"], "releaseYear": None}
    assert metafill.apply(song, {"tags": ["genre:qqqq", "genre:techno", "country:lt"]})
    assert song["tags"] == ["genre:house", "genre:techno", "country:lt"]
    other = {"id": "b", "title": "B", "tags": [], "albums": ["x"], "releaseYear": None}
    assert not metafill.apply(other, {"tags": ["genre:qqqq"]})
    assert other["tags"] == []


# --- GET /genres/vocabulary (TAG-080) --------------------------------------------------------


def test_vocabulary_endpoint_lists_every_name_with_family_and_level(client):
    r = client.get("/genres/vocabulary", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["families"] == FAMILIES
    assert body["count"] == len(body["genres"]) == len(names())
    by = {g["name"]: g for g in body["genres"]}
    assert by["house"]["family"] == "Others"
    assert by["house"]["level"] == "genre"
    assert not by["house"]["extra"]
    assert by["rock"]["level"] == "family"
    assert by["rock"]["parents"] == []
    assert by["rock"]["family"] == "Rock"
    assert by["neurofunk"]["extra"]
    assert by["neurofunk"]["parents"] == ["drum and bass"]
    assert by["house"]["parents"] == ["Others"]
    assert "parent" not in by["house"] and "also_under" not in by["house"]
    assert [g["name"] for g in body["genres"]] == sorted(by)
    assert body["aliases"]["dnb"] == "drum and bass"
    assert body["aliases"]["indie"] == "indie rock"
    assert "progressive" not in body["aliases"]
    assert set(body["aliases"].values()) <= set(by)


def test_vocabulary_endpoint_is_built_once(client):
    a = genre_vocab.vocabulary()
    assert genre_vocab.vocabulary() is a


def test_vocabulary_endpoint_needs_credentials_or_the_public_view(client):
    assert client.get("/genres/vocabulary").status_code == 401


def test_vocabulary_endpoint_is_readable_by_guests(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    add(client, audio=False)
    guest = client.get("/genres/vocabulary")
    assert guest.status_code == 200
    assert guest.json()["count"] == len(names())
    assert guest.headers["cache-control"] == "private, no-cache"


# --- migration review report (TAG-082) -------------------------------------------------------


@pytest.fixture
def datadir(tmp_path, monkeypatch):
    monkeypatch.setattr(migrate_tags.deps, "data_root", lambda: tmp_path)
    monkeypatch.setattr(migrate_tags.deps, "SYNC", None)
    return tmp_path


def _lib(root: Path, uid: str, songs: list[dict]) -> Path:
    d = root / "users" / uid
    d.mkdir(parents=True, exist_ok=True)
    path = d / "library.json"
    path.write_text(json.dumps({"settings": {}, "songs": songs}))
    return path


def test_unmappable_tags_are_kept_and_reported_outside_the_synced_tree(datadir, caplog):
    songs = [
        {"id": "a", "title": "A", "tags": ["genre:zzqq", "genre:house music", "x"]},
        {"id": "b", "title": "B", "tags": ["genre:zzqq", "genre:qqzz"]},
        {"id": "c", "title": "C", "tags": ["genre:house"]},
    ]
    lib = _lib(datadir, "u1", songs)
    with caplog.at_level(logging.WARNING, logger="app.migrate_tags"):
        migrate_tags.run()
    stored = json.loads(lib.read_text())["songs"]
    assert library.tag_list(stored[0]) == ["genre:zzqq", "genre:house", "x"]
    assert library.tag_list(stored[1]) == ["genre:zzqq", "genre:qqzz"]
    report = json.loads((datadir / "backups-genre-merge" / "review-u1.json").read_text())
    assert report == {"uid": "u1", "unmappable": [
        {"tag": "zzqq", "songs": 2, "sample_ids": ["a", "b"]},
        {"tag": "qqzz", "songs": 1, "sample_ids": ["b"]},
    ]}
    assert "2 unmappable genre tags" in caplog.text
    assert not list(datadir.glob("users/**/review-*"))


def test_review_report_is_rewritten_only_when_it_changes(datadir):
    lib = _lib(datadir, "u1", [{"id": "a", "title": "A", "tags": ["genre:zzqq"]}])
    migrate_tags.run()
    target = datadir / "backups-genre-merge" / "review-u1.json"
    first = target.stat().st_mtime_ns
    text = target.read_text()
    migrate_tags.run()
    assert target.stat().st_mtime_ns == first
    assert target.read_text() == text
    assert json.loads(lib.read_text())["songs"][0]["tags"] == ["genre:zzqq"]
    _lib(datadir, "u1", [{"id": "a", "title": "A", "tags": ["genre:house"]}])
    migrate_tags.run()
    assert json.loads(target.read_text()) == {"uid": "u1", "unmappable": []}


def test_review_report_is_empty_when_everything_maps(datadir):
    _lib(datadir, "u2", [{"id": "a", "title": "A", "tags": ["genre:house", "genre:popular"]}])
    migrate_tags.run()
    assert json.loads((datadir / "backups-genre-merge" / "review-u2.json").read_text()) == {"uid": "u2", "unmappable": []}


def test_migration_still_backs_up_before_rewriting_and_reports_after(datadir):
    original = json.dumps({"settings": {}, "songs": [{"id": "a", "title": "A", "tags": ["genre:house music", "genre:zzqq"]}]})
    d = datadir / "users" / "u3"
    d.mkdir(parents=True)
    (d / "library.json").write_text(original)
    assert migrate_tags.run() == 1
    assert (datadir / "backups-genre-merge" / "u3" / "library.json").read_text() == original
    assert json.loads((datadir / "backups-genre-merge" / "review-u3.json").read_text())["unmappable"][0]["tag"] == "zzqq"
    assert migrate_tags.run() == 0


# --- the live library as a fixture (TAG-083) -------------------------------------------------


def test_live_library_tags_all_map_or_are_reported():
    unmappable = set()
    for tag in LIVE["tags"]:
        cleaned = library.clean_tag(f"genre:{tag}", list(LIVE["tags"]))
        if not cleaned:
            continue
        value = cleaned[len("genre:"):]
        if not genre_vocab.is_canonical(value):
            unmappable.add(tag)
    assert unmappable == LIVE_UNMAPPABLE, sorted(unmappable ^ LIVE_UNMAPPABLE)


def test_live_library_mapping_is_idempotent():
    for tag in LIVE["tags"]:
        once = library.clean_tag(f"genre:{tag}")
        assert library.clean_tag(once) == once


# --- the anchor genre of a graph node for the outline (GEN-047) ------------------------------------------------


def test_own_anchor_is_the_nodes_own_vocabulary_genre():
    assert gg.own_anchor("House music", ["house"]) == "house"
    assert gg.own_anchor("zzz", ["trance"]) == "trance"
    assert gg.own_anchor("electronic music") is None
    assert gg.own_anchor("popular music") is None
    assert gg.own_anchor("neurofunk") == "neurofunk"


@pytest.mark.parametrize(
    "own,parents,reach,expect",
    [
        ({"a": "house"}, {"a": []}, {"a": {1}}, {"a": "house"}),
        ({"a": None, "p": "trance"}, {"a": ["p"], "p": []}, {"a": {1}, "p": {1, 2}}, {"a": "trance", "p": "trance"}),
        ({"a": None, "m": None, "p": "techno"}, {"a": ["m"], "m": ["p"], "p": []}, {"a": {1}, "m": {1}, "p": {1}}, {"a": "techno", "m": "techno"}),
        ({"a": None, "p": "trance", "q": "house"}, {"a": ["p", "q"]}, {"a": {1}, "p": {1}, "q": {1, 2, 3}}, {"a": "house"}),
        ({"a": None, "p": "trance", "q": "house"}, {"a": ["p", "q"]}, {"a": {1}, "p": {1}, "q": {1}}, {"a": "house"}),
        ({"a": "house", "p": "trance"}, {"a": ["p"]}, {"a": {1}, "p": {1}}, {"a": "house"}),
        ({"a": None, "u": None}, {"a": ["u"]}, {"a": {1}, "u": {1}}, {"a": None, "u": None}),
        ({"a": None, "b": None}, {"a": ["b"], "b": ["a"]}, {"a": {1}, "b": {1}}, {"a": None}),
    ],
)
def test_resolve_anchors(own, parents, reach, expect):
    got = gg.resolve_anchors(own, parents, reach)
    for k, v in expect.items():
        assert got[k] == v


def test_the_graph_exposes_an_anchor_per_node(client):
    from tests.test_genre_graph import songs

    nodes = gg.build(songs(("s1", ["house", "neurofunk"]), ("s2", ["electronic"])), {"labels": {}, "entities": {}})["nodes"]
    by = {n["label"]: n for n in nodes}
    assert by["house"]["anchor"] == "house"
    assert by["neurofunk"]["anchor"] == "neurofunk"
    assert by["electronic"]["anchor"] is None
    assert all("anchor" in n and n["style"] == n["anchor"] for n in nodes)



@pytest.mark.parametrize("raw", ["soviet wave", "Soviet Wave", "sovietwave", "Soviet-Wave", "soviet-wave", "советская волна", "Советская-волна", "советская-волна"])
def test_soviet_wave_spellings_resolve(raw):
    assert gf.vocabulary_name(raw) == "sovietwave"


def test_the_payload_has_sovietwave_and_not_soviet_wave():
    genre_vocab.reset()
    body = genre_vocab.vocabulary()
    assert "sovietwave" in body["levels"] and "soviet wave" not in body["levels"]
    names = {r["name"] for r in body["genres"]}
    assert "sovietwave" in names and "soviet wave" not in names


def test_migration_rewrites_a_stored_soviet_wave_to_sovietwave_with_a_backup(datadir):
    original = json.dumps({"settings": {}, "songs": [{"id": "a", "title": "A", "tags": ["genre:soviet wave", "genre:synthwave"]}, {"id": "b", "title": "B", "tags": ["genre:Soviet Wave", "genre:sovietwave"]}]})
    d = datadir / "users" / "u4"
    d.mkdir(parents=True)
    (d / "library.json").write_text(original)
    assert migrate_tags.run() == 1
    stored = json.loads((d / "library.json").read_text())["songs"]
    assert library.tag_list(stored[0]) == ["genre:sovietwave", "genre:synthwave"]
    assert library.tag_list(stored[1]) == ["genre:sovietwave"]
    assert (datadir / "backups-genre-merge" / "u4" / "library.json").read_text() == original
    assert migrate_tags.run() == 0


def test_soviet_wave_hashtag_is_a_youtube_genre():
    from app import yt_genres

    assert yt_genres.genre_of("#SovietWave") == "sovietwave"
    assert yt_genres.genre_of("Soviet Wave") == "sovietwave"


def test_lofi_is_removed_everywhere_and_its_tag_is_dropped():
    assert "lo-fi" not in DISCOGS["genres"] and "lo-fi" not in EXTRAS
    assert genre_vocab.lookup("lo-fi") is None and "lo-fi" not in names()
    assert gf.is_dropped("lo-fi") and gf.is_dropped("Lo-Fi") and not gf.is_dropped("lo-fi hip hop")
    assert "lo-fi" not in gf.ALIASES.values()
    assert library.clean_tags(["genre:lo-fi", "genre:shoegaze"]) == ["genre:shoegaze"]
