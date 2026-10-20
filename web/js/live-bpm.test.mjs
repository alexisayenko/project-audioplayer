import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBpm, applyHint, estimateTempo } from './live-bpm.js';
import { clickEnergy } from './live-bpm-synth.mjs';

const run = (det, frames) => { for (const { t, e } of frames) det.push(t, e); };

for (const bpm of [90, 120, 139, 174]) {
  test(`click track at ${bpm} BPM gives the tempo within 1`, () => {
    const det = createLiveBpm();
    run(det, clickEnergy(bpm, 10));
    assert.ok(Math.abs(det.estimate() - bpm) <= 1, `got ${det.estimate()}`);
  });
}

test('no estimate before enough onsets', () => {
  const det = createLiveBpm();
  run(det, clickEnergy(139, 2));
  assert.equal(det.estimate(), null);
  assert.equal(estimateTempo([]), null);
});

test('silence and constant noise give no estimate', () => {
  const det = createLiveBpm();
  for (let i = 0; i < 500; i += 1) det.push(i / 50, 0.3);
  assert.equal(det.estimate(), null);
});

test('stored BPM resolves half and double errors', () => {
  assert.equal(applyHint(70, 140), 140);
  assert.equal(applyHint(140, 70), 70);
  assert.equal(applyHint(141, 140), 141);
  assert.equal(applyHint(100, 140), 100);
  assert.equal(applyHint(70, null), 70);
  assert.equal(applyHint(150, 75), 75);
  assert.equal(applyHint(100, 210), 100);
});

test('detector applies the hint', () => {
  const det = createLiveBpm();
  det.setHint(139);
  run(det, clickEnergy(139, 10));
  assert.ok(Math.abs(det.estimate() - 139) <= 1);
  const half = createLiveBpm();
  half.setHint(178);
  run(half, clickEnergy(89, 10));
  assert.ok(Math.abs(half.estimate() - 178) <= 2, `got ${half.estimate()}`);
});

test('reset clears onsets', () => {
  const det = createLiveBpm();
  run(det, clickEnergy(120, 10));
  assert.ok(det.estimate() !== null);
  det.reset();
  assert.equal(det.estimate(), null);
  assert.deepEqual(det.onsetTimes(), []);
});

test('tempo change is followed once the window slides', () => {
  const det = createLiveBpm();
  run(det, clickEnergy(100, 10));
  const later = clickEnergy(140, 12).map((f) => ({ t: f.t + 10, e: f.e }));
  run(det, later);
  assert.ok(Math.abs(det.estimate() - 140) <= 1, `got ${det.estimate()}`);
});
