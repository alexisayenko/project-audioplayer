import { el } from './dom.js';
import { icon } from './icons.js';
import { segmented } from './segmented.js';
import { stepper } from './stepper.js';
import { mixColor } from './viz-color.js';
import { createStackCard, synthHarmonics, DETUNE_NOTE } from './harmonics-stack.js';
import {
  MAX_RUN_MS, AUDIBLE_MAX_HZ, ANALYSER_DB_OFFSET, SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ, DB_MIN,
  LIVE_VIEW_NAMES, clamp, noteInfo, fmtHz, axisText, axisCaption, linearTicks, pickLabels, gramTicks, fit, css, drawSpecGrid,
  specHover, drawSpecHover, trackHover, createTrails, createTrailControl, trailLengthText, TRAIL_FILL_ALPHA, TRAIL_LINE_ALPHA,
  createFeeder, createColors, createAxisControl, createGramView, createBandsView, view,
} from './listen-views.js';

export {
  MAX_RUN_MS, AUDIBLE_MAX_HZ, ANALYSER_DB_OFFSET, SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ, DB_MIN, DB_MAX,
  GRAM_SECONDS, GRAM_DB_MIN, GRAM_DB_MAX, LIVE_RANGES, DEFAULT_LIVE_MAX, WAVE_MS, WAVE_SCALES,
  PEAK_MIN_HZ, PEAK_FLOOR_DB, PEAK_EVERY_MS, noteInfo, fmtHz, logPos, AXES, AXIS_LABELS, freqPos,
  fmtTick, linearTicks, pickLabels, gramRows, liveAxisRange, niceScale, liveScope, peakOf, peakText,
  curveLevels, levelColor, BANDS, BEAT_SECONDS, ONSET_AVG_S, ONSET_MEAN_S, ONSET_MULT, ONSET_MIN_DB,
  ONSET_GAP_S, ONSET_FLOOR_DB, LANE_MIN_SPAN_DB, BEAT_NOTE, bandRangeText, bandBins, bandLevels,
  laneRange, createBeatTracker, specTicks, gramTicks,
} from './listen-views.js';

export const TITLE = 'Pitch and harmonics';
export const MIN_HZ = 20;
export const MAX_HZ = 4000;
export const MAX_COUNT = 32;
export const MIN_ROLLOFF = -24;
const COUNT_LABEL = 'Number of harmonics (H1 is the fundamental)';
const ROLL_LABEL = 'Decay across harmonics (dB per octave; -6 is about 1/n)';
export const MAX_STRINGS = 8;
export const MAX_OSCILLATORS = 256;
export const MAX_DETUNE = 5;
export const DEFAULTS = {
  freq: 220, count: 10, rolloff: -12, mute: false, decay: false, tau: 1.2, repeat: 3, strings: 1, detune: 2,
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
export const FFT_SIZE = 16384;
export const CYCLES_CHOICES = [1, 2, 4];
export const CYCLES = 1;
export const CYCLE_NAMES = { 1: 'one cycle', 2: 'two cycles', 4: 'four cycles' };
export const WAVE_TICKS = 4;
export const TEXT = {
  idle: 'Stopped',
  playing: 'Playing',
  hidden: 'Stopped: the page was hidden',
  timeout: 'Stopped: 10 minutes reached',
  unsupported: 'This browser cannot play audio',
  failed: 'Could not start the sound',
};
export const THUMP_NOTE ='Hammer thump: the felt hammer hitting the strings makes a short burst of noise.';
export const TWO_NOTE = 'Two-stage decay: a quick fade first, then a long quiet tail called the aftersound.';
export const INHARM_NOTE = 'Inharmonicity: partials are slightly sharp, because a stiff string resists bending.';
export const NEEDS_TWO = 'Needs 2 or more harmonics.';
export const HAMMER_NOTE ='Hammer position: partials with a node at the strike point are very quiet.';
export const STRIKE_MORE_TITLE = 'Why the strike position matters';

function ordinal(n) {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

export function strikeMore(p) {
  const d = Math.round(1 / p);
  const alt = d === 10 ? 8 : 10;
  return `The hammer hits the string at 1/${d} of its length, so the ${ordinal(d)} harmonic has a node right there and almost disappears (H${2 * d} too). Piano makers put the hammer at about 1/7 to 1/9 of the string, so a weak 7th, 8th or 9th harmonic is typical, because those harmonics clash with the musical scale. The exact fraction varies by maker and register (smaller toward the treble). Try 1/${alt}: the weak harmonic becomes H${alt}.`;
}

export const STACK_NOTE = 'The rows follow the settings above: number of harmonics, decay per octave, Mute H1, and with piano-like decay the inharmonicity and the hammer position.';
export const STRINGS_NOTE ='A real piano note has up to 3 strings; here you can try up to 8.';
export const BEAT_HINT = 'With detuned strings the loudness swells slowly: beats';
export const STRINGS_HINT = 'Strings are only slightly apart, so you need the Beating view below to see the difference.';
export const VIEW_NAMES = {
  ...LIVE_VIEW_NAMES,
  wave: 'Waveform of the synth tone you will hear: time across, amplitude up.',
  beating: 'Amplitude envelope view: the slow swell when two strings are slightly out of tune.',
};
export const BEATING_MIN_S = 2;
export const BEATING_MAX_S = 30;
export const ENVELOPE_PER_CYCLE = 16;
export const ENVELOPE_MIN_SAMPLES = 16;
export const ENVELOPE_MAX_SAMPLES = 96;
export const BEATING_ONE = 'One string: no beating. Set Strings to 2 or more.';
export const BEATING_ZERO = 'Detune is 0 cents: no beating. Raise the detune.';
export const GLOSSARY_LINK = 'More terms in the Glossary →';
export const GLOSSARY_HREF = '#/glossary';
export const ABOUT_TITLE ='What are harmonics?';
export const ABOUT = [
  ['Fundamental (H1)', 'is the lowest frequency, f. It sets the pitch you hear.'],
  ['Harmonics', 'are whole-number multiples of the fundamental: Hn = n x f. H2 is 2f, H3 is 3f, and so on.'],
  ['Overtones', 'are everything above the fundamental, so the first overtone is H2.'],
  ['Partials', 'are all the component frequencies of a sound, including those of real instruments that are not exact whole multiples.'],
  ['Timbre', 'is the mix of harmonic levels. It is why a piano and a flute playing the same note sound different.'],
];

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const flag = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

export function clampParams(p = {}) {
  return {
    freq: clamp(num(p.freq, DEFAULTS.freq), MIN_HZ, MAX_HZ),
    count: clamp(Math.round(num(p.count, DEFAULTS.count)), 1, MAX_COUNT),
    rolloff: clamp(num(p.rolloff, DEFAULTS.rolloff), MIN_ROLLOFF, 0),
    mute: p.mute === true,
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

export function isMuted(params) {
  const p = clampParams(params);
  return p.mute && p.count >= 2;
}

export function leadN(params) {
  return isMuted(params) ? 2 : 1;
}

export function muteText(hz) {
  return `The pitch you hear is still H1 (${fmtHz(hz)}): your brain infers the missing fundamental from the spacing of the overtones. Try it with 6+ harmonics.`;
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
  return Array.from({ length: strings }, (_, k) => (2 * detune * k) / (strings - 1) - detune);
}

export function synthCount(strings, count) {
  return Math.max(1, Math.min(count, Math.floor(MAX_OSCILLATORS / Math.max(1, strings))));
}

export function capText(strings, count) {
  const used = synthCount(strings, count);
  return used < count ? `Using ${used} harmonics per string (limit ${MAX_OSCILLATORS} oscillators).` : '';
}

export function centsRatio(cents) {
  return 2 ** (cents / 1200);
}

export function beatRate(freq, strings, detune) {
  if (strings < 2 || !(detune > 0)) return 0;
  return freq * (centsRatio((2 * detune) / (strings - 1)) - 1);
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

export function amplitude(n, rolloff) {
  return 10 ** ((rolloff * Math.log2(n)) / 20);
}

export function playableLimit(sampleRate = 48000) {
  return Math.min(AUDIBLE_MAX_HZ, sampleRate / 2);
}

export function harmonicList(params, sampleRate = 48000) {
  const p = clampParams(params);
  const { freq, rolloff, strings, detune } = p;
  const count = synthCount(strings, p.count);
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
    rows.push({ n, freq: f, amp, played, muted: false, gain: 0, full: 0, db: -Infinity });
  }
  for (const r of rows) {
    if (!r.played) continue;
    r.full = (TOTAL_GAIN * r.amp) / sum;
    r.gain = r.full;
    r.db = 20 * Math.log10(r.gain);
  }
  if (p.mute && count >= 2 && rows[0].played) {
    rows[0].muted = true;
    rows[0].gain = 0;
    rows[0].db = -Infinity;
  }
  return rows;
}

export function harmonicLabel(row) {
  if (row.muted) return `Fundamental (H1, muted) · ${fmtHz(row.freq)}`;
  return `${row.n === 1 ? 'Fundamental (H1)' : `H${row.n}`} · ${fmtHz(row.freq)}`;
}

export function levelMatched(sum, samples, rows) {
  const tail = Math.min(samples.length, 1024);
  let live = 0;
  for (let i = samples.length - tail; i < samples.length; i += 1) live += samples[i] * samples[i];
  let want = 0;
  for (const r of rows) if (r.played) want += (r.gain * r.gain) / 2;
  const k = want > 0 && tail > 0 ? Math.min(1.5, Math.sqrt(live / tail) / Math.sqrt(want)) : 0;
  return k > 0.95 ? sum : sum.map((v) => v * k);
}

export function sliderToHz(pos) {
  const f = MIN_HZ * (MAX_HZ / MIN_HZ) ** (clamp(pos, 0, 1000) / 1000);
  return f < 100 ? Math.round(f * 10) / 10 : Math.round(f);
}

export function hzToSlider(f) {
  return Math.round((1000 * Math.log(clamp(f, MIN_HZ, MAX_HZ) / MIN_HZ)) / Math.log(MAX_HZ / MIN_HZ));
}

export function computedWave(rows, points, cycles = CYCLES, offsets = [0], withStrings = false) {
  const f = rows[0]?.freq ?? DEFAULTS.freq;
  const sum = new Float32Array(points);
  const parts = rows.map(() => new Float32Array(points));
  const strings = withStrings ? offsets.map(() => new Float32Array(points)) : [];
  const span = cycles / f;
  const ratios = offsets.map(centsRatio);
  for (let i = 0; i < points; i += 1) {
    const t = (i / (points - 1)) * span;
    let s = 0;
    for (let k = 0; k < rows.length; k += 1) {
      const r = rows[k];
      if (!r.played) continue;
      let v = 0;
      for (let q = 0; q < ratios.length; q += 1) {
        const x = Math.sin(2 * Math.PI * r.freq * ratios[q] * t);
        v += x;
        if (withStrings) strings[q][i] += x * r.gain;
      }
      v *= r.gain / ratios.length;
      parts[k][i] = v;
      s += v;
    }
    sum[i] = s;
  }
  return { sum, parts, strings };
}

export function swellPeriod(freq, strings, detune) {
  const beat = beatRate(freq, strings, detune);
  return beat > 0 ? 1 / beat : 0;
}

export function beatingWindow(period) {
  if (!(period > 0)) return BEATING_MIN_S;
  return clamp(Math.ceil(period * 2) / 2, BEATING_MIN_S, BEATING_MAX_S);
}

export function fmtSwell(s) {
  return s < 10 ? s.toFixed(2) : s.toFixed(1);
}

export function beatText(beat, n = 1) {
  return `H${n} beats about ${fmtBeat(beat)} Hz`;
}

export function swellText(beat, n = 1) {
  return `${beatText(beat, n)}: one swell every ${fmtSwell(1 / beat)} s`;
}

export function beatingH1(rows, offsets, windowS, cols, idx = 0) {
  const out = new Float32Array(cols);
  const r = rows[idx];
  if (!r?.played) return out;
  const rel = offsets.map((o) => 2 * Math.PI * r.freq * (centsRatio(o) - 1));
  for (let i = 0; i < cols; i += 1) {
    const t = (i / (cols - 1)) * windowS;
    let re = 0;
    let im = 0;
    for (const w of rel) { re += Math.cos(w * t); im += Math.sin(w * t); }
    out[i] = (r.gain * Math.hypot(re, im)) / rel.length;
  }
  return out;
}

export function beatingEnvelope(rows, offsets, windowS, cols) {
  const lo = new Float32Array(cols);
  const hi = new Float32Array(cols);
  const played = rows.filter((r) => r.played);
  if (!played.length) return { lo, hi };
  const ratios = offsets.map(centsRatio);
  const w = played.map((r) => 2 * Math.PI * r.freq);
  const f = played[0].freq;
  const half = Math.max(windowS / cols, 1 / f) / 2;
  const n = clamp(Math.ceil(2 * half * f * ENVELOPE_PER_CYCLE), ENVELOPE_MIN_SAMPLES, ENVELOPE_MAX_SAMPLES);
  for (let c = 0; c < cols; c += 1) {
    const tc = (c / (cols - 1)) * windowS;
    let top = -Infinity;
    let bottom = Infinity;
    for (let j = 0; j < n; j += 1) {
      const t = tc - half + (j / (n - 1)) * 2 * half;
      let s = 0;
      for (let k = 0; k < played.length; k += 1) {
        let v = 0;
        for (let q = 0; q < ratios.length; q += 1) v += Math.sin(w[k] * ratios[q] * t);
        s += v * played[k].gain;
      }
      s /= ratios.length;
      if (s > top) top = s;
      if (s < bottom) bottom = s;
    }
    hi[c] = top;
    lo[c] = bottom;
  }
  return { lo, hi };
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

export function waveTicks(cycles, freq) {
  return Array.from({ length: WAVE_TICKS + 1 }, (_, k) => ({
    frac: k / WAVE_TICKS,
    ms: (((cycles * k) / WAVE_TICKS) / freq) * 1000,
  }));
}

export function barLevels(rows, freqData, sampleRate, spreadCents = 0) {
  const bins = freqData.length;
  const bw = sampleRate / (2 * bins);
  const spread = centsRatio(spreadCents);
  return rows.map((r) => {
    if (!r.played || r.muted) return -Infinity;
    const lo = Math.round(r.freq / spread / bw);
    const hi = Math.round((r.freq * spread) / bw);
    let top = -Infinity;
    for (let b = Math.max(0, lo - 2); b <= Math.min(bins - 1, hi + 2); b += 1) if (freqData[b] > top) top = freqData[b];
    return top + ANALYSER_DB_OFFSET;
  });
}

export const AXIS_MIN_MULT = 4;
const AXIS_NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

export function niceCeil(v) {
  const e = 10 ** Math.floor(Math.log10(v));
  const m = AXIS_NICE.find((k) => k * e >= v * (1 - 1e-9));
  return (m ?? 10) * e;
}

export function linearMax(freq, count, B = 0) {
  return Math.min(AUDIBLE_MAX_HZ, niceCeil(Math.max(AXIS_MIN_MULT * freq, partialFreq(count, freq, B) + freq)));
}

export function axisRange(axis, freq, count, B = 0) {
  return axis === 'log' ? { axis, min: SPECTRUM_MIN_HZ, max: SPECTRUM_MAX_HZ } : { axis, min: 0, max: linearMax(freq, count, B) };
}

export function createSynth(env = {}) {
  const Ctx = env.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  let live = null;

  const voicesOf = (strings) => strings.flatMap((s) => s.voices);

  function buildVoice(trim, t) {
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
    return { osc, gain, gain2, fresh: true, env: { t0: 0, gain: 0, tau: Infinity }, env2: { t0: 0, gain: 0, tau: Infinity } };
  }

  function buildString(t, harmonics) {
    const trim = live.ctx.createGain();
    trim.gain.value = 0;
    trim.connect(live.master);
    const voices = [];
    for (let n = 1; n <= harmonics; n += 1) voices.push(buildVoice(trim, t));
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

  function fitVoices(s, harmonics, t) {
    while (s.voices.length < harmonics) s.voices.push(buildVoice(s.trim, t));
    if (s.voices.length <= harmonics) return;
    const dropped = s.voices.splice(harmonics);
    for (const v of dropped) {
      for (const g of [v.gain.gain, v.gain2.gain]) {
        hold(g, t);
        g.linearRampToValueAtTime(0, t + FADE_S);
      }
    }
    setTimeout(() => dropped.forEach(release), FADE_S * 1000 + 40);
  }

  function syncStrings(n, harmonics) {
    const t = live.ctx.currentTime;
    while (live.strings.length < n) live.strings.push(buildString(t, harmonics));
    while (live.strings.length > n) retire(live.strings.pop(), t);
    for (const s of live.strings) fitVoices(s, harmonics, t);
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
        if (direct || v.fresh) {
          v.osc.frequency.value = hz;
          v.osc.detune.value = offsets[k];
        } else {
          v.osc.frequency.setTargetAtTime(hz, t, SMOOTH_S);
          v.osc.detune.setTargetAtTime(offsets[k], t, SMOOTH_S);
        }
        v.fresh = false;
        if (direct) {
          v.gain.gain.value = live.decay ? 0 : gain;
          v.gain2.gain.value = 0;
        } else if (!live.decay) {
          v.gain.gain.setTargetAtTime(gain, t, i === 0 ? FADE_S : SMOOTH_S);
          v.gain2.gain.setTargetAtTime(0, t, SMOOTH_S);
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
    for (const s of strings) {
      s.voices.forEach((v, i) => {
        const gain = rows[i]?.played ? rows[i].gain : 0;
        const tau = tauOf(i + 1, p.tau);
        v.osc.frequency.setValueAtTime(Math.min(partialFreq(i + 1, p.freq, real.inharmB), limit), at);
        v.env = shape(v.gain.gain, v.env, at, from, gain * weights.fast, tau);
        v.env2 = shape(v.gain2.gain, v.env2, at, from, gain * weights.slow, tau * SLOW_MULT);
      });
    }
    if (strings === live.strings) {
      live.struckB = real.inharmB;
      if (real.thumpGain > 0 && rows[0]?.played) thump(at, rows[0].full * real.thumpGain * THUMP_NORM);
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

  function settleH1(muted) {
    const t = live.ctx.currentTime;
    if (!muted) {
      clearTimeout(live.timer);
      live.next = t + RELEASE_S + 0.005;
      pump();
      return;
    }
    for (const s of live.strings) {
      const v = s.voices[0];
      if (!v) continue;
      for (const g of [v.gain.gain, v.gain2.gain]) {
        hold(g, t);
        g.setTargetAtTime(0, t, FADE_S);
      }
      v.env = { t0: 0, gain: 0, tau: Infinity };
      v.env2 = { t0: 0, gain: 0, tau: Infinity };
    }
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
      syncStrings(clamped.strings, synthCount(clamped.strings, clamped.count));
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
      syncStrings(next.strings, synthCount(next.strings, next.count));
      const added = live.strings.filter((s) => !known.has(s));
      if (next.decay && !wasDecay) enterDecay(params);
      else if (!next.decay && wasDecay) leaveDecay();
      const flipped = isMuted(live.params) !== isMuted(next);
      live.params = next;
      apply(params, false);
      if (wasDecay && next.decay) {
        if (flipped) settleH1(isMuted(next));
        if (added.length && !(flipped && !isMuted(next))) strikeNew(added, next);
      }
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
  for (const t of waveTicks(data.cycles, data.freq)) {
    const x = left + t.frac * plotW;
    ctx.beginPath(); ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp); ctx.stroke();
    ctx.textAlign = t.frac === 0 ? 'left' : t.frac >= 1 ? 'right' : 'center';
    ctx.fillText(`${+t.ms.toFixed(2)} ms`, x, h - bottom + 3);
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
  if (showParts && data.parts) data.parts.forEach((p, i) => { if (data.rows[i].played && !data.rows[i].muted) trace(p, css(colors.muted, 0.35), 1); });
  const own = data.strings ?? [];
  own.forEach((s, k) => trace(s, css(stringColor(colors, k, own.length), stringAlpha(own.length)), 4));
  trace(data.sum, css(colors.fill), 2);
}

function stringColor(colors, k, n) {
  return mixColor(colors.stops[1], colors.stops[3], n > 1 ? k / (n - 1) : 0);
}

function stringAlpha(n) {
  return clamp(1.6 / n, 0.22, 0.6);
}

function drawBeatingView(g, colors, data) {
  const { ctx, w, h } = g;
  const left = 36;
  const bottom = 18;
  const pad = 8;
  const plotW = Math.max(1, w - left - pad);
  const mid = (h - bottom) / 2;
  const amp = mid - pad;
  const xOf = (i, n) => left + (i / (n - 1)) * plotW;
  const yOf = (v) => mid - clamp(v / TOTAL_GAIN, -1.2, 1.2) * amp;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillStyle = css(colors.muted);
  ctx.strokeStyle = css(colors.line);
  ctx.lineWidth = 1;
  for (const [v, text] of [[TOTAL_GAIN, `+${TOTAL_GAIN}`], [0, '0'], [-TOTAL_GAIN, `-${TOTAL_GAIN}`]]) {
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - pad, y); ctx.stroke();
    ctx.fillText(text, left - 4, y);
  }
  ctx.textBaseline = 'top';
  for (const t of linearTicks(data.windowS, Math.floor(plotW / 70))) {
    const x = left + (t / data.windowS) * plotW;
    ctx.beginPath(); ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp); ctx.stroke();
    ctx.textAlign = t === 0 ? 'left' : t >= data.windowS ? 'right' : 'center';
    ctx.fillText(`${+t.toFixed(2)} s`, x, h - bottom + 3);
  }
  const n = data.hi.length;
  if (data.period > 0) {
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = css(colors.muted, 0.7);
    for (let k = 1; k * data.period < data.windowS * (1 - 1e-9); k += 1) {
      const x = left + ((k * data.period) / data.windowS) * plotW;
      ctx.beginPath(); ctx.moveTo(x, mid - amp); ctx.lineTo(x, mid + amp); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) { const x = xOf(i, n); if (i === 0) ctx.moveTo(x, yOf(data.hi[i])); else ctx.lineTo(x, yOf(data.hi[i])); }
  for (let i = n - 1; i >= 0; i -= 1) ctx.lineTo(xOf(i, n), yOf(data.lo[i]));
  ctx.closePath();
  ctx.fillStyle = css(colors.fill, 0.22);
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1;
  for (let k = 0; k < data.strings; k += 1) {
    ctx.strokeStyle = css(stringColor(colors, k, data.strings), stringAlpha(data.strings));
    for (const sign of [1, -1]) {
      ctx.beginPath(); ctx.moveTo(left, yOf(sign * data.own)); ctx.lineTo(left + plotW, yOf(sign * data.own)); ctx.stroke();
    }
  }
  if (data.strings > 1) {
    ctx.strokeStyle = css(colors.ink, 0.45);
    for (const sign of [1, -1]) {
      ctx.beginPath();
      for (let i = 0; i < n; i += 1) { const x = xOf(i, n); if (i === 0) ctx.moveTo(x, yOf(sign * data.h1[i])); else ctx.lineTo(x, yOf(sign * data.h1[i])); }
      ctx.stroke();
    }
  }
  ctx.strokeStyle = css(colors.fill);
  ctx.lineWidth = 2;
  for (const series of [data.hi, data.lo]) {
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) { const x = xOf(i, n); if (i === 0) ctx.moveTo(x, yOf(series[i])); else ctx.lineTo(x, yOf(series[i])); }
    ctx.stroke();
  }
  if (data.message) {
    ctx.font = `600 12px ${colors.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = data.message.split(/(?<=\.) /);
    const tw = Math.min(plotW - 8, Math.max(...lines.map((s) => ctx.measureText(s).width)));
    const bx = left + plotW / 2;
    const boxH = 8 + lines.length * 16;
    ctx.fillStyle = css(colors.sunken, 0.85);
    ctx.fillRect(bx - tw / 2 - 6, mid - boxH / 2, tw + 12, boxH);
    ctx.fillStyle = css(colors.ink);
    lines.forEach((s, i) => ctx.fillText(s, bx, mid - boxH / 2 + 4 + 8 + i * 16, plotW - 8));
  }
}

function drawSpectrumView(g, colors, rows, levels, range, hoverX = null, ghost = null) {
  const { ctx, w } = g;
  const geo = drawSpecGrid(g, colors, range);
  const { yOf, xOf } = geo;
  const bars = [];
  rows.forEach((r, i) => {
    if (r.played && levels[i] > DB_MIN) bars.push({ r, db: levels[i], x: xOf(r.freq) });
  });
  let gap = Infinity;
  for (let i = 1; i < bars.length; i += 1) gap = Math.min(gap, bars[i].x - bars[i - 1].x);
  const bw = clamp(Number.isFinite(gap) ? gap * 0.6 : 6, 1.5, 6);
  const base = yOf(DB_MIN);
  if (ghost) {
    ctx.fillStyle = css(colors.fill, TRAIL_FILL_ALPHA + 0.1);
    for (let i = 0; i < rows.length; i += 1) {
      if (!rows[i].played || !(ghost[i] > DB_MIN)) continue;
      const y = yOf(ghost[i]);
      ctx.fillRect(xOf(rows[i].freq) - bw / 2, y, bw, Math.max(1, base - y));
    }
    ctx.fillStyle = css(colors.fill, TRAIL_LINE_ALPHA);
    for (let i = 0; i < rows.length; i += 1) {
      if (!rows[i].played || !(ghost[i] > DB_MIN)) continue;
      ctx.fillRect(xOf(rows[i].freq) - bw / 2, yOf(ghost[i]), bw, 1.5);
    }
  }
  ctx.fillStyle = css(colors.fill);
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
  for (const r of rows) if (r.played && r.muted) drawMutedMark(g, colors, r, xOf(r.freq), base);
  if (hoverX !== null) {
    const hits = bars.map((b) => ({ x: b.x, freq: b.r.freq, name: `H${b.r.n}`, db: b.db }));
    drawSpecHover(g, colors, geo, specHover(hoverX, geo, range, { bars: hits }));
  }
}

function drawMutedMark(g, colors, row, x0, base) {
  const { ctx, w } = g;
  const name = `H${row.n} (muted)`;
  const hz = fmtHz(row.freq);
  const half = Math.max(ctx.measureText(name).width, ctx.measureText(hz).width) / 2;
  const x = clamp(x0, 36 + half, w - 2 - half);
  ctx.save();
  ctx.fillStyle = css(colors.muted);
  ctx.strokeStyle = css(colors.muted);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(x0, base); ctx.lineTo(x0, base - 14); ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(hz, x, base - 18);
  ctx.fillText(name, x, base - 29);
  const tw = ctx.measureText(name).width;
  ctx.beginPath(); ctx.moveTo(x - tw / 2, base - 32); ctx.lineTo(x + tw / 2, base - 32); ctx.stroke();
  ctx.restore();
}

export function createHarmonicsCard(env = {}) {
  const doc = env.document ?? globalThis.document;
  const raf = env.raf ?? ((fn) => globalThis.requestAnimationFrame?.(fn) ?? 0);
  const caf = env.caf ?? ((id) => globalThis.cancelAnimationFrame?.(id));
  const now = env.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const synth = env.synth ?? createSynth(env);
  let params = { ...DEFAULTS };
  let showParts = false;
  let showStrings = false;
  let beatingKey = '';
  let beatingData = null;
  let running = false;
  let frame = 0;
  let safety = 0;
  let gone = false;
  let lastTick = 0;
  let axis = 'linear';
  let cycles = CYCLES;
  const off = [];

  const uid = `hm-${Math.random().toString(36).slice(2, 7)}`;
  const freqNum = el('input', { id: `${uid}-fn`, class: 'hm-num', type: 'number', min: MIN_HZ, max: MAX_HZ, step: 'any', inputmode: 'decimal', value: String(params.freq) });
  const freqRange = el('input', { id: `${uid}-fr`, class: 'slider hm-range', type: 'range', min: '0', max: '1000', step: '1', value: String(hzToSlider(params.freq)), 'aria-label': 'Frequency slider' });
  const noteOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-fn ${uid}-fr` }, noteInfo(params.freq).text);
  const countStep = stepper({
    id: `${uid}-cr`, label: COUNT_LABEL, min: 1, max: MAX_COUNT, get: () => params.count, set: (v) => change({ count: v }),
    inputmode: 'numeric', decLabel: 'Fewer harmonics', incLabel: 'More harmonics',
  });
  const rollStep = stepper({
    id: `${uid}-dr`, label: ROLL_LABEL, min: MIN_ROLLOFF, max: 0, get: () => params.rolloff, set: (v) => change({ rolloff: v }),
    unit: 'dB/oct', decLabel: 'Steeper decay', incLabel: 'Gentler decay',
  });
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
  const stringsRange = el('input', { id: `${uid}-sr`, class: 'slider hm-range', type: 'range', min: '1', max: String(MAX_STRINGS), step: '1', value: String(params.strings) });
  const stringsOut = el('output', { class: 'hm-val t-subhead', htmlFor: `${uid}-sr` }, String(params.strings));
  const capOut = el('p', { class: 'hm-cap muted t-caption', hidden: true });
  const detuneRange = el('input', { id: `${uid}-ur`, class: 'slider hm-range', type: 'range', min: '0', max: String(MAX_DETUNE), step: '0.1', value: String(params.detune) });
  const detuneOut = el('output', { class: 'hm-val t-subhead', htmlFor: `${uid}-ur` }, '');
  const beatOut = el('p', { class: 'hm-beat muted t-caption' });
  const stringsField = el('div', { class: 'hm-field' },
    el('label', { htmlFor: `${uid}-sr` }, 'Strings per note'),
    el('div', { class: 'hm-pair' }, stringsRange, stringsOut),
    capOut);
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
  const needsHint = (id) => el('p', { id, class: 'hm-cap muted t-caption', hidden: true }, NEEDS_TWO);
  const strikeHint = needsHint(`${uid}-sh`);
  const strikeMoreText = el('p', { class: 'hm-cap muted t-caption' }, '');
  const strikeMoreBox = el('details', { class: 'hm-more' },
    el('summary', { class: 'hm-cap muted t-caption' }, STRIKE_MORE_TITLE),
    strikeMoreText);
  strikeCtl.field.append(strikeHint, strikeMoreBox);
  const rollHint = needsHint(`${uid}-dh`);
  const rollField = el('div', { class: 'hm-field' },
    el('label', { htmlFor: `${uid}-dr` }, ROLL_LABEL),
    rollStep.group,
    rollHint);
  const muteBox = el('input', { id: `${uid}-mu`, type: 'checkbox', checked: params.mute, onchange: () => change({ mute: muteBox.checked }) });
  const muteHint = needsHint(`${uid}-mh`);
  const muteNote = el('p', { class: 'hm-cap muted t-caption', hidden: true });
  const muteField = el('div', { class: 'hm-field' },
    el('span', { class: 'hm-check' }, muteBox, el('label', { htmlFor: `${uid}-mu` }, 'Mute H1 (missing fundamental)')),
    muteHint,
    muteNote);
  const setNeeds = (range, field, hint, off) => {
    range.disabled = off;
    field.classList.toggle('is-off', off);
    hint.hidden = !off;
    if (off) range.setAttribute('aria-describedby', hint.id);
    else range.removeAttribute('aria-describedby');
  };
  const feat = (box, note, field) => el('div', { class: 'hm-feat' }, box.row, el('p', { class: 'hm-cap muted t-caption' }, note), ...(field ? [field] : []));
  const realGroup = el('div', { class: 'hm-real', role: 'group', 'aria-labelledby': `${uid}-pl`, hidden: true },
    el('h3', { id: `${uid}-pl`, class: 't-subhead' }, 'Piano realism'),
    el('div', { class: 'hm-feats' },
      feat(thumpBox, THUMP_NOTE, thumpCtl.field),
      feat(twoBox, TWO_NOTE),
      feat(inharmBox, INHARM_NOTE, inharmCtl.field),
      feat(hammerBox, HAMMER_NOTE, strikeCtl.field)));
  const axisControl = createAxisControl({ uid, getAxis: () => axis, setAxis });
  const trails = createTrails();
  const trailControl = createTrailControl({ uid, trails, onChange: () => { describe(); paintSpectrum(); } });
  const cyclesSeg = segmented(CYCLES_CHOICES.map((c) => [c, String(c)]), () => cycles, (c) => setCycles(c), { 'aria-labelledby': `${uid}-cl` });
  const cyclesField = el('div', { class: 'hm-axis' },
    el('span', { id: `${uid}-cl`, class: 'hm-lbl' }, 'Cycles shown'),
    cyclesSeg.group);
  const specCap = el('p', { class: 'hm-cap muted t-caption' });
  const label = el('span', {}, 'Play');
  const toggleIcon = el('span', { class: 'hm-ic' }, icon('play', 'action'));
  const button = el('button', { class: 'btn primary hm-toggle', type: 'button', onclick: () => { if (running) stop('idle'); else void start(); } }, toggleIcon, label);
  const state = el('p', { class: 'hm-state t-subhead' }, TEXT.idle);
  const skipNote = el('p', { class: 'hm-skip muted t-caption', hidden: true });

  const waveCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const specCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const specPointer = trackHover(specCanvas, paintSpectrum);
  const beatCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const beatCap = el('p', { class: 'hm-cap muted t-caption' });
  const beatingOut = el('p', { class: 'hm-beat t-subhead', hidden: true });
  const partsBox = el('input', { id: `${uid}-ip`, type: 'checkbox', onchange: () => { showParts = partsBox.checked; paintWave(); } });
  const eachBox = el('input', { id: `${uid}-es`, type: 'checkbox', onchange: () => { showStrings = eachBox.checked; paintOutputs(); paintWave(); } });
  const eachField = el('span', { class: 'hm-check', hidden: true }, eachBox, el('label', { htmlFor: `${uid}-es` }, 'Show each string'));
  const stringsHint = el('p', { class: 'hm-cap muted t-caption', hidden: true }, STRINGS_HINT);
  const list = el('ul', { class: 'hm-list t-caption', 'aria-label': 'Harmonics' });

  const beatHint = el('p', { class: 'hm-cap muted t-caption', hidden: true }, BEAT_HINT);
  const beatView = view(beatCanvas, 'hm-beating');
  const about = el('details', { class: 'hm-about', open: true },
    el('summary', { class: 't-subhead' }, ABOUT_TITLE),
    el('dl', { class: 'hm-defs' }, ...ABOUT.flatMap(([term, text]) => [el('dt', { class: 't-subhead' }, term), el('dd', { class: 't-subhead muted' }, text)])),
    el('a', { class: 'gl-link t-subhead', href: GLOSSARY_HREF }, GLOSSARY_LINK));

  const stringsNote = el('p', { class: 'hm-cap muted t-caption' }, STRINGS_NOTE);
  const partsField = el('span', { class: 'hm-check' }, partsBox, el('label', { htmlFor: `${uid}-ip` }, 'Show individual harmonics'));
  const ctlBox = el('div', { class: 'hm-ctl' },
      el('div', { class: 'hm-field' },
        el('label', { htmlFor: `${uid}-fn` }, 'Frequency (Hz)'),
        el('div', { class: 'hm-freq' }, freqNum, noteOut),
        freqRange),
      el('div', { class: 'hm-field' },
        el('label', { htmlFor: `${uid}-cr` }, COUNT_LABEL),
        countStep.group),
      muteField,
      rollField,
      el('div', { class: 'hm-field' },
        el('span', { class: 'hm-check' }, decayBox, el('label', { htmlFor: `${uid}-dk` }, 'Piano-like decay'))),
      tauField,
      repeatField,
      stringsField,
      detuneField,
      realGroup);
  const waveCap = el('p', { class: 'hm-cap muted t-caption' });

  const feed = createFeeder(() => (running && synth.analyser ? { an: synth.analyser, sr: rate() } : null));
  const colors = createColors(() => node, now);
  const gram = createGramView({ colors, feed, range: () => rangeNow(), ticks: (r, h) => gramTicks(rowsNow(), r, h) });
  const bands = createBandsView({ uid, colors, feed });
  const stack = createStackCard(env);

  const node =el('section', { class: 'card hm-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    ctlBox,
    stringsNote,
    el('div', { class: 'hm-play' }, button, state),
    skipNote,
    el('div', { class: 'hm-block' },
      el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, 'Waveform'), el('div', { class: 'hm-checks' }, partsField, eachField)),
      cyclesField,
      view(waveCanvas, 'hm-wave'),
      waveCap,
      stringsHint,
      beatHint),
    stack.node,
    el('div', { class: 'hm-block' },
      el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, 'Spectrum'), el('div', { class: 'hm-checks' }, trailControl.node, axisControl.node)),
      view(specCanvas, 'hm-spec'),
      specCap,
      list),
    gram.node,
    bands.node,
    el('div', { class: 'hm-block' },
      el('h3', { class: 't-subhead' }, 'Beating'),
      beatView,
      beatCap,
      beatingOut),
    about);

  const rate = () => synth.ctx?.sampleRate ?? 48000;
  const rowsNow = () => harmonicList(params, rate());

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
    const muted = isMuted(params) ? ', H1 muted (missing fundamental)' : '';
    const base = `${synthCount(params.strings, params.count)} harmonics of ${fmtHz(params.freq)}, ${note.name}, decay ${params.rolloff} dB per octave${muted}${piano}${multi}${extra}`;
    const where = axisText(rangeNow());
    const shown = `${CYCLE_NAMES[cycles]} of the fundamental`;
    waveCanvas.setAttribute('aria-label', `Waveform of the synthesized tone, ${shown}: ${base}`);
    specCanvas.setAttribute('aria-label', `Spectrum of the synthesized tone, ${where}, one bar per harmonic: ${base}`);
    gram.canvas.setAttribute('aria-label', `Spectrogram of the synthesized tone, ${where}, last 10 seconds: ${base}`);
    bands.describe('the synthesized tone');
    const own = eachShown() ? ' The faint coloured lines are single strings played alone.' : '';
    waveCap.textContent = `${VIEW_NAMES.wave} Window: ${shown}; the bright line is the sum.${own}`;
    specCap.textContent = `${VIEW_NAMES.spectrum} Frequency axis ${axisCaption(rangeNow())}, level in dBFS, one bar per harmonic.${trails.on ? ` The faint ghost bars show where each harmonic recently was; they fade out in about ${trailLengthText(trails.length)}.` : ''}`;
    gram.caption.textContent = `${VIEW_NAMES.gram} The last 10 seconds, frequency axis ${axisCaption(rangeNow())}. It fills while the tone plays and clears when the axis changes.`;
    const lead = leadN(params);
    const beat = beatRate(params.freq * lead, params.strings, params.detune);
    const win = beatingWindow(beat > 0 ? 1 / beat : 0);
    const kind = beat > 0 ? `${swellText(beat, lead)}` : params.strings < 2 ? BEATING_ONE : BEATING_ZERO;
    beatCanvas.setAttribute('aria-label', `Beating of the synthesized strings, ${win} seconds: amplitude envelope of ${params.strings} string${params.strings === 1 ? '' : 's'}, ${kind}`);
    beatCap.textContent = `${VIEW_NAMES.beating} Time across (${win} s), amplitude up, shown at full level without the piano decay. The bright lines are the envelope of the sum; the faint lines are the level of each string's H${lead} and the envelope of the H${lead}s added together.${lead > 1 ? ' H1 is muted, so the beating of H2 (the lowest harmonic that sounds) is shown.' : ''}`;
  }

  const eachShown = () => params.strings > 1 && showStrings;

  const rangeNow = () => axisRange(axis, params.freq, synthCount(params.strings, params.count), realism(params).inharmB);

  function paintList() {
    const rows = rowsNow();
    list.replaceChildren(...rows.filter((r) => r.played).map((r) => el('li', r.muted ? { class: 'is-muted' } : {}, `${harmonicLabel(r)} · ${r.muted ? 'off' : `${r.db.toFixed(1)} dB`}`)));
    const skipped = rows.filter((r) => !r.played);
    skipNote.hidden = !skipped.length;
    if (skipped.length) skipNote.textContent = `${skipped.length === 1 ? `H${skipped[0].n} is` : `H${skipped[0].n} to H${skipped.at(-1).n} are`} above ${fmtHz(playableLimit(rate()))} and skipped.`;
  }

  function paintOutputs() {
    const fill = (range, v, lo, hi) => range.style.setProperty('--p', ((v - lo) / (hi - lo)).toFixed(4));
    fill(freqRange, hzToSlider(params.freq), 0, 1000);
    fill(tauRange, params.tau, MIN_TAU, MAX_TAU);
    fill(repeatRange, params.repeat, MIN_REPEAT, MAX_REPEAT);
    noteOut.textContent = noteInfo(params.freq).text;
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
    strikeMoreText.textContent = strikeMore(params.strike);
    const single = params.count < 2;
    muteBox.checked = params.mute;
    setNeeds(muteBox, muteField, muteHint, single);
    muteNote.hidden = !isMuted(params);
    muteNote.textContent = muteNote.hidden ? '' : muteText(partialFreq(1, params.freq, realism(params).inharmB));
    setNeeds(rollStep.input, rollField, rollHint, single);
    countStep.sync();
    rollStep.sync();
    setNeeds(strikeCtl.range, strikeCtl.field, strikeHint, single);
    fill(detuneRange, params.detune, 0, MAX_DETUNE);
    detuneOut.textContent = `${params.detune} cents`;
    const lead = leadN(params);
    const beat = beatRate(params.freq * lead, params.strings, params.detune);
    detuneField.hidden = params.strings < 2;
    beatOut.hidden = !(beat > 0);
    beatOut.textContent = beat > 0 ? beatText(beat, lead) : '';
    beatHint.hidden = !(beat > 0);
    fill(stringsRange, params.strings, 1, MAX_STRINGS);
    stringsOut.textContent = String(params.strings);
    const capped = capText(params.strings, params.count);
    capOut.hidden = !capped;
    capOut.textContent = capped;
    axisControl.paint();
    cyclesSeg.paint();
    eachField.hidden = params.strings < 2;
    stringsHint.hidden = !eachShown();
    beatingOut.hidden = !(beat > 0);
    beatingOut.textContent = beat > 0 ? swellText(beat, lead) : '';
    describe();
    paintList();
    stack.update({ harmonics: synthHarmonics(rowsNow(), params.freq), freq: params.freq, extra: `${STACK_NOTE} ${DETUNE_NOTE}` });
  }

  function paintWave() {
    const g = fit(waveCanvas);
    if (!g) return;
    const f = feed();
    const rows = rowsNow();
    const points = Math.max(32, Math.round(g.w - 44));
    const withStrings = eachShown();
    const data = computedWave(rows, points, cycles, stringOffsets(params.strings, params.detune), withStrings);
    let sum = data.sum;
    if (f) {
      f.an.getFloatTimeDomainData(f.b.time);
      if (isMuted(params)) sum = levelMatched(sum, f.b.time, rows);
      else sum = liveWave(f.b.time, f.sr, params.freq, points, cycles) ?? (params.decay && isSilent(f.b.time) ? new Float32Array(points) : sum);
    }
    drawWaveView(g, colors(), { sum, parts: data.parts, strings: withStrings ? data.strings : [], rows, cycles, freq: params.freq }, showParts);
  }

  function beatingFor(cols) {
    const real = realism(params);
    const lead = leadN(params);
    const key = [cols, params.freq, params.count, params.rolloff, params.strings, params.detune, real.inharmB, real.strike, lead, rate()].join('|');
    if (key === beatingKey && beatingData) return beatingData;
    const rows = rowsNow();
    const offsets = stringOffsets(params.strings, params.detune);
    const beat = beatRate(params.freq * lead, params.strings, params.detune);
    const period = beat > 0 ? 1 / beat : 0;
    const windowS = beatingWindow(period);
    const { lo, hi } = beatingEnvelope(rows, offsets, windowS, cols);
    const first = rows[lead - 1];
    beatingKey = key;
    beatingData = {
      lo, hi, windowS, period, strings: params.strings,
      h1: beatingH1(rows, offsets, windowS, cols, lead - 1),
      own: first?.played ? first.gain / params.strings : 0,
      message: beat > 0 ? '' : params.strings < 2 ? BEATING_ONE : BEATING_ZERO,
    };
    return beatingData;
  }

  function paintBeating() {
    const g = fit(beatCanvas);
    if (!g) return;
    drawBeatingView(g, colors(), beatingFor(Math.max(32, Math.round(g.w - 44))));
  }

  function paintSpectrum() {
    const g = fit(specCanvas);
    if (!g) return;
    const f = feed();
    const rows = rowsNow();
    let levels = rows.map((r) => r.db);
    let ghost = null;
    if (f) {
      f.an.getFloatFrequencyData(f.b.freq);
      levels = barLevels(rows, f.b.freq, f.sr, params.strings > 1 ? params.detune : 0);
      trails.step(levels, now(), rows);
      ghost = trails.buf;
    } else {
      trails.clear();
    }
    drawSpectrumView(g, colors(), rows, levels, rangeNow(), specPointer.x, ghost);
  }

  function paintStatic() {
    paintWave();
    paintSpectrum();
    gram.paintAxes();
    bands.paint();
    paintBeating();
  }

  function tick() {
    if (!running || gone) return;
    frame = raf(tick);
    const t = now();
    const dt = Math.min(0.25, Math.max(0, (t - lastTick) / 1000));
    lastTick = t;
    paintWave();
    paintSpectrum();
    gram.step(dt);
    bands.step(t);
  }

  function paintButton() {
    label.textContent = running ? 'Stop' : 'Play';
    button.classList.toggle('primary', !running);
    button.classList.toggle('outline', running);
    toggleIcon.replaceChildren(icon(running ? 'clear' : 'play', 'action'));
  }

  const CALM = new Set(['idle', 'playing']);

  function say(key) {
    state.textContent = TEXT[key];
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

  function stop(key = 'idle') {
    if (!running) return;
    running = false;
    release();
    synth.stop();
    if (gone) return;
    paintButton();
    say(key);
    gram.restart();
    bands.reset();
    paintStatic();
  }

  function engage(key) {
    running = true;
    lastTick = now();
    gram.restart();
    bands.reset();
    safety = setTimeout(() => stop('timeout'), MAX_RUN_MS);
    listen(doc, 'visibilitychange', () => { if (doc.hidden) stop('hidden'); });
    paintButton();
    say(key);
    frame = raf(tick);
  }

  async function start() {
    if (running || gone) return;
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
    if (running) { gram.paintAxes(); paintBeating(); } else paintStatic();
  }

  function setAxis(next) {
    if (next === axis) return;
    axis = next;
    paintOutputs();
    gram.refresh();
    paintSpectrum();
  }

  function setCycles(next) {
    if (next === cycles || !CYCLES_CHOICES.includes(next)) return;
    cycles = next;
    paintOutputs();
    paintWave();
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
  stringsRange.addEventListener('input', () => change({ strings: Number(stringsRange.value) }));
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
      gram.paintAxes();
      if (running) paintBeating(); else paintStatic();
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
    setAxis,
    start,
    stop: () => stop('idle'),
    dispose() {
      gone = true;
      ro?.disconnect();
      stack.dispose();
      if (running) { running = false; release(); }
      synth.stop();
    },
  };
}
