import {
  createPitchEstimator, createPitchTracker, encodePitch, idxToHz, hzToU, LEAD_GAIN, LEAD_SIGMA, LEAD_JOIN_U, PITCH_LEVELS,
} from './viz-pitch.js';
import { hpssMasks, bandWeights, createPartsSplitter, HIST_S, FUTURE_S } from './viz-parts.js';
import {
  AMP_BASE, AMP_GAIN, AMP_MAX, LANDMARK_MAX, heightAt, columnBin, edgeFalloff, smoothstep, clamp01, smoothHeights,
  createSeries, softKnee, fillTimeFrame, rowLayout, landmarkWeight, landmarkShape, HISTORY_BINS, LIVE_CAP,
} from './viz-terrain-math.js';

export const PLANES = 3;
export const PLANE = { mel: 0, can: 1, oth: 2 };
export const MELODY_GAIN = 1.45;
export const MELODY_SPREAD = [1, 0.85, 0.5];
export const MELODY_SMOOTH = 1;
export const MELODY_CAP = LANDMARK_MAX / AMP_MAX;
export const RIPPLE_WORLD = 0.15;
export const RIPPLE_K = 6;
export const CANVAS_GAIN = 1.6;
export const SPARK_LO = 0.12;
export const SPARK_HI = 0.5;
export const ACCENT_MIN_SCORE = 0.5;
export const ACCENT_WIN_S = 2.5;
export const ACCENT_SIDE_BINS = 4;
export const ACCENT = [1, 0.72, 0.26];
export const ACCENT_LUT = [[1, 0.93, 0.8], [1, 0.84, 0.52], [1, 0.76, 0.34], ACCENT];

export function splitWeights(behav, freq, out = null) {
  const n = behav.melody.length;
  const res = out && out.mel.length === n ? out : { mel: new Float32Array(n), can: new Float32Array(n), oth: new Float32Array(n) };
  for (let i = 0; i < n; i += 1) {
    const m = behav.melody[i];
    res.mel[i] = m * (1 - freq.bass[i]);
    res.can[i] = behav.beats[i] + m * freq.bass[i];
    res.oth[i] = behav.other[i];
  }
  return res;
}

export function createPartsBaker({ total, bins, rps, sampleRate = 44100, fftSize = 8192, pitch = true }) {
  const past = Math.max(1, Math.round(HIST_S * rps));
  const fut = Math.max(1, Math.round(FUTURE_S * rps));
  const size = past + fut + 1;
  const ring = Array.from({ length: size }, () => new Float32Array(bins));
  const bands = bandWeights(bins, { sampleRate, fftSize });
  const parts = new Uint8Array(total * bins * PLANES);
  const w = { mel: new Float32Array(bins), can: new Float32Array(bins), oth: new Float32Array(bins) };
  const mags = pitch ? Array.from({ length: size }, () => new Float32Array(fftSize / 2)) : null;
  const est = pitch ? createPitchEstimator({ sampleRate, fftSize, bins }) : null;
  const tracker = pitch ? createPitchTracker() : null;
  const pitchBytes = new Uint8Array(total * 2);
  let pitchDone = 0;
  let have = 0;
  let done = 0;
  const emit = (rows) => {
    for (const r of rows) {
      if (pitchDone >= total) break;
      const [a, b] = encodePitch(r.idx, r.s);
      pitchBytes[pitchDone * 2] = a;
      pitchBytes[pitchDone * 2 + 1] = b;
      pitchDone += 1;
    }
  };
  const bake = (p) => {
    const lo = Math.max(0, p - past);
    const hi = Math.min(have - 1, p + fut);
    const win = [];
    for (let r = lo; r <= hi; r += 1) win.push(ring[r % size]);
    const cur = ring[p % size];
    const masks = hpssMasks(win, p - lo);
    splitWeights(masks, bands, w);
    if (est) emit(tracker.push(est.estimate(mags[p % size], masks.melody)));
    const o = p * bins * PLANES;
    for (let j = 0; j < bins; j += 1) {
      parts[o + j] = Math.round(cur[j] * w.mel[j] * 255);
      parts[o + bins + j] = Math.round(cur[j] * w.can[j] * 255);
      parts[o + 2 * bins + j] = Math.round(cur[j] * w.oth[j] * 255);
    }
  };
  return {
    parts,
    pitch: pitchBytes,
    get done() { return done; },
    get pitchDone() { return pitchDone; },
    add(row, mag = null) {
      ring[have % size].set(row);
      if (mags && mag) mags[have % size].set(mag);
      have += 1;
      while (done + fut < have) { bake(done); done += 1; }
    },
    finish() {
      while (done < have) { bake(done); done += 1; }
      if (tracker) emit(tracker.finish());
    },
  };
}

export function samplePartsPlane(tl, plane, t, out) {
  const bins = tl.bins;
  const stride = bins * PLANES;
  const x = t * tl.rps;
  const last = Math.min(tl.total, tl.partsDone ?? 0) - 1;
  if (!tl.parts || !(x >= 0) || x > last) { out.fill(0); return out; } // NOSONAR NaN must take the guard branch; the positive form would pass NaN through
  const i = Math.floor(x);
  const f = x - i;
  const a = i * stride + plane * bins;
  const b = Math.min(last, i + 1) * stride + plane * bins;
  const d = tl.parts;
  for (let j = 0; j < bins; j += 1) out[j] = (d[a + j] * (1 - f) + d[b + j] * f) / 255;
  return out;
}

export function createPartsFrames(rows, bins = HISTORY_BINS) {
  const mk = () => ({ rows, bins, data: new Float32Array(rows * bins), row(r) { return this.data.subarray(r * bins, (r + 1) * bins); } });
  return { mel: mk(), can: mk(), oth: mk() };
}

export function fillTimelineParts(frames, tl, tNow) {
  const { nowRow } = rowLayout(frames.mel.rows);
  let info = null;
  for (const [key, plane] of Object.entries(PLANE)) {
    info = fillTimeFrame(frames[key], tNow, (t, out) => samplePartsPlane(tl, plane, t, out), nowRow, null);
  }
  return info;
}

export function createLiveParts({ bins = HISTORY_BINS, cap = LIVE_CAP } = {}) {
  const splitter = createPartsSplitter();
  const series = { mel: createSeries(cap, bins), can: createSeries(cap, bins), oth: createSeries(cap, bins) };
  const rowM = new Float32Array(bins);
  const rowC = new Float32Array(bins);
  const rowO = new Float32Array(bins);
  let w = null;
  return {
    series,
    push(levels, t) {
      const m = splitter.push(levels, t);
      w = splitWeights(m.behav, m.freq, w);
      for (let j = 0; j < bins; j += 1) {
        const v = levels[j];
        rowM[j] = v * w.mel[j];
        rowC[j] = v * w.can[j];
        rowO[j] = v * w.oth[j];
      }
      series.mel.push(rowM, t);
      series.can.push(rowC, t);
      series.oth.push(rowO, t);
    },
    reset() { splitter.reset(); series.mel.clear(); series.can.clear(); series.oth.clear(); },
  };
}

export function fillLiveParts(frames, live, tNow) {
  const { nowRow } = rowLayout(frames.mel.rows);
  let info = null;
  for (const key of Object.keys(PLANE)) {
    const series = live.series[key];
    info = fillTimeFrame(frames[key], tNow, (t, out) => (t > tNow ? out.fill(0) : series.sample(t, out)), nowRow, null);
  }
  return info;
}

export function blendParts(a, b, k) {
  for (const key of Object.keys(PLANE)) {
    const x = a[key].data;
    const y = b[key].data;
    for (let i = 0; i < x.length; i += 1) x[i] += (y[i] - x[i]) * k;
  }
  return a;
}

function colLevel(src, c, cols, bins) {
  const pos = columnBin(c, cols, bins);
  const a = Math.floor(pos);
  const b = Math.min(bins - 1, a + 1);
  return src[a] * (1 - (pos - a)) + src[b] * (pos - a);
}

const SWELLLESS = { swellAmp: 0 };

function dilate(src, out) {
  const n = src.length;
  for (let j = 0; j < n; j += 1) {
    let m = 0;
    for (let d = 0; d < MELODY_SPREAD.length; d += 1) {
      const v = Math.max(src[Math.max(0, j - d)], src[Math.min(n - 1, j + d)]) * MELODY_SPREAD[d];
      if (v > m) m = v;
    }
    out[j] = m;
  }
  return out;
}

export function melodyHeights(mel, can, cols, out, base = 0) {
  const { rows, bins } = mel;
  const { nowRow } = rowLayout(rows);
  const ripple = RIPPLE_WORLD / AMP_MAX;
  const wide = new Float32Array(bins);
  for (let r = 0; r < rows; r += 1) {
    const src = dilate(mel.row(r), wide);
    const csrc = can.row(r);
    let peak = 0;
    for (let j = 0; j < bins; j += 1) if (src[j] > peak) peak = src[j];
    const amp = (AMP_BASE + AMP_GAIN * clamp01(peak)) / AMP_MAX;
    const phase = (base + r - nowRow) * 0.35;
    for (let c = 0; c < cols; c += 1) {
      const x = cols <= 1 ? 0 : (c / (cols - 1)) * 2 - 1;
      const h = softKnee(heightAt(colLevel(src, c, cols, bins), x, r, 0, SWELLLESS) * amp * MELODY_GAIN, MELODY_CAP);
      const wave = 0.5 + 0.5 * Math.sin(x * RIPPLE_K + phase);
      out[r * cols + c] = h + ripple * clamp01(colLevel(csrc, c, cols, bins) * CANVAS_GAIN) * wave * edgeFalloff(x);
    }
  }
  return smoothHeights(out, rows, cols, MELODY_SMOOTH);
}

export function leadOf(row) {
  const n = row.length;
  let k = 0;
  for (let i = 1; i < n; i += 1) if (row[i] > row[k]) k = i;
  const v = row[k];
  if (!(v > 0)) return { at: k, x: 0.5, score: 0 }; // NOSONAR NaN must take the guard branch; the positive form would pass NaN through
  let sum = 0;
  let cnt = 0;
  for (let i = Math.max(0, k - ACCENT_SIDE_BINS); i <= Math.min(n - 1, k + ACCENT_SIDE_BINS); i += 1) {
    if (Math.abs(i - k) > 1) { sum += row[i]; cnt += 1; }
  }
  const narrow = clamp01((v - (cnt ? sum / cnt : 0)) / v);
  return { at: k, x: n > 1 ? k / (n - 1) : 0.5, score: v * narrow };
}

export function selectLeads(scores, winRows) {
  const out = [];
  const n = scores.length;
  for (let r = 0; r < n; r += 1) {
    const s = scores[r];
    if (!(s >= ACCENT_MIN_SCORE)) continue; // NOSONAR NaN must take the guard branch; the positive form would pass NaN through
    let best = true;
    for (let k = Math.max(0, r - winRows); k <= Math.min(n - 1, r + winRows) && best; k += 1) {
      if ((k < r && scores[k] >= s) || (k > r && scores[k] > s)) best = false;
    }
    if (best) out.push(r);
  }
  return out;
}

export function accentLut(strength, out = [0, 0, 0]) {
  const f = clamp01(strength) * (ACCENT_LUT.length - 1);
  const i = Math.min(ACCENT_LUT.length - 2, Math.floor(f));
  const a = ACCENT_LUT[i];
  const b = ACCENT_LUT[i + 1];
  for (let c = 0; c < 3; c += 1) out[c] = a[c] + (b[c] - a[c]) * (f - i);
  return out;
}

function fillAttrRow(canvas, spark, r, cols, bins, csrc, osrc) {
  for (let c = 0; c < cols; c += 1) {
    canvas[r * cols + c] = clamp01(colLevel(csrc, c, cols, bins) * CANVAS_GAIN);
    spark[r * cols + c] = smoothstep(SPARK_LO, SPARK_HI, colLevel(osrc, c, cols, bins));
  }
}

function stampAccentRow(accent, k, cols, wt, x) {
  for (let c = 0; c < cols; c += 1) {
    const a = wt * landmarkShape(cols <= 1 ? 0 : c / (cols - 1), x);
    if (a > accent[k * cols + c]) accent[k * cols + c] = a;
  }
}

export function fillMelodyAttrs(attrs, mel, can, oth, cols, scratch = null) {
  const { rows, bins } = mel;
  const { dt } = rowLayout(rows);
  const { canvas, spark, accent } = attrs;
  accent.fill(0);
  const scores = scratch?.scores?.length === rows ? scratch.scores : new Float32Array(rows);
  const leads = new Array(rows);
  for (let r = 0; r < rows; r += 1) {
    fillAttrRow(canvas, spark, r, cols, bins, can.row(r), oth.row(r));
    leads[r] = leadOf(mel.row(r));
    scores[r] = leads[r].score;
  }
  smoothHeights(canvas, rows, cols, 1);
  const spreadRows = Math.ceil(0.25 / dt);
  for (const r of selectLeads(scores, Math.max(1, Math.round(ACCENT_WIN_S / dt)))) {
    const { x, score } = leads[r];
    for (let k = Math.max(0, r - spreadRows); k <= Math.min(rows - 1, r + spreadRows); k += 1) {
      const wt = landmarkWeight((k - r) * dt) * score;
      if (wt > 0) stampAccentRow(accent, k, cols, wt, x);
    }
  }
  return attrs;
}

const U_LUT = Float32Array.from({ length: PITCH_LEVELS }, (_, i) => hzToU(idxToHz(i)));
export const ACCENT_RIDGE = 0.85;

const newPitchOut = () => ({ u: 0, s: 0 });

export function samplePitch(tl, t, out = newPitchOut()) {
  const last = Math.min(tl.total, tl.pitchDone ?? 0) - 1;
  const x = t * tl.rps;
  out.s = 0;
  if (!tl.pitch || !(x >= 0) || x > last) return out; // NOSONAR NaN must take the guard branch; the positive form would pass NaN through
  const i = Math.floor(x);
  const f = x - i;
  const j = Math.min(last, i + 1);
  const sa = tl.pitch[i * 2 + 1] / 255;
  const sb = tl.pitch[j * 2 + 1] / 255;
  const ua = U_LUT[tl.pitch[i * 2]];
  const ub = U_LUT[tl.pitch[j * 2]];
  if (sa > 0 && sb > 0 && Math.abs(ua - ub) < LEAD_JOIN_U) {
    out.u = ua + (ub - ua) * f;
    out.s = sa + (sb - sa) * f;
  } else if (f < 0.5 ? sa > 0 : sb > 0) {
    out.u = f < 0.5 ? ua : ub;
    out.s = f < 0.5 ? sa : sb;
  }
  return out;
}

export function fillLeadRidge(tl, base, rows, cols, heights, accent, k = 1) {
  const { dt, nowRow } = rowLayout(rows);
  const sigma = Math.max(0.5, LEAD_SIGMA * cols);
  const cap = LANDMARK_MAX / AMP_MAX;
  const p = { u: 0, s: 0 };
  for (let r = 0; r < rows; r += 1) {
    samplePitch(tl, (base + r - nowRow) * dt, p);
    if (!(p.s > 0)) continue; // NOSONAR NaN must take the guard branch; the positive form would pass NaN through
    const hn = softKnee((p.s * LEAD_GAIN * k) / AMP_MAX, cap);
    const c0 = p.u * (cols - 1);
    for (let c = Math.max(0, Math.floor(c0 - 3 * sigma)); c <= Math.min(cols - 1, Math.ceil(c0 + 3 * sigma)); c += 1) {
      const g = Math.exp(-0.5 * ((c - c0) / sigma) ** 2);
      const o = r * cols + c;
      if (hn * g > heights[o]) heights[o] = hn * g;
      if (accent && ACCENT_RIDGE * g * k > accent[o]) accent[o] = ACCENT_RIDGE * g * k;
    }
  }
  return heights;
}
