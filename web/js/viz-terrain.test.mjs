import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY, clamp01, smoothstep, qualityFor, resample, createHistory, columnBin, edgeFalloff, heightAt, fillHeights,
  gridCounts, buildGridVertices, buildLineIndices, colorRamp, fillColors, horizonGlow, makeStars, cameraAt, horizonY,
  mat4Perspective, mat4LookAt, mat4Multiply, transformPoint, makeRowClock, SHAKE_MAX, RAMP,
} from './viz-terrain-math.js';
import { createTerrain, isWebGLAvailable, linkProgram } from './viz-terrain-gl.js';
import { MODES, pickMode, nextMode, availableModes, createModeRenderer, modeLabel } from './viz-modes.js';

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
  assert.deepEqual([QUALITY[0].rows, QUALITY[1].cols, QUALITY[2].rows], [36, 56, 96]);
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

test('column to bin maps centre to bass and edges to highs', () => {
  assert.equal(columnBin(0, 5, 64), 63);
  assert.equal(columnBin(2, 5, 64), 0);
  assert.equal(columnBin(4, 5, 64), 63);
});

test('fillHeights writes rows x cols values in range', () => {
  const hist = createHistory(4, 8);
  hist.push(new Array(8).fill(1));
  const out = fillHeights(hist, 5, 0, new Float32Array(20));
  assert.ok(out.every((v) => v >= 0 && v <= 1));
  assert.ok(out[3 * 5 + 2] > out[0 * 5 + 2]);
});

test('grid vertex and index counts per quality', () => {
  for (const q of QUALITY) {
    const c = gridCounts(q.rows, q.cols);
    assert.equal(buildGridVertices(q.rows, q.cols).length, c.vertices * 2);
    assert.equal(buildLineIndices(q.rows, q.cols).length, c.segments * 2);
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
  assert.ok(Math.abs(loud.eye[0] - calm.eye[0]) <= SHAKE_MAX + 1e-9);
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

const count = (gl, name) => gl.calls.filter((c) => c[0] === name).length;

test('createTerrain compiles programs, creates buffers and draws expected counts', () => {
  const gl = fakeGL();
  const t = createTerrain(fakeCanvas(), { gl, quality: 1 });
  assert.equal(count(gl, 'createProgram'), 3);
  assert.equal(count(gl, 'createBuffer'), 5);
  assert.equal(t.bloomActive, false);
  t.draw(new Array(64).fill(0.6), 1000);
  const elems = gl.calls.find((c) => c[0] === 'drawElements');
  assert.equal(elems[2], gridCounts(72, 56).segments * 2);
  const arrays = gl.calls.filter((c) => c[0] === 'drawArrays');
  assert.ok(arrays.some((c) => c[1] === gl.POINTS && c[3] === 72 * 56));
  assert.ok(arrays.some((c) => c[1] === gl.POINTS && c[3] === 90));
  assert.equal(count(gl, 'bufferSubData'), 1);
  assert.equal(count(gl, 'drawElements'), 1);
});

test('segments are about 8k at the default quality', () => {
  const n = gridCounts(72, 56).segments;
  assert.ok(n > 7500 && n < 8500);
});

test('quality switch rebuilds the grid and bloom only at level 2', () => {
  const gl = fakeGL();
  const t = createTerrain(fakeCanvas(), { gl, quality: 0 });
  t.draw([], 0);
  assert.equal(gl.calls.find((c) => c[0] === 'drawElements')[2], gridCounts(36, 28).segments * 2);
  t.setQuality(2);
  assert.equal(t.quality, 2);
  assert.equal(t.bloomActive, true);
  assert.equal(count(gl, 'createFramebuffer'), 2);
  gl.calls.length = 0;
  t.draw([0.5], 50);
  assert.equal(count(gl, 'drawElements'), 2);
  assert.ok(gl.calls.some((c) => c[0] === 'drawElements' && c[2] === gridCounts(96, 72).segments * 2));
  t.setQuality(0);
  assert.equal(t.bloomActive, false);
  t.dispose();
});

test('bloom is skipped when the framebuffer is incomplete', () => {
  const gl = fakeGL({ fboOk: false });
  const t = createTerrain(fakeCanvas(), { gl, quality: 2 });
  assert.equal(t.bloomActive, false);
  t.draw([0.5], 0);
  assert.equal(count(gl, 'drawElements'), 1);
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
  assert.equal(count(gl, 'createProgram'), before + 3);
  t.draw([1], 100);
  assert.equal(count(gl, 'drawElements'), 1);
});

test('resize caps dpr at 2', () => {
  const gl = fakeGL();
  const c = fakeCanvas();
  const t = createTerrain(c, { gl });
  t.resize(400, 200, 3);
  assert.equal(c.width, 800);
  assert.equal(c.height, 400);
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
  only.resize(10, 20, 2);
  only.dispose();
  assert.deepEqual(log, [['gl', 1], ['q', 0], ['resize', 10, 20, 2], ['dispose']]);
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
