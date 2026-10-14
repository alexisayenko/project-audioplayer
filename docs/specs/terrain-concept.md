# Terrain visualizer: the concept

A plain-language description of what Terrain is meant to be, for designers. The exact, testable rules are the numbered requirements [VIZ-043 to VIZ-055](visualizer.md).

## 1. The idea

Terrain is a landscape that is the song. The music is laid out as a field you fly over: sound becomes ground, loud things become hills, quiet things become flat plain.

## 2. The axes

- Left to right is pitch: bass on the left, treble on the right. It is the same spectrum as the Mirrored spectrum bars.
- Height is the loudness of that pitch at that moment.
- Near to far is time. Relief flows toward the viewer: the horizon is the future, and what has already played comes toward the viewer and passes by.

## 3. The "now" slice

A bright, glowing line across the field, about a third of the way out, is the second playing right now. It pulses with the beat. It is the only thing in the scene that pulses. Glossary: this is the "now line".

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
- Beat peaks: the ground carries a soft base relief of the spectrum (60% of the Relief height, `BEAT_BASE_RELIEF`) and the now line swells it (and the peaks on it) to 2x height with a 0.3 s gaussian falloff each side, so a wavefront travels through the field; on each beat a peak grows from the ground in about 0.15 s, to a height set by the beat strength, rides toward the viewer and sinks back to flat over about 5 s. Three variants:
  - Single: one narrow peak at the most energetic pitch.
  - Hill: a broad hill around that pitch.
  - Multi: several peaks, one per strong band.
  - Full spectrum: every column rises to the height of its own pitch's level, so the whole spectrum of the beat stands up across the full width, then rides toward the viewer and sinks back.
- Melody on beats: the tune is the actor. The ground is a dark navy canvas that glows softly with the beats and ripples a little; noise and effects show as sparks; the tonal part of the mids and highs builds the relief (cyan to white), and the strongest narrow melodic peak turns amber. With a finished analysis a thin ridge follows the lead pitch left and right as the tune moves, its height following the loudness of that voice. Needs the song analysed (server songs); otherwise it works from the live sound without the pitch line.
- Peaks never get a flat roof: heights saturate smoothly toward the maximum. Beat strength is relative to the song (a quiet intro gives small peaks).
- Chosen in Settings > Playback > Terrain style, with key T, or in the vizdebug panel.

## 8. Atmosphere

- A dark navy night with stars.
- Thin mist drifts low over the ground; fog is denser in valleys and toward the horizon.
- A light from the upper right makes ridge faces turned toward it glow bluish, while faces turned away stay dark.
- The mood follows loudness only slowly (about a second): calm is dark, loud is bright.

## 9. Camera and controls

- A low camera looks slightly down toward the horizon. Defaults: eye 3.31, pitch -13.5 deg.
- V: full-screen. M: switch visualizer. T: cycle Terrain style.
- `?vizdebug=1` opens a panel with camera height, pitch, yaw (look left and right), a sync trim for audio-to-visual delay, style and a quality override, and shows fps, level and mesh size.
- Quality levels: simple and crisp on weak devices; soft beaded lines, mist and bloom on strong ones. It steps down by itself when frames get slow. Terrain draws at 60 fps (display refresh capped at 60; 30 fps on a low battery, with reduced motion, or when even the simplest level cannot keep 60); the Mirrored spectrum and the Ring stay at 30.

## 10. History and baselines

- Tag `terrain-liked-1` (commit c9b18e7) is the owner-approved look.
- Tag `terrain-liked-2` (commit edd86a8) is the second owner-approved look: fine square cells in level-of-detail tiers, light, mist; favourite camera eye 3.70, pitch -13.0.
- Changes since then: camera defaults, landmark ridges, light and mist, the beat-peak styles, square cells (and smaller cells, in progress).
- Exact rules: [VIZ-043 to VIZ-055](visualizer.md).
