import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFft, timelineRows, createTimeline, makeTimelineBuilder, makeTimeFollower, createInlineRunner, downmixMono } from './viz-timeline.js';
import { createLookahead } from './viz-lookahead.js';
import { sampleTimeline, fillLookFrame, createFrame, rowLayout } from './viz-terrain-math.js';

const SR = 8000;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

function tone(seconds, hz, amp = 0.5, from = 0) {
  const pcm = new Float32Array(Math.round(seconds * SR));
  for (let i = Math.round(from * SR); i < pcm.length; i += 1) pcm[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return pcm;
}

function build(pcm, bands = 48) {
  const b = makeTimelineBuilder({ pcm, sampleRate: SR, bands, bins: 16, rps: 16, fftSize: 1024 });
  b.step(1e9);
  return b;
}

test('fft puts a sine into the expected bin and rejects non powers of two', () => {
  const n = 256;
  const fft = makeFft(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i += 1) re[i] = Math.sin((2 * Math.PI * 10 * i) / n);
  fft(re, im);
  const mag = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
  assert.equal(mag.indexOf(Math.max(...mag)), 10);
  near(mag[10] / n, 0.5, 1e-9);
  assert.throws(() => makeFft(100));
});

test('timeline row count follows duration and rate', () => {
  assert.equal(timelineRows(10), 161);
  assert.equal(timelineRows(0), 0);
  assert.equal(timelineRows(NaN), 0);
  assert.equal(createTimeline(2).data.length, 33 * 64);
});

test('silence builds an all-zero timeline and a tone lights its own band only', () => {
  const quiet = build(new Float32Array(SR * 2));
  assert.ok(quiet.data.every((v) => v === 0));
  const loud = build(tone(2, 1000, 0.5));
  const row = loud.data.subarray(20 * 16, 21 * 16);
  const peak = row.indexOf(Math.max(...row));
  assert.ok(row[peak] > 100);
  const lows = Array.from(row.subarray(0, 3));
  assert.ok(Math.max(...lows) < row[peak] / 2);
});

test('the same tone is identical regardless of chunk size (deterministic, resumable)', () => {
  const pcm = tone(1.5, 700, 0.4);
  const a = build(pcm);
  const b = makeTimelineBuilder({ pcm, sampleRate: SR, bands: 48, bins: 16, rps: 16, fftSize: 1024 });
  while (b.done < b.total) b.step(5);
  assert.deepEqual(Array.from(b.data), Array.from(a.data));
});

test('rows use the window ending at the row time so a later onset appears at its time, not before', () => {
  const pcm = tone(3, 1000, 0.5, 1.5);
  const t = build(pcm);
  const sum = (r) => t.data.subarray(r * 16, (r + 1) * 16).reduce((x, y) => x + y, 0);
  assert.equal(sum(16), 0);
  assert.ok(sum(32) > 0);
  assert.ok(sum(40) > 0);
});

test('attack is faster than release like the live path', () => {
  const pcm = new Float32Array(SR * 4);
  pcm.set(tone(1, 1000, 0.5), SR);
  const t = build(pcm);
  const sum = (r) => t.data.subarray(r * 16, (r + 1) * 16).reduce((x, y) => x + y, 0);
  const onset = [15, 16, 17, 18, 19, 20].map(sum);
  assert.ok(onset[2] > onset[0]);
  const after = [31, 32, 33, 34, 35, 36, 40].map(sum);
  assert.ok(after[6] <= after[0]);
});

test('downmixMono averages channels', () => {
  const buf = { length: 2, numberOfChannels: 2, getChannelData: (c) => (c ? Float32Array.of(1, 0) : Float32Array.of(0, 1)) };
  assert.deepEqual(Array.from(downmixMono(buf)), [0.5, 0.5]);
});

test('time follower: smooth while playing, frozen on pause, snaps on seek, honours rate', () => {
  const f = makeTimeFollower();
  near(f.update(10, 0, true), 10);
  const t1 = f.update(10.05, 50, true);
  assert.ok(t1 > 10 && t1 < 10.2);
  near(f.update(20, 100, true), 20);
  near(f.update(20, 5000, false), 20);
  near(f.update(20, 5100, false), 20);
  const g = makeTimeFollower();
  g.update(0, 0, true, 2);
  const t = g.update(0.2, 100, true, 2);
  assert.ok(t > 0.15 && t < 0.3);
});

test('inline runner delivers every row in slices and can be cancelled', () => {
  const queue = [];
  let clock = 0;
  const runner = createInlineRunner({ schedule: (fn) => queue.push(fn), now: () => (clock += 3), sliceMs: 8 });
  const rows = [];
  let done = false;
  runner.start({ pcm: tone(2, 500), sampleRate: SR, bands: 24, bins: 16, rps: 16, fftSize: 1024 }, {
    onRows: (from, d) => rows.push([from, d.length]), onDone: () => { done = true; }, onError: (e) => { throw e; },
  });
  let guard = 0;
  while (queue.length && guard++ < 1000) queue.shift()();
  assert.ok(done && queue.length === 0);
  assert.ok(rows.length > 3);
  assert.equal(rows.reduce((n, r) => n + r[1] / 16, 0), 33);
  const q2 = [];
  const r2 = createInlineRunner({ schedule: (fn) => q2.push(fn) });
  let got = 0;
  const h = r2.start({ pcm: tone(2, 500), sampleRate: SR, bands: 24, bins: 16, rps: 16, fftSize: 1024 }, { onRows: () => { got += 1; }, onDone() {}, onError() {} });
  h.cancel();
  q2.shift()();
  assert.equal(got, 0);
});

function fakeAudio(over = {}) {
  const l = {};
  return Object.assign({
    currentSrc: '/files/a', duration: 3, currentTime: 0, paused: false, ended: false, playbackRate: 1,
    addEventListener: (t, fn) => { l[t] = fn; }, removeEventListener: (t) => { delete l[t]; }, fire: (t) => l[t]?.(), l,
  }, over);
}

function fakeDeps(over = {}) {
  const log = { fetches: [], cancels: 0, jobs: [] };
  const pcmSeconds = over.seconds ?? 3;
  const deps = {
    log,
    win: { AbortController },
    fetchFn: async (url) => { log.fetches.push(url); return over.res ?? { ok: true, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(8) }; },
    makeCtx: () => ({ decodeAudioData: async () => ({ length: pcmSeconds * SR, sampleRate: SR, numberOfChannels: 1, getChannelData: () => tone(pcmSeconds, 800) }) }),
    getSampleRate: () => SR,
    getBands: () => 24,
    makeRunner: () => ({
      start(job, cb) {
        log.jobs.push(job);
        const b = makeTimelineBuilder({ ...job, fftSize: 1024 });
        if (!over.manual) {
          b.step(1e9);
          cb.onRows(0, b.data);
          cb.onDone();
        } else log.manual = { b, cb };
        return { cancel() { log.cancels += 1; } };
      },
    }),
  };
  return deps;
}

const settle = () => new Promise((r) => setTimeout(r, 10));

test('lookahead stays idle until Terrain asks, then decodes lazily and exposes a timeline', async () => {
  const audio = fakeAudio();
  const d = fakeDeps();
  const la = createLookahead({ audio, ...d });
  assert.equal(la.get(0), null);
  await settle();
  assert.equal(d.log.fetches.length, 0);
  la.request('a', true);
  await settle();
  assert.deepEqual(d.log.fetches, ['/files/a']);
  assert.equal(la.status, 'ready');
  audio.currentTime = 1.2;
  const look = la.get(1000);
  assert.ok(look.timeline.total > 40);
  near(look.time, 1.2);
});

test('lookahead follows seeks and freezes on pause', async () => {
  const audio = fakeAudio();
  const la = createLookahead({ audio, ...fakeDeps() });
  la.request('a', true);
  await settle();
  la.get(0);
  audio.currentTime = 2;
  near(la.get(33).time, 2, 0.05);
  audio.paused = true;
  audio.currentTime = 1;
  near(la.get(10000).time, 1);
  near(la.get(20000).time, 1);
});

test('row selection by currentTime lands the now row on the audio time', async () => {
  const audio = fakeAudio({ duration: 3 });
  const la = createLookahead({ audio, ...fakeDeps() });
  la.request('a', true);
  await settle();
  const rows = 40;
  const frame = createFrame(rows, 16);
  const { nowRow, dt } = rowLayout(rows);
  audio.paused = true;
  audio.currentTime = 1;
  const look = la.get(0);
  const out = new Float32Array(16);
  fillLookFrame(frame, look.timeline, look.time);
  const { base } = fillLookFrame(frame, look.timeline, look.time);
  const expect = sampleTimeline(look.timeline, (base) * dt, out).slice();
  assert.deepEqual(Array.from(frame.row(nowRow)), Array.from(expect));
});

test('track change aborts the old job and starts a new one; leaving Terrain keeps building until the track changes', async () => {
  const audio = fakeAudio();
  const d = fakeDeps({ manual: true });
  const la = createLookahead({ audio, ...d });
  la.request('a', true);
  await settle();
  assert.equal(la.status, 'building');
  assert.equal(la.get(0), null);
  audio.currentSrc = '/files/b';
  audio.fire('loadstart');
  await settle();
  assert.equal(d.log.cancels, 1);
  assert.deepEqual(d.log.fetches, ['/files/a', '/files/b']);
  la.request('a', false);
  assert.equal(la.status, 'building');
  assert.equal(d.log.cancels, 1);
  audio.currentSrc = '/files/c';
  audio.fire('loadstart');
  assert.equal(la.status, 'idle');
  assert.equal(la.timeline, null);
  assert.equal(d.log.cancels, 2);
});

test('a partially built timeline is used progressively and flagged partial until the lookahead prefix is covered', async () => {
  const audio = fakeAudio({ duration: 20 });
  const d = fakeDeps({ manual: true, seconds: 20 });
  const la = createLookahead({ audio, ...d });
  la.request('a', true);
  await settle();
  const { b, cb } = d.log.manual;
  b.step(16 * 4);
  cb.onRows(0, b.data.subarray(0, b.done * b.bins));
  assert.equal(la.get(0).partial, true);
  b.step(16 * 8);
  cb.onRows(0, b.data.subarray(0, b.done * b.bins));
  assert.equal(la.get(1).partial, false);
});

test('failures fall back to live: http error, too long, oversized, decode error', async () => {
  for (const [name, audio, over] of [
    ['http', fakeAudio(), { res: { ok: false } }],
    ['long', fakeAudio({ duration: 9999 }), {}],
    ['big', fakeAudio(), { res: { ok: true, headers: { get: () => String(1e9) }, arrayBuffer: async () => new ArrayBuffer(1) } }],
  ]) {
    const la = createLookahead({ audio, ...fakeDeps(over) });
    la.request('a', true);
    await settle();
    assert.equal(la.status, 'failed', name);
    assert.equal(la.get(0), null, name);
  }
  const d = fakeDeps();
  d.makeCtx = () => ({ decodeAudioData: async () => { throw new Error('bad'); } });
  const la = createLookahead({ audio: fakeAudio(), ...d });
  la.request('a', true);
  await settle();
  assert.equal(la.status, 'failed');
});

test('the analysis window is centred on the row time: an onset shows up about half a window earlier than with a trailing window', () => {
  const mk = (centre) => {
    const b = makeTimelineBuilder({ pcm: tone(3, 1000, 0.5, 1.5), sampleRate: SR, bands: 48, bins: 16, rps: 16, fftSize: 1024, centre });
    b.step(1e9);
    return b.data;
  };
  const first = (data) => { for (let r = 0; r < 48; r += 1) { let s = 0; for (let j = 0; j < 16; j += 1) s += data[r * 16 + j]; if (s > 0) return r; } return -1; };
  const trailing = first(mk(0));
  const centred = first(mk(0.5));
  assert.ok(centred < trailing, `${centred} vs ${trailing}`);
  assert.ok(centred >= 22 && trailing >= 23);
});

test('the time follower converges on currentTime within a few frames', () => {
  const f = makeTimeFollower();
  f.update(10, 0, true);
  let t = 0;
  for (let i = 1; i <= 8; i += 1) { t = f.update(10 + i * 0.0333 + 0.05, i * 33.3, true); }
  assert.ok(Math.abs(t - (10 + 8 * 0.0333 + 0.05)) < 0.03);
});
