import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBpm, estimateFromEnvelope, estimateWindowFromEnvelope, gateWindows, gateLong, windowFrames, historyFrames, MAX_BPM, MIN_BPM, WINDOWS_S, MIN_PERIODS, HISTORY_S } from './live-bpm.js';
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

test('WEB-208: the six analysis windows are 1, 4, 8, 15, 30 and 60 s and the history keeps 60 s', () => {
  assert.deepEqual(WINDOWS_S, [1, 4, 8, 15, 30, 60]);
  assert.equal(HISTORY_S, 60);
  assert.equal(MIN_PERIODS, 4);
});

test('WEB-208: a window holds more than 4 beat periods or it shows nothing (120 BPM: 1 s no, 4 s yes; 60 BPM: 4 s no, 8 s yes)', () => {
  assert.equal(estimateWindowFromEnvelope(alternating(120, 1, 400, 1), 400, 1), null);
  const four = estimateWindowFromEnvelope(alternating(120, 1, 400, 4), 400, 4);
  assert.ok(near(four.bpm, 120, 0.01), String(four?.bpm));
  assert.ok(four.beatsInWindow > 7.5 && four.beatsInWindow < 8.5);
  assert.ok(four.confidence > 0.3 && four.confidence <= 1);
  assert.equal(estimateWindowFromEnvelope(alternating(60, 1, 400, 4), 400, 4), null);
  assert.ok(near(estimateWindowFromEnvelope(alternating(60, 1, 400, 8), 400, 8)?.bpm ?? null, 60, 0.01));
});

test('WEB-208: at 1000 BPM every window has enough beats, down to 1 s', () => {
  for (const seconds of [1, 4, 8]) {
    const res = estimateWindowFromEnvelope(alternating(1000, 1, 400, seconds), 400, seconds);
    assert.ok(near(res?.bpm ?? null, 1000, 0.02), `${seconds} s: ${res?.bpm}`);
  }
});

test('WEB-208: a window that is not full yet, or a flat envelope, shows nothing', () => {
  assert.equal(estimateWindowFromEnvelope(alternating(120, 1, 400, 3), 400, 4), null);
  assert.equal(estimateWindowFromEnvelope(new Float32Array(1600).fill(0.5), 400, 4), null);
  assert.equal(estimateWindowFromEnvelope([], 400, 4), null);
  assert.equal(estimateWindowFromEnvelope(alternating(120, 1, 400, 4), 400, 0), null);
});

test('WEB-208: the engine keeps a 60 s history only when asked and clears it on reset', () => {
  const audio = segment({ bpm: 120, seconds: 20, kind: 'kick', phase: 0.21, seed: 3 });
  const det = createLiveBpm({ historyS: HISTORY_S });
  feed(det, audio);
  assert.equal(det.estimateWindow(1), null);
  for (const s of [4, 8, 15]) assert.ok(near(det.estimateWindow(s)?.bpm ?? null, 120, 0.01), String(s));
  assert.equal(det.estimateWindow(30), null);
  assert.equal(det.estimateWindows().length, WINDOWS_S.length);
  const plain = createLiveBpm();
  feed(plain, audio);
  assert.equal(plain.estimateWindow(4), null);
  assert.ok(near(plain.estimateExact(), 120, 0.01));
  det.reset();
  assert.equal(det.estimateWindow(4), null);
});

test('WEB-208: the main estimate is the same with and without the history', () => {
  const audio = segment({ bpm: 139, seconds: 12, kind: 'kick', phase: 0.21, seed: 5 });
  const withHistory = createLiveBpm({ historyS: HISTORY_S });
  const without = createLiveBpm();
  feed(withHistory, audio);
  feed(without, audio);
  assert.equal(withHistory.estimateExact(), without.estimateExact());
});

test('WEB-208: a window that disagrees with the shorter ones is dropped (two tempos in one window), a short octave is dropped, a real change is kept', () => {
  const mk = (bpm) => ({ bpm, confidence: 0.9, beatsInWindow: 10 });
  const seconds = [1, 4, 8, 15, 30, 60];
  const bpms = (list) => list.map((r) => r && r.bpm);
  assert.deepEqual(bpms(gateWindows(seconds, [null, mk(120), mk(120), mk(120), mk(120), mk(120)])), [null, 120, 120, 120, 120, 120]);
  assert.deepEqual(bpms(gateWindows(seconds, [null, mk(150), mk(150), mk(150), mk(30), mk(30)])), [null, 150, 150, 150, null, null]);
  assert.deepEqual(bpms(gateWindows(seconds, [null, mk(120), mk(120), mk(120), mk(30), mk(120)])), [null, 120, 120, 120, null, 120]);
  assert.deepEqual(bpms(gateWindows(seconds, [mk(300), mk(150), mk(150), mk(150), mk(150), mk(150)])), [null, 150, 150, 150, 150, 150]);
  assert.deepEqual(bpms(gateWindows(seconds, [mk(900), mk(1000), mk(1000), mk(1000), mk(1000), mk(1000)])), [900, 1000, 1000, 1000, 1000, 1000]);
});

test('WEB-208: a long window that reads exactly half of the shorter ones (the two-beat period) is shown in their octave, not dropped', () => {
  const mk = (bpm) => ({ bpm, confidence: 0.9, beatsInWindow: 10 });
  const seconds = [1, 4, 8, 15, 30, 60];
  const bpms = (list) => list.map((r) => r && r.bpm);
  assert.deepEqual(bpms(gateWindows(seconds, [null, mk(128), mk(128), mk(64), mk(64), mk(64)])), [null, 128, 128, 128, 128, 128]);
  assert.deepEqual(bpms(gateWindows(seconds, [null, mk(128), mk(64.6), mk(63.9), mk(64.2), mk(64.1)])), [null, 128, 129.2, 127.8, 128.4, 128.2]);
  assert.deepEqual(gateLong(mk(128), mk(64)), { bpm: 128, confidence: 0.9, beatsInWindow: 20 });
  assert.equal(gateLong(mk(120), mk(30)), null);
  assert.equal(gateLong(mk(150), mk(30)), null);
  assert.equal(gateLong(mk(128), mk(72)), null);
  assert.equal(gateLong(mk(128), mk(100)), null);
  assert.deepEqual(gateLong(mk(128), mk(126)), mk(126));
});

test('WEB-208: a window is as long as the history can hold at every sample rate, so a full 60 s window is never refused for its length', () => {
  for (const sampleRate of [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 192000]) {
    const hop = Math.max(1, Math.round(sampleRate / 400));
    const rate = sampleRate / hop;
    for (const seconds of WINDOWS_S) assert.ok(windowFrames(seconds, rate) <= historyFrames(HISTORY_S, rate), `${sampleRate} Hz, ${seconds} s`);
  }
  assert.equal(historyFrames(0, 400), 0);
  assert.equal(historyFrames(60, 400), 24000);
  assert.equal(windowFrames(60, 400), 24000);
});
