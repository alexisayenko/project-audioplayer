import { test } from 'node:test';
import assert from 'node:assert/strict';

const p = await import('./pitch-detect.js');

const SR = 48000;
const N = 16384;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const tone = (f0, ns, amp = 0.5, sr = SR, gain = (n) => 1 / n) => {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i += 1) out[i] = ns.reduce((s, n) => s + gain(n) * Math.sin((2 * Math.PI * n * f0 * i) / sr), 0);
  let top = 0;
  for (const v of out) top = Math.max(top, Math.abs(v));
  return out.map((v) => (v * amp) / top);
};
const cents = (a, b) => Math.abs(1200 * Math.log2(a / b));

test('WEB-206: detectPitch finds a 220 Hz sine, a sawtooth and a tone without its fundamental at 220 Hz', () => {
  for (const ns of [[1], range(1, 10), range(2, 8), [1, 3, 5, 7]]) {
    const r = p.detectPitch(tone(220, ns), SR);
    assert.ok(r, ns.join());
    assert.ok(cents(r.freq, 220) < 5, `${ns.join()} -> ${r.freq}`);
    assert.ok(r.confidence >= 0.9, ns.join());
  }
});

test('WEB-206: detectPitch works at 44.1 kHz and at both ends of the 60 Hz to 2 kHz range', () => {
  const r = p.detectPitch(tone(220, range(1, 10), 0.5, 44100), 44100);
  assert.ok(cents(r.freq, 220) < 5);
  assert.ok(cents(p.detectPitch(tone(60, range(1, 10)), SR).freq, 60) < 10);
  assert.ok(cents(p.detectPitch(tone(2000, [1]), SR).freq, 2000) < 10);
  assert.equal(p.detectPitch(tone(55, [1]), SR), null);
  assert.equal(p.detectPitch(tone(2200, [1]), SR), null);
});

test('WEB-206: detectPitch gates silence and anything below -55 dBFS, and passes -50 dBFS', () => {
  assert.equal(p.detectPitch(new Float32Array(N), SR), null);
  assert.equal(p.detectPitch(tone(220, [1], 10 ** (-60 / 20)), SR), null);
  const quiet = p.detectPitch(tone(220, [1], 10 ** (-50 / 20)), SR);
  assert.ok(quiet && cents(quiet.freq, 220) < 5);
  assert.ok(Math.abs(p.sineRmsDb(tone(220, [1], 0.1)) + 20) < 0.1);
});

test('WEB-206: white noise has a low confidence, so no markers are drawn', () => {
  let seed = 7;
  const noise = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    noise[i] = (seed / 4294967296 - 0.5) * 0.5;
  }
  const r = p.detectPitch(noise, SR);
  assert.ok(r === null || r.confidence < p.PITCH_MIN_CONF);
});

test('WEB-206: harmonicMarks tells a real peak (solid) from a missing harmonic (hollow)', () => {
  const bins = 8192;
  const bw = SR / 2 / bins;
  const data = new Float32Array(bins).fill(-120);
  const lift = (hz, db) => {
    const k = Math.round(hz / bw);
    data[k] = db;
    data[k - 1] = db - 12;
    data[k + 1] = db - 12;
    data[k - 2] = db - 30;
    data[k + 2] = db - 30;
  };
  for (const n of [1, 2, 3, 5, 6]) lift(220 * n, -40);
  const marks = p.harmonicMarks(data, SR, 220, { offsetDb: 13.56 });
  assert.equal(marks.length, 16);
  assert.equal(p.foundList(marks), '1,2,3,5,6');
  assert.equal(marks[3].found, false);
  assert.equal(marks[0].freq, 220);
  assert.ok(Math.abs(marks[0].db + 26.44) < 0.01);
  assert.equal(p.foundList(p.harmonicMarks(new Float32Array(bins).fill(-120), SR, 220)), 'none');
});

test('WEB-206: harmonicMarks needs 6 dB above the surroundings and stops at maxHz or the Nyquist limit', () => {
  const bins = 8192;
  const flat = new Float32Array(bins).fill(-60);
  assert.equal(p.foundList(p.harmonicMarks(flat, SR, 220)), 'none');
  const bw = SR / 2 / bins;
  const weak = new Float32Array(bins).fill(-60);
  weak[Math.round(220 / bw)] = -56;
  assert.equal(p.harmonicMarks(weak, SR, 220)[0].found, false);
  assert.equal(p.harmonicMarks(flat, SR, 220, { maxHz: 1000 }).length, 4);
  assert.equal(p.harmonicMarks(flat, SR, 2000).length, 11);
});

test('WEB-206: the tracker takes the median of the last 3 estimates and ignores a low confidence one', () => {
  const t = p.createPitchTracker();
  assert.equal(t.update({ freq: 220, confidence: 0.95 }, 0).freq, 220);
  t.update({ freq: 221, confidence: 0.95 }, 70);
  assert.equal(t.update({ freq: 300, confidence: 0.95 }, 140).freq, 221);
  assert.equal(t.update({ freq: 222, confidence: 0.95 }, 210).freq, 222);
  assert.equal(t.update({ freq: 400, confidence: 0.5 }, 280).locked, false);
});

test('WEB-206: the markers fade out over about 300 ms when the pitch is lost and then reset', () => {
  const t = p.createPitchTracker();
  t.update({ freq: 220, confidence: 0.95 }, 1000);
  assert.deepEqual(t.state(1000), { freq: 220, confidence: 0.95, locked: true, alpha: 1 });
  const lost = t.update(null, 1100);
  assert.equal(lost.locked, false);
  assert.equal(lost.alpha, 1);
  assert.ok(Math.abs(t.state(1250).alpha - 0.5) < 1e-9);
  assert.equal(t.state(1400).alpha, 0);
  assert.equal(t.update(null, 1400).freq, 0);
  assert.equal(t.update({ freq: 330, confidence: 0.9 }, 1500).freq, 330);
});

test('WEB-206: a pitch that returns during the fade locks again at full alpha', () => {
  const t = p.createPitchTracker();
  t.update({ freq: 220, confidence: 0.95 }, 0);
  t.update(null, 100);
  const back = t.update({ freq: 221, confidence: 0.9 }, 200);
  assert.equal(back.locked, true);
  assert.equal(back.alpha, 1);
  assert.equal(back.freq, 221);
});
