export const MIN_BPM = 60;
export const MAX_BPM = 200;
export const WINDOW_S = 10;
export const MIN_ONSETS = 6;
export const MIN_SPAN_S = 4;
export const HINT_TOLERANCE = 0.04;

const REFRACTORY_S = 0.15;
const FLUX_HISTORY_S = 1.5;
const FLUX_FLOOR = 0.02;
const FLUX_SIGMAS = 1.5;
const GRID_STEP = 0.25;
const SIGMA_S = 0.02;
const MAX_MULTIPLE = 4;
const PRIOR_CENTRE = 120;
const PRIOR_OCTAVES = 1;

function prior(bpm) {
  const d = Math.log2(bpm / PRIOR_CENTRE) / PRIOR_OCTAVES;
  return Math.exp(-0.5 * d * d);
}

export function scoreTempo(onsets, bpm) {
  const period = 60 / bpm;
  const reach = period * MAX_MULTIPLE + 3 * SIGMA_S;
  let sum = 0;
  for (let i = 0; i < onsets.length; i += 1) {
    for (let j = i + 1; j < onsets.length; j += 1) {
      const dt = onsets[j] - onsets[i];
      if (dt > reach) break;
      for (let k = 1; k <= MAX_MULTIPLE; k += 1) {
        const d = dt - k * period;
        if (Math.abs(d) < 3 * SIGMA_S) sum += Math.exp(-(d * d) / (2 * SIGMA_S * SIGMA_S));
      }
    }
  }
  return sum * prior(bpm);
}

export function estimateTempo(onsets) {
  if (onsets.length < MIN_ONSETS || onsets[onsets.length - 1] - onsets[0] < MIN_SPAN_S) return null;
  let best = 0;
  let bestBpm = null;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += GRID_STEP) {
    const s = scoreTempo(onsets, bpm);
    if (s > best) { best = s; bestBpm = bpm; }
  }
  return bestBpm;
}

export function applyHint(bpm, stored) {
  if (!(bpm > 0) || !(stored > 0)) return bpm;
  for (const candidate of [bpm * 2, bpm / 2]) {
    if (candidate >= MIN_BPM && candidate <= MAX_BPM && Math.abs(candidate - stored) / stored <= HINT_TOLERANCE && Math.abs(bpm - stored) / stored > HINT_TOLERANCE) return candidate;
  }
  return bpm;
}

export function createLiveBpm({ windowS = WINDOW_S } = {}) {
  let hint = null;
  let onsets = [];
  let flux = [];
  let prev = null;
  let lastOnset = -Infinity;

  const trim = (now) => {
    while (onsets.length && onsets[0] < now - windowS) onsets.shift();
    while (flux.length && flux[0].t < now - FLUX_HISTORY_S) flux.shift();
  };

  return {
    setHint(bpm) { hint = bpm > 0 ? Number(bpm) : null; },
    reset() { onsets = []; flux = []; prev = null; lastOnset = -Infinity; },
    push(t, energy) {
      const f = prev === null ? 0 : Math.max(0, energy - prev);
      prev = energy;
      trim(t);
      let onset = false;
      if (flux.length >= 8 && f > FLUX_FLOOR && t - lastOnset >= REFRACTORY_S) {
        let mean = 0;
        for (const x of flux) mean += x.f;
        mean /= flux.length;
        let variance = 0;
        for (const x of flux) variance += (x.f - mean) ** 2;
        const threshold = mean + FLUX_SIGMAS * Math.sqrt(variance / flux.length);
        if (f > threshold) { onsets.push(t); lastOnset = t; onset = true; }
      }
      flux.push({ t, f });
      return onset;
    },
    onsetTimes() { return onsets.slice(); },
    estimate() {
      const raw = estimateTempo(onsets);
      if (raw === null) return null;
      return Math.round(applyHint(raw, hint));
    },
  };
}
