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
  const shift = B.BEAT_SHIFT_TIMELINE_S - B.BEAT_SHIFT_LIVE_S;
  assert.deepEqual(live.beats.map((b) => Math.round((b.t + shift) * 1e6)), B.timelineBeats(tl).map((b) => Math.round(b.t * 1e6)));
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
  assert.equal(B.beatAmp(1), B.BEAT_AMP_MAX);
  assert.equal(B.beatAmp(9), B.BEAT_AMP_MAX);
  assert.ok(B.BEAT_AMP_MAX / LANDMARK_MAX >= 0.6 && B.BEAT_AMP_MAX / LANDMARK_MAX <= 0.8);
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
  assert.deepEqual(S.TERRAIN_STYLES.map((s) => s.id), ['relief', 'single', 'hill', 'multi', 'full', 'lava', 'melody']);
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
  for (let i = 0; i < 7; i += 1) { id = S.nextStyle(id); order.push(id); }
  assert.deepEqual(order, ['single', 'hill', 'multi', 'full', 'lava', 'melody', 'relief']);
  assert.equal(S.normaliseStyle('full'), 'full');
  assert.equal(S.normaliseStyle('melody'), 'melody');
  assert.equal(S.styleLabel('full'), 'Full spectrum');
  assert.equal(S.styleLabel('lava'), 'Lava');
  assert.equal(S.normaliseStyle('lava'), 'lava');
  assert.ok(S.isBeatStyle('full') && S.isFullStyle('full') && S.isLavaStyle('lava') && !S.isBeatStyle('lava') && !S.isBeatStyle('melody') && S.isMelodyStyle('melody'));
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

const multiRow = Float32Array.from({ length: BINS }, (_, i) => 0.1 + 0.8 * Math.max(Math.exp(-0.5 * ((i - 12) / 1.5) ** 2), Math.exp(-0.5 * ((i - 40) / 1.5) ** 2)));

test('full uses the multi peak shape on the central columns', () => {
  const cols = 200;
  assert.equal(B.BEAT_SHAPES.full, B.BEAT_SHAPES.multi);
  assert.equal(B.beatCols('full', 100), B.beatCols('multi', 100));
  assert.ok(B.beatCols('full', 100) < 100);
  assert.deepEqual(Array.from(B.BEAT_SHAPES.full(multiRow, cols)), Array.from(B.multiShape(multiRow, cols)));
});

test('full: flat spectrum gives no peaks, a beat rises and is flat after DECAY_S', () => {
  const rows = 88;
  const cols = 120;
  const { dt } = rowLayout(rows);
  const run = (beats, tNow) => {
    const out = new Float32Array(rows * cols);
    B.fillBeatHeights({ beats, style: 'full', tNow, base: Math.floor(tNow / dt), rows, cols, out });
    return out;
  };
  const beats = [{ t: 10, strength: 0.8, spectrum: multiRow }];
  assert.ok(run(beats, 9).every((v) => v === 0));
  assert.ok(Math.max(...run(beats, 10.3)) > 0.3);
  assert.ok(run(beats, 10 + B.BEAT_DECAY_S + B.BEAT_SPREAD_S + 0.1).every((v) => v === 0));
  assert.ok(run([], 10.3).every((v) => v === 0));
  const flat = [{ t: 10, strength: 0.8, spectrum: new Float32Array(BINS) }];
  assert.ok(run(flat, 10.3).every((v) => v === 0));
});

test('full: no energy spike outside beats (heights stay zero between beats)', () => {
  const rows = 88;
  const cols = 120;
  const { dt } = rowLayout(rows);
  const beats = [{ t: 10, strength: 0.9, spectrum: multiRow }];
  const out = new Float32Array(rows * cols);
  B.fillBeatHeights({ beats, style: 'full', tNow: 8, base: Math.floor(8 / dt), rows, cols, out });
  assert.ok(out.every((v) => v === 0));
});

test('beat onset: timeline beats sit at the row of the flux maximum plus the calibrated shift, live beats before it', () => {
  const tl = synth(8, [2]);
  const [b] = B.timelineBeats(tl);
  const live = B.createLiveBeats();
  for (let i = 0; i < tl.total; i += 1) live.push(Array.from(tl.data.subarray(i * BINS, (i + 1) * BINS), (v) => v / 255), i / RPS);
  assert.ok(Math.abs(b.t - (2 + B.BEAT_SHIFT_TIMELINE_S)) <= 1 / RPS);
  assert.ok(live.beats[0].t < b.t);
  assert.ok(B.BEAT_SHIFT_LIVE_S < 0 && B.BEAT_SHIFT_TIMELINE_S > 0);
});

test('lead: the rise starts BEAT_LEAD_S before the beat, so the peak is already growing at the beat time', () => {
  const rows = 88;
  const cols = 120;
  const { dt } = rowLayout(rows);
  const beats = [{ t: 10, strength: 0.8, spectrum: Float32Array.from({ length: BINS }, () => 0.8) }];
  const peak = (tNow) => {
    const out = new Float32Array(rows * cols);
    B.fillBeatHeights({ beats, style: 'full', tNow, base: Math.floor(tNow / dt), rows, cols, out });
    return Math.max(...out);
  };
  assert.equal(peak(10 - B.BEAT_LEAD_S - 0.01), 0);
  assert.ok(peak(10 - B.BEAT_LEAD_S / 2) > 0);
  const atBeat = peak(10);
  const lateStart = B.beatEnv(0);
  assert.ok(atBeat > 0 && lateStart === 0);
  assert.ok(peak(10 + 0.1) > atBeat);
});

const spectrumRow = (v) => Float32Array.from({ length: BINS }, (_, j) => (j < 24 ? v : v * 0.3));

function songTimeline(plan) {
  const tl = createTimeline(plan.seconds, BINS, RPS);
  for (let i = 0; i < tl.total; i += 1) {
    let v = plan.floor ?? 0.02;
    for (const [t, lvl] of plan.kicks) {
      const d = i - Math.round(t * RPS);
      if (d >= 0 && d < 6) v = Math.max(v, lvl * (1 - d * 0.18));
    }
    for (let j = 0; j < BINS; j += 1) tl.data[i * BINS + j] = Math.round(255 * spectrumRow(v)[j]);
  }
  tl.done = tl.total;
  return tl;
}

test('a quiet intro gets small strengths; a loud passage later reaches the typical strong range', () => {
  const kicks = [[1, 0.25], [2, 0.25], [3, 0.25], [4, 0.3], [8, 0.9], [9, 0.9], [10, 0.9], [11, 0.9]];
  const beats = B.timelineBeats(songTimeline({ seconds: 14, kicks }));
  const quiet = beats.filter((b) => b.t < 6);
  const loud = beats.filter((b) => b.t > 7);
  assert.ok(quiet.length >= 3 && loud.length >= 3);
  assert.ok(quiet.every((b) => b.strength < 0.6), JSON.stringify(quiet.map((b) => b.strength)));
  assert.ok(loud.every((b) => b.strength > 0.6 && b.strength <= 1));
  const typical = B.beatAmp(Math.max(...loud.map((b) => b.strength)));
  assert.ok(typical / LANDMARK_MAX >= 0.6 && typical / LANDMARK_MAX <= 0.8);
});

test('strengths are seek-invariant: the same song gives identical beats however the build progresses', () => {
  const kicks = [[1, 0.3], [2, 0.5], [3, 0.9], [5, 0.9], [7, 0.4]];
  const full = B.timelineBeats(songTimeline({ seconds: 10, kicks })).map((b) => [b.t, b.strength]);
  const tl = songTimeline({ seconds: 10, kicks });
  const total = tl.done;
  const parts = [];
  for (const d of [40, 90, total]) { tl.done = d; parts.push(B.timelineBeats(tl).map((b) => [b.t, b.strength])); }
  assert.deepEqual(parts[2], full);
  assert.deepEqual(parts[0], full.slice(0, parts[0].length));
});

test('cold start: a tiny flux in the first rows is no beat, and the threshold has a floor before enough history exists', () => {
  assert.ok(B.beatThreshold([]) >= B.BEAT_COLD_FLUX);
  assert.ok(B.beatThreshold([0, 0, 0]) >= B.BEAT_COLD_FLUX);
  const full = Array.from({ length: B.BEAT_WINDOW_ROWS }, () => 0);
  assert.equal(B.beatThreshold(full), B.BEAT_MIN_FLUX);
  const early = B.timelineBeats(songTimeline({ seconds: 4, kicks: [[0.2, 0.06]], floor: 0 }));
  assert.equal(early.length, 0);
});

test('beat sums above the cap stay round: overlapping beats are soft-limited, not flattened', () => {
  const rows = 88;
  const cols = 120;
  const { dt } = rowLayout(rows);
  const hump = Float32Array.from({ length: BINS }, (_, i) => 0.2 + 0.8 * Math.exp(-0.5 * ((i - 32) / 10) ** 2));
  const beats = Array.from({ length: 8 }, (_, i) => ({ t: 10 + i * 0.01, strength: 1, spectrum: hump }));
  const out = new Float32Array(rows * cols);
  B.fillBeatHeights({ beats, style: 'full', tNow: 10.4, base: Math.floor(10.4 / dt), rows, cols, out });
  const cap = LANDMARK_MAX / AMP_MAX;
  assert.ok(Math.max(...out) <= cap + 1e-6);
  const top = Array.from(out).filter((v) => v > 0.8 * cap);
  assert.ok(top.length > 20);
  assert.ok(new Set(top.map((v) => v.toFixed(7))).size > top.length * 0.5);
});
