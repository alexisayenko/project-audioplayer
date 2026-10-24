import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBpmController, LIVE_BPM_KEY, PUBLISH_MS } from './live-bpm-ctl.js';
import { segment, concat } from './live-bpm-synth.mjs';

const RATE = 44100;
const BLOCK = 1764;

function rig({ stored = '0', bpm = 139, stream = new Float32Array(0), graph = true } = {}) {
  const mem = { [LIVE_BPM_KEY]: stored };
  const audio = { handlers: {}, addEventListener(n, f) { this.handlers[n] = f; }, removeEventListener(n) { delete this.handlers[n]; } };
  const player = { current: { id: 's1', bpm }, playing: true, subs: new Set(), onChange(f) { this.subs.add(f); return () => this.subs.delete(f); }, fire() { this.subs.forEach((f) => f()); } };
  const intervals = new Map();
  let nextId = 1;
  const timers = { setInterval: (f, ms) => { intervals.set(nextId, { f, ms }); return nextId++; }, clearInterval: (id) => intervals.delete(id) };
  const clock = { pos: 0, ensured: 0, graph };
  const ctx = { sampleRate: RATE, get currentTime() { return clock.pos / RATE; } };
  const analyser = {
    fftSize: 8192,
    getFloatTimeDomainData(b) {
      for (let i = 0; i < b.length; i += 1) {
        const k = clock.pos - b.length + i;
        b[i] = k >= 0 && k < stream.length ? stream[k] : 0;
      }
    },
  };
  const ctl = createLiveBpmController({
    audio, player, getAnalyser: () => (clock.graph ? analyser : null), getContext: () => ctx, ensureGraph: () => { clock.ensured += 1; }, timers,
    read: () => mem[LIVE_BPM_KEY], write: (v) => { mem[LIVE_BPM_KEY] = v; },
  });
  const run = (seconds) => {
    const blocks = Math.round((seconds * RATE) / BLOCK);
    for (let n = 0; n < blocks; n += 1) {
      clock.pos += BLOCK;
      for (const { f, ms } of intervals.values()) if (ms === 40) f();
      if (n % 25 === 12 || n % 25 === 24) for (const { f, ms } of intervals.values()) if (ms === PUBLISH_MS) f();
    }
  };
  return { ctl, mem, audio, player, intervals, clock, run };
}

const kicks = (bpm, seconds = 20, seed = 1) => segment({ bpm, seconds, kind: 'kick', seed });

test('toggle persists, defaults off, and reads the stored state back', () => {
  const r = rig();
  assert.equal(r.ctl.on, false);
  r.ctl.setOn(true);
  assert.equal(r.mem[LIVE_BPM_KEY], '1');
  assert.equal(rig({ stored: '1' }).ctl.on, true);
  r.ctl.setOn(false);
  assert.equal(r.mem[LIVE_BPM_KEY], '0');
});

test('no sampling while off or paused', () => {
  const r = rig();
  assert.equal(r.intervals.size, 0);
  r.ctl.setOn(true);
  assert.equal(r.intervals.size, 2);
  r.player.playing = false;
  r.audio.handlers.pause();
  assert.equal(r.intervals.size, 0);
  r.player.playing = true;
  r.audio.handlers.play();
  assert.equal(r.intervals.size, 2);
  r.ctl.setOn(false);
  assert.equal(r.intervals.size, 0);
});

test('turning the toggle on while playing builds the audio graph', () => {
  const r = rig({ graph: false });
  assert.equal(r.clock.ensured, 0);
  r.ctl.setOn(true);
  assert.ok(r.clock.ensured >= 1);
  r.run(2);
  assert.equal(r.ctl.value, null);
});

test('live value follows the audio, not the stored BPM, and is cleared by seek and song change', () => {
  const r = rig({ stored: '1', bpm: 127, stream: kicks(141) });
  assert.equal(r.ctl.value, null);
  r.run(12);
  assert.ok(Math.abs(r.ctl.value - 141) <= 2, `got ${r.ctl.value}`);
  r.audio.handlers.seeked();
  assert.equal(r.ctl.value, null);
  r.run(12);
  assert.ok(r.ctl.value !== null);
  r.player.current = { id: 's2', bpm: 100 };
  r.player.fire();
  assert.equal(r.ctl.value, null);
});

test('values above 200 BPM are reported as measured', () => {
  const r = rig({ stored: '1', bpm: 127, stream: segment({ bpm: 1000, seconds: 20, kind: 'click', seed: 2 }) });
  r.run(12);
  assert.ok(Math.abs(r.ctl.value - 1000) <= 20, `got ${r.ctl.value}`);
});

test('a tempo step is followed within 3 seconds', () => {
  const stream = concat([kicks(120, 14, 1), kicks(174, 14, 2)]);
  const r = rig({ stored: '1', bpm: 140, stream });
  r.run(13);
  assert.ok(Math.abs(r.ctl.value - 120) <= 2, `got ${r.ctl.value}`);
  r.run(4);
  assert.ok(Math.abs(r.ctl.value - 174) <= 3, `got ${r.ctl.value}`);
});

test('the value keeps one decimal', () => {
  const r = rig({ stored: '1', bpm: 127, stream: kicks(141) });
  r.run(12);
  assert.equal(r.ctl.value, Math.round(r.ctl.value * 10) / 10);
});

test('silence for 1.5 seconds sets silent and clears the value, sound brings it back', () => {
  const stream = concat([kicks(120, 10, 1), new Float32Array(RATE * 4), kicks(120, 12, 2)]);
  const r = rig({ stored: '1', bpm: 120, stream });
  r.run(10);
  assert.ok(r.ctl.value !== null);
  assert.equal(r.ctl.silent, false);
  r.run(3);
  assert.equal(r.ctl.silent, true);
  assert.equal(r.ctl.value, null);
  r.run(10);
  assert.equal(r.ctl.silent, false);
  assert.ok(r.ctl.value !== null);
});

test('a long gap between samples drops the history', () => {
  const r = rig({ stored: '1', bpm: 120, stream: kicks(120) });
  r.run(10);
  assert.ok(r.ctl.value !== null);
  r.clock.pos += RATE * 3;
  for (const { f, ms } of r.intervals.values()) if (ms === 40) f();
  for (let i = 0; i < 8; i += 1) for (const { f, ms } of r.intervals.values()) if (ms === PUBLISH_MS) f();
  assert.equal(r.ctl.value, null);
});

test('value is hidden while the toggle is off', () => {
  const r = rig({ stored: '1', stream: kicks(141) });
  r.run(12);
  r.ctl.setOn(false);
  assert.equal(r.ctl.value, null);
});

test('notifies listeners when the value changes', () => {
  const r = rig({ stored: '1', stream: kicks(120) });
  let n = 0;
  r.ctl.onChange(() => { n += 1; });
  r.run(12);
  assert.ok(n >= 1);
});

test('default timers work when the browser demands a Window this', () => {
  const real = { si: globalThis.setInterval, ci: globalThis.clearInterval };
  const live = new Set();
  let nextId = 1;
  globalThis.setInterval = function (f, ms) {
    if (this !== undefined && this !== globalThis) throw new TypeError("'setInterval' called on an object that does not implement interface Window.");
    const id = nextId++;
    live.add(id);
    return id;
  };
  globalThis.clearInterval = function (id) {
    if (this !== undefined && this !== globalThis) throw new TypeError("'clearInterval' called on an object that does not implement interface Window.");
    live.delete(id);
  };
  try {
    const player = { current: { id: 's1', bpm: 120 }, playing: true, onChange: () => () => {} };
    const audio = { addEventListener() {}, removeEventListener() {} };
    const ctl = createLiveBpmController({ audio, player, getAnalyser: () => null, getContext: () => null, read: () => '1', write: () => {} });
    assert.equal(live.size, 2);
    ctl.dispose();
    assert.equal(live.size, 0);
  } finally {
    globalThis.setInterval = real.si;
    globalThis.clearInterval = real.ci;
  }
});
