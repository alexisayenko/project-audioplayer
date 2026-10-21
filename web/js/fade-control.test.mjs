import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFader } from './fade-control.js';

function rig({ fadeIn = 0, fadeOut = 0, running = true, paused = false, time = 0, duration = 100 } = {}) {
  const handlers = {};
  const calls = [];
  const audio = {
    volume: 0.8, paused, currentTime: time, duration, playbackRate: 1,
    addEventListener: (ev, fn) => { handlers[ev] = fn; },
  };
  const fade = {
    gain: {
      cancelScheduledValues: (t) => calls.push(['cancel', t]),
      setValueAtTime: (v, t) => calls.push(['set', v, t]),
      linearRampToValueAtTime: (v, t) => calls.push(['ramp', v, t]),
    },
  };
  const ctx = { currentTime: 10, state: running ? 'running' : 'suspended' };
  const graph = {
    hasGraph: () => running,
    getContext: () => ctx,
    getFade: () => fade,
    isSupported: () => true,
    unlock: () => { calls.push(['unlock']); },
    onState: () => {},
  };
  const cfg = { fadeIn, fadeOut };
  const settings = { fadeIn: () => cfg.fadeIn, fadeOut: () => cfg.fadeOut, onChange: () => {} };
  const doc = { visibilityState: 'visible', addEventListener: () => {} };
  const fader = createFader({ audio, settings, graph, doc });
  return { audio, calls, handlers, fader, cfg };
}

test('node mode: start of a song ramps from 0 to 1 and leaves the element volume alone', () => {
  const r = rig({ fadeIn: 4 });
  r.fader.apply();
  assert.deepEqual(r.calls, [['cancel', 10], ['set', 0, 10], ['ramp', 1, 14]]);
  assert.equal(r.audio.volume, 0.8);
});

test('node mode: with both settings off the gain stays at 1 and nothing is scheduled', () => {
  const r = rig();
  r.fader.apply();
  assert.deepEqual(r.calls, [['cancel', 10], ['set', 1, 10]]);
});

test('a seek away from the start drops the fade in and puts the ramp on the fade out', () => {
  const r = rig({ fadeIn: 4, fadeOut: 3, time: 50 });
  r.handlers.seeked();
  assert.deepEqual(r.calls, [['cancel', 10], ['set', 1, 10], ['ramp', 1, 57], ['ramp', 0, 60]]);
});

test('pause holds the level without scheduling ramps', () => {
  const r = rig({ fadeOut: 3, time: 98.5, paused: true });
  r.handlers.pause();
  assert.equal(r.calls.filter((c) => c[0] === 'ramp').length, 0);
  assert.equal(r.calls.find((c) => c[0] === 'set')[1], 0.5);
});

test('reset sets the gain to 1 immediately', () => {
  const r = rig({ fadeIn: 4 });
  r.fader.apply();
  r.calls.length = 0;
  r.fader.reset();
  assert.deepEqual(r.calls, [['cancel', 10], ['set', 1, 10]]);
});

test('fallback mode scales audio.volume by the fade and keeps the user volume', () => {
  const r = rig({ fadeIn: 4, running: false, paused: true });
  r.fader.apply();
  assert.equal(r.audio.volume, 0);
  assert.equal(r.fader.userVolume(), 0.8);
  r.fader.release();
  assert.equal(r.audio.volume, 0.8);
});

test('play with a non-zero fade creates the graph, with fades off it does not', () => {
  const on = rig({ fadeOut: 3, running: false });
  on.handlers.play();
  assert.ok(on.calls.some((c) => c[0] === 'unlock'));
  on.fader.reset();
  const off = rig({ running: false });
  off.handlers.play();
  assert.ok(!off.calls.some((c) => c[0] === 'unlock'));
});

test('node mode: the ramp length is a percent of the song, held to 60 s on a long track', () => {
  const r = rig({ fadeIn: 10, duration: 600 });
  r.fader.apply();
  assert.deepEqual(r.calls, [['cancel', 10], ['set', 0, 10], ['ramp', 1, 70]]);
});

test('node mode: unknown duration starts with no fade', () => {
  const r = rig({ fadeIn: 10, duration: NaN });
  r.fader.apply();
  assert.deepEqual(r.calls, [['cancel', 10], ['set', 1, 10]]);
});
