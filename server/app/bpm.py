"""BPM detection: ffmpeg decodes to mono 44.1 kHz float PCM, aubio tracks the beats."""

from __future__ import annotations

import logging
import statistics
import subprocess
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 44100
WIN_SIZE = 1024
HOP_SIZE = 512
FOLD_MIN, FOLD_MAX = 70.0, 180.0
DECODE_TIMEOUT = 120


def fold(bpm: float) -> float:
    """Octave heuristic: halve/double into 70-180 BPM, where most music sits; may pick the wrong octave."""
    while bpm > FOLD_MAX:
        bpm /= 2
    while bpm < FOLD_MIN:
        bpm *= 2
    return bpm


def decode(path: Path) -> np.ndarray:
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    out = subprocess.run(cmd, capture_output=True, timeout=DECODE_TIMEOUT, check=True).stdout
    return np.frombuffer(out, dtype=np.float32)


def bpm_from_samples(samples: np.ndarray) -> int | None:
    import aubio

    tempo = aubio.tempo("default", WIN_SIZE, HOP_SIZE, SAMPLE_RATE)
    per_beat: list[float] = []
    for i in range(0, len(samples) - HOP_SIZE + 1, HOP_SIZE):
        if tempo(samples[i : i + HOP_SIZE]):
            value = float(tempo.get_bpm())
            if value > 0:
                per_beat.append(value)
    if len(per_beat) < 4:
        return None
    return round(fold(statistics.median(per_beat)))


def detect_bpm(path: Path) -> int | None:
    """BPM of an audio file, or None when it cannot be determined; never raises."""
    try:
        return bpm_from_samples(decode(path))
    except Exception as exc:
        log.warning("bpm detection failed for %s: %s", path.name, exc)
        return None
