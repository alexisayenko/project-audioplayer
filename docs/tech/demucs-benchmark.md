# Demucs on the home server: install recipe and benchmark

Measured 2026-10-14 on LXC 106 `tools` (2 CPU cores, 16 GB RAM, Python 3.13.5, ffmpeg and gcc present), as user `claude`, entirely outside `/opt/audioplayer`.

## Recipe (worked first try, no workarounds)

```
python3 -m venv ~/demucs-env && . ~/demucs-env/bin/activate
pip install --upgrade pip
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu   # torch 2.14.1+cpu, torchaudio 2.11.0+cpu
pip install demucs                                                              # demucs 4.1.0 (not 4.0.1); wheels exist for cp313, lameenc 1.8.4 installed fine
pip install numpy soundfile                                                     # numpy is NOT pulled in by demucs 4.1.0; the CLI crashes without it
```

Models download from Hugging Face on first use into `~/.cache/huggingface` (htdemucs 4-stem and htdemucs_6s, 133 MB total).

Run:

```
export OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
nice -n 19 demucs -n htdemucs --device cpu -j 1 -o OUT song.wav      # 4 stems: drums bass other vocals
nice -n 19 demucs -n htdemucs_6s --device cpu -j 1 -o OUT song.wav   # adds guitar, piano
```

Output is WAV by default (there is no `--wav` flag). Avoid `--mp3`.

## Results (30 s stereo test clip: sine melody, pink noise, 60 Hz clicks)

| Run | Wall | RTF (wall / audio) | Peak RSS |
|---|---|---|---|
| htdemucs, first run (includes model download) | 149 s | 5.0 | 1.22 GB |
| htdemucs, repeat | 153.5 s | 5.1 | 1.29 GB |
| htdemucs `--segment 7` | 143 s | 4.8 | 1.29 GB |
| htdemucs_6s | 60 s | 2.0 | 1.30 GB |

- Model compute alone is about 4.1 s per audio second for htdemucs (progress bar, 35.1 s padded length).
- Extrapolation to a 4 minute song: htdemucs about 17 to 20 minutes; htdemucs_6s about 8 minutes if the 6s speed holds.
- The 6s run was unexpectedly 2.5x faster than the 4-stem runs. Not explained (not re-run; may be CPU contention from other containers on the host during the earlier runs, or a measurement quirk). Re-measure before relying on it.
- `--segment 7` made no memory difference (htdemucs already uses a 7.8 s segment); peak RSS is about 1.3 GB regardless, so 16 GB RAM is no constraint. Memory grows with song length only through the input/output tensors (a few hundred MB for 4 minutes).
- All stems were written. Levels on the synthetic clip were plausible but not meaningful for quality (the clip is not music): other -17 dB RMS, drums -22/-24, vocals -29/-70, bass -74 (4-stem). Real-song quality was not evaluated.

## Disk

- `~/demucs-env`: 1.1 GB (torch is most of it)
- `~/.cache/huggingface`: 133 MB (both models)
- `~/.cache/pip`: 249 MB (can be deleted)
- Output per 30 s clip: about 21 MB (4 stems), 31 MB (6 stems), so about 170 MB per 4 minute song as WAV; convert to FLAC or Opus and keep only needed stems.
- `/` had 16 GB free at the time.

## Caveats

- CPU only, 2 cores; one separation saturates both cores (user time is about 1.7x wall).
- The install pulls demucs 4.1.0 transitively with `sphn`, `huggingface-hub`, `httpx2`; if pip resolution ever breaks, pin versions from `pip freeze` in the venv.
- First run needs outbound access to huggingface.co.

## Recommended job design

- One background worker, one song at a time (a queue with concurrency 1), launched with `nice -n 19` and `OMP_NUM_THREADS=2` (or 1 to leave a core for the service).
- Hard time limit per job (for example 40 min) via `timeout`; mark the song failed on timeout.
- Cache the result keyed by song id and model name; never re-separate.
- Store stems compressed (FLAC or Opus) and delete the intermediate WAVs after encoding.
- Decode input with ffmpeg to 44.1 kHz stereo WAV first.
- Run it as a separate process or unit from the API service so a crash or OOM cannot affect playback.
