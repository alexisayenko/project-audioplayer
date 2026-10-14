# Terrain visualizer: the concept

A plain-language description of what Terrain is meant to be, for designers. The exact, testable rules are the numbered requirements [VIZ-043 to VIZ-067 and VIZ-074](visualizer.md); the keys and buttons are in its controls cheat sheet. Names and aliases of every term used here: [terminology.md](terminology.md).

## 1. The idea

Terrain is a landscape that is the song. The music is laid out as a field you fly over: sound becomes ground, loud things become hills, quiet things become flat plain.

## 2. The axes

- Left to right is pitch: bass on the left, treble on the right. It is the same spectrum as the Mirrored spectrum bars.
- Height is the loudness of that pitch at that moment.
- Near to far is time. Relief flows toward the viewer: the horizon is the future, and what has already played comes toward the viewer and passes by.

## 3. The "now" slice

A bright, glowing line across the field, about a third of the way out, is the second playing right now. It pulses with the beat. It is the only thing in the scene that pulses. Glossary: this is the "now line". In the beat styles it only brightens; Full spectrum lifts the terrain under it a little (1.1x) and Lava a lot (2.2x height, 4x glow); Relief and Melody leave it plain.

## 4. The future

The song is decoded ahead of time, so about 5 s of upcoming relief are visible beyond the now line. When that is not available (guest, huge file, still decoding), the live spectrum is used until the real one is ready, and the two blend smoothly.

Lookahead (2026-10-15): the 5 s of future always come from the timeline for every row it covers. The timeline is built around the playhead first (seek, start mid-song, next track), cached per song, kept across mode switches, and the first 20 s of the next queue song are built ahead; rows not yet built stay live or flat and fade in over half a second, never all-or-nothing. The far end flattens only over the last 8% of the depth so all 5 s are visible, and the end of a song fades to flat smoothly.

## 5. The ground

- A regular grid of square cells (square in the world, not on screen), wide enough to run off both screen edges and deep enough to reach the horizon.
- Real perspective: lines converge toward the horizon and fan out toward the viewer.
- Where the relief is low, only long ribbons running into the distance are visible.
- Above about 0.5 units of height, cross lines fade in, so raised ground turns into cells.
- Line crossings glow as small beads. Lines are soft and beaded, not crisp hairlines.

## 6. A rigid landscape

Each slice of time takes its height once, from its own moment of the song, and from then on only travels toward the viewer at a constant speed. There is no whole-field breathing, no sideways sway, no camera shake (a bass shake exists but is off by default).

## 7. Styles

- Relief (default): continuous relief of the song's spectrum, plus a landmark. Every 5 s the loudest moment gets a taller peak around its strongest frequencies (not a wall across the whole width); quiet or flat-sounding stretches get none.
- Beat peaks: the ground carries a soft base relief of the spectrum (60% of the Relief height, `BEAT_BASE_RELIEF`) and the now line only brightens the glow (height boost 1x, no swell); on each beat a peak grows from the ground in about 0.15 s, to a height set by the beat strength, rides toward the viewer and sinks back to flat over about 5 s. Three variants (Full spectrum is a fourth, see below):
  - Single: one narrow peak at the most energetic pitch.
  - Hill: a broad hill around that pitch.
  - Multi: several peaks, one per strong band.
- Full spectrum: the plain Relief style, unchanged (same baked rows, landmarks on, no smoothing), with the Multi beat peaks added on top (up to 5 per beat, rise 0.15 s, decay 5 s) through the soft knee: peaks add to the relief and the sum is capped at the landmark maximum 4.5 units. The now line acts only on the peaks: they get 1.1x height (`NOW_LINE_GAIN_H_FULL`, debug field `nowH`) and the extra glow `nowB`, weighted per vertex by the peak share of the height; the relief under and beside them is not lifted.
- Lava: the former Full spectrum look: exactly Relief (same rows, landmarks and look), no beat detection, no base relief, with a taller and brighter now line (height 2.2x `NOW_LINE_GAIN_H_LAVA`, glow 4x `NOW_LINE_GAIN_B_LAVA`; debug fields `nowH` / `nowB` show each style's defaults until edited, Reset restores them).
- Melody on beats: the tune is the actor. The ground is a dark navy canvas that glows softly with the beats and ripples a little; noise and effects show as sparks; the tonal part of the mids and highs builds the relief (cyan to white), and the strongest narrow melodic peak turns amber. With a finished analysis a thin ridge follows the lead pitch left and right as the tune moves, its height following the loudness of that voice. Needs the song analysed (server songs); otherwise it works from the live sound without the pitch line.
- Peaks never get a flat roof: heights saturate smoothly toward the maximum. Beat strength is relative to the song (a quiet intro gives small peaks).
- The cell size grows only with the distance from the camera, never with the left or right position, also while the Camera flight swings the view.
- Style order (key T): Relief, single, hill, multi, Full spectrum, Lava, Melody on beats. Chosen in Settings > Playback > Terrain style, with key T, or in the left Visualizer style panel.

## 8. Atmosphere

- A dark navy night with stars.
- Thin mist drifts low over the ground; fog is denser in valleys and toward the horizon.
- A light from the upper right makes ridge faces turned toward it glow bluish, while faces turned away stay dark.
- The mood follows loudness only slowly (about a second): calm is dark, loud is bright.

## 9. Camera and controls

- A low camera looks slightly down toward the horizon. Defaults: eye 3.31, pitch -13.5 deg.
- V: full-screen. M: switch visualizer. T: cycle Terrain style. F: camera flight on/off. S / R: shuffle / repeat; ArrowUp / ArrowDown: volume; Esc: leave; click the picture: play or pause. Full list: the controls cheat sheet in [visualizer.md](visualizer.md).
- Camera flight (off by default, switch in the left panel): the camera drifts slowly and smoothly, like a spaceship gliding. Camera height wanders up to about 40% either way (one wander takes 9 to 20 s) and the view turns left and right up to 16 degrees (6 to 15 s per swing), never past where the terrain still fills the screen. It starts and stops gently (3 s in, 2 s out), moves only while the music plays, and is forced off with reduced motion. It adds to your camera settings and never changes them.
- The left "Terrain style" panel (everyone) holds the style select. `?vizdebug=1` adds a separate "Camera (debug)" panel with camera height, pitch, yaw (look left and right), a sync trim for audio-to-visual delay and a quality override, and shows fps, level and mesh size. Camera flight swings yaw by up to +-16 deg even on wide strips (aspect up to 4): the far grid tiers are widened to cover it, the grid's side edges fade out, and when the view is too wide the swing shrinks to at least +-8 deg and recentres toward 0 instead of stopping.
- Quality levels: simple and crisp on weak devices; soft beaded lines, mist and bloom on strong ones. It steps down by itself when frames get slow. Terrain draws at 60 fps (display refresh capped at 60; 30 fps on a low battery, with reduced motion, or when even the simplest level cannot keep 60); the Mirrored spectrum and the Ring stay at 30.

## 10. History and baselines

- Tag `terrain-liked-1` (commit c9b18e7) is the owner-approved look.
- Tag `terrain-liked-2` (commit edd86a8) is the second owner-approved look: fine square cells in level-of-detail tiers, light, mist; favourite camera eye 3.70, pitch -13.0.
- Changes since liked-1: camera defaults, landmark ridges, light and mist, the beat-peak styles, square cells in level-of-detail tiers. Changes since liked-2 (the tag stays put): the Full spectrum redesign and the Lava style, the Melody style with a pitch line, progressive lookahead, Camera flight, Terrain at 60 fps, frame pacing and latency compensation, part toggles, the overlay controls and share links.
- Exact rules: [VIZ-043 to VIZ-067 and VIZ-074](visualizer.md).
