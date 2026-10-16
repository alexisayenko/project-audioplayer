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
STYLES = json.loads((DATA / "genre_styles.json").read_text(encoding="utf-8"))
EXTRAS = json.loads((DATA / "genre_extras.json").read_text(encoding="utf-8"))["extras"]
LIVE = json.loads((Path(__file__).parent / "fixtures" / "genre_live_tags.json").read_text(encoding="utf-8"))
GENRES = ["Blues", "Brass & Military", "Children's", "Classical", "Electronic", "Folk, World, & Country", "Funk / Soul", "Hip Hop", "Jazz", "Latin", "Non-Music", "Pop", "Reggae", "Rock", "Stage & Screen"]

# Tags of the live library (2026-10-16) that no rule maps: kept on the songs and listed in the review file (TAG-082).
LIVE_UNMAPPABLE: set[str] = set()


def names() -> set[str]:
    return set(genre_vocab.load().entries)


# --- the data files (TAG-078, TAG-083) -------------------------------------------------------


def test_the_15_genres_in_the_fixed_order():
    assert STYLES["genres"] == GENRES
    assert genre_vocab.load().families == tuple(GENRES)


def test_styles_are_lowercase_trimmed_and_filed_under_a_genre():
    styles = STYLES["styles"]
    assert len(styles) >= 450
    for style, genre in styles.items():
        assert style and style == " ".join(style.lower().split()), style
        assert genre in GENRES, (style, genre)


def test_no_style_in_two_genres_unless_marked_multi_genre():
    styles, also = STYLES["styles"], STYLES["also_under"]
    assert all(isinstance(g, str) for g in styles.values())
    for style, others in also.items():
        assert style in styles, style
        assert others and len(set(others)) == len(others), style
        assert styles[style] not in others, style
        assert set(others) <= set(GENRES), style
    assert genre_vocab.load().also_under == {s: tuple(o) for s, o in also.items()}


def test_names_are_unique_after_folding_case_spaces_hyphens_and_ampersand():
    seen: dict[str, str] = {}
    for name in [*(g.lower() for g in GENRES), *STYLES["styles"], *EXTRAS]:
        k = genre_vocab.vkey(name)
        assert k not in seen, (name, seen.get(k))
        seen[k] = name
    assert len(genre_vocab.load().entries) == len(seen)


def test_discogs_names_belong_to_styles():
    for ours, theirs in STYLES["discogs_names"].items():
        assert ours in STYLES["styles"] and isinstance(theirs, str) and theirs.strip()


def test_extras_have_family_and_a_canonical_parent_without_cycles():
    assert len(EXTRAS) >= 25
    for name, spec in EXTRAS.items():
        assert name == " ".join(name.lower().split()), name
        assert name not in STYLES["styles"], name
        assert spec["family"] in GENRES, name
        assert spec["parent"] is None or spec["parent"] in names() - {name}, (name, spec["parent"])
    for name in EXTRAS:
        seen, cur = {name}, EXTRAS[name]["parent"]
        while cur in EXTRAS:
            assert cur not in seen, f"parent cycle at {name}"
            seen.add(cur)
            cur = EXTRAS[cur]["parent"]


REQUIRED_EXTRAS = (
    "singer-songwriter", "psybient", "darksynth", "dreamwave", "neurofunk", "liquid drum and bass", "melodic techno",
    "dance-rock", "estrada", "shock rock", "nu-nrg", "uplifting trance", "chillwave", "darkwave",
    "folk", "dark metal", "epic", "trailer", "dreamsynth", "sunshine house", "synth-rock", "electronic",
)


@pytest.mark.parametrize("name", REQUIRED_EXTRAS)
def test_kept_subgenres_are_canonical(name):
    assert genre_vocab.is_canonical(name)
    assert gf.canonical(name) == name


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
    assert {e.family for e in genre_vocab.load().entries.values()} == set(GENRES)


# --- lookup and suggestions ------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,want",
    [("House", "house"), ("hip-hop", "hip hop"), ("Hip Hop", "hip hop"), ("rhythm & blues", "rhythm and blues"), ("drum & bass", "drum and bass"),
     ("psy-trance", gf.canonical("psytrance")), ("zzz", None), ("", None)],
)
def test_lookup(raw, want):
    assert genre_vocab.lookup(raw) == want


def test_family_of_also_reads_the_music_form():
    assert genre_vocab.family_of("house") == "Electronic"
    assert genre_vocab.family_of("house music") == "Electronic"
    assert genre_vocab.family_of("zzz") is None
    assert genre_vocab.is_style("house") and not genre_vocab.is_style("electronic")


def test_suggest_returns_up_to_five_close_names():
    got = genre_vocab.suggest("tecno")
    assert "techno" in got and len(got) <= 5
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
    assert err.value.status == 422 and body["error"] == "unknown_genre"
    assert body["value"] == "tecno" and "techno" in body["suggestions"] and len(body["suggestions"]) <= 5
    assert "Did you mean" in body["detail"] and "techno" in body["detail"]
    assert body["unknown"][0]["value"] == "tecno"


def test_reject_unknown_genre_without_close_names_points_to_the_list():
    with pytest.raises(Problem) as err:
        reject_unknown_genre(["genre:qqqqzzzz"])
    assert err.value.body()["suggestions"] == [] and "/genres/vocabulary" in err.value.body()["detail"]


def test_reject_unknown_genre_passes_known_other_namespaces_and_stored_values():
    reject_unknown_genre(["genre:house", "country:lt", "mood:calm", "80s"])
    reject_unknown_genre(["genre:zzqq"], ["genre:zzqq"])
    with pytest.raises(Problem):
        reject_unknown_genre(["genre:zzqq", "genre:zzz"], ["genre:zzqq"])


def test_create_rejects_unknown_genre_and_applies_nothing(client):
    r = add(client, tags=["genre:tecno", "80s"])
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "unknown_genre" and "techno" in body["suggestions"]
    assert client.get("/library", headers=H).json()["songs"] == []


def test_create_accepts_aliases_and_canonicalises(client):
    r = add(client, metadata={"title": "S"}, audio=False, tags=["genre:Drum & Bass", "genre:house music", "genre:EDM"])
    assert r.status_code == 201
    assert r.json()["song"]["tags"][:3] == ["genre:drum and bass", "genre:house", "genre:electronic"]


def test_create_still_drops_junk_silently(client):
    r = add(client, audio=False, tags=["genre:popular", "genre:house"])
    assert r.status_code == 201
    assert [t for t in r.json()["song"]["tags"] if t.startswith("genre:")] == ["genre:house"]


def test_patch_rejects_unknown_genre_and_keeps_the_song(client):
    add(client, audio=False, tags=["genre:house"])
    r = client.patch(f"/songs/{VID}", json={"tags": ["genre:house", "genre:housee"], "title": "New"}, headers=H)
    assert r.status_code == 422
    assert r.json()["error"] == "unknown_genre" and "house" in r.json()["suggestions"]
    song = client.get("/library", headers=H).json()["songs"][0]
    assert song["title"] == "Song" and "genre:housee" not in song["tags"]


def test_patch_lets_a_stored_unmappable_tag_stay(client, tmp_path):
    from tests.test_library import ODIR

    add(client, audio=False, tags=["genre:house"])
    lib = ODIR(tmp_path) / "library.json"
    doc = json.loads(lib.read_text())
    doc["songs"][0]["tags"].append("genre:zzqq")
    lib.write_text(json.dumps(doc))
    ok = client.patch(f"/songs/{VID}", json={"tags": ["genre:house", "genre:zzqq", "genre:trance"]}, headers=H)
    assert ok.status_code == 200
    assert ok.json()["tags"][:3] == ["genre:house", "genre:zzqq", "genre:trance"]
    bad = client.patch(f"/songs/{VID}", json={"tags": ["genre:house", "genre:zzqq", "genre:zzzz"]}, headers=H)
    assert bad.status_code == 422 and bad.json()["value"] == "zzzz"


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
    table: list = []
    assert metafill.apply(song, {"tags": ["genre:qqqq", "genre:techno", "country:lt"]}, table)
    assert song["tags"] == ["genre:house", "genre:techno"]
    assert table == [{"name": "Z", "countries": ["lt"]}]
    other = {"id": "b", "title": "B", "tags": [], "albums": ["x"], "releaseYear": None}
    assert not metafill.apply(other, {"tags": ["genre:qqqq"]})
    assert other["tags"] == []


# --- GET /genres/vocabulary (TAG-080) --------------------------------------------------------


def test_vocabulary_endpoint_lists_every_name_with_family_and_level(client):
    r = client.get("/genres/vocabulary", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["families"] == GENRES
    assert body["count"] == len(body["genres"]) == len(names())
    by = {g["name"]: g for g in body["genres"]}
    assert by["house"]["family"] == "Electronic" and by["house"]["level"] == "style" and not by["house"]["extra"]
    assert by["rock"]["level"] == "genre" and by["rock"]["family"] == "Rock"
    assert by["neurofunk"]["extra"] and by["neurofunk"]["parent"] == "drum and bass"
    assert [g["name"] for g in body["genres"]] == sorted(by)
    assert body["aliases"]["dnb"] == "drum and bass" and body["aliases"]["indie"] == "indie rock"
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
    assert guest.status_code == 200 and guest.json()["count"] == len(names())
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
    assert stored[0]["tags"] == ["genre:zzqq", "genre:house", "x"]
    assert stored[1]["tags"] == ["genre:zzqq", "genre:qqzz"]
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
    assert target.stat().st_mtime_ns == first and target.read_text() == text
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


# --- the node style for the outline (GEN-047) ------------------------------------------------


def test_node_style_is_the_nodes_own_vocabulary_style():
    assert gg.node_style("House music", ["house"]) == "house"
    assert gg.node_style("zzz", ["trance"]) == "trance"
    assert gg.node_style("electronic music") is None
    assert gg.node_style("popular music") is None
    assert gg.node_style("neurofunk") == "neurofunk"


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
def test_resolve_styles(own, parents, reach, expect):
    got = gg.resolve_styles(own, parents, reach)
    for k, v in expect.items():
        assert got[k] == v


def test_the_graph_exposes_a_style_per_node(client):
    from tests.test_genre_graph import songs

    nodes = gg.build(songs(("s1", ["house", "neurofunk"]), ("s2", ["electronic"])), {"labels": {}, "entities": {}})["nodes"]
    by = {n["label"]: n for n in nodes}
    assert by["house"]["style"] == "house" and by["neurofunk"]["style"] == "neurofunk"
    assert by["electronic"]["style"] is None
    assert all("style" in n for n in nodes)



@pytest.mark.parametrize("raw", ["Soviet Wave", "sovietwave", "Soviet-Wave", "советская волна", "Советская-волна"])
def test_soviet_wave_spellings_resolve(raw):
    assert gf.vocabulary_name(raw) == "soviet wave"


def test_soviet_wave_hashtag_is_a_youtube_genre():
    from app import yt_genres

    assert yt_genres.genre_of("#SovietWave") == "soviet wave"
