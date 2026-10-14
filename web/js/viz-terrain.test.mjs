import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gridDims, GRID_MAX_VERTICES, lodTiers, makeTierPlan, resampleTier, tierHalfWidth, LOD_MAX_SPACING, QUALITY, clamp01, smoothstep, qualityFor, resample, createHistory, columnBin, edgeFalloff, heightAt, fillHeights,
  gridCounts, buildGridVertices, buildLineIndices, buildDepthIndices, buildCrossIndices, energyOf, easeEnergy, GRID_DEPTH, colorRamp, fillColors, horizonGlow, makeStars, cameraAt, horizonY,
  camClamp, camFormat, camParse, defaultPitchDeg, smoothHeights, CAM_LIMITS, nearEnvelope, rowZ, halfWidthAt, columnX, EYE_HEIGHT,
  mat4Perspective, mat4LookAt, mat4Multiply, transformPoint, makeRowClock, SHAKE_MAX, RAMP,
  SHAKE_ENABLED, CROSS_H0, CROSS_H1, crossAlpha, WORLD_SPEED, NOW_Z, NOW_GAIN, NOW_FALLOFF_S, rowLayout, nowZOf, ridgeZ, createFrame, createSeries, fillLookFrame, fillLiveFrame, sampleTimeline, blendFrames,
} from './viz-terrain-math.js';
import { FAR_FLAT_START, gridHalfWidth, yawStepOf } from './viz-terrain-math.js';
import { createTerrain, isWebGLAvailable, linkProgram, TERRAIN_MAX_DPR } from './viz-terrain-gl.js';
import { MODES, pickMode, nextMode, availableModes, createModeRenderer, modeLabel } from './viz-modes.js';

const DEFAULT_PITCH_ABS = 13.5;
const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('smoothstep and clamp01 are bounded and NaN safe', () => {
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  near(smoothstep(0, 1, 0.5), 0.5);
});

test('qualityFor clamps and defaults', () => {
  assert.equal(qualityFor(0), QUALITY[0]);
  assert.equal(qualityFor(9), QUALITY[2]);
  assert.equal(qualityFor(NaN), QUALITY[1]);
  assert.deepEqual(QUALITY.map((q) => q.spacing), [1, 0.6, 0.4]);
  assert.deepEqual([40, 59, 101].map((r, i) => gridDims(i, 16 / 9).rows), [41, 68, 101]);
});

test('resample interpolates and handles empties', () => {
  const r = resample([0, 1], 3);
  near(r[1], 0.5);
  assert.equal(resample([], 4).length, 4);
  assert.equal(resample(null, 4)[0], 0);
  assert.equal(resample([0.5], 3)[2], 0.5);
  assert.equal(resample([NaN, 2], 2)[1], 1);
});

test('history ring buffer wraps and orders oldest first', () => {
  const h = createHistory(3, 2);
  for (let i = 1; i <= 5; i += 1) h.push([i / 10, i / 10]);
  near(h.row(0)[0], 0.3);
  near(h.row(1)[0], 0.4);
  near(h.row(2)[0], 0.5);
  assert.equal(h.head, 2);
  h.clear();
  assert.equal(h.row(2)[0], 0);
});

test('history before full has zero rows first', () => {
  const h = createHistory(4, 2);
  h.push([1, 1]);
  assert.equal(h.row(0)[0], 0);
  assert.equal(h.row(3)[0], 1);
});

test('height function stays in 0..1 and falls off at the sides', () => {
  for (const v of [-1, 0, 0.3, 1, 5, NaN]) {
    for (let x = -1; x <= 1; x += 0.25) {
      const h = heightAt(v, x, 3, 12.5);
      assert.ok(h >= 0 && h <= 1, `h=${h}`);
    }
  }
  assert.ok(heightAt(1, 0) > heightAt(1, 0.95));
  near(edgeFalloff(1), 0);
  near(edgeFalloff(0), 1);
});

test('silence still rolls gently via the sine swell', () => {
  const a = heightAt(0, 0, 0, 0);
  const b = heightAt(0, 0, 10, 0);
  assert.ok(a > 0 || b > 0);
  assert.notEqual(a, b);
  assert.equal(heightAt(0, 0, 0, 0, { swellAmp: 0 }), 0);
});

test('column to bin is monotonic from bass on the left to highs on the right, no mirroring', () => {
  assert.equal(columnBin(0, 5, 64), 0);
  assert.equal(columnBin(4, 5, 64), 63);
  for (let c = 1; c < 9; c += 1) assert.ok(columnBin(c, 9, 64) > columnBin(c - 1, 9, 64));
  const hist = createHistory(2, 8);
  hist.push([1, 0.8, 0.6, 0.4, 0.2, 0.1, 0, 0]);
  const out = fillHeights(hist, 9, 0, new Float32Array(18), { swellAmp: 0 });
  assert.ok(out[2 * 9 - 9 + 1] !== out[2 * 9 - 9 + 7]);
  assert.ok(out[10] > out[16]);
});

test('fillHeights writes rows x cols values in range', () => {
  const hist = createHistory(4, 8);
  hist.push(new Array(8).fill(1));
  const out = fillHeights(hist, 5, 0, new Float32Array(20));
  assert.ok(out.every((v) => v >= 0 && v <= 1));
  assert.ok(out[3 * 5 + 2] > out[0 * 5 + 2]);
});

test('grid vertex and index counts per quality', () => {
  for (let l = 0; l < QUALITY.length; l += 1) {
    const { rows, cols } = gridDims(l, 16 / 9);
    const c = gridCounts(rows, cols);
    assert.equal(buildGridVertices(rows, cols).length, c.vertices * 2);
    assert.equal(buildLineIndices(rows, cols).length, c.segments * 2);
  }
  assert.equal(gridCounts(72, 56).segments, 72 * 55 + 56 * 71);
});

test('line indices are valid and unique per segment', () => {
  const idx = buildLineIndices(4, 3);
  assert.ok(idx.every((i) => i >= 0 && i < 12));
  const seen = new Set();
  for (let i = 0; i < idx.length; i += 2) {
    const key = `${Math.min(idx[i], idx[i + 1])}-${Math.max(idx[i], idx[i + 1])}`;
    assert.ok(!seen.has(key));
    seen.add(key);
  }
  assert.ok(buildLineIndices(300, 300) instanceof Uint32Array);
});

test('grid vertices span x -1..1 and row indices', () => {
  const v = buildGridVertices(3, 3);
  assert.deepEqual([...v.slice(0, 2)], [-1, 0]);
  assert.deepEqual([...v.slice(-2)], [1, 2]);
});

test('colour ramp endpoints and monotone brightness', () => {
  const lo = colorRamp(0);
  const hi = colorRamp(1);
  RAMP[0].c.forEach((c, i) => near(lo[i], c));
  RAMP[2].c.forEach((c, i) => near(hi[i], c));
  const sum = (c) => c[0] + c[1] + c[2];
  assert.ok(sum(colorRamp(0.5)) > sum(lo));
  assert.ok(sum(hi) > sum(colorRamp(0.5)));
  const out = fillColors([0, 1], new Float32Array(6));
  near(out[3], RAMP[2].c[0]);
});

test('horizon glow follows bass within bounds', () => {
  assert.ok(horizonGlow(0) < horizonGlow(1));
  assert.equal(horizonGlow(5), 1);
  assert.ok(horizonGlow(NaN) > 0);
});

test('stars are deterministic per seed', () => {
  assert.deepEqual(makeStars(7, 10), makeStars(7, 10));
  assert.notDeepEqual(makeStars(7, 10), makeStars(8, 10));
  assert.ok(makeStars(1, 50).every((v) => v >= -1 && v <= 1));
});

test('mat4 perspective known values', () => {
  const m = mat4Perspective(Math.PI / 2, 2, 1, 3);
  near(m[0], 0.5);
  near(m[5], 1);
  near(m[10], -2);
  near(m[11], -1);
  near(m[14], -3);
});

test('mat4 lookAt maps eye to origin and target onto -z', () => {
  const m = mat4LookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const e = transformPoint(m, [0, 0, 5]);
  near(e[0], 0); near(e[1], 0); near(e[2], 0);
  const t = transformPoint(m, [0, 0, 0]);
  near(t[2], -5);
  const side = transformPoint(m, [1, 0, 0]);
  near(side[0], 1);
});

test('mat4 multiply with identity-like and composition', () => {
  const p = mat4Perspective(1, 1.5, 0.1, 50);
  const v = mat4LookAt([1, 2, 3], [0, 0, 0], [0, 1, 0]);
  const mvp = mat4Multiply(p, v);
  const w = transformPoint(mvp, [0, 0, 0]);
  const a = transformPoint(v, [0, 0, 0]);
  const b = transformPoint(p, a.slice(0, 3));
  w.forEach((c, i) => near(c, b[i], 1e-4));
});

test('camera path is deterministic and shake is clamped', () => {
  assert.deepEqual(cameraAt(12.5, 0.4), cameraAt(12.5, 0.4));
  const calm = cameraAt(3.3, 0);
  const loud = cameraAt(3.3, 50);
  assert.equal(loud.eye[0], 0);
  assert.equal(calm.eye[0], 0);
  assert.equal(loud.target[0], 0);
  assert.ok(Math.abs(loud.eye[1] - calm.eye[1]) <= SHAKE_MAX + 1e-9);
  assert.ok(cameraAt(0).eye[2] >= cameraAt(30).eye[2]);
  const y = horizonY(cameraAt(5, 0.5));
  assert.ok(y >= 0.05 && y <= 0.95);
});

test('row clock pushes at about 24 rows per second and catches up bounded', () => {
  const c = makeRowClock(24);
  assert.deepEqual(c.advance(1000), { pushes: 1, frac: 0 });
  assert.equal(c.advance(1010).pushes, 0);
  assert.equal(c.advance(1045).pushes, 1);
  assert.equal(c.advance(5000).pushes, 4);
  assert.equal(c.advance(5001).pushes, 0);
  assert.equal(c.advance(10).pushes, 1);
  c.reset();
  assert.equal(c.advance(77).pushes, 1);
});

function fakeGL({ fboOk = true, linkOk = true } = {}) {
  const calls = [];
  const live = new Set();
  const consts = new Map();
  const gl = new Proxy({}, {
    get(_t, name) {
      if (name === 'calls') return calls;
      if (name === 'live') return live;
      if (/^[A-Z0-9_]+$/.test(name)) {
        if (!consts.has(name)) consts.set(name, consts.size + 1);
        return consts.get(name);
      }
      return (...args) => {
        calls.push([name, ...args]);
        if (name.startsWith('create')) {
          const o = { kind: name.slice(6) };
          live.add(o);
          return o;
        }
        if (name.startsWith('delete')) { live.delete(args[0]); return undefined; }
        if (name === 'getShaderParameter') return true;
        if (name === 'getProgramParameter') return linkOk;
        if (name === 'getProgramInfoLog') return 'link boom';
        if (name === 'checkFramebufferStatus') return fboOk ? consts.get('FRAMEBUFFER_COMPLETE') ?? gl.FRAMEBUFFER_COMPLETE : 0;
        if (name === 'getUniformLocation') return { name: args[1] };
        return undefined;
      };
    },
  });
  return gl;
}

function fakeCanvas() {
  const handlers = {};
  return {
    width: 300,
    height: 150,
    handlers,
    addEventListener(n, f) { handlers[n] = f; },
    removeEventListener(n) { delete handlers[n]; },
    getContext() { return null; },
  };
}

const tiersOf = (l, aspect) => lodTiers(l, aspect, nowZOf(gridDims(l, aspect).rows));
const count = (gl, name) => gl.calls.filter((c) => c[0] === name).length;

test('createTerrain compiles programs, creates buffers and draws expected counts', () => {
  const gl = fakeGL();
  const t = createTerrain(fakeCanvas(), { gl, quality: 1 });
  const tiers = tiersOf(1, 2);
  assert.equal(count(gl, 'createProgram'), 4);
  assert.equal(count(gl, 'createBuffer'), 2 + 11 * tiers.length);
  assert.equal(t.bloomActive, false);
  t.draw(new Array(64).fill(0.6), 1000);
  const elems = gl.calls.filter((c) => c[0] === 'drawElements');
  assert.equal(elems.length, 2 * tiers.length);
  tiers.forEach((tr, i) => {
    assert.equal(elems[2 * i][2], tr.cols * (tr.rows - 1) * 6);
    assert.equal(elems[2 * i + 1][2], tr.rows * (tr.cols - 1) * 6);
  });
  const arrays = gl.calls.filter((c) => c[0] === 'drawArrays');
  tiers.forEach((tr) => assert.ok(arrays.some((c) => c[1] === gl.POINTS && c[3] === tr.rows * tr.cols)));
  assert.ok(arrays.some((c) => c[1] === gl.POINTS && c[3] === 90));
  assert.equal(count(gl, 'bufferSubData'), 4 * tiers.length);
});

test('segments are about 8k at the default quality', () => {
  const n = gridCounts(72, 56).segments;
  assert.ok(n > 7500 && n < 8500);
});

test('quality switch rebuilds the grid and bloom only at level 2', () => {
  const gl = fakeGL();
  const t = createTerrain(fakeCanvas(), { gl, quality: 0 });
  t.draw([], 0);
  const t0 = tiersOf(0, 2);
  assert.equal(count(gl, 'drawElements'), 2 * t0.length);
  assert.equal(gl.calls.find((c) => c[0] === 'drawElements')[2], t0[0].cols * (t0[0].rows - 1) * 2);
  t.setQuality(2);
  assert.equal(t.quality, 2);
  assert.equal(t.bloomActive, true);
  assert.equal(count(gl, 'createFramebuffer'), 2);
  gl.calls.length = 0;
  t.draw([0.5], 50);
  const t2 = tiersOf(2, 2);
  assert.equal(count(gl, 'drawElements'), 4 * t2.length);
  assert.ok(gl.calls.some((c) => c[0] === 'drawElements' && c[2] === t2[0].cols * (t2[0].rows - 1) * 6));
  t.setQuality(0);
  assert.equal(t.bloomActive, false);
  t.dispose();
});

test('bloom is skipped when the framebuffer is incomplete', () => {
  const gl = fakeGL({ fboOk: false });
  const t = createTerrain(fakeCanvas(), { gl, quality: 2 });
  assert.equal(t.bloomActive, false);
  t.draw([0.5], 0);
  assert.equal(count(gl, 'drawElements'), 2 * tiersOf(2, 2).length);
});

test('dispose deletes every GL object and ignores later draws', () => {
  const gl = fakeGL();
  const c = fakeCanvas();
  const t = createTerrain(c, { gl, quality: 2 });
  assert.ok(gl.live.size > 0);
  t.dispose();
  assert.equal(gl.live.size, 0);
  assert.equal(Object.keys(c.handlers).length, 0);
  gl.calls.length = 0;
  t.draw([1], 0);
  assert.equal(gl.calls.length, 0);
  t.dispose();
});

test('context loss stops drawing and restore recreates resources', () => {
  const gl = fakeGL();
  const c = fakeCanvas();
  const t = createTerrain(c, { gl, quality: 1 });
  let prevented = false;
  c.handlers.webglcontextlost({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(t.lost, true);
  gl.calls.length = 0;
  t.draw([1], 0);
  assert.equal(gl.calls.length, 0);
  const before = count(gl, 'createProgram');
  c.handlers.webglcontextrestored();
  assert.equal(t.lost, false);
  assert.equal(count(gl, 'createProgram'), before + 4);
  t.draw([1], 100);
  assert.equal(count(gl, 'drawElements'), 2 * tiersOf(1, 2).length);
});

test('resize caps dpr at TERRAIN_MAX_DPR and allows 2 only after setDprCap', () => {
  const gl = fakeGL();
  const c = fakeCanvas();
  const t = createTerrain(c, { gl });
  t.resize(400, 200, 3);
  assert.equal(c.width, 600);
  assert.equal(c.height, 300);
  assert.equal(t.stats.dpr, TERRAIN_MAX_DPR);
  t.setDprCap(true);
  assert.equal(c.width, 800);
  assert.equal(t.stats.dpr, 2);
  t.setDprCap(false);
  assert.equal(c.width, 600);
});

const timelineOf = (secs) => ({ bins: 64, rps: 16, total: 16 * secs, done: 16 * secs, data: new Uint8Array(16 * secs * 64).fill(120) });

test('with a finished timeline the heights are uploaded only when a row boundary is crossed', () => {
  const gl = fakeGL();
  const t = createTerrain(fakeCanvas(), { gl, quality: 1 });
  const tl = timelineOf(60);
  const dtRow = 40 / (gridDims(1, 2).rows - 1) / 5.5;
  assert.ok(dtRow > 0);
  for (let i = 0; i < 40; i += 1) t.draw(new Array(64).fill(0.3), i * 33, { timeline: tl, time: 20.013 });
  gl.calls.length = 0;
  for (let i = 0; i < 5; i += 1) t.draw(new Array(64).fill(0.3), 2000 + i * 33, { timeline: tl, time: 20.013 + i * 0.00002 });
  assert.equal(count(gl, 'bufferSubData'), 0);
  t.draw(new Array(64).fill(0.3), 3000, { timeline: tl, time: 20.013 + 3 * dtRow });
  assert.ok(count(gl, 'bufferSubData') > 0);
});

test('lite mode skips the bloom and mist passes, and uniforms are not re-sent when unchanged', () => {
  const gl = fakeGL();
  const t = createTerrain(fakeCanvas(), { gl, quality: 2 });
  t.draw(new Array(64).fill(0.5), 1000);
  const full = count(gl, 'drawArrays');
  gl.calls.length = 0;
  t.draw(new Array(64).fill(0.5), 1033);
  const second = count(gl, 'uniform1f');
  const fullAgain = count(gl, 'drawArrays');
  t.setLite(true);
  gl.calls.length = 0;
  t.draw(new Array(64).fill(0.5), 1066);
  assert.ok(count(gl, 'drawArrays') < fullAgain);
  assert.ok(full > 0 && second > 0);
  gl.calls.length = 0;
  t.draw(new Array(64).fill(0.5), 1099);
  const third = count(gl, 'uniform1f');
  assert.ok(third < second);
  assert.equal(t.stats.lite, true);
  assert.ok(t.stats.tiers >= 3 && t.stats.vertices > 1000);
});

test('link failure reports an error and returns null', () => {
  const gl = fakeGL({ linkOk: false });
  let err = null;
  const t = createTerrain(fakeCanvas(), { gl, onError: (e) => { err = e; } });
  assert.equal(t, null);
  assert.match(err.message, /link boom/);
  assert.throws(() => linkProgram(gl, 'a', 'b', []), /link boom/);
});

test('createTerrain returns null without a context', () => {
  assert.equal(createTerrain(fakeCanvas()), null);
});

test('isWebGLAvailable checks getContext and survives errors', () => {
  const yes = { createElement: () => ({ getContext: () => ({}) }) };
  const no = { createElement: () => ({ getContext: () => null }) };
  const boom = { createElement: () => { throw new Error('x'); } };
  assert.equal(isWebGLAvailable(yes), true);
  assert.equal(isWebGLAvailable(no), false);
  assert.equal(isWebGLAvailable(boom), false);
  assert.equal(isWebGLAvailable(undefined), false);
});

test('mode list, labels, migration and cycle respect WebGL capability', () => {
  assert.deepEqual(MODES.map((m) => m.id), ['bars', 'ring', 'terrain']);
  assert.deepEqual(MODES.map((m) => m.label), ['Mirrored spectrum', 'Ring', 'Terrain']);
  const gl = { webgl: true };
  const no = { webgl: false };
  const table = [
    ['terrain', gl, 'terrain'], ['terrain', no, 'bars'], ['ring', no, 'ring'], ['bars', gl, 'bars'],
    ['bars-ring', gl, 'bars'], ['bars-ring', no, 'bars'], ['combo', gl, 'terrain'], ['combo', no, 'bars'],
    ['nope', gl, 'bars'], [null, null, 'bars'],
  ];
  for (const [saved, caps, want] of table) assert.equal(pickMode(saved, caps), want, `${saved}/${caps?.webgl}`);
  assert.equal(nextMode('bars', gl), 'ring');
  assert.equal(nextMode('ring', gl), 'terrain');
  assert.equal(nextMode('terrain', gl), 'bars');
  assert.equal(nextMode('ring', no), 'bars');
  assert.equal(nextMode('bars', no), 'ring');
  assert.equal(nextMode('unknown', gl), 'bars');
  assert.equal(availableModes(no).length, 2);
  assert.equal(modeLabel('bars'), 'Mirrored spectrum');
});

test('mode renderer facade dispatches and falls back', () => {
  const log = [];
  const terrain = {
    draw: (s, t) => log.push(['gl', t]),
    resize: (...a) => log.push(['resize', ...a]),
    setQuality: (q) => log.push(['q', q]),
    dispose: () => log.push(['dispose']),
  };
  const deps = { createTerrain: () => terrain, draw2d: (s, t) => log.push(['2d', t]) };
  const c2 = {};
  const cg = {};
  const only = createModeRenderer('terrain', c2, cg, deps);
  only.draw([], 1);
  only.setQuality(3);
  only.setQuality(0);
  only.setQuality(1);
  only.setQuality(2);
  only.resize(10, 20, 2);
  only.dispose();
  assert.deepEqual(log, [['gl', 1], ['q', 0], ['q', 2], ['q', 1], ['q', 1], ['resize', 10, 20, 2], ['dispose']]);
  assert.equal(c2.hidden, true);
  assert.equal(cg.hidden, false);

  log.length = 0;
  const ring = createModeRenderer('ring', c2, cg, deps);
  ring.draw([], 2);
  assert.deepEqual(log, [['2d', 2]]);
  assert.equal(ring.id, 'ring');
  assert.equal(c2.hidden, false);
  assert.equal(cg.hidden, true);

  log.length = 0;
  const fb = createModeRenderer('terrain', c2, cg, { createTerrain: () => null, draw2d: () => log.push(['2d']) });
  assert.equal(fb.id, 'bars');
  assert.equal(fb.usesGL, false);
  fb.draw([], 0);
  fb.setQuality(1);
  assert.deepEqual(log, [['2d']]);
  assert.equal(cg.hidden, true);

  const flat = createModeRenderer('bars', c2, null, { draw2d: () => {} });
  assert.equal(flat.id, 'bars');
});

test('depth and cross indices split the line set', () => {
  assert.equal(buildDepthIndices(4, 3).length, 3 * 3 * 2);
  assert.equal(buildCrossIndices(4, 3).length, 4 * 2 * 2);
  assert.equal(buildLineIndices(4, 3).length, buildDepthIndices(4, 3).length + buildCrossIndices(4, 3).length);
  const d = buildDepthIndices(4, 3);
  for (let i = 0; i < d.length; i += 2) assert.equal(d[i + 1] - d[i], 3);
});

test('energy follows loudness, attacks fast and releases slowly', () => {
  assert.equal(energyOf([]), 0);
  assert.ok(energyOf(new Array(64).fill(0.8)) > energyOf(new Array(64).fill(0.1)));
  assert.ok(energyOf(new Array(64).fill(5)) <= 1);
  const up = easeEnergy(0, 1, 0.1);
  const down = 1 - easeEnergy(1, 0, 0.1);
  assert.ok(up > down);
  assert.equal(easeEnergy(0.3, 1, 0), 0.3);
});

test('quality levels scale smoke and line passes, smoke off at the lowest', () => {
  assert.equal(QUALITY[0].smoke, 0);
  assert.ok(QUALITY[1].smoke > 0 && QUALITY[2].smoke >= QUALITY[1].smoke);
  assert.ok(QUALITY[0].soft < QUALITY[1].soft && QUALITY[1].soft <= QUALITY[2].soft);
});

test('camera defaults: eye 3.31, pitch -13.5, horizon high, no lateral motion', () => {
  assert.equal(EYE_HEIGHT, 3.31);
  assert.equal(defaultPitchDeg(), -13.5);
  for (const t of [0, 7, 31]) {
    const cam = cameraAt(t, 0);
    assert.ok(cam.eye[1] > 3.2 && cam.eye[1] < 3.4);
    assert.equal(cam.eye[0], 0);
    near(cameraAt(t, 0, { fly: 0 }).eye[2], 0.7);
    const y = horizonY(cam);
    assert.ok(y > 0.5 && y < 0.9, `horizon ${y}`);
  }
  assert.ok(CAM_LIMITS.eye[0] <= 3.31 && CAM_LIMITS.eye[1] >= 3.31);
  assert.ok(CAM_LIMITS.pitch[0] <= -13.5 && CAM_LIMITS.pitch[1] >= -13.5);
});

function project(aspect, x, z, y = 0) {
  const cam = cameraAt(0, 0);
  const vp = mat4Multiply(mat4Perspective(cam.fov, aspect, 0.3, 160), mat4LookAt(cam.eye, cam.target, cam.up));
  const p = transformPoint(vp, [x, y, -z]);
  return [p[0] / p[3], p[1] / p[3]];
}

test('rows are uniformly spaced in world units and reach the horizon depth', () => {
  for (const rows of [40, 64, 88]) {
    near(rowZ(0, rows), 0);
    near(rowZ(rows - 1, rows), GRID_DEPTH);
    const dz = rowZ(1, rows) - rowZ(0, rows);
    for (let r = 2; r < rows; r += 1) near(rowZ(r, rows) - rowZ(r - 1, rows), dz, 1e-9);
  }
});

test('the grid has a constant world width that covers the whole screen width at every visible depth', () => {
  const cam = cameraAt(0, 0);
  const bottomZ = Math.max(0, -(cam.eye[1] / Math.tan((62 / 2 + 10) * (Math.PI / 180)) - cam.eye[2]));
  for (const aspect of [0.46, 0.8, 1.33, 1.78, 2.4, 3.5]) {
    const w = halfWidthAt(1, aspect);
    assert.equal(halfWidthAt(30, aspect), w);
    for (const z of [bottomZ + 0.5, 3, 8, 14, 20, 28, 0.9 * GRID_DEPTH]) {
      assert.ok(Math.abs(project(aspect, w, z)[0]) > 1, `aspect ${aspect} z ${z} edge ${project(aspect, w, z)[0]}`);
      assert.ok(Math.abs(project(aspect, -w, z)[0]) > 1);
    }
      }
});

test('columns are uniform across the width and monotone', () => {
  assert.equal(columnX(0), -1);
  assert.equal(columnX(1), 1);
  assert.ok(Math.abs(columnX(0.5)) < 1e-12);
  const step = columnX(0.01) - columnX(0);
  for (let i = 1; i <= 100; i += 1) assert.ok(Math.abs(columnX(i / 100) - columnX((i - 1) / 100) - step) < 1e-9);
});

test('grid cells are square in world units at every level and aspect', () => {
  for (const aspect of [0.46, 1, 1.78, 2.4, 3.5]) {
    for (let l = 0; l < QUALITY.length; l += 1) {
      const d = gridDims(l, aspect);
      assert.ok(Math.abs(d.dx / d.dz - 1) < 0.04, `level ${l} aspect ${aspect}: dx ${d.dx} dz ${d.dz}`);
      assert.ok(d.rows * d.cols <= GRID_MAX_VERTICES);
      assert.ok(d.spacing >= QUALITY[l].spacing);
    }
  }
  assert.equal(gridDims(2, 16 / 9).spacing, 0.4);
  assert.ok(gridDims(0, 1.78).dz > gridDims(2, 1.78).dz);
});

test('uniform square cells: the nearest screen width holds more columns at each higher quality level', () => {
  const aspect = 1.78;
  const w = halfWidthAt(1, aspect);
  const cam = cameraAt(0, 0);
  const bottomZ = Math.max(0, -(cam.eye[1] / Math.tan((62 / 2 + 10) * (Math.PI / 180)) - cam.eye[2])) + 0.3;
  const counts = QUALITY.map((_, l) => {
    const { cols } = gridDims(l, aspect);
    let n = 0;
    for (let c = 0; c < cols; c += 1) if (Math.abs(project(aspect, columnX(c / (cols - 1)) * w, bottomZ)[0]) <= 1) n += 1;
    return n;
  });
  assert.ok(counts[0] >= 3 && counts[0] < counts[1] && counts[1] < counts[2], counts.join());
});

test('a ridge advances in world z linearly with time and keeps its height', () => {
  const rows = 88;
  const { dt, dz } = rowLayout(rows);
  const tl = { bins: 4, rps: 16, total: 16 * 60, done: 16 * 60, data: new Uint8Array(16 * 60 * 4) };
  const ridgeRow = 16 * 30;
  for (let j = 0; j < 4; j += 1) tl.data[ridgeRow * 4 + j] = 255;
  const frame = createFrame(rows, 4);
  const found = [];
  for (let k = 0; k <= 12; k += 1) {
    const now = 28 + k * 0.1;
    const { frac } = fillLookFrame(frame, tl, now);
    let best = -1;
    let sum = 0;
    let wz = 0;
    for (let r = 0; r < rows; r += 1) {
      const v = frame.row(r)[0];
      if (v > 0) { sum += v; wz += v * (r - frac) * dz; best = Math.max(best, v); }
    }
    found.push([now, wz / sum]);
    assert.ok(best > 0.2, `ridge visible at ${now}`);
  }
  for (let k = 1; k < found.length; k += 1) {
    const speed = (found[k][1] - found[k - 1][1]) / (found[k][0] - found[k - 1][0]);
    near(speed, -WORLD_SPEED, 0.35);
  }
  near(dz / dt, WORLD_SPEED, 1e-9);
});

test('the now row sits at a fixed z and the future is beyond it', () => {
  for (const rows of [40, 64, 88]) {
    const lay = rowLayout(rows);
    near(nowZOf(rows), lay.nowRow * lay.dz);
    assert.ok(Math.abs(nowZOf(rows) - NOW_Z) <= lay.dz / 2 + 1e-9);
    assert.ok(GRID_DEPTH - nowZOf(rows) > 4 * WORLD_SPEED - lay.dz);
  }
  near(ridgeZ(88, 12, 10), nowZOf(88) + 2 * WORLD_SPEED);
  near(ridgeZ(88, 10, 10), nowZOf(88));
});

test('live frame leaves the future flat and puts the newest row at now', () => {
  const rows = 40;
  const series = createSeries(256, 4);
  for (let i = 0; i < 16 * 12; i += 1) series.push([1, 1, 1, 1], i / 16);
  const frame = createFrame(rows, 4);
  const { nowRow } = rowLayout(rows);
  fillLiveFrame(frame, series, 191 / 16);
  assert.ok(frame.row(nowRow - 1)[0] > 0.9);
  for (let r = nowRow + 1; r < rows; r += 1) assert.equal(frame.row(r)[0], 0);
  assert.equal(frame.row(0)[0] > 0.9, true);
});

test('timeline sampling interpolates and returns calm outside the decoded range', () => {
  const tl = { bins: 2, rps: 10, total: 4, done: 3, data: new Uint8Array([0, 0, 255, 255, 51, 51, 200, 200]) };
  const out = new Float32Array(2);
  near(sampleTimeline(tl, 0.05, out)[0], 0.5);
  near(sampleTimeline(tl, 0.2, out)[0], 0.2);
  assert.equal(sampleTimeline(tl, 0.25, out)[0], 0);
  assert.equal(sampleTimeline(tl, -1, out)[0], 0);
});

test('series interpolates between pushed rows and holds the newest', () => {
  const s = createSeries(4, 1);
  for (let i = 0; i < 6; i += 1) s.push([i / 10], i);
  assert.equal(s.count, 4);
  const out = new Float32Array(1);
  near(s.sample(3.5, out)[0], 0.35);
  near(s.sample(99, out)[0], 0.5);
  assert.equal(s.sample(0, out)[0], 0);
});

test('blending frames moves from live to look', () => {
  const a = createFrame(1, 2);
  const b = createFrame(1, 2);
  b.data.fill(1);
  near(blendFrames(a, b, 0.25).data[0], 0.25);
});

test('cross lines appear only above about half a world unit of height', () => {
  assert.ok(CROSS_H0 < 0.5 && CROSS_H1 > 0.5 && CROSS_H1 - CROSS_H0 <= 0.25);
  assert.equal(crossAlpha(0), 0);
  assert.equal(crossAlpha(CROSS_H0), 0);
  assert.equal(crossAlpha(CROSS_H1), 1);
  assert.equal(crossAlpha(3), 1);
  near(crossAlpha(0.5), 0.5);
  assert.ok(crossAlpha(0.45) < crossAlpha(0.55));
});

test('the now glow is a named constant and the shader highlights it on every level', () => {
  assert.ok(NOW_GAIN > 0);
  assert.ok(NOW_FALLOFF_S > 0.2 && NOW_FALLOFF_S < 0.5);
});

test('camera overrides: eye and pitch move the camera and the horizon', () => {
  const base = cameraAt(5, 0);
  const high = cameraAt(5, 0, { eye: 3.9, pitchDeg: -5 });
  assert.ok(high.eye[1] > base.eye[1] + 0.3);
  assert.ok(horizonY(high) < horizonY(base));
  near(horizonY(cameraAt(5, 0, { pitchDeg: defaultPitchDeg() })), horizonY(base), 0.01);
});

test('camClamp, camFormat and camParse round-trip and clamp', () => {
  const c = camClamp({ eye: 99, pitch: -99 });
  assert.deepEqual([c.eye, c.pitch], [CAM_LIMITS.eye[1], CAM_LIMITS.pitch[0]]);
  assert.equal(camClamp({ eye: 'x' }).eye, camClamp({}).eye);
  assert.equal(camFormat({ eye: 0.62, pitch: -4.5 }), 'eye=0.62 pitch=-4.5deg yaw=0.0deg sync=0ms');
  assert.equal(camFormat({ eye: 3.31, pitch: -13.5, yaw: 12.34 }), 'eye=3.31 pitch=-13.5deg yaw=12.3deg sync=0ms');
  assert.deepEqual(camParse('eye=0.62 pitch=-4.5deg'), { eye: 0.62, pitch: -4.5, yaw: 0, sync: 0 });
  assert.deepEqual(camParse('eye=0.62 pitch=-4.5deg yaw=-12.5deg'), { eye: 0.62, pitch: -4.5, yaw: -12.5, sync: 0 });
  assert.equal(camClamp({ yaw: 99 }).yaw, 45);
  assert.equal(camClamp({ yaw: -99 }).yaw, -45);
  assert.equal(camClamp({ yaw: 'x' }).yaw, 0);
  assert.equal(camFormat({ eye: 3.31, pitch: -13.5, yaw: 0, sync: 120.4 }), 'eye=3.31 pitch=-13.5deg yaw=0.0deg sync=120ms');
  assert.equal(camParse('eye=3.31 pitch=-13.5deg yaw=0.0deg sync=-80ms').sync, -80);
  assert.equal(camParse('sync = 999').sync, 300);
  assert.equal(camParse('eye=3.31 pitch=-13.5deg yaw=1deg').sync, 0);
  assert.deepEqual(camParse('junk'), camClamp({}));
});

test('smoothHeights rounds a spike and keeps the mean roughly', () => {
  const a = new Float32Array(25);
  a[12] = 1;
  smoothHeights(a, 5, 5, 1);
  assert.ok(a[12] < 0.5 && a[11] > 0);
  assert.ok(Math.abs(a.reduce((x, y) => x + y) - 1) < 1e-5);
});

test('nearEnvelope calms the near field and reaches 1', () => {
  assert.ok(nearEnvelope(0) < 0.2);
  near(nearEnvelope(1), 1);
});

test('amplitude is baked into each row from its own spectrum, not from a global live energy', () => {
  const h = createFrame(3, 8);
  h.row(0).fill(0.2);
  h.row(1).fill(0.9);
  h.row(2).fill(0.2);
  const out = new Float32Array(3 * 4);
  fillHeights(h, 4, 0, out, { swellAmp: 0, smooth: 0, bakeAmp: true });
  const plain = new Float32Array(3 * 4);
  fillHeights(h, 4, 0, plain, { swellAmp: 0, smooth: 0 });
  assert.ok(out[4 + 1] / plain[4 + 1] > out[1] / plain[1]);
  assert.ok(out.every((v) => v >= 0 && v <= 1));
});

function capture(gl) {
  return gl.calls.filter((c) => c[0] === 'bufferSubData').map((c) => Float32Array.from(c[3]));
}

test('changing the live spectrum or energy does not change rows that already exist', () => {
  const tl = { bins: 64, rps: 16, total: 16 * 30, done: 16 * 30, data: new Uint8Array(16 * 30 * 64).fill(120) };
  const run = (live) => {
    const gl = fakeGL();
    const t = createTerrain(fakeCanvas(), { gl, quality: 1 });
    for (let i = 0; i < 80; i += 1) t.draw(new Array(64).fill(0), i * 33, { timeline: tl, time: 10 });
    gl.calls.length = 0;
    t.draw(live, 3000, { timeline: tl, time: 10.6 });
    return capture(gl)[0];
  };
  const quiet = run(new Array(64).fill(0));
  const loud = run(new Array(64).fill(1));
  assert.deepEqual(Array.from(quiet), Array.from(loud));
  assert.ok(quiet.some((v) => v > 0.05));
});

test('bass shake is kept but disabled by default and moves only the camera', () => {
  assert.equal(SHAKE_ENABLED, false);
  const still = cameraAt(1, 0);
  const shaken = cameraAt(1, 1);
  assert.ok(Math.abs(shaken.eye[1] - still.eye[1]) <= SHAKE_MAX * 1.01 + 1e-9);
  assert.deepEqual(shaken.eye.filter((_, i) => i !== 1), still.eye.filter((_, i) => i !== 1));
});

test('LOD tiers: square cells, exact doubling, contiguous depth and bounded vertices at every level and aspect', () => {
  for (const aspect of [0.46, 1, 1.78, 2.4, 3.5]) {
    for (let l = 0; l < QUALITY.length; l += 1) {
      const tiers = lodTiers(l, aspect);
      assert.equal(tiers[0].z0, 0);
      assert.equal(tiers[tiers.length - 1].z1, GRID_DEPTH);
      tiers.forEach((t, i) => {
        assert.equal(t.dx, t.dz);
        assert.ok(t.rows * t.cols <= GRID_MAX_VERTICES);
        assert.ok(t.spacing >= QUALITY[l].cell && t.spacing <= LOD_MAX_SPACING + 1e-9);
        assert.equal(t.cols % 2, 1);
        near(t.hw, ((t.cols - 1) / 2) * t.spacing, 1e-9);
        if (i > 0) {
          assert.equal(t.z0, tiers[i - 1].z1);
          assert.ok(t.spacing >= tiers[i - 1].spacing);
        }
      });
    }
  }
  assert.deepEqual(QUALITY.map((q) => q.cell), [0.35, 0.2, 0.12]);
  const t2 = lodTiers(2, 16 / 9);
  assert.deepEqual(t2.map((t) => t.spacing), [0.12, 0.24, 0.48, 0.96]);
  const total = t2.reduce((n, t) => n + t.rows * t.cols, 0);
  assert.ok(total < 40000, String(total));
  assert.ok(t2.every((t) => t.rows * t.cols * 2 <= 65535));
});

test('LOD tiers cover the screen width at every depth they draw', () => {
  const cam = cameraAt(0, 0);
  const bottomZ = Math.max(0, -(cam.eye[1] / Math.tan((62 / 2 + 10) * (Math.PI / 180)) - cam.eye[2]));
  for (const aspect of [0.46, 0.8, 1.33, 1.78, 2.4, 3.5]) {
    for (let l = 0; l < QUALITY.length; l += 1) {
      for (const t of lodTiers(l, aspect)) {
        for (const z of [Math.max(t.z0, bottomZ + 0.5), (t.z0 + t.z1) / 2, t.z1]) {
          if (z < bottomZ + 0.5 || z > 0.9 * GRID_DEPTH) continue;
          assert.ok(Math.abs(project(aspect, t.hw, z)[0]) > 1, `level ${l} aspect ${aspect} z ${z}`);
          assert.ok(Math.abs(project(aspect, -t.hw, z)[0]) > 1);
        }
      }
    }
    assert.ok(tierHalfWidth(10, aspect) <= halfWidthAt(1, aspect));
  }
});

test('the nearest screen width holds 60 to 90 cells at quality 2 and fewer at lower levels', () => {
  const aspect = 16 / 9;
  const cam = cameraAt(0, 0);
  const bottomZ = cam.eye[1] / Math.tan((62 / 2 + DEFAULT_PITCH_ABS) * (Math.PI / 180)) - cam.eye[2];
  const counts = QUALITY.map((_, l) => {
    const t = lodTiers(l, aspect)[0];
    let n = 0;
    for (let c = 0; c < t.cols; c += 1) if (Math.abs(project(aspect, (c - (t.cols - 1) / 2) * t.spacing, bottomZ)[0]) <= 1) n += 1;
    return n;
  });
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2], counts.join());
  assert.ok(counts[2] >= 60 && counts[2] <= 90, counts.join());
});

test('tier resampling reproduces a lattice field and keeps tier rows rigid in time', () => {
  const lat = gridDims(2, 16 / 9);
  const latInfo = { rows: lat.rows, cols: lat.cols, dz: lat.dz, hw: halfWidthAt(1, 16 / 9) };
  const nowZ = nowZOf(lat.rows);
  const field = (u, tAbs) => 0.4 + 0.3 * Math.sin(u * 0.35) * Math.cos(tAbs * 1.1);
  const fill = (pos) => {
    const out = new Float32Array(lat.rows * lat.cols);
    const base = Math.floor(pos);
    for (let r = 0; r < lat.rows; r += 1) {
      const tAbs = (base + r - rowLayout(lat.rows).nowRow) * rowLayout(lat.rows).dt;
      for (let c = 0; c < lat.cols; c += 1) out[r * lat.cols + c] = field(((c / (lat.cols - 1)) * 2 - 1) * latInfo.hw, tAbs);
    }
    return { out, frac: pos - base };
  };
  const tier = lodTiers(2, 16 / 9, nowZ)[0];
  const plan = makeTierPlan(latInfo, tier, nowZ);
  const dtL = rowLayout(lat.rows).dt;
  const dtT = tier.dz / WORLD_SPEED;
  const sample = (tSec) => {
    const lf = fill(tSec / dtL);
    const p = tSec / dtT;
    const baseT = Math.floor(p);
    const fracT = p - baseT;
    const dst = new Float32Array(tier.rows * tier.cols);
    resampleTier(plan, lf.out, dst, lf.frac, fracT, -2, 2);
    return { dst, baseT };
  };
  const a = sample(20.0);
  const b = sample(20.0 + 3.3 * dtT);
  const j = 40;
  const jb = j - 3;
  assert.equal(b.baseT - a.baseT, 3);
  for (const c of [10, 100, 200]) near(a.dst[j * tier.cols + c], b.dst[jb * tier.cols + c], 0.02);
  const z = nowZ + (j + tier.jz0 - (20 / dtT - Math.floor(20 / dtT))) * tier.dz;
  const tRow = 20 + (z - nowZ) / WORLD_SPEED;
  const c = 130;
  near(a.dst[j * tier.cols + c], field((c / (tier.cols - 1) * 2 - 1) * tier.hw, tRow), 0.02);
  assert.ok(a.dst.every((v) => v >= -2 && v <= 2));
});

test('LOD tiers cross-fade: nested columns, ordered fade ranges, last tier never fades out', () => {
  for (const l of [0, 1, 2]) {
    const tiers = lodTiers(l, 16 / 9);
    tiers.forEach((t, i) => {
      assert.ok(t.zA <= t.z0 && t.zB >= t.z1);
      assert.ok(t.fade[0] <= t.fade[1] && t.fade[1] <= t.fade[2] && t.fade[2] <= t.fade[3]);
      if (i > 0) {
        const f = tiers[i - 1];
        assert.deepEqual(t.fade.slice(0, 2), f.fade.slice(2));
        assert.ok(t.zA <= f.fade[2] && f.zB >= t.fade[1]);
        near(t.spacing / f.spacing, 2, 1e-9);
      }
    });
    assert.ok(tiers[tiers.length - 1].fade[2] > GRID_DEPTH);
    assert.ok(tiers[0].fade[0] < 0);
  }
});

test('the far end flattens to ground before the grid ends', () => {
  assert.ok(FAR_FLAT_START > 0.5 && FAR_FLAT_START < 1);
});

test('yaw rotates the view about the vertical axis and keeps position and pitch', () => {
  const a = cameraAt(0, 0, { yawDeg: 0 });
  const b = cameraAt(0, 0, { yawDeg: 30 });
  assert.deepEqual(b.eye, a.eye);
  assert.deepEqual(cameraAt(0, 0).target, a.target);
  near(horizonY(b), horizonY(a), 1e-9);
  assert.ok(b.target[0] > 0);
  assert.ok(cameraAt(0, 0, { yawDeg: -30 }).target[0] < 0);
  near(b.target[1], a.target[1], 1e-9);
  const m = mat4LookAt(b.eye, b.target, b.up);
  const d = [b.target[0] - b.eye[0], 0, b.target[2] - b.eye[2]];
  const p = transformPoint(m, [b.eye[0] + d[0], b.eye[1], b.eye[2] + d[2]]);
  near(p[0], 0, 1e-4);
  near(Math.atan2(d[0], -d[2]) * 180 / Math.PI, 30, 1e-6);
});

test('tier width grows with |yaw| and is unchanged at yaw 0', () => {
  assert.equal(tierHalfWidth(30, 1.78, 0), tierHalfWidth(30, 1.78));
  assert.ok(tierHalfWidth(30, 1.78, 20) > tierHalfWidth(30, 1.78, 0));
  assert.equal(tierHalfWidth(30, 1.78, -20), tierHalfWidth(30, 1.78, 20));
  assert.ok(tierHalfWidth(40, 1.78, 45) <= gridHalfWidth(1.78) * 3 + 1e-9);
  assert.equal(yawStepOf(0) + 0, 0);
  assert.equal(yawStepOf(-7), 10);
  assert.deepEqual(lodTiers(2, 1.78, undefined, 0), lodTiers(2, 1.78));
});

test('mode renderer maps governor level, pace cap, force, lite and hi-dpr onto the terrain', () => {
  const calls = [];
  const terrain = {
    draw() {}, resize() {}, dispose() {}, stats: { level: 2 },
    setQuality: (l) => calls.push(['q', l]), setLite: (v) => calls.push(['lite', v]), setDprCap: (v) => calls.push(['dpr', v]),
  };
  const r = createModeRenderer('terrain', { hidden: false }, { hidden: false }, { createTerrain: () => terrain });
  r.setQuality(0, { cap: 2, lite: false, hiDpr: true });
  assert.deepEqual(calls.splice(0), [['q', 2], ['lite', false], ['dpr', true]]);
  r.setQuality(0, { cap: 1, lite: true, hiDpr: false });
  assert.deepEqual(calls.splice(0), [['q', 1], ['lite', true], ['dpr', false]]);
  r.setQuality(3, { cap: 2 });
  assert.equal(calls.splice(0)[0][1], 0);
  r.setQuality(0, { cap: 0, lite: true, hiDpr: true, force: 2 });
  assert.deepEqual(calls.splice(0), [['q', 2], ['lite', false], ['dpr', false]]);
  assert.deepEqual(r.stats, { level: 2 });
});

test('draw applies the latency compensation to the look-ahead time: time T with latency L equals time T-L', () => {
  const tl = { bins: 64, rps: 16, total: 16 * 60, done: 16 * 60, data: Uint8Array.from({ length: 16 * 60 * 64 }, (_, i) => 40 + ((i * 37) % 160)) };
  const run = (time, lat) => {
    const gl = fakeGL();
    const t = createTerrain(fakeCanvas(), { gl, quality: 1 });
    for (let i = 0; i < 40; i += 1) t.draw(new Array(64).fill(0), i * 33, { timeline: tl, time }, lat);
    gl.calls.length = 0;
    t.draw(new Array(64).fill(0), 5000, { timeline: tl, time: time + 0.5 }, lat);
    return capture(gl)[0];
  };
  assert.deepEqual(Array.from(run(20.013, 0.25)), Array.from(run(19.763, 0)));
  assert.notDeepEqual(Array.from(run(20.013, 0.25)), Array.from(run(20.013, 0)));
});

test('softKnee: identity below the knee, monotonic, strictly increasing above it, bounded, C1 at the knee', async () => {
  const { softKnee, KNEE, HEIGHT_CAP, AMP_MAX } = await import('./viz-terrain-math.js');
  const max = 4.5;
  const knee = KNEE * max;
  for (const h of [0, 0.5, 1, 2, knee - 1e-9, knee]) assert.equal(softKnee(h, max), h);
  let prev = -1;
  for (let h = 0; h <= 12; h += 0.01) {
    const v = softKnee(h, max);
    assert.ok(v < max + 1e-12);
    if (h > knee + 0.02) assert.ok(v > prev, `${h}`);
    assert.ok(v >= prev - 1e-12);
    prev = v;
  }
  assert.ok(softKnee(7, max) !== softKnee(7.5, max));
  assert.ok(softKnee(50, max) < max + 1e-12);
  const d = (h) => (softKnee(h + 1e-6, max) - softKnee(h - 1e-6, max)) / 2e-6;
  assert.ok(Math.abs(d(knee - 0.01) - d(knee + 0.01)) < 0.02);
  assert.ok(Math.abs(d(knee + 1e-4) - 1) < 1e-3);
  assert.equal(softKnee(NaN, max) !== softKnee(NaN, max), true);
  assert.ok(Math.abs(HEIGHT_CAP - 4.5 / AMP_MAX) < 1e-12);
});

test('tall crests are not flattened: resampling keeps lattice values above 1 up to the cap, and sums of overlapping beats stay round', async () => {
  const { HEIGHT_RESAMPLE_CAP, HEIGHT_CAP } = await import('./viz-terrain-math.js');
  const lat = { rows: 20, cols: 21, dz: 2, hw: 10 };
  const tier = { rows: 10, cols: 11, dz: 2, hw: 10, jz0: 0 };
  const plan = makeTierPlan(lat, tier, 0);
  const src = new Float32Array(lat.rows * lat.cols).fill(1.4);
  const dst = new Float32Array(tier.rows * tier.cols);
  resampleTier(plan, src, dst, 0, 0, 0, HEIGHT_RESAMPLE_CAP);
  assert.ok(dst.every((v) => Math.abs(v - 1.4) < 1e-4));
});
