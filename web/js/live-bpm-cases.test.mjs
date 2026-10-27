import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLiveBpm } from './live-bpm.js';
import { rmsOf, levelFraction } from './mic-bpm.js';
import { liveBpmLabel } from './bpm-label.js';
import { segment, feed } from './live-bpm-synth.mjs';

const cases = JSON.parse(fs.readFileSync(new URL('../../server/tests/fixtures/live_bpm_cases.json', import.meta.url), 'utf8'));

test('liveBpmLabel matches the shared cases', () => {
  for (const c of cases.label) assert.equal(liveBpmLabel(c.bpm), c.label, String(c.bpm));
});

test('rmsOf matches the shared cases', () => {
  for (const c of cases.rms) assert.ok(Math.abs(rmsOf(c.samples) - c.rms) < 1e-9, JSON.stringify(c.samples));
});

test('levelFraction matches the shared cases', () => {
  for (const c of cases.level) assert.ok(Math.abs(levelFraction(c.rms) - c.fraction) < 1e-6, String(c.rms));
});

for (const c of cases.tempo) {
  test(`a clean kick track at ${c.bpm} BPM is detected within ${c.tolerance * 100}%`, () => {
    const det = createLiveBpm();
    feed(det, segment({ bpm: c.bpm, seconds: c.seconds, kind: 'kick', phase: c.phase, hats: false }), 44100, 2205);
    const got = det.estimateExact();
    assert.ok(got !== null && Math.abs(got / c.bpm - 1) <= c.tolerance, `got ${got}`);
  });
}
