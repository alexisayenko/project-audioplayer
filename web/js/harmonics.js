import { el } from './dom.js';
import { icon } from './icons.js';
import { parseColor, mixColor } from './viz-color.js';
import { createMicInput, createPlayerInput, errorKey } from './harmonics-input.js';

export const TITLE = 'Pitch and harmonics';
export const MIN_HZ = 20;
export const MAX_HZ = 4000;
export const MAX_COUNT = 32;
export const MIN_ROLLOFF = -24;
export const MAX_STRINGS = 3;
export const MAX_DETUNE = 5;
export const DEFAULTS = {
  freq: 220, count: 10, rolloff: -12, decay: false, tau: 1.2, repeat: 3, strings: 1, detune: 2,
  thump: true, thumpDb: -24, twoStage: true, inharm: true, inharmB: 0.0004, hammer: true, strike: 1 / 8,
};
export const MIN_THUMP_DB = -48;
export const MAX_THUMP_DB = -12;
export const MAX_INHARM = 0.002;
export const MIN_STRIKE = 1 / 12;
export const MAX_STRIKE = 1 / 4;
export const HAMMER_FLOOR = 0.03;
export const FAST_SHARE = 0.75;
export const SLOW_MULT = 4;
export const THUMP_S = 0.06;
export const THUMP_TAU = 0.012;
export const THUMP_RISE_S = 0.002;
export const THUMP_LOW_HZ = 150;
export const THUMP_HIGH_HZ = 2500;
export const THUMP_NORM = 4;
export const MIN_TAU = 0.2;
export const MAX_TAU = 5;
export const MIN_REPEAT = 1;
export const MAX_REPEAT = 6;
export const DECAY_EXP = 0.8;
export const ATTACK_S = 0.005;
export const RELEASE_S = 0.004;
export const LOOKAHEAD_S = 0.2;
export const TICK_MS = 50;
export const SILENT = 1e-4;
export const TOTAL_GAIN = 0.3;
export const FADE_S = 0.03;
export const SMOOTH_S = 0.015;
export const MAX_RUN_MS = 10 * 60 * 1000;
export const AUDIBLE_MAX_HZ = 20000;
export const FFT_SIZE = 16384;
export const ANALYSER_DB_OFFSET = 13.56;
export const CYCLES = 3.5;
export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 20000;
export const DB_MIN = -90;
export const DB_MAX = 0;
export const GRAM_SECONDS = 10;
export const GRAM_DB_MIN = -90;
export const GRAM_DB_MAX = -10;
export const TEXT = {
  idle: 'Stopped',
  playing: 'Playing',
  hidden: 'Stopped: the page was hidden',
  timeout: 'Stopped: 10 minutes reached',
  unsupported: 'This browser cannot play audio',
  failed: 'Could not start the sound',
};
export const SOURCES = ['synth', 'mic', 'player'];
export const SOURCE_LABELS = { synth: 'Synth', mic: 'Microphone', player: 'Player' };
export const SOURCE_NOTE = 'The frequency, harmonics, decay, piano and string controls apply to the Synth source only.';
export const LIVE_RANGES = [2000, 5000, 10000];
export const DEFAULT_LIVE_MAX = 5000;
export const WAVE_MS = 40;
export const WAVE_SCALES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1];
export const PEAK_MIN_HZ = 30;
export const PEAK_FLOOR_DB = -70;
export const PEAK_EVERY_MS = 200;
export const ENSURE_EVERY_MS = 500;
export const LIVE_TEXT = {
  idle: 'Tap Listen to start',
  asking: 'Waiting for microphone permission...',
  listening: 'Listening to the microphone',
  denied: 'Microphone access is off: allow it in the browser settings for this site',
  none: 'No microphone found',
  busy: 'The microphone is in use by another app',
  unsupported: 'This browser cannot use the microphone on this page',
  failed: 'Could not start the microphone',
  hidden: 'Stopped: the page was hidden',
  timeout: 'Stopped: 10 minutes reached',
  ended: 'Stopped: the microphone was disconnected',
  devices: 'Stopped: the audio devices changed',
  nothing: 'Nothing is playing',
  player: 'Listening to the player',
  playerWait: 'Waiting for the player audio...',
  playerFailed: 'This browser cannot analyse the player audio',
};
export const THUMP_NOTE ='Hammer thump: the felt hammer hitting the strings makes a short burst of noise.';
export const TWO_NOTE = 'Two-stage decay: a quick fade first, then a long quiet tail called the aftersound.';
export const INHARM_NOTE = 'Inharmonicity: partials are slightly sharp, because a stiff string resists bending.';
export const HAMMER_NOTE = 'Hammer position: partials with a node at the strike point are very quiet.';
export const STRINGS_NOTE = 'A real piano note has up to 3 strings tuned a hair apart; their slow beating gives the shimmer.';
export const BEAT_HINT = 'With detuned strings the loudness swells slowly: beats';
export const ABOUT_TITLE ='What are harmonics?';
export const ABOUT = [
  ['Fundamental (H1)', 'is the lowest frequency, f. It sets the pitch you hear.'],
  ['Harmonics', 'are whole-number multiples of the fundamental: Hn = n x f. H2 is 2f, H3 is 3f, and so on.'],
  ['Overtones', 'are everything above the fundamental, so the first overtone is H2.'],
  ['Partials', 'are all the component frequencies of a sound, including those of real instruments that are not exact whole multiples.'],
  ['Timbre', 'is the mix of harmonic levels. It is why a piano and a flute playing the same note sound different.'],
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const flag = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

export function clampParams(p = {}) {
  return {
    freq: clamp(num(p.freq, DEFAULTS.freq), MIN_HZ, MAX_HZ),
    count: clamp(Math.round(num(p.count, DEFAULTS.count)), 1, MAX_COUNT),
    rolloff: clamp(num(p.rolloff, DEFAULTS.rolloff), MIN_ROLLOFF, 0),
    decay: p.decay === true,
    tau: clamp(num(p.tau, DEFAULTS.tau), MIN_TAU, MAX_TAU),
    repeat: clamp(num(p.repeat, DEFAULTS.repeat), MIN_REPEAT, MAX_REPEAT),
    strings: clamp(Math.round(num(p.strings, DEFAULTS.strings)), 1, MAX_STRINGS),
    detune: clamp(num(p.detune, DEFAULTS.detune), 0, MAX_DETUNE),
    thump: flag(p.thump, DEFAULTS.thump),
    thumpDb: clamp(num(p.thumpDb, DEFAULTS.thumpDb), MIN_THUMP_DB, MAX_THUMP_DB),
    twoStage: flag(p.twoStage, DEFAULTS.twoStage),
    inharm: flag(p.inharm, DEFAULTS.inharm),
    inharmB: clamp(num(p.inharmB, DEFAULTS.inharmB), 0, MAX_INHARM),
    hammer: flag(p.hammer, DEFAULTS.hammer),
    strike: clamp(num(p.strike, DEFAULTS.strike), MIN_STRIKE, MAX_STRIKE),
  };
}

export function realism(params) {
  const p = clampParams(params);
  return {
    thumpGain: p.decay && p.thump && p.thumpDb > MIN_THUMP_DB ? 10 ** (p.thumpDb / 20) : 0,
    twoStage: p.decay && p.twoStage,
    inharmB: p.decay && p.inharm ? p.inharmB : 0,
    strike: p.decay && p.hammer ? p.strike : 0,
  };
}

export function partialFreq(n, freq, B = 0) {
  return n * freq * Math.sqrt(1 + B * n * n);
}

export function strikeFactor(n, p) {
  return p > 0 ? Math.max(HAMMER_FLOOR, Math.abs(Math.sin(n * Math.PI * p))) : 1;
}

export function stageWeights(twoStage) {
  return twoStage ? { fast: FAST_SHARE, slow: 1 - FAST_SHARE } : { fast: 1, slow: 0 };
}

export function twoStageValue(t, gain, tauFast) {
  return gain * (FAST_SHARE * Math.exp(-t / tauFast) + (1 - FAST_SHARE) * Math.exp(-t / (SLOW_MULT * tauFast)));
}

export function fmtStrike(p) {
  return `1/${Math.round(1 / p)}`;
}

export function strikeToSlider(p) {
  return clamp(12 - Math.round(1 / clamp(p, MIN_STRIKE, MAX_STRIKE)), 0, 8);
}

export function sliderToStrike(i) {
  return 1 / (12 - clamp(Math.round(i), 0, 8));
}

export function fmtThump(db) {
  return db <= MIN_THUMP_DB ? 'off' : `${Math.round(db)} dB`;
}

export function stringOffsets(strings, detune) {
  if (strings <= 1) return [0];
  return strings === 2 ? [-detune, detune] : [-detune, 0, detune];
}

export function centsRatio(cents) {
  return 2 ** (cents / 1200);
}

export function beatRate(freq, strings, detune) {
  if (strings < 2 || !(detune > 0)) return 0;
  return freq * (centsRatio(strings === 2 ? 2 * detune : detune) - 1);
}

export function fmtBeat(hz) {
  return hz < 10 ? hz.toFixed(2) : hz.toFixed(1);
}

export function tauOf(n, tau1) {
  return tau1 / n ** DECAY_EXP;
}

export function envelopeValue(env, t) {
  return t <= env.t0 ? env.gain : env.gain * Math.exp(-(t - env.t0) / env.tau);
}

export function isSilent(samples) {
  for (let i = 0; i < samples.length; i += 1) if (Math.abs(samples[i]) >= SILENT) return false;
  return true;
}

export function noteInfo(freq) {
  if (!(freq > 0)) return { name: '-', cents: 0, text: '-' };
  const exact = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(exact);
  const cents = Math.round((exact - midi) * 100);
  const name = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return { name, cents, text: `${name} ${cents >= 0 ? '+' : '-'}${Math.abs(cents)} cents` };
}

export function amplitude(n, rolloff) {
  return 10 ** ((rolloff * Math.log2(n)) / 20);
}

export function playableLimit(sampleRate = 48000) {
  return Math.min(AUDIBLE_MAX_HZ, sampleRate / 2);
}

export function harmonicList(params, sampleRate = 48000) {
  const { freq, count, rolloff, strings, detune } = clampParams(params);
  const real = realism(params);
  const limit = playableLimit(sampleRate);
  const widest = centsRatio(strings > 1 ? detune : 0);
  const rows = [];
  let sum = 0;
  for (let n = 1; n <= count; n += 1) {
    const f = partialFreq(n, freq, real.inharmB);
    const played = f * widest < limit;
    const amp = amplitude(n, rolloff) * strikeFactor(n, real.strike);
    if (played) sum += amp;
    rows.push({ n, freq: f, amp, played, gain: 0, db: -Infinity });
  }
  for (const r of rows) {
    if (!r.played) continue;
    r.gain = (TOTAL_GAIN * r.amp) / sum;
    r.db = 20 * Math.log10(r.gain);
  }
  return rows;
}

export function harmonicLabel(row) {
  return `${row.n === 1 ? 'Fundamental (H1)' : `H${row.n}`} · ${fmtHz(row.freq)}`;
}

export function fmtHz(f) {
  if (!Number.isFinite(f)) return '-';
  if (f >= 10000) return `${(f / 1000).toFixed(2).replace(/\.?0+$/, '')} kHz`;
  const r = Math.round(f * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} Hz`;
}

export function sliderToHz(pos) {
  const f = MIN_HZ * (MAX_HZ / MIN_HZ) ** (clamp(pos, 0, 1000) / 1000);
  return f < 100 ? Math.round(f * 10) / 10 : Math.round(f);
}

export function hzToSlider(f) {
  return Math.round((1000 * Math.log(clamp(f, MIN_HZ, MAX_HZ) / MIN_HZ)) / Math.log(MAX_HZ / MIN_HZ));
}

export function computedWave(rows, points, cycles = CYCLES, offsets = [0]) {
  const f = rows[0]?.freq ?? DEFAULTS.freq;
  const sum = new Float32Array(points);
  const parts = rows.map(() => new Float32Array(points));
  const span = cycles / f;
  const ratios = offsets.map(centsRatio);
  for (let i = 0; i < points; i += 1) {
    const t = (i / (points - 1)) * span;
    let s = 0;
    for (let k = 0; k < rows.length; k += 1) {
      const r = rows[k];
      if (!r.played) continue;
      let v = 0;
      for (const q of ratios) v += Math.sin(2 * Math.PI * r.freq * q * t);
      v *= r.gain / ratios.length;
      parts[k][i] = v;
      s += v;
    }
    sum[i] = s;
  }
  return { sum, parts };
}

export function fundamentalOffset(samples, period) {
  const len = samples.length;
  if (!(period > 2) || len < period * 2) return -1;
  const cyc = Math.floor(len / period);
  const m = Math.floor(cyc * period);
  const start = len - m;
  const w = (2 * Math.PI) / period;
  let re = 0;
  let im = 0;
  for (let i = 0; i < m; i += 1) {
    const x = samples[start + i];
    re += x * Math.cos(w * i);
    im -= x * Math.sin(w * i);
  }
  if (re * re + im * im < 1e-12) return -1;
  const theta = Math.atan2(im, re) + Math.PI / 2;
  const phase = ((-theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return start + (phase / w);
}

export function liveWave(samples, sampleRate, freq, points, cycles = CYCLES) {
  const period = sampleRate / freq;
  const off = fundamentalOffset(samples, period);
  if (off < 0 || off + cycles * period > samples.length - 1) return null;
  const out = new Float32Array(points);
  let peak = 0;
  for (let i = 0; i < points; i += 1) {
    const pos = off + (i / (points - 1)) * cycles * period;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const v = samples[i0] * (1 - frac) + samples[Math.min(samples.length - 1, i0 + 1)] * frac;
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  return peak < 1e-4 ? null : out;
}

export function barLevels(rows, freqData, sampleRate, spreadCents = 0) {
  const bins = freqData.length;
  const bw = sampleRate / (2 * bins);
  const spread = centsRatio(spreadCents);
  return rows.map((r) => {
    if (!r.played) return -Infinity;
    const lo = Math.round(r.freq / spread / bw);
    const hi = Math.round((r.freq * spread) / bw);
    let top = -Infinity;
    for (let b = Math.max(0, lo - 2); b <= Math.min(bins - 1, hi + 2); b += 1) if (freqData[b] > top) top = freqData[b];
    return top + ANALYSER_DB_OFFSET;
  });
}

export function logPos(f, lo = SPECTRUM_MIN_HZ, hi = SPECTRUM_MAX_HZ) {
  return clamp(Math.log(f / lo) / Math.log(hi / lo), 0, 1);
}

export const AXES = ['linear', 'log'];
export const AXIS_LABELS = { linear: 'Linear', log: 'Log' };
export const AXIS_MIN_MULT = 4;
const AXIS_NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const TICK_STEPS = [1, 2, 2.5, 5, 10];

export function niceCeil(v) {
  const e = 10 ** Math.floor(Math.log10(v));
  const m = AXIS_NICE.find((k) => k * e >= v * (1 - 1e-9));
  return (m ?? 10) * e;
}

export function linearMax(freq, count, B = 0) {
  return Math.min(AUDIBLE_MAX_HZ, niceCeil(Math.max(AXIS_MIN_MULT * freq, partialFreq(count, freq, B) + freq)));
}

export function freqPos(f, axis, max) {
  return axis === 'log' ? logPos(f) : clamp(f / max, 0, 1);
}

export function axisRange(axis, freq, count, B = 0) {
  return axis === 'log' ? { axis, min: SPECTRUM_MIN_HZ, max: SPECTRUM_MAX_HZ } : { axis, min: 0, max: linearMax(freq, count, B) };
}

export function fmtTick(f) {
  return f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${+f.toFixed(1)} Hz`;
}

export function linearTicks(max, target) {
  const raw = max / clamp(Math.round(target), 1, 20);
  const e = 10 ** Math.floor(Math.log10(raw));
  const step = TICK_STEPS.map((m) => m * e).find((s) => s >= raw * 0.8);
  const out = [];
  for (let k = 0; k * step <= max * (1 + 1e-9); k += 1) out.push(+(k * step).toFixed(6));
  return out;
}

export function pickLabels(items, minGap, lo = -Infinity, hi = Infinity) {
  const shown = [];
  let edge = lo;
  for (const it of items) {
    if (it.x - it.w / 2 < edge + minGap || it.x + it.w / 2 > hi) continue;
    shown.push(it);
    edge = it.x + it.w / 2;
  }
  return shown;
}

export function gramRows(rowCount, sampleRate, bins, axis = 'log', max = SPECTRUM_MAX_HZ) {
  const bw = sampleRate / (2 * bins);
  const rows = [];
  const edge = (t) => (axis === 'log' ? SPECTRUM_MIN_HZ * (SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ) ** t : max * t);
  for (let r = 0; r < rowCount; r += 1) {
    const lo = edge(1 - (r + 1) / rowCount);
    const hi = edge(1 - r / rowCount);
    const a = clamp(Math.floor(lo / bw), 0, bins - 1);
    const b = clamp(Math.max(a, Math.ceil(hi / bw)), 0, bins - 1);
    rows.push([a, b]);
  }
  return rows;
}

export function liveAxisRange(axis, max = DEFAULT_LIVE_MAX) {
  return axis === 'log'
    ? { axis, min: SPECTRUM_MIN_HZ, max: SPECTRUM_MAX_HZ, live: true }
    : { axis, min: 0, max: LIVE_RANGES.includes(max) ? max : DEFAULT_LIVE_MAX, live: true };
}

export function niceScale(peak, current = 1) {
  const target = WAVE_SCALES.find((s) => s >= peak * 1.05) ?? WAVE_SCALES.at(-1);
  if (target >= current) return target;
  return peak * 1.05 < current * 0.4 ? target : current;
}

export function liveScope(samples, sampleRate, points, ms = WAVE_MS) {
  const win = (sampleRate * ms) / 1000;
  const len = samples.length;
  if (!(win > 2) || points < 2 || len < win * 2 + 4) return null;
  const last = len - Math.ceil(win) - 2;
  const first = Math.max(1, last - Math.floor(win));
  let peak = 0;
  for (let i = first; i < len; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  const hyst = peak * 0.1;
  let armed = false;
  let pos = first;
  let triggered = false;
  for (let i = first; i <= last; i += 1) {
    const x = samples[i];
    if (x < -hyst) armed = true;
    else if (armed && x >= 0) {
      pos = i - 1 + (-samples[i - 1]) / (x - samples[i - 1]);
      triggered = true;
      break;
    }
  }
  const out = new Float32Array(points);
  let top = 0;
  for (let k = 0; k < points; k += 1) {
    const p = pos + (k / (points - 1)) * win;
    const i0 = Math.floor(p);
    const frac = p - i0;
    const v = samples[i0] * (1 - frac) + samples[i0 + 1] * frac;
    out[k] = v;
    top = Math.max(top, Math.abs(v));
  }
  return { out, peak: top, triggered };
}

export function peakOf(freqData, sampleRate) {
  const bins = freqData.length;
  if (bins < 4 || !(sampleRate > 0)) return null;
  const bw = sampleRate / (2 * bins);
  const lo = Math.max(1, Math.ceil(PEAK_MIN_HZ / bw));
  const hi = Math.min(bins - 2, Math.floor(AUDIBLE_MAX_HZ / bw));
  let k = -1;
  let top = -Infinity;
  for (let b = lo; b <= hi; b += 1) if (freqData[b] > top) { top = freqData[b]; k = b; }
  if (k < 0 || top + ANALYSER_DB_OFFSET < PEAK_FLOOR_DB) return null;
  const a = freqData[k - 1];
  const c = freqData[k + 1];
  const den = a - 2 * top + c;
  const delta = Number.isFinite(a) && Number.isFinite(c) && den < 0 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
  return { freq: (k + delta) * bw, db: top + ANALYSER_DB_OFFSET };
}

export function peakText(peak) {
  return peak ? `Peak: ${fmtHz(peak.freq)} (${noteInfo(peak.freq).text})` : 'Peak: -';
}

export function curveLevels(freqData, sampleRate, range, count) {
  const bins = freqData.length;
  const bw = sampleRate / (2 * bins);
  const out = new Float32Array(count);
  const edge = (t) => (range.axis === 'log' ? SPECTRUM_MIN_HZ * (SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ) ** t : range.max * t);
  for (let i = 0; i < count; i += 1) {
    const lo = edge(i / count);
    const hi = edge((i + 1) / count);
    let db;
    if (hi - lo < bw) {
      const pos = clamp((lo + hi) / (2 * bw), 0, bins - 1);
      const k = Math.min(bins - 2, Math.floor(pos));
      const p = freqData[k];
      const q = freqData[k + 1];
      db = Number.isFinite(p) && Number.isFinite(q) ? p * (1 - (pos - k)) + q * (pos - k) : Math.max(p, q);
    } else {
      const a = clamp(Math.floor(lo / bw), 0, bins - 1);
      const b = clamp(Math.ceil(hi / bw), a, bins - 1);
      db = -Infinity;
      for (let k = a; k <= b; k += 1) if (freqData[k] > db) db = freqData[k];
    }
    out[i] = db + ANALYSER_DB_OFFSET;
  }
  return out;
}

export function levelColor(stops, t) {
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixColor(stops[i], stops[i + 1], x - i);
}

export const BANDS = [
  { key: 'sub', name: 'Sub', lo: 20, hi: 60 },
  { key: 'bass', name: 'Bass', lo: 60, hi: 250 },
  { key: 'mids', name: 'Mids', lo: 250, hi: 2000 },
  { key: 'highs', name: 'Highs', lo: 2000, hi: 10000 },
];
export const BEAT_SECONDS = 10;
export const ONSET_AVG_S = 0.3;
export const ONSET_MEAN_S = 2;
export const ONSET_MULT = 1.5;
export const ONSET_MIN_DB = 2;
export const ONSET_GAP_S = 0.12;
export const ONSET_FLOOR_DB = -70;
export const LANE_MIN_SPAN_DB = 6;
export const BEAT_NOTE = 'Each lane is one frequency range over the last 10 s. Regular ticks show which range carries the beat (usually Sub and Bass: the kick).';

export function bandRangeText(band) {
  const k = (f) => +(f / 1000).toFixed(2);
  return band.lo >= 1000 && band.hi >= 1000 ? `${k(band.lo)}-${k(band.hi)} kHz` : `${band.lo}-${band.hi} Hz`;
}

export function bandBins(sampleRate, bins, bands = BANDS) {
  const bw = sampleRate / (2 * bins);
  return bands.map((b) => {
    const a = clamp(Math.ceil(b.lo / bw), 1, bins - 1);
    return [a, clamp(Math.max(a, Math.floor(b.hi / bw)), a, bins - 1)];
  });
}

export function bandLevels(freqData, map) {
  return map.map(([a, z]) => {
    let sum = 0;
    for (let k = a; k <= z; k += 1) {
      const d = freqData[k];
      if (d > -Infinity) sum += 10 ** ((d + ANALYSER_DB_OFFSET) / 10);
    }
    return sum > 0 ? clamp(10 * Math.log10(sum / (z - a + 1)), DB_MIN, DB_MAX) : DB_MIN;
  });
}

export function laneRange(levels, normalize) {
  if (!normalize || !levels.length) return { lo: DB_MIN, hi: DB_MAX };
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of levels) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return { lo, hi: Math.max(hi, lo + LANE_MIN_SPAN_DB) };
}

export function createBeatTracker(count = BANDS.length) {
  const blank = () => ({ points: [], recent: [], mean: 0, last: -Infinity, above: false, level: DB_MIN, t: -1 });
  const lanes = Array.from({ length: count }, blank);
  return {
    lanes,
    reset() { lanes.forEach((_, i) => { lanes[i] = blank(); }); },
    push(t, levels) {
      return levels.map((db, i) => {
        const lane = lanes[i];
        while (lane.recent.length && t - lane.recent[0].t > ONSET_AVG_S) lane.recent.shift();
        let avg = db;
        if (lane.recent.length) avg = lane.recent.reduce((s, r) => s + r.db, 0) / lane.recent.length;
        const strength = Math.max(0, db - avg);
        const threshold = Math.max(ONSET_MIN_DB, ONSET_MULT * lane.mean);
        const above = strength > threshold && db > ONSET_FLOOR_DB;
        const onset = above && !lane.above && t - lane.last >= ONSET_GAP_S;
        const dt = lane.t >= 0 ? t - lane.t : 0;
        lane.mean += (1 - Math.exp(-dt / ONSET_MEAN_S)) * (strength - lane.mean);
        lane.above = above;
        if (onset) lane.last = t;
        lane.t = t;
        lane.level = db;
        lane.recent.push({ t, db });
        lane.points.push({ t, db, onset });
        while (lane.points.length && t - lane.points[0].t > BEAT_SECONDS) lane.points.shift();
        return onset;
      });
    },
  };
}

export function createSynth(env = {}) {
  const Ctx = env.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  let live = null;

  const voicesOf = (strings) => strings.flatMap((s) => s.voices);

  function buildString(t) {
    const trim = live.ctx.createGain();
    trim.gain.value = 0;
    trim.connect(live.master);
    const voices = [];
    for (let n = 1; n <= MAX_COUNT; n += 1) {
      const osc = live.ctx.createOscillator();
      osc.type = 'sine';
      const gain = live.ctx.createGain();
      gain.gain.value = 0;
      const gain2 = live.ctx.createGain();
      gain2.gain.value = 0;
      osc.connect(gain);
      osc.connect(gain2);
      gain.connect(trim);
      gain2.connect(trim);
      osc.start(t);
      voices.push({ osc, gain, gain2, env: { t0: 0, gain: 0, tau: Infinity }, env2: { t0: 0, gain: 0, tau: Infinity } });
    }
    return { trim, voices, fresh: true };
  }

  function release(v) {
    try { v.osc.stop(); } catch { /* already stopped */ }
    v.osc.disconnect();
    v.gain.disconnect();
    v.gain2.disconnect();
  }

  function retire(s, t) {
    const g = s.trim.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + FADE_S);
    setTimeout(() => {
      for (const v of s.voices) release(v);
      s.trim.disconnect();
    }, FADE_S * 1000 + 40);
  }

  function hold(param, t) {
    const held = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(held, t);
    return held;
  }

  function shape(param, prev, at, from, level, tau) {
    param.cancelScheduledValues(from);
    param.setValueAtTime(envelopeValue(prev, from), from);
    param.linearRampToValueAtTime(0, at);
    if (level > 0) {
      param.linearRampToValueAtTime(level, at + ATTACK_S);
      param.setTargetAtTime(0, at + ATTACK_S, tau);
    }
    return { t0: at + ATTACK_S, gain: level, tau };
  }

  function thump(at, level) {
    const { gain, hp } = live.thump;
    const g = gain.gain;
    const end = at + THUMP_S + 0.04;
    g.cancelScheduledValues(at);
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(level, at + THUMP_RISE_S);
    g.setTargetAtTime(0, at + THUMP_RISE_S, THUMP_TAU);
    g.setValueAtTime(0, end);
    const src = live.ctx.createBufferSource();
    src.buffer = live.noise;
    src.connect(hp);
    src.onended = () => src.disconnect();
    src.start(at);
    src.stop(end);
  }

  function syncStrings(n) {
    const t = live.ctx.currentTime;
    const before = live.strings.length;
    while (live.strings.length < n) live.strings.push(buildString(t));
    while (live.strings.length > n) retire(live.strings.pop(), t);
    return live.strings.length > before;
  }

  function apply(params, initial) {
    const p = clampParams(params);
    const rows = harmonicList(p, live.ctx.sampleRate);
    const offsets = stringOffsets(p.strings, p.detune);
    const t = live.ctx.currentTime;
    const limit = playableLimit(live.ctx.sampleRate) - 1;
    const B = live.decay ? live.struckB : 0;
    live.strings.forEach((s, k) => {
      const direct = initial || s.fresh;
      s.fresh = false;
      if (initial) s.trim.gain.value = 1 / p.strings;
      else s.trim.gain.setTargetAtTime(1 / p.strings, t, SMOOTH_S);
      s.voices.forEach((v, i) => {
        const gain = rows[i]?.played ? rows[i].gain : 0;
        const hz = Math.min(partialFreq(i + 1, p.freq, B), limit);
        if (direct) {
          v.osc.frequency.value = hz;
          v.osc.detune.value = offsets[k];
          v.gain.gain.value = live.decay ? 0 : gain;
          v.gain2.gain.value = 0;
        } else {
          v.osc.frequency.setTargetAtTime(hz, t, SMOOTH_S);
          v.osc.detune.setTargetAtTime(offsets[k], t, SMOOTH_S);
          if (!live.decay) {
            v.gain.gain.setTargetAtTime(gain, t, SMOOTH_S);
            v.gain2.gain.setTargetAtTime(0, t, SMOOTH_S);
          }
        }
      });
    });
  }

  function strike(at, params, strings = live.strings) {
    const now = live.ctx.currentTime;
    const p = clampParams(params);
    const real = realism(p);
    const weights = stageWeights(real.twoStage);
    const rows = harmonicList(p, live.ctx.sampleRate);
    const limit = playableLimit(live.ctx.sampleRate) - 1;
    const from = Math.max(now, at - RELEASE_S);
    voicesOf(strings).forEach((v, j) => {
      const i = j % MAX_COUNT;
      const gain = rows[i]?.played ? rows[i].gain : 0;
      const tau = tauOf(i + 1, p.tau);
      v.osc.frequency.setValueAtTime(Math.min(partialFreq(i + 1, p.freq, real.inharmB), limit), at);
      v.env = shape(v.gain.gain, v.env, at, from, gain * weights.fast, tau);
      v.env2 = shape(v.gain2.gain, v.env2, at, from, gain * weights.slow, tau * SLOW_MULT);
    });
    if (strings === live.strings) {
      live.struckB = real.inharmB;
      if (real.thumpGain > 0 && rows[0]?.played) thump(at, rows[0].gain * real.thumpGain * THUMP_NORM);
    }
  }

  function pump() {
    if (!live?.decay) return;
    const now = live.ctx.currentTime;
    if (live.next < now) live.next = now + RELEASE_S + 0.005;
    while (live.next <= now + LOOKAHEAD_S) {
      strike(live.next, live.params);
      live.last = live.next;
      live.next += live.params.repeat;
    }
    live.timer = setTimeout(pump, TICK_MS);
  }

  function enterDecay(params) {
    const t = live.ctx.currentTime;
    for (const v of voicesOf(live.strings)) {
      v.env = { t0: 0, gain: hold(v.gain.gain, t), tau: Infinity };
      v.env2 = { t0: 0, gain: hold(v.gain2.gain, t), tau: Infinity };
    }
    live.decay = true;
    live.params = clampParams(params);
    live.struckB = realism(live.params).inharmB;
    live.next = t + 0.02;
    pump();
  }

  function leaveDecay() {
    clearTimeout(live.timer);
    live.decay = false;
    live.last = 0;
    const t = live.ctx.currentTime;
    for (const v of voicesOf(live.strings)) {
      hold(v.gain.gain, t);
      hold(v.gain2.gain, t);
    }
    const g = live.thump.gain.gain;
    hold(g, t);
    g.setTargetAtTime(0, t, SMOOTH_S);
  }

  function strikeNew(added, params) {
    const now = live.ctx.currentTime;
    if (live.last > now) {
      strike(live.last, params, added);
      return;
    }
    clearTimeout(live.timer);
    live.next = now + RELEASE_S + 0.005;
    pump();
  }

  return {
    get running() { return live !== null; },
    get ctx() { return live?.ctx ?? null; },
    get analyser() { return live?.analyser ?? null; },
    start(params) {
      if (live) return live;
      if (!Ctx) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
      const ctx = new Ctx();
      void ctx.resume?.();
      const master = ctx.createGain();
      master.gain.value = 0;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.4;
      master.connect(analyser);
      analyser.connect(ctx.destination);
      const clamped = clampParams(params);
      const t = ctx.currentTime;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = THUMP_LOW_HZ;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = THUMP_HIGH_HZ;
      const tg = ctx.createGain();
      tg.gain.value = 0;
      hp.connect(lp);
      lp.connect(tg);
      tg.connect(master);
      const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (THUMP_S + 0.04)), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      live = {
        ctx, master, analyser, strings: [], decay: clamped.decay, params: clamped, next: 0, last: 0, timer: 0,
        struckB: realism(clamped).inharmB, noise, thump: { hp, lp, gain: tg },
      };
      syncStrings(clamped.strings);
      apply(params, true);
      master.gain.setValueAtTime(0, t);
      master.gain.linearRampToValueAtTime(1, t + FADE_S);
      if (live.decay) {
        live.next = t + FADE_S;
        pump();
      }
      return live;
    },
    update(params) {
      if (!live) return;
      const next = clampParams(params);
      const wasDecay = live.decay;
      const known = new Set(live.strings);
      syncStrings(next.strings);
      const added = live.strings.filter((s) => !known.has(s));
      if (next.decay && !wasDecay) enterDecay(params);
      else if (!next.decay && wasDecay) leaveDecay();
      live.params = next;
      apply(params, false);
      if (wasDecay && next.decay && added.length) strikeNew(added, next);
    },
    stop() {
      const r = live;
      if (!r) return;
      live = null;
      clearTimeout(r.timer);
      const t = r.ctx.currentTime;
      r.master.gain.cancelScheduledValues(t);
      r.master.gain.setValueAtTime(r.master.gain.value, t);
      r.master.gain.linearRampToValueAtTime(0, t + FADE_S);
      setTimeout(() => {
        for (const v of voicesOf(r.strings)) release(v);
        for (const s of r.strings) s.trim.disconnect();
        r.thump.hp.disconnect();
        r.thump.lp.disconnect();
        r.thump.gain.disconnect();
        r.master.disconnect();
        r.analyser.disconnect();
        void r.ctx.close?.();
      }, FADE_S * 1000 + 40);
    },
  };
}

function readColors(node) {
  const css = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
  const get = (name, fallback) => css?.getPropertyValue(name).trim() || fallback;
  const rgb = (name, fallback) => parseColor(get(name, fallback), parseColor(fallback));
  return {
    ink: rgb('--ink', '#1b2024'),
    muted: rgb('--ink-muted', '#5f6669'),
    line: rgb('--line', '#ddd5c6'),
    sunken: rgb('--surface-sunken', '#e9e3d6'),
    fill: rgb('--fill', '#2298b1'),
    stops: [
      rgb('--surface-sunken', '#e9e3d6'), rgb('--chart-6', '#3558c4'), rgb('--chart-3', '#7a4fc2'),
      rgb('--chart-5', '#d2601a'), rgb('--chart-4', '#a87400'),
    ],
    font: get('--font-sans', 'system-ui, sans-serif'),
  };
}

const css = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);

function fit(canvas) {
  const box = canvas.parentElement;
  const w = Math.max(1, Math.round(box?.clientWidth || canvas.clientWidth || 320));
  const h = Math.max(1, Math.round(box?.clientHeight || canvas.clientHeight || 160));
  const dpr = globalThis.devicePixelRatio || 1;
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  const resized = canvas.width !== pw || canvas.height !== ph;
  if (resized) { canvas.width = pw; canvas.height = ph; }
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr, resized };
}

const FREQ_TICKS = [[100, '100 Hz'], [1000, '1 kHz'], [10000, '10 kHz']];

export function specTicks(range, plotW) {
  if (range.axis === 'log') return FREQ_TICKS;
  return linearTicks(range.max, Math.floor(plotW / 80)).map((f) => [f, fmtTick(f)]);
}

export function gramTicks(rows, range, h, minGap = 18) {
  if (range.live && range.axis === 'linear') {
    return linearTicks(range.max, Math.floor(h / 30)).filter((f) => f > 0 && f < range.max).map((f) => [f, fmtTick(f)]);
  }
  if (range.axis === 'log') return FREQ_TICKS;
  const played = rows.filter((r) => r.played);
  if (!played.length) return [];
  const stride = Math.max(1, Math.ceil(minGap / (h * (played[0].freq / range.max))));
  return played.filter((_, i) => i % stride === 0).map((r) => [r.freq, `H${r.n} · ${fmtHz(r.freq)}`]);
}

function drawWaveView(g, colors, data, showParts) {
  const { ctx, w, h } = g;
  const left = 36;
  const bottom = 18;
  const pad = 8;
  const plotW = Math.max(1, w - left - pad);
  const mid = (h - bottom) / 2;
  const amp = mid - pad;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillStyle = css(colors.muted);
  ctx.strokeStyle = css(colors.line);
  ctx.lineWidth = 1;
  for (const [v, text] of [[TOTAL_GAIN, `+${TOTAL_GAIN}`], [0, '0'], [-TOTAL_GAIN, `-${TOTAL_GAIN}`]]) {
    const y = mid - (v / TOTAL_GAIN) * amp;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - pad, y); ctx.stroke();
    ctx.fillText(text, left - 4, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const whole = Math.floor(data.cycles);
  for (let k = 0; k <= whole; k += 1) {
    const x = left + (k / data.cycles) * plotW;
    ctx.beginPath(); ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp); ctx.stroke();
    ctx.textAlign = k === 0 ? 'left' : 'center';
    ctx.fillText(`${+((k / data.freq) * 1000).toFixed(2)} ms`, x, h - bottom + 3);
  }
  const trace = (series, style, width) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const n = series.length;
    for (let i = 0; i < n; i += 1) {
      const x = left + (i / (n - 1)) * plotW;
      const y = mid - clamp(series[i] / TOTAL_GAIN, -1.2, 1.2) * amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  if (showParts && data.parts) data.parts.forEach((p, i) => { if (data.rows[i].played) trace(p, css(colors.muted, 0.35), 1); });
  trace(data.sum, css(colors.fill), 2);
}

function drawLiveWaveView(g, colors, scope, scale) {
  const { ctx, w, h } = g;
  const left = 36;
  const bottom = 18;
  const pad = 8;
  const plotW = Math.max(1, w - left - pad);
  const mid = (h - bottom) / 2;
  const amp = mid - pad;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillStyle = css(colors.muted);
  ctx.strokeStyle = css(colors.line);
  ctx.lineWidth = 1;
  for (const v of [scale, 0, -scale]) {
    const y = mid - (v / scale) * amp;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - pad, y); ctx.stroke();
    ctx.fillText(v === 0 ? '0' : `${v > 0 ? '+' : '-'}${scale}`, left - 4, y);
  }
  ctx.textBaseline = 'top';
  const step = WAVE_MS / 4;
  for (let k = 0; k <= 4; k += 1) {
    const x = left + (k / 4) * plotW;
    ctx.beginPath(); ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp); ctx.stroke();
    ctx.textAlign = k === 0 ? 'left' : k === 4 ? 'right' : 'center';
    ctx.fillText(`${k * step} ms`, x, h - bottom + 3);
  }
  if (!scope) return;
  ctx.strokeStyle = css(colors.fill);
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const n = scope.length;
  for (let i = 0; i < n; i += 1) {
    const x = left + (i / (n - 1)) * plotW;
    const y = mid - clamp(scope[i] / scale, -1.2, 1.2) * amp;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawSpecGrid(g, colors, range) {
  const { ctx, w, h } = g;
  const left = 34;
  const right = 8;
  const top = 30;
  const bottom = 18;
  const plotW = Math.max(1, w - left - right);
  const plotH = Math.max(1, h - top - bottom);
  const yOf = (db) => top + ((DB_MAX - clamp(db, DB_MIN, DB_MAX)) / (DB_MAX - DB_MIN)) * plotH;
  const xOf = (f) => left + freqPos(f, range.axis, range.max) * plotW;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(colors.line);
  ctx.fillStyle = css(colors.muted);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const db of [0, -30, -60, -90]) {
    const y = yOf(db);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - right, y); ctx.stroke();
    ctx.fillText(String(db), left - 4, y);
  }
  ctx.textBaseline = 'top';
  for (const [f, text] of specTicks(range, plotW)) {
    const x = xOf(f);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + plotH); ctx.stroke();
    ctx.textAlign = 'center';
    const half = ctx.measureText(text).width / 2;
    ctx.fillText(text, Math.min(x, w - 2 - half), top + plotH + 3);
  }
  return { left, plotW, plotH, yOf, xOf };
}

function drawLiveSpectrumView(g, colors, freqData, sampleRate, range, peak) {
  const { ctx } = g;
  const geo = drawSpecGrid(g, colors, range);
  if (!freqData) return;
  const count = Math.max(2, Math.round(geo.plotW));
  const levels = curveLevels(freqData, sampleRate, range, count);
  const base = geo.yOf(DB_MIN);
  ctx.beginPath();
  ctx.moveTo(geo.left, base);
  for (let i = 0; i < count; i += 1) ctx.lineTo(geo.left + ((i + 0.5) / count) * geo.plotW, geo.yOf(levels[i]));
  ctx.lineTo(geo.left + geo.plotW, base);
  ctx.closePath();
  ctx.fillStyle = css(colors.fill, 0.28);
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    const x = geo.left + ((i + 0.5) / count) * geo.plotW;
    if (i === 0) ctx.moveTo(x, geo.yOf(levels[i])); else ctx.lineTo(x, geo.yOf(levels[i]));
  }
  ctx.strokeStyle = css(colors.fill);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  if (peak && peak.freq <= range.max) {
    const x = geo.xOf(peak.freq);
    ctx.fillStyle = css(colors.ink);
    ctx.beginPath(); ctx.arc(x, geo.yOf(peak.db), 3, 0, 2 * Math.PI); ctx.fill();
  }
}

function drawSpectrumView(g, colors, rows, levels, range) {
  const { ctx, w } = g;
  const { yOf, xOf } = drawSpecGrid(g, colors, range);
  const bars = [];
  rows.forEach((r, i) => {
    if (r.played && levels[i] > DB_MIN) bars.push({ r, db: levels[i], x: xOf(r.freq) });
  });
  let gap = Infinity;
  for (let i = 1; i < bars.length; i += 1) gap = Math.min(gap, bars[i].x - bars[i - 1].x);
  const bw = clamp(Number.isFinite(gap) ? gap * 0.6 : 6, 1.5, 6);
  ctx.fillStyle = css(colors.fill);
  const base = yOf(DB_MIN);
  for (const b of bars) {
    const y = yOf(b.db);
    ctx.fillRect(b.x - bw / 2, y, bw, Math.max(1, base - y));
  }
  ctx.font = `10px ${colors.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const items = bars.map((b) => {
    const hz = fmtHz(b.r.freq);
    const name = `H${b.r.n}`;
    return { ...b, name, hz, w: Math.max(ctx.measureText(name).width, ctx.measureText(hz).width) };
  });
  ctx.fillStyle = css(colors.ink);
  for (const it of pickLabels(items, 4, 0, w - 2)) {
    const y = Math.max(22, yOf(it.db) - 4);
    ctx.fillText(it.hz, it.x, y);
    ctx.fillText(it.name, it.x, y - 11);
  }
}

function drawGramAxes(g, colors, range, ticks) {
  const { ctx, w, h } = g;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  for (const [f, text] of ticks) {
    const y = h * (1 - freqPos(f, range.axis, range.max));
    ctx.strokeStyle = css(colors.ink, 0.25);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    const tw = ctx.measureText(text).width;
    const x = y + 7 > h - 17 ? 38 : 4;
    ctx.fillStyle = css(colors.sunken, 0.8);
    ctx.fillRect(x - 2, y - 7, tw + 4, 14);
    ctx.fillStyle = css(colors.ink);
    ctx.fillText(text, x, y);
  }
  ctx.textBaseline = 'bottom';
  for (const [text, x, align] of [['-10 s', 4, 'left'], ['now', w - 4, 'right']]) {
    ctx.textAlign = align;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = css(colors.sunken, 0.8);
    ctx.fillRect(align === 'left' ? x - 2 : x - tw - 2, h - 16, tw + 4, 14);
    ctx.fillStyle = css(colors.ink);
    ctx.fillText(text, x, h - 3);
  }
}

function drawBandsView(g, colors, lanes, nowT, normalize) {
  const { ctx, w, h } = g;
  const left = 74;
  const right = 22;
  const bottom = 16;
  const plotW = Math.max(1, w - left - right);
  const laneH = (h - bottom) / BANDS.length;
  const pad = 4;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  BANDS.forEach((band, i) => {
    const lane = lanes[i];
    const y0 = i * laneH;
    const top = y0 + pad;
    const ph = laneH - 2 * pad;
    ctx.strokeStyle = css(colors.line);
    ctx.beginPath(); ctx.moveTo(0, y0 + laneH - 0.5); ctx.lineTo(w, y0 + laneH - 0.5); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 11px ${colors.font}`;
    ctx.fillStyle = css(colors.ink);
    ctx.fillText(band.name, 6, y0 + laneH / 2 - 1);
    ctx.font = `10px ${colors.font}`;
    ctx.fillStyle = css(colors.muted);
    ctx.fillText(bandRangeText(band), 6, y0 + laneH / 2 + 11);
    const xOf = (t) => left + plotW - ((nowT - t) / BEAT_SECONDS) * plotW;
    const pts = lane.points.filter((p) => nowT - p.t <= BEAT_SECONDS);
    const { lo, hi } = laneRange(pts.map((p) => p.db), normalize);
    const yOf = (db) => top + (1 - clamp((db - lo) / (hi - lo), 0, 1)) * ph;
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(xOf(pts[0].t), top + ph);
      for (const p of pts) ctx.lineTo(xOf(p.t), yOf(p.db));
      ctx.lineTo(xOf(pts.at(-1).t), top + ph);
      ctx.closePath();
      ctx.fillStyle = css(colors.fill, 0.3);
      ctx.fill();
      ctx.beginPath();
      pts.forEach((p, k) => { if (k === 0) ctx.moveTo(xOf(p.t), yOf(p.db)); else ctx.lineTo(xOf(p.t), yOf(p.db)); });
      ctx.strokeStyle = css(colors.fill);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.strokeStyle = css(colors.stops[3]);
    ctx.lineWidth = 2;
    for (const p of pts) {
      if (!p.onset) continue;
      const x = Math.round(xOf(p.t));
      ctx.beginPath(); ctx.moveTo(x, y0 + 2); ctx.lineTo(x, y0 + laneH - 2); ctx.stroke();
    }
    const barX = w - right + 8;
    const barH = ph * ((lane.level - DB_MIN) / (DB_MAX - DB_MIN));
    ctx.fillStyle = css(colors.line);
    ctx.fillRect(barX, top, 8, ph);
    ctx.fillStyle = css(colors.fill);
    ctx.fillRect(barX, top + ph - barH, 8, barH);
  });
  ctx.lineWidth = 1;
  ctx.font = `10px ${colors.font}`;
  ctx.fillStyle = css(colors.muted);
  ctx.textBaseline = 'top';
  for (const [text, x, align] of [['-10 s', left, 'left'], ['now', left + plotW, 'right']]) {
    ctx.textAlign = align;
    ctx.fillText(text, x, h - bottom + 3);
  }
}

function segmented(items, current, pick, attrs) {
  const btns = items.map(([key, text]) => el('button', {
    class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', onclick: () => pick(key),
  }, text));
  const group = el('div', {
    class: 'seg hm-seg', role: 'radiogroup', ...attrs,
    onkeydown: (ev) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      if (!step) return;
      ev.preventDefault();
      const i = clamp(items.findIndex(([key]) => key === current()) + step, 0, items.length - 1);
      pick(items[i][0]);
      btns[i].focus();
    },
  }, ...btns);
  const paint = () => btns.forEach((b, i) => {
    const on = items[i][0] === current();
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  return { group, paint };
}

export function createHarmonicsCard(env = {}) {
  const doc = env.document ?? globalThis.document;
  const raf = env.raf ?? ((fn) => globalThis.requestAnimationFrame?.(fn) ?? 0);
  const caf = env.caf ?? ((id) => globalThis.cancelAnimationFrame?.(id));
  const now = env.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const synth = env.synth ?? createSynth(env);
  let params = { ...DEFAULTS };
  let showParts = false;
  let running = false;
  let frame = 0;
  let safety = 0;
  let colors = null;
  let colorsAt = 0;
  let gone = false;
  let lastTick = 0;
  let pending = 0;
  let gramRowsKey = '';
  let gramMap = [];
  let axis = 'linear';
  let gramAxisKey = '';
  let source = 'synth';
  let liveMax = DEFAULT_LIVE_MAX;
  let starting = false;
  let paused = false;
  let waveScale = 1;
  let peakAt = 0;
  let peakShown = '';
  let ensureAt = 0;
  let playerKey = '';
  let attempt = 0;
  let normalize = true;
  let beatKey = '';
  let beatMap = [];
  let beatAt = 0;
  const bands = createBeatTracker();
  const micIn = env.mic ?? createMicInput(env);
  const playerIn = env.player ?? createPlayerInput(env);
  const buffers = { time: null, freq: null };
  const off = [];

  const uid = `hm-${Math.random().toString(36).slice(2, 7)}`;
  const freqNum = el('input', { id: `${uid}-fn`, class: 'hm-num', type: 'number', min: MIN_HZ, max: MAX_HZ, step: 'any', inputmode: 'decimal', value: String(params.freq) });
  const freqRange = el('input', { id: `${uid}-fr`, class: 'slider hm-range', type: 'range', min: '0', max: '1000', step: '1', value: String(hzToSlider(params.freq)), 'aria-label': 'Frequency slider' });
  const noteOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-fn ${uid}-fr` }, noteInfo(params.freq).text);
  const countRange = el('input', { id: `${uid}-cr`, class: 'slider hm-range', type: 'range', min: '1', max: String(MAX_COUNT), step: '1', value: String(params.count) });
  const countOut = el('output', { class: 'hm-val t-subhead', htmlFor: `${uid}-cr` }, String(params.count));
  const rollRange = el('input', { id: `${uid}-dr`, class: 'slider hm-range', type: 'range', min: String(MIN_ROLLOFF), max: '0', step: '0.5', value: String(params.rolloff) });
  const rollOut = el('output', { class: 'hm-val t-subhead', htmlFor: `${uid}-dr` }, '');
  const decayBox = el('input', { id: `${uid}-dk`, type: 'checkbox', checked: params.decay, onchange: () => change({ decay: decayBox.checked }) });
  const tauRange = el('input', { id: `${uid}-tr`, class: 'slider hm-range', type: 'range', min: String(MIN_TAU), max: String(MAX_TAU), step: '0.1', value: String(params.tau) });
  const tauOut = el('output', { class: 'hm-val t-subhead', htmlFor: `${uid}-tr` }, '');
  const repeatRange = el('input', { id: `${uid}-rr`, class: 'slider hm-range', type: 'range', min: String(MIN_REPEAT), max: String(MAX_REPEAT), step: '0.5', value: String(params.repeat) });
  const repeatOut = el('output', { class: 'hm-val t-subhead', htmlFor: `${uid}-rr` }, '');
  const tauField = el('div', { class: 'hm-field', hidden: true },
    el('label', { htmlFor: `${uid}-tr` }, 'Fade time (H1)'),
    el('div', { class: 'hm-pair' }, tauRange, tauOut));
  const repeatField = el('div', { class: 'hm-field', hidden: true },
    el('label', { htmlFor: `${uid}-rr` }, 'Repeat every'),
    el('div', { class: 'hm-pair' }, repeatRange, repeatOut));
  const stringBtns = Array.from({ length: MAX_STRINGS }, (_, i) => el('button', {
    class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', onclick: () => change({ strings: i + 1 }),
  }, String(i + 1)));
  const stringsGroup = el('div', {
    class: 'seg hm-seg', role: 'radiogroup', 'aria-labelledby': `${uid}-sl`,
    onkeydown: (ev) => {
      const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[ev.key];
      if (!step) return;
      ev.preventDefault();
      const n = clamp(params.strings + step, 1, MAX_STRINGS);
      change({ strings: n });
      stringBtns[n - 1].focus();
    },
  }, ...stringBtns);
  const detuneRange = el('input', { id: `${uid}-ur`, class: 'slider hm-range', type: 'range', min: '0', max: String(MAX_DETUNE), step: '0.1', value: String(params.detune) });
  const detuneOut = el('output', { class: 'hm-val t-subhead', htmlFor: `${uid}-ur` }, '');
  const beatOut = el('p', { class: 'hm-beat muted t-caption' });
  const stringsField = el('div', { class: 'hm-field' },
    el('span', { id: `${uid}-sl`, class: 'hm-lbl' }, 'Strings per note'),
    stringsGroup);
  const detuneField = el('div', { class: 'hm-field', hidden: true },
    el('label', { htmlFor: `${uid}-ur` }, 'Detune between strings (cents)'),
    el('div', { class: 'hm-pair' }, detuneRange, detuneOut),
    beatOut);
  const realBox = (key, text) => {
    const box = el('input', { id: `${uid}-${key}`, type: 'checkbox', checked: params[key], onchange: () => change({ [key]: box.checked }) });
    return { box, row: el('span', { class: 'hm-check' }, box, el('label', { htmlFor: `${uid}-${key}` }, text)) };
  };
  const realRange = (key, label, min, max, step, value) => {
    const range = el('input', { id: `${uid}-${key}-r`, class: 'slider hm-range', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    const out = el('output', { class: 'hm-val t-subhead', htmlFor: `${uid}-${key}-r` }, '');
    const field = el('div', { class: 'hm-field', hidden: true },
      el('label', { htmlFor: `${uid}-${key}-r` }, label),
      el('div', { class: 'hm-pair' }, range, out));
    return { range, out, field };
  };
  const thumpBox = realBox('thump', 'Hammer thump');
  const thumpCtl = realRange('thump', 'Thump level (dB relative to H1)', MIN_THUMP_DB, MAX_THUMP_DB, 1, params.thumpDb);
  const twoBox = realBox('twoStage', 'Two-stage decay');
  const inharmBox = realBox('inharm', 'Inharmonicity');
  const inharmCtl = realRange('inharm', 'Inharmonicity B', 0, MAX_INHARM, 0.00005, params.inharmB);
  const hammerBox = realBox('hammer', 'Hammer position');
  const strikeCtl = realRange('strike', 'Strike position (fraction of the string)', 0, 8, 1, strikeToSlider(params.strike));
  const feat = (box, note, field) => el('div', { class: 'hm-feat' }, box.row, el('p', { class: 'hm-cap muted t-caption' }, note), ...(field ? [field] : []));
  const realGroup = el('div', { class: 'hm-real', role: 'group', 'aria-labelledby': `${uid}-pl`, hidden: true },
    el('h3', { id: `${uid}-pl`, class: 't-subhead' }, 'Piano realism'),
    el('div', { class: 'hm-feats' },
      feat(thumpBox, THUMP_NOTE, thumpCtl.field),
      feat(twoBox, TWO_NOTE),
      feat(inharmBox, INHARM_NOTE, inharmCtl.field),
      feat(hammerBox, HAMMER_NOTE, strikeCtl.field)));
  const axisBtns = AXES.map((a) => el('button', {
    class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', onclick: () => setAxis(a),
  }, AXIS_LABELS[a]));
  const axisGroup = el('div', {
    class: 'seg hm-seg', role: 'radiogroup', 'aria-labelledby': `${uid}-al`,
    onkeydown: (ev) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      if (!step) return;
      ev.preventDefault();
      const i = clamp(AXES.indexOf(axis) + step, 0, AXES.length - 1);
      setAxis(AXES[i]);
      axisBtns[i].focus();
    },
  }, ...axisBtns);
  const rangeSeg = segmented(LIVE_RANGES.map((m) => [m, fmtTick(m)]), () => liveMax, (m) => setLiveMax(m), { 'aria-label': 'Linear frequency range' });
  const axisField = el('div', { class: 'hm-axis' },
    el('span', { id: `${uid}-al`, class: 'hm-lbl' }, 'Frequency axis'),
    axisGroup, rangeSeg.group);
  const sourceSeg = segmented(SOURCES.map((s) => [s, SOURCE_LABELS[s]]), () => source, (s) => setSource(s), { 'aria-labelledby': `${uid}-ol` });
  const sourceField = el('div', { class: 'hm-axis' },
    el('span', { id: `${uid}-ol`, class: 'hm-lbl' }, 'Source'),
    sourceSeg.group);
  const sourceNote = el('p', { class: 'hm-cap muted t-caption', hidden: true }, SOURCE_NOTE);
  const specCap = el('p', { class: 'hm-cap muted t-caption' });
  const gramCap = el('p', { class: 'hm-cap muted t-caption' });
  const peakOut = el('p', { class: 'hm-peak t-subhead', hidden: true });
  const label = el('span', {}, 'Play');
  const toggleIcon = el('span', { class: 'hm-ic' }, icon('play', 'action'));
  const button = el('button', { class: 'btn primary hm-toggle', type: 'button', onclick: () => { if (running) stop('idle'); else void start(); } }, toggleIcon, label);
  const state = el('p', { class: 'hm-state t-subhead' }, TEXT.idle);
  const skipNote = el('p', { class: 'hm-skip muted t-caption', hidden: true });

  const waveCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const specCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const gramCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const gramAxes = el('canvas', { class: 'hm-canvas hm-axes', 'aria-hidden': 'true' });
  const bandsCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const normBox = el('input', { id: `${uid}-nb`, type: 'checkbox', checked: true, onchange: () => { normalize = normBox.checked; paintBands(); } });
  const normField = el('span', { class: 'hm-check' }, normBox, el('label', { htmlFor: `${uid}-nb` }, 'Normalize per band'));
  const bandsCap = el('p', { class: 'hm-cap muted t-caption' }, BEAT_NOTE);
  const partsBox = el('input', { id: `${uid}-ip`, type: 'checkbox', onchange: () => { showParts = partsBox.checked; paintWave(); } });
  const scaleBar = el('span', { class: 'hm-scale', 'aria-hidden': 'true' });
  const list = el('ul', { class: 'hm-list t-caption', 'aria-label': 'Harmonics' });

  const beatHint = el('p', { class: 'hm-cap muted t-caption', hidden: true }, BEAT_HINT);
  const view = (canvas, cls, ...extra) => el('div', { class: `hm-view ${cls}` }, canvas, ...extra);
  const about = el('details', { class: 'hm-about', open: true },
    el('summary', { class: 't-subhead' }, ABOUT_TITLE),
    el('dl', { class: 'hm-defs' }, ...ABOUT.flatMap(([term, text]) => [el('dt', { class: 't-subhead' }, term), el('dd', { class: 't-subhead muted' }, text)])));

  const stringsNote = el('p', { class: 'hm-cap muted t-caption' }, STRINGS_NOTE);
  const partsField = el('span', { class: 'hm-check' }, partsBox, el('label', { htmlFor: `${uid}-ip` }, 'Show individual harmonics'));
  const ctlBox = el('div', { class: 'hm-ctl' },
      el('div', { class: 'hm-field' },
        el('label', { htmlFor: `${uid}-fn` }, 'Frequency (Hz)'),
        el('div', { class: 'hm-freq' }, freqNum, noteOut),
        freqRange),
      el('div', { class: 'hm-field' },
        el('label', { htmlFor: `${uid}-cr` }, 'Number of harmonics (H1 is the fundamental)'),
        el('div', { class: 'hm-pair' }, countRange, countOut)),
      el('div', { class: 'hm-field' },
        el('label', { htmlFor: `${uid}-dr` }, 'Decay across harmonics (dB per octave; -6 is about 1/n)'),
        el('div', { class: 'hm-pair' }, rollRange, rollOut)),
      el('div', { class: 'hm-field' },
        el('span', { class: 'hm-check' }, decayBox, el('label', { htmlFor: `${uid}-dk` }, 'Piano-like decay'))),
      tauField,
      repeatField,
      stringsField,
      detuneField,
      realGroup);
  const waveCap = el('p', { class: 'hm-cap muted t-caption' });

  const node = el('section', { class: 'card hm-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    sourceField,
    sourceNote,
    ctlBox,
    stringsNote,
    el('div', { class: 'hm-play' }, button, state),
    skipNote,
    el('div', { class: 'hm-block' },
      el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, 'Waveform'), partsField),
      view(waveCanvas, 'hm-wave'),
      waveCap,
      beatHint),
    el('div', { class: 'hm-block' },
      el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, 'Spectrum'), axisField),
      view(specCanvas, 'hm-spec'),
      specCap,
      peakOut,
      list),
    el('div', { class: 'hm-block' },
      el('h3', { class: 't-subhead' }, 'Spectrogram'),
      view(gramCanvas, 'hm-gram', gramAxes),
      el('div', { class: 'hm-legend t-caption muted' }, el('span', {}, `${GRAM_DB_MIN} dB`), scaleBar, el('span', {}, `${GRAM_DB_MAX} dB`)),
      gramCap),
    el('div', { class: 'hm-block' },
      el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, 'Beat bands'), normField),
      view(bandsCanvas, 'hm-bands'),
      bandsCap),
    about);

  function currentColors() {
    const t = now();
    if (!colors || t - colorsAt > 500) { colors = readColors(node); colorsAt = t; scaleBar.style.background = `linear-gradient(to right, ${colors.stops.map((c) => css(c)).join(', ')})`; }
    return colors;
  }

  const rate = () => synth.ctx?.sampleRate ?? 48000;
  const rowsNow = () => harmonicList(params, rate());

  const bandsLabel = (what) => `Beat bands of ${what}, last 10 seconds: four lanes, ${BANDS.map((b) => `${b.name} ${bandRangeText(b)}`).join(', ')}, each with its level and the detected beats marked`;

  function describe() {
    const note = noteInfo(params.freq);
    const piano = params.decay ? `, piano-like decay, fade ${params.tau} s, repeat every ${params.repeat} s` : '';
    const multi = params.strings > 1 ? `, ${params.strings} strings detuned by ${params.detune} cents` : '';
    const real = realism(params);
    const parts = [
      real.thumpGain > 0 ? `hammer thump ${params.thumpDb} dB` : '',
      real.twoStage ? 'two-stage decay' : '',
      real.inharmB > 0 ? `inharmonicity B ${+real.inharmB.toFixed(5)}` : '',
      real.strike > 0 ? `hammer at ${fmtStrike(real.strike)} of the string` : '',
    ].filter(Boolean);
    const extra = parts.length ? `, ${parts.join(', ')}` : '';
    const base = `${params.count} harmonics of ${fmtHz(params.freq)}, ${note.name}, decay ${params.rolloff} dB per octave${piano}${multi}${extra}`;
    const where = axisText();
    if (source !== 'synth') {
      const what = source === 'mic' ? 'the microphone' : 'the player';
      waveCanvas.setAttribute('aria-label', `Waveform of ${what} signal, last ${WAVE_MS} ms`);
      specCanvas.setAttribute('aria-label', `Spectrum of ${what} signal, ${where}`);
      gramCanvas.setAttribute('aria-label', `Spectrogram of ${what} signal, ${where}, last 10 seconds`);
      bandsCanvas.setAttribute('aria-label', bandsLabel(`${what} signal`));
      waveCap.textContent = `Time across (${WAVE_MS} ms), amplitude up, scaled to the signal. It starts at a rising zero crossing so the shape holds still.`;
      specCap.textContent = `Frequency across (${axisCaption()}), level in dBFS up. The dot marks the loudest frequency.`;
      gramCap.textContent = `The last 10 seconds: time across, frequency up (${axisCaption()}), colour is level. It fills while ${what} is heard and clears when the axis or source changes.`;
      return;
    }
    waveCanvas.setAttribute('aria-label', `Waveform of the synthesized tone, 3.5 cycles: ${base}`);
    specCanvas.setAttribute('aria-label', `Spectrum of the synthesized tone, ${where}, one bar per harmonic: ${base}`);
    gramCanvas.setAttribute('aria-label', `Spectrogram of the synthesized tone, ${where}, last 10 seconds: ${base}`);
    bandsCanvas.setAttribute('aria-label', bandsLabel('the synthesized tone'));
    waveCap.textContent = 'Time across, amplitude up, 3.5 cycles of the fundamental. The bright line is the sum.';
    specCap.textContent = `Frequency across (${axisCaption()}), level in dBFS up, one bar per harmonic.`;
    gramCap.textContent = `The last 10 seconds: time across, frequency up (${axisCaption()}), colour is level. It fills while the tone plays and clears when the axis changes.`;
  }

  const rangeNow = () => (source === 'synth' ? axisRange(axis, params.freq, params.count, realism(params).inharmB) : liveAxisRange(axis, liveMax));

  function axisText() {
    const r = rangeNow();
    return r.axis === 'log' ? 'log frequency axis from 20 Hz to 20 kHz' : `linear frequency axis from 0 Hz to ${fmtHz(r.max)}`;
  }

  function axisCaption() {
    const r = rangeNow();
    if (r.axis === 'log') return 'log, 20 Hz to 20 kHz';
    return `linear, 0 Hz to ${fmtHz(r.max)}${r.live ? '' : ', harmonics evenly spaced'}`;
  }

  function paintList() {
    const synthOn = source === 'synth';
    list.hidden = !synthOn;
    if (!synthOn) { skipNote.hidden = true; return; }
    const rows = rowsNow();
    list.replaceChildren(...rows.filter((r) => r.played).map((r) => el('li', {}, `${harmonicLabel(r)} · ${r.db.toFixed(1)} dB`)));
    const skipped = rows.filter((r) => !r.played);
    skipNote.hidden = !skipped.length;
    if (skipped.length) skipNote.textContent = `${skipped.length === 1 ? `H${skipped[0].n} is` : `H${skipped[0].n} to H${skipped.at(-1).n} are`} above ${fmtHz(playableLimit(rate()))} and skipped.`;
  }

  function paintOutputs() {
    const fill = (range, v, lo, hi) => range.style.setProperty('--p', ((v - lo) / (hi - lo)).toFixed(4));
    fill(freqRange, hzToSlider(params.freq), 0, 1000);
    fill(countRange, params.count, 1, MAX_COUNT);
    fill(rollRange, params.rolloff, MIN_ROLLOFF, 0);
    fill(tauRange, params.tau, MIN_TAU, MAX_TAU);
    fill(repeatRange, params.repeat, MIN_REPEAT, MAX_REPEAT);
    noteOut.textContent = noteInfo(params.freq).text;
    countOut.textContent = String(params.count);
    rollOut.textContent = `${params.rolloff} dB/oct`;
    tauOut.textContent = `${params.tau} s`;
    repeatOut.textContent = `${params.repeat} s`;
    tauField.hidden = !params.decay;
    repeatField.hidden = !params.decay;
    realGroup.hidden = !params.decay;
    thumpBox.box.checked = params.thump;
    twoBox.box.checked = params.twoStage;
    inharmBox.box.checked = params.inharm;
    hammerBox.box.checked = params.hammer;
    thumpCtl.field.hidden = !params.thump;
    inharmCtl.field.hidden = !params.inharm;
    strikeCtl.field.hidden = !params.hammer;
    fill(thumpCtl.range, params.thumpDb, MIN_THUMP_DB, MAX_THUMP_DB);
    fill(inharmCtl.range, params.inharmB, 0, MAX_INHARM);
    fill(strikeCtl.range, strikeToSlider(params.strike), 0, 8);
    thumpCtl.out.textContent = fmtThump(params.thumpDb);
    inharmCtl.out.textContent = `B ${+params.inharmB.toFixed(5)}`;
    strikeCtl.out.textContent = fmtStrike(params.strike);
    fill(detuneRange, params.detune, 0, MAX_DETUNE);
    detuneOut.textContent = `${params.detune} cents`;
    const beat = beatRate(params.freq, params.strings, params.detune);
    detuneField.hidden = params.strings < 2;
    beatOut.hidden = !(beat > 0);
    beatOut.textContent = beat > 0 ? `H1 beats about ${fmtBeat(beat)} Hz` : '';
    beatHint.hidden = source !== 'synth' || !(beat > 0);
    stringBtns.forEach((b, i) => {
      const on = i + 1 === params.strings;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    axisBtns.forEach((b, i) => {
      const on = AXES[i] === axis;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    sourceSeg.paint();
    rangeSeg.paint();
    const synthOn = source === 'synth';
    ctlBox.hidden = !synthOn;
    stringsNote.hidden = !synthOn;
    partsField.hidden = !synthOn;
    sourceNote.hidden = synthOn;
    peakOut.hidden = synthOn;
    rangeSeg.group.hidden = synthOn || axis !== 'linear';
    describe();
    paintList();
  }

  function feed() {
    if (!running) return null;
    let an = null;
    let sr = 0;
    if (source === 'synth') { an = synth.analyser; sr = rate(); }
    else if (source === 'mic') { an = micIn.analyser; sr = micIn.sampleRate; }
    else if (playerIn.playing) { an = playerIn.analyser; sr = playerIn.sampleRate; }
    if (!an || !(sr > 0)) return null;
    if (!buffers.time || buffers.time.length !== an.fftSize || buffers.freq.length !== an.frequencyBinCount) {
      buffers.time = new Float32Array(an.fftSize);
      buffers.freq = new Float32Array(an.frequencyBinCount);
    }
    return { an, sr, b: buffers };
  }

  function paintLiveWave(f, g) {
    const points = Math.max(32, Math.round(g.w - 44));
    let scope = null;
    if (f) {
      f.an.getFloatTimeDomainData(f.b.time);
      const s = liveScope(f.b.time, f.sr, points);
      if (s) { waveScale = niceScale(s.peak, waveScale); scope = s.out; }
    }
    drawLiveWaveView(g, currentColors(), scope, waveScale);
  }

  function paintPeak(peak) {
    const t = now();
    if (t - peakAt < PEAK_EVERY_MS && peak !== null) return;
    peakAt = t;
    const text = peakText(peak);
    if (text !== peakShown) { peakShown = text; peakOut.textContent = text; }
  }

  function paintLiveSpectrum(f, g) {
    let peak = null;
    let data = null;
    if (f) {
      f.an.getFloatFrequencyData(f.b.freq);
      data = f.b.freq;
      peak = peakOf(data, f.sr);
    }
    paintPeak(peak);
    drawLiveSpectrumView(g, currentColors(), data, f?.sr ?? 0, rangeNow(), peak);
  }

  function paintWave() {
    const g = fit(waveCanvas);
    if (!g) return;
    const f = feed();
    if (source !== 'synth') { paintLiveWave(f, g); return; }
    const rows = rowsNow();
    const points = Math.max(32, Math.round(g.w - 44));
    const data = computedWave(rows, points, CYCLES, stringOffsets(params.strings, params.detune));
    let sum = data.sum;
    if (f) {
      f.an.getFloatTimeDomainData(f.b.time);
      sum = liveWave(f.b.time, f.sr, params.freq, points) ?? (params.decay && isSilent(f.b.time) ? new Float32Array(points) : sum);
    }
    drawWaveView(g, currentColors(), { sum, parts: data.parts, rows, cycles: CYCLES, freq: params.freq }, showParts);
  }

  function paintSpectrum() {
    const g = fit(specCanvas);
    if (!g) return;
    const f = feed();
    if (source !== 'synth') { paintLiveSpectrum(f, g); return; }
    const rows = rowsNow();
    let levels = rows.map((r) => r.db);
    if (f) {
      f.an.getFloatFrequencyData(f.b.freq);
      levels = barLevels(rows, f.b.freq, f.sr, params.strings > 1 ? params.detune : 0);
    }
    drawSpectrumView(g, currentColors(), rows, levels, rangeNow());
  }

  function paintGramAxes() {
    const g = fit(gramAxes);
    if (!g) return;
    const range = rangeNow();
    drawGramAxes(g, currentColors(), range, gramTicks(rowsNow(), range, g.h));
  }

  const axisKey = () => { const r = rangeNow(); return `${r.axis}|${r.max}`; };

  function clearGram() {
    gramAxisKey = axisKey();
    const g = fit(gramCanvas);
    if (!g) return;
    g.ctx.setTransform(1, 0, 0, 1, 0, 0);
    g.ctx.clearRect(0, 0, gramCanvas.width, gramCanvas.height);
    g.ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  }

  function stepGram(dt) {
    const g = fit(gramCanvas);
    if (!g) return;
    const f = feed();
    if (!f) return;
    const b = f.b;
    if (g.resized) paintGramAxes();
    if (axisKey() !== gramAxisKey) clearGram();
    const { ctx } = g;
    const pw = gramCanvas.width;
    const ph = gramCanvas.height;
    pending += (pw * dt) / GRAM_SECONDS;
    const dx = Math.floor(pending);
    if (dx < 1) return;
    pending -= dx;
    f.an.getFloatFrequencyData(b.freq);
    const rowCount = Math.min(ph, 160);
    const range = rangeNow();
    const key = `${rowCount}|${f.sr}|${b.freq.length}|${range.axis}|${range.max}`;
    if (key !== gramRowsKey) { gramRowsKey = key; gramMap = gramRows(rowCount, f.sr, b.freq.length, range.axis, range.max); }
    const c = currentColors();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (dx < pw) ctx.drawImage(gramCanvas, -dx, 0);
    const strip = Math.min(dx, pw);
    const rowH = ph / rowCount;
    for (let r = 0; r < rowCount; r += 1) {
      const [a, z] = gramMap[r];
      let top = -Infinity;
      for (let k = a; k <= z; k += 1) if (b.freq[k] > top) top = b.freq[k];
      const level = (top + ANALYSER_DB_OFFSET - GRAM_DB_MIN) / (GRAM_DB_MAX - GRAM_DB_MIN);
      ctx.fillStyle = css(levelColor(c.stops, level));
      ctx.fillRect(pw - strip, Math.floor(r * rowH), strip, Math.ceil(rowH) + 1);
    }
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  }

  function paintBands() {
    const g = fit(bandsCanvas);
    if (g) drawBandsView(g, currentColors(), bands.lanes, beatAt, normalize);
  }

  function resetBands() {
    bands.reset();
    beatAt = 0;
  }

  function stepBands(t) {
    const f = feed();
    if (f) {
      f.an.getFloatFrequencyData(f.b.freq);
      const key = `${f.sr}|${f.b.freq.length}`;
      if (key !== beatKey) { beatKey = key; beatMap = bandBins(f.sr, f.b.freq.length); }
      beatAt = t / 1000;
      bands.push(beatAt, bandLevels(f.b.freq, beatMap));
    }
    paintBands();
  }

  function paintStatic() {
    paintWave();
    paintSpectrum();
    paintGramAxes();
    paintBands();
  }

  function tick() {
    if (!running || gone) return;
    frame = raf(tick);
    const t = now();
    const dt = Math.min(0.25, Math.max(0, (t - lastTick) / 1000));
    lastTick = t;
    if (source === 'player' && !watchPlayer()) return;
    paintWave();
    paintSpectrum();
    stepGram(dt);
    stepBands(t);
  }

  function watchPlayer() {
    const t = now();
    const playing = playerIn.playing;
    if (playing && !playerIn.analyser && t - ensureAt >= ENSURE_EVERY_MS) { ensureAt = t; playerIn.ensure(); }
    const live = playing && playerIn.analyser !== null;
    const key = !playing ? 'nothing' : live ? 'player' : playerIn.failed ? 'playerFailed' : 'playerWait';
    if (key !== playerKey) {
      playerKey = key;
      say(key);
      clearGram();
      resetBands();
      if (!live) paintStatic();
    }
    return live;
  }

  function paintButton() {
    const verb = source === 'mic' ? 'Listen' : 'Play';
    label.textContent = running ? 'Stop' : verb;
    button.hidden = source === 'player';
    button.disabled = starting;
    button.classList.toggle('primary', !running);
    button.classList.toggle('outline', running);
    toggleIcon.replaceChildren(icon(running ? 'clear' : source === 'mic' ? 'mic' : 'play', 'action'));
  }

  const CALM = new Set(['idle', 'playing', 'asking', 'listening', 'nothing', 'player', 'playerWait']);

  function say(key) {
    state.textContent = (source === 'synth' ? TEXT : LIVE_TEXT)[key];
    state.classList.toggle('error', !CALM.has(key));
  }

  function listen(target, type, fn) {
    target?.addEventListener?.(type, fn);
    off.push(() => target?.removeEventListener?.(type, fn));
  }

  function release() {
    clearTimeout(safety);
    caf(frame);
    frame = 0;
    while (off.length) off.pop()();
  }

  function endSource() {
    synth.stop();
    micIn.stop();
  }

  function stop(key = 'idle') {
    if (!running) return;
    running = false;
    release();
    endSource();
    if (gone) return;
    paintButton();
    say(key);
    clearGram();
    resetBands();
    paintStatic();
  }

  function engage(key) {
    running = true;
    pending = 0;
    lastTick = now();
    clearGram();
    resetBands();
    safety = setTimeout(() => stop('timeout'), MAX_RUN_MS);
    listen(doc, 'visibilitychange', () => { if (doc.hidden) stop('hidden'); });
    paintButton();
    say(key);
    frame = raf(tick);
  }

  async function startMic() {
    const mine = attempt;
    starting = true;
    say('asking');
    paintButton();
    try {
      if (!(await micIn.start((key) => stop(key)))) return;
    } catch (ex) {
      if (mine !== attempt || gone) return;
      starting = false;
      say(ex?.name === 'NotSupportedError' ? 'unsupported' : errorKey(ex));
      paintButton();
      return;
    }
    if (mine !== attempt || gone) return;
    starting = false;
    engage('listening');
  }

  function startPlayer() {
    paused = false;
    playerKey = '';
    running = true;
    pending = 0;
    lastTick = now();
    clearGram();
    resetBands();
    listen(doc, 'visibilitychange', () => {
      if (doc.hidden) { paused = true; caf(frame); frame = 0; } else if (paused) { paused = false; lastTick = now(); frame = raf(tick); }
    });
    paintButton();
    playerIn.ensure();
    watchPlayer();
    frame = raf(tick);
  }

  async function start() {
    if (running || starting || gone || source === 'player') return;
    if (source === 'mic') { await startMic(); return; }
    try {
      synth.start(params);
    } catch (ex) {
      say(ex?.name === 'NotSupportedError' ? 'unsupported' : 'failed');
      return;
    }
    engage('playing');
  }

  function change(next) {
    params = clampParams({ ...params, ...next });
    synth.update(params);
    paintOutputs();
    if (running) paintGramAxes(); else paintStatic();
  }

  function refreshAxis() {
    gramRowsKey = '';
    paintOutputs();
    clearGram();
    paintGramAxes();
    paintSpectrum();
  }

  function setAxis(next) {
    if (next === axis) return;
    axis = next;
    refreshAxis();
  }

  function setLiveMax(next) {
    if (next === liveMax || !LIVE_RANGES.includes(next)) return;
    liveMax = next;
    refreshAxis();
  }

  function setSource(next) {
    if (next === source || !SOURCES.includes(next) || gone) return;
    attempt += 1;
    starting = false;
    if (running) stop('idle');
    micIn.stop();
    source = next;
    gramRowsKey = '';
    waveScale = 1;
    peakShown = '';
    paintOutputs();
    paintButton();
    clearGram();
    resetBands();
    paintGramAxes();
    paintStatic();
    if (source === 'player') startPlayer(); else say('idle');
  }

  function setFreq(f, { text = true, slider = true } = {}) {
    const v = clamp(f, MIN_HZ, MAX_HZ);
    if (text) freqNum.value = String(v);
    if (slider) freqRange.value = String(hzToSlider(v));
    change({ freq: v });
  }

  freqRange.addEventListener('input', () => setFreq(sliderToHz(Number(freqRange.value)), { slider: false }));
  freqNum.addEventListener('input', () => {
    const v = Number.parseFloat(freqNum.value);
    if (!Number.isFinite(v)) return;
    freqNum.removeAttribute('aria-invalid');
    if (v < MIN_HZ || v > MAX_HZ) { freqNum.setAttribute('aria-invalid', 'true'); return; }
    setFreq(v, { text: false });
  });
  freqNum.addEventListener('change', () => {
    freqNum.removeAttribute('aria-invalid');
    const v = Number.parseFloat(freqNum.value);
    setFreq(Number.isFinite(v) ? v : params.freq);
  });
  countRange.addEventListener('input', () => change({ count: Number(countRange.value) }));
  rollRange.addEventListener('input', () => change({ rolloff: Number(rollRange.value) }));
  tauRange.addEventListener('input', () => change({ tau: Number(tauRange.value) }));
  repeatRange.addEventListener('input', () => change({ repeat: Number(repeatRange.value) }));
  detuneRange.addEventListener('input', () => change({ detune: Number(detuneRange.value) }));
  thumpCtl.range.addEventListener('input', () => change({ thumpDb: Number(thumpCtl.range.value) }));
  inharmCtl.range.addEventListener('input', () => change({ inharmB: Number(inharmCtl.range.value) }));
  strikeCtl.range.addEventListener('input', () => change({ strike: sliderToStrike(Number(strikeCtl.range.value)) }));

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (gone) return;
      paintGramAxes();
      if (!running) paintStatic();
    });
    ro.observe(node);
  }

  paintOutputs();
  paintButton();
  if (typeof requestAnimationFrame === 'function') raf(() => { if (!gone && !running) paintStatic(); });

  return {
    node,
    get running() { return running; },
    get params() { return { ...params }; },
    get axis() { return axis; },
    get source() { return source; },
    get liveMax() { return liveMax; },
    setAxis,
    setSource,
    setLiveMax,
    start,
    stop: () => stop('idle'),
    dispose() {
      gone = true;
      attempt += 1;
      ro?.disconnect();
      if (running) { running = false; release(); }
      endSource();
    },
  };
}
