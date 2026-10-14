import { barEdges } from './viz-spectrum.js';

export const PARTS_STORAGE_KEY = 'ap2.viz.parts';
export const FREQ_PARTS = [
  { id: 'bass', label: 'Bass', title: 'Bass (up to about 250 Hz)' },
  { id: 'mids', label: 'Mids', title: 'Mids (about 250 Hz to 4 kHz)' },
  { id: 'highs', label: 'Highs', title: 'Highs (above about 4 kHz)' },
];
export const BEHAV_PARTS = [
  { id: 'beats', label: 'Beats', title: 'Beats (short, repeated, broadband hits)' },
  { id: 'melody', label: 'Melody', title: 'Melody (sustained tonal sound: vocals, leads, bass line)' },
  { id: 'other', label: 'Other', title: 'Other (noise, effects, whatever is neither)' },
];
export const ROWS = { freq: FREQ_PARTS, behav: BEHAV_PARTS };
export const BASS_EDGE_HZ = 250;
export const HIGH_EDGE_HZ = 4000;
export const CROSS_OCT = 1 / 3;
export const HIST_S = 0.5;
export const FUTURE_S = 0.5;
export const MAX_FRAMES = 32;
export const OTHER_LO = 0.5;
export const OTHER_HI = 0.7;
export const EPS = 1e-6;
export const ATTACK_S = 0.05;
export const RELEASE_S = 0.15;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function defaultParts() {
  return {
    freq: { bass: true, mids: true, highs: true },
    behav: { beats: true, melody: true, other: true },
  };
}

export function validateParts(raw) {
  const out = defaultParts();
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return out; }
  }
  if (!obj || typeof obj !== 'object') return out;
  for (const row of Object.keys(ROWS)) {
    const src = obj[row];
    if (!src || typeof src !== 'object') continue;
    const next = {};
    for (const { id } of ROWS[row]) {
      if (typeof src[id] !== 'boolean') { next[id] = true; continue; }
      next[id] = src[id];
    }
    if (ROWS[row].some(({ id }) => next[id])) out[row] = next;
  }
  return out;
}

export const rowAllOn = (state, row) => ROWS[row].every(({ id }) => state[row][id]);
export const allOn = (state) => rowAllOn(state, 'freq') && rowAllOn(state, 'behav');

export function toggleParts(state, row, id) {
  const cur = state[row];
  if (!(id in cur)) return { state, changed: false, refused: false };
  if (cur[id] && ROWS[row].filter((p) => cur[p.id]).length === 1) return { state, changed: false, refused: true };
  return { state: { ...state, [row]: { ...cur, [id]: !cur[id] } }, changed: true, refused: false };
}

const smooth = (x) => x * x * (3 - 2 * x);

export function lowWeight(f, edgeHz, oct = CROSS_OCT) {
  const u = (Math.log2(f) - Math.log2(edgeHz)) / oct;
  if (u <= -0.5) return 1;
  if (u >= 0.5) return 0;
  return 0.5 + 0.5 * Math.cos(Math.PI * (u + 0.5));
}

export function bandWeights(n, opts = {}) {
  const { sampleRate = 44100, fftSize = 8192, bassHz = BASS_EDGE_HZ, highHz = HIGH_EDGE_HZ, oct = CROSS_OCT } = opts;
  const bass = new Float32Array(n);
  const mids = new Float32Array(n);
  const highs = new Float32Array(n);
  const e = barEdges(n, sampleRate, fftSize);
  for (let i = 0; i < n; i += 1) {
    const f = Math.sqrt(e[i] * e[i + 1]);
    const b = lowWeight(f, bassHz, oct);
    const h = 1 - lowWeight(f, highHz, oct);
    bass[i] = b;
    highs[i] = Math.min(h, 1 - b);
    mids[i] = 1 - bass[i] - highs[i];
  }
  return { bass, mids, highs };
}

function insertSorted(buf, len, v) {
  let j = len;
  while (j > 0 && buf[j - 1] > v) { buf[j] = buf[j - 1]; j -= 1; }
  buf[j] = v;
}

export function median(values, scratch = new Float32Array(values.length)) {
  const n = values.length;
  for (let i = 0; i < n; i += 1) insertSorted(scratch, i, values[i]);
  return n ? scratch[n >> 1] : 0;
}

export function freqHalfWidth(n) {
  return Math.min(5, Math.max(2, Math.round(n / 100)));
}

export function hpssMasks(frames, index, opts = {}) {
  const cur = frames[index];
  const n = cur.length;
  const half = opts.freqHalf ?? freqHalfWidth(n);
  const lo = Math.max(0, opts.from ?? 0);
  const hi = Math.min(frames.length - 1, opts.to ?? frames.length - 1);
  const win = new Float32Array(hi - lo + 1);
  const nb = new Float32Array(2 * half + 1);
  const beats = new Float32Array(n);
  const melody = new Float32Array(n);
  const other = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let c = 0;
    for (let k = lo; k <= hi; k += 1) insertSorted(win, c++, frames[k][i]);
    const H = win[c >> 1];
    let m = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k += 1) insertSorted(nb, m++, cur[k]);
    const P = nb[m >> 1];
    const h2 = H * H;
    const p2 = P * P;
    const hm = (h2 + EPS) / (h2 + p2 + 2 * EPS);
    const pm = 1 - hm;
    const o = smooth(clamp01((OTHER_HI - Math.max(hm, pm)) / (OTHER_HI - OTHER_LO)));
    melody[i] = hm * (1 - o);
    beats[i] = pm * (1 - o);
    other[i] = o;
  }
  return { beats, melody, other };
}

export function createPartsSplitter(opts = {}) {
  const {
    histS = HIST_S, maxFrames = MAX_FRAMES, sampleRate = 44100, fftSize = 8192,
  } = opts;
  let hist = [];
  let bandsFor = 0;
  let bands = null;
  const bandsOf = (n) => {
    if (bandsFor !== n) { bands = bandWeights(n, { sampleRate, fftSize, ...opts.bands }); bandsFor = n; }
    return bands;
  };
  return {
    push(levels, timeS, future = []) {
      const n = levels.length;
      const copy = Float32Array.from(levels);
      if (hist.length && hist[0].v.length !== n) hist = [];
      hist.push({ t: timeS, v: copy });
      while (hist.length > 1 && (timeS - hist[0].t > histS || hist.length > maxFrames)) hist.shift();
      const ahead = (future ?? []).filter((fr) => fr.length === n).slice(0, Math.max(0, maxFrames - hist.length));
      const frames = hist.map((h) => h.v).concat(ahead);
      const m = hpssMasks(frames, hist.length - 1, {});
      return { freq: bandsOf(n), behav: m };
    },
    reset() { hist = []; },
    get frames() { return hist.length; },
  };
}

export function combineWeights(state, masks, out = null) {
  const n = masks.freq.bass.length;
  const res = out && out.length === n ? out : new Float32Array(n);
  const fOn = rowAllOn(state, 'freq');
  const bOn = rowAllOn(state, 'behav');
  for (let i = 0; i < n; i += 1) {
    let f = 1;
    let b = 1;
    if (!fOn) {
      f = (state.freq.bass ? masks.freq.bass[i] : 0) + (state.freq.mids ? masks.freq.mids[i] : 0) + (state.freq.highs ? masks.freq.highs[i] : 0);
    }
    if (!bOn) {
      b = (state.behav.beats ? masks.behav.beats[i] : 0) + (state.behav.melody ? masks.behav.melody[i] : 0) + (state.behav.other ? masks.behav.other[i] : 0);
    }
    res[i] = clamp01(f) * clamp01(b);
  }
  return res;
}

export function createPartsFilter(opts = {}) {
  let state = defaultParts();
  const splitter = createPartsSplitter(opts);
  let gains = null;
  let target = null;
  let out = null;
  let lastT = null;
  return {
    setState(next) { state = validateParts(next); if (allOn(state)) splitter.reset(); },
    get state() { return state; },
    get active() { return !allOn(state) || gains !== null; },
    apply(levels, shaped, timeS) {
      const on = !allOn(state);
      if (!on && !gains) return shaped;
      const n = shaped.length;
      const dt = lastT == null ? 1 / 30 : Math.min(0.2, Math.max(0, timeS - lastT));
      lastT = timeS;
      if (!gains || gains.length !== n) gains = new Float32Array(n).fill(1);
      if (on) {
        target = combineWeights(state, splitter.push(levels, timeS), target?.length === n ? target : null);
      } else if (!target || target.length !== n) target = new Float32Array(n).fill(1);
      else target.fill(1);
      if (!out || out.length !== n) out = new Float32Array(n);
      const ka = 1 - Math.exp(-dt / ATTACK_S);
      const kr = 1 - Math.exp(-dt / RELEASE_S);
      let settled = !on;
      for (let i = 0; i < n; i += 1) {
        const g = gains[i];
        const k = target[i] > g ? ka : kr;
        gains[i] = g + (target[i] - g) * k;
        out[i] = shaped[i] * gains[i];
        if (!on && gains[i] < 0.995) settled = false;
      }
      if (settled) { gains = null; lastT = null; return shaped; }
      return out;
    },
    reset() { splitter.reset(); gains = null; lastT = null; },
  };
}
