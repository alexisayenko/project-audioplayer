import io
import json
import urllib.error

import pytest

from app import acoustid_lookup as ac
from app import bpm, httpjson, ratelimit


class Resp:
    def __init__(self, body):
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.body


@pytest.fixture
def clock(monkeypatch):
    state = {"now": 1000.0, "sleeps": []}
    monkeypatch.setattr(ratelimit.time, "monotonic", lambda: state["now"])
    monkeypatch.setattr(ratelimit.time, "sleep", lambda s: (state["sleeps"].append(s), state.__setitem__("now", state["now"] + s)))
    monkeypatch.setattr(ac._limiter, "last_call", 0.0)
    return state


def test_post_sends_form_encoded_ascii_with_user_agent(monkeypatch, clock):
    seen = {}

    def fake(req, timeout):
        seen["req"], seen["timeout"] = req, timeout
        return Resp({"status": "ok", "results": []})

    monkeypatch.setattr(httpjson.urllib.request, "urlopen", fake)
    monkeypatch.setenv("AUDIO_MB_USER_AGENT", "agent/1")
    assert ac._post({"client": "k", "fingerprint": "A+B/c=="}) == {"status": "ok", "results": []}
    req = seen["req"]
    assert req.full_url == ac.API
    assert req.get_method() == "POST"
    assert req.data == b"client=k&fingerprint=A%2BB%2Fc%3D%3D"
    assert req.get_header("User-agent") == "agent/1"
    assert seen["timeout"] == ac.HTTP_TIMEOUT


def test_rate_limiter_spaces_calls_without_real_sleep(monkeypatch, clock):
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: Resp({"status": "ok"}))
    clock["now"] = 5000.0
    ac._post({})
    assert clock["sleeps"] == []
    ac._post({})
    assert clock["sleeps"] == [pytest.approx(ac.MIN_INTERVAL)]
    clock["now"] += 10
    ac._post({})
    assert len(clock["sleeps"]) == 1


def test_rate_limiter_still_advances_after_a_failed_call(monkeypatch, clock):
    def boom(req, timeout):
        raise TimeoutError("slow")

    monkeypatch.setattr(httpjson.urllib.request, "urlopen", boom)
    clock["now"] = 5000.0
    with pytest.raises(TimeoutError):
        ac._post({})
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: Resp({"status": "ok"}))
    ac._post({})
    assert clock["sleeps"] == [pytest.approx(ac.MIN_INTERVAL)]


@pytest.fixture
def identify_env(monkeypatch, tmp_path, clock):
    monkeypatch.setenv("ACOUSTID_API_KEY", "key")
    monkeypatch.setattr(ac.shutil, "which", lambda n: "/usr/bin/" + n)
    monkeypatch.setattr(ac, "fingerprint", lambda p: (100, "FP"))
    return tmp_path / "x.m4a"


@pytest.mark.parametrize("opener", [
    lambda req, timeout: Resp(b"not json"),
    lambda req, timeout: Resp(b""),
    lambda req, timeout: Resp(b"\xff\xfe"),
    lambda req, timeout: (_ for _ in ()).throw(urllib.error.HTTPError(ac.API, 503, "unavailable", {}, io.BytesIO(b""))),
    lambda req, timeout: (_ for _ in ()).throw(urllib.error.URLError("dns")),
    lambda req, timeout: (_ for _ in ()).throw(TimeoutError("t")),
])
def test_identify_never_raises_on_bad_http(monkeypatch, identify_env, opener):
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", opener)
    assert ac.identify(identify_env) == {"status": "error", "match": None}


@pytest.mark.parametrize("payload", [{"status": "ok"}, {"status": "ok", "results": None}, {"status": "ok", "results": [{"score": 1}]}])
def test_identify_empty_results_is_no_match(monkeypatch, identify_env, payload):
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: Resp(payload))
    assert ac.identify(identify_env) == {"status": "no_match", "match": None}


def test_identify_refusal_message_is_truncated_in_the_log(monkeypatch, identify_env, caplog):
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: Resp({"status": "error", "error": {"message": "x" * 500}}))
    with caplog.at_level("WARNING"):
        assert ac.identify(identify_env)["status"] == "error"
    assert "x" * 81 not in caplog.text


def test_fingerprint_none_when_fpcalc_returns_non_json_or_fails_to_start(monkeypatch, tmp_path):
    monkeypatch.setattr(ac.shutil, "which", lambda n: "/x/" + n)
    monkeypatch.setattr(ac.subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(OSError("exec format")))
    assert ac.fingerprint(tmp_path / "a") is None


# ---- bpm click track ----------------------------------------------------------------

np = pytest.importorskip("numpy")


def click_track(bpm_value, seconds=20, sr=bpm.SAMPLE_RATE):
    out = np.zeros(int(seconds * sr), dtype=np.float32)
    step = int(round(60.0 / bpm_value * sr))
    tone = np.sin(2 * np.pi * 1000 * np.arange(int(0.02 * sr)) / sr).astype(np.float32) * np.hanning(int(0.02 * sr)).astype(np.float32)
    for start in range(0, len(out) - len(tone), step):
        out[start:start + len(tone)] += tone
    return out


@pytest.mark.parametrize("target", [70, 90, 120, 140])
def test_bpm_of_a_synthetic_click_track_within_two(target):
    pytest.importorskip("aubio")
    got = bpm.bpm_from_samples(click_track(target))
    assert got is not None
    assert abs(got - target) <= 2


def test_bpm_of_silence_is_none():
    pytest.importorskip("aubio")
    assert bpm.bpm_from_samples(np.zeros(bpm.SAMPLE_RATE * 5, dtype=np.float32)) is None


def test_bpm_of_a_too_short_clip_is_none():
    pytest.importorskip("aubio")
    assert bpm.bpm_from_samples(np.zeros(100, dtype=np.float32)) is None


@pytest.mark.parametrize("raw,expected", [(70, 70), (180, 180), (181, 90.5), (360, 180), (35, 70), (69.9, 139.8), (500, 125), (1, 128)])
def test_fold_octave_bounds(raw, expected):
    assert bpm.fold(raw) == pytest.approx(expected)
    assert bpm.FOLD_MIN <= bpm.fold(raw) <= bpm.FOLD_MAX


def test_detect_bpm_never_raises(monkeypatch, tmp_path):
    def boom(path):
        raise RuntimeError("ffmpeg missing")

    monkeypatch.setattr(bpm, "decode", boom)
    assert bpm.detect_bpm(tmp_path / "a.m4a") is None


def test_identify_non_object_json_is_an_error_not_an_exception(monkeypatch, identify_env):
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: Resp([1, 2]))
    assert ac.identify(identify_env) == {"status": "error", "match": None}


@pytest.mark.parametrize("reply", [None, "text", 7, [], {"status": "error"}, {"status": "error", "error": "plain string"},
                                   {"status": "error", "error": {"message": 5}}])
def test_identify_any_unusable_reply_is_an_error_not_an_exception(monkeypatch, identify_env, reply):
    monkeypatch.setattr(httpjson.urllib.request, "urlopen", lambda req, timeout: Resp(reply))
    assert ac.identify(identify_env) == {"status": "error", "match": None}
