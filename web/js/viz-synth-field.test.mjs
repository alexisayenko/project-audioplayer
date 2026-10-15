import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillSynthHeights, shapePeaks, valleyMask, futureHeights, futureLayout, fadeDecay } from './viz-synth-field.js';
import { createFrame, LANDMARK_MAX, rowLayout, GRID_DEPTH } from './viz-terrain-math.js';

const ROWS = 41;
const COLS = 33;
const P = {
  sharp: 0.45, height: 1, density: 0.5, valley: true, valleyWidth: 0.18, futureDist: 0.6, fade: 1,
};

function frame(rows = ROWS, level = 0.6) {
  const f = createFrame(rows);
  for (let r = 0; r < rows; r += 1) {
    for (let b = 0; b < f.bins; b += 1) f.data[r * f.bins + b] = Math.max(0, Math.min(1, level * (0.5 + 0.5 * Math.sin(r * 0.7 + b * 0.31)) * (1 - b / (f.bins * 1.3))));
  }
  return f;
}

const stat = (a) => {
  let max = 0;
  let sum = 0;
  for (const v of a) { max = Math.max(max, v); sum += v; }
  return { max, mean: sum / a.length };
};

test('heights are deterministic, finite and capped at the landmark limit', () => {
  const a = fillSynthHeights(frame(), COLS, 1.5, P, new Float32Array(ROWS * COLS));
  const b = fillSynthHeights(frame(), COLS, 1.5, P, new Float32Array(ROWS * COLS));
  assert.deepEqual(a, b);
  assert.ok(a.every((v) => Number.isFinite(v) && v >= 0 && v <= LANDMARK_MAX));
  assert.ok(stat(a).max > 0.2);
});

test('even a huge height multiplier never exceeds the cap', () => {
  const a = fillSynthHeights(frame(ROWS, 1), COLS, 0, { ...P, height: 2, sharp: 1 }, new Float32Array(ROWS * COLS));
  assert.ok(stat(a).max <= LANDMARK_MAX);
});

test('valley mask is 1 outside, 0 in the centre column, smooth between', () => {
  const m = valleyMask(33, 0.18);
  assert.equal(m[16], 0);
  assert.equal(m[0], 1);
  assert.equal(m[32], 1);
  for (let c = 16; c < 32; c += 1) assert.ok(m[c + 1] >= m[c] - 1e-9);
  assert.deepEqual(Array.from(m).slice(0, 16), Array.from(m).slice(17).reverse());
});

test('valley clears the centre channel and can be turned off', () => {
  const on = fillSynthHeights(frame(), COLS, 0, P, new Float32Array(ROWS * COLS));
  const off = fillSynthHeights(frame(), COLS, 0, { ...P, valley: false }, new Float32Array(ROWS * COLS));
  let centreOn = 0;
  let centreOff = 0;
  for (let r = 0; r < ROWS; r += 1) { centreOn += on[r * COLS + 16]; centreOff += off[r * COLS + 16]; }
  assert.equal(centreOn, 0);
  assert.ok(centreOff > 0);
});

function spiky() {
  const out = new Float32Array(ROWS * COLS);
  for (let i = 0; i < out.length; i += 1) out[i] = (((i * 2654435761) % 1000) / 1000) * (1 + 0.5 * Math.sin(i * 0.37)) / 1.5;
  return out;
}

test('shapePeaks gets peakier as sharp rises and never raises the maximum', () => {
  const base = spiky();
  const m0 = stat(base).max;
  const peakiness = [0, 0.5, 1].map((s) => {
    const o = shapePeaks(Float32Array.from(base), ROWS, COLS, s);
    const st = stat(o);
    assert.ok(st.max <= m0 + 1e-6);
    return st.max / st.mean;
  });
  assert.ok(peakiness[0] < peakiness[1] && peakiness[1] < peakiness[2], peakiness.join());
});

test('shapePeaks keeps the mean energy roughly', () => {
  const base = spiky();
  const mean = stat(base).mean;
  for (const s of [0, 0.5, 1]) {
    const r = stat(shapePeaks(Float32Array.from(base), ROWS, COLS, s)).mean / mean;
    assert.ok(r > 0.5 && r < 1.5, `${s}: ${r}`);
  }
});

test('shapePeaks leaves all-zero input alone', () => {
  const z = new Float32Array(ROWS * COLS);
  assert.deepEqual(shapePeaks(z, ROWS, COLS, 0.7), new Float32Array(ROWS * COLS));
});

test('density 0 is broader than density 1', () => {
  const tv = (a) => { let s = 0; for (let i = 1; i < a.length; i += 1) s += Math.abs(a[i] - a[i - 1]); return s; };
  const lo = fillSynthHeights(frame(), COLS, 0, { ...P, density: 0 }, new Float32Array(ROWS * COLS));
  const hi = fillSynthHeights(frame(), COLS, 0, { ...P, density: 1 }, new Float32Array(ROWS * COLS));
  assert.ok(tv(lo) < tv(hi));
});

test('future heights are the far side of the now row', () => {
  const f = frame();
  const full = fillSynthHeights(f, COLS, 0, P, new Float32Array(ROWS * COLS));
  const { row0, n } = futureLayout(ROWS, P);
  assert.equal(row0, rowLayout(ROWS).nowRow);
  assert.ok(n >= 1 && row0 + n <= ROWS);
  assert.ok(n * rowLayout(ROWS).dz <= P.futureDist * GRID_DEPTH + rowLayout(ROWS).dz);
  const out = new Float32Array(ROWS * COLS);
  futureHeights(f, COLS, 0, P, out);
  assert.deepEqual(out.subarray(0, n * COLS), full.subarray(row0 * COLS, (row0 + n) * COLS));
  const viaSrc = new Float32Array(ROWS * COLS);
  futureHeights(f, COLS, 0, P, viaSrc, full);
  assert.deepEqual(viaSrc, out);
});

test('futureDist scales the sampled depth', () => {
  assert.ok(futureLayout(ROWS, { futureDist: 1 }).n >= futureLayout(ROWS, { futureDist: 0.2 }).n);
});

test('fadeDecay is the inverse of the fade speed and bounded', () => {
  assert.equal(fadeDecay(1), 1);
  assert.equal(fadeDecay(2), 0.5);
  assert.equal(fadeDecay(0.001), 5);
  assert.equal(fadeDecay(NaN), 1);
});

test('fade speed damps past rows and leaves the future rows alone', () => {
  const run = (fade) => fillSynthHeights(frame(), COLS, 1.5, { ...P, fade }, new Float32Array(ROWS * COLS));
  const slow = run(0.2);
  const fast = run(3);
  const { nowRow } = rowLayout(ROWS);
  const rowSum = (a, r) => a.slice(r * COLS, (r + 1) * COLS).reduce((x, y) => x + y, 0);
  assert.ok(rowSum(fast, 0) < rowSum(slow, 0));
  assert.equal(rowSum(fast, nowRow + 2), rowSum(slow, nowRow + 2));
});
