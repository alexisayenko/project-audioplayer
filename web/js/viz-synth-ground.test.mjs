import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scrollOf, groundUniforms, hillsPolyline, createGroundPass, TERRAIN_VS, LINE_FS, FACE_FS, FLOOR_FS, HILLS_FS, FUTURE_VS,
} from './viz-synth-ground.js';
import { defaultSynth } from './viz-synth-settings.js';
import { skyColors } from './viz-synth-sky.js';
import { futureLayout } from './viz-synth-field.js';
import { WORLD_SPEED, rowLayout } from './viz-terrain-math.js';

const scene = (extra = {}) => ({
  w: 800, h: 450, dpr: 1, aspect: 800 / 450, res: [800, 450], horizonV: 0.4, time: 2, dt: 0.016, reduced: false, q: { glowPasses: 2, cellMul: 1 }, ...extra,
});

test('scrollOf is monotone in time and speed, zero when reduced', () => {
  assert.equal(scrollOf(0, 1), 0);
  assert.ok(scrollOf(2000, 1) > scrollOf(1000, 1));
  assert.ok(scrollOf(1000, 2) > scrollOf(1000, 1));
  assert.ok(Math.abs(scrollOf(1000, 1) - WORLD_SPEED) < 1e-9);
  assert.equal(scrollOf(5000, 1, true), 0);
  assert.equal(scrollOf(NaN, 1), 0);
});

test('groundUniforms maps the settings and fog fades into the sky', () => {
  const s = defaultSynth();
  const sky = skyColors(s.sky, s.sun);
  const u = groundUniforms(scene(), s.terrain, sky, { flash: 0.4 });
  assert.equal(u.mvp.length, 16);
  assert.deepEqual(u.fogColor, sky.fog);
  assert.equal(u.lineColor.length, 3);
  assert.equal(u.fillMode, 1);
  assert.equal(u.renderMode, 2);
  assert.equal(u.flash, 0.4);
  assert.equal(u.scroll, scrollOf(2000, s.terrain.speed));
  assert.equal(groundUniforms(scene({ reduced: true }), s.terrain, sky, null).scroll, 0);
  assert.equal(groundUniforms(scene(), { ...s.terrain, fill: 'faces', render: 'wire' }, sky, null).fillMode, 2);
});

test('hillsPolyline is a deterministic clip-space strip above the horizon', () => {
  const a = hillsPolyline(1.78, 0.4, 7, {});
  assert.deepEqual(a, hillsPolyline(1.78, 0.4, 7, {}));
  assert.notDeepEqual(a, hillsPolyline(1.78, 0.4, 8, {}));
  const hc = 1 - 2 * 0.4;
  for (let i = 0; i < a.length; i += 4) {
    assert.ok(a[i] >= -1 && a[i] <= 1 && a[i] === a[i + 2]);
    assert.ok(a[i + 1] > hc && a[i + 1] <= hc + 0.2);
    assert.ok(Math.abs(a[i + 3] - hc) < 1e-6);
  }
  assert.equal(a[0], -1);
  assert.equal(a[a.length - 4], 1);
});

test('shader sources declare the uniforms the pass sets', () => {
  for (const u of ['u_mvp', 'u_zb', 'u_off', 'u_fog']) assert.ok(TERRAIN_VS.includes(u));
  for (const u of ['u_line', 'u_fogc', 'u_alpha', 'u_glowMode', 'u_edge', 'u_boost']) assert.ok(LINE_FS.includes(u));
  for (const u of ['u_fill', 'u_face', 'u_fogc', 'u_fillMode']) assert.ok(FACE_FS.includes(u));
  for (const u of ['u_res', 'u_geo', 'u_fog', 'u_fill', 'u_fogc']) assert.ok(FLOOR_FS.includes(u));
  assert.ok(HILLS_FS.includes('u_col') && FUTURE_VS.includes('u_z'));
});

function fakeGL() {
  const calls = [];
  const live = new Set();
  const consts = new Map();
  return new Proxy({}, {
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
        if (name.startsWith('delete')) live.delete(args[0]);
        return null;
      };
    },
  });
}

const count = (gl, name) => gl.calls.filter((c) => c[0] === name).length;
const link = () => ({ prog: { kind: 'Program' }, locs: new Map(), vals: new Map() });

function setup(settings = defaultSynth()) {
  const gl = fakeGL();
  const progs = [];
  const pass = createGroundPass(gl, { linkProgram: (...a) => { const p = link(...a); progs.push(p); gl.createProgram(); return p; } });
  const rows = 70;
  const cols = 101;
  const lay = rowLayout(rows);
  const heights = new Float32Array(rows * cols).fill(1);
  const { n } = futureLayout(rows, settings.terrain);
  const st = {
    heights, future: new Float32Array(rows * cols).fill(2), futureRows: n, rows, cols, base: 100, frac: 0.3, pos: 0, dz: lay.dz, dt: lay.dt, t: 1,
  };
  return { gl, pass, settings, st, progs };
}

test('pass builds five programs and draws floor, hills, then terrain with depth', () => {
  const { gl, pass, settings, st } = setup();
  settings.terrain.hills = true;
  assert.equal(count(gl, 'createProgram'), 5);
  pass.setHeights(st);
  const s = scene();
  pass.drawHills(s, settings, { flash: 0 });
  pass.drawFloor(s, settings, { flash: 0 });
  const before = gl.calls.length;
  pass.drawTerrain(s, settings, { flash: 0 });
  const terrain = gl.calls.slice(before).map((c) => c[0]);
  assert.ok(terrain.includes('clear'));
  assert.ok(terrain.includes('enable'));
  assert.ok(terrain.filter((n) => n === 'drawElements').length > 4);
  assert.ok(pass.stats.tiers >= 1 && pass.stats.vertices > 0 && pass.stats.vertices <= 30000);
  assert.ok(count(gl, 'drawArrays') >= 2);
  const last = gl.calls.slice(-6).map((c) => c[0]);
  assert.ok(last.includes('disable'));
});

test('hills are skipped when off and terrain waits for heights', () => {
  const { gl, pass, settings, st } = setup();
  const s = scene();
  pass.drawTerrain(s, settings, null);
  assert.equal(count(gl, 'drawElements'), 0);
  pass.drawHills(s, settings, null);
  assert.equal(count(gl, 'drawArrays'), 0);
  pass.setHeights(st);
  pass.drawTerrain(s, settings, null);
  assert.ok(count(gl, 'drawElements') > 0);
});

test('lite quality drops glow draws and grid style changes the mesh', () => {
  const a = setup();
  a.pass.setHeights(a.st);
  a.pass.drawTerrain(scene(), a.settings, null);
  const full = count(a.gl, 'drawElements');
  const b = setup();
  b.pass.setHeights(b.st);
  b.pass.drawTerrain(scene({ q: { glowPasses: 0, cellMul: 1 } }), b.settings, null);
  assert.ok(count(b.gl, 'drawElements') < full);
  const c = setup();
  c.settings.terrain.grid = 'triangle';
  c.pass.setHeights(c.st);
  c.pass.drawTerrain(scene(), c.settings, null);
  const bufs = c.gl.calls.filter((x) => x[0] === 'bufferData').length;
  assert.ok(bufs > 0);
});

test('wire render with fill draws faces depth only, filled render skips lines', () => {
  const w = setup();
  w.settings.terrain.render = 'wire';
  w.pass.setHeights(w.st);
  w.pass.drawTerrain(scene(), w.settings, null);
  assert.ok(w.gl.calls.some((c) => c[0] === 'colorMask' && c[1] === false));
  const f = setup();
  f.settings.terrain.render = 'filled';
  f.pass.setHeights(f.st);
  f.pass.drawTerrain(scene(), f.settings, null);
  assert.ok(!f.gl.calls.some((c) => c[0] === 'drawElements' && c[1] === f.gl.LINES));
});

test('lit faces upload per-vertex light only in faces mode', () => {
  const a = setup();
  a.settings.terrain.fill = 'faces';
  a.pass.setHeights(a.st);
  a.pass.drawTerrain(scene(), a.settings, null);
  const b = setup();
  b.pass.setHeights(b.st);
  b.pass.drawTerrain(scene(), b.settings, null);
  assert.ok(a.pass.stats.uploads > b.pass.stats.uploads);
});

test('future silhouette draws a line strip and respects the toggle', () => {
  const a = setup();
  a.pass.setHeights(a.st);
  a.pass.drawTerrain(scene(), a.settings, null);
  assert.ok(a.gl.calls.some((c) => c[0] === 'drawElements' && c[1] === a.gl.LINE_STRIP));
  const b = setup();
  b.settings.terrain.future = false;
  b.pass.setHeights(b.st);
  b.pass.drawTerrain(scene(), b.settings, null);
  assert.ok(!b.gl.calls.some((c) => c[0] === 'drawElements' && c[1] === b.gl.LINE_STRIP));
  const c = setup();
  c.settings.terrain.futureStyle = 'fill';
  c.pass.setHeights(c.st);
  c.pass.drawTerrain(scene(), c.settings, null);
  assert.ok(c.gl.calls.some((x) => x[0] === 'drawArrays' && x[1] === c.gl.TRIANGLE_STRIP));
});

test('rebuild recreates programs and buffers', () => {
  const { gl, pass, settings, st } = setup();
  pass.setHeights(st);
  pass.drawTerrain(scene(), settings, null);
  pass.rebuild();
  assert.equal(count(gl, 'createProgram'), 10);
  assert.equal(pass.stats.builds, 2);
  pass.drawTerrain(scene(), settings, null);
  assert.ok(count(gl, 'drawElements') > 0);
});

test('dispose frees every buffer and later draws are no-ops', () => {
  const { gl, pass, settings, st } = setup();
  pass.setHeights(st);
  pass.drawTerrain(scene(), settings, null);
  assert.ok([...gl.live].some((o) => o.kind === 'Buffer'));
  pass.dispose();
  assert.equal([...gl.live].filter((o) => o.kind === 'Buffer').length, 0);
  const n = gl.calls.length;
  pass.drawTerrain(scene(), settings, null);
  pass.drawFloor(scene(), settings, null);
  pass.drawHills(scene(), settings, null);
  assert.equal(gl.calls.length, n);
});

test('glow taps halve the glow repeats and rings of 0 remove them', () => {
  const run = (q) => {
    const t = setup();
    t.pass.setHeights(t.st);
    t.pass.drawTerrain(scene({ q: { cellMul: 1, glowPasses: 2, glowTaps: 4, ...q } }), t.settings, null);
    return count(t.gl, 'drawElements');
  };
  const full = run({});
  const two = run({ glowTaps: 2 });
  const none = run({ glowPasses: 0 });
  assert.ok(two < full);
  assert.ok(none < two);
  const one = run({ glowPasses: 1, glowTaps: 2 });
  assert.ok(none < one && one < two);
});
