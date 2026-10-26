"""The genre suggestion rule (TAG-099 to TAG-108, decision EH1, variant B): one test group per requirement R1-R12 of the design."""

import json
from pathlib import Path

import pytest

from app import genre_suggest as gs
from app import metadata
from app import genre_vocab

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "genre_suggest_evidence.json").read_text(encoding="utf-8"))
CASES = {k: v for k, v in FIXTURE.items() if not k.startswith("_")}

MB, WS, WA, DC, YT = gs.MUSICBRAINZ, gs.WIKIPEDIA_SONG, gs.WIKIPEDIA_ARTIST, gs.DISCOGS, gs.YOUTUBE


def decide(groups, **kw):
    return gs.decide(groups, **kw)


def names(d):
    return [s["genre"] for s in d.suggestions]


def by_name(d):
    return {s["genre"]: s for s in d.suggestions}


AFTER_LEAVING_OTHERS = {"taylor_dayne_tell_it_to_my_heart": {"applied": ["dance pop", "pop", "synthpop"], "suggested": ["freestyle", "hi-nrg", "soul", "house", "contemporary r&b"]}}  # 2026-10-20: hi-nrg (under disco) left Others, so the agreed `electronic` no longer rescues it


@pytest.mark.parametrize("case", sorted(CASES))
def test_owner_examples_as_recorded_evidence(case):
    c = {**CASES[case], **AFTER_LEAVING_OTHERS.get(case, {})}
    d = decide(c["groups"], versioned=c.get("versioned", False))
    assert sorted(d.applied) == sorted(c["applied"])
    assert sorted(names(d)) == sorted(c["suggested"])


def test_taylor_dayne_applies_the_owner_genres_and_never_soul_house_or_freestyle():
    d = decide(CASES["taylor_dayne_tell_it_to_my_heart"]["groups"])
    assert set(d.applied) == {"dance pop", "pop", "synthpop"}, "electronic is never applied; hi-nrg left Others (2026-10-20), so the agreed group no longer rescues it"
    assert not {"soul", "house", "freestyle", "hi-nrg"} & set(d.applied)
    assert by_name(d)["hi-nrg"]["reason"] == gs.NO_FAMILY
    assert by_name(d)["freestyle"]["reason"] == gs.AMBIGUOUS_NAME
    assert by_name(d)["soul"]["sources"] == [WA]
    assert by_name(d)["house"]["reason"] == gs.SINGLE_SOURCE


def test_massive_attack_angel_does_not_apply_industrial_rock():
    d = decide(CASES["massive_attack_angel"]["groups"])
    assert set(d.applied) == {"trip hop"}
    assert by_name(d)["industrial rock"] == {"genre": "industrial rock", "sources": [WS], "reason": gs.NO_FAMILY}
    assert "downtempo" not in names(d), "downtempo is an ancestor of the applied trip hop: dropped, not suggested"


def test_a_version_applies_nothing_from_the_original_and_marks_the_hint():
    d = decide(CASES["prodigy_voodoo_people_pendulum_remix"]["groups"], versioned=True)
    assert d.applied == []
    assert all(s["sources"][0] == gs.ORIGINAL and s["reason"] == gs.FROM_ORIGINAL for s in d.suggestions)
    assert by_name(d)["techno"]["sources"] == [gs.ORIGINAL, WS, WA]


def test_the_same_recording_prodigy_remaster_prunes_breakbeat_beside_big_beat():
    d = decide(CASES["prodigy_voodoo_people_remaster"]["groups"])
    assert "breakbeat" not in d.applied
    assert "breakbeat" not in names(d)
    assert set(d.applied) == {"big beat", "techno"}


def test_r1_every_suggestion_carries_its_sources_and_a_reason_in_evidence_order():
    d = decide({MB: ["folk", "techno"], WS: ["punk"], WA: ["disco"], DC: ["techno"]}, weights={DC: gs.DISCOGS_SEARCH_WEIGHT})
    assert d.applied == []
    assert all(set(s) == {"genre", "sources", "reason"} and s["sources"] and s["reason"] for s in d.suggestions)
    assert by_name(d)["techno"] == {"genre": "techno", "sources": [MB, DC], "reason": gs.INSUFFICIENT}
    assert by_name(d)["folk"] == {"genre": "folk", "sources": [MB], "reason": gs.SINGLE_SOURCE}
    assert names(d) == ["techno", "folk", "punk", "disco"], "more sources first, then the group order"


def test_r2_two_hits_from_one_group_count_once():
    assert decide({YT: ["house", "house", "House"]}).applied == []
    assert decide({MB: ["pop", "pop music"]}).applied == []
    d = decide({WS: ["house", "house"], MB: ["house"]})
    assert d.applied == ["house"]
    assert d.sources["house"] == [MB, WS]


def test_r2_the_song_page_and_the_artist_page_are_two_groups():
    d = decide({WS: ["pop"], WA: ["pop"]})
    assert d.applied == ["pop"]
    assert d.sources["pop"] == [WS, WA]


def test_r3_a_child_counts_for_its_ancestor_on_the_primary_chain():
    d = decide({MB: ["house"], YT: ["deep house"]})
    assert d.applied == ["house"]
    assert by_name(d)["deep house"]["reason"] == gs.SINGLE_SOURCE


def test_r3_a_genre_nobody_listed_is_never_invented():
    d = decide({MB: ["deep house"], WA: ["french house"]})
    assert d.applied == []
    assert "house" not in names(d)
    assert "electronic" not in names(d)


def test_r3_electronic_is_ignored_evidence_and_never_unlocks_a_song_page_genre():
    d = decide({MB: ["electronic"], WS: ["breakbeat", "techno"], WA: ["house"]})
    assert d.applied == []
    assert "electronic" not in names(d)
    assert by_name(d)["breakbeat"]["reason"] == gs.NO_FAMILY
    assert by_name(d)["house"]["sources"] == [WA]


def test_r3_ancestors_and_families_use_every_parent():
    t = gs.get_tree()
    assert gs.ancestors("deep house", t) == ["house"]
    assert gs.ancestors("others", t) == []
    assert gs.ancestors("hi-nrg", t)[0] == "disco"
    assert set(gs.ancestors("hi-nrg", t)) == {"disco", "funk / soul"}
    assert set(gs.ancestors("industrial rock", t)) == {"rock"}
    assert t.family["hi-nrg"] == {"funk / soul"}
    assert t.family["industrial rock"] == {"rock"}
    assert t.family["hip house"] == {"house", "hip hop"}
    assert t.family["deep house"] == {"house"}
    assert t.family["breakbeat"] == {"others"}
    assert (t.depth["hi-nrg"], t.depth["hip house"], t.depth["deep house"]) == (3, 2, 2)


def test_r4_the_song_page_alone_applies_a_genre_sharing_a_real_family_with_an_agreed_one():
    d = decide({MB: ["house"], WA: ["house"], WS: ["tech house"]})
    assert d.applied == ["tech house"], "house is pruned as the non-family ancestor of tech house"
    assert d.sources["tech house"] == [WS]
    d = decide({MB: ["electronic"], WA: ["electronic"], WS: ["breakbeat"]})
    assert d.applied == []
    assert by_name(d)["breakbeat"]["reason"] == gs.NO_FAMILY


def test_r4_electronic_never_counts_as_agreement_or_a_source_group():
    d = decide({MB: ["electronic"], WA: ["electronic music"], YT: ["electronica"]})
    assert d.applied == []
    assert d.suggestions == []
    d = decide({MB: ["electronic", "house"], WA: ["electronic"], WS: ["electronic"]})
    assert d.applied == []
    assert names(d) == ["house"]
    assert by_name(d)["house"] == {"genre": "house", "sources": [MB], "reason": gs.SINGLE_SOURCE}
    d = decide({MB: ["electronic", "house"], WA: ["house"]})
    assert d.applied == ["house"]
    assert d.sources["house"] == [MB, WA]


def test_r4_the_ignored_names_are_electronic_and_the_group_synonyms():
    from app import genre_vocab

    syn = genre_vocab.load().groups["Others"]["synonyms"]
    assert "electronic" in syn
    assert "rave" in syn
    for n in ["electronic", "Electronic Music", "others", *syn]:
        assert gs.ignored(n), n
    for n in ["house", "edm", "synthpop", "electropop"]:
        assert not gs.ignored(n), n


def test_r4_without_a_shared_family_the_song_page_alone_is_only_suggested():
    d = decide({MB: ["electronic"], WA: ["electronic"], WS: ["folk"]})
    assert d.applied == []
    assert by_name(d)["folk"]["reason"] == gs.NO_FAMILY


def test_r4_with_nothing_agreed_nothing_is_rescued():
    d = decide({WS: ["techno", "house"]})
    assert d.applied == []
    assert by_name(d)["techno"]["reason"] == gs.NO_FAMILY


def test_r4_a_rescued_genre_does_not_open_the_door_for_another():
    d = decide({MB: ["pop"], WA: ["pop"], WS: ["folk", "synthpop"]})
    assert "folk" not in d.applied


def test_r4_the_artist_page_never_rescues():
    d = decide({MB: ["electronic"], YT: ["electronic"], WA: ["techno"]})
    assert d.applied == []
    assert by_name(d)["techno"]["sources"] == [WA]


def test_r4_the_artist_infobox_is_not_promoted_to_the_song_page(monkeypatch):
    from app import wiki_lookup as wl

    box = {"https://en.wikipedia.org/wiki/Song": {"album": None, "year": None, "name": None, "artist": None, "genres": [], "kind": "song"},
           "https://en.wikipedia.org/wiki/Band": {"album": None, "year": None, "name": None, "artist": None, "genres": ["Dance pop", "Freestyle"], "kind": "band"}}
    monkeypatch.setattr(wl, "infobox", lambda url: dict(box[url]))
    monkeypatch.setattr(wl, "infobox_genres", lambda url: list(box[url]["genres"]))
    found = {"tags": ["genre:pop", "country:us"], "song_genres": ["genre:synthpop"], "artist_genres": ["genre:pop"]}
    wl._with_infobox(found, "https://en.wikipedia.org/wiki/Song", "https://en.wikipedia.org/wiki/Band")
    assert found["song_genres"] == ["genre:synthpop"]
    assert found["artist_genres"] == ["genre:Dance pop", "genre:Freestyle", "genre:pop"]
    assert found["tags"][:3] == ["genre:synthpop", "genre:Dance pop", "genre:Freestyle"]
    assert "country:us" in found["tags"]


def test_r4_the_song_infobox_genres_come_first_in_the_song_group(monkeypatch):
    from app import wiki_lookup as wl

    monkeypatch.setattr(wl, "infobox", lambda url: {"album": None, "year": None, "name": None, "artist": None, "genres": ["Hi-NRG"], "kind": "song"})
    monkeypatch.setattr(wl, "infobox_genres", lambda url: pytest.fail("the artist page is not read when the song page has genres"))
    found = {"tags": ["genre:synthpop", "genre:pop"], "song_genres": ["genre:synthpop"], "artist_genres": ["genre:pop"]}
    wl._with_infobox(found, "https://en.wikipedia.org/wiki/Song", "https://en.wikipedia.org/wiki/Band")
    assert found["song_genres"] == ["genre:Hi-NRG", "genre:synthpop"]
    assert found["artist_genres"] == ["genre:pop"]


def test_r5_an_artist_level_genre_never_applies_alone():
    assert decide({WA: ["pop", "techno"]}).applied == []
    assert decide({MB: ["pop"]}).applied == []
    d = decide({WA: ["pop"], MB: ["pop"]})
    assert d.applied == ["pop"], "but it counts as support"


@pytest.mark.parametrize("name", sorted(gs.AMBIGUOUS))
def test_r6_ambiguous_names_need_two_groups(name):
    if genre_vocab.lookup(name) is None:
        pytest.skip(f"{name} is not in the vocabulary (yet): the list is a constant that can grow")
    fam = gs.get_tree().family[name]
    base = {MB: [fam], WA: [fam]}
    one = decide({**base, WS: [name]})
    assert name not in one.applied
    assert by_name(one)[name]["reason"] == gs.AMBIGUOUS_NAME
    two = decide({**base, WS: [name], YT: [name]})
    assert name in two.applied


def test_r6_the_ambiguity_list_is_a_data_constant():
    assert {"freestyle", "hardcore", "soul", "garage"} <= set(gs.AMBIGUOUS)
    assert "industrial" not in gs.AMBIGUOUS
    assert isinstance(gs.AMBIGUOUS, frozenset)


def test_r6_youtube_own_values_ignore_acoustic_instrumental_live_remix():
    d = decide({YT: ["acoustic", "instrumental", "live", "remix", "house"], MB: ["house", "acoustic"]})
    assert d.applied == ["house"]
    assert not {"instrumental", "live", "remix"} & set(names(d))
    assert by_name(d)["acoustic"]["sources"] == [MB], "only the link's own group ignores them"


GENRES_8 = ["deep house", "french house", "hi-nrg", "breakbeat", "ambient", "others", "pop", "rock"]


def test_r7_at_most_five_most_specific_first():
    d = decide({MB: GENRES_8, WA: GENRES_8})
    assert len(d.applied) == 5
    assert d.applied[0] == "hi-nrg", "the only level 3 genre comes first"
    assert set(d.applied[1:]) == {"deep house", "french house", "breakbeat", "ambient"}
    over = {s["genre"] for s in d.suggestions if s["reason"] == gs.OVER_CAP}
    assert over == {"pop", "rock"}, "others is a group, not a genre: never a candidate"


def test_r7_ties_go_to_the_genre_with_more_sources():
    d = decide({MB: ["techno", "trance"], WA: ["techno", "trance"], YT: ["trance"]})
    assert d.applied == ["trance", "techno"], "same depth; trance has three sources although techno sorts first by name"


def test_r7_a_non_family_ancestor_is_dropped_beside_its_child_and_not_suggested():
    d = decide({MB: ["house", "deep house", "electronic"], WA: ["house", "deep house", "electronic"]})
    assert set(d.applied) == {"deep house"}
    assert "house" not in names(d)


def test_r7_family_names_stay_beside_a_child():
    d = decide({MB: ["pop", "dance pop"], WA: ["pop", "dance pop"]})
    assert set(d.applied) == {"pop", "dance pop"}


def test_r8_without_agreement_nothing_is_applied_and_everything_is_suggested():
    d = decide({MB: ["techno"], WA: ["folk"], DC: ["disco"], YT: ["trance"]})
    assert d.applied == []
    assert sorted(names(d)) == ["disco", "folk", "techno", "trance"]
    assert {s["reason"] for s in d.suggestions} == {gs.SINGLE_SOURCE}


def test_r8_suggestions_are_capped_and_never_repeat_an_applied_genre():
    many = [f"genre:{g}" for g in ("techno", "trance", "house", "jungle", "breaks", "glitch", "idm", "drone", "ambient", "disco", "funk", "soul", "punk", "folk")]
    d = decide({WS: many})
    assert len(d.suggestions) == gs.MAX_SUGGESTED
    d2 = decide({MB: ["pop"], WA: ["pop"]})
    assert d2.suggestions == []


def test_r9_a_discogs_search_hit_counts_half_and_never_alone():
    half = {gs.DISCOGS: gs.DISCOGS_SEARCH_WEIGHT}
    d = decide({DC: ["techno"]}, weights=half)
    assert d.applied == []
    d = decide({DC: ["techno"], MB: ["techno"]}, weights=half)
    assert d.applied == [], "1.5 is not two sources"
    assert by_name(d)["techno"]["reason"] == gs.INSUFFICIENT
    d = decide({DC: ["techno"], MB: ["techno"], WA: ["techno"]}, weights=half)
    assert d.applied == ["techno"]


def test_r9_a_discogs_master_or_link_counts_fully():
    d = decide({DC: ["techno"], MB: ["techno"]})
    assert d.applied == ["techno"]
    assert metadata.disc_is_full({"from_link": True, "url": "https://www.discogs.com/release/1"})
    assert metadata.disc_is_full({"url": "https://www.discogs.com/master/1"})
    assert not metadata.disc_is_full({"url": "https://www.discogs.com/release/1"})
    assert not metadata.disc_is_full(None)


def test_r9_resolve_passes_the_weight():
    search = metadata.resolve(mb=["genre:techno"], disc=["genre:techno"], disc_full=False)
    master = metadata.resolve(mb=["genre:techno"], disc=["genre:techno"], disc_full=True)
    assert search["tags"] == []
    assert master["tags"] == ["genre:techno"]
    assert search["genre_suggestions"] == [{"genre": "techno", "sources": [MB, DC], "reason": gs.INSUFFICIENT}]


def test_r10_a_version_applies_only_its_own_link_and_the_rest_is_marked_original():
    d = decide({YT: ["dubstep", "acoustic"], MB: ["techno", "dubstep"], WA: ["pop"]}, versioned=True)
    assert d.applied == ["dubstep"]
    s = by_name(d)
    assert s["techno"] == {"genre": "techno", "sources": [gs.ORIGINAL, MB], "reason": gs.FROM_ORIGINAL}
    assert s["pop"]["sources"][0] == gs.ORIGINAL
    assert "dubstep" not in s
    assert "acoustic" not in s


def test_r10_the_remixers_artist_page_is_marked_remixer():
    d = decide({WA: ["drum and bass"], MB: ["techno"]}, versioned=True, origin={WA: gs.REMIXER})
    s = by_name(d)
    assert s["drum and bass"] == {"genre": "drum and bass", "sources": [gs.REMIXER, WA], "reason": gs.FROM_REMIXER}
    assert s["techno"]["sources"][0] == gs.ORIGINAL


def test_r10_a_version_without_its_own_source_has_no_genre():
    d = decide({MB: ["techno"], WS: ["techno"], WA: ["techno"], DC: ["techno"]}, versioned=True)
    assert d.applied == []


def test_r10_own_genres_of_a_version_are_pruned_and_capped_too():
    own = ["trance", "progressive trance", "techno", "house", "deep house", "jungle", "breaks", "idm"]
    d = decide({YT: own}, versioned=True)
    assert len(d.applied) == gs.MAX_APPLIED
    assert "trance" not in d.applied or "progressive trance" not in d.applied


def test_r10_resolve_lists_the_original_hint_as_genre_tags():
    out = metadata.resolve(own=["genre:trance"], mb=["genre:synthpop"], wiki_song=["genre:art pop"], versioned=True, remixer_artist=False)
    assert out["tags"] == ["genre:trance"]
    assert sorted(out["original_genres"]) == ["genre:art pop", "genre:synthpop"]
    out = metadata.resolve(wiki_artist=["genre:drum and bass"], versioned=True, remixer_artist=True)
    assert out["genre_suggestions"][0]["sources"][0] == gs.REMIXER
    assert out["original_genres"] == ["genre:drum and bass"]


def test_resolve_keeps_the_non_genre_tags_and_drops_lang():
    out = metadata.resolve(
        own=["lang:ru", "genre:techno", "decade:1990s"], mb=["genre:techno", "country:de", "country:fr"], wiki_tags=["country:gb"], disc=["country:it"],
    )
    assert out["tags"] == ["genre:techno", "decade:1990s", "country:de"]


def test_resolve_response_shape_is_additive():
    out = metadata.resolve()
    assert out == {"tags": [], "original_genres": [], "genre_suggestions": []}


def test_the_tree_is_rebuilt_when_the_vocabulary_is_reloaded():
    first = gs.get_tree()
    assert gs.get_tree() is first
    genre_vocab.reset()
    assert gs.get_tree() is not first


def test_wiki_groups_prefers_the_links_and_falls_back_to_listed_genres():
    links = {"song_genres": ["genre:techno"], "artist_genres": ["genre:pop"], "tags": ["genre:techno", "genre:pop"]}
    guess = {"song_genres": ["genre:house"], "artist_genres": []}
    assert metadata.wiki_groups(links, guess) == (["genre:techno"], ["genre:pop"])
    assert metadata.wiki_groups({}, guess) == (["genre:house"], [])
    assert metadata.wiki_groups({"tags": ["genre:a", "genre:b"], "song_genres": ["genre:a"]}, None) == (["genre:a"], ["genre:b"])
    assert metadata.wiki_groups(None, None) == ([], [])
