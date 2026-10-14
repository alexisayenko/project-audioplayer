import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTimeline, markRows, uncoveredSpans, timelineCovers, coverageWeight, planWindows, needsWindow, prefetchDue, statusText,
  makeTimelineBuilder, makeBuildScheduler, WINDOW_BACK_S, WINDOW_FWD_S,
} from './viz-timeline.js';
import { createLookahead, decodeBuffer } from './viz-lookahead.js';
import {
  createFrame, fillLookFrame, fillLiveFrame, createSeries, blendFrames, sampleTimeline, rowLayout, nowLineWeight, applyNowLine,
  NOW_LINE_GAIN_H_FULL, NOW_LINE_GAIN_H, NOW_LINE_REACH_S, FAR_FLAT_START, nowParse, nowFormat, nowClamp, parseNowField, NOW_DEFAULTS,
} from './viz-terrain-math.js';
import { getStyle, setStyle, resetStyleForTests, styleLabel, isBeatStyle, isFullStyle, TERRAIN_STYLES } from './viz-terrain-style.js';

const SR = 8000;
const pcmOf = (s) => Float32Array.from({ length: s * SR }, (_, i) => 0.4 * Math.sin(i * 0.2) * (1 + Math.sin(i / 4000)));

test('ranges merge, report gaps and the contiguous prefix', () => {
  const tl = createTimeline(60);
  markRows(tl, 100, 200);
  assert.equal(tl.done, 0);
  markRows(tl, 0, 50);
  assert.equal(tl.done, 50);
  markRows(tl, 50, 100);
  assert.deepEqual(tl.ranges, [[0, 200]]);
  assert.equal(tl.done, 200);
  assert.deepEqual(uncoveredSpans(tl, 150, 300), [[200, 300]]);
  assert.ok(timelineCovers(tl, 1, 10));
  assert.ok(!timelineCovers(tl, 10, 14));
});

test('coverage weight fades at a live frontier, not at track start or end', () => {
  const tl = createTimeline(60);
  markRows(tl, 0, 200);
  assert.equal(coverageWeight(tl, 0), 1);
  assert.equal(coverageWeight(tl, 5), 1);
  const edge = coverageWeight(tl, 199 / 16);
  assert.equal(edge, 0);
  const mid = coverageWeight(tl, (199 - 4) / 16);
  assert.ok(mid > 0.3 && mid < 0.7);
  assert.equal(coverageWeight(tl, 30), 0);
  markRows(tl, 0, tl.total);
  assert.equal(coverageWeight(tl, tl.total / 16 - 0.1), 1);
});

test('build plan: priority window around the playhead first, then outward in both directions', () => {
  const tl = createTimeline(300);
  const f = 160 * 16;
  const plan = planWindows(tl, f);
  assert.deepEqual(plan[0], [f - WINDOW_BACK_S * 16, f + WINDOW_FWD_S * 16]);
  assert.equal(plan[1][0], plan[0][1]);
  assert.equal(plan[2][1], plan[0][0]);
  for (const [a, b] of plan) assert.ok(b > a);
  markRows(tl, plan[0][0], plan[0][1]);
  assert.ok(planWindows(tl, f).every(([a, b]) => b <= plan[0][0] || a >= plan[0][1]));
});

test('windows are only used when the sequential pass is far behind the playhead', () => {
  const tl = createTimeline(300);
  assert.equal(needsWindow(tl, 0, 0), false);
  assert.equal(needsWindow(tl, 10 * 16, 8 * 16), false);
  assert.equal(needsWindow(tl, 120 * 16, 20 * 16), true);
  assert.equal(needsWindow(tl, 120 * 16, 118 * 16), false);
});

test('a windowed build matches the sequential rows closely after the warm-up', () => {
  const pcm = pcmOf(30);
  const job = { pcm, sampleRate: SR, bands: 32, bins: 16, rps: 16, fftSize: 1024 };
  const seq = makeTimelineBuilder(job);
  while (seq.done < seq.end) seq.step(64);
  const win = makeTimelineBuilder({ ...job, from: 320, to: 400, warm: 64 });
  while (win.done < win.end) win.step(16);
  let worst = 0;
  for (let r = 320; r < 400; r += 1) for (let j = 0; j < 16; j += 1) worst = Math.max(worst, Math.abs(seq.data[r * 16 + j] - win.data[r * 16 + j]));
  assert.ok(worst <= 25, `worst ${worst}`);
  assert.equal(win.parts, null);
});

test('scheduler builds the window around a far focus first and still finishes the whole track', () => {
  const pcm = pcmOf(60);
  const sch = makeBuildScheduler({ pcm, sampleRate: SR, bands: 24, bins: 16, rps: 16, fftSize: 512, focus: 40 * 16 });
  const calls = [];
  const sink = { rows: (from, rows, win) => calls.push({ from, n: rows.length / 16, win }) };
  while (sch.step(64, sink));
  assert.equal(calls[0].win, true);
  assert.ok(calls[0].from >= 37 * 16 - 1 && calls[0].from <= 40 * 16);
  const tl = createTimeline(60, 16, 16);
  for (const c of calls) markRows(tl, c.from, c.from + c.n);
  assert.equal(tl.done, tl.total);
});

test('scheduler re-plans when the focus moves', () => {
  const pcm = pcmOf(120);
  const sch = makeBuildScheduler({ pcm, sampleRate: SR, bands: 24, bins: 16, rps: 16, fftSize: 512, focus: 0 });
  const first = [];
  sch.step(64, { rows: (from, r, win) => first.push({ from, win }) });
  assert.equal(first[0].win, false);
  sch.focus(100 * 16);
  const second = [];
  for (let i = 0; i < 6 && !second.length; i += 1) sch.step(64, { rows: (from, r, win) => second.push({ from, win }) });
  assert.equal(second[0].win, true);
  assert.ok(second[0].from >= 96 * 16);
});

test('a partial timeline fills only the covered rows; the rest stays live and the end fades smoothly', () => {
  const rows = 40;
  const bins = 4;
  const tl = createTimeline(20, bins, 16);
  tl.data.fill(255);
  markRows(tl, 160, 320);
  const look = createFrame(rows, bins);
  const live = createFrame(rows, bins);
  const series = createSeries(64, bins);
  for (let i = 0; i < 64; i += 1) series.push([0.2, 0.2, 0.2, 0.2], i / 16);
  const now = 15;
  fillLookFrame(look, tl, now);
  fillLiveFrame(live, series, now);
  blendFrames(live, look, 1);
  const { nowRow } = rowLayout(rows);
  assert.ok(live.row(nowRow)[0] > 0.9);
  assert.ok(look.cov[0] > 0.9 || look.cov[0] === 0);
  const ahead = Array.from({ length: rows - nowRow }, (_, i) => live.row(nowRow + i)[0]);
  assert.ok(ahead.every((v) => v >= 0));
  assert.ok(look.cov.some((c) => c > 0 && c < 1) || look.cov.every((c) => c === 1 || c === 0));
  const uncovered = createFrame(rows, bins);
  fillLookFrame(uncovered, tl, 2);
  assert.ok(uncovered.cov.every((c) => c === 0));
});

test('rows beyond the track end decay to flat with no step', () => {
  const tl = createTimeline(2, 2, 16);
  tl.data.fill(200);
  markRows(tl, 0, tl.total);
  const out = new Float32Array(2);
  const last = (tl.total - 1) / 16;
  const seq = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((d) => sampleTimeline(tl, last + d, out)[0]);
  for (let i = 1; i < seq.length; i += 1) assert.ok(seq[i] <= seq[i - 1] + 1e-9);
  assert.ok(seq[0] > 0.7);
  assert.equal(seq[seq.length - 1], 0);
  assert.ok(seq.every((v, i) => i === 0 || seq[i - 1] - v < 0.45));
});

test('far flatten leaves the full 5 s of future visible', () => {
  assert.ok(FAR_FLAT_START >= 0.9);
});

test('prefetch decision', () => {
  const base = { on: true, nextSrc: '/files/n', cached: false, status: 'ready', busy: false };
  assert.equal(prefetchDue(base), true);
  assert.equal(prefetchDue({ ...base, on: false }), false);
  assert.equal(prefetchDue({ ...base, nextSrc: '' }), false);
  assert.equal(prefetchDue({ ...base, cached: true }), false);
  assert.equal(prefetchDue({ ...base, busy: true }), false);
  assert.equal(prefetchDue({ ...base, status: 'failed' }), false);
});

test('status strings', () => {
  assert.equal(statusText({ status: 'idle' }), 'timeline: idle');
  assert.equal(statusText({ status: 'loading', stage: 'decode' }), 'timeline: loading decode');
  assert.equal(statusText({ status: 'building', done: 42, total: 100 }), 'timeline: building 42%');
  assert.equal(statusText({ status: 'ready' }), 'timeline: ready');
  assert.equal(statusText({ status: 'ready', cached: true }), 'timeline: ready (cached)');
  assert.equal(statusText({ status: 'failed', error: 'http 404' }), 'timeline: failed: http 404');
});

const flush = () => new Promise((r) => setTimeout(r, 15));

function harness({ duration = NaN, fail = null } = {}) {
  const l = {};
  const audio = {
    currentSrc: '/files/a', duration, currentTime: 0, paused: false, ended: false, playbackRate: 1,
    addEventListener: (t, fn) => { l[t] = fn; }, removeEventListener() {}, fire: (t) => l[t]?.({ type: t }),
  };
  const log = { fetches: [], warns: [], jobs: [], focus: [] };
  const deps = {
    audio, win: { AbortController },
    fetchFn: async (u) => { log.fetches.push(u); return fail?.fetch ?? { ok: true, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(8) }; },
    makeCtx: () => ({ decodeAudioData: async () => { if (fail?.decode) throw new Error(fail.decode); return { length: 5 * SR, sampleRate: SR, numberOfChannels: 1, getChannelData: () => pcmOf(5) }; } }),
    getSampleRate: () => SR,
    getBands: () => 24,
    warn: (m) => log.warns.push(m),
    makeRunner: () => ({
      start(job, cb) {
        log.jobs.push(job);
        const b = makeTimelineBuilder({ ...job, fftSize: 512 });
        b.step(1e9);
        cb.onRows(0, b.data);
        cb.onDone();
        return { cancel() {}, focus: (r) => log.focus.push(r) };
      },
    }),
  };
  return { audio, deps, log };
}

test('a new track whose duration is still unknown at loadstart is not rejected', async () => {
  const h = harness({ duration: NaN });
  const la = createLookahead(h.deps);
  la.request('a', true);
  await flush();
  assert.equal(la.status, 'ready');
  assert.equal(la.statusText(), 'timeline: ready');
});

test('failures surface a reason and a console warning', async () => {
  const h = harness({ fail: { decode: 'EncodingError' } });
  const la = createLookahead(h.deps);
  la.request('a', true);
  await flush();
  assert.equal(la.statusText(), 'timeline: failed: EncodingError');
  assert.ok(h.log.warns[0].includes('EncodingError'));
});

test('toggling Terrain off and on reuses the finished timeline without a second fetch', async () => {
  const h = harness();
  const la = createLookahead(h.deps);
  la.request('a', true);
  await flush();
  la.request('a', false);
  la.request('a', true);
  assert.equal(la.status, 'ready');
  assert.equal(h.log.fetches.length, 1);
  h.audio.currentSrc = '/files/b';
  h.audio.fire('loadstart');
  await flush();
  h.audio.currentSrc = '/files/a';
  h.audio.fire('loadstart');
  assert.equal(la.status, 'ready');
  assert.equal(la.statusText(), 'timeline: ready (cached)');
  assert.equal(h.log.fetches.length, 2);
});

test('the next queue track is prefetched while the current one is ready', async () => {
  const h = harness();
  let next = '';
  const la = createLookahead({ ...h.deps, getNextSrc: () => next });
  la.request('a', true);
  await flush();
  next = '/files/n';
  la.get(5000);
  await flush();
  assert.deepEqual(h.log.fetches, ['/files/a', '/files/n']);
  assert.equal(h.log.jobs[1].to, Math.min(81, 20 * 16));
  h.audio.currentSrc = '/files/n';
  h.audio.fire('loadstart');
  assert.ok(la.timeline.done >= 20 * 16 || la.status === 'building' || la.status === 'loading');
  assert.ok(la.get(9000));
});

test('decodeBuffer supports callback-only decodeAudioData', async () => {
  const ctx = { decodeAudioData: (b, ok) => { setTimeout(() => ok('buf'), 1); } };
  assert.equal(await decodeBuffer(ctx, new ArrayBuffer(1)), 'buf');
  const bad = { decodeAudioData: (b, ok, err) => { setTimeout(() => err(new Error('x')), 1); } };
  await assert.rejects(decodeBuffer(bad, new ArrayBuffer(1)));
});

test('Full spectrum is Relief with only a 1.1x now line', () => {
  assert.equal(styleLabel('full'), 'Full spectrum');
  assert.ok(isFullStyle('full') && !isBeatStyle('full') && isBeatStyle('hill'));
  assert.deepEqual(TERRAIN_STYLES.map((s) => s.id), ['relief', 'single', 'hill', 'multi', 'full', 'melody']);
  assert.equal(NOW_LINE_GAIN_H_FULL, 1.1);
  const rows = 40;
  const cols = 3;
  const { nowRow, dt } = rowLayout(rows);
  const flat = new Float32Array(rows * cols).fill(0.4);
  const boosted = applyNowLine(flat.slice(), rows, cols, 0, 99, NOW_LINE_GAIN_H_FULL);
  assert.ok(Math.abs(boosted[nowRow * cols] - 0.44) < 1e-6);
  const beyond = nowRow + Math.ceil(NOW_LINE_REACH_S / dt) + 1;
  assert.ok(Math.abs(boosted[beyond * cols] - 0.4) < 1e-6);
  const plain = applyNowLine(flat.slice(), rows, cols, 0, 99, NOW_LINE_GAIN_H);
  assert.ok(Math.abs(plain[nowRow * cols] - 0.4) < 1e-6);
});

test('now-line debug fields: parse, clamp, format and typed values', () => {
  assert.deepEqual(nowClamp({}), NOW_DEFAULTS);
  assert.deepEqual(nowClamp({ nowH: 9, nowB: 0 }), { nowH: 3, nowB: 0.5 });
  assert.deepEqual(nowClamp({ nowH: 'x', nowB: null }), NOW_DEFAULTS);
  assert.equal(nowFormat({ nowH: 1.1, nowB: 2 }), 'nowH=1.10 nowB=2.0');
  assert.deepEqual(nowParse('eye=3.31 nowH=1.50 nowB=3.0'), { nowH: 1.5, nowB: 3 });
  assert.deepEqual(nowParse('eye=3.31 pitch=-13.5deg'), {});
  assert.equal(parseNowField('1.25x', 'nowH', 1.1), 1.25);
  assert.equal(parseNowField('2,5', 'nowH', 1.1), 2.5);
  assert.equal(parseNowField('abc', 'nowH', 1.1), 1.1);
  assert.equal(parseNowField('', 'nowB', 2), 2);
  assert.equal(parseNowField('99', 'nowB', 2), 4);
  assert.equal(parseNowField('0', 'nowH', 1.1), 1);
});

test('style default stays relief and old saved full still resolves', () => {
  resetStyleForTests();
  assert.equal(setStyle('full'), 'full');
  assert.equal(getStyle(), 'full');
  setStyle('relief');
});
