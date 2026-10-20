import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, stubFetch } from './test-dom.mjs';

installDom();
const { validPeaks, reducePeaks, timeToX, xToTime, sizeCanvas, drawPeaks, loadPeaks, forgetPeaks, decodeInBrowser, fetchServerPeaks, CLIENT_DECODE_MAX } = await import('./peaks.js');

const peaks = (n = 4, extra = {}) => ({ v: 1, buckets: n, duration: 10, min: Array(n).fill(-50), max: Array(n).fill(100), ...extra });

function recorder() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (k === 'calls' ? calls : (...a) => calls.push([k, ...a])),
    set: (_, k, v) => { calls.push(['set', k, v]); return true; },
  });
  return ctx;
}
const COLORS = { wave: 'W', waveActive: 'WA', region: 'R', playhead: 'P' };
const rects = (ctx) => ctx.calls.filter((c) => c[0] === 'fillRect');

test('WEB-154: validPeaks accepts the server shape and rejects anything else', () => {
  assert.equal(validPeaks(peaks()), true);
  for (const bad of [null, {}, peaks(4, { v: 2 }), peaks(4, { buckets: 3 }), peaks(4, { min: [1] }), peaks(4, { duration: 0 }), peaks(0)]) assert.equal(validPeaks(bad), false);
});

test('WEB-154: reducePeaks makes min/max pairs normalised to 127', () => {
  const samples = new Float32Array(1000);
  for (let i = 0; i < 1000; i++) samples[i] = Math.sin(i / 10) * 0.5;
  const p = reducePeaks(samples, 1000, 10);
  assert.equal(p.buckets, 10);
  assert.equal(p.duration, 1);
  assert.equal(Math.max(...p.max), 127);
  assert.equal(Math.min(...p.min), -127);
  assert.ok(p.min.every((v, i) => v <= p.max[i]));
  assert.equal(reducePeaks(new Float32Array(0), 44100), null);
  assert.equal(reducePeaks(new Float32Array([0.2, -0.2, 0.1]), 3).buckets, 3);
  assert.deepEqual(reducePeaks(new Float32Array(8), 8, 4).max, [0, 0, 0, 0]);
});

test('WEB-154: time and x map both ways and clamp', () => {
  assert.equal(timeToX(5, 10, 200), 100);
  assert.equal(timeToX(50, 10, 200), 200);
  assert.equal(timeToX(-1, 10, 200), 0);
  assert.equal(timeToX(5, 0, 200), 0);
  assert.equal(xToTime(100, 200, 10), 5);
  assert.equal(xToTime(-5, 200, 10), 0);
  assert.equal(xToTime(999, 200, 10), 10);
  assert.equal(xToTime(5, 0, 10), 0);
});

test('WEB-154: sizeCanvas scales the backing store by the pixel ratio', () => {
  const c = {};
  assert.equal(sizeCanvas(c, 300, 140, 2), 2);
  assert.deepEqual([c.width, c.height], [600, 280]);
  sizeCanvas(c, 300.4, 140, 1.5);
  assert.deepEqual([c.width, c.height], [451, 210]);
  assert.equal(sizeCanvas(c, 100, 50, 0), 1);
});

test('WEB-154: drawPeaks draws one bar per pixel, the region wash and the playhead, in retina space', () => {
  const ctx = recorder();
  drawPeaks(ctx, peaks(4), { width: 8, height: 100, dpr: 2, region: { start: 2.5, end: 7.5 }, playhead: 5, duration: 10, colors: COLORS });
  assert.deepEqual(ctx.calls[0], ['setTransform', 2, 0, 0, 2, 0, 0]);
  assert.deepEqual(ctx.calls[1], ['clearRect', 0, 0, 8, 100]);
  const r = rects(ctx);
  assert.deepEqual(r[0], ['fillRect', 2, 0, 4, 100], 'region wash first');
  assert.equal(r.length, 1 + 8 + 1, 'wash, 8 bars, playhead');
  assert.deepEqual(r.at(-1), ['fillRect', 3, 0, 2, 100], 'playhead centred on 5 s of 10');
  const fills = ctx.calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle').map((c) => c[2]);
  assert.deepEqual(fills, ['R', 'W', 'W', 'WA', 'WA', 'WA', 'WA', 'W', 'W', 'P'], 'bars inside the region use the active colour');
});

test('WEB-154: bar heights follow min and max around the middle line', () => {
  const ctx = recorder();
  drawPeaks(ctx, { v: 1, buckets: 1, duration: 4, min: [-127], max: [127] }, { width: 1, height: 100, colors: COLORS });
  assert.deepEqual(rects(ctx)[0], ['fillRect', 0, 2, 1, 96]);
  const quiet = recorder();
  drawPeaks(quiet, { v: 1, buckets: 1, duration: 4, min: [0], max: [0] }, { width: 1, height: 100, colors: COLORS });
  assert.deepEqual(rects(quiet)[0], ['fillRect', 0, 50, 1, 1], 'silence still shows a hairline');
});

test('WEB-154: with no peaks drawPeaks draws a flat timeline rail, still with region and playhead', () => {
  const ctx = recorder();
  drawPeaks(ctx, null, { width: 100, height: 40, region: { start: 1, end: 2 }, playhead: 1.5, duration: 10, colors: COLORS });
  const r = rects(ctx);
  assert.equal(r.length, 3);
  assert.deepEqual(r[1], ['fillRect', 0, 19, 100, 2]);
});

test('WEB-154: many buckets per pixel keep the extremes of each pixel column', () => {
  const ctx = recorder();
  const p = { v: 1, buckets: 4, duration: 1, min: [-10, -127, -10, -10], max: [10, 10, 10, 127] };
  drawPeaks(ctx, p, { width: 2, height: 100, colors: COLORS });
  const [a, b] = rects(ctx);
  assert.ok(Math.abs(a[2] - 46.22) < 0.01 && Math.abs(a[2] + a[4] - 98) < 0.01, 'first column: loudest negative bucket sets its bottom');
  assert.ok(b[2] === 2 && Math.abs(b[2] + b[4] - 53.78) < 0.01, 'second column: loudest positive bucket sets its top');
});

test('WEB-154: loadPeaks takes the server result first and remembers it', async () => {
  forgetPeaks();
  let calls = 0;
  const server = async () => { calls += 1; return peaks(); };
  const decode = async () => { throw new Error('should not decode'); };
  const a = await loadPeaks('s1', { server, decode });
  assert.equal(a.source, 'server');
  await loadPeaks('s1', { server, decode });
  assert.equal(calls, 1);
});

test('WEB-154: when the server cannot make peaks the browser decodes; when that fails too the call rejects', async () => {
  forgetPeaks();
  const fail = async () => { throw Object.assign(new Error('503'), { status: 503 }); };
  const r = await loadPeaks('s2', { server: fail, decode: async () => peaks() });
  assert.equal(r.source, 'browser');
  await assert.rejects(loadPeaks('s3', { server: fail, decode: async () => { throw new Error('too large'); } }), /too large/);
  forgetPeaks();
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(loadPeaks('s4', { signal: ctl.signal, server: async () => { throw new Error('aborted'); }, decode: async () => peaks() }), /aborted/);
});

test('WEB-154: fetchServerPeaks reads /songs/<id>/peaks and refuses a bad answer', async () => {
  const calls = stubFetch(async () => ({ body: peaks() }));
  assert.equal((await fetchServerPeaks('abc')).buckets, 4);
  assert.equal(calls[0].url, '/songs/abc/peaks');
  stubFetch(async () => ({ status: 503, body: { error: 'peaks_unavailable' } }));
  await assert.rejects(fetchServerPeaks('abc'), (e) => e.status === 503);
  stubFetch(async () => ({ body: { nope: 1 } }));
  await assert.rejects(fetchServerPeaks('abc'), /bad peaks/);
});

test('WEB-154: the browser fallback only decodes small files', async () => {
  const win = { OfflineAudioContext: class { decodeAudioData() { return Promise.resolve({ sampleRate: 4, getChannelData: () => new Float32Array([0, 0.5, -0.5, 0.25]) }); } } };
  const file = (len, headers = {}) => stubFetch(async () => ({ headers, body: '' })) && (globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, arrayBuffer: async () => new ArrayBuffer(len), body: { cancel() {} } }));
  file(100);
  const small = await decodeInBrowser('x', undefined, win);
  assert.equal(small.buckets, 4);
  assert.equal(small.duration, 1);
  file(10, { 'content-length': String(CLIENT_DECODE_MAX + 1) });
  await assert.rejects(decodeInBrowser('x', undefined, win), /too large/);
  file(CLIENT_DECODE_MAX + 1);
  await assert.rejects(decodeInBrowser('x', undefined, win), /too large/);
  await assert.rejects(decodeInBrowser('x', undefined, {}), /no audio decoder/);
});
