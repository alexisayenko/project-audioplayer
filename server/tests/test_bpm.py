import shutil
import subprocess

import numpy as np
import pytest

from app import bpm

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def click_track(bpm_value: float, seconds: int = 30, sr: int = 44100) -> np.ndarray:
    n = seconds * sr
    out = np.zeros(n, dtype=np.float32)
    t = np.arange(int(0.05 * sr)) / sr
    click = (np.sin(2 * np.pi * 1000 * t) * np.exp(-t * 80)).astype(np.float32)
    step = 60 / bpm_value * sr
    k = 0
    while int(k * step) + len(click) < n:
        i = int(k * step)
        out[i : i + len(click)] += click
        k += 1
    return out


def encode_m4a(samples: np.ndarray, dest) -> None:
    raw = dest.with_suffix(".f32")
    raw.write_bytes(samples.tobytes())
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", "44100", "-ac", "1", "-i", str(raw), "-c:a", "aac", str(dest)],
        check=True,
    )


@pytest.mark.parametrize("tempo", [90, 120])
def test_click_track_m4a(tmp_path, tempo):
    path = tmp_path / "click.m4a"
    encode_m4a(click_track(tempo), path)
    assert abs(bpm.detect_bpm(path) - tempo) <= 2


def test_fold_into_range():
    assert bpm.fold(240) == 120
    assert bpm.fold(40) == 80
    assert bpm.fold(100) == 100


def test_undecodable_file_returns_none(tmp_path):
    path = tmp_path / "bad.m4a"
    path.write_bytes(b"not audio")
    assert bpm.detect_bpm(path) is None


def test_silence_returns_none(tmp_path):
    path = tmp_path / "silence.m4a"
    encode_m4a(np.zeros(44100 * 5, dtype=np.float32), path)
    assert bpm.detect_bpm(path) is None
