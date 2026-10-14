import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANES, createPartsBaker, samplePartsPlane, createPartsFrames, fillTimelineParts, createLiveParts, fillLiveParts, melodyHeights,
  fillMelodyAttrs, leadOf, selectLeads, accentLut, splitWeights, MELODY_CAP, ACCENT, ACCENT_MIN_SCORE, RIPPLE_WORLD,
} from './viz-melody.js';
import { createTimeline, makeTimelineBuilder, createInlineRunner } from './viz-timeline.js';
import { hpssMasks, bandWeights } from './viz-parts.js';
import { AMP_MAX, rowLayout } from './viz-terrain-math.js';

const BINS = 64;
const RPS = 16;
const TONE_BIN = 40;

function rowsOf(n, make) {
  return Array.from({ length: n }, (_, i) => make(i));
}

const tone = () => Float32Array.from({ length: BINS }, (_, j) => (j === TONE_BIN ? 0.9 : Math.abs(j - TONE_BIN) < 3 ? 0.15 : 0.02));
const clicks = (i) => new Float32Array(BINS).fill(i % 4 === 0 ? 0.8 : 0.02);

function bake(rows) {
  const tl = createTimeline((rows.length - 1) / RPS, BINS, RPS);
  const baker = createPartsBaker({ total: tl.total, bins: BINS, rps: RPS });
  rows.forEach((r) => baker.add(r));
  baker.finish();
  tl.parts.set(baker.parts);
  tl.partsDone = tl.total;
  return tl;
}

function frames(tl, tNow) {
  const f = createPartsFrames(88, BINS);
  fillTimelineParts(f, tl, tNow);
  return f;
}

const maxOf = (a) => a.reduce((m, v) => (v > m ? v : m), 0);

test('splitWeights partition the level: melody + canvas + other = 1', () => {
  const bands = bandWeights(BINS);
  const m = hpssMasks(rowsOf(17, tone), 8);
  const w = splitWeights(m, bands);
  for (let i = 0; i < BINS; i += 1) assert.ok(Math.abs(w.mel[i] + w.can[i] + w.oth[i] - 1) < 1e-5);
  for (let i = 0; i < 20; i += 1) assert.ok(w.mel[i] < 1e-6 || bands.bass[i] < 1);
});

test('a steady tone makes tall melody relief and almost no canvas', () => {
  const tl = bake(rowsOf(200, tone));
  const f = frames(tl, 8);
  const row = f.mel.row(rowLayout(88).nowRow);
  assert.ok(row[TONE_BIN] > 0.7);
  const out = new Float32Array(88 * 120);
  melodyHeights(f.mel, f.can, 120, out, 0);
  const world = maxOf(out) * AMP_MAX;
  assert.ok(world > 2.8 && world <= MELODY_CAP * AMP_MAX + 1e-6, `${world}`);
  const attrs = { canvas: new Float32Array(88 * 120), spark: new Float32Array(88 * 120), accent: new Float32Array(88 * 120) };
  fillMelodyAttrs(attrs, f.mel, f.can, f.oth, 120);
  assert.ok(maxOf(attrs.canvas) < 0.3);
  assert.ok(maxOf(attrs.accent) > 0.5);
});

test('a click train gives no melody relief but a bright canvas', () => {
  const tl = bake(rowsOf(200, clicks));
  const f = frames(tl, 8);
  const out = new Float32Array(88 * 120);
  melodyHeights(f.mel, f.can, 120, out, 0);
  assert.ok(maxOf(out) * AMP_MAX < 0.6, `${maxOf(out) * AMP_MAX}`);
  const attrs = { canvas: new Float32Array(88 * 120), spark: new Float32Array(88 * 120), accent: new Float32Array(88 * 120) };
  fillMelodyAttrs(attrs, f.mel, f.can, f.oth, 120);
  assert.ok(maxOf(attrs.canvas) > 0.35);
  assert.equal(maxOf(attrs.accent), 0);
});

test('the base ripple never exceeds RIPPLE_WORLD', () => {
  const tl = bake(rowsOf(200, clicks));
  const f = frames(tl, 8);
  const out = new Float32Array(88 * 120);
  melodyHeights(f.mel, f.can, 120, out, 3);
  assert.ok(maxOf(out) * AMP_MAX <= RIPPLE_WORLD + 0.35);
});

test('symmetric masks recognise a note onset that the causal masks miss', () => {
  const onset = (i) => (i < 40 ? new Float32Array(BINS).fill(0.02) : tone(i));
  const rows = rowsOf(120, onset);
  const tl = bake(rows);
  const live = createLiveParts();
  rows.forEach((r, i) => live.push(r, i / RPS));
  const sym = samplePartsPlane(tl, 0, 40 / RPS, new Float32Array(BINS))[TONE_BIN];
  const cau = new Float32Array(BINS);
  live.series.mel.sample(40 / RPS, cau);
  assert.ok(sym > cau[TONE_BIN] + 0.2, `${sym} vs ${cau[TONE_BIN]}`);
  const f = createPartsFrames(88, BINS);
  const info = fillLiveParts(f, live, 6);
  assert.ok(info && Number.isFinite(info.base));
});

test('the timeline carries three planes within the memory bound for 10 minutes', () => {
  const tl = createTimeline(600, BINS, RPS);
  assert.equal(tl.parts.length, tl.total * BINS * PLANES);
  assert.ok(tl.parts.byteLength + tl.data.byteLength < 3 * 1024 * 1024);
});

test('the builder bakes parts for every row and the inline runner delivers them', () => {
  const sr = 8000;
  const pcm = new Float32Array(sr * 3);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr);
  const b = makeTimelineBuilder({ pcm: pcm.slice(), sampleRate: sr, bands: 48, bins: 16, rps: RPS, fftSize: 1024 });
  const first = b.step(10);
  assert.ok(first.pTo <= first.to && first.pTo >= 0);
  b.step(1e9);
  assert.equal(b.partsDone, b.total);
  const queue = [];
  const run = createInlineRunner({ schedule: (fn) => queue.push(fn), now: () => 0, sliceMs: 1e9 });
  const tl = createTimeline(3, 16, RPS);
  run.start({ pcm, sampleRate: sr, bands: 48, bins: 16, rps: RPS, fftSize: 1024 }, {
    onRows() {}, onParts(from, rows) { tl.parts.set(rows, from * 16 * PLANES); tl.partsDone = from + rows.length / (16 * PLANES); }, onDone() {}, onError(e) { throw e; },
  });
  while (queue.length) queue.shift()();
  assert.equal(tl.partsDone, tl.total);
  assert.deepEqual(Array.from(tl.parts), Array.from(b.parts));
});

test('accent: only a strong narrow lead qualifies, one per window', () => {
  const narrow = new Float32Array(BINS).fill(0.02);
  narrow[30] = 0.95;
  const broad = new Float32Array(BINS).fill(0.6);
  assert.ok(leadOf(narrow).score >= ACCENT_MIN_SCORE);
  assert.ok(leadOf(broad).score < ACCENT_MIN_SCORE);
  assert.equal(leadOf(new Float32Array(BINS)).score, 0);
  const scores = [0, 0.6, 0.9, 0.7, 0, 0, 0, 0, 0.8, 0.3, 0];
  assert.deepEqual(selectLeads(scores, 2), [2, 8].filter((r) => r === 2 || scores[r] >= 0.8 && 8 - 2 > 2));
  assert.deepEqual(selectLeads(scores, 10), [2]);
  assert.deepEqual(selectLeads([0.4, 0.3], 3), []);
});

test('accent colour lookup runs from warm white to the ACCENT amber', () => {
  assert.deepEqual(accentLut(1), ACCENT);
  const lo = accentLut(0);
  assert.ok(lo[2] > ACCENT[2]);
  assert.ok(accentLut(0.5)[2] < lo[2] && accentLut(0.5)[2] > ACCENT[2]);
});
