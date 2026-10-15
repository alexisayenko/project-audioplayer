# Synthwave preset thumbnails

Renders the real Synthwave renderer (`web/js/viz-synth-gl.js`) with each preset from `web/js/viz-synth-presets.js` and writes `web/img/synth-presets/<id>.png` (480x270).

Needs a WebGL browser and Node (WSL on Windows).

1. Serve: `node scripts/synth-thumbs/serve.mjs 8765` (serves `web/`, `/capture.html`, and `POST /save?id=<id>` writing the PNG).
2. Open `http://localhost:8765/capture.html`. It renders 240 frames (8 s at 30 fps) per preset, then posts each canvas. The page title becomes `done` and the log lists byte sizes.
3. Optimise: `scripts/synth-thumbs/optimize.sh [colors]` (ffmpeg palette quantisation, default 128; 96 keeps each file under 40 KB).
4. Stop the server.

Rerun after changing a preset or the renderer.

## Signal

The terrain only gets relief from audio: the live history fills the rows behind the camera, and the rows ahead (the visible far field) come from the look-ahead timeline. So the capture feeds both:

- a seeded synthetic 124 BPM track (same `makeSpectrum(7)` every run): tilted spectrum (strong bass, decaying highs), kick on every beat (bass bins), snare on beats 2 and 4 (mids), off-beat hats (highs), a lead peak that moves each bar, plus a slow pad and small per-bin jitter;
- a 60 s look-ahead timeline (16 rows/s, 64 bins, bytes) sampled from the same track, passed as `draw(spectrum, t, { timeline, time })`, starting at song time 4 s.

Without the timeline the far field stays flat and the terrain presets look like plain grids.
