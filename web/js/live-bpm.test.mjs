import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBpm, estimateFromEnvelope, MAX_BPM, MIN_BPM } from './live-bpm.js';
import { segment, concat, feed } from './live-bpm-synth.mjs';

const detect = (audio, hint = null) => {
  const det = createLiveBpm();
  if (hint) det.setHint(hint);
  feed(det, audio);
  return det.estimateExact();
};

const near = (got, want, tolerance) => got !== null && Math.abs(got / want - 1) <= tolerance;

test('the search range covers 30 to 1200 BPM', () => {
  assert.equal(MIN_BPM, 30);
  assert.equal(MAX_BPM, 1200);
});

for (const bpm of [60, 90, 120, 139, 174, 200]) {
  test(`kick track at ${bpm} BPM gives the tempo within 1%`, () => {
    const got = detect(segment({ bpm, seconds: 12, kind: 'kick', phase: 0.21, seed: bpm }));
    assert.ok(near(got, bpm, 0.01), `got ${got}`);
  });
}

for (const bpm of [30, 45, 75, 128, 300, 600, 1000, 1200]) {
  test(`click track at ${bpm} BPM gives the tempo within 2%`, () => {
    const got = detect(segment({ bpm, seconds: 12, kind: 'click', phase: 0.07, seed: bpm }));
    assert.ok(near(got, bpm, 0.02), `got ${got}`);
  });
}

test('jitter and noise do not fold a fast click track', () => {
  const got = detect(segment({ bpm: 1000, seconds: 12, kind: 'click', jitter: 0.001, noise: 0.03, seed: 5 }));
  assert.ok(near(got, 1000, 0.02), `got ${got}`);
});

test('the value is not rounded to the usual 60 to 200 window', () => {
  const det = createLiveBpm();
  feed(det, segment({ bpm: 1000, seconds: 12, kind: 'click', seed: 2 }));
  assert.ok(det.estimate() > 900);
});

test('no estimate before enough audio', () => {
  const det = createLiveBpm();
  feed(det, segment({ bpm: 139, seconds: 2, kind: 'kick' }));
  assert.equal(det.estimate(), null);
  assert.equal(estimateFromEnvelope([], 400), null);
});

test('silence and constant noise give no estimate', () => {
  assert.equal(detect(new Float32Array(44100 * 8)), null);
  assert.equal(detect(segment({ bpm: 120, seconds: 8, kind: 'click', noise: 0.2, times: [] })), null);
});

function alternating(bpm, weak, rate = 400, seconds = 6) {
  const out = new Float32Array(rate * seconds);
  const period = 60 / bpm;
  for (let k = 0; k * period < seconds; k += 1) {
    const i = Math.round(k * period * rate);
    const amp = k % 2 === 0 ? 1 : weak;
    for (const [d, g] of [[-1, 0.5], [0, 1], [1, 0.5]]) if (i + d >= 0 && i + d < out.length) out[i + d] += amp * g;
  }
  return out;
}

test('the stored BPM breaks a near tie between a half and a double', () => {
  const env = alternating(140, 0.6);
  assert.ok(near(estimateFromEnvelope(env, 400), 70, 0.01));
  assert.ok(near(estimateFromEnvelope(env, 400, 70), 70, 0.01));
  assert.ok(near(estimateFromEnvelope(env, 400, 140), 140, 0.01));
});

test('the stored BPM never folds a clearly stronger candidate', () => {
  assert.ok(near(estimateFromEnvelope(alternating(140, 0.3), 400, 140), 70, 0.01));
  assert.ok(near(estimateFromEnvelope(alternating(140, 0.9), 400, 70), 70, 0.01) || near(estimateFromEnvelope(alternating(140, 0.9), 400, 70), 140, 0.01));
  const clicks = segment({ bpm: 1000, seconds: 12, kind: 'click', seed: 3 });
  for (const hint of [127, 125, 250, 500]) assert.ok(near(detect(clicks, hint), 1000, 0.02), `hint ${hint}`);
});

test('reset clears the audio', () => {
  const det = createLiveBpm();
  feed(det, segment({ bpm: 120, seconds: 10, kind: 'kick' }));
  assert.ok(det.estimate() !== null);
  det.reset();
  assert.equal(det.estimate(), null);
  assert.equal(det.envelopeLength(), 0);
});

test('a tempo step is followed within 3.5 seconds', () => {
  const det = createLiveBpm();
  const first = segment({ bpm: 120, seconds: 12, kind: 'kick', seed: 1 });
  const second = segment({ bpm: 174, seconds: 12, kind: 'kick', seed: 2 });
  feed(det, first);
  assert.ok(near(det.estimateExact(), 120, 0.01));
  feed(det, second.subarray(0, Math.round(44100 * 3.5)));
  assert.ok(near(det.estimateExact(), 174, 0.01), `got ${det.estimateExact()}`);
});

test('concatenated segments of 120, 140 and 174 BPM end on the last tempo', () => {
  const audio = concat([120, 140, 174].map((bpm, i) => segment({ bpm, seconds: 10, kind: 'kick', seed: i + 1 })));
  assert.ok(near(detect(audio), 174, 0.01));
});

test('the sample rate may change between pushes', () => {
  const det = createLiveBpm();
  feed(det, segment({ bpm: 100, seconds: 8, kind: 'kick', sampleRate: 48000 }), 48000);
  assert.ok(near(det.estimateExact(), 100, 0.02));
  feed(det, segment({ bpm: 100, seconds: 8, kind: 'kick', sampleRate: 44100 }), 44100);
  assert.ok(near(det.estimateExact(), 100, 0.02));
});
