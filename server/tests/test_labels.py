import pytest

from app import deps, labels, library
from tests.test_library import H, OWNER_UID, VID, VID2, add, client  # noqa: F401


def song_of(client, vid=VID):
    return {s["id"]: s for s in client.get("/library", headers=H).json()["songs"]}[vid]


def test_tidy_trims_collapses_spaces_and_removes_duplicates_ignoring_case():
    assert labels.tidy(["  Parvati   Records ", "parvati records", "Iono\tMusic", "", "  ", None, 5]) == ["Parvati Records", "Iono Music"]


def test_tidy_drops_what_a_file_should_not_hold_and_never_raises():
    assert labels.tidy("Parvati Records") == []
    assert labels.tidy(None) == []
    assert labels.tidy(["x" * (labels.MAX_LABEL + 1), "bad\x00name", "ok"]) == ["ok"]
    assert len(labels.tidy([f"Label {i}" for i in range(30)])) == labels.MAX_LABELS


def test_clean_accepts_a_list_and_reports_a_bad_request():
    assert labels.clean(None) == []
    assert labels.clean([" A  B ", "a b", "C"]) == ["A B", "C"]
    for bad in ("A", {"a": 1}, [1], ["a", None], ["x" * (labels.MAX_LABEL + 1)], ["a\x07b"], [f"L{i}" for i in range(labels.MAX_LABELS + 1)]):
        with pytest.raises(ValueError):
            labels.clean(bad)
    assert len(labels.clean([f"L{i}" for i in range(labels.MAX_LABELS)])) == labels.MAX_LABELS


def test_from_discogs_strips_disambiguators_and_placeholders():
    got = labels.from_discogs(["Blue Room Released", "Phonokol (2)", "Not On Label", "Not On Label (Hallucinogen Self-released)", "Self-released", "self released", "Unknown", "  ", None, "blue room released", "Parvati Records (12)"])
    assert got == ["Blue Room Released", "Phonokol", "Parvati Records"]
    assert labels.from_discogs("Parvati Records") == []
    assert labels.from_discogs(None) == []


def test_from_discogs_keeps_a_name_with_a_number_that_is_not_a_disambiguator():
    assert labels.from_discogs(["Studio 54", "Tribal (UK)"]) == ["Studio 54", "Tribal (UK)"]


def test_fields_has_no_key_for_no_labels():
    assert labels.fields([]) == {}
    assert labels.fields(None) == {}
    assert labels.fields(["A", "a"]) == {"labels": ["A"]}


def test_create_stores_normalised_labels_and_the_library_returns_them(client):
    r = add(client, VID, labels=["  Parvati  Records", "parvati records", "Iono Music"], audio=False)
    assert r.status_code == 201, r.text
    assert r.json()["song"]["labels"] == ["Parvati Records", "Iono Music"]
    assert song_of(client)["labels"] == ["Parvati Records", "Iono Music"]
    assert library.find_song(library.load(deps.library_path(OWNER_UID)), VID)["labels"] == ["Parvati Records", "Iono Music"]


def test_create_with_audio_stores_the_labels_too(client):
    assert add(client, VID, labels=["Iono Music"]).status_code == 202
    assert song_of(client)["labels"] == ["Iono Music"]


def test_a_song_without_labels_has_no_key(client):
    assert add(client, VID, audio=False).status_code == 201
    assert "labels" not in song_of(client)
    assert add(client, VID2, labels=[], audio=False).status_code == 201
    assert "labels" not in song_of(client, VID2)


@pytest.mark.parametrize("bad", ["Parvati", [1], ["x" * 101], [f"L{i}" for i in range(11)], ["a\x00"]])
def test_create_rejects_bad_labels_before_anything_is_added(client, bad):
    r = add(client, VID, labels=bad, audio=False)
    assert r.status_code == 422
    assert client.get("/library", headers=H).json()["songs"] == []


def test_patch_sets_replaces_and_clears_the_songs_own_labels(client):
    add(client, VID, labels=["Old Label"], audio=False)
    r = client.patch(f"/songs/{VID}", json={"labels": ["Blue Room Released", "Phonokol", "blue room released"]}, headers=H)
    assert r.status_code == 200
    assert r.json()["labels"] == ["Blue Room Released", "Phonokol"]
    assert song_of(client)["labels"] == ["Blue Room Released", "Phonokol"]
    other = client.patch(f"/songs/{VID}", json={"title": "Renamed"}, headers=H).json()
    assert other["labels"] == ["Blue Room Released", "Phonokol"]
    cleared = client.patch(f"/songs/{VID}", json={"labels": []}, headers=H)
    assert cleared.status_code == 200 and "labels" not in cleared.json()
    assert "labels" not in song_of(client)
    again = client.patch(f"/songs/{VID}", json={"labels": ["X"]}, headers=H).json()
    assert client.patch(f"/songs/{VID}", json={"labels": None}, headers=H).status_code == 200
    assert again["labels"] == ["X"] and "labels" not in song_of(client)


@pytest.mark.parametrize("bad", ["Parvati", [1], ["x" * 101], [f"L{i}" for i in range(11)]])
def test_patch_rejects_bad_labels_and_keeps_the_old_ones(client, bad):
    add(client, VID, labels=["Keep"], audio=False)
    assert client.patch(f"/songs/{VID}", json={"labels": bad}, headers=H).status_code == 422
    assert song_of(client)["labels"] == ["Keep"]


def test_labels_are_not_part_of_the_duplicate_check(client):
    assert add(client, VID, labels=["A"], audio=False).status_code == 201
    again = add(client, VID, labels=["B"], audio=False)
    assert again.status_code == 409
    assert song_of(client)["labels"] == ["A"]


def test_a_stored_song_with_junk_labels_reads_clean(tmp_path):
    songs = library.normalize({"songs": [{"id": VID, "title": "T", "labels": [" Pa  Re ", "pa re", 4, ""]}, {"id": VID2, "title": "U", "labels": "x"}]})["songs"]
    assert songs[0]["labels"] == ["Pa Re"]
    assert "labels" not in songs[1]
