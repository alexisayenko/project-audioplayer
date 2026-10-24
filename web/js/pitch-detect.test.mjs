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

const OFFSET = 13.56;
const OWNER_DB = [-42, -26, -45, -52, -55, -58, -60, -62, -64, -66, -68, -70];
const additive = (f0, levels) => {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i += 1) out[i] = levels.reduce((s, l, k) => s + 10 ** (l / 20) * Math.sin((2 * Math.PI * (k + 1) * f0 * i) / SR), 0);
  return out;
};
const analyserDb = (x) => {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const bits = Math.log2(N);
  for (let i = 0; i < N; i += 1) {
    let r = 0;
    for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
    re[r] = x[i] * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N));
  }
  for (let len = 2; len <= N; len <<= 1) {
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k += 1) {
        const wr = Math.cos((-2 * Math.PI * k) / len);
        const wi = Math.sin((-2 * Math.PI * k) / len);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  return Float32Array.from({ length: N / 2 }, (_, k) => 20 * Math.log10(Math.hypot(re[k], im[k]) / N + 1e-12));
};
const corrected = (x) => {
  const est = p.detectPitch(x, SR);
  return { est, fix: p.correctOctave(est, analyserDb(x), SR, { offsetDb: OFFSET, maxHz: 20000 }) };
};

test('WEB-206: octave error: a real recording with a weak H1 (-42 dBFS) under a loud H2 (-26 dBFS) is read as 84 Hz, not 168 Hz', () => {
  const { est, fix } = corrected(additive(83.9, OWNER_DB));
  assert.ok(cents(est.freq, 167.8) < 10, `YIN alone locks on H2: ${est.freq}`);
  assert.ok(cents(fix.freq, 83.9) < 10, String(fix.freq));
  assert.equal(fix.div, 2);
  assert.ok(cents(fix.raw, 167.8) < 10);
});

test('WEB-206: octave correction leaves a sine, a sawtooth, an odd-only tone and a missing fundamental alone', () => {
  const cases = [
    [220, tone(220, [1])],
    [220, tone(220, range(1, 10))],
    [220, tone(220, [1, 3, 5, 7])],
    [220, tone(220, range(2, 8))],
    [168, tone(168, [1, 3, 5, 7])],
    [84, tone(84, range(1, 12))],
  ];
  for (const [hz, x] of cases) {
    const { fix } = corrected(x);
    assert.ok(cents(fix.freq, hz) < 5, `${hz} -> ${fix.freq}`);
    assert.equal(fix.div, 1);
  }
});

test('WEB-206: lowerPitch needs a peak at the odd multiples of the lower candidate, a clear H1 and no lower than 60 Hz', () => {
  const data = analyserDb(additive(83.9, OWNER_DB));
  assert.equal(p.lowerPitch(data, SR, 167.8, { offsetDb: OFFSET }).div, 2);
  assert.equal(p.lowerPitch(data, SR, 83.9, { offsetDb: OFFSET }).div, 1);
  assert.equal(p.lowerPitch(data, SR, 112, { offsetDb: OFFSET }).div, 1);
  assert.equal(p.lowerPitch(data, SR, 100, { offsetDb: OFFSET }).freq, 100);
  assert.equal(p.lowerPitch(new Float32Array(8), SR, 200).div, 1);
  assert.equal(p.lowerPitch(data, SR, 0).div, 1);
  const noH1 = analyserDb(additive(83.9, [-120, ...OWNER_DB.slice(1)]));
  assert.equal(p.lowerPitch(noH1, SR, 167.8, { offsetDb: OFFSET }).div, 1);
});

test('WEB-206: correctOctave passes null through and keeps the confidence', () => {
  assert.equal(p.correctOctave(null, new Float32Array(64), SR), null);
  const fix = p.correctOctave({ freq: 220, confidence: 0.9 }, new Float32Array(64).fill(-120), SR);
  assert.deepEqual(fix, { freq: 220, confidence: 0.9, raw: 220, div: 1 });
});

test('WEB-206: the tracker switches octave only after 3 consistent estimates and reports the raw pitch when it is lower', () => {
  const t = p.createPitchTracker();
  const feed = (freq, raw, at) => t.update({ freq, raw, confidence: 0.95 }, at);
  assert.equal(feed(84, 168, 0).raw, 168);
  feed(84, 168, 70);
  assert.equal(feed(168, 168, 140).freq, 84);
  assert.equal(feed(84, 168, 210).freq, 84);
  feed(168, 168, 280);
  feed(168, 168, 350);
  assert.equal(feed(168, 168, 420).freq, 168);
  assert.equal(Object.hasOwn(t.state(420), 'raw'), false);
});

test('WEB-206: the tracker takes a new note at once and a pending octave flip does not drop the lock', () => {
  const t = p.createPitchTracker();
  t.update({ freq: 220, confidence: 0.95 }, 0);
  assert.equal(t.update({ freq: 262, confidence: 0.95 }, 70).freq, 262);
  const held = t.update({ freq: 131, confidence: 0.95 }, 140);
  assert.equal(held.locked, true);
  assert.equal(held.alpha, 1);
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
