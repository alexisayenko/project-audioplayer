import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const B = await import('./viz-beats.js');
const S = await import('./viz-terrain-style.js');
const { isVizStyleKey } = await import('./viz-fullscreen.js');
const { createTimeline } = await import('./viz-timeline.js');
const { rowLayout, AMP_MAX, LANDMARK_MAX } = await import('./viz-terrain-math.js');

const RPS = 16;
const BINS = 64;

function synth(seconds, kicks, { floor = 0, level = 0.9 } = {}) {
  const tl = createTimeline(seconds, BINS, RPS);
  const kickRows = new Map();
  for (const k of kicks) kickRows.set(Math.round(k * RPS), level);
  for (let i = 0; i < tl.total; i += 1) {
    let v = floor;
    for (let d = 0; d < 6; d += 1) {
      const lvl = kickRows.get(i - d);
      if (lvl !== undefined) v = Math.max(v, lvl * (1 - d * 0.18));
    }
    for (let j = 0; j < BINS; j += 1) tl.data[i * BINS + j] = Math.round(255 * (j < 24 ? v : v * 0.3));
  }
  tl.done = tl.total;
  return tl;
}

const spec = (peakBin, level = 0.8) => {
  const s = new Float32Array(BINS).fill(0.05);
  for (let i = 0; i < BINS; i += 1) s[i] += level * Math.exp(-0.5 * ((i - peakBin) / 3) ** 2);
  return s;
};

test('periodic kicks are detected at their times, silence gives none', () => {
  const kicks = [];
  for (let t = 1; t < 15; t += 0.5) kicks.push(t);
  const beats = B.timelineBeats(synth(16, kicks));
  assert.ok(beats.length >= kicks.length - 1 && beats.length <= kicks.length + 1, `${beats.length}`);
  for (const k of kicks.slice(1, -1)) assert.ok(beats.some((b) => Math.abs(b.t - k) <= 0.13), `kick ${k}`);
  assert.ok(beats.every((b) => b.strength > 0 && b.strength <= 1));
  assert.equal(B.timelineBeats(synth(10, [])).length, 0);
  assert.equal(B.timelineBeats(synth(10, [], { floor: 0.5 })).length, 0);
});

test('minimum gap between beats and no beat from a slow swell', () => {
  const fast = B.timelineBeats(synth(6, [1, 1.1, 1.2, 3]));
  for (let i = 1; i < fast.length; i += 1) assert.ok(fast[i].t - fast[i - 1].t >= B.BEAT_MIN_GAP_S - 1e-9);
  const tl = createTimeline(8, BINS, RPS);
  for (let i = 0; i < tl.total; i += 1) tl.data.fill(Math.round((i / tl.total) * 200), i * BINS, (i + 1) * BINS);
  tl.done = tl.total;
  assert.equal(B.timelineBeats(tl).length, 0);
});

test('detection is deterministic, seek-invariant and does not depend on build progress', () => {
  const kicks = [1, 1.5, 2, 2.5, 3.2, 4, 5];
  const full = B.timelineBeats(synth(8, kicks)).map((b) => [b.t, b.strength]);
  const again = B.timelineBeats(synth(8, kicks)).map((b) => [b.t, b.strength]);
  assert.deepEqual(full, again);
  const tl = synth(8, kicks);
  const total = tl.done;
  tl.done = Math.round(total / 2);
  const half = B.timelineBeats(tl).map((b) => [b.t, b.strength]);
  tl.done = total;
  const rest = B.timelineBeats(tl).map((b) => [b.t, b.strength]);
  assert.deepEqual(rest, full);
  assert.deepEqual(half, full.slice(0, half.length));
  assert.ok(half.length > 0 && half.length < full.length);
});

test('the live detector matches the timeline detector on the same rows', () => {
  const tl = synth(8, [1, 1.5, 2, 3, 4.5]);
  const live = B.createLiveBeats();
  for (let i = 0; i < tl.total; i += 1) live.push(Array.from(tl.data.subarray(i * BINS, (i + 1) * BINS), (v) => v / 255), i / RPS);
  assert.deepEqual(live.beats.map((b) => b.t), B.timelineBeats(tl).map((b) => b.t));
});

test('beatEnv is 0 before the beat, rises over RISE_S, then decays to 0 at DECAY_S', () => {
  assert.equal(B.beatEnv(-1), 0);
  assert.equal(B.beatEnv(0), 0);
  assert.ok(B.beatEnv(B.BEAT_RISE_S / 2) > 0.3 && B.beatEnv(B.BEAT_RISE_S / 2) < 0.7);
  assert.ok(Math.abs(B.beatEnv(B.BEAT_RISE_S) - 1) < 1e-9);
  let prev = 1;
  for (let a = B.BEAT_RISE_S; a < B.BEAT_DECAY_S; a += 0.1) {
    const e = B.beatEnv(a);
    assert.ok(e <= prev + 1e-12);
    prev = e;
  }
  assert.ok(B.beatEnv(B.BEAT_DECAY_S - 0.05) < 0.01);
  assert.equal(B.beatEnv(B.BEAT_DECAY_S), 0);
  assert.equal(B.beatEnv(60), 0);
});

test('amplitude scales with strength and stays within the landmark cap', () => {
  assert.ok(B.beatAmp(0) >= 1 && B.beatAmp(0) < B.beatAmp(0.5));
  assert.ok(B.beatAmp(0.6) > 1.5 && B.beatAmp(0.6) < AMP_MAX + 0.5);
  assert.equal(B.beatAmp(1), LANDMARK_MAX);
  assert.equal(B.beatAmp(9), LANDMARK_MAX);
});

const width = (shape, frac = 0.5) => {
  const max = Math.max(...shape);
  return shape.filter((v) => v >= max * frac).length;
};

test('single places one narrow peak at the argmax column with the bin level', () => {
  const cols = 200;
  const s = spec(20, 0.8);
  const out = B.singleShape(s, cols);
  const top = out.indexOf(Math.max(...out));
  assert.equal(top, Math.round((20 / (BINS - 1)) * (cols - 1)));
  assert.ok(Math.abs(out[top] - s[20]) < 0.05);
  assert.ok(width(out) <= 5);
});

test('hill is broader than single and follows the spectral shape around the peak', () => {
  const cols = 200;
  const s = spec(30, 0.8);
  const hill = B.hillShape(s, cols);
  const one = B.singleShape(s, cols);
  assert.equal(hill.indexOf(Math.max(...hill)), one.indexOf(Math.max(...one)));
  assert.ok(width(hill) > 5 * width(one));
  const lo = B.hillShape(Object.assign(spec(30, 0.8), { 36: 0.01 }), cols);
  const col = Math.round((36 / (BINS - 1)) * (cols - 1));
  assert.ok(lo[col] < hill[col]);
});

test('multi picks up to 5 maxima with minimum spacing, each at its own height', () => {
  const s = new Float32Array(BINS).fill(0.02);
  for (const [i, v] of [[4, 0.9], [14, 0.7], [24, 0.6], [34, 0.8], [44, 0.65], [54, 0.62], [56, 0.9]]) s[i] = v;
  const peaks = B.spectralPeaks(s);
  assert.ok(peaks.length <= B.MULTI_MAX && peaks.length >= 4);
  for (let i = 1; i < peaks.length; i += 1) assert.ok((peaks[i] - peaks[i - 1]) / (BINS - 1) >= B.MULTI_SPACING - 1e-9);
  assert.ok(peaks.includes(56) && !peaks.includes(54));
  const out = B.multiShape(s, 252);
  const col = (i) => Math.round((i / (BINS - 1)) * 251);
  assert.ok(out[col(4)] > out[col(14)] && out[col(34)] > out[col(24)]);
  assert.equal(B.spectralPeaks(new Float32Array(BINS)).length, 0);
});

function beatAt(t, strength, bin = 20) {
  return { t, strength, spectrum: spec(bin, 0.9) };
}

test('heights: flat ground before the beat, growth after it, ride toward the camera, flat after DECAY_S', () => {
  const rows = 88;
  const cols = 120;
  const { dt, nowRow } = rowLayout(rows);
  const beats = [beatAt(10, 0.8)];
  const run = (tNow) => {
    const out = new Float32Array(rows * cols);
    B.fillBeatHeights({ beats, style: 'single', tNow, base: Math.floor(tNow / dt), rows, cols, out });
    return out;
  };
  const maxRow = (out) => {
    let best = -1;
    let row = -1;
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) if (out[r * cols + c] > best) { best = out[r * cols + c]; row = r; }
    return { best, row };
  };
  assert.equal(maxRow(run(9.9)).best, 0);
  const early = maxRow(run(10.04));
  const grown = maxRow(run(10.2));
  assert.ok(early.best > 0 && early.best < grown.best);
  const later = maxRow(run(11.5));
  assert.ok(later.row < grown.row, 'peak row moves toward the camera (lower index)');
  assert.ok(later.best < grown.best);
  assert.ok(Math.abs(grown.row - nowRow) <= 3);
  assert.equal(maxRow(run(10 + B.BEAT_DECAY_S + 0.5)).best, 0);
  assert.ok(grown.best <= B.BEAT_CAP + 1e-9);
});

test('beat peaks are placed inside the visible central span of the grid', () => {
  const rows = 60;
  const cols = 200;
  const out = new Float32Array(rows * cols);
  const beats = [beatAt(5, 1, 0), beatAt(5.3, 1, 63)];
  B.fillBeatHeights({ beats, style: 'single', tNow: 5.4, base: Math.floor(5.4 / rowLayout(rows).dt), rows, cols, out });
  const n = B.visibleCols(cols);
  const off = (cols - n) >> 1;
  assert.ok(n < cols * 0.35 && n >= cols * 0.2);
  let inside = 0;
  let outside = 0;
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    if (out[r * cols + c] > 0) { if (c >= off && c < off + n) inside += 1; else outside += 1; }
  }
  assert.ok(inside > 0);
  assert.equal(outside, 0);
});

test('heights are a pure function of the beat list and time (seek-invariant), no pulsing without beats', () => {
  const rows = 40;
  const cols = 64;
  const beats = [beatAt(3, 0.5), beatAt(4, 1, 40)];
  const a = new Float32Array(rows * cols);
  const b = new Float32Array(rows * cols);
  B.fillBeatHeights({ beats, style: 'multi', tNow: 5, base: Math.floor(5 / rowLayout(rows).dt), rows, cols, out: a });
  B.fillBeatHeights({ beats: [...beats], style: 'multi', tNow: 5, base: Math.floor(5 / rowLayout(rows).dt), rows, cols, out: b });
  assert.deepEqual(a, b);
  B.fillBeatHeights({ beats: [], style: 'hill', tNow: 5, base: 20, rows, cols, out: a });
  assert.ok(a.every((v) => v === 0));
});

test('style validation, persistence and cycling', () => {
  assert.deepEqual(S.TERRAIN_STYLES.map((s) => s.id), ['relief', 'single', 'hill', 'multi']);
  assert.equal(S.normaliseStyle('nope'), 'relief');
  assert.equal(S.normaliseStyle(null), 'relief');
  assert.equal(S.normaliseStyle('hill'), 'hill');
  localStorage.setItem(S.STYLE_STORAGE_KEY, 'bogus');
  S.resetStyleForTests();
  assert.equal(S.getStyle(), 'relief');
  const seen = [];
  const off = S.onStyle((id) => seen.push(id));
  assert.equal(S.setStyle('multi'), 'multi');
  assert.equal(localStorage.getItem(S.STYLE_STORAGE_KEY), 'multi');
  assert.equal(S.setStyle('zzz'), 'relief');
  off();
  S.resetStyleForTests();
  localStorage.setItem(S.STYLE_STORAGE_KEY, 'single');
  assert.equal(S.getStyle(), 'single');
  let id = 'relief';
  const order = [];
  for (let i = 0; i < 4; i += 1) { id = S.nextStyle(id); order.push(id); }
  assert.deepEqual(order, ['single', 'hill', 'multi', 'relief']);
  assert.equal(S.styleLabel('hill'), 'Beat peaks: hill');
  assert.deepEqual(seen, ['multi', 'relief']);
});

test('T key follows the V/M ignore rules and only applies while Terrain is the mode', () => {
  const ev = (key, extra = {}) => ({ key, target: { closest: () => null }, ...extra });
  const ctx = { open: true, route: 'library', background: false, mode: 'terrain' };
  assert.equal(isVizStyleKey(ev('t'), ctx), true);
  assert.equal(isVizStyleKey(ev('T'), ctx), true);
  assert.equal(isVizStyleKey(ev('t'), { ...ctx, mode: 'ring' }), false);
  assert.equal(isVizStyleKey(ev('t'), { ...ctx, open: false }), false);
  assert.equal(isVizStyleKey(ev('t'), { ...ctx, open: false, route: 'playback', background: true }), true);
  assert.equal(isVizStyleKey(ev('t'), { ...ctx, open: false, route: 'playback', background: false }), false);
  assert.equal(isVizStyleKey(ev('t', { ctrlKey: true }), ctx), false);
  assert.equal(isVizStyleKey(ev('t', { repeat: true }), ctx), false);
  assert.equal(isVizStyleKey({ key: 't', target: { closest: () => ({}) } }, ctx), false);
  assert.equal(isVizStyleKey(ev('m'), ctx), false);
});

test('beat detector keeps a bounded live list', () => {
  const live = B.createLiveBeats();
  for (let i = 0; i < 16 * 60; i += 1) {
    const k = i % 8 === 0 ? 0.9 : 0;
    live.push(new Float32Array(BINS).fill(k), i / 16);
  }
  assert.ok(live.beats.length > 5 && live.beats.length < 20);
});
