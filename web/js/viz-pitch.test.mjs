import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPitchEstimator, createPitchTracker, transitionCost, idxToHz, hzToIdx, hzToU, encodePitch, decodePitch, F0_MIN, F0_MAX, PITCH_LEVELS,
  LEAD_GAIN, LEAD_MIN_CONF, SEMI_PER_IDX,
} from './viz-pitch.js';
import { samplePitch, fillLeadRidge } from './viz-melody.js';
import { createTimeline, makeTimelineBuilder } from './viz-timeline.js';
import { AMP_MAX, rowLayout } from './viz-terrain-math.js';

const SR = 44100;
const N = 8192;
const est = createPitchEstimator({ sampleRate: SR, fftSize: N, bins: 64 });
const ones = new Float32Array(64).fill(1);

function spec(partials) {
  const m = new Float64Array(N / 2);
  for (const [f, a] of partials) {
    const i = Math.round((f * N) / SR);
    m[i] += a;
    m[i - 1] += a * 0.4;
    m[i + 1] += a * 0.4;
  }
  return m;
}

const hzOf = (c) => idxToHz(c.idx);
const near = (a, b, rel) => assert.ok(Math.abs(a - b) / b < rel, `${a} vs ${b}`);

test('a sine is estimated within 2% and a harmonic stack gets its fundamental, not an octave', () => {
  const s = est.estimate(spec([[440, 0.1]]), ones);
  near(hzOf(s.cands[0]), 440, 0.02);
  assert.ok(s.conf > 0.9);
  const h = est.estimate(spec([[220, 0.1], [440, 0.08], [660, 0.06], [880, 0.05], [1100, 0.04]]), ones);
  near(hzOf(h.cands[0]), 220, 0.02);
});

test('noise and a zero melody mask give no pitch candidates', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const noise = new Float64Array(N / 2).map(() => 0.002 * rnd());
  assert.equal(est.estimate(noise, ones).cands.length, 0);
  assert.equal(est.estimate(spec([[440, 0.1]]), new Float32Array(64)).cands.length, 0);
  assert.equal(est.estimate(new Float64Array(N / 2), ones).cands.length, 0);
});

const cand = (hz, e) => ({ idx: hzToIdx(hz), e });

function run(rows) {
  const t = createPitchTracker();
  const out = [];
  for (const r of rows) out.push(...t.push({ cands: r, conf: 1 }));
  out.push(...t.finish());
  return out;
}

test('the tracker suppresses a single-row octave jump and follows a real glide', () => {
  const rows = [];
  for (let i = 0; i < 30; i += 1) rows.push(i === 15 ? [cand(440, 0.8), cand(220, 0.78)] : [cand(220, 0.8)]);
  const out = run(rows);
  assert.equal(out.length, rows.length);
  assert.ok(out.every((r) => Math.abs(idxToHz(r.idx) - 220) / 220 < 0.02));
  const glide = Array.from({ length: 30 }, (_, i) => [cand(220 * 2 ** ((i * 0.4) / 12), 0.8)]);
  const g = run(glide);
  near(idxToHz(g[29].idx), 220 * 2 ** (11.6 / 12), 0.03);
  assert.ok(transitionCost(hzToIdx(220), hzToIdx(440)) > transitionCost(hzToIdx(220), hzToIdx(220 * 2 ** (6 / 12))) - 1e-9);
  assert.equal(transitionCost(100, 105), 0);
});

test('median smoothing removes a one-row glitch and unvoiced rows stay empty', () => {
  const rows = Array.from({ length: 20 }, (_, i) => (i >= 8 && i < 11 ? [] : [cand(300, 0.8)]));
  const out = run(rows);
  assert.equal(out.length, 20);
  assert.ok(out.slice(8, 11).every((r) => r.s === 0 && r.idx === 0));
  assert.ok(out[7].s > 0 && out[12].s > 0);
});

test('byte encoding round-trips pitch within a fraction of a semitone', () => {
  for (const hz of [F0_MIN, 100, 261.6, 440, 1000, F0_MAX]) {
    const [i, s] = encodePitch(hzToIdx(hz), 0.5);
    const d = decodePitch(i, s);
    assert.ok(Math.abs(12 * Math.log2(d.hz / hz)) <= SEMI_PER_IDX / 2 + 1e-6);
    assert.ok(Math.abs(d.strength - 0.5) < 0.003);
    assert.ok(d.u >= 0 && d.u <= 1);
  }
  assert.equal(hzToIdx(1), 0);
  assert.equal(hzToIdx(99999), PITCH_LEVELS - 1);
  assert.ok(hzToU(2000) > hzToU(200));
});

function pitchTl(rows, idx, s) {
  const tl = createTimeline((rows - 1) / 16, 64, 16);
  for (let i = 0; i < tl.total; i += 1) { tl.pitch[i * 2] = idx(i); tl.pitch[i * 2 + 1] = s(i); }
  tl.pitchDone = tl.total;
  return tl;
}

test('the ridge height follows confidence x loudness, sits at the pitch column and skips unvoiced rows', () => {
  const idx = hzToIdx(440);
  const tl = pitchTl(300, () => idx, (i) => (i < 48 ? 255 : i < 96 ? 128 : 0));
  const rows = 88;
  const cols = 200;
  const h = new Float32Array(rows * cols);
  const acc = new Float32Array(rows * cols);
  const { nowRow, dt } = rowLayout(rows);
  const base = Math.round(2 / dt) + nowRow;
  fillLeadRidge(tl, base, rows, cols, h, acc);
  const at = (t) => { const r = Math.round(t / dt) - (base - nowRow); return h.subarray(r * cols, (r + 1) * cols); };
  const full = at(2.5);
  const top = full.indexOf(Math.max(...full));
  assert.ok(Math.abs(top - decodePitch(idx, 255).u * (cols - 1)) <= 1);
  assert.ok(Math.abs(Math.max(...full) * AMP_MAX - LEAD_GAIN) < 0.05);
  assert.ok(Math.abs(Math.max(...at(4.5)) * AMP_MAX - LEAD_GAIN * (128 / 255)) < 0.08);
  assert.equal(Math.max(...at(8)), 0);
  assert.ok(Math.max(...acc) > 0.5);
  const out = samplePitch(tl, 47.5 / 16);
  assert.ok(out.s > 0.3 && out.s < 1);
  assert.equal(samplePitch(tl, 999).s, 0);
  assert.ok(LEAD_MIN_CONF === 0.25);
});

test('pitch memory is a few KB per minute', () => {
  const tl = createTimeline(600, 64, 16);
  assert.equal(tl.pitch.length, tl.total * 2);
  assert.ok(tl.pitch.byteLength / 10 < 2100);
});

test('the builder tracks a steady tone through the real FFT path', () => {
  const sr = 22050;
  const pcm = new Float32Array(sr * 4);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / sr) + 0.2 * Math.sin((2 * Math.PI * 880 * i) / sr);
  const b = makeTimelineBuilder({ pcm, sampleRate: sr, bands: 128, bins: 64, rps: 16, fftSize: 4096 });
  b.step(1e9);
  assert.equal(b.pitchDone, b.total);
  const mid = 32;
  let voiced = 0;
  for (let i = 16; i < 48; i += 1) {
    if (b.pitch[i * 2 + 1] > 40 && Math.abs(idxToHz(b.pitch[i * 2]) - 440) / 440 < 0.06) voiced += 1;
  }
  assert.ok(voiced > 24, `${voiced} voiced of 32 (mid ${idxToHz(b.pitch[mid * 2])})`);
});
