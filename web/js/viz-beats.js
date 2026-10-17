import {
  HISTORY_BINS, AMP_MAX, LANDMARK_MAX, clamp01, smoothstep, rowLayout, softKnee,
} from './viz-terrain-math.js';

export const BEAT_BINS = 32;
export const BEAT_WINDOW_ROWS = 16;
export const BEAT_MAD_K = 3;
export const BEAT_MIN_FLUX = 0.03;
export const BEAT_FLUX_FULL = 0.22;
export const BEAT_REF_FLOOR = 0.15;
export const BEAT_REF_HALF_LIFE_S = 20;
export const BEAT_LOUD_REF = 0.45;
export const BEAT_COLD_S = 0.3;
export const BEAT_COLD_FLUX = 0.12;
export const BEAT_MIN_HIST = 6;
export const BEAT_MIN_GAP_S = 0.18;
export const BEAT_RISE_S = 0.15;
export const BEAT_DECAY_S = 5;
export const BEAT_SPREAD_S = 0.4;
export const BEAT_AHEAD_FADE_S = 0.1;
export const BEAT_LEAD_S = 0.03;
export const BEAT_SHIFT_TIMELINE_S = 0.03;
export const BEAT_SHIFT_LIVE_S = -0.06;
export const BEAT_AMP_MIN = 1;
export const BEAT_AMP_MAX = 0.75 * LANDMARK_MAX;
export const BEAT_AMP_EXP = 1.5;
export const BEAT_CAP = LANDMARK_MAX / AMP_MAX;
export const SINGLE_SIGMA_COLS = 1.5;
export const HILL_SIGMA = 0.1;
export const HILL_FOLLOW = 0.6;
export const MULTI_MAX = 5;
export const MULTI_SPACING = 0.08;
export const MULTI_REL = 0.5;
export const MULTI_MIN_LEVEL = 0.05;
export const BEAT_VIS_FRAC = 0.28;

export function visibleCols(cols) {
  return Math.max(1, Math.min(cols, 2 * Math.round((cols * BEAT_VIS_FRAC) / 2) + 1));
}

export function beatFlux(row, prev, bins = BEAT_BINS) {
  const n = Math.min(bins, row.length, prev.length);
  if (!n) return 0;
  let s = 0;
  for (let j = 0; j < n; j += 1) {
    const d = row[j] - prev[j];
    if (d > 0) s += d;
  }
  return s / n;
}

function median(values) {
  const a = Array.from(values).sort((x, y) => x - y);
  const n = a.length;
  if (!n) return 0;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

export function beatThreshold(history) {
  const med = median(history);
  const mad = median(Array.from(history, (v) => Math.abs(v - med)));
  const base = Math.max(BEAT_MIN_FLUX, med + BEAT_MAD_K * mad);
  return history.length < BEAT_MIN_HIST ? Math.max(base, BEAT_COLD_FLUX) : base;
}

export function beatLoudness(spectrum, bins = BEAT_BINS) {
  const n = Math.min(bins, spectrum.length);
  if (!n) return 0;
  let sum = 0;
  for (let j = 0; j < n; j += 1) sum += spectrum[j];
  return clamp01(sum / n / BEAT_LOUD_REF);
}

export function createBeatDetector({ bins = HISTORY_BINS, shift = 0 } = {}) {
  let prev = null;
  let prevT = 0;
  let prevFlux = 0;
  let hist = [];
  let lastBeat = -Infinity;
  let ref = BEAT_REF_FLOOR;
  let refT = null;
  let firstT = null;
  return {
    push(row, t) {
      const cur = new Float32Array(bins);
      for (let j = 0; j < bins; j += 1) cur[j] = clamp01(row[j]);
      if (!prev) { prev = cur; prevT = t; firstT = t; return null; }
      if (refT !== null && t > refT) ref = Math.max(BEAT_REF_FLOOR, ref * 0.5 ** ((t - refT) / BEAT_REF_HALF_LIFE_S));
      refT = t;
      const f = beatFlux(cur, prev);
      const f2 = hist.length ? hist.at(-1) : 0;
      let beat = null;
      const cold = prevT - firstT < BEAT_COLD_S && prevFlux < BEAT_COLD_FLUX;
      if (!cold && prevFlux > beatThreshold(hist) && prevFlux >= f2 && prevFlux > f && prevT - lastBeat >= BEAT_MIN_GAP_S) {
        const spectrum = new Float32Array(bins);
        for (let j = 0; j < bins; j += 1) spectrum[j] = Math.max(prev[j], cur[j]);
        ref = Math.max(ref, prevFlux);
        beat = { t: prevT + shift, strength: clamp01(prevFlux / ref) * beatLoudness(spectrum), spectrum };
        lastBeat = prevT;
      }
      hist.push(prevFlux);
      if (hist.length > BEAT_WINDOW_ROWS) hist = hist.slice(hist.length - BEAT_WINDOW_ROWS);
      prev = cur;
      prevT = t;
      prevFlux = f;
      return beat;
    },
  };
}

export function timelineBeats(tl) {
  const st = tl.beatState || (tl.beatState = { det: createBeatDetector({ bins: tl.bins, shift: BEAT_SHIFT_TIMELINE_S }), next: 0, beats: [] });
  const last = Math.min(tl.total, tl.done);
  const row = new Float32Array(tl.bins);
  while (st.next < last) {
    const o = st.next * tl.bins;
    for (let j = 0; j < tl.bins; j += 1) row[j] = tl.data[o + j] / 255;
    const b = st.det.push(row, st.next / tl.rps);
    if (b) st.beats.push(b);
    st.next += 1;
  }
  return st.beats;
}

export function createLiveBeats() {
  const det = createBeatDetector({ shift: BEAT_SHIFT_LIVE_S });
  const beats = [];
  return {
    beats,
    push(row, t) {
      const b = det.push(row, t);
      if (b) {
        beats.push(b);
        while (beats.length && beats[0].t < b.t - BEAT_DECAY_S - BEAT_SPREAD_S - 1) beats.shift();
      }
      return b;
    },
  };
}

export function beatAmp(strength) {
  return BEAT_AMP_MIN + (BEAT_AMP_MAX - BEAT_AMP_MIN) * clamp01(strength) ** BEAT_AMP_EXP;
}

export function beatEnv(age) {
  if (!(age > 0)) return 0;
  if (age < BEAT_RISE_S) return smoothstep(0, 1, age / BEAT_RISE_S);
  if (age >= BEAT_DECAY_S) return 0;
  const x = (age - BEAT_RISE_S) / (BEAT_DECAY_S - BEAT_RISE_S);
  return (1 - x) * (1 - x);
}

export function beatTimeWeight(dt) {
  const d = Math.abs(dt);
  if (Number.isNaN(d) || d >= BEAT_SPREAD_S) return 0;
  const sigma = BEAT_SPREAD_S / 2;
  const edge = Math.exp(-0.5 * (BEAT_SPREAD_S / sigma) ** 2);
  return (Math.exp(-0.5 * (d / sigma) ** 2) - edge) / (1 - edge);
}

const colU = (c, cols) => (cols <= 1 ? 0 : c / (cols - 1));

function argmax(spectrum) {
  let k = 0;
  for (let i = 1; i < spectrum.length; i += 1) if (spectrum[i] > spectrum[k]) k = i;
  return k;
}

function binU(i, bins) {
  return bins <= 1 ? 0 : i / (bins - 1);
}

function addNarrow(out, cols, u0, level) {
  for (let c = 0; c < cols; c += 1) {
    const d = (colU(c, cols) - u0) * (cols - 1);
    const v = level * Math.exp(-0.5 * (d / SINGLE_SIGMA_COLS) ** 2);
    if (v > out[c]) out[c] = v;
  }
}

export function singleShape(spectrum, cols, out = new Float32Array(cols)) {
  out.fill(0);
  const k = argmax(spectrum);
  addNarrow(out, cols, binU(k, spectrum.length), clamp01(spectrum[k]));
  return out;
}

function levelAt(spectrum, u) {
  const pos = u * (spectrum.length - 1);
  const a = Math.floor(pos);
  const b = Math.min(spectrum.length - 1, a + 1);
  return spectrum[a] * (1 - (pos - a)) + spectrum[b] * (pos - a);
}

export function hillShape(spectrum, cols, out = new Float32Array(cols)) {
  out.fill(0);
  const k = argmax(spectrum);
  const u0 = binU(k, spectrum.length);
  const peak = clamp01(spectrum[k]);
  for (let c = 0; c < cols; c += 1) {
    const u = colU(c, cols);
    const g = Math.exp(-0.5 * ((u - u0) / HILL_SIGMA) ** 2);
    out[c] = g * (HILL_FOLLOW * clamp01(levelAt(spectrum, u)) + (1 - HILL_FOLLOW) * peak);
  }
  return out;
}

function peakCandidates(spectrum, n, floor) {
  const cand = [];
  for (let i = 0; i < n; i += 1) {
    const v = spectrum[i];
    const left = i === 0 ? -Infinity : spectrum[i - 1];
    const right = i === n - 1 ? -Infinity : spectrum[i + 1];
    if (v >= floor && v >= left && v > right) cand.push(i);
  }
  return cand;
}

export function spectralPeaks(spectrum) {
  const n = spectrum.length;
  let max = 0;
  for (let i = 0; i < n; i += 1) if (spectrum[i] > max) max = spectrum[i];
  const floor = Math.max(MULTI_MIN_LEVEL, MULTI_REL * max);
  const cand = peakCandidates(spectrum, n, floor);
  cand.sort((a, b) => spectrum[b] - spectrum[a] || a - b);
  const picked = [];
  for (const i of cand) {
    if (picked.length >= MULTI_MAX) break;
    if (picked.every((j) => Math.abs(binU(i, n) - binU(j, n)) >= MULTI_SPACING)) picked.push(i);
  }
  return picked.sort((a, b) => a - b);
}

export function multiShape(spectrum, cols, out = new Float32Array(cols)) {
  out.fill(0);
  for (const i of spectralPeaks(spectrum)) addNarrow(out, cols, binU(i, spectrum.length), clamp01(spectrum[i]));
  return out;
}

export const BEAT_SHAPES = { single: singleShape, hill: hillShape, multi: multiShape, full: multiShape };

export const beatCols = (style, cols) => visibleCols(cols);

function shapeOf(beat, style, cols) {
  const cache = beat.shapes || (beat.shapes = new Map());
  const key = `${style}:${cols}`;
  let s = cache.get(key);
  if (!s) { s = BEAT_SHAPES[style](beat.spectrum, cols); cache.set(key, s); }
  return s;
}

export function beatsBetween(beats, lo, hi) {
  let a = 0;
  let b = beats.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (beats[mid].t < lo) a = mid + 1; else b = mid;
  }
  const out = [];
  for (let i = a; i < beats.length && beats[i].t <= hi; i += 1) out.push(beats[i]);
  return out;
}

function addBeatRow(out, at, n, live, style, T, mask) {
  for (const { b, env, a } of live) {
    if (!(env > 0)) continue;
    const w = beatTimeWeight(T - b.t) * env * mask * a;
    if (!(w > 0)) continue;
    const s = shapeOf(b, style, n);
    for (let c = 0; c < n; c += 1) out[at + c] += w * s[c];
  }
}

export function fillBeatHeights({ beats, style, tNow, base, rows, cols, out }) {
  out.fill(0);
  const shape = BEAT_SHAPES[style];
  if (!shape || !beats?.length) return out;
  const { dt, nowRow } = rowLayout(rows);
  const active = beatsBetween(beats, tNow - BEAT_DECAY_S - BEAT_SPREAD_S, tNow + BEAT_SPREAD_S);
  if (!active.length) return out;
  const n = beatCols(style, cols);
  const off = (cols - n) >> 1;
  const live = active.map((b) => ({ b, env: beatEnv(tNow - b.t + BEAT_LEAD_S), a: beatAmp(b.strength) / AMP_MAX }));
  for (let r = 0; r < rows; r += 1) {
    const T = (base + r - nowRow) * dt;
    const mask = 1 - smoothstep(0, BEAT_AHEAD_FADE_S, T - tNow);
    if (!(mask > 0)) continue;
    const o = r * cols;
    addBeatRow(out, o + off, n, live, style, T, mask);
    for (let c = off; c < off + n; c += 1) out[o + c] = softKnee(out[o + c], BEAT_CAP);
  }
  return out;
}
