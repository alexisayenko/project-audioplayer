import { MIN_HZ, MAX_HZ } from './viz-constants.js';

export const F0_MIN = 80;
export const F0_MAX = 1200;
export const PITCH_LEVELS = 256;
export const HARMONICS = 5;
export const MAG_FLOOR = 1e-4;
export const MAG_SPAN = 3;
export const LOUD_NORM = 2;
export const LEAD_MIN_CONF = 0.25;
export const LEAD_MIN_LOUD = 0.12;
export const CAND_MAX = 3;
export const CAND_REL = 0.6;
export const CAND_SEP_SEMI = 2;
export const JUMP_SEMITONES = 5;
export const JUMP_COST = 0.3;
export const OCTAVE_COST = 0.45;
export const SMALL_STEP_COST = 0.04;
export const PITCH_LAG = 4;
export const LEAD_GAIN = 2.2;
export const LEAD_SIGMA = 0.025;
export const LEAD_JOIN_U = 0.08;
export const SEMI_PER_IDX = (12 * Math.log2(F0_MAX / F0_MIN)) / (PITCH_LEVELS - 1);

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export const idxToHz = (idx) => F0_MIN * (F0_MAX / F0_MIN) ** (Math.min(PITCH_LEVELS - 1, Math.max(0, idx)) / (PITCH_LEVELS - 1));
export const hzToIdx = (hz) => Math.min(PITCH_LEVELS - 1, Math.max(0, Math.round(((PITCH_LEVELS - 1) * Math.log(hz / F0_MIN)) / Math.log(F0_MAX / F0_MIN))));
export const hzToU = (hz) => clamp01(Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ));
export const encodePitch = (idx, strength) => [Math.min(255, Math.max(0, Math.round(idx))), Math.round(clamp01(strength) * 255)];
export const decodePitch = (idxByte, strengthByte) => ({ hz: idxToHz(idxByte), u: hzToU(idxToHz(idxByte)), strength: strengthByte / 255 });

export function createPitchEstimator({ sampleRate = 44100, fftSize = 8192, bins = 64 } = {}) {
  const half = fftSize / 2;
  const binHz = sampleRate / fftSize;
  const top = Math.min(half - 1, Math.ceil((F0_MAX * HARMONICS) / binHz) + 2);
  const lo = Math.max(1, Math.min(MIN_HZ, Math.min(MAX_HZ, sampleRate / 2) / 2));
  const hi = Math.min(MAX_HZ, sampleRate / 2);
  const maskBin = new Int16Array(top + 1);
  for (let k = 0; k <= top; k += 1) {
    const u = Math.log(Math.max(k * binHz, lo) / lo) / Math.log(hi / lo);
    maskBin[k] = Math.min(bins - 1, Math.max(0, Math.round(u * (bins - 1))));
  }
  const pos = new Float32Array(PITCH_LEVELS * HARMONICS).fill(-1);
  const wt = new Float32Array(HARMONICS);
  let wsum = 0;
  for (let h = 0; h < HARMONICS; h += 1) { wt[h] = 1 / (h + 1); wsum += wt[h]; }
  for (let i = 0; i < PITCH_LEVELS; i += 1) {
    const f0 = idxToHz(i);
    for (let h = 0; h < HARMONICS; h += 1) {
      const p = ((h + 1) * f0) / binHz;
      if (p < top - 1) pos[i * HARMONICS + h] = p;
    }
  }
  const L = new Float32Array(top + 2);
  const score = new Float32Array(PITCH_LEVELS);
  const sorted = new Float32Array(PITCH_LEVELS);
  const fillLevels = (mag, melody) => {
    for (let k = 0; k <= top; k += 1) {
      const m = mag[k] * melody[maskBin[k]];
      L[k] = m > MAG_FLOOR ? clamp01(Math.log10(m / MAG_FLOOR) / MAG_SPAN) : 0;
    }
  };
  const scoreAll = () => {
    let peak = 0;
    for (let i = 0; i < PITCH_LEVELS; i += 1) {
      let acc = 0;
      for (let h = 0; h < HARMONICS; h += 1) {
        const p = pos[i * HARMONICS + h];
        if (p < 0) continue;
        const a = Math.floor(p);
        acc += wt[h] * Math.max(L[a], L[a + 1]);
      }
      score[i] = acc / wsum;
      if (score[i] > peak) peak = score[i];
    }
    return peak;
  };
  const pickCands = (peak) => {
    const cands = [];
    for (let i = 0; i < PITCH_LEVELS; i += 1) {
      const v = score[i];
      if (v >= CAND_REL * peak && v >= (i ? score[i - 1] : -1) && v > (i < PITCH_LEVELS - 1 ? score[i + 1] : -1)) cands.push({ idx: i, e: v * LOUD_NORM });
    }
    cands.sort((a, b) => b.e - a.e || a.idx - b.idx);
    const picked = [];
    for (const c of cands) {
      if (picked.length < CAND_MAX && picked.every((p) => Math.abs(p.idx - c.idx) * SEMI_PER_IDX >= CAND_SEP_SEMI)) picked.push(c);
    }
    return picked;
  };
  return {
    estimate(mag, melody) {
      fillLevels(mag, melody);
      const peak = scoreAll();
      sorted.set(score);
      sorted.sort();
      const median = sorted[PITCH_LEVELS >> 1];
      const conf = peak > 0 ? (peak - median) / peak : 0;
      const loud = clamp01(peak * LOUD_NORM);
      const strong = conf >= LEAD_MIN_CONF && loud >= LEAD_MIN_LOUD;
      return { cands: strong ? pickCands(peak) : [], conf, loud };
    },
  };
}

export function transitionCost(ia, ib) {
  const d = Math.abs(ib - ia) * SEMI_PER_IDX;
  if (d <= 1) return 0;
  let c = d <= JUMP_SEMITONES ? SMALL_STEP_COST * (d - 1) : Math.min(0.8, JUMP_COST + 0.02 * (d - JUMP_SEMITONES));
  const octs = Math.round(d / 12);
  if (octs >= 1 && Math.abs(d - 12 * octs) < 1) c += OCTAVE_COST;
  return c;
}

export function createPitchTracker({ lag = PITCH_LAG } = {}) {
  const rows = [];
  const fin = [];
  const out = [];
  let fp = 0;
  let given = 0;
  let finished = false;

  const finalise = (row, state) => {
    const c = rows[row].cands[state];
    fin[row] = { idx: c.idx, s: clamp01(c.e) * rows[row].conf };
  };

  const backtrack = (last, from) => {
    const states = new Array(last - from + 1);
    let s = 0;
    const dp = rows[last].dp;
    for (let i = 1; i < dp.length; i += 1) if (dp[i] > dp[s]) s = i;
    for (let r = last; r >= from; r -= 1) {
      states[r - from] = s;
      if (r > from) s = rows[r].bp[s];
    }
    return states;
  };

  const flush = (last) => {
    if (last >= fp && rows[last].cands.length) {
      const st = backtrack(last, fp);
      st.forEach((s, i) => finalise(fp + i, s));
    }
    fp = last + 1;
  };

  const drain = () => {
    while (fin[given] !== undefined && (fin[given + 1] !== undefined || finished)) {
      const prev = fin[given - 1];
      const cur = fin[given];
      const next = fin[given + 1];
      let idx = cur.idx;
      if (cur.s > 0 && prev?.s > 0 && next?.s > 0) {
        const a = [prev.idx, cur.idx, next.idx].sort((x, y) => x - y);
        idx = a[1];
      }
      out.push({ idx: cur.s > 0 ? idx : 0, s: cur.s });
      given += 1;
    }
  };

  const take = () => { const r = out.splice(0); return r; };

  return {
    push({ cands, conf }) {
      const r = rows.length;
      const row = { cands, conf };
      rows.push(row);
      if (!cands.length) {
        flush(r - 1);
        fp = r + 1;
        fin[r] = { idx: 0, s: 0 };
        drain();
        return take();
      }
      const prev = r > 0 ? rows[r - 1] : null;
      row.dp = new Float32Array(cands.length);
      row.bp = new Int16Array(cands.length);
      for (let j = 0; j < cands.length; j += 1) {
        let best = 0;
        let bi = -1;
        if (prev?.cands.length && r - 1 >= fp) {
          best = -Infinity;
          for (let i = 0; i < prev.cands.length; i += 1) {
            const v = prev.dp[i] - transitionCost(prev.cands[i].idx, cands[j].idx);
            if (v > best) { best = v; bi = i; }
          }
        }
        row.dp[j] = cands[j].e + best;
        row.bp[j] = bi;
      }
      while (r - fp >= lag) {
        const st = backtrack(r, fp);
        finalise(fp, st[0]);
        fp += 1;
      }
      drain();
      return take();
    },
    finish() {
      finished = true;
      const last = rows.length - 1;
      if (last >= fp) flush(last);
      drain();
      return take();
    },
  };
}
