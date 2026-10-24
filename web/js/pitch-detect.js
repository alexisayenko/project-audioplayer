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

const SINE_RMS_DB = 10 * Math.log10(2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function sineRmsDb(samples) {
  if (!samples?.length) return -Infinity;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) + SINE_RMS_DB : -Infinity;
}

export function detectPitch(samples, sampleRate, opts = {}) {
  const { minHz = PITCH_MIN_HZ, maxHz = PITCH_MAX_HZ, threshold = YIN_THRESHOLD, gateDb = PITCH_GATE_DB } = opts;
  if (!samples?.length || !(sampleRate > 0)) return null;
  const dec = Math.max(1, Math.floor(sampleRate / PITCH_TARGET_RATE));
  const sr = sampleRate / dec;
  const tauMin = Math.max(2, Math.floor(sr / (maxHz * 1.02)));
  const tauMax = Math.ceil(sr / (minHz * 0.98)) + 1;
  const want = Math.max(PITCH_MIN_WINDOW, Math.ceil(tauMax * 1.5)) + tauMax + 1;
  const have = Math.min(want, Math.floor(samples.length / dec));
  const win = have - tauMax - 1;
  if (win < tauMax) return null;
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
  if (!(sineRmsDb(x) >= gateDb)) return null;

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
  let tau = 1;
  for (; tau <= tauMax; tau += 1) {
    if (step(tau) < threshold && tau >= tauMin) { best = tau; break; }
  }
  if (best >= 0) {
    while (best + 1 <= tauMax + 1 && step(best + 1) < d[best]) best += 1;
    if (best > tauMax) best = tauMax;
  } else {
    step(tauMax + 1);
    let low = Infinity;
    for (let t = tauMin; t <= tauMax; t += 1) if (d[t] < low) { low = d[t]; best = t; }
  }
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

export function harmonicMarks(freqData, sampleRate, f0, opts = {}) {
  const { offsetDb = 0, maxHz = Infinity, floorDb = HARMONIC_FLOOR_DB, riseDb = HARMONIC_RISE_DB, tolerance = HARMONIC_TOLERANCE, maxN = HARMONIC_MAX } = opts;
  const bins = freqData?.length ?? 0;
  if (bins < 16 || !(sampleRate > 0) || !(f0 > 0)) return [];
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
    let found = false;
    if (Number.isFinite(top) && top >= freqData[k - 1] && top >= freqData[k + 1]) {
      const left = freqData[Math.max(0, k - gap)];
      const right = freqData[Math.min(bins - 1, k + gap)];
      const around = Math.max(left, right);
      const rise = Number.isFinite(around) ? top - around : Infinity;
      found = rise >= riseDb && top + offsetDb >= floorDb;
    }
    out.push({ n, freq, found, db: Number.isFinite(top) ? top + offsetDb : -Infinity });
  }
  return out;
}

export function foundList(marks) {
  const list = marks.filter((m) => m.found).map((m) => m.n);
  return list.length ? list.join(',') : 'none';
}

export function createPitchTracker({ minConf = PITCH_MIN_CONF, fadeMs = PITCH_FADE_MS, size = PITCH_MEDIAN } = {}) {
  let hist = [];
  let freq = 0;
  let confidence = 0;
  let lostAt = null;
  const median = () => [...hist].sort((p, q) => p - q)[hist.length >> 1];
  const reset = () => { hist = []; freq = 0; confidence = 0; lostAt = null; };
  return {
    update(est, t) {
      if (est && est.confidence >= minConf) {
        hist.push(est.freq);
        if (hist.length > size) hist.shift();
        freq = median();
        confidence = est.confidence;
        lostAt = null;
      } else if (freq > 0 && lostAt === null) {
        lostAt = t;
        hist = [];
      }
      if (lostAt !== null && t - lostAt >= fadeMs) reset();
      return this.state(t);
    },
    state(t) {
      if (!(freq > 0)) return { freq: 0, confidence: 0, locked: false, alpha: 0 };
      if (lostAt === null) return { freq, confidence, locked: true, alpha: 1 };
      return { freq, confidence, locked: false, alpha: clamp(1 - (t - lostAt) / fadeMs, 0, 1) };
    },
    reset,
  };
}
