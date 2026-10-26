import { gt } from './cmp.js';
export const MIN_BPM = 30;
export const MAX_BPM = 1200;
export const WINDOW_S = 6;
export const MIN_SPAN_S = 4;
export const SHORT_S = 3;
export const AGREE_TOLERANCE = 0.03;
export const ENV_RATE = 400;
export const HINT_TOLERANCE = 0.04;
export const TIE_MARGIN = 0.15;
export const FUNDAMENTAL_TIE = 0.05;
export const LOCK_MIN = 0.3;
export const CREST_MIN = 6;
export const CREST_FAST_MIN = 4;
export const FAST_BPM = 250;
export const FAST_LOCK = 0.5;
export const SHORT_LOCK = 0.45;
export const HISTORY_S = 60;
export const WINDOWS_S = [1, 4, 8, 15, 30, 60];
export const LANE_WINDOW_S = 8;
export const MIN_PERIODS = 4;
export const PERIODS_MARGIN = 1.02;
export const GATE_MIN_S = 8;
export const SLOWER_LIMIT = 0.7;
export const IOI_MIN_S = 0.2;
export const IOI_MAX_S = 2;
export const IOI_BIN_S = 0.01;
export const IOI_TOLERANCE = 0.08;
export const IOI_TOL_MIN_S = 0.04;
export const IOI_MIN_EXPLAINED = 0.6;
export const IOI_MIN_CONFIDENCE = 0.4;
export const IOI_MIN_Z = 3;
const IOI_SMOOTH = [1, 2, 3, 4, 3, 2, 1];
const IOI_PEAKS = 6;
const IOI_PEAK_MIN = 0.2;
const IOI_TIE = 0.2;
const IOI_WEIGHT_MAX = 2;
const IOI_GAP_CLASSES = [0.5, 1, 1.5, 2, 3];
const FFT_MIN_WORK = 2e5;

const LOW_HZ = 150;
const MID_HZ = 1500;
const ENERGY_TAU_S = [0.012, 0.004, 0.0015];
const ENERGY_REF = 1e-6;
const DIFF_S = 0.006;
const NORM_TAU_S = 2;
const NORM_FLOOR = 0.3;
const WARM_FRAMES = 30;
const PEAK_MIN = 0.05;
const WIDE_SIGMA_S = 0.022;
const SMOOTHING_LADDER = [[WIDE_SIGMA_S, 250], [0.008, Infinity]];
const TAPER_S = 1;
const CREST_TOP = 0.02;
const USUAL_MIN_BPM = 60;
const USUAL_MAX_BPM = 200;
const MATCH_TOLERANCE = 0.03;
const HARMONIC_FLOOR = 0.5;
const DEBUG_CANDIDATES = 3;

export function createOnsetExtractor(sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate / ENV_RATE));
  const rate = sampleRate / hop;
  const pole = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
  const aLow = pole(LOW_HZ);
  const aMid = pole(MID_HZ);
  const aEnergy = ENERGY_TAU_S.map((tau) => 1 - Math.exp(-1 / (sampleRate * tau)));
  const aNorm = 1 - Math.exp(-1 / (rate * NORM_TAU_S));
  const depth = Math.max(1, Math.round(DIFF_S * rate));
  const ring = [new Float64Array(depth + 1), new Float64Array(depth + 1), new Float64Array(depth + 1)];
  const energy = [0, 0, 0];
  const mean = [0, 0, 0];
  let l1 = 0;
  let l2 = 0;
  let m1 = 0;
  let m2 = 0;
  let count = 0;
  let step = 0;

  const frame = () => {
    let onset = 0;
    for (let b = 0; b < 3; b += 1) {
      const level = Math.log(1 + energy[b] / ENERGY_REF);
      const slot = ring[b];
      const back = slot[(step + 1) % (depth + 1)];
      slot[step % (depth + 1)] = level;
      const rise = step >= WARM_FRAMES ? Math.max(0, level - back) : 0;
      mean[b] += aNorm * (rise - mean[b]);
      onset += rise / (mean[b] + NORM_FLOOR);
    }
    step += 1;
    return onset;
  };

  return {
    rate,
    push(samples, out) {
      for (const x of samples) {
        l1 += aLow * (x - l1);
        l2 += aLow * (l1 - l2);
        m1 += aMid * (x - m1);
        m2 += aMid * (m1 - m2);
        const mid = m2 - l2;
        const high = x - m2;
        energy[0] += aEnergy[0] * (l2 * l2 - energy[0]);
        energy[1] += aEnergy[1] * (mid * mid - energy[1]);
        energy[2] += aEnergy[2] * (high * high - energy[2]);
        count += 1;
        if (count === hop) {
          count = 0;
          out.push(frame());
        }
      }
    },
  };
}

function taperWindow(n, rate) {
  const w = new Float64Array(n);
  const ramp = Math.min(Math.floor(n / 2), Math.round(TAPER_S * rate));
  for (let i = 0; i < n; i += 1) {
    const edge = Math.min(i, n - 1 - i);
    w[i] = edge >= ramp ? 1 : Math.sin((Math.PI / 2) * (edge / ramp)) ** 2;
  }
  return w;
}

function windowedCorrelation(w, lag) {
  let num = 0;
  let den = 0;
  const end = w.length - lag;
  for (let i = 0; i < w.length; i += 1) {
    den += w[i] * w[i];
    if (i < end) num += w[i] * w[i + lag];
  }
  return num / den;
}

function autocorrelation(x, minLag, maxLag, extra) {
  const n = x.length;
  let power = 0;
  for (let i = 0; i < n; i += 1) power += x[i] * x[i];
  const r = new Float64Array(maxLag + 2);
  if (power <= 1e-12) return { r, power: 0 };
  r[0] = 1;
  for (let lag = 1; lag <= Math.min(maxLag, n - 1); lag += 1) {
    if (lag > extra && lag < minLag) continue;
    let sum = 0;
    const end = n - lag;
    for (let i = 0; i < end; i += 1) sum += x[i] * x[i + lag];
    r[lag] = sum / power;
  }
  return { r, power };
}

const fftCache = new Map();

function fftTables(size) {
  let t = fftCache.get(size);
  if (t) return t;
  const bits = Math.log2(size);
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = Math.sin((2 * Math.PI * i) / size);
  }
  const rev = new Uint32Array(size);
  for (let i = 0; i < size; i += 1) {
    let r = 0;
    for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev, re: new Float64Array(size), im: new Float64Array(size), pr: new Float64Array(size), pi: new Float64Array(size) };
  fftCache.set(size, t);
  return t;
}

function fft(re, im, t, inverse) {
  const n = re.length;
  const { cos, sin, rev } = t;
  for (let i = 0; i < n; i += 1) {
    const j = rev[i];
    if (j > i) {
      const a = re[i]; re[i] = re[j]; re[j] = a;
      const b = im[i]; im[i] = im[j]; im[j] = b;
    }
  }
  for (let half = 1; half < n; half <<= 1) {
    const step = n / (half * 2);
    for (let start = 0; start < n; start += half * 2) {
      for (let k = 0; k < half; k += 1) {
        const wr = cos[k * step];
        const wi = inverse ? sin[k * step] : -sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

function autocorrelationFft(x, w, maxLag) {
  const n = x.length;
  let size = 2;
  while (size < n + maxLag + 1) size *= 2;
  const t = fftTables(size);
  const { re, im, pr, pi } = t;
  re.fill(0);
  im.fill(0);
  re.set(x);
  im.set(w);
  fft(re, im, t, false);
  for (let k = 0; k < size; k += 1) {
    const m = (size - k) % size;
    const a = re[k];
    const b = im[k];
    const c = re[m];
    const d = im[m];
    pr[k] = ((a + c) * (a + c) + (b - d) * (b - d)) / 4;
    pi[k] = ((b + d) * (b + d) + (a - c) * (a - c)) / 4;
  }
  fft(pr, pi, t, true);
  const power = pr[0] / size;
  const r = new Float64Array(maxLag + 2);
  const wc = new Float64Array(maxLag + 2);
  if (power <= 1e-12) return { r, power: 0, wc };
  const wPower = pi[0];
  r[0] = 1;
  for (let lag = 1; lag <= Math.min(maxLag, n - 1); lag += 1) {
    r[lag] = pr[lag] / pr[0];
    wc[lag] = pi[lag] / wPower;
  }
  wc[0] = 1;
  return { r, power, wc };
}

function kernelHalf(rate) {
  return Math.ceil(2.5 * WIDE_SIGMA_S * rate);
}

function smoothed(r, minLag, maxLag, sigma) {
  const out = new Float64Array(r.length);
  const reach = Math.ceil(2.5 * sigma);
  const kernel = new Float64Array(reach + 1);
  for (let j = 0; j <= reach; j += 1) kernel[j] = Math.exp(-(j * j) / (2 * sigma * sigma));
  let zero = r[0] * kernel[0];
  for (let j = 1; j <= reach; j += 1) zero += 2 * kernel[j] * r[j];
  for (let i = minLag; i <= maxLag; i += 1) {
    let sum = kernel[0] * r[i];
    for (let j = 1; j <= reach; j += 1) sum += kernel[j] * ((r[i - j] || 0) + (r[i + j] || 0));
    out[i] = sum / zero;
  }
  return out;
}

function findPeaks(r, minLag, maxLag, wc) {
  const peaks = [];
  for (let i = minLag + 1; i < maxLag; i += 1) {
    const b = r[i];
    if (b < PEAK_MIN || b <= r[i - 1] || b < r[i + 1]) continue;
    const a = r[i - 1];
    const c = r[i + 1];
    const denom = a - 2 * b + c;
    const off = denom < 0 ? (0.5 * (a - c)) / denom : 0;
    const h = b - 0.25 * (a - c) * off;
    peaks.push({ lag: i + off, h, hc: h / Math.max(0.05, wc(i)) });
  }
  return peaks;
}

function nearest(peaks, lag) {
  let best = null;
  let bestD = Infinity;
  const tol = lag * MATCH_TOLERANCE + 1.5;
  for (const p of peaks) {
    const d = Math.abs(p.lag - lag);
    if (d <= tol && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

function refine(peaks, first, maxLag) {
  let sumLag = first.lag * first.hc;
  let sumK = first.hc;
  let current = first.lag;
  for (let k = 2; k * current <= maxLag; k += 1) {
    const want = k * current;
    let hit = null;
    let hitD = Infinity;
    for (const p of peaks) {
      const d = Math.abs(p.lag - want);
      if (d <= 0.3 * current && d < hitD) { hit = p; hitD = d; }
    }
    if (!hit || hit.hc < HARMONIC_FLOOR * first.hc) break;
    sumLag += hit.lag * k * hit.hc;
    sumK += k * k * hit.hc;
    current = sumLag / sumK;
  }
  return current;
}

function listCandidates(peaks, bpmOf) {
  const out = [];
  for (const p of peaks.slice().sort((a, b) => b.h - a.h)) {
    const bpm = bpmOf(p.lag);
    if (out.some((c) => Math.abs(c.bpm / bpm - 1) < MATCH_TOLERANCE)) continue;
    out.push({ bpm, score: p.h });
    if (out.length === DEBUG_CANDIDATES) break;
  }
  return out;
}

function lowestNearTop(peaks, top) {
  let chosen = null;
  for (const p of peaks) if (p.h >= (1 - FUNDAMENTAL_TIE) * top && (chosen === null || p.lag < chosen.lag)) chosen = p;
  return chosen;
}

function preferFaster(peaks, start, minLag, bpmOf) {
  let chosen = start;
  for (;;) {
    const faster = nearest(peaks, chosen.lag / 2);
    if (!faster || faster.lag < minLag || bpmOf(chosen.lag) >= USUAL_MIN_BPM || bpmOf(faster.lag) > USUAL_MAX_BPM || faster.hc < (1 - TIE_MARGIN) * chosen.hc) return chosen;
    chosen = faster;
  }
}

function followHint(peaks, chosen, hint, bpmOf) {
  if (!gt(hint, 0)) return chosen;
  const f = bpmOf(chosen.lag);
  if (f > USUAL_MAX_BPM || Math.abs(f - hint) / hint <= HINT_TOLERANCE) return chosen;
  for (const factor of [2, 0.5]) {
    const c = f * factor;
    if (c < MIN_BPM || c > USUAL_MAX_BPM || Math.abs(c - hint) / hint > HINT_TOLERANCE) continue;
    const match = nearest(peaks, chosen.lag / factor);
    if (match && match.hc >= (1 - TIE_MARGIN) * chosen.hc) return match;
  }
  return chosen;
}

function pick(spec, sigmaS, trace) {
  const { r, wc, minLag, maxLag, rate, hint } = spec;
  const peaks = findPeaks(smoothed(r, minLag, maxLag, sigmaS * rate), minLag, maxLag, wc);
  if (trace) trace.candidates = listCandidates(peaks, (lag) => (60 * rate) / lag);
  if (!peaks.length) return null;
  let top = 0;
  for (const p of peaks) if (p.h > top) top = p.h;
  if (top < LOCK_MIN) return null;
  const bpmOf = (lag) => (60 * rate) / lag;
  const chosen = followHint(peaks, preferFaster(peaks, lowestNearTop(peaks, top), minLag, bpmOf), hint, bpmOf);
  const bpm = bpmOf(refine(peaks, chosen, maxLag));
  return bpm >= MIN_BPM * 0.97 && bpm <= MAX_BPM * 1.03 ? { bpm, top } : null;
}

function crest(env) {
  const sorted = Float32Array.from(env).sort();
  let total = 0;
  for (const v of sorted) total += v;
  const count = Math.max(1, Math.ceil(sorted.length * CREST_TOP));
  let top = 0;
  for (let i = sorted.length - count; i < sorted.length; i += 1) top += sorted[i];
  return total > 0 ? top / count / (total / sorted.length) : 0;
}

function hoarePartition(a, lo, hi) {
  const pivot = a[(lo + hi) >> 1];
  let i = lo;
  let j = hi;
  while (i <= j) {
    while (a[i] < pivot) i += 1;
    while (a[j] > pivot) j -= 1;
    if (i <= j) {
      const t = a[i]; a[i] = a[j]; a[j] = t;
      i += 1;
      j -= 1;
    }
  }
  return [i, j];
}

function crestSelect(env) {
  const n = env.length;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += env[i];
  const count = Math.max(1, Math.ceil(n * CREST_TOP));
  const a = Float32Array.from(env);
  const k = n - count;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const [i, j] = hoarePartition(a, lo, hi);
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  let top = 0;
  for (let i = k; i < n; i += 1) top += a[i];
  return total > 0 ? top / count / (total / n) : 0;
}

function centredSignal(env, w) {
  const n = env.length;
  let weight = 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) { weight += w[i]; total += w[i] * env[i]; }
  const mean = total / weight;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i += 1) x[i] = (env[i] - mean) * w[i];
  return x;
}

function climbLadder(spec, peakiness, trace) {
  const accept = (res) => res !== null && (peakiness >= CREST_MIN || (res.bpm > FAST_BPM && res.top >= FAST_LOCK)) ? res.bpm : null;
  let found = null;
  let foundTop = 0;
  for (const [sigma, limit] of SMOOTHING_LADDER) {
    const res = pick(spec, sigma, trace);
    const bpm = accept(res);
    if (bpm !== null) { found = bpm; foundTop = res.top; }
    if (bpm !== null && bpm <= limit) break;
  }
  if (trace) trace.top = foundTop;
  return found;
}

export function estimateFromEnvelope(env, rate, hint = null, minSpanS = MIN_SPAN_S, trace = null, opts = null) {
  const n = env.length;
  if (n < minSpanS * rate) return null;
  const peakiness = opts?.fast === true ? crestSelect(env) : crest(env);
  if (peakiness < CREST_FAST_MIN) return null;
  const w = taperWindow(n, rate);
  const x = centredSignal(env, w);
  const half = kernelHalf(rate);
  const minLag = Math.max(2, Math.floor((60 * rate) / MAX_BPM) - 2);
  const maxLag = Math.min(Math.ceil((60 * rate) / MIN_BPM) + 2, Math.floor(n * 0.6));
  const viaFft = opts?.fast === true && n * (maxLag + half) > FFT_MIN_WORK;
  const ac = viaFft ? autocorrelationFft(x, w, maxLag + half) : autocorrelation(x, minLag - half, maxLag + half, half);
  const { r, power } = ac;
  if (power === 0) return null;
  const wc = viaFft ? (lag) => ac.wc[lag] : (lag) => windowedCorrelation(w, lag);
  return climbLadder({ r, wc, minLag, maxLag, rate, hint }, peakiness, trace);
}

function sameTempo(a, b) {
  const octaves = Math.log2(a / b);
  return Math.abs(2 ** (octaves - Math.round(octaves)) - 1) <= AGREE_TOLERANCE;
}

export const windowFrames = (seconds, rate) => Math.round(seconds * rate);

export const historyFrames = (historyS, rate) => (historyS > 0 ? Math.ceil(historyS * rate) : 0);

export function estimateWindowFromEnvelope(env, rate, seconds, hint = null) {
  if (!gt(seconds, 0) || env.length < windowFrames(seconds, rate) * 0.98) return null;
  const trace = {};
  const bpm = estimateFromEnvelope(env, rate, hint, seconds * 0.98, trace, { fast: true });
  if (bpm === null) return null;
  const beatsInWindow = (bpm * seconds) / 60;
  if (!gt(beatsInWindow, MIN_PERIODS * PERIODS_MARGIN)) return null;
  return { bpm, confidence: Math.min(1, Math.max(0, trace.top ?? 0)), beatsInWindow };
}

export function estimateEnvelope(env, rate, windowSeconds = LANE_WINDOW_S) {
  if (!gt(rate, 0) || !gt(windowSeconds, 0)) return null;
  const n = windowFrames(windowSeconds, rate);
  if (env.length < n) return null;
  return estimateWindowFromEnvelope(env.length === n ? env : env.subarray(env.length - n), rate, windowSeconds, null);
}

const ioiTol = (x) => Math.max(IOI_TOLERANCE * x, IOI_TOL_MIN_S);

function ioiHistogram(t, w) {
  const hist = new Float64Array(Math.round(IOI_MAX_S / IOI_BIN_S) + IOI_SMOOTH.length);
  const last = Math.round(IOI_MAX_S / IOI_BIN_S);
  for (let i = 0; i < t.length; i += 1) {
    for (let j = i + 1; j < t.length; j += 1) {
      const d = t[j] - t[i];
      if (d > IOI_MAX_S) break;
      if (d >= IOI_MIN_S - IOI_BIN_S / 2) hist[Math.min(last, Math.round(d / IOI_BIN_S))] += Math.sqrt(w[i] * w[j]);
    }
  }
  const reach = (IOI_SMOOTH.length - 1) / 2;
  let norm = 0;
  for (const k of IOI_SMOOTH) norm += k;
  const out = new Float64Array(last + 1);
  for (let b = 0; b <= last; b += 1) {
    let sum = 0;
    for (let k = -reach; k <= reach; k += 1) sum += IOI_SMOOTH[k + reach] * (hist[b + k] ?? 0);
    out[b] = sum / norm;
  }
  return out;
}

function ioiPeaks(s) {
  const first = Math.round(IOI_MIN_S / IOI_BIN_S);
  let top = 0;
  for (let b = first; b < s.length; b += 1) if (s[b] > top) top = s[b];
  const peaks = [];
  for (let b = first; b < s.length - 1; b += 1) {
    if (s[b] >= IOI_PEAK_MIN * top && s[b] > 0 && s[b] >= s[b - 1] && s[b] > s[b + 1]) peaks.push({ lag: b * IOI_BIN_S, h: s[b] });
  }
  peaks.sort((a, b) => b.h - a.h);
  return peaks.slice(0, IOI_PEAKS);
}

function ioiRefinePass(t, p) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < t.length; i += 1) {
    for (let j = i + 1; j < t.length; j += 1) {
      const d = t[j] - t[i];
      if (d > IOI_MAX_S || d > 3.5 * p) break;
      const k = Math.round(d / p);
      if (k < 1 || Math.abs(d - k * p) > ioiTol(p)) continue;
      num += k * d;
      den += k * k;
    }
  }
  return { num, den };
}

function ioiRefine(t, first) {
  let p = first;
  for (let pass = 0; pass < 3; pass += 1) {
    const { num, den } = ioiRefinePass(t, p);
    if (den === 0) break;
    p = num / den;
  }
  return p;
}

function ioiExplained(t, p) {
  const tol = ioiTol(p);
  const hit = new Uint8Array(t.length);
  let count = 0;
  let pairs = 0;
  for (let i = 0; i < t.length; i += 1) {
    for (let j = i + 1; j < t.length; j += 1) {
      const d = t[j] - t[i];
      if (d > p + tol) break;
      if (d < p - tol) continue;
      pairs += 1;
      if (!hit[i]) { hit[i] = 1; count += 1; }
      if (!hit[j]) { hit[j] = 1; count += 1; }
    }
  }
  return { share: count / t.length, pairs };
}

function ioiSignificance(t, p, windowS) {
  const rate = t.length / windowS;
  const tol = ioiTol(p);
  let observed = 0;
  let expected = 0;
  for (let k = 1; k * p <= Math.min(IOI_MAX_S, windowS); k += 1) {
    expected += rate * rate * 2 * tol * (windowS - k * p);
    for (let i = 0; i < t.length; i += 1) {
      for (let j = i + 1; j < t.length; j += 1) {
        const d = t[j] - t[i];
        if (d > k * p + tol) break;
        if (d >= k * p - tol) observed += 1;
      }
    }
  }
  return (observed - expected) / Math.sqrt(expected + 1);
}

function ioiConfidence(t, p) {
  let fit = 0;
  for (let i = 1; i < t.length; i += 1) {
    const g = t[i] - t[i - 1];
    if (IOI_GAP_CLASSES.some((c) => Math.abs(g - c * p) <= ioiTol(c * p))) fit += 1;
  }
  return fit / (t.length - 1);
}

function ioiWeights(strengths, n) {
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += strengths[i];
  mean /= n;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i += 1) w[i] = mean > 0 ? Math.min(IOI_WEIGHT_MAX, Math.max(1 / IOI_WEIGHT_MAX, strengths[i] / mean)) : 1;
  return w;
}

function ioiFit(times, period, windowSeconds, fits) {
  if (!gt(period, 0) || windowSeconds / period <= MIN_PERIODS * PERIODS_MARGIN) return null;
  if (fits.some((f) => Math.abs(f.period / period - 1) < IOI_TOLERANCE / 2)) return null;
  const { share, pairs } = ioiExplained(times, period);
  if (share < IOI_MIN_EXPLAINED || pairs < MIN_PERIODS) return null;
  const confidence = ioiConfidence(times, period);
  if (confidence < IOI_MIN_CONFIDENCE || ioiSignificance(times, period, windowSeconds) < IOI_MIN_Z) return null;
  return { period, explained: share, confidence };
}

function shortestBest(fits) {
  let best = 0;
  for (const f of fits) if (f.explained > best) best = f.explained;
  let chosen = null;
  for (const f of fits) if (f.explained >= best - IOI_TIE && (chosen === null || f.period < chosen.period)) chosen = f;
  return chosen;
}

export function estimateIntervals(times, strengths, windowSeconds) {
  const n = times.length;
  if (!gt(windowSeconds, 0) || n <= MIN_PERIODS) return null;
  const w = ioiWeights(strengths, n);
  const fits = [];
  for (const peak of ioiPeaks(ioiHistogram(times, w))) {
    const fit = ioiFit(times, ioiRefine(times, peak.lag), windowSeconds, fits);
    if (fit) fits.push(fit);
  }
  const chosen = shortestBest(fits);
  if (chosen === null) return null;
  return { bpm: 60 / chosen.period, confidence: chosen.confidence, explained: chosen.explained, period: chosen.period, beatsInWindow: windowSeconds / chosen.period };
}

export function gateLong(ref, res) {
  if (!sameTempo(ref.bpm, res.bpm)) return null;
  if (res.bpm >= ref.bpm * SLOWER_LIMIT) return res;
  if (Math.abs((2 * res.bpm) / ref.bpm - 1) > AGREE_TOLERANCE) return null;
  return { ...res, bpm: res.bpm * 2, beatsInWindow: res.beatsInWindow * 2 };
}

export function gateWindows(seconds, raw) {
  const out = [];
  raw.forEach((res, i) => {
    let ref = null;
    for (let j = i - 1; j >= 0 && ref === null; j -= 1) ref = out[j];
    out.push(res !== null && seconds[i] >= GATE_MIN_S && ref !== null ? gateLong(ref, res) : res);
  });
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === null || seconds[i] >= GATE_MIN_S) continue;
    const longer = out.find((res, j) => j > i && res !== null);
    if (longer && sameTempo(longer.bpm, out[i].bpm) && Math.abs(longer.bpm / out[i].bpm - 1) > AGREE_TOLERANCE) out[i] = null;
  }
  return out;
}

function createTail() {
  let data = new Float32Array(0);
  let size = 0;
  return {
    resize(cap) { data = new Float32Array(cap); size = 0; },
    clear() { size = 0; },
    get length() { return size; },
    get capacity() { return data.length; },
    view() { return data.subarray(0, size); },
    append(src, add) {
      const cap = data.length;
      if (!cap) return;
      if (add >= cap) {
        for (let i = 0; i < cap; i += 1) data[i] = src[add - cap + i];
        size = cap;
        return;
      }
      if (size + add > cap) {
        const drop = size + add - cap;
        data.copyWithin(0, drop, size);
        size -= drop;
      }
      for (let i = 0; i < add; i += 1) data[size + i] = src[i];
      size += add;
    },
  };
}

export function createLiveBpm({ windowS = WINDOW_S, shortS = SHORT_S, historyS = 0 } = {}) {
  let hint = null;
  let extractor = null;
  let extractorRate = 0;
  const tail = createTail();
  const history = createTail();
  const scratch = [];

  const clear = () => { tail.clear(); history.clear(); };

  return {
    setHint(bpm) { hint = bpm > 0 ? Number(bpm) : null; },
    reset() {
      clear();
      extractor = null;
    },
    pushSamples(samples, sampleRate) {
      if (!extractor || extractorRate !== sampleRate) {
        extractor = createOnsetExtractor(sampleRate);
        extractorRate = sampleRate;
        tail.resize(Math.ceil(windowS * extractor.rate));
        history.resize(historyFrames(historyS, extractor.rate));
      }
      scratch.length = 0;
      extractor.push(samples, scratch);
      const add = scratch.length;
      if (!add) return;
      tail.append(scratch, add);
      history.append(scratch, add);
    },
    envelopeLength() { return tail.length; },
    estimateWindows(seconds = WINDOWS_S) {
      return gateWindows(seconds, seconds.map((s) => this.estimateWindow(s)));
    },
    estimateWindow(seconds) {
      if (!extractor || !history.capacity) return null;
      const n = windowFrames(seconds, extractor.rate);
      if (n > history.capacity || history.length < n) return null;
      const all = history.view();
      return estimateWindowFromEnvelope(all.subarray(all.length - n), extractor.rate, seconds, hint);
    },
    estimateExact() { return this.analyse(null); },
    analyse(trace) {
      if (!extractor) return null;
      const rate = extractor.rate;
      const all = tail.view();
      const filled = tail.length;
      const t = trace ?? { long: {}, short: {} };
      const long = estimateFromEnvelope(all, rate, hint, MIN_SPAN_S, t.long);
      const recentN = Math.round(shortS * rate);
      t.windowS = filled / rate;
      if (filled < recentN) return long;
      const short = estimateFromEnvelope(all.subarray(filled - recentN), rate, hint, shortS, t.short);
      if (short === null || long === null) return long === null && filled < MIN_SPAN_S * rate ? short : long;
      if (sameTempo(short, long)) return long;
      return t.short.top >= SHORT_LOCK ? short : long;
    },
    details() {
      const trace = { long: {}, short: {}, windowS: 0 };
      const bpm = this.analyse(trace);
      return { bpm, windowS: trace.windowS, candidates: trace.long.candidates ?? [], shortCandidates: trace.short.candidates ?? [] };
    },
    estimate() {
      const exact = this.estimateExact();
      return exact === null ? null : Math.round(exact);
    },
  };
}
