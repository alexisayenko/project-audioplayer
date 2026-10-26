import { gt, gte } from './cmp.js';
export const PITCH_MIN_HZ = 60;
export const PITCH_MAX_HZ = 2000;
export const PITCH_GATE_DB = -55;
export const YIN_THRESHOLD = 0.15;
export const PITCH_MIN_CONF = 0.8;
export const PITCH_TARGET_RATE = 48000;
export const PITCH_MIN_WINDOW = 1024;
export const PITCH_EVERY_MS = 70;
export const PITCH_FADE_MS = 300;
export const PITCH_MEDIAN = 3;
export const HARMONIC_MAX = 16;
export const HARMONIC_TOLERANCE = 0.03;
export const HARMONIC_RISE_DB = 6;
export const HARMONIC_FLOOR_DB = -70;
export const HARMONIC_LABEL_GAP_PX = 22;
export const OCTAVE_MAX_DIV = 4;
export const OCTAVE_CHECK_N = 12;
export const OCTAVE_CHECK_FIRST = 8;
export const OCTAVE_MIN_FOUND = 5;
export const OCTAVE_MIN_SHARE = 0.7;
export const OCTAVE_H1_RISE_DB = 25;
export const OCTAVE_FLOOR_MIN_HZ = 40;
export const OCTAVE_FLOOR_MAX_HZ = 5000;
export const OCTAVE_HOLD = 3;

const SINE_RMS_DB = 10 * Math.log10(2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function sineRmsDb(samples) {
  if (!samples?.length) return -Infinity;
  let sum = 0;
  for (const v of samples) sum += v * v;
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) + SINE_RMS_DB : -Infinity;
}

function centeredFrame(samples, dec, have) {
  const x = new Float32Array(have);
  const from = samples.length - have * dec;
  let mean = 0;
  for (let i = 0; i < have; i += 1) {
    let s = 0;
    for (let k = 0; k < dec; k += 1) s += samples[from + i * dec + k];
    x[i] = s / dec;
    mean += x[i];
  }
  mean /= have;
  for (let i = 0; i < have; i += 1) x[i] -= mean;
  return x;
}

function lowestLag(d, tauMin, tauMax) {
  let low = Infinity;
  let best = -1;
  for (let t = tauMin; t <= tauMax; t += 1) {
    if (d[t] < low) { low = d[t]; best = t; }
  }
  return best;
}

function yinLag(x, win, tauMin, tauMax, threshold) {
  const d = new Float32Array(tauMax + 2);
  let running = 0;
  const step = (tau) => {
    let sum = 0;
    for (let j = 0; j < win; j += 1) {
      const e = x[j] - x[j + tau];
      sum += e * e;
    }
    running += sum;
    d[tau] = running > 0 ? (sum * tau) / running : 1;
    return d[tau];
  };
  let best = -1;
  for (let tau = 1; tau <= tauMax; tau += 1) {
    if (step(tau) < threshold && tau >= tauMin) { best = tau; break; }
  }
  if (best >= 0) {
    while (best + 1 <= tauMax + 1 && step(best + 1) < d[best]) best += 1;
    if (best > tauMax) best = tauMax;
  } else {
    step(tauMax + 1);
    best = lowestLag(d, tauMin, tauMax);
  }
  return { d, best };
}

export function detectPitch(samples, sampleRate, opts = {}) {
  const { minHz = PITCH_MIN_HZ, maxHz = PITCH_MAX_HZ, threshold = YIN_THRESHOLD, gateDb = PITCH_GATE_DB } = opts;
  if (!samples?.length || !gt(sampleRate, 0)) return null;
  const dec = Math.max(1, Math.floor(sampleRate / PITCH_TARGET_RATE));
  const sr = sampleRate / dec;
  const tauMin = Math.max(2, Math.floor(sr / (maxHz * 1.02)));
  const tauMax = Math.ceil(sr / (minHz * 0.98)) + 1;
  const want = Math.max(PITCH_MIN_WINDOW, Math.ceil(tauMax * 1.5)) + tauMax + 1;
  const have = Math.min(want, Math.floor(samples.length / dec));
  const win = have - tauMax - 1;
  if (win < tauMax) return null;
  const x = centeredFrame(samples, dec, have);
  if (!gte(sineRmsDb(x), gateDb)) return null;

  const { d, best } = yinLag(x, win, tauMin, tauMax, threshold);
  if (best < 2) return null;
  const a = d[best - 1];
  const b = d[best];
  const c = d[best + 1];
  const den = a - 2 * b + c;
  const shift = den > 0 ? clamp((0.5 * (a - c)) / den, -1, 1) : 0;
  const freq = sr / (best + shift);
  if (!(freq >= minHz * 0.98 && freq <= maxHz * 1.02)) return null;
  return { freq, confidence: clamp(1 - b, 0, 1) };
}

function isPeakFound(freqData, k, gap, { riseDb, floorDb, offsetDb }) {
  const top = freqData[k];
  if (!(Number.isFinite(top) && top >= freqData[k - 1] && top >= freqData[k + 1])) return false;
  const left = freqData[Math.max(0, k - gap)];
  const right = freqData[Math.min(freqData.length - 1, k + gap)];
  const around = Math.max(left, right);
  const rise = Number.isFinite(around) ? top - around : Infinity;
  return rise >= riseDb && top + offsetDb >= floorDb;
}

export function harmonicMarks(freqData, sampleRate, f0, opts = {}) {
  const { offsetDb = 0, maxHz = Infinity, floorDb = HARMONIC_FLOOR_DB, riseDb = HARMONIC_RISE_DB, tolerance = HARMONIC_TOLERANCE, maxN = HARMONIC_MAX } = opts;
  const bins = freqData?.length ?? 0;
  if (bins < 16 || !gt(sampleRate, 0) || !gt(f0, 0)) return [];
  const bw = sampleRate / (2 * bins);
  const gap = clamp(Math.round(f0 / bw / 3), 4, 12);
  const out = [];
  for (let n = 1; n <= maxN; n += 1) {
    const freq = n * f0;
    if (freq > maxHz || freq >= sampleRate * 0.49) break;
    const lo = clamp(Math.floor((freq * (1 - tolerance)) / bw), 1, bins - 2);
    const hi = clamp(Math.ceil((freq * (1 + tolerance)) / bw), lo, bins - 2);
    let k = lo;
    for (let b = lo + 1; b <= hi; b += 1) if (freqData[b] > freqData[k]) k = b;
    const top = freqData[k];
    const found = isPeakFound(freqData, k, gap, { riseDb, floorDb, offsetDb });
    out.push({ n, freq, found, db: Number.isFinite(top) ? top + offsetDb : -Infinity });
  }
  return out;
}

export function foundList(marks) {
  const list = marks.filter((m) => m.found).map((m) => m.n);
  return list.length ? list.join(',') : 'none';
}

export function spectrumFloorDb(freqData, sampleRate, { offsetDb = 0, minHz = OCTAVE_FLOOR_MIN_HZ, maxHz = OCTAVE_FLOOR_MAX_HZ } = {}) {
  const bins = freqData?.length ?? 0;
  if (bins < 16 || !gt(sampleRate, 0)) return -Infinity;
  const bw = sampleRate / (2 * bins);
  const lo = clamp(Math.ceil(minHz / bw), 1, bins - 2);
  const hi = clamp(Math.floor(Math.min(maxHz, sampleRate * 0.49) / bw), lo, bins - 2);
  const band = Float32Array.from(freqData.subarray ? freqData.subarray(lo, hi + 1) : freqData.slice(lo, hi + 1));
  band.sort();
  return band[band.length >> 1] + offsetDb;
}

export function subharmonicSupport(freqData, sampleRate, c, div, opts = {}) {
  const marks = harmonicMarks(freqData, sampleRate, c, { ...opts, maxN: OCTAVE_CHECK_N });
  const first = marks.filter((m) => m.n <= OCTAVE_CHECK_FIRST);
  const fresh = first.filter((m) => m.n % div !== 0);
  const hit = (list) => list.filter((m) => m.found).length;
  return {
    marks,
    found: hit(marks),
    share: first.length ? hit(first) / first.length : 0,
    freshCount: fresh.length,
    freshShare: fresh.length ? hit(fresh) / fresh.length : 0,
    h1: marks[0] ?? null,
  };
}

export function lowerPitch(freqData, sampleRate, f0, opts = {}) {
  const { minHz = PITCH_MIN_HZ, maxDiv = OCTAVE_MAX_DIV, h1RiseDb = OCTAVE_H1_RISE_DB, offsetDb = 0 } = opts;
  const none = { freq: f0, div: 1 };
  if (!gt(f0, 0) || (freqData?.length ?? 0) < 16) return none;
  let floor = null;
  for (let div = maxDiv; div >= 2; div -= 1) {
    const c = f0 / div;
    if (c < minHz * 0.98) continue;
    const s = subharmonicSupport(freqData, sampleRate, c, div, opts);
    if (!s.h1?.found || s.freshCount < 2) continue;
    if (s.found < OCTAVE_MIN_FOUND || s.share < OCTAVE_MIN_SHARE || s.freshShare < OCTAVE_MIN_SHARE) continue;
    floor ??= spectrumFloorDb(freqData, sampleRate, { offsetDb });
    if (s.h1.db - floor >= h1RiseDb) return { freq: c, div };
  }
  return none;
}

export function correctOctave(est, freqData, sampleRate, opts = {}) {
  if (!est || !gt(est.freq, 0)) return est;
  const low = lowerPitch(freqData, sampleRate, est.freq, opts);
  return { ...est, freq: low.freq, raw: est.freq, div: low.div };
}

const NEAR_SEMITONES = 1.5;
const FLIP_RATIOS = [2, 3, 4];
const near = (a, b) => Math.abs(12 * Math.log2(a / b)) <= NEAR_SEMITONES;

function nextPending(pending, est) {
  const count = pending && near(est.freq, pending.freq) ? pending.count + 1 : 1;
  return { est, count, freq: est.freq };
}
const isOctaveFlip = (a, b) => FLIP_RATIOS.some((r) => near(a, b * r) || near(a * r, b));

export function createPitchTracker({ minConf = PITCH_MIN_CONF, fadeMs = PITCH_FADE_MS, size = PITCH_MEDIAN, hold = OCTAVE_HOLD } = {}) {
  let hist = [];
  let freq = 0;
  let raw = 0;
  let confidence = 0;
  let lostAt = null;
  let pending = null;
  const median = () => [...hist].sort((p, q) => p.f - q.f)[hist.length >> 1];
  const reset = () => { hist = []; freq = 0; raw = 0; confidence = 0; lostAt = null; pending = null; };
  const accept = (est) => {
    hist.push({ f: est.freq, raw: est.raw ?? est.freq });
    if (hist.length > size) hist.shift();
    const m = median();
    freq = m.f;
    raw = m.raw;
    confidence = est.confidence;
    lostAt = null;
    pending = null;
  };
  return {
    update(est, t) {
      if (est && est.confidence >= minConf) {
        if (!hist.length || !gt(freq, 0) || near(est.freq, freq) || !isOctaveFlip(est.freq, freq)) {
          accept(est);
        } else {
          pending = nextPending(pending, est);
          lostAt = null;
          if (pending.count >= hold) {
            hist = [];
            accept(est);
          }
        }
      } else if (freq > 0 && lostAt === null) {
        lostAt = t;
        hist = [];
        pending = null;
      }
      if (lostAt !== null && t - lostAt >= fadeMs) reset();
      return this.state(t);
    },
    state(t) {
      if (!gt(freq, 0)) return { freq: 0, confidence: 0, locked: false, alpha: 0 };
      const lower = raw / freq > 1.5 ? { raw } : {};
      if (lostAt === null) return { freq, confidence, locked: true, alpha: 1, ...lower };
      return { freq, confidence, locked: false, alpha: clamp(1 - (t - lostAt) / fadeMs, 0, 1), ...lower };
    },
    reset,
  };
}
