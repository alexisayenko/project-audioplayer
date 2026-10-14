import json
import subprocess
from types import SimpleNamespace

import pytest

from app import acoustid_lookup as ac

MBID1 = "11111111-1111-1111-1111-111111111111"
MBID2 = "22222222-2222-2222-2222-222222222222"


def rec(mbid, title, *artists):
    return {"id": mbid, "title": title, "artists": [{"id": f"a-{n}", "name": n} for n in artists]}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("ACOUSTID_API_KEY", "test-key")
    monkeypatch.delenv("ACOUSTID_MIN_SCORE", raising=False)
    monkeypatch.delenv("AUDIO_FPCALC", raising=False)
    monkeypatch.setattr(ac, "_logged_off", False)
    monkeypatch.setattr(ac.shutil, "which", lambda name: f"/usr/bin/{name}")


def fake_run(stdout, calls=None):
    def run(cmd, **kw):
        if calls is not None:
            calls.append((cmd, kw))
        return SimpleNamespace(stdout=stdout, returncode=0)

    return run


def test_fingerprint_parses_fpcalc_json_and_limits_the_audio(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(ac.subprocess, "run", fake_run(json.dumps({"duration": 213.6, "fingerprint": "AQAA"}), calls))
    assert ac.fingerprint(tmp_path / "x.m4a") == (214, "AQAA")
    cmd, kw = calls[0]
    assert cmd[:3] == ["/usr/bin/nice", "-n", "19"]
    assert cmd[3:7] == ["/usr/bin/fpcalc", "-json", "-length", "120"]
    assert kw["timeout"] == 60


@pytest.mark.parametrize("out", ["", "not json", "{}", json.dumps({"duration": 0, "fingerprint": "A"}), json.dumps({"duration": 9, "fingerprint": ""})])
def test_fingerprint_rejects_bad_output(monkeypatch, tmp_path, out):
    monkeypatch.setattr(ac.subprocess, "run", fake_run(out))
    assert ac.fingerprint(tmp_path / "x.m4a") is None


def test_fingerprint_survives_timeout_and_missing_binary(monkeypatch, tmp_path):
    def boom(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 60)

    monkeypatch.setattr(ac.subprocess, "run", boom)
    assert ac.fingerprint(tmp_path / "x.m4a") is None
    monkeypatch.setattr(ac.shutil, "which", lambda name: None)
    assert ac.fingerprint(tmp_path / "x.m4a") is None


def test_available_needs_key_and_binary_and_logs_once(monkeypatch, caplog):
    assert ac.available()
    monkeypatch.delenv("ACOUSTID_API_KEY")
    with caplog.at_level("INFO"):
        assert not ac.available() and not ac.available()
    assert len([r for r in caplog.records if "fingerprint identification is off" in r.message]) == 1
    monkeypatch.setenv("ACOUSTID_API_KEY", "k")
    monkeypatch.setattr(ac.shutil, "which", lambda name: None)
    assert not ac.available()


def test_custom_fpcalc_path(monkeypatch):
    seen = []
    monkeypatch.setattr(ac.shutil, "which", lambda name: seen.append(name) or name)
    monkeypatch.setenv("AUDIO_FPCALC", "/opt/fp/fpcalc")
    assert ac._fpcalc() == "/opt/fp/fpcalc" and seen == ["/opt/fp/fpcalc"]


def test_score_threshold_default_and_configurable(monkeypatch):
    results = [{"score": 0.89, "recordings": [rec(MBID1, "T", "A")]}]
    assert ac.pick(results) is None
    monkeypatch.setenv("ACOUSTID_MIN_SCORE", "0.8")
    assert ac.pick(results)["mbid"] == MBID1
    monkeypatch.setenv("ACOUSTID_MIN_SCORE", "junk")
    assert ac.min_score() == 0.9


def test_pick_prefers_the_recording_matching_the_song_then_the_best_score():
    results = [
        {"score": 0.99, "recordings": [rec(MBID1, "Other Song", "Someone Else")]},
        {"score": 0.93, "recordings": [rec(MBID2, "Around the World", "Daft Punk")]},
    ]
    assert ac.pick(results, "Daft Punk", "Around the World")["mbid"] == MBID2
    best = ac.pick(results, "Nobody", "Nothing")
    assert best["mbid"] == MBID1 and best["confidence"] == 0.99
    assert ac.pick(results)["mbid"] == MBID1


def test_pick_handles_no_recordings_and_empty_results():
    assert ac.pick([]) is None
    assert ac.pick([{"score": 1.0}]) is None
    assert ac.pick([{"score": 1.0, "recordings": [{"title": "no id"}]}]) is None


def test_pick_reports_artist_title_confidence():
    got = ac.pick([{"score": 0.974, "recordings": [rec(MBID1.upper(), "Song", "A", "B")]}])
    assert got == {"mbid": MBID1, "artist": "A B", "title": "Song", "confidence": 0.974}


def test_identify_ok_posts_only_the_fingerprint(monkeypatch, tmp_path):
    monkeypatch.setattr(ac, "fingerprint", lambda p: (200, "FPDATA"))
    sent = []
    monkeypatch.setattr(ac, "_post", lambda f: sent.append(f) or {"status": "ok", "results": [{"score": 0.98, "recordings": [rec(MBID1, "T", "A")]}]})
    out = ac.identify(tmp_path / "x.m4a", "A", "T")
    assert out["status"] == "ok" and out["match"]["mbid"] == MBID1
    assert sent[0]["fingerprint"] == "FPDATA" and sent[0]["duration"] == "200" and sent[0]["meta"] == "recordings releasegroups"
    assert set(sent[0]) == {"client", "meta", "duration", "fingerprint", "format"}


def test_identify_statuses(monkeypatch, tmp_path):
    p = tmp_path / "x.m4a"
    monkeypatch.setattr(ac, "fingerprint", lambda path: (200, "FP"))
    monkeypatch.setattr(ac, "_post", lambda f: {"status": "ok", "results": []})
    assert ac.identify(p) == {"status": "no_match", "match": None}
    monkeypatch.setattr(ac, "_post", lambda f: {"status": "error", "error": {"message": "invalid API key"}})
    assert ac.identify(p)["status"] == "error"

    def down(f):
        raise OSError("network down")

    monkeypatch.setattr(ac, "_post", down)
    assert ac.identify(p)["status"] == "error"
    monkeypatch.setattr(ac, "fingerprint", lambda path: None)
    assert ac.identify(p)["status"] == "error"
    monkeypatch.delenv("ACOUSTID_API_KEY")
    assert ac.identify(p) == {"status": "unavailable", "match": None}


def test_the_key_is_never_logged(monkeypatch, tmp_path, caplog):
    monkeypatch.setattr(ac, "fingerprint", lambda p: (200, "FP"))

    def down(f):
        raise OSError(f"failed {f['client']}")

    monkeypatch.setattr(ac, "_post", down)
    with caplog.at_level("DEBUG"):
        ac.identify(tmp_path / "x.m4a")
    assert "test-key" not in caplog.text
