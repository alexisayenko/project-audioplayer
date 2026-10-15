import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSignal, limitFlash, FLASH_SWING } from './viz-synth-signal.js';

const loud = new Array(64).fill(1);
const quiet = new Array(64).fill(0);

test('limitFlash steps are capped by swing and rate, and stay in 0..1', () => {
  assert.ok(limitFlash(0, 1, 0.5) <= FLASH_SWING + 1e-9);
  assert.ok(Math.abs(limitFlash(0, 1, 1 / 60) - 1.5 / 60) < 1e-9);
  assert.equal(limitFlash(0.5, 0.5, 0.1), 0.5);
  assert.equal(limitFlash(1, 5, 0.1), 1);
  assert.equal(limitFlash(0, -3, 0.1), 0);
  assert.equal(limitFlash(NaN, NaN, NaN), 0);
  assert.ok(limitFlash(1, 0, 0.5) >= 0.75 - 1e-9);
});

test('a strobing target gives at most 3 up-crossings of the mid level per second', () => {
  for (const period of [1, 2, 3, 6, 12, 30]) {
    const sig = createSignal();
    const dt = 1 / 60;
    let ups = 0;
    let prev = 0;
    let maxSwing = 0;
    for (let i = 0; i < 600; i += 1) {
      const s = sig.step(Math.floor(i / period) % 2 ? loud : quiet, dt, false);
      if (prev < 0.5 && s.flash >= 0.5) ups += 1;
      maxSwing = Math.max(maxSwing, Math.abs(s.flash - prev));
      prev = s.flash;
    }
    assert.ok(ups <= 30, `period ${period}: ${ups} in 10 s`);
    assert.ok(maxSwing <= FLASH_SWING + 1e-9);
  }
});

test('up-crossings are limited in any 1 s window', () => {
  const sig = createSignal();
  const times = [];
  let prev = 0;
  for (let i = 0; i < 1200; i += 1) {
    const s = sig.step(Math.floor(i / 4) % 2 ? loud : quiet, 1 / 60, false);
    if (prev < 0.5 && s.flash >= 0.5) times.push(i / 60);
    prev = s.flash;
  }
  for (let k = 0; k + 3 < times.length; k += 1) assert.ok(times[k + 3] - times[k] >= 1 - 1e-9, `${times[k]} ${times[k + 3]}`);
});

test('signal followers: bass and energy slow, pulse fast, flash bounded by pulse', () => {
  const sig = createSignal();
  let s;
  for (let i = 0; i < 30; i += 1) s = sig.step(loud, 1 / 30, false);
  assert.ok(s.pulse > 0.9);
  assert.ok(s.energy < s.pulse);
  assert.ok(s.bass > 0.3 && s.bass < 1);
  assert.ok(s.flash <= s.pulse + 1e-9);
  for (let i = 0; i < 600; i += 1) s = sig.step(loud, 1 / 30, false);
  assert.ok(s.bass > 0.99 && s.energy > 0.99);
  for (const k of ['bass', 'energy', 'pulse', 'flash']) assert.ok(s[k] >= 0 && s[k] <= 1);
});

test('signal tolerates empty, null spectra and bad dt', () => {
  const sig = createSignal();
  const s = sig.step(null, NaN, false);
  assert.deepEqual({ ...s }, { bass: 0, energy: 0, pulse: 0, flash: 0 });
  assert.doesNotThrow(() => sig.step([], -5, false));
});

test('reduced motion is the constant 0.3 signal and does not move the followers', () => {
  const sig = createSignal();
  for (let i = 0; i < 5; i += 1) assert.deepEqual({ ...sig.step(loud, 0.1, true) }, { bass: 0.3, energy: 0.3, pulse: 0.3, flash: 0.3 });
  assert.equal(sig.step(quiet, 0.1, false).pulse, 0);
});
