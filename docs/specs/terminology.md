# Terminology

One name per thing. "Also called" lists informal names the owner or the code uses (they mean the same thing); "Not" lists what to avoid mixing up. Rules live in the file named in the last column. Constants are in `web/js/viz-terrain-math.js` unless noted.

## Terrain: time and the now line

| Term | Meaning | Also called / not | Where |
| --- | --- | --- | --- |
| Now line | The bright glowing line across the Terrain field that marks the audio position playing right now. Fixed depth `NOW_Z` = 12.5 world units (about 30% of the way to the horizon, screen middle). Falls off over `NOW_FALLOFF_S` 0.3 s of rows. Brightness gain `NOW_LINE_GAIN_B` 2.0 (on a beat); height gain `NOW_LINE_GAIN_H` 1.0 (no lift). Pulses with the beat; the only thing in the scene that does. | Also called: line now, current line, now slice, now row. Not: the seek bar, the pitch line | VIZ-047, VIZ-051; terrain-concept 3 |
| Time slice / row | One row of the field: one moment of the song, 16 per second (`ROWS_PER_SECOND`), its height taken once and then only travelling toward the viewer at `WORLD_SPEED` 5.5 units/s. | Also called: data row. Not: a grid column | VIZ-043 |
| Future side | The part of the field beyond the now line, toward the horizon (about 5 s, `LOOK_S`). | Not: past | VIZ-046 |
| Past side | The part between the now line and the viewer; rows travel there after they have played (about 2.3 s visible). | Not: future | VIZ-046 |
| Lookahead | The precomputed spectrum timeline that lets the future side show real upcoming relief (5 s, `LOOK_S`). Built in a Worker for songs whose audio is on the server. | Also called: timeline (the data), look-ahead | VIZ-046, VIZ-048, VIZ-049 |
| Timeline | The per-row spectrum (and parts, pitch) data built offline from the audio. | Not: lookahead (the feature that uses it) | VIZ-046 |
| Live fallback | The live analyser spectrum used instead of the timeline (guest, huge file, still decoding); blends into the timeline when ready. | Also called: live view | VIZ-046, VIZ-049 |
| Sync | Debug trim of audio-to-visual delay, -1000..+1000 ms, 0 = auto; positive shows visuals earlier. | Not: output latency (automatic) | VIZ-064 |

## Terrain: relief and styles

| Term | Meaning | Also called / not | Where |
| --- | --- | --- | --- |
| Relief (style) | Default Terrain style: continuous relief of the song's spectrum plus landmark ridges. | Not: base relief, relief (the generic word for terrain height) | VIZ-051; terrain-concept 7 |
| Beat peaks | Terrain styles where a peak grows on each beat (about 0.15 s up, sinks over about 5 s). Variants: single, hill, multi. | Also called: "alive" beat styles. Not: landmark ridge | VIZ-051, VIZ-052, VIZ-053 |
| Single / Hill / Multi | Beat-peak variants: one narrow peak at the strongest pitch; a broad hill there; several peaks, one per strong band. | | VIZ-054; terrain-concept 7 |
| Full spectrum | Terrain style identical to Relief except for a 1.1x taller now line (key `full`). | Not: a beat-peak variant | VIZ-051; terrain-concept 7 |
| Melody on beats (melody style) | Style where the tune is the actor: navy canvas glowing with the beats, melodic relief cyan to white, strongest peak amber, pitch line on a finished timeline. | Also called: melody. Not: Melody part toggle | VIZ-066 |
| Base relief | Soft spectrum relief under the beat peaks, 60% of the Relief height (`BEAT_BASE_RELIEF` 0.6). | Not: relief style | VIZ-051; terrain-concept 7 |
| Landmark ridge | One tall peak (not a wall across the width) every `LANDMARK_PERIOD_S` 5 s, at the loudest moment, around its strongest frequencies; none in quiet stretches. | Also called: landmark | VIZ-050 |
| Pitch line | A thin ridge following the lead pitch left and right, height = loudness of that voice (melody style, finished timeline only). | Also called: lead line, pitch ridge | VIZ-067 |
| Lead | The strongest narrow melodic peak in a 2.5 s window; drawn amber. | Not: pitch line (the ridge that follows it) | VIZ-066 |
| Accent | The amber highlight on the lead. | | VIZ-066 |
| Canvas | The ground that glows with the beats (beats part), in melody style. | Not: HTML canvas | VIZ-066 |
| Actor | The part the eye follows: the melody (melody style). | | VIZ-066 |
| Soft knee | Heights saturate smoothly toward the maximum, so peaks never get a flat roof. | Also called: no flat roof | VIZ-065 |

## Parts

| Term | Meaning | Also called / not | Where |
| --- | --- | --- | --- |
| Frequency parts | Bass (below ~250 Hz), Mids, Highs (above ~4 kHz); soft cross-fades. | Not: behaviour parts | VIZ-056, VIZ-057 |
| Behaviour parts | Beats (percussive), Melody (harmonic), Other (the rest), by harmonic/percussive separation. | Not: frequency parts | VIZ-056, VIZ-058 |
| Stems | Real source separation (vocals, piano, drums, bass) with Demucs, planned to replace the estimated behaviour parts in Terrain. | Also called: Demucs. Not: behaviour parts (estimates) | task-0029 (planned) |

## Visualizer modes and grid

| Term | Meaning | Also called / not | Where |
| --- | --- | --- | --- |
| Mirrored spectrum | Mode `bars`: bars up and down from a centre line. | Also called: spectrum bar(s), bars | VIZ-010, VIZ-040 |
| Ring | Mode `ring`: circular spectrum around the cover. | | VIZ-042 |
| Terrain | Mode `terrain`: the song as a landscape (WebGL). | | VIZ-043; terrain-concept |
| Cell | One square of the grid (square in the world, not on screen). | | VIZ-043 |
| LOD tier | Level-of-detail band: finer cells near the viewer, coarser far away. | Also called: tier | VIZ-043 |
| Lattice | The grid of ribbons, cross lines and nodes as a whole. | Also called: grid | VIZ-043 |
| Ribbon | A line running into the distance (along depth); the only lines visible on low relief. | Also called: depth line | VIZ-043 |
| Cross line | A line across the width; fades in above about 0.5 units of height. | | VIZ-043 |
| Node / bead | A soft glowing dot where lines cross. | Also called: bead | VIZ-043 |
| Mist / fog | Mist: thin layer drifting low over the ground. Fog: height fog, denser in valleys and toward the horizon. | | VIZ-051; terrain-concept 8 |
| Light | Directional light from the upper right; faces turned toward it glow bluish. | | terrain-concept 8 |

## Camera

| Term | Meaning | Also called / not | Where |
| --- | --- | --- | --- |
| Eye | Camera height (defaults 3.31; liked-2: 3.70). | Also called: camera height | VIZ-044 |
| Pitch | Camera tilt in degrees (default -13.5; liked-2: -13.0). | | VIZ-044 |
| Yaw | Looking left and right. | | VIZ-044 |
| Camera flight | Slow drift of eye and yaw like a gliding spaceship; off by default, key F, off with reduced motion, shared as `fl=1`. | Also called: flight, drift | VIZ-074, SHARE-017 |
| Shake | Bass shake of the camera; disabled (`SHAKE_ENABLED` false). | Not: camera flight | VIZ-043 |

## Performance

| Term | Meaning | Also called / not | Where |
| --- | --- | --- | --- |
| Quality level 0 / 1 / 2 | Terrain detail: 0 simple and crisp, 2 soft beaded lines, mist and bloom. | Also called: level | VIZ-043, VIZ-061 |
| Governor | Steps quality down (and up) by itself when frames are slow. Rungs 0 / 1 / 2 / 3 (3 = level 2 with DPR 2). | | VIZ-061 |
| Pacing | Frame-rate control: Terrain 60 fps, 30 fps on low battery or reduced motion; bars and Ring 30 fps. | Also called: frame pacing | VIZ-031, VIZ-061 |
| Lite | Governor state with no bloom and no mist. | | VIZ-061, VIZ-062 |
| Half-rate | 30 fps fallback when even lite cannot hold 60. | | VIZ-061 |

## Screens and playback

| Term | Meaning | Also called / not | Where |
| --- | --- | --- | --- |
| Overlay | The full-screen visualizer (key V) with its control row and top-right Share and Exit. | Also called: full-screen visualizer | VIZ-035, VIZ-070..073 |
| Playback screen | Tab `#/playback`: cover, seek bar, transport, details, and the queue. | Also called: Now playing (page title) | PLY-001 |
| Now playing (queue list) | The queue card beside or below the player. | Not: the Playback screen as a whole | PLY-001, PLY-040 |
| Mini-player | The fixed bar at the bottom on other screens. | | WEB-038; playback.md |
| Cover button | The cover as a button (`#cover-toggle`) that toggles play/pause. | | PLY-016 |
| Library | The list of songs (catalog), with song cards and a row menu. | | library.md |

## Sharing, baselines, data, accounts

| Term | Meaning | Also called / not | Where |
| --- | --- | --- | --- |
| Share link | `<origin>/#/play/<songId>?v=1&...`. Parameters: `v` version, `t` start second, `viz` bars/ring/terrain, `style`, `bg`, `fs` (open full-screen), `cam` (eye,pitch,yaw), `fl` (flight). | | SHARE-001, SHARE-003 |
| Liked baseline | Owner-approved Terrain look, tagged in git: `terrain-liked-1` (c9b18e7), `terrain-liked-2` (edd86a8). | Also called: baseline | visualizer.md; terrain-concept 10 |
| Catalog | The list of songs as metadata, with or without audio. | Not: audio | CAT-001 |
| Audio state | `none` (no file), `server` (on the server), `phone` (local copy). | Not: catalog | CAT-002 |
| Guest | A signed-out visitor: read-only view of the owner's library, with per-IP limits. | Not: owner | WEB-060 |
| Owner | Alex: exempt from quotas; the API token is his. | Not: signed-in user | ADR-0012 |
