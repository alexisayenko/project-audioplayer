import json
import os

import pytest

from app import httpjson, jsonio, ratelimit, tags, timeutil, titles
from app.safepath import safe_join


class Resp:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self.body


@pytest.fixture
def clock(monkeypatch):
    state = {"now": 100.0, "sleeps": []}
    monkeypatch.setattr(ratelimit.time, "monotonic", lambda: state["now"])
    monkeypatch.setattr(ratelimit.time, "sleep", lambda s: (state["sleeps"].append(s), state.__setitem__("now", state["now"] + s)))
    return state


def test_rate_limiter_serialized_waits_out_the_interval_and_stamps_the_end(clock):
    limiter = ratelimit.RateLimiter(2.0)
    with limiter.serialized():
        pass
    assert clock["sleeps"] == [] and limiter.last_call == 100.0
    with limiter.serialized():
        pass
    assert clock["sleeps"] == [pytest.approx(2.0)]


def test_rate_limiter_serialized_stamps_even_when_the_call_fails(clock):
    limiter = ratelimit.RateLimiter(1.0)
    with pytest.raises(ValueError), limiter.serialized():
        raise ValueError("boom")
    assert limiter.last_call == 100.0


def test_rate_limiter_reserve_queues_callers_one_interval_apart(clock):
    limiter = ratelimit.RateLimiter(0.5)
    limiter.reserve()
    limiter.reserve()
    limiter.reserve()
    assert clock["sleeps"] == [pytest.approx(0.5), pytest.approx(0.5)]


def test_window_limiter_waits_then_refuses(clock):
    limiter = ratelimit.WindowLimiter(2, max_wait=15.0, period=10.0, name="x limit")
    limiter.acquire()
    limiter.acquire()
    assert clock["sleeps"] == []
    limiter.acquire()
    assert clock["sleeps"] == [pytest.approx(10.0)]


def test_window_limiter_refuses_when_the_wait_is_too_long(clock):
    limiter = ratelimit.WindowLimiter(1, max_wait=5.0, period=60.0, name="x limit")
    limiter.acquire()
    with pytest.raises(RuntimeError, match="x limit reached"):
        limiter.acquire()


def test_http_json_builds_get_and_post_requests(monkeypatch):
    seen = {}

    def fake(req, timeout):
        seen.update(url=req.full_url, data=req.data, ua=req.get_header("User-agent"), accept=req.get_header("Accept"),
                    extra=req.get_header("X-extra"), timeout=timeout, method=req.get_method())
        return Resp(b'{"ok": 1}')

    monkeypatch.setattr(httpjson.urllib.request, "urlopen", fake)
    monkeypatch.setenv("AUDIO_MB_USER_AGENT", "ua/9")
    assert httpjson.http_json("https://x.test/api", 7, params={"a": "b c"}, headers={"X-extra": "1"}) == {"ok": 1}
    assert seen == {"url": "https://x.test/api?a=b+c", "data": None, "ua": "ua/9", "accept": "application/json",
                    "extra": "1", "timeout": 7, "method": "GET"}
    httpjson.http_json("https://x.test/api", 3, form={"k": "v&"})
    assert seen["data"] == b"k=v%26" and seen["method"] == "POST" and seen["url"] == "https://x.test/api"


def test_http_json_default_user_agent_and_bad_bodies(monkeypatch):
    monkeypatch.delenv("AUDIO_MB_USER_AGENT", raising=False)
    assert httpjson.user_agent() == httpjson.DEFAULT_UA
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: Resp(b"<html>"))
    with pytest.raises(ValueError):
        httpjson.http_json("https://x.test", 1)


def test_write_json_atomic_formats_and_leaves_no_temp_files(tmp_path):
    path = tmp_path / "sub" / "a.json"
    jsonio.write_json_atomic(path, {"é": [1, 2]})
    assert path.read_text(encoding="utf-8") == '{\n  "é": [\n    1,\n    2\n  ]\n}\n'
    jsonio.write_json_atomic(path, {"a": [1, 2]}, compact=True)
    assert path.read_text(encoding="utf-8") == '{"a":[1,2]}'
    assert [p.name for p in path.parent.iterdir()] == ["a.json"]


def test_write_json_atomic_keeps_the_old_file_when_encoding_fails(tmp_path):
    path = tmp_path / "a.json"
    jsonio.write_json_atomic(path, {"v": 1})
    with pytest.raises(TypeError):
        jsonio.write_json_atomic(path, {"v": object()})
    assert json.loads(path.read_text(encoding="utf-8")) == {"v": 1}
    assert [p.name for p in tmp_path.iterdir()] == ["a.json"]


def test_tag_namespaces():
    assert tags.namespace("Genre:house") == "genre" and tags.namespace(" country : us") == "country"
    assert tags.namespace("80s") == "" and tags.namespace(5) == ""
    assert list(tags.namespaced_values(["genre:house", "GENRE:Techno", "country:us", "plain", ":x"], "genre")) == ["house", "Techno"]


def test_safe_join_stays_inside_the_base(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "f.txt").write_text("x")
    assert safe_join(tmp_path / "a", "f.txt") == tmp_path / "a" / "f.txt"
    assert safe_join(tmp_path / "a", "../a/f.txt") == tmp_path / "a" / ".." / "a" / "f.txt"
    assert safe_join(tmp_path / "a", "..", "secret") is None
    assert safe_join(tmp_path / "a", "/etc/passwd") is None
    if hasattr(os, "symlink"):
        try:
            os.symlink(tmp_path, tmp_path / "a" / "out")
        except OSError:
            return
        assert safe_join(tmp_path / "a", "out", "f") is None


def test_timeutil_roundtrip():
    assert timeutil.epoch_of("1970-01-02T00:00:00Z") == 86400
    assert timeutil.epoch_of("nope") is None
    stamp = timeutil.now_utc()
    assert timeutil.epoch_of(stamp) is not None and stamp.endswith("Z")


def test_lookup_query_combines_split_candidates_and_title():
    artist, names, title = titles.lookup_query("Daft Punk", "Daft Punk - One More Time (Official Video)")
    assert artist == "Daft Punk" and names[0] == "Daft Punk" and title == "One More Time"
    artist, names, title = titles.lookup_query("", "Boards of Canada - Roygbiv")
    assert (artist, names, title) == ("Boards of Canada", ["Boards of Canada"], "Roygbiv")


def test_genre_graph_cache_saves_compactly_and_survives_a_failing_disk(tmp_path, monkeypatch, caplog):
    from app import genre_graph as gg

    path = tmp_path / "cache" / "g.json"
    assert gg.save_cache(path) is None and not path.exists()
    data = gg.load_cache(path)
    data["labels"]["house"] = {"qid": "Q1"}
    gg.save_cache(path)
    assert json.loads(path.read_text(encoding="utf-8"))["labels"] == {"house": {"qid": "Q1"}}
    assert "\n" not in path.read_text(encoding="utf-8")
    monkeypatch.setattr(jsonio.os, "replace", lambda *a: (_ for _ in ()).throw(OSError("disk full")))
    gg.save_cache(path)
    assert "genre cache not saved" in caplog.text


def test_genre_graph_api_reserves_a_slot_and_asks_for_json(monkeypatch):
    from app import genre_graph as gg

    seen = {}
    monkeypatch.setattr(gg._limiter, "reserve", lambda: seen.setdefault("reserved", True))
    monkeypatch.setattr(httpjson.urllib.request, "urlopen",
                        lambda req, timeout: seen.update(url=req.full_url, timeout=timeout) or Resp(b'{"entities": {}}'))
    assert gg._api({"action": "wbgetentities"}) == {"entities": {}}
    assert seen["reserved"] and seen["url"] == f"{gg.API}?action=wbgetentities&format=json" and seen["timeout"] == gg.TIMEOUT
