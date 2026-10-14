import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOW_LINE_GAIN_H, NOW_LINE_GAIN_B, NOW_LINE_SIGMA_S, NOW_LINE_REACH_S, NOW_FALLOFF_S, BEAT_BASE_RELIEF, HEIGHT_CAP, nowLineWeight, nowLineBoost, applyNowLine, addBaseRelief, softKnee, rowLayout,
  createFrame, fillHeights, gridDims, lodTiers, nowZOf, WORLD_SPEED,
} from './viz-terrain-math.js';
import { createTerrain, strideOf, padTier, UPLOAD_MIN_S } from './viz-terrain-gl.js';
import { setStyle, resetStyleForTests } from './viz-terrain-style.js';

test('now line: gain 1 is a no-op; with gain 2, 2x at the now row, 1x beyond 3 sigma, monotonic and symmetric', () => {
  assert.equal(NOW_LINE_GAIN_H, 1);
  assert.equal(NOW_LINE_GAIN_B, 2);
  assert.equal(nowLineBoost(0), 1);
  for (let d = -1; d <= 1; d += 0.01) assert.equal(nowLineBoost(d), 1);
  assert.ok(Math.abs(NOW_LINE_SIGMA_S - NOW_FALLOFF_S / Math.SQRT2) < 1e-12);
  assert.equal(nowLineBoost(0, 2), 2);
  assert.equal(nowLineBoost(NOW_LINE_REACH_S, 2), 1);
  assert.equal(nowLineBoost(NOW_LINE_REACH_S * 3, 2), 1);
  assert.equal(nowLineBoost(0.1, 2), nowLineBoost(-0.1, 2));
  let prev = Infinity;
  for (let d = 0; d <= NOW_LINE_REACH_S + 0.1; d += 0.005) {
    const b = nowLineBoost(d, 2);
    assert.ok(b <= prev + 1e-12 && b >= 1 && b <= 2, `${d} ${b}`);
    prev = b;
  }
  assert.ok(nowLineWeight(NOW_FALLOFF_S) > 0.3 && nowLineWeight(NOW_FALLOFF_S) < 0.4);
});

test('now line on a grid: the now row doubles with gain 2 (default 1x leaves it alone), rows beyond reach are untouched, the soft knee bounds peaks', () => {
  const rows = 40;
  const cols = 5;
  const { nowRow } = rowLayout(rows);
  const mk = (v) => new Float32Array(rows * cols).fill(v);
  const a = applyNowLine(mk(0.1), rows, cols, 0, HEIGHT_CAP, 2);
  assert.deepEqual(applyNowLine(mk(0.1), rows, cols, 0), mk(0.1));
  assert.ok(Math.abs(a[nowRow * cols] - 0.2) < 1e-6);
  assert.ok(Math.abs(a[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(a[(rows - 1) * cols] - 0.1) < 1e-6);
  const half = applyNowLine(mk(0.1), rows, cols, 0.5, HEIGHT_CAP, 2);
  assert.ok(half[nowRow * cols] > 0.1 && half[nowRow * cols] < 0.2);
  assert.ok(Math.abs(half[nowRow * cols] - half[(nowRow + 1) * cols]) < 1e-6);
  const tall = applyNowLine(mk(HEIGHT_CAP * 0.95), rows, cols, 0, HEIGHT_CAP, 2);
  for (const v of tall) assert.ok(v <= HEIGHT_CAP + 1e-9);
  const ramp = new Float32Array(rows * cols);
  const outs = [];
  for (let i = 0; i <= 20; i += 1) {
    ramp.fill(i / 20 * HEIGHT_CAP * 0.9);
    outs.push(applyNowLine(ramp.slice(), rows, cols, 0, HEIGHT_CAP, 2)[nowRow * cols]);
  }
  for (let i = 1; i < outs.length; i += 1) assert.ok(outs[i] > outs[i - 1], 'no plateau');
});

test('base relief adds under the peaks through the soft knee at the named factor', () => {
  assert.equal(BEAT_BASE_RELIEF, 0.6);
  const out = new Float32Array([0, 0.3, HEIGHT_CAP]);
  const rel = new Float32Array([0.5, 0.5, 0.5]);
  addBaseRelief(out, rel);
  assert.ok(Math.abs(out[0] - 0.3) < 1e-6);
  assert.ok(Math.abs(out[1] - softKnee(0.6)) < 1e-6);
  assert.ok(out[2] < HEIGHT_CAP && out[2] > 0.85 * HEIGHT_CAP);
});

function recGL() {
  const calls = [];
  const consts = new Map();
  const heights = [];
  const gl = new Proxy({}, {
    get(_t, name) {
      if (name === 'calls') return calls;
      if (name === 'heights') return heights;
      if (/^[A-Z0-9_]+$/.test(name)) { if (!consts.has(name)) consts.set(name, consts.size + 1); return consts.get(name); }
      return (...a) => {
        calls.push([name, ...a]);
        if (name === 'bufferSubData' && a[2] instanceof Float32Array) heights.push(a[2].slice());
        if (name.startsWith('create')) return { kind: name.slice(6) };
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return true;
        if (name === 'checkFramebufferStatus') return gl.FRAMEBUFFER_COMPLETE;
        if (name === 'getUniformLocation') return { name: a[1] };
        return undefined;
      };
    },
  });
  return gl;
}

const canvas = () => ({ width: 300, height: 150, addEventListener() {}, removeEventListener() {}, getContext: () => null });
const maxOf = (arrs) => arrs.reduce((m, a) => a.reduce((mm, v) => Math.max(mm, v), m), 0);

test('beat styles carry the relief as a base layer: non-zero without any beat, flat when the spectrum is silent', () => {
  setStyle('single');
  try {
    const loud = recGL();
    const t = createTerrain(canvas(), { gl: loud, quality: 1 });
    for (let i = 0; i < 30; i += 1) t.draw(new Array(64).fill(0.5), 1000 + i * 16);
    assert.ok(maxOf(loud.heights.slice(-8)) > 0.05);
    const quiet = recGL();
    const q = createTerrain(canvas(), { gl: quiet, quality: 1 });
    for (let i = 0; i < 30; i += 1) q.draw(new Array(64).fill(0), 1000 + i * 16);
    assert.equal(maxOf(quiet.heights), 0);
  } finally {
    resetStyleForTests();
  }
});

test('relief style is unchanged by the now line: only beat styles are boosted', () => {
  setStyle('relief');
  try {
    const a = recGL();
    const t = createTerrain(canvas(), { gl: a, quality: 1 });
    for (let i = 0; i < 30; i += 1) t.draw(new Array(64).fill(0.5), 1000 + i * 16);
    setStyle('single');
    const b = recGL();
    const t2 = createTerrain(canvas(), { gl: b, quality: 1 });
    for (let i = 0; i < 30; i += 1) t2.draw(new Array(64).fill(0.5), 1000 + i * 16);
    assert.ok(maxOf(a.heights.slice(-8)) > 0);
    assert.ok(maxOf(b.heights.slice(-8)) > 0);
  } finally {
    resetStyleForTests();
  }
});

test('upload stride: the near tier is uploaded at most every UPLOAD_MIN_S of scroll, tiers are padded so the slide never exposes a gap', () => {
  const tiers = lodTiers(2, 2, nowZOf(gridDims(2, 2).rows));
  assert.ok(strideOf(tiers[0]) >= 2);
  assert.equal(strideOf(tiers[tiers.length - 1]), 1);
  for (const tr of tiers) {
    const st = strideOf(tr);
    assert.equal(padTier(tr).rows, tr.rows + st - 1);
    assert.ok(st * (tr.dz / WORLD_SPEED) >= UPLOAD_MIN_S - 1e-9);
  }
  const gl = recGL();
  const t = createTerrain(canvas(), { gl, quality: 2 });
  const tl = { bins: 64, rps: 16, total: 960, done: 960, data: new Uint8Array(960 * 64).fill(120) };
  for (let i = 0; i < 30; i += 1) t.draw(new Array(64).fill(0.3), i * 16.7, { timeline: tl, time: 20 + i * 0.0167 });
  gl.calls.length = 0;
  for (let i = 0; i < 60; i += 1) t.draw(new Array(64).fill(0.3), 1000 + i * 16.7, { timeline: tl, time: 20.5 + i * 0.0167 });
  const ups = gl.calls.filter((c) => c[0] === 'bufferSubData').length;
  const perUp = 4;
  const bound = tiers.reduce((n, tr) => n + (1 / (strideOf(tr) * (tr.dz / WORLD_SPEED)) + 2) * perUp, 0);
  assert.ok(ups <= bound, `${ups} <= ${bound}`);
  assert.ok(ups > 0);
});
