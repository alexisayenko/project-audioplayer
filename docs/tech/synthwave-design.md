# Synthwave terrain: design and build contract

Spec: [visualizer.md](../specs/visualizer.md#synthwave-terrain) (VIZ-080 to VIZ-091), task: [task-0030](../tasks/task-0030.md). Written by the architect; builders and the integrator follow it. Where this file and the spec differ on a default or a name, this file wins until the spec is updated by the integrator.

## 1. Decision: refactor first?

No refactor of the Terrain internals (`viz-terrain-math.js`, `viz-terrain-gl.js`, `viz-lookahead.js`, `viz-beats.js`, `viz-pacing.js`): they are imported as they are, so `terrain-liked-2` and the existing tests cannot regress. The Terrain renderer is monolithic (1078 lines, one program set, style-bound), so the new mode gets its own renderer built from small passes; extracting Terrain's shared pieces would risk the baseline for little gain. Shared data helpers are already exported pure functions and are reused by import (section 3).

One small refactor IS needed, but only in registration and dispatch code, because the code assumes "the only GL mode is `terrain`". It is done by the INTEGRATOR after the builders (builders do not wait for it; they work in new files). Terrain behaviour must stay byte-for-byte identical; the existing tests are the guard.

| Id | File | Change |
|---|---|---|
| R1 | `viz-modes.js` | `MODES` gets `{ id: 'synthwave', label: 'Synthwave terrain', icon: 'synthwave', requiresWebGL: true }` after `terrain`. `createModeRenderer` stops hard-coding `createTerrain`: it takes `deps.factories = { terrain, synthwave }` (still accepts `deps.createTerrain` as the terrain factory) and builds `factories[id]`. New export `isSceneMode(id)` (true for `terrain` and `synthwave`: GL modes that use the lookahead timeline and the pace governor) and `usesFlight(id)` (terrain only). |
| R2 | `viz-settings.js` | `vizMode()` passes caps only when `id === 'terrain'`; change to any mode with `requiresWebGL` (else a saved `synthwave` silently becomes `bars`). Add a synthwave case to the existing mode tests. |
| R3 | `viz-canvas.js` | Replace the `'terrain'` literals (lines about 250, 268-270, 324, 336, 342) with `isSceneMode(r.id)` for lookahead request, pace judging, `paceSignature` (include `getSynth()` version instead of `getStyle()` for synthwave) and latency; keep `flight.tick` terrain-only via `usesFlight`. `ensureRenderer` passes `factories: { terrain: d.createTerrain, synthwave: d.createSynth }`; `dropRenderer` removes the GL canvas only when the next mode is not a GL mode. Add the fallback rule of section 8. |
| R4 | `viz-panel.js` | `panelSections` gets `synth: mode === 'synthwave'`; `createStylePanel` mounts `createSynthPanel` (ui) in that section; title comes from `modeLabel` ("Synthwave terrain style"). |
| R5 | `share.js`, `share-ui.js`, `share-open.js` | `SHARE_MODES` adds `synthwave`; `viz=synthwave` only. Share links carry no synthwave properties (VIZ-088, open question D unanswered, see section 9). |
| R6 | `icons.js`, `index.html`, `viz-ui.js` | Add icon `synthwave`; link `viz-synth.css` after `viz.css`; the `M` cycle and Settings select already read `MODES`; announce text for the mode needs no change. |

Integrator also: update `visualizer.md` (statuses, cheat sheet `M` row, VIZ-089 proposed defaults from section 5), `web.md` module list, `screens.md`, `CHANGELOG.md`, and check any asset or cache list that enumerates `web/js` files (grep for `viz-terrain-gl.js` outside `web/js`).

## 2. Files and owners

All new files are in `web/js/` unless noted, prefixed `viz-synth-`. Each builder also writes the matching `*.test.mjs` (same base name) and touches nothing else.

| File | Owner | Purpose |
|---|---|---|
| `viz-synth-settings.js` | ui | Schema, defaults, validation, persistence, presets, listeners |
| `viz-synth-panel.js` | ui | Style panel DOM built from the schema |
| `../viz-synth.css` | ui | Panel styles only (`.viz-synth-*`), tokens via `var(--...)`, never edit `viz.css` or `tokens.css` |
| `viz-synth-signal.js` | ui | Smoothed audio signal and flash limiter |
| `viz-synth-quality.js` | ui | Governor level to feature flags (section 7) |
| `viz-synth-gl.js` | ui | Renderer shell: `createSynth`, context, resize, pass composition, loss and restore, stats, dispose |
| `viz-synth-camera.js` | terrain | `synthCamera`, matrices, horizon sync |
| `viz-synth-field.js` | terrain | Height field: frame to heights, peak shaping, valley, future silhouette heights |
| `viz-synth-mesh.js` | terrain | Tiers, square and triangle geometry, index lists |
| `viz-synth-ground.js` | terrain | Ground pass: faces, lines, glow, fog, hills silhouette, future silhouette |
| `viz-synth-sun.js` | sun | Sun, haze, reflection pure functions and passes |
| `viz-synth-sky.js` | sky | Sky gradient, stars, horizon line and band, vignette |

Build order inside one builder: pure functions and tests first, GL pass second. `ui` writes `viz-synth-settings.js` FIRST (a few minutes) so the others can import `defaultSynth()`; until it exists, tests use a literal fixture copied from section 5.

Only the integrator edits: `viz-modes.js`, `viz-settings.js`, `viz-canvas.js`, `viz-panel.js`, `share*.js`, `icons.js`, `index.html`, `viz-ui.js`, docs, and any existing test file.

## 3. Reuse (import only, never edit)

From `viz-terrain-math.js`: `clamp01`, `smoothstep`, `softKnee`, `mulberry32`, `GRID_DEPTH` 40, `WORLD_SPEED` 5.5, `NOW_Z` 12.5, `ROWS_PER_SECOND` 16, `HISTORY_BINS` 64, `HEIGHT_CAP`, `AMP_MAX`, `LANDMARK_MAX` 4.5, `GRID_MAX_VERTICES` 30000, `gridHalfWidth(aspect)`, `createFrame`, `createSeries`, `rowLayout`, `nowZOf`, `fillLookFrame`, `fillLiveFrame`, `blendFrames`, `timelineCovers`, `resample`, `fillHeights`, `smoothHeights`, `energyOf`, `easeEnergy`, `makeRowClock`, `buildGridVertices`, `buildDepthIndices`, `buildCrossIndices`, `lodTiers`, `makeTierPlan`, `resampleTier`, `mat4Perspective`, `mat4LookAt`, `mat4Multiply`, `mat4` helpers. From `viz-beats.js`: `timelineBeats`, `createLiveBeats`, `fillBeatHeights`, `BEAT_SHAPES`. From `viz-terrain-gl.js`: `isWebGLAvailable`, `linkProgram`, `TERRAIN_MAX_DPR`. From `viz-pacing.js`: nothing directly (the canvas owns the governor; the shell receives its result). Do not import `viz-cam-debug.js`, `viz-flight.js` or `viz-terrain-style.js`: Synthwave has no debug camera, no flight and no Terrain style.

Data flow per frame, in `viz-synth-gl.js` (same as Terrain): `draw(spectrum, tMs, look, latS)`; `look` is `{timeline, time, partial}` or null; live rows come from `createSeries` + `makeRowClock` (identical to Terrain), the timeline from `fillLookFrame`, merged with `blendFrames` over 1 s; beats via `timelineBeats` or `createLiveBeats`. The shell produces a `frame` (`createFrame(rows)` layout of `rowLayout`) and calls the terrain builder's field functions.

## 4. Coordinates and render order

World (same as Terrain so reused helpers apply): x right, y up, z away from the camera. Camera at (0, eye, 0) looking toward +z, pitched down. Ground is y = 0, grid spans z in [0, GRID_DEPTH] and x in [-hw, hw] with `hw = gridHalfWidth(aspect)`; the now row sits at `NOW_Z`; relief flows toward the camera (z decreasing). Heights are world units, never above `LANDMARK_MAX` (4.5).

Screen: `u` 0..1 left to right, `v` 0..1 TOP to bottom (CSS convention, not GL). Every size in settings that says "of height" is a fraction of the canvas CSS height; passes get `scene.res = [w, h]` in device px and convert (`gl_FragCoord.y` is bottom-up: `v = 1 - fragY / h`). The horizon is the screen row `scene.horizonV` where the ground meets the sky at infinity. Colours cross every API as `[r, g, b]` floats 0..1 (convert hex once in the settings or pass code, `parseHex(str) -> [r,g,b]` exported by `viz-synth-settings.js`).

`scene` object (built by the shell each frame, read-only for passes): `{ w, h, dpr, aspect, res: [w*dpr, h*dpr], horizonV, time, dt, reduced, q }` where `time` is seconds (frozen at 0 when reduced), `q` is the quality flags of section 7.

`signal` object (built by `viz-synth-signal.js`): `{ bass, energy, pulse, flash }` all 0..1; `bass` and `energy` follow the Terrain 1.2 s follower, `pulse` is the faster follower (`easeEnergy`), `flash` is `pulse` after the flash limiter and is the ONLY value allowed to drive sun, haze, peak or edge brightness.

Render order (back to front; passes with depth test off unless stated):
1. Clear to sky bottom colour.
2. `sky.drawBack`: gradient, stars.
3. `sun.drawHaze`: ring and band (additive).
4. `sun.drawSun`: disc, gradient, slices.
5. `ground.drawHills`: horizon silhouette (opaque dark, only above the horizon).
6. `ground.drawFloor`: opaque ground fill from the horizon down (dark, vertical gradient to the fog colour at the horizon).
7. `sun.drawReflection`: streak or blurred copy, wet sheen (additive, below the horizon).
8. `ground.drawTerrain`: depth test and depth write ON: faces, then lines, then glow (additive); future silhouette last, depth test on, no depth write.
9. `sky.drawFront`: horizon line, band and glow (additive, depth off), then vignette (multiply).

Because terrain is drawn with depth, peaks rising above the horizon correctly cover the sun and hills.

## 5. Settings object and defaults (authoritative; ui implements verbatim)

Storage `localStorage` `ap2.viz.synth`, JSON `{ v: 1, ...groups }`. Unknown keys dropped, wrong types or out-of-range values repaired to the default per field (numbers clamped to range, enums to default, colours must match `/^#[0-9a-f]{6}$/i`), `v` mismatch or unparseable text means defaults, storage errors swallowed. Defaults below are PROPOSED (VIZ-089); all are Alex-adjustable later by changing this table only.

`terrain` (owner: terrain; consumed by camera, field, mesh, ground)

| Key | Type, range | Default | Meaning |
|---|---|---|---|
| `preset` | `custom` `cyan` `pink` `blue` `magenta` | `cyan` | Selecting a preset overwrites the four colours below; editing a colour sets `custom` |
| `grid` | `square` `triangle` | `square` | Mesh style |
| `speed` | 0.2..2 | 1 | Multiplier of `WORLD_SPEED` |
| `cell` | 0.2..1.2 | 0.6 | Near cell size, world units; mesh coarsens beyond by tiers |
| `lineColor` | colour | `#2ee6ff` | |
| `fillColor` | colour | `#12062b` | Dark face fill |
| `faceColor` | colour | `#0b3a4a` | Lit face tint (filled mode) |
| `lineWidth` | 0.5..3 | 1.2 | CSS px |
| `glow` | 0..1 | 0.6 | Line glow strength |
| `fill` | `none` `dark` `faces` | `dark` | No fill, dark fill, or `faceColor` lit by `lightFactor` |
| `eye` | 1..6 | 2.6 | Camera height |
| `sharp` | 0..1 | 0.45 | Peak shape: 0 smooth plain-to-hills, 0.5 low-poly mountains, 1 tall spikes |
| `height` | 0.2..2 | 1 | Peak height multiplier (result still capped at 4.5) |
| `density` | 0..1 | 0.5 | Share of spectrum detail kept (0 one broad hill, 1 full relief) |
| `render` | `wire` `filled` `both` | `both` | Peak styling |
| `edgeGlow` | 0..1 | 0.7 | Edge glow on peaks |
| `fade` | 0.2..3 | 1 | Peak fade speed multiplier (decay of beat and landmark relief) |
| `valley` | bool | true | Clear channel in the centre |
| `valleyWidth` | 0.05..0.5 | 0.18 | Fraction of the width |
| `hills` | bool | false | Dark horizon silhouette |
| `hillsColor` | colour | `#0a0220` | |
| `future` | bool | true | Future silhouette |
| `futureOpacity` | 0..1 | 0.25 | |
| `futureDist` | 0.1..1 | 0.6 | Where it ends, fraction of `GRID_DEPTH` beyond the now row's far side |
| `futureStyle` | `line` `fill` | `line` | |

`sun` (owner: sun)

| Key | Type, range | Default |
|---|---|---|
| `on` | bool | true |
| `radius` | 0.05..0.6 (of canvas height) | 0.22 |
| `height` | -1..3, step 0.05 (sun centre height above the horizon line in sun radii, independent of `radius`: 0 half sunk, 1 bottom edge touches the horizon, >1 floats, <0 mostly sunk; label "Sun height (radii)"; a saved old `lift` key is ignored and the default applies) | 0.5 |
| `top`, `bottom` | colour | `#ffd23f`, `#ff2d95` |
| `mid` | colour, plus `midOn` bool | `#ff7a3d`, true |
| `sliceStart` | 0..0.9 (fraction of sun height from the top) | 0.5 |
| `sliceCount` | 0..16 int | 7 |
| `sliceFirst` | 0.005..0.1 (first slice thickness, fraction of diameter) | 0.025 |
| `sliceGrowth` | 1..2.5 (each slice and each gap grows by this factor toward the bottom) | 1.45 |
| `sliceEdge` | `smooth` `stepped` | `smooth` |
| `sliceDrift` | 0..1 (downward drift speed, 0 off) | 0.2 |
| `ringOn` | bool | true |
| `ringColor` | colour | `#ff5a3c` |
| `ringRadius` | 1..2.5 (x sun radius) | 1.5 |
| `ringSoft` | 0..1 | 0.7 |
| `ringAlpha` | 0..1 | 0.55 |
| `ringShape` | `ring` `band` | `ring` |
| `bandOn` | bool | true |
| `bandColor` | colour | `#ff3d8a` |
| `bandHeight` | 0..0.2 (of canvas height) | 0.06 |
| `hazeMove` | 0..1 | 0.4 |
| `refl` | `streak` `blur` `off` | `streak` |
| `reflFollow` | bool (use the sun gradient) | true |
| `reflColor` | colour | `#ff5aa5` |
| `reflOpacity` | 0..1 | 0.5 |
| `reflLength` | 0.1..1 (of the ground height) | 0.5 |
| `reflFade` | 0..1 | 0.7 |
| `reflRipple` | 0..1 | 0.3 |
| `sheen` | bool | true |
| `sheenAmount` | 0..1 | 0.35 |

`sky` (owner: sky)

| Key | Type, range | Default |
|---|---|---|
| `horizonV` | 0.25..0.6 | 0.40 |
| `top`, `mid`, `bottom` | colour | `#05021a`, `#1a0a4a`, `#5a1a7a` |
| `midOn` | bool | true |
| `stars` | 0..600 int | 140 |
| `starSize` | 0.5..3 (css px) | 1.2 |
| `starBright` | 0..1 | 0.7 |
| `twinkle` | 0..1 | 0.4 |
| `starSeed` | 0..9999 int | 7 |
| `vignette` | bool | true |
| `vignetteAmount` | 0..1 | 0.45 |
| `hColor` | colour (horizon line) | `#ff4fd8` |
| `hThick` | 0.5..6 (css px) | 1.5 |
| `hGlow` | 0..1 | 0.7 |
| `hSpread` | 0..0.15 (of canvas height) | 0.04 |
| `hSoft` | 0..1 (0 hard line, 1 soft glow band) | 0.3 |
| `hBand` | bool | false |
| `hBandColor` | colour | `#3b6bff` |
| `hBandHeight` | 0..0.1 | 0.02 |

Stars are placed above the horizon only; star positions come from `makeStars`-style seeded `mulberry32(starSeed)` so a given seed always gives the same sky.

Presets (`SYNTH_PRESETS`, colours only, applied to `lineColor`, `fillColor`, `faceColor` and `sky.hColor`): `cyan` `#2ee6ff` on `#12062b`; `pink` `#ff4fb8` on `#14041a`; `blue` `#3d7bff` on `#dfe9ff` (light fill, `faceColor` `#9db8ff`); `magenta` `#ff2bd6` on `#050008`.

## 6. Module contracts

All functions are pure unless marked GL. No module reads `localStorage`, `document` or the clock except `viz-synth-settings.js` (storage) and passes marked GL. Every pass has the shape `{ draw(scene, params, signal), resize(w, h, dpr), rebuild(), dispose(), stats }` and is created by `createXPass(gl, { linkProgram })`; `rebuild()` recreates GL resources after context restore. A pass must tolerate `params` unchanged between frames (uploads only changed uniforms).

### ui

`viz-synth-settings.js`: `SYNTH_KEY = 'ap2.viz.synth'`; `SYNTH_SCHEMA` (array of `{ path: 'sun.radius', group, label, type: 'range'|'select'|'bool'|'color'|'int', min, max, step, options, def }`, in panel order; groups `Terrain` `Peaks` `Sun` `Haze` `Reflection` `Horizon` `Sky`); `defaultSynth()`; `validateSynth(raw) -> settings` (never throws, accepts text or object); `getSynth()` (cached), `setSynth(path, value)` (validates the single field, persists, notifies), `applyPreset(id)`, `resetSynth(group?)`, `onSynth(cb) -> off`, `synthVersion()` (integer, increments on every change, used by the pace signature), `parseHex(str) -> [r,g,b]`, `SYNTH_PRESETS`. The settings object is flat per group: `{ terrain: {...}, sun: {...}, sky: {...} }` using the keys of section 5 (`sun` holds sun, haze and reflection keys; the panel groups them by the Group label).

`viz-synth-panel.js`: `createSynthPanel({ doc, store? }) -> { el, destroy }` renders every schema field as a labelled control (range with output text, select, switch, `<input type=color>`), a Reset per group and a Reset all, 44 px targets, names via `<label>`, keyboard operation, `stopPropagation` of keydown so `V`, `M` and `T` hotkeys do not fire while a control has focus (same rule as VIZ-021). Writes through `setSynth`; subscribes with `onSynth` to repaint (preset changes). Groups are collapsible `<details>`.

`viz-synth-signal.js`: `createSignal() -> { step(spectrum, dtS, reduced) -> signal }` using `energyOf`, `easeEnergy` and the Terrain 1.2 s follower; `limitFlash(prev, target, dtS) -> next` caps the brightness swing to 0.25 and the rise rate so there are at most 3 up-crossings of the mid level per second (VIZ-033, VIZ-091); with `reduced` it returns the constant `{ bass: 0.3, energy: 0.3, pulse: 0.3, flash: 0.3 }`.

`viz-synth-quality.js`: `synthQuality(level, flags) -> q` (section 7), `SYNTH_MAX_DPR = 1.5`.

`viz-synth-gl.js`: `createSynth(canvas, opts = {}) -> renderer | null` with the SAME surface as `createTerrain`: `resize(w, h, dpr)`, `draw(spectrum, tMs, look, latS)`, `setQuality(level)`, `setLite(on)`, `setDprCap(hi)`, `dispose()`, getters `stats` (`{ level, tiers, vertices, dpr, lite, w, h, builds }`), `lost`, `quality`. `opts`: `gl`, `onError`, `settings` (a getter, default `getSynth`), `passes` (injection for tests: `{ sky, sun, ground }` factories), `now`. The shell owns the canvas listeners (`webglcontextlost`: preventDefault, mark lost, skip draws; `webglcontextrestored`: `pass.rebuild()` for all, reset clock), builds `scene`, `signal`, the frame, calls the pass methods in the order of section 4, caps DPR at `SYNTH_MAX_DPR` (2 only when `setDprCap(true)`), honours reduced motion (draws once per settings or size change, `scene.time = 0`), and returns `null` when WebGL is missing.

### terrain

`viz-synth-camera.js`: `synthCamera(aspect, horizonV, eye) -> { eye: [0, eye, 0], target, up, fov: 62, pitchDeg, near, far }` with the pitch derived so the infinity horizon lands at `horizonV` (`ndcY = 1 - 2 * horizonV`, `pitch = -atan(ndcY * tan(fov / 2))`); `viewProj(cam, aspect, out) -> Float32Array(16)`; `horizonOf(cam) -> v` (inverse, used by a test to prove the round trip). No shake, no drift, no flight.

`viz-synth-field.js`: `fillSynthHeights(frame, cols, t, p, out) -> out` (`p` = `settings.terrain`; wraps `fillHeights` with `bakeAmp`, applies `density` (smoothing passes and column pooling), `shapePeaks`, `height`, valley and the soft knee to 4.5); `shapePeaks(out, rows, cols, sharp)` (monotone in `sharp`: 0 gives broad rounded relief, about 0.5 piecewise-linear low-poly facets, 1 narrow spikes; max never exceeds the input max after knee; mean energy roughly kept); `valleyMask(cols, width) -> Float32Array` (1 outside, 0 at the centre column, smoothstep edge); `futureHeights(frame, cols, t, p, out)` (the same field sampled for rows beyond the visible far edge up to `futureDist`, height scaled by `futureOpacity`-independent geometry only; opacity is a shader uniform); `fadeDecay(p.fade) -> decayScale` (multiplies `BEAT_DECAY_S` for beat relief). Deterministic in `(frame, t, p)`.

`viz-synth-mesh.js`: `synthTiers(p, level, aspect, nowZ) -> tier[]` (same object shape as `lodTiers` entries so `makeTierPlan` and `resampleTier` work; near spacing `p.cell`, doubling per tier by distance, total vertices at most `GRID_MAX_VERTICES`, `q.cellMul` applied by the caller); `buildMesh(tier, style) -> { xz: Float32Array, lines: Uint16Array|Uint32Array, tris: Uint16Array|Uint32Array, lineCount, triCount }`; square: lines are depth and cross edges, tris two per cell on a fixed diagonal; triangle: same vertices, lines include one alternating diagonal per cell (a true triangle mesh look), tris alternate the diagonal; `crossAlphaFor(h)` is reused from `crossAlpha`. Index type switches to Uint32 above 65535 vertices.

`viz-synth-ground.js`: `groundUniforms(scene, p, sky, signal) -> { mvp, lineColor, fillColor, faceColor, fogColor, fogNear, fogFar, glow, edgeGlow, lineWidthPx, fillMode, renderMode, scroll, futureOpacity, futureColor, time }` (pure; `sky` is the object returned by `skyColors(sky)`, so the fog fades into the horizon); `scrollOf(tMs, speed) -> world units` (monotone, `speed` multiplier of `WORLD_SPEED`; 0 when reduced); `hillsPolyline(aspect, horizonV, seed, p) -> Float32Array` (clip-space triangle strip); `createGroundPass(gl, deps)` implements `drawHills`, `drawFloor`, `drawTerrain` in addition to the generic pass methods and owns tier buffers, uploads heights from `field` through `setHeights(rowsBuffer)` called by the shell.

### sun

`viz-synth-sun.js`: `sunLayout(scene, p) -> { cx, cy, r }` in `u`,`v` units (circle in pixels: `r` of height, `cx = 0.5`); `sliceBands(p) -> Array<{ y0, y1 }>` (fractions of the sun diameter from the top; only below `sliceStart`; widths grow by `sliceGrowth`, first thickness `sliceFirst`; clipped to the disc; `sliceCount` 0 gives none); `sunUniforms(scene, p, signal, driftPhase) -> object` (colours, gradient stops, band arrays padded to 16 pairs, `edgeSoftPx` (0 when `sliceEdge` is `stepped`, quantised rows of 4 px), `bright = 1 + 0.15 * signal.flash`); `hazeUniforms(scene, p, signal, phase)`; `reflectionUniforms(scene, p, signal, phase)` (reflection x-centre equals the sun, y from the horizon down by `reflLength`, fade by `reflFade`, ripple frequency and amplitude, sheen strength; colours follow the sun gradient when `reflFollow`); `sunColorAt(p, tDisc) -> [r,g,b]` (gradient sampler shared by disc and reflection); `advancePhase(prev, dt, p, q, reduced) -> phase` (slice drift and haze movement; frozen when `reduced` or `q.hazeMotion` is false). Fragment shader sources are exported as strings (`SUN_FS`, `HAZE_FS`, `REFL_FS`) for tests to check required uniforms exist. `createSunPass(gl, deps)` implements `drawHaze`, `drawSun`, `drawReflection`.

### sky

`viz-synth-sky.js`: `skyColors(p) -> { top, mid, bottom, horizon, fog }` (`horizon` is the colour of the sky at the horizon, `fog` the colour terrain and floor fade into: the horizon colour mixed 50% with the haze band colour when `sun.bandOn`, passed in as `fog(p, sunP)`, so the signature is `skyColors(p, sunP)`); `starField(p, w, h) -> Float32Array` (x, y, size, phase, brightness per star in pixels, only above the horizon, deterministic from `starSeed`, count scaled with area up to the setting); `twinkleAt(phase, t, amount, q) -> 0..1` (flat 1 when `q.starsAnimated` is false or reduced); `skyUniforms(scene, p, signal)`; `horizonUniforms(scene, p, signal)` (line colour, thickness px, glow, spread, softness, band colour and height; line brightness is static, no `flash`); `vignetteUniforms(scene, p)`. `createSkyPass(gl, deps)` implements `drawBack` (gradient, stars) and `drawFront` (horizon line then vignette). Hard rule: no per-frame allocations in `draw`.

## 7. Governor, reduced motion, safety

Quality flags (`synthQuality(level, flags)`, level 0..2 from the existing `GOV_TO_TERRAIN` mapping `[2,1,1,0]`, `flags = { lite, half, hiDpr }`):

| Level | `starsAnimated` | `hazeMotion` | `sliceDetail` | `cellMul` | `glowPasses` | `reflBlur` | `dprCap` |
|---|---|---|---|---|---|---|---|
| 2 | on | on | full (smooth edges, all slices) | 1 | 2 | on | 1.5 (2 at pace rung 3) |
| 1 | off | off | full | 1 | 2 | on | 1.5 |
| 0 | off | off | halved slice count, stepped edges | 2 | 1 | off | 1 |

`lite` forces `starsAnimated` and `hazeMotion` off, `glowPasses` to 0 and `reflBlur` off at any level. Degradation order is exactly VIZ-090: stars and haze motion, then slice detail, then grid LOD (`cellMul`), then half rate (pacer, outside the shell). Reduced motion: one static frame, `scene.time = 0`, no scroll, no haze or slice drift, no twinkle, constant `signal`; the mode stays selectable and the canvas stays `aria-hidden`. The canvas redraws the static frame on resize, settings change and quality change.

Flash safety: only `signal.flash` modulates brightness; sun and haze gain at most 15%, peak edges at most 25%; never full-screen luminance steps.

## 8. Fallback and failure

No WebGL: `availableModes` hides the mode (R1). `createSynth` returns `null` on context or shader failure; `createModeRenderer` then falls back to `bars`, as Terrain does. Context loss: shell stops drawing, restore calls `rebuild()` on every pass. Below the lowest rung (R3, integrator): when the pace governor is at half rate with `lite` and its ban for that rung has doubled to the 120 s maximum (twice in a row), `viz-canvas.js` switches the live renderer to `terrain` for the session without changing `ap2.viz.mode`, and announces "Synthwave terrain is too heavy here, using Terrain" in the live region. Warm-up grace and bans apply unchanged (VIZ-061).

## 9. Tests

Pure functions: deterministic fixtures, no GL (builders). Shell and passes: fake GL context in the style of `viz-terrain.test.mjs` (`createSynth(canvas, { gl: fake })`: creates programs, draws in the order of section 4, survives lost and restored, dispose frees, `null` without a context). Settings: every field repaired from garbage, round trip, Reset, preset behaviour. Panel: names, keyboard, hotkey isolation. Integrator adds: mode registration tests, `vizMode` with `synthwave`, share round trip `viz=synthwave`, and runs `scripts/check.sh` (Node via WSL).

Open questions carried from the task (not blocking, defaults proposed above): A horizon properties enough; B defaults picked in the browser; C future silhouette values (proposed 0.25 opacity, 0.6 distance, line); D share links carry only the mode; F equaliser city out of scope; G slice and haze defaults from VIZ-083 and VIZ-084 used.

## 10. Contract changes (append-only)

Builders and the integrator append one line per interface change: `YYYY-MM-DD HH:MM owner file: change (who must react)`. Never edit or delete earlier lines.

- (none yet)
- 2026-10-15 refactorer viz-canvas.js: createSynth and getSynthVersion are read from deps (d.createSynth, d.getSynthVersion), not imported; integrator must wire defaults() to viz-synth-gl.js and viz-synth-settings.js once they exist (integrator)
- 2026-10-15 refactorer viz-modes.js: createModeRenderer takes deps.factories; isSceneMode and usesFlight exported; panelSections gained synth (integrator)
- 2026-10-15 sky viz-synth-sky.js: createSkyPass params is the whole settings object (reads .sky and .sun); scene needs w, h (css px), dpr, aspect, res, horizonV, time, reduced, q.starsAnimated; uniform builders accept an optional out object (shell: call drawBack/drawFront after setting gl.viewport; passes disable depth and blending on exit, vignette uses blendFunc(ZERO, SRC_COLOR); horizon band sits above the line) (ui shell)
- 2026-10-15 sun viz-synth-sun.js: advancePhase returns `{ slice, haze }` (optional 6th arg `out` to reuse); the pass keeps its own phase and steps it once per distinct `scene.time` using `scene.dt`, `scene.q`, `scene.reduced` (shell: just pass scene each frame) (ui)
- 2026-10-15 sun viz-synth-sun.js: reads `q.sliceDetail` as halved when `'half'`, `'low'` or `false` (anything else is full), `q.hazeMotion === false` freezes phase, `q.reflBlur === false` hardens ripple and edges; the pass tolerates hex strings or `[r,g,b]` colours and does not import `parseHex` (ui: keep quality flag values compatible)
- 2026-10-15 sun viz-synth-sun.js: pass exposes `drawHaze`, `drawSun`, `drawReflection`, plus `draw` (all three), `resize`, `rebuild`, `dispose`, `stats {draws, uploads, rebuilds, programs}`; each draw sets depth off, enables additive (haze, reflection) or alpha blend (sun) and disables BLEND afterwards; `params` is `settings.sun` (shell)
- 2026-10-15 ui viz-synth-gl.js: per frame the shell calls `ground.setHeights(st)` with `st = { heights: Float32Array(rows*cols) (output of fillSynthHeights, row 0 = far, row rows-1 = camera side), future: Float32Array|null, futureRows, rows, cols, base, frac, pos (seconds, (base+frac)*dt), dz, dt, t }` (rows and cols from `gridDims(level, aspect)`, same layout as Terrain), then `ground.drawHills(scene, settings, signal)`, `drawFloor`, `drawTerrain` where `params` is the WHOLE settings object (read `.terrain`, `.sky`, `.sun`; build `skyColors(settings.sky, settings.sun)` yourself); the shell reads optional `ground.stats.tiers` and `.vertices`; `scene.q.level` is the governor level 0..2, `scene.time` is seconds frozen at 0 when reduced (terrain)
- 2026-10-15 ui viz-synth-gl.js: passes are created with `createXPass(gl, { linkProgram })` (linkProgram from viz-terrain-gl.js), resized with `resize(cssW, cssH, dpr)`; the GL context is requested with `depth: true`; beats (`timelineBeats`, `createLiveBeats`) are NOT fed since `fillSynthHeights` takes only the frame (terrain, integrator)
- 2026-10-15 ui viz-synth-settings.js: presets also set `sky.hColor` (cyan keeps `#ff4fd8`, pink `#ff4fb8`, blue `#3d7bff`, magenta `#ff2bd6`); blue face `#9db8ff`, pink face `#4a0b3a`, magenta face `#2a0030` (all)
- 2026-10-15 ui viz-synth-quality.js: flags are `{ level, lite, half, starsAnimated, hazeMotion, sliceDetail: 'full'|'low', sliceScale, sliceStepped, cellMul, glowPasses, reflBlur, dprCap }`; level 0 sets `sliceDetail 'low'` (sun reads it as halved) (sun, terrain)
- 2026-10-15 ui viz-synth-gl.js: CORRECTION of the earlier setHeights line: the shell calls the real signature `ground.setHeights(lat, scrollRows, scene, settings)` with `lat = { rows, cols, hw, dz, data, future }` (future is a `rows`=futureLayout(...).n by `cols` subarray or null) and `scrollRows = base + frac`; stats read from `ground.stats.tiers` and `.vertices` (terrain)
- 2026-10-15 terrain viz-synth-ground.js: `setHeights(st)` takes the shell's `st` as is and only stores it; the resample, light and upload happen lazily inside `drawTerrain` (it needs scene and params); `st.heights` rows run 0 = camera side (z = 0) to rows-1 = far (z = GRID_DEPTH), the same as `rowZ`, NOT far-first as the shell comment says (ui: fix the comment only); `st.future` is read as `futureRows x cols` from index 0 (as the shell already writes it) (ui)
- 2026-10-15 terrain viz-synth-ground.js: `params` of `drawHills/drawFloor/drawTerrain` is the whole settings object (reads `.terrain`, `.sky`, `.sun`); needs `scene.{aspect,res,horizonV,dpr,time,reduced,q.cellMul,q.glowPasses}` and a context with `depth: true`; `drawTerrain` clears the depth buffer itself; `groundUniforms` also returns `cam`, `speed`, `flash`; `scrollOf(tMs, speed, reduced)` has a third arg; `hillsPolyline` takes the seed from `sky.starSeed` (ui, integrator)
- 2026-10-15 terrain viz-synth-ground.js: `terrain.speed` is a z-stretch of the whole relief about the now row (the row clock stays at ROWS_PER_SECOND, so audio alignment is unchanged); line width above 1.5 px and glow are drawn as offset repeats of GL lines (no ribbons), glow rings = `q.glowPasses` (max 2), `q.cellMul` > 1 coarsens the mesh and lowers the LOD level (ui, quality)
- 2026-10-15 terrain viz-synth-field.js: added `futureLayout(rows, p) -> { row0, n, dz }` and an optional 6th arg `src` to `futureHeights` (an already filled field, avoids recomputation); `fadeDecay(fade)` returns `1 / fade` but `fillBeatHeights` has `BEAT_DECAY_S` hard-coded and the shell does not feed beats, so `fade` has no effect until the integrator decides how to apply it (e.g. pass `fadeDecay(fade)` as a time scale to a beat helper) (integrator)
- 2026-10-15 terrain viz-synth-mesh.js: `buildMesh` result also has `rows`, `cols`, `vertices`; mesh `z` is relative to the now row (`(r + jz0) * dz`), the pass adds `NOW_Z - fracT * dz * speed` per tier; tiers are non-nested bands, so `tierWeight` blending is not used (ground)
- 2026-10-15 integrator viz-synth-ground.js: `setHeights` accepts the shell call `(lat, scrollRows, scene, settings)` as well as the single `st` form (the shell's 4-arg form is the one in use; the ground builder only handled `st`, so nothing drew); viz-canvas.js: `createSynth` and `getSynthVersion` are wired in `defaults()`, `onNotice` announces the Terrain fallback (VIZ-090, section 8 rule implemented as: half rate, lite and still over budget for 4 s); viz-panel.js mounts `createSynthPanel`; `fade` still has no effect (no beats fed)
