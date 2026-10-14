import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDMARK_PERIOD_S, LANDMARK_MAX, LANDMARK_GAIN, LANDMARK_MIN_ENERGY, AMP_MAX, ROWS_PER_SECOND,
  timelineLandmarks, landmarkBoostAt, landmarkWeight, createFrame, createSeries, fillLookFrame, fillHeights, rowLayout,
} from './viz-terrain-math.js';
import { createTimeline } from './viz-timeline.js';

const BINS = 8;

function makeTl(seconds, level) {
  const tl = createTimeline(seconds - 0.01, BINS, ROWS_PER_SECOND);
  for (let i = 0; i < tl.total; i += 1) {
    const v = Math.round(255 * level(i / tl.rps));
    tl.data.fill(v, i * BINS, (i + 1) * BINS);
  }
  tl.done = tl.total;
  return tl;
}

const rowsOf = (s) => Math.round(s * ROWS_PER_SECOND);

test('one landmark per 5 s window on the loudest row, earliest on ties', () => {
  const tl = makeTl(15, (t) => (Math.abs(t - 2) < 1e-6 ? 0.9 : Math.abs(t - 7.5) < 1e-6 || Math.abs(t - 8) < 1e-6 ? 0.8 : Math.abs(t - 13) < 1e-6 ? 0.7 : 0.3));
  const lm = timelineLandmarks(tl);
  assert.equal(LANDMARK_PERIOD_S, 5);
  assert.deepEqual(lm, [2, 7.5, 13]);
});

test('a quiet window gets no landmark', () => {
  const tl = makeTl(10, (t) => (t >= 5 ? 0.02 : 0.5));
  const lm = timelineLandmarks(tl);
  assert.equal(lm.length, 2);
  assert.ok(Number.isFinite(lm[0]));
  assert.ok(Number.isNaN(lm[1]));
  assert.equal(landmarkBoostAt(tl, 7), 0);
  assert.ok(LANDMARK_MIN_ENERGY > 0.02);
});

test('boost peaks at the landmark, is smooth and zero beyond 0.25 s', () => {
  const tl = makeTl(10, (t) => (Math.abs(t - 3) < 1e-6 ? 0.9 : 0.4));
  assert.equal(landmarkBoostAt(tl, 3), 1);
  let prev = 1;
  for (let d = 0.02; d < 0.25; d += 0.02) {
    const w = landmarkBoostAt(tl, 3 + d);
    assert.ok(w <= prev && w > 0);
    prev = w;
  }
  assert.equal(landmarkBoostAt(tl, 3.26), 0);
  assert.equal(landmarkBoostAt(tl, 2.74), 0);
  assert.equal(landmarkWeight(0.25), 0);
});

test('windows are anchored at 0 s: partial build gives the same landmarks as a full one, in any query order', () => {
  const level = (t) => 0.3 + 0.5 * Math.abs(Math.sin(t * 1.7));
  const full = makeTl(30, level);
  const expect = timelineLandmarks(full).slice();
  const part = makeTl(30, level);
  part.done = rowsOf(12);
  assert.equal(timelineLandmarks(part).length, 2);
  part.done = part.total;
  assert.deepEqual(timelineLandmarks(part), expect);
  const probe = [22, 3.1, 14.9, 8.3, 27];
  const a = makeTl(30, level);
  const b = makeTl(30, level);
  const wa = probe.map((t) => landmarkBoostAt(a, t));
  const wb = probe.slice().reverse().map((t) => landmarkBoostAt(b, t)).reverse();
  assert.deepEqual(wa, wb);
});

test('seeking gives the same boosted rows regardless of the previous position', () => {
  const tl = makeTl(20, (t) => 0.3 + 0.5 * Math.abs(Math.sin(t * 1.3)));
  const rows = 40;
  const f1 = createFrame(rows, BINS);
  const f2 = createFrame(rows, BINS);
  fillLookFrame(f1, tl, 3);
  fillLookFrame(f1, tl, 11.2);
  fillLookFrame(f2, tl, 11.2);
  assert.deepEqual(Array.from(f1.boost), Array.from(f2.boost));
  assert.deepEqual(Array.from(f1.data), Array.from(f2.data));
});

test('boosted heights stand above the neighbours, keep the shape and respect LANDMARK_MAX', () => {
  const rows = 40;
  const cols = 16;
  const mk = (level) => {
    const f = createFrame(rows, BINS);
    f.data.fill(level);
    return f;
  };
  const plain = mk(0.6);
  const boosted = mk(0.6);
  const r = 20;
  boosted.boost[r] = 1;
  const a = fillHeights(plain, cols, 0, new Float32Array(rows * cols), { swellAmp: 0, bakeAmp: true });
  const b = fillHeights(boosted, cols, 0, new Float32Array(rows * cols), { swellAmp: 0, bakeAmp: true });
  const max = (arr, row) => Math.max(...arr.subarray(row * cols, (row + 1) * cols));
  assert.ok(max(b, r) * AMP_MAX > max(a, r) * AMP_MAX * 1.5);
  assert.ok(max(b, r - 3) === max(a, r - 3));
  const k = b[r * cols + 3] / a[r * cols + 3];
  for (let c = 1; c < cols - 1; c += 1) assert.ok(Math.abs(b[r * cols + c] / a[r * cols + c] - k) < 1e-5);
  assert.ok(LANDMARK_GAIN > 1);

  const loud = mk(1);
  loud.boost[r] = 1;
  const c = fillHeights(loud, cols, 0, new Float32Array(rows * cols), { swellAmp: 0, bakeAmp: true });
  for (let row = 0; row < rows; row += 1) assert.ok(max(c, row) * AMP_MAX <= Math.max(LANDMARK_MAX, 1e-9) + 1e-6 || row !== r);
  assert.ok(max(c, r) * AMP_MAX <= LANDMARK_MAX + 1e-6);
});

test('baked rows ignore live energy: the frame boost comes only from the timeline', () => {
  const tl = makeTl(12, (t) => (Math.abs(t - 6) < 1e-6 ? 0.9 : 0.4));
  const rows = 88;
  const f = createFrame(rows, BINS);
  fillLookFrame(f, tl, 6);
  const before = Array.from(f.boost);
  assert.ok(before.some((w) => w > 0.9));
  const series = createSeries(64, BINS);
  for (let i = 0; i < 40; i += 1) series.push(new Array(BINS).fill(1), i / 16);
  fillLookFrame(f, tl, 6);
  assert.deepEqual(Array.from(f.boost), before);
  const { nowRow } = rowLayout(rows);
  assert.ok(f.boost[nowRow] > 0.5);
});

test('live fallback marks a row only near the running window maximum and resets per 5 s window', () => {
  const s = createSeries(256, 4);
  const push = (t, v) => s.push([v, v, v, v], t);
  push(0.0, 0.3);
  push(0.1, 0.5);
  push(0.2, 0.6);
  push(0.3, 0.4);
  push(0.4, 0.58);
  const out = (t) => s.boostAt(t);
  assert.ok(out(0.2) > 0.99);
  assert.ok(out(0.3) === 0);
  assert.ok(out(0.4) > 0 && out(0.4) < 1);
  push(5.0, 0.2);
  assert.ok(out(5.0) > 0.99);
  const q = createSeries(16, 4);
  q.push([0.02, 0.02, 0.02, 0.02], 1);
  assert.equal(q.boostAt(1), 0);
  s.clear();
  assert.equal(s.boostAt(0.2), 0);
});

import { lightFactor, fillLight, fogDensity, LIGHT_DIR, LIGHT_GAIN, NODE_GAIN, QUALITY, FOG_LOW_MIN } from './viz-terrain-math.js';

test('light factor: flat ground is neutral, faces toward the light are positive, away negative, within -1..1', () => {
  assert.ok(Math.abs(lightFactor(0, 0)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...LIGHT_DIR) - 1) < 1e-9);
  assert.ok(lightFactor(-1, 0) > 0.2);
  assert.ok(lightFactor(1, 0) < -0.2);
  for (const sx of [-50, -3, 0, 3, 50]) for (const sz of [-50, -3, 0, 3, 50]) {
    const f = lightFactor(sx, sz);
    assert.ok(f >= -1 - 1e-9 && f <= 1 + 1e-9);
  }
  assert.ok(LIGHT_GAIN > 0 && NODE_GAIN > 1);
});

test('fillLight lights the slope facing the light and keeps flat rows at zero', () => {
  const rows = 4;
  const cols = 21;
  const h = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) h[r * cols + c] = c < 10 ? (10 - c) * 0.05 : 0;
  const out = fillLight(h, rows, cols, 5, 1, new Float32Array(rows * cols));
  assert.ok(out[1 * cols + 12] === 0);
  const flat = fillLight(new Float32Array(rows * cols), rows, cols, 5, 1, new Float32Array(rows * cols));
  assert.ok(flat.every((v) => v === 0));
  assert.ok(out[1 * cols + 8] > 0);
  const mirror = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) mirror[r * cols + c] = h[r * cols + (cols - 1 - c)];
  const lit = fillLight(mirror, rows, cols, 5, 1, new Float32Array(rows * cols));
  assert.ok(lit[1 * cols + 12] < 0);
});

test('fog density grows with depth, is denser in valleys and bounded', () => {
  assert.equal(fogDensity(0, 0), 0);
  assert.ok(fogDensity(0.9, 0) > fogDensity(0.5, 0));
  assert.ok(fogDensity(0.8, 0) > fogDensity(0.8, 3));
  assert.ok(Math.abs(fogDensity(0.8, 9) - fogDensity(1, 9) * 1) <= FOG_LOW_MIN);
  assert.ok(fogDensity(5, -1) <= 1 + 1e-9);
});

test('mist is off at quality 0 and has one then two octaves', () => {
  assert.deepEqual(QUALITY.map((q) => q.mist), [0, 1, 2]);
});
