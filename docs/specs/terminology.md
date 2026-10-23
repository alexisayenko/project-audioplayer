# Terminology

One name per thing. "Also called" lists informal names the owner or the code uses (they mean the same thing); "Not" lists what to avoid mixing up. Rules live in the file named in the last column. Constants are in `web/js/viz-terrain-math.js` unless noted.

## Terrain: time and the now line

| Term | Meaning | Also called / not | Where |
| --- | --- | --- | --- |
| Now line | The bright glowing line across the Terrain field that marks the audio position playing right now. Fixed depth `NOW_Z` = 12.5 world units (about 30% of the way to the horizon, screen middle). Falls off over `NOW_FALLOFF_S` 0.3 s of rows. Brightness gain `NOW_LINE_GAIN_B` 2.0 (on a beat) and height gain `NOW_LINE_GAIN_H` 1.0 (no lift) in the beat styles; Full spectrum lifts 1.1x (`NOW_LINE_GAIN_H_FULL`), Lava 2.2x height and 4.0x glow; Relief and Melody have no boost; the debug fields `nowH` / `nowB` override. Pulses with the beat; the only thing in the scene that does. | Also called: line now, current line, now slice, now row. Not: the seek bar, the pitch line | VIZ-047, VIZ-051; terrain-concept 3 |
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
| Full spectrum | Terrain style: plain Relief with Multi beat peaks added on top; the now line boosts only the peaks, 1.1x (key `full`). | | VIZ-051; terrain-concept 7 |
| Lava | Terrain style: exactly the old Full spectrum, Relief with a 2.2x tall, 4x bright now line (key `lava`). | | VIZ-051; terrain-concept 7 |
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
| Bar width, Gap | Mirrored spectrum pixel settings: bar width and the space between bars in css px (0 width = Auto, the classic look). | Replaced Bar count / Bar width | VIZ-106 |
| Max bar height | Mirrored spectrum: tallest bar in css px above the horizon (0 = Auto). | Replaced Height | VIZ-106 |
| LED sections | Mirrored spectrum bars cut into stacked blocks (`segments`). | Concept: Sections | VIZ-106 |
| Peak marker | Mirrored spectrum: one section above the body at the recent maximum; rises instantly, held, then falls section by section (`peak`, `peakHold`). | Peak cap | VIZ-104 |
| Afterimage | Mirrored spectrum: fading ghost on each section the peak marker occupied (`afterimage`, `afterTau`); shows as dim detached sections. | Ghost | VIZ-104 |
| Section height | Mirrored spectrum: height of one LED section in px (`sectionHeight`, the gap `segmentGap` x height is added); used together with the LED sections count: both above 0 gives the Derived bar height, count 0 gives rows = round(bar height / (section + gap)); 0 = derived from count and bar height. | Not: LED sections | VIZ-104 |
| Derived bar height | Mirrored spectrum: bar height = sections x (section height + gap) when both Section height and LED sections are above 0; Max bar height is then ignored and disabled. | Not: Max bar height | VIZ-104 |
| Full room | Mirrored spectrum: setting `fullRoom` ("Use the whole screen in full-screen mode"); in the full-screen overlay the bars may use the whole canvas height instead of the Visualizer height; only Ice Blue Mirror 2 turns it on. | Not: Fit to room | VIZ-104 |
| Trail level | Mirrored spectrum History trail: level k of a row = min(Max level, floor(visits / Visits per step)); levels 0 to 8 are exactly palette colours 1 to 9; the Current sector is colour 10. | Not: Trail brightness (removed) | VIZ-105 |
| Section aspect | Mirrored spectrum: setting `sectionAspect` ("Section width = N x section height", 0 = off); above 0 with Section height above 0 the bar width is derived = aspect x effective section height and Bar width is disabled. | Not: Bar width | VIZ-104 |
| Fit to room | Mirrored spectrum: when the available half height is smaller than the Derived bar height, the section height shrinks proportionally (count and gap ratio kept, minimum 3 px); the panel shows the effective values. | Not: Auto height | VIZ-104 |
| Ice Blue Mirror 2 | Digital phosphor LED bars (working name kept): working copy of the liked Ice Blue Mirror (preset `ice-blue-mirror-2`); the original is frozen. | Copy, v2 | VIZ-104 |
| Base row glow, Mirror gap | The innermost LED row drawn white with a glow, and the dark gap before the reflection. | Not a horizon band | VIZ-104 |
| Reflection style | Mirrored spectrum: setting `reflectionMode` (alpha, shade, shifted); shifted (preset) = the reflected cell is the original's palette colour 4 steps darker, saturation at least 0.8, value fading linearly with depth; opaque, no glow, no blur. | Not: Reflection (the alpha amount) | VIZ-105 |
| Current sector | Mirrored spectrum History trail: the one LED segment at a column's current level, drawn flat in palette colour 10 (#d0f4ff, `SECTOR_RAMP_INDEX` 9). | Not: body, peak marker | VIZ-105 |
| Visit count | Per column and row: number of visits to that row in the last 10 s (`window`; a visit = the current sector stayed on the row for the minimum dwell); sets the trail brightness step. | | VIZ-105 |
| History trail | Rows the current sector visited, drawn by brightness step from the visit count (owner's name). | Not: afterimage | VIZ-105 |
| Digital phosphor (persistence) | Industry name for the idea behind the History trail: brightness or colour shows how often a spot is visited within a persistence window (oscilloscopes, RF spectrum analyzers). Ice Blue Mirror 2 implements it: window = persistence time, level steps = density colouring. | See: History trail; concept: [concept-digital-phosphor-led.md](../product/concept-digital-phosphor-led.md) | VIZ-105 |
| Minimum dwell | Time the sector must stay on a row before the visit counts (`minDwell`, 60 ms); passed-over rows do not count. | | VIZ-105 |
| Ice 2 palette | Viz-local 11-stop blue ramp `--viz-ice2-0..10` (tip to base, #040d31 to #f4fdff) plus `-dim-0..3` (= stops 0..3), `-bg` and `-ghost`, owner-approved. | Not: Ice palette | VIZ-105 |
| Glow (current sector) | Soft additive blue halo behind the current sector (settings Glow, Glow size). | Not: horizon glow | VIZ-105 |
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
| Eye | Camera height (defaults 3.31, range 0.2..10; liked-2: 3.70). | Also called: camera height | VIZ-075 |
| Pitch | Camera tilt in degrees (default -13.5; liked-2: -13.0). | | VIZ-075 |
| Yaw | Looking left and right (debug range -45..45 deg, default 0). | | VIZ-075 |
| Camera flight | Drift of eye and yaw like a gliding spaceship (periods 6 to 20 s, tuned by `FLIGHT_SPEED`); off by default, key F, off with reduced motion, shared as `fl=1`; yaw amplitude 16 deg, never below 8 deg, recentres toward 0 on very wide views. | Also called: flight, drift | VIZ-074, SHARE-017 |
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
| Playlist | A saved, named, ordered list of songs, kept in a folder tree (`#/playlists`). A smart playlist is a saved set of Library filter rules evaluated live; a folder holds playlists and folders. | Not: the Queue; "playlist" in old UI wording meant the queue | PLS-001..PLS-099 |
| Queue | The transient play-next list on Playback ("Add to queue"; formerly "Add to playlist" in the UI). "Save queue as playlist..." turns it into a Playlist. | Also called: Now playing (queue list) | PLY-001, PLS-013 |
| Now playing (queue list) | The queue card beside or below the player. | Not: the Playback screen as a whole | PLY-001, PLY-040 |
| Mini-player | The fixed bar (dock) at the bottom on other screens; collapsed, it moves into the sidebar footer (PLY-199). | | WEB-038; playback.md |
| Cover button | The cover as a button (`#cover-toggle`) that toggles play/pause. | | PLY-016 |
| Library | The list of songs (catalog), with song cards and a row menu. | | library.md |

## Sharing, baselines, data, accounts

| Term | Meaning | Also called / not | Where |
| --- | --- | --- | --- |
| Share link | `<origin>/#/play/<songId>?v=1&...`. Parameters: `v` version, `t` start second, `viz` bars/ring/terrain, `style`, `bg`, `fs` (open full-screen), `cam` (eye,pitch,yaw), `fl` (flight). | | SHARE-001, SHARE-003 |
| Liked baseline | Owner-approved visualizer look, tagged in git: `terrain-liked-1` (c9b18e7), `terrain-liked-2` (edd86a8); Mirrored spectrum Ice Blue Mirror: `mirror-liked-1` (001814c). | Also called: baseline | visualizer.md; terrain-concept 10 |
| Family | Top-level genre of the Genres map: one of the 15 Discogs genres or Other; every node has exactly one. | Also called: top-level genre. Not: parent genre | GEN-037, GEN-038 |
| Catalog | The list of songs as metadata, with or without audio. | Not: audio | CAT-001 |
| Audio state | `none` (no file), `server` (on the server), `phone` (local copy). | Not: catalog | CAT-002 |
| Guest | A signed-out visitor: read-only view of the owner's library, with per-IP limits. | Not: owner | WEB-060 |
| Owner | Alex: exempt from quotas; the API token is his. | Not: signed-in user | ADR-0012 |
| Featuring | A guest credited on a song (role Featuring, `featuredArtists`); shown as `feat.` in the title or the artist part by the Credit display preset. | Also called: featured artist. Not: Primary, remixer, "featuring" as displayed text | CRD-001 |
| Version slot | The label after the title that names the version (`[Tiesto Remix]`, `(cover)`), identical in both Credit display presets. | Not: the guest group `(feat. X)` | CRD-031 |
| Credit display | The per-user preset that decides whether `feat.` follows the title (Apple / YouTube) or the artists (Spotify / MusicBrainz). | Not: sort order, search | CRD-030, WEB-104 |
