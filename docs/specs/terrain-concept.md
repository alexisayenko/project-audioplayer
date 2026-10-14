# Terrain visualizer: the concept

A plain-language description of what Terrain is meant to be, for designers. The exact, testable rules are the numbered requirements [VIZ-043 to VIZ-055](visualizer.md).

## 1. The idea

Terrain is a landscape that is the song. The music is laid out as a field you fly over: sound becomes ground, loud things become hills, quiet things become flat plain.

## 2. The axes

- Left to right is pitch: bass on the left, treble on the right. It is the same spectrum as the Mirrored spectrum bars.
- Height is the loudness of that pitch at that moment.
- Near to far is time. Relief flows toward the viewer: the horizon is the future, and what has already played comes toward the viewer and passes by.

## 3. The "now" slice

A bright, glowing line across the field, about a third of the way out, is the second playing right now. It pulses with the beat. It is the only thing in the scene that pulses.

## 4. The future

The song is decoded ahead of time, so about 5 s of upcoming relief are visible beyond the now line. When that is not available (guest, huge file, still decoding), the live spectrum is used until the real one is ready, and the two blend smoothly.

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
- Beat peaks: the ground is flat. On each beat a peak grows from the ground in about 0.15 s, to a height set by the beat strength, rides toward the viewer and sinks back to flat over about 5 s. Three variants:
  - Single: one narrow peak at the most energetic pitch.
  - Hill: a broad hill around that pitch.
  - Multi: several peaks, one per strong band.
- Chosen in Settings > Playback > Terrain style, with key T, or in the vizdebug panel.

## 8. Atmosphere

- A dark navy night with stars.
- Thin mist drifts low over the ground; fog is denser in valleys and toward the horizon.
- A light from the upper right makes ridge faces turned toward it glow bluish, while faces turned away stay dark.
- The mood follows loudness only slowly (about a second): calm is dark, loud is bright.

## 9. Camera and controls

- A low camera looks slightly down toward the horizon. Defaults: eye 3.31, pitch -13.5 deg.
- V: full-screen. M: switch visualizer. T: cycle Terrain style.
- `?vizdebug=1` opens a panel with camera height, pitch and style.
- Quality levels: simple and crisp on weak devices; soft beaded lines, mist and bloom on strong ones. It steps down by itself when frames get slow.

## 10. History and baselines

- Tag `terrain-liked-1` (commit c9b18e7) is the owner-approved look.
- Tag `terrain-liked-2` (commit edd86a8) is the second owner-approved look: fine square cells in level-of-detail tiers, light, mist; favourite camera eye 3.70, pitch -13.0.
- Changes since then: camera defaults, landmark ridges, light and mist, the beat-peak styles, square cells (and smaller cells, in progress).
- Exact rules: [VIZ-043 to VIZ-055](visualizer.md).
