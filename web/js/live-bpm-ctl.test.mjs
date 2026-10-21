import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBpmController, lowBandEnergy, LIVE_BPM_KEY } from './live-bpm-ctl.js';
import { clickEnergy } from './live-bpm-synth.mjs';

function rig({ stored = '0', bpm = 139 } = {}) {
  const mem = { [LIVE_BPM_KEY]: stored };
  const audio = { handlers: {}, addEventListener(n, f) { this.handlers[n] = f; }, removeEventListener(n) { delete this.handlers[n]; } };
  const player = { current: { id: 's1', bpm }, playing: true, subs: new Set(), onChange(f) { this.subs.add(f); return () => this.subs.delete(f); }, fire() { this.subs.forEach((f) => f()); } };
  const intervals = new Map();
  let nextId = 1;
  const timers = { setInterval: (f, ms) => { intervals.set(nextId, { f, ms }); return nextId++; }, clearInterval: (id) => intervals.delete(id) };
  const clock = { t: 0 };
  const frames = { list: [], i: 0 };
  const analyser = {
    frequencyBinCount: 4096,
    getByteFrequencyData(b) { const e = frames.list[Math.min(frames.i, frames.list.length - 1)].e; b.fill(Math.round(e * 255)); },
  };
  const ctl = createLiveBpmController({
    audio, player, getAnalyser: () => analyser, getSampleRate: () => 48000, now: () => clock.t, timers,
    read: () => mem[LIVE_BPM_KEY], write: (v) => { mem[LIVE_BPM_KEY] = v; },
  });
  const feed = (list) => {
    frames.list = list;
    for (frames.i = 0; frames.i < list.length; frames.i += 1) {
      clock.t = list[frames.i].t;
      for (const { f, ms } of intervals.values()) if (ms === 25) f();
    }
    for (const { f, ms } of intervals.values()) if (ms === 1000) f();
  };
  return { ctl, mem, audio, player, intervals, feed };
}

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

test('live value appears after a click track and is cleared by seek and song change', () => {
  const r = rig({ stored: '1' });
  assert.equal(r.ctl.value, null);
  r.feed(clickEnergy(141, 10));
  assert.ok(Math.abs(r.ctl.value - 141) <= 1, `got ${r.ctl.value}`);
  r.audio.handlers.seeked();
  assert.equal(r.ctl.value, null);
  r.feed(clickEnergy(141, 10));
  assert.ok(r.ctl.value !== null);
  r.player.current = { id: 's2', bpm: 100 };
  r.player.fire();
  assert.equal(r.ctl.value, null);
});

test('value is hidden while the toggle is off', () => {
  const r = rig({ stored: '1' });
  r.feed(clickEnergy(141, 10));
  r.ctl.setOn(false);
  assert.equal(r.ctl.value, null);
});

test('notifies listeners when the value changes', () => {
  const r = rig({ stored: '1' });
  let n = 0;
  r.ctl.onChange(() => { n += 1; });
  r.feed(clickEnergy(120, 10));
  assert.ok(n >= 1);
});

test('lowBandEnergy averages only the bass bins', () => {
  const bytes = new Uint8Array(4096);
  bytes.fill(255, 5, 30);
  assert.ok(lowBandEnergy(bytes, 48000, 4096) > 0.9);
  assert.equal(lowBandEnergy(new Uint8Array(4096), 48000, 4096), 0);
});

test('default timers work when the browser demands a Window this', () => {
  const real = { si: globalThis.setInterval, ci: globalThis.clearInterval };
  const live = new Set();
  let nextId = 1;
  globalThis.setInterval = function (f, ms) {
    if (this !== globalThis) throw new TypeError("'setInterval' called on an object that does not implement interface Window.");
    const id = nextId++;
    live.add(id);
    return id;
  };
  globalThis.clearInterval = function (id) {
    if (this !== globalThis) throw new TypeError("'clearInterval' called on an object that does not implement interface Window.");
    live.delete(id);
  };
  try {
    const player = { current: { id: 's1', bpm: 120 }, playing: true, onChange: () => () => {} };
    const audio = { addEventListener() {}, removeEventListener() {} };
    const ctl = createLiveBpmController({ audio, player, getAnalyser: () => null, getSampleRate: () => 48000, read: () => '1', write: () => {} });
    assert.equal(live.size, 2);
    ctl.dispose();
    assert.equal(live.size, 0);
  } finally {
    globalThis.setInterval = real.si;
    globalThis.clearInterval = real.ci;
  }
});
