import json
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest

from app import peaks
from tests.test_guest import web  # noqa: F401
from tests.test_library import ADIR, H, VID, VID2, client  # noqa: F401
from tests.test_users import add

BUCKETS = peaks.BUCKETS
HAS_FFMPEG = shutil.which("ffmpeg") is not None


def write_wav(path: Path, seconds=2.0, rate=8000):
    t = np.arange(int(seconds * rate)) / rate
    data = (np.sin(2 * np.pi * 440 * t) * np.linspace(0.1, 1.0, len(t)) * 20000).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data.tobytes())


@pytest.fixture
def lib(client, tmp_path):
    assert add(client, H, VID).status_code == 202
    write_wav(ADIR(tmp_path) / f"{VID}.m4a")
    return client


@pytest.fixture
def decodes(monkeypatch):
    calls = []
    real = peaks.decode
    monkeypatch.setattr(peaks, "decode", lambda p: calls.append(p) or real(p))
    return calls


def test_reduce_is_signed_8_bit_and_normalised():
    samples = np.array([0, 100, -200, 50, 400, -400, 10, 0], dtype="<i2")
    out = peaks.reduce(samples, buckets=4)
    assert out["buckets"] == 4
    assert len(out["min"]) == len(out["max"]) == 4
    assert max(out["max"]) == 127
    assert min(out["min"]) == -127
    assert all(-127 <= v <= 127 for v in out["min"] + out["max"])
    assert all(lo <= hi for lo, hi in zip(out["min"], out["max"]))
    assert out["duration"] == round(8 / peaks.RATE, 3)


def test_reduce_never_has_more_buckets_than_samples_and_rejects_no_audio():
    assert peaks.reduce(np.array([5, -5, 7], dtype="<i2"))["buckets"] == 3
    with pytest.raises(peaks.Unavailable):
        peaks.reduce(np.array([], dtype="<i2"))


@pytest.mark.skipif(not HAS_FFMPEG, reason="real waveform decoding requires ffmpeg")
def test_owner_gets_the_peaks_of_the_real_file(lib):
    r = lib.get(f"/songs/{VID}/peaks", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["v"] == 1
    assert body["buckets"] == BUCKETS
    assert len(body["min"]) == len(body["max"]) == BUCKETS
    assert body["duration"] == pytest.approx(2.0, abs=0.1)
    assert body["max"][-1] > body["max"][0]
    assert r.headers["cache-control"] == "private, no-cache"
    assert r.headers["etag"].startswith('"p')


@pytest.mark.skipif(not HAS_FFMPEG, reason="real waveform decoding requires ffmpeg")
def test_the_result_is_cached_beside_the_audio_not_in_the_data_tree(lib, tmp_path, decodes):
    assert lib.get(f"/songs/{VID}/peaks", headers=H).status_code == 200
    assert lib.get(f"/songs/{VID}/peaks", headers=H).status_code == 200
    assert len(decodes) == 1
    cached = list((ADIR(tmp_path) / ".peaks").glob(f"{VID}.*.json"))
    assert len(cached) == 1
    assert json.loads(cached[0].read_text())["buckets"] == BUCKETS
    assert not list((tmp_path / "users").rglob(".peaks"))


@pytest.mark.skipif(not HAS_FFMPEG, reason="real waveform decoding requires ffmpeg")
def test_etag_gives_304_and_a_changed_file_is_recomputed(lib, tmp_path, decodes):
    first = lib.get(f"/songs/{VID}/peaks", headers=H)
    again = lib.get(f"/songs/{VID}/peaks", headers={**H, "If-None-Match": first.headers["etag"]})
    assert again.status_code == 304
    assert again.content == b""
    write_wav(ADIR(tmp_path) / f"{VID}.m4a", seconds=3.0)
    changed = lib.get(f"/songs/{VID}/peaks", headers={**H, "If-None-Match": first.headers["etag"]})
    assert changed.status_code == 200
    assert changed.headers["etag"] != first.headers["etag"]
    assert changed.json()["duration"] == pytest.approx(3.0, abs=0.1)
    assert len(list((ADIR(tmp_path) / ".peaks").glob(f"{VID}.*.json"))) == 1


def test_missing_audio_and_unknown_song_are_404(lib, tmp_path):
    assert add(lib, H, VID2).status_code == 202
    (ADIR(tmp_path) / f"{VID2}.m4a").unlink()
    assert lib.get(f"/songs/{VID2}/peaks", headers=H).status_code == 404
    assert lib.get("/songs/aaaaaaaaaaa/peaks", headers=H).status_code == 404
    assert lib.get("/songs/not-an-id/peaks", headers=H).status_code == 422


@pytest.mark.skipif(not HAS_FFMPEG, reason="real waveform decoding requires ffmpeg")
def test_wrong_credentials_and_guest_access_follows_files(lib, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    assert lib.get(f"/songs/{VID}/peaks", headers={"X-API-Token": "wrong"}).status_code == 401
    seen = web().get(f"/songs/{VID}/peaks")
    assert seen.status_code == 200
    assert seen.json()["buckets"] == BUCKETS
    monkeypatch.setenv("PUBLIC_AUDIO", "0")
    assert web().get(f"/songs/{VID}/peaks").status_code == 403


def test_a_guest_cannot_peek_at_a_song_the_owner_does_not_have(lib, monkeypatch):
    monkeypatch.setenv("PUBLIC_VIEW", "1")
    assert web().get(f"/songs/{VID2}/peaks").status_code == 404


def test_no_ffmpeg_answers_503_with_a_code_and_writes_no_cache(lib, tmp_path, monkeypatch):
    def missing(*a, **k):
        raise FileNotFoundError("ffmpeg")

    monkeypatch.setattr(subprocess, "run", missing)
    r = lib.get(f"/songs/{VID}/peaks", headers=H)
    assert r.status_code == 503
    assert r.json()["error"] == "peaks_unavailable"
    assert not (ADIR(tmp_path) / ".peaks").exists()


@pytest.mark.skipif(not HAS_FFMPEG, reason="undecodable-file verification requires ffmpeg")
def test_an_undecodable_file_is_503_too(client, tmp_path):
    assert add(client, H, VID).status_code == 202
    (ADIR(tmp_path)).mkdir(parents=True, exist_ok=True)
    (ADIR(tmp_path) / f"{VID}.m4a").write_bytes(b"not audio at all")
    r = client.get(f"/songs/{VID}/peaks", headers=H)
    assert r.status_code == 503
    assert r.json()["error"] == "peaks_unavailable"
