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
      for (let i = 0; i < samples.length; i += 1) {
        const x = samples[i];
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

function findPeaks(r, minLag, maxLag, w) {
  const peaks = [];
  for (let i = minLag + 1; i < maxLag; i += 1) {
    const b = r[i];
    if (b < PEAK_MIN || b <= r[i - 1] || b < r[i + 1]) continue;
    const a = r[i - 1];
    const c = r[i + 1];
    const denom = a - 2 * b + c;
    const off = denom < 0 ? (0.5 * (a - c)) / denom : 0;
    const h = b - 0.25 * (a - c) * off;
    peaks.push({ lag: i + off, h, hc: h / Math.max(0.05, windowedCorrelation(w, i)) });
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

function pick(r, w, minLag, maxLag, rate, hint, sigmaS) {
  const peaks = findPeaks(smoothed(r, minLag, maxLag, sigmaS * rate), minLag, maxLag, w);
  if (!peaks.length) return null;
  let top = 0;
  for (const p of peaks) if (p.h > top) top = p.h;
  if (top < LOCK_MIN) return null;
  let chosen = null;
  for (const p of peaks) if (p.h >= (1 - FUNDAMENTAL_TIE) * top && (chosen === null || p.lag < chosen.lag)) chosen = p;
  const bpmOf = (lag) => (60 * rate) / lag;
  for (;;) {
    const faster = nearest(peaks, chosen.lag / 2);
    if (!faster || faster.lag < minLag || bpmOf(chosen.lag) >= USUAL_MIN_BPM || bpmOf(faster.lag) > USUAL_MAX_BPM || faster.hc < (1 - TIE_MARGIN) * chosen.hc) break;
    chosen = faster;
  }
  if (hint > 0) {
    const f = bpmOf(chosen.lag);
    if (f <= USUAL_MAX_BPM && Math.abs(f - hint) / hint > HINT_TOLERANCE) {
      for (const factor of [2, 0.5]) {
        const c = f * factor;
        if (c < MIN_BPM || c > USUAL_MAX_BPM || Math.abs(c - hint) / hint > HINT_TOLERANCE) continue;
        const match = nearest(peaks, chosen.lag / factor);
        if (match && match.hc >= (1 - TIE_MARGIN) * chosen.hc) { chosen = match; break; }
      }
    }
  }
  const bpm = bpmOf(refine(peaks, chosen, maxLag));
  return bpm >= MIN_BPM * 0.97 && bpm <= MAX_BPM * 1.03 ? bpm : null;
}

function crest(env) {
  const sorted = Float32Array.from(env).sort();
  let total = 0;
  for (let i = 0; i < sorted.length; i += 1) total += sorted[i];
  const count = Math.max(1, Math.ceil(sorted.length * CREST_TOP));
  let top = 0;
  for (let i = sorted.length - count; i < sorted.length; i += 1) top += sorted[i];
  return total > 0 ? top / count / (total / sorted.length) : 0;
}

export function estimateFromEnvelope(env, rate, hint = null, minSpanS = MIN_SPAN_S) {
  const n = env.length;
  if (n < minSpanS * rate) return null;
  if (crest(env) < CREST_MIN) return null;
  const w = taperWindow(n, rate);
  let weight = 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) { weight += w[i]; total += w[i] * env[i]; }
  const mean = total / weight;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i += 1) x[i] = (env[i] - mean) * w[i];
  const half = kernelHalf(rate);
  const minLag = Math.max(2, Math.floor((60 * rate) / MAX_BPM) - 2);
  const maxLag = Math.min(Math.ceil((60 * rate) / MIN_BPM) + 2, Math.floor(n * 0.6));
  const { r, power } = autocorrelation(x, minLag - half, maxLag + half, half);
  if (power === 0) return null;
  let found = null;
  for (const [sigma, limit] of SMOOTHING_LADDER) {
    const bpm = pick(r, w, minLag, maxLag, rate, hint, sigma);
    if (bpm !== null) found = bpm;
    if (bpm !== null && bpm <= limit) return bpm;
  }
  return found;
}

function sameTempo(a, b) {
  const octaves = Math.log2(a / b);
  return Math.abs(2 ** (octaves - Math.round(octaves)) - 1) <= AGREE_TOLERANCE;
}

export function createLiveBpm({ windowS = WINDOW_S, shortS = SHORT_S } = {}) {
  let hint = null;
  let extractor = null;
  let extractorRate = 0;
  let env = new Float32Array(0);
  let filled = 0;
  const scratch = [];

  const clear = () => { filled = 0; };

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
        env = new Float32Array(Math.ceil(windowS * extractor.rate));
        clear();
      }
      scratch.length = 0;
      extractor.push(samples, scratch);
      const add = scratch.length;
      if (!add) return;
      const cap = env.length;
      if (add >= cap) {
        for (let i = 0; i < cap; i += 1) env[i] = scratch[add - cap + i];
        filled = cap;
        return;
      }
      if (filled + add > cap) {
        const drop = filled + add - cap;
        env.copyWithin(0, drop, filled);
        filled -= drop;
      }
      for (let i = 0; i < add; i += 1) env[filled + i] = scratch[i];
      filled += add;
    },
    envelopeLength() { return filled; },
    estimateExact() {
      if (!extractor) return null;
      const rate = extractor.rate;
      const all = env.subarray(0, filled);
      const long = estimateFromEnvelope(all, rate, hint);
      const recentN = Math.round(shortS * rate);
      if (filled < recentN) return long;
      const short = estimateFromEnvelope(all.subarray(filled - recentN), rate, hint, shortS);
      if (short === null || long === null) return long === null && filled < MIN_SPAN_S * rate ? short : long;
      return sameTempo(short, long) ? long : short;
    },
    estimate() {
      const exact = this.estimateExact();
      return exact === null ? null : Math.round(exact);
    },
  };
}
