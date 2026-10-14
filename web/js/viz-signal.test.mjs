import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frameStats, createTracker, diagnose, debugLines, userAgentFamily, audioOrigin, createStatusEl, byteMax, SILENT_FRAMES,
} from './viz-signal.js';
import { createViz } from './viz-canvas.js';

const filled = (v, n = 64) => new Float32Array(n).fill(v);

test('frameStats treats -Infinity, NaN and floor-level frames as silent', () => {
  assert.equal(frameStats(filled(-Infinity)).silent, true);
  assert.equal(frameStats(filled(NaN)).silent, true);
  assert.equal(frameStats(filled(-140)).silent, true);
  assert.equal(frameStats(new Float32Array(0)).silent, true);
  const live = frameStats(Float32Array.from([-Infinity, -60, -30]));
  assert.equal(live.silent, false);
  assert.equal(live.max, -30);
  assert.equal(live.finite, 2);
  assert.equal(byteMax(Uint8Array.from([0, 7, 3])), 7);
});

test('tracker counts live frames and resets the silent run', () => {
  const t = createTracker();
  t.record(filled(-Infinity));
  t.record(filled(-Infinity));
  assert.equal(t.t.silentRun, 2);
  assert.equal(t.t.live, 0);
  t.record(filled(-40));
  assert.equal(t.t.silentRun, 0);
  assert.equal(t.t.live, 1);
  assert.equal(t.t.frames, 3);
  t.lost();
  assert.equal(t.t.allZero, true);
});

test('diagnose separates idle, blocked, suspended, no analyser, silent and ok', () => {
  const base = { playing: true, graphState: 'running', ctxState: 'running', hasAnalyser: true, silentRun: 0 };
  assert.equal(diagnose({ ...base, playing: false, ctxState: 'suspended' }).code, 'idle');
  assert.equal(diagnose({ ...base, graphState: 'blocked' }).code, 'blocked');
  assert.equal(diagnose({ ...base, graphState: 'unsupported' }).code, 'unsupported');
  assert.equal(diagnose({ ...base, ctxState: 'suspended', hasAnalyser: false }).code, 'suspended');
  assert.equal(diagnose({ ...base, ctxState: 'interrupted', hasAnalyser: false }).code, 'suspended');
  assert.equal(diagnose({ ...base, graphState: 'off', ctxState: 'none', hasAnalyser: false }).code, 'no-analyser');
  assert.equal(diagnose({ ...base, silentRun: SILENT_FRAMES }).code, 'silent');
  assert.equal(diagnose({ ...base, silentRun: SILENT_FRAMES - 1 }).code, 'ok');
  assert.equal(diagnose(base).text, '');
});

test('audioOrigin and userAgentFamily', () => {
  const loc = { href: 'https://electrophone.cc/', origin: 'https://electrophone.cc' };
  assert.deepEqual(audioOrigin({ src: '/files/abc', crossOrigin: null }, loc), { src: 'https://electrophone.cc', sameOrigin: true, crossOrigin: null });
  assert.equal(audioOrigin({ src: 'https://other.example/a.m4a' }, loc).sameOrigin, false);
  assert.equal(audioOrigin({ src: '' }, loc).src, 'none');
  assert.equal(userAgentFamily('Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/18 Safari/605'), 'Safari');
  assert.equal(userAgentFamily('Mozilla/5.0 Chrome/120 Safari/537'), 'Chrome');
});

test('debugLines lists every field Alex needs', () => {
  const lines = debugLines({
    playing: true, paused: false, graphState: 'running', ctxState: 'running', hasAnalyser: true, fftSize: 8192, max: -Infinity, mean: -Infinity, byteMax: 0,
    allZero: true, frames: 10, live: 0, silentRun: 10, src: 'https://x', pageOrigin: 'https://x', sameOrigin: true, crossOrigin: null, ua: 'Safari', frameMs: '0.4 ms',
  }).join('\n');
  for (const part of ['AudioContext running', 'fft 8192', 'dB max -inf', 'byte max 0', 'all-zero yes', 'nonzero 0', 'same-origin yes', 'crossOrigin null', 'ua Safari']) {
    assert.ok(lines.includes(part), part);
  }
});

test('createStatusEl is inert without a document and reuses one element', () => {
  assert.doesNotThrow(() => createStatusEl(null).set('x'));
  const el = { style: {}, isConnected: false, setAttribute() {} };
  let appended = 0;
  const doc = { createElement: () => el, getElementById: () => null, body: { append: () => { appended += 1; el.isConnected = true; } } };
  const s = createStatusEl(doc);
  s.set('hello');
  assert.equal(el.textContent, 'hello');
  assert.equal(el.style.display, 'block');
  s.set('');
  assert.equal(el.style.display, 'none');
  createStatusEl({ ...doc, getElementById: () => el });
  assert.equal(appended, 1);
});

function fakeCtx() {
  return new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
}

function silentViz(statusLog, analyser, playing = true) {
  const canvas = { getContext: fakeCtx, width: 0, height: 0, className: '', ownerDocument: null };
  const viz = createViz({
    canvas,
    deps: {
      getAnalyser: () => analyser,
      isPlaying: () => playing,
      isVisible: () => true,
      reducedQuery: () => null,
      isCoarse: () => false,
      raf: () => 1,
      caf() {},
      dpr: () => 1,
      doc: null,
      debug: false,
      status: { set: (t) => statusLog.push(t) },
      getDiag: () => ({ graphState: analyser ? 'running' : 'off', ctxState: analyser ? 'running' : 'suspended' }),
      now: () => 0,
    },
  });
  viz.setEnabled(true);
  viz.resize(400, 200);
  return viz;
}

test('a silent analyser draws nothing but the idle line and reports it', () => {
  const log = [];
  const an = { frequencyBinCount: 64, fftSize: 128, context: { sampleRate: 44100 }, getFloatFrequencyData: (b) => b.fill(-Infinity) };
  const viz = silentViz(log, an);
  for (let i = 0; i <= SILENT_FRAMES + 1; i += 1) viz.frame(i * 40);
  assert.match(log.at(-1), /reads silence/);
});

test('without an analyser while playing the status names the suspended context', () => {
  const log = [];
  const viz = silentViz(log, null);
  viz.frame(100);
  assert.match(log.at(-1), /suspended/);
});
