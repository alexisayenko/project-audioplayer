"""Audio fingerprint identification: Chromaprint `fpcalc` + the AcoustID web service -> a MusicBrainz recording id.

Only the fingerprint leaves the server, never audio. Off (silently) when ACOUSTID_API_KEY or the `fpcalc` binary is missing."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from . import genre_lookup, httpjson
from .ratelimit import RateLimiter
from .titles import artist_candidates

log = logging.getLogger(__name__)

API = "https://api.acoustid.org/v2/lookup"
FPCALC_TIMEOUT = 60
FP_SECONDS = 120
HTTP_TIMEOUT = 10
MIN_INTERVAL = 0.4
DEFAULT_MIN_SCORE = 0.9

_limiter = RateLimiter(MIN_INTERVAL)
_logged_off = False


def _key() -> str:
    return os.environ.get("ACOUSTID_API_KEY", "").strip()


def _fpcalc() -> str | None:
    return shutil.which(os.environ.get("AUDIO_FPCALC", "").strip() or "fpcalc")


def min_score() -> float:
    try:
        return min(1.0, max(0.0, float(os.environ.get("ACOUSTID_MIN_SCORE", "").strip() or DEFAULT_MIN_SCORE)))
    except ValueError:
        return DEFAULT_MIN_SCORE


def available() -> bool:
    """True when the key is set and `fpcalc` is found; logs one info line the first time it is not."""
    global _logged_off
    ok = bool(_key()) and _fpcalc() is not None
    if not ok and not _logged_off:
        _logged_off = True
        log.info("audio fingerprint identification is off: needs ACOUSTID_API_KEY and the fpcalc binary (package libchromaprint-tools)")
    return ok


def fingerprint(path: Path) -> tuple[int, str] | None:
    """(duration in whole seconds, fingerprint) of the first two minutes of a file; None when it cannot be fingerprinted."""
    binary = _fpcalc()
    if binary is None:
        return None
    cmd = [binary, "-json", "-length", str(FP_SECONDS), str(path)]
    nice = shutil.which("nice")
    if nice:
        cmd = [nice, "-n", "19", *cmd]
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=FPCALC_TIMEOUT, check=False)
        data = json.loads(done.stdout)
        duration, fp = int(round(float(data["duration"]))), str(data["fingerprint"])
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as exc:
        log.warning("fpcalc failed for %s: %s", Path(path).name, exc)
        return None
    return (duration, fp) if duration > 0 and fp else None


def _post(fields: dict[str, str]) -> dict[str, Any]:
    req = httpjson.build_request(API, form=fields)
    with _limiter.serialized():
        return httpjson.fetch(req, HTTP_TIMEOUT)


def _candidates(results: list[dict[str, Any]], floor: float) -> list[tuple[float, dict[str, Any]]]:
    out = []
    for res in results:
        score = float(res.get("score") or 0)
        if score >= floor:
            out.extend((score, rec) for rec in res.get("recordings") or [] if rec.get("id"))
    return out


def _rec_artist(rec: dict[str, Any]) -> str:
    return " ".join(str(a.get("name") or "") for a in rec.get("artists") or []).strip()


def _fits(rec: dict[str, Any], artist: str, title: str) -> bool:
    names = [str(a.get("name") or "") for a in rec.get("artists") or []]
    got_title = genre_lookup._norm(str(rec.get("title") or ""))
    want_title = genre_lookup._norm(title)
    title_ok = not want_title or not got_title or want_title in got_title or got_title in want_title
    artist_ok = not artist or any(genre_lookup._artist_match(c, n) for c in artist_candidates(artist) for n in names)
    return bool(title_ok and artist_ok and (artist or title))


def pick(results: list[dict[str, Any]], artist: str = "", title: str = "", floor: float | None = None) -> dict[str, Any] | None:
    """Best recording of the results scoring at least `floor`: one whose artist and title loosely match the song's, else the highest score.

    Returns {mbid, artist, title, confidence} or None."""
    cands = _candidates(results, min_score() if floor is None else floor)
    if not cands:
        return None
    fitting = [c for c in cands if _fits(c[1], artist, title)]
    score, rec = max(fitting or cands, key=lambda c: c[0])
    return {"mbid": str(rec["id"]).lower(), "artist": _rec_artist(rec), "title": str(rec.get("title") or ""), "confidence": round(score, 3)}


def identify(path: Path, artist: str = "", title: str = "") -> dict[str, Any]:
    """{status: "ok"|"no_match"|"unavailable"|"error", match: pick() result or None}; never raises."""
    if not available():
        return {"status": "unavailable", "match": None}
    fp = fingerprint(path)
    if fp is None:
        return {"status": "error", "match": None}
    duration, print_ = fp
    try:
        data = _post({"client": _key(), "meta": "recordings releasegroups", "duration": str(duration), "fingerprint": print_, "format": "json"})
    except Exception as exc:
        log.warning("acoustid lookup failed: %s", type(exc).__name__)
        return {"status": "error", "match": None}
    if not isinstance(data, dict) or data.get("status") != "ok":
        error = data.get("error") if isinstance(data, dict) else None
        message = error.get("message") if isinstance(error, dict) else ""
        log.warning("acoustid lookup refused: %s", str(message or "")[:80])
        return {"status": "error", "match": None}
    match = pick(data.get("results") or [], artist, title)
    return {"status": "ok" if match else "no_match", "match": match}
