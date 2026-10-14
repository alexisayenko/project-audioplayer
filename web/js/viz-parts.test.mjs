import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bandWeights, createPartsSplitter, createPartsFilter, hpssMasks, combineWeights, defaultParts, validateParts, toggleParts, allOn, lowWeight,
} from './viz-parts.js';

const N = 120;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const frame = (fn) => Float32Array.from({ length: N }, (_, i) => fn(i));

test('band weights partition to 1 at every bar and order bass < mids < highs', () => {
  for (const n of [96, 300, 480]) {
    const w = bandWeights(n);
    for (let i = 0; i < n; i += 1) {
      assert.ok(Math.abs(w.bass[i] + w.mids[i] + w.highs[i] - 1) < 1e-5);
      assert.ok(w.bass[i] >= 0 && w.mids[i] >= 0 && w.highs[i] >= 0);
    }
    assert.equal(w.bass[0], 1);
    assert.equal(w.highs[n - 1], 1);
    assert.ok(w.mids[Math.floor(n * 0.5)] > 0.99 || w.mids[Math.floor(n * 0.45)] > 0.5);
  }
});

test('crossover is a smooth raised cosine one third of an octave wide', () => {
  assert.equal(lowWeight(250 * 2 ** -0.2, 250), 1);
  assert.equal(lowWeight(250 * 2 ** 0.2, 250), 0);
  assert.ok(Math.abs(lowWeight(250, 250) - 0.5) < 1e-9);
  let prev = 1;
  for (let k = -20; k <= 20; k += 1) {
    const v = lowWeight(250 * 2 ** (k / 60), 250);
    assert.ok(v <= prev + 1e-12);
    prev = v;
  }
});

test('steady tone is Melody, click train is Beats', () => {
  const tone = Array.from({ length: 20 }, () => frame((i) => (i === 60 ? 0.9 : 0.02)));
  const m = hpssMasks(tone, 19);
  assert.ok(m.melody[60] > 0.8, `melody ${m.melody[60]}`);
  assert.ok(m.beats[60] < 0.2);
  const clicks = Array.from({ length: 20 }, (_, k) => frame(() => (k % 8 === 0 ? 0.8 : 0.01)));
  const c = hpssMasks(clicks, 16);
  assert.ok(mean(c.beats) > 0.8, `beats ${mean(c.beats)}`);
  assert.ok(mean(c.melody) < 0.2);
});

test('flat noise lands in Other and the three weights sum to 1', () => {
  const noise = Array.from({ length: 20 }, () => frame(() => 0.3));
  const m = hpssMasks(noise, 19);
  for (let i = 0; i < N; i += 1) {
    assert.ok(Math.abs(m.beats[i] + m.melody[i] + m.other[i] - 1) < 1e-5);
  }
  assert.ok(mean(m.other) > 0.9);
});

test('offline window with future frames is symmetric around the centre', () => {
  const seq = Array.from({ length: 21 }, (_, k) => frame((i) => (i === 40 ? (k >= 10 ? 0.8 : 0.1) : 0.05)));
  const fwd = hpssMasks(seq, 10, { from: 0, to: 20 });
  const rev = hpssMasks(seq.slice().reverse(), 10, { from: 0, to: 20 });
  for (let i = 0; i < N; i += 1) assert.ok(Math.abs(fwd.melody[i] - rev.melody[i]) < 1e-6);
  const causal = hpssMasks(seq, 10, { from: 0, to: 10 });
  assert.notEqual(causal.melody[40], fwd.melody[40]);
});

test('splitter push returns freq and behav weights and uses future frames', () => {
  const sp = createPartsSplitter();
  const f = frame((i) => (i === 60 ? 0.9 : 0.02));
  let r;
  for (let k = 0; k < 20; k += 1) r = sp.push(f, k / 30);
  assert.equal(r.freq.bass.length, N);
  assert.ok(r.behav.melody[60] > 0.8);
  const extra = createPartsSplitter();
  const r2 = extra.push(f, 0, [f, f, f]);
  assert.equal(r2.behav.melody.length, N);
  sp.reset();
  assert.equal(sp.frames, 0);
});

test('window is bounded by time and frame count', () => {
  const sp = createPartsSplitter({ maxFrames: 16 });
  const f = frame(() => 0.1);
  for (let k = 0; k < 200; k += 1) sp.push(f, k / 60);
  assert.ok(sp.frames <= 16);
});

test('combine: neutral rows, multiplicative rows, clamped sums', () => {
  const n = 4;
  const masks = {
    freq: { bass: Float32Array.of(1, 0.5, 0, 0), mids: Float32Array.of(0, 0.5, 1, 0), highs: Float32Array.of(0, 0, 0, 1) },
    behav: { beats: Float32Array.of(1, 1, 0, 0), melody: Float32Array.of(0, 0, 1, 0.5), other: Float32Array.of(0, 0, 0, 0.5) },
  };
  assert.deepEqual([...combineWeights(defaultParts(), masks)], [1, 1, 1, 1]);
  const s = defaultParts();
  s.freq.bass = false;
  assert.deepEqual([...combineWeights(s, masks)], [0, 0.5, 1, 1]);
  s.behav.melody = false;
  assert.deepEqual([...combineWeights(s, masks)], [0, 0.5, 0, 0.5]);
  assert.equal(combineWeights(s, masks).length, n);
});

test('last toggle of a row refuses to turn off', () => {
  let s = defaultParts();
  s = toggleParts(s, 'freq', 'bass').state;
  s = toggleParts(s, 'freq', 'mids').state;
  const r = toggleParts(s, 'freq', 'highs');
  assert.ok(r.refused && !r.changed);
  assert.equal(r.state.freq.highs, true);
  const back = toggleParts(s, 'freq', 'bass');
  assert.ok(back.changed && back.state.freq.bass);
  assert.ok(allOn(toggleParts(back.state, 'freq', 'mids').state));
});

test('persistence validation falls back to defaults', () => {
  assert.deepEqual(validateParts(null), defaultParts());
  assert.deepEqual(validateParts('{bad'), defaultParts());
  assert.deepEqual(validateParts('[]'), defaultParts());
  const ok = validateParts(JSON.stringify({ freq: { bass: false, mids: true, highs: true }, behav: { beats: true, melody: true, other: true } }));
  assert.equal(ok.freq.bass, false);
  const allOff = validateParts({ freq: { bass: false, mids: false, highs: false }, behav: { beats: false, melody: true, other: 'x' } });
  assert.deepEqual(allOff.freq, defaultParts().freq);
  assert.deepEqual(allOff.behav, { beats: false, melody: true, other: true });
});

test('filter does no work when everything is on and dims smoothly otherwise', () => {
  const filt = createPartsFilter();
  const shaped = frame(() => 0.5);
  const lv = frame(() => 0.5);
  assert.equal(filt.apply(lv, shaped, 0), shaped);
  assert.equal(filt.active, false);
  const s = defaultParts();
  s.freq.bass = false;
  s.freq.mids = false;
  filt.setState(s);
  const a = filt.apply(lv, shaped, 0.0);
  const first = a[N - 1];
  const b = filt.apply(lv, shaped, 0.033);
  assert.ok(b[0] < 0.5 && b[0] > 0, 'bass bar is dimming, not cut');
  assert.ok(first > 0.45);
  let out;
  for (let k = 2; k < 60; k += 1) out = filt.apply(lv, shaped, k / 30);
  assert.ok(out[0] < 0.01);
  assert.ok(Math.abs(out[N - 1] - 0.5) < 0.01);
  filt.setState(defaultParts());
  for (let k = 60; k < 120; k += 1) out = filt.apply(lv, shaped, k / 30);
  assert.equal(out, shaped);
  assert.equal(filt.active, false);
});
