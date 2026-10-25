import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateIntervals, IOI_MIN_EXPLAINED, IOI_MIN_CONFIDENCE, IOI_MIN_S, IOI_MAX_S } from './live-bpm.js';

const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const regular = (period, windowS, start = 0.05) => {
  const times = [];
  for (let t = start; t < windowS; t += period) times.push(t);
  return times;
};

const flat = (times) => times.map(() => 10);

const messy = (period, windowS, seed, { present = 0.85, extras = 0.15, jitter = 0.02 } = {}) => {
  const rnd = lcg(seed);
  const raw = [];
  for (let t = 0.1; t < windowS; t += period) {
    if (rnd() < present) raw.push(t + (rnd() * 2 - 1) * jitter);
    if (rnd() < extras) raw.push(t + period * (0.25 + 0.5 * rnd()));
  }
  raw.sort((a, b) => a - b);
  return raw.filter((t, i) => i === 0 || t - raw[i - 1] >= 0.12 - 1e-9);
};

const poisson = (rate, windowS, seed) => {
  const rnd = lcg(seed);
  const times = [];
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rnd()) / rate;
    if (t >= windowS) return times;
    if (!times.length || t - times.at(-1) >= 0.12) times.push(t);
  }
};

test('STU-042: the thresholds are 60 percent explained, 0.4 confidence and a 0.2 to 2 s interval range', () => {
  assert.equal(IOI_MIN_EXPLAINED, 0.6);
  assert.equal(IOI_MIN_CONFIDENCE, 0.4);
  assert.equal(IOI_MIN_S, 0.2);
  assert.equal(IOI_MAX_S, 2);
});

test('STU-042: evenly spaced hits read their rate with full confidence', () => {
  for (const [period, bpm] of [[0.5, 120], [0.25, 240], [0.4, 150], [0.6, 100]]) {
    const times = regular(period, 8);
    const res = estimateIntervals(times, flat(times), 8);
    assert.ok(Math.abs(res.bpm - bpm) < 0.5, `${bpm}: ${res?.bpm}`);
    assert.equal(res.confidence, 1);
    assert.equal(res.explained, 1);
  }
});

test('STU-042: the fundamental wins over its multiples and the hit rate wins over a slower pattern', () => {
  const times = regular(0.5, 8);
  assert.ok(Math.abs(estimateIntervals(times, flat(times), 8).bpm - 120) < 0.5);
  const fast = regular(0.25, 8);
  assert.ok(Math.abs(estimateIntervals(fast, flat(fast), 8).bpm - 240) < 0.5);
  const slow = regular(1, 8);
  assert.ok(Math.abs(estimateIntervals(slow, flat(slow), 8).bpm - 60) < 0.5);
});

test('STU-042: fewer than four periods in the window, or fewer than five hits, read nothing', () => {
  const slow = regular(1, 4);
  assert.equal(estimateIntervals(slow, flat(slow), 4), null);
  const few = [0.5, 1, 1.5, 2];
  assert.equal(estimateIntervals(few, flat(few), 8), null);
  const quick = regular(0.5, 1);
  assert.equal(estimateIntervals(quick, flat(quick), 1), null);
  const fast = regular(0.24, 1, 0.01);
  assert.ok(Math.abs(estimateIntervals(fast, flat(fast), 1).bpm - 250) < 1);
  assert.equal(estimateIntervals([], [], 8), null);
  assert.equal(estimateIntervals(regular(0.5, 8), flat(regular(0.5, 8)), 0), null);
});

test('STU-042: dropouts, extra hits and timing jitter still read the period (the owner screenshot: about 0.42 s, 143 BPM)', () => {
  let near = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const times = messy(0.42, 8, seed);
    const res = estimateIntervals(times, times.map((_, i) => 6 + (i % 5)), 8);
    if (res && Math.abs(res.bpm / (60 / 0.42) - 1) < 0.04) {
      near += 1;
      assert.ok(res.confidence >= IOI_MIN_CONFIDENCE);
      assert.ok(res.explained >= IOI_MIN_EXPLAINED);
    }
  }
  assert.ok(near >= 17, `${near} of 20`);
});

test('STU-042: longer windows read a jittery train more often than short ones', () => {
  const reads = (windowS) => {
    let n = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const times = messy(0.42, windowS, seed, { jitter: 0.04 });
      if (estimateIntervals(times, flat(times), windowS)) n += 1;
    }
    return n;
  };
  assert.ok(reads(30) >= reads(4));
  assert.ok(reads(30) >= 15);
});

test('STU-042: random hits at 2.4 per second read nothing in at least 95 percent of 200 trials, in every window', () => {
  for (const windowS of [1, 4, 8, 15, 30]) {
    let reads = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const times = poisson(2.4, windowS, seed * 104729);
      if (estimateIntervals(times, times.map(() => 10), windowS)) reads += 1;
    }
    assert.ok(reads <= 10, `${windowS} s: ${reads} of 200`);
  }
});

test('STU-042: the estimate does not change its inputs and is deterministic', () => {
  const times = messy(0.42, 8, 3);
  const strengths = times.map((_, i) => 5 + (i % 4));
  const copy = times.slice();
  const first = estimateIntervals(times, strengths, 8);
  assert.deepEqual(times, copy);
  assert.deepEqual(estimateIntervals(times, strengths, 8), first);
});
