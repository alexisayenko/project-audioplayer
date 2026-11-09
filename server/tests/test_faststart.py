from __future__ import annotations

import struct
from pathlib import Path

from app import faststart


def atom(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(body), kind) + body


def moov_for(offsets: list[int], wide: bool = False) -> bytes:
    if wide:
        table = atom(b"co64", struct.pack(">II", 0, len(offsets)) + b"".join(struct.pack(">Q", o) for o in offsets))
    else:
        table = atom(b"stco", struct.pack(">II", 0, len(offsets)) + b"".join(struct.pack(">I", o) for o in offsets))
    trak = atom(b"trak", atom(b"mdia", atom(b"minf", atom(b"stbl", table))))
    return atom(b"moov", atom(b"mvhd", bytes(20)) + trak)


FTYP = atom(b"ftyp", b"M4A \x00\x00\x00\x00M4A mp42isom")
AUDIO = bytes(range(256)) * 40


def tail_moov_file(path: Path, wide: bool = False) -> bytes:
    """ftyp, free, mdat, moov (what `ffmpeg -f mp4` writes): chunk offsets point into the mdat."""
    free = atom(b"free", bytes(16))
    mdat = atom(b"mdat", AUDIO)
    first = len(FTYP) + len(free) + 8
    offsets = [first, first + 1000, first + 5000]
    data = FTYP + free + mdat + moov_for(offsets, wide)
    path.write_bytes(data)
    return data


def read_offsets(path: Path, wide: bool = False) -> list[int]:
    data = path.read_bytes()
    kind = b"co64" if wide else b"stco"
    at = data.index(kind) + 4
    count = struct.unpack_from(">II", data, at)[1]
    fmt, width = (">Q", 8) if wide else (">I", 4)
    return [struct.unpack_from(fmt, data, at + 8 + i * width)[0] for i in range(count)]


def test_tail_moov_is_detected(tmp_path):
    f = tmp_path / "a.m4a"
    tail_moov_file(f)
    assert faststart.is_faststart(f) is False
    assert [k for k, _, _ in faststart.top_level(f)] == ["ftyp", "free", "mdat", "moov"]


def test_ensure_moves_moov_forward_and_keeps_audio_reachable(tmp_path):
    f = tmp_path / "a.m4a"
    original = tail_moov_file(f)
    before = read_offsets(f)
    assert faststart.ensure(f) == faststart.FIXED
    assert faststart.is_faststart(f) is True
    assert [k for k, _, _ in faststart.top_level(f)] == ["ftyp", "moov", "free", "mdat"]
    data = f.read_bytes()
    assert len(data) == len(original)
    moov_size = len(moov_for(before))
    after = read_offsets(f)
    assert after == [o + moov_size for o in before]
    for old, new in zip(before, after):
        assert data[new : new + 64] == original[old : old + 64]
    assert not list(tmp_path.glob(".faststart-*"))


def test_ensure_rewrites_64_bit_offsets(tmp_path):
    f = tmp_path / "a.m4a"
    tail_moov_file(f, wide=True)
    before = read_offsets(f, wide=True)
    assert faststart.ensure(f) == faststart.FIXED
    size = len(moov_for(before, wide=True))
    assert read_offsets(f, wide=True) == [o + size for o in before]


def test_ensure_is_a_noop_when_moov_is_first(tmp_path):
    f = tmp_path / "a.m4a"
    tail_moov_file(f)
    faststart.ensure(f)
    stamp = f.stat().st_mtime_ns
    data = f.read_bytes()
    assert faststart.ensure(f) == faststart.OK
    assert f.read_bytes() == data
    assert f.stat().st_mtime_ns == stamp


def test_ensure_keeps_file_mode(tmp_path):
    f = tmp_path / "a.m4a"
    tail_moov_file(f)
    f.chmod(0o640)
    faststart.ensure(f)
    assert f.stat().st_mode & 0o777 == 0o640


def test_ensure_leaves_unknown_files_alone(tmp_path):
    junk = tmp_path / "junk.m4a"
    junk.write_bytes(b"not an mp4 at all")
    missing = tmp_path / "missing.m4a"
    frag = tmp_path / "frag.m4a"
    frag.write_bytes(FTYP + atom(b"moof", bytes(8)) + atom(b"mdat", bytes(8)) + moov_for([1]))
    for f in (junk, frag):
        data = f.read_bytes()
        assert faststart.ensure(f) == faststart.SKIPPED
        assert f.read_bytes() == data
    assert faststart.ensure(missing) == faststart.SKIPPED


def test_ensure_refuses_offset_overflow(tmp_path):
    f = tmp_path / "a.m4a"
    free = atom(b"free", bytes(16))
    f.write_bytes(FTYP + free + atom(b"mdat", AUDIO) + moov_for([0xFFFFFFF0]))
    data = f.read_bytes()
    assert faststart.ensure(f) == faststart.SKIPPED
    assert f.read_bytes() == data


def test_scan_dry_run_counts_and_apply_fixes(tmp_path):
    tail_moov_file(tmp_path / "a.m4a")
    tail_moov_file(tmp_path / "b.m4a")
    faststart.ensure(tmp_path / "b.m4a")
    (tmp_path / "c.m4a").write_bytes(b"junk")
    assert faststart.scan(tmp_path) == {"checked": 3, "already_fast": 1, "needs_fix": 1, "fixed": 0, "skipped": 1}
    assert faststart.is_faststart(tmp_path / "a.m4a") is False
    assert faststart.scan(tmp_path, apply=True) == {"checked": 3, "already_fast": 1, "needs_fix": 0, "fixed": 1, "skipped": 1}
    assert faststart.is_faststart(tmp_path / "a.m4a") is True


def test_main_defaults_to_a_dry_run(tmp_path, capsys):
    tail_moov_file(tmp_path / "a.m4a")
    assert faststart.main([str(tmp_path)]) == 0
    assert '"needs_fix": 1' in capsys.readouterr().out
    assert faststart.is_faststart(tmp_path / "a.m4a") is False
    assert faststart.main([str(tmp_path), "--apply"]) == 0
    assert faststart.is_faststart(tmp_path / "a.m4a") is True


def test_download_audio_applies_faststart(tmp_path, monkeypatch):
    from app import extractor

    def fake(video_id, out_dir, progress, source_url, trim):
        tail_moov_file(out_dir / f"{video_id}.m4a")
        return {"id": video_id}

    monkeypatch.setattr(extractor, "_download_audio_file", fake)
    assert extractor.download_audio("abcdefghijk", tmp_path) == {"id": "abcdefghijk"}
    assert faststart.is_faststart(tmp_path / "abcdefghijk.m4a") is True
