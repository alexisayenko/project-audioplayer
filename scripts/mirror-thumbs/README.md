# Mirrored spectrum preset thumbnails

Presets 1 to 5 use the owner's reference images, resized to 480x270 (cover crop, 96-colour palette via ffmpeg) from `docs/brand/mirror-references/`. Only "Classic" is captured from the real renderer (`web/js/viz-bars.js`) with `web/js/viz-mirror-presets.js`.

1. Serve: `node scripts/mirror-thumbs/serve.mjs 8766` (WSL on Windows).
2. Open `http://localhost:8766/capture.html`; the title becomes `done` and the PNG lands in `web/img/mirror-presets/`.
3. Stop the server.

The bars are a fixed synthetic spectrum, so reruns are identical. Rerun after changing the Classic preset or the bar drawing.
