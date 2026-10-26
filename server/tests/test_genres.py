from app import genres
from tests.test_library import H, add, client  # noqa: F401


def test_builtin_list_is_clean():
    g = genres.BUILTIN
    assert len(g) >= 250
    assert len(g) == len(set(g))
    assert all(x and x == x.lower() and x == genres.normalise(x) for x in g)
    assert {"techno", "melodic techno", "progressive trance", "drum and bass"} <= set(g)


def test_genres_library_first_then_builtin(client):
    add(client, "dQw4w9WgXcQ", tags=["genre:techno", "genre:house", "mood:calm"])
    add(client, "9bZkp7q19f0", tags=["genre:Techno", "genre:house"])
    add(client, "aaaaaaaaaaa", tags=["genre:techno"])
    r = client.get("/genres", headers=H)
    assert r.status_code == 200
    out = r.json()["genres"]
    assert out[:2] == ["techno", "house"]
    assert len(out) == len(set(out))
    assert len(out) <= 1000
    assert "mood:calm" not in out
    assert "calm" not in out
    assert "deep house" in out
    assert "trance" in out
    assert "europop" in out
    assert "drum and bass" in out
    assert "indie rock" in out
    for rewritten in ("euro pop", "punk rock", "indie", "romantic", "bard", "nederpop", "appalachian folk", "electronic dance music"):
        assert rewritten not in out, rewritten
