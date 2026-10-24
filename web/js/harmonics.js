import { el } from './dom.js';
import { icon } from './icons.js';
import { parseColor, mixColor } from './viz-color.js';

export const TITLE = 'Pitch and harmonics';
export const MIN_HZ = 20;
export const MAX_HZ = 4000;
export const MAX_COUNT = 32;
export const MIN_ROLLOFF = -24;
export const MAX_STRINGS = 3;
export const MAX_DETUNE = 5;
export const DEFAULTS = { freq: 220, count: 10, rolloff: -12, decay: false, tau: 1.2, repeat: 3, strings: 1, detune: 2 };
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
  };
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
  const limit = playableLimit(sampleRate);
  const widest = centsRatio(strings > 1 ? detune : 0);
  const rows = [];
  let sum = 0;
  for (let n = 1; n <= count; n += 1) {
    const f = n * freq;
    const played = f * widest < limit;
    const amp = amplitude(n, rolloff);
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

export function gramRows(rowCount, sampleRate, bins) {
  const bw = sampleRate / (2 * bins);
  const rows = [];
  for (let r = 0; r < rowCount; r += 1) {
    const lo = SPECTRUM_MIN_HZ * (SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ) ** (1 - (r + 1) / rowCount);
    const hi = SPECTRUM_MIN_HZ * (SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ) ** (1 - r / rowCount);
    const a = clamp(Math.floor(lo / bw), 0, bins - 1);
    const b = clamp(Math.max(a, Math.ceil(hi / bw)), 0, bins - 1);
    rows.push([a, b]);
  }
  return rows;
}

export function levelColor(stops, t) {
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixColor(stops[i], stops[i + 1], x - i);
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
      osc.connect(gain);
      gain.connect(trim);
      osc.start(t);
      voices.push({ osc, gain, env: { t0: 0, gain: 0, tau: Infinity } });
    }
    return { trim, voices, fresh: true };
  }

  function retire(s, t) {
    const g = s.trim.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + FADE_S);
    setTimeout(() => {
      for (const v of s.voices) { try { v.osc.stop(); } catch { /* already stopped */ } v.osc.disconnect(); v.gain.disconnect(); }
      s.trim.disconnect();
    }, FADE_S * 1000 + 40);
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
    live.strings.forEach((s, k) => {
      const direct = initial || s.fresh;
      s.fresh = false;
      if (initial) s.trim.gain.value = 1 / p.strings;
      else s.trim.gain.setTargetAtTime(1 / p.strings, t, SMOOTH_S);
      s.voices.forEach((v, i) => {
        const gain = rows[i]?.played ? rows[i].gain : 0;
        const hz = Math.min((i + 1) * p.freq, limit);
        if (direct) {
          v.osc.frequency.value = hz;
          v.osc.detune.value = offsets[k];
          v.gain.gain.value = live.decay ? 0 : gain;
        } else {
          v.osc.frequency.setTargetAtTime(hz, t, SMOOTH_S);
          v.osc.detune.setTargetAtTime(offsets[k], t, SMOOTH_S);
          if (!live.decay) v.gain.gain.setTargetAtTime(gain, t, SMOOTH_S);
        }
      });
    });
  }

  function strike(at, params, strings = live.strings) {
    const now = live.ctx.currentTime;
    const rows = harmonicList(params, live.ctx.sampleRate);
    const tau1 = clampParams(params).tau;
    const from = Math.max(now, at - RELEASE_S);
    voicesOf(strings).forEach((v, j) => {
      const i = j % MAX_COUNT;
      const p = v.gain.gain;
      const gain = rows[i]?.played ? rows[i].gain : 0;
      const tau = tauOf(i + 1, tau1);
      p.cancelScheduledValues(from);
      p.setValueAtTime(envelopeValue(v.env, from), from);
      p.linearRampToValueAtTime(0, at);
      if (gain > 0) {
        p.linearRampToValueAtTime(gain, at + ATTACK_S);
        p.setTargetAtTime(0, at + ATTACK_S, tau);
      }
      v.env = { t0: at + ATTACK_S, gain, tau };
    });
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
      const p = v.gain.gain;
      const held = p.value;
      p.cancelScheduledValues(t);
      p.setValueAtTime(held, t);
      v.env = { t0: 0, gain: held, tau: Infinity };
    }
    live.decay = true;
    live.params = clampParams(params);
    live.next = t + 0.02;
    pump();
  }

  function leaveDecay() {
    clearTimeout(live.timer);
    live.decay = false;
    live.last = 0;
    const t = live.ctx.currentTime;
    for (const v of voicesOf(live.strings)) {
      const p = v.gain.gain;
      const held = p.value;
      p.cancelScheduledValues(t);
      p.setValueAtTime(held, t);
    }
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
      live = { ctx, master, analyser, strings: [], decay: clamped.decay, params: clamped, next: 0, last: 0, timer: 0 };
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
        for (const v of voicesOf(r.strings)) { try { v.osc.stop(); } catch { /* already stopped */ } v.osc.disconnect(); v.gain.disconnect(); }
        for (const s of r.strings) s.trim.disconnect();
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

function drawSpectrumView(g, colors, rows, levels) {
  const { ctx, w, h } = g;
  const left = 34;
  const right = 8;
  const top = 30;
  const bottom = 18;
  const plotW = Math.max(1, w - left - right);
  const plotH = Math.max(1, h - top - bottom);
  const yOf = (db) => top + ((DB_MAX - clamp(db, DB_MIN, DB_MAX)) / (DB_MAX - DB_MIN)) * plotH;
  const xOf = (f) => left + logPos(f) * plotW;
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
  for (const [f, text] of FREQ_TICKS) {
    const x = xOf(f);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + plotH); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(text, x, top + plotH + 3);
  }
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

function drawGramAxes(g, colors) {
  const { ctx, w, h } = g;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  for (const [f, text] of FREQ_TICKS) {
    const y = h * (1 - logPos(f));
    ctx.strokeStyle = css(colors.ink, 0.25);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = css(colors.sunken, 0.8);
    ctx.fillRect(2, y - 7, tw + 4, 14);
    ctx.fillStyle = css(colors.ink);
    ctx.fillText(text, 4, y);
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
  const label = el('span', {}, 'Play');
  const toggleIcon = el('span', { class: 'hm-ic' }, icon('play', 'action'));
  const button = el('button', { class: 'btn primary hm-toggle', type: 'button', onclick: () => { if (running) stop('idle'); else start(); } }, toggleIcon, label);
  const state = el('p', { class: 'hm-state t-subhead' }, TEXT.idle);
  const skipNote = el('p', { class: 'hm-skip muted t-caption', hidden: true });

  const waveCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const specCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const gramCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const gramAxes = el('canvas', { class: 'hm-canvas hm-axes', 'aria-hidden': 'true' });
  const partsBox = el('input', { id: `${uid}-ip`, type: 'checkbox', onchange: () => { showParts = partsBox.checked; paintWave(); } });
  const scaleBar = el('span', { class: 'hm-scale', 'aria-hidden': 'true' });
  const list = el('ul', { class: 'hm-list t-caption', 'aria-label': 'Harmonics' });

  const beatHint = el('p', { class: 'hm-cap muted t-caption', hidden: true }, BEAT_HINT);
  const view = (canvas, cls, ...extra) => el('div', { class: `hm-view ${cls}` }, canvas, ...extra);
  const about = el('details', { class: 'hm-about', open: true },
    el('summary', { class: 't-subhead' }, ABOUT_TITLE),
    el('dl', { class: 'hm-defs' }, ...ABOUT.flatMap(([term, text]) => [el('dt', { class: 't-subhead' }, term), el('dd', { class: 't-subhead muted' }, text)])));

  const node = el('section', { class: 'card hm-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('div', { class: 'hm-ctl' },
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
      detuneField),
    el('p', { class: 'hm-cap muted t-caption' }, STRINGS_NOTE),
    el('div', { class: 'hm-play' }, button, state),
    skipNote,
    el('div', { class: 'hm-block' },
      el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, 'Waveform'),
        el('span', { class: 'hm-check' }, partsBox, el('label', { htmlFor: `${uid}-ip` }, 'Show individual harmonics'))),
      view(waveCanvas, 'hm-wave'),
      el('p', { class: 'hm-cap muted t-caption' }, 'Time across, amplitude up, 3.5 cycles of the fundamental. The bright line is the sum.'),
      beatHint),
    el('div', { class: 'hm-block' },
      el('h3', { class: 't-subhead' }, 'Spectrum'),
      view(specCanvas, 'hm-spec'),
      el('p', { class: 'hm-cap muted t-caption' }, 'Frequency across (log), level in dBFS up, one bar per harmonic.'),
      list),
    el('div', { class: 'hm-block' },
      el('h3', { class: 't-subhead' }, 'Spectrogram'),
      view(gramCanvas, 'hm-gram', gramAxes),
      el('div', { class: 'hm-legend t-caption muted' }, el('span', {}, `${GRAM_DB_MIN} dB`), scaleBar, el('span', {}, `${GRAM_DB_MAX} dB`)),
      el('p', { class: 'hm-cap muted t-caption' }, 'The last 10 seconds: time across, frequency up (log), colour is level. It fills while the tone plays.')),
    about);

  function currentColors() {
    const t = now();
    if (!colors || t - colorsAt > 500) { colors = readColors(node); colorsAt = t; scaleBar.style.background = `linear-gradient(to right, ${colors.stops.map((c) => css(c)).join(', ')})`; }
    return colors;
  }

  const rate = () => synth.ctx?.sampleRate ?? 48000;
  const rowsNow = () => harmonicList(params, rate());

  function describe() {
    const note = noteInfo(params.freq);
    const piano = params.decay ? `, piano-like decay, fade ${params.tau} s, repeat every ${params.repeat} s` : '';
    const multi = params.strings > 1 ? `, ${params.strings} strings detuned by ${params.detune} cents` : '';
    const base = `${params.count} harmonics of ${fmtHz(params.freq)}, ${note.name}, decay ${params.rolloff} dB per octave${piano}${multi}`;
    waveCanvas.setAttribute('aria-label', `Waveform of the synthesized tone, 3.5 cycles: ${base}`);
    specCanvas.setAttribute('aria-label', `Spectrum of the synthesized tone, one bar per harmonic: ${base}`);
    gramCanvas.setAttribute('aria-label', `Spectrogram of the synthesized tone, last 10 seconds: ${base}`);
  }

  function paintList() {
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
    fill(detuneRange, params.detune, 0, MAX_DETUNE);
    detuneOut.textContent = `${params.detune} cents`;
    const beat = beatRate(params.freq, params.strings, params.detune);
    detuneField.hidden = params.strings < 2;
    beatOut.hidden = !(beat > 0);
    beatOut.textContent = beat > 0 ? `H1 beats about ${fmtBeat(beat)} Hz` : '';
    beatHint.hidden = !(beat > 0);
    stringBtns.forEach((b, i) => {
      const on = i + 1 === params.strings;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    describe();
    paintList();
  }

  function liveBuffers() {
    const an = synth.analyser;
    if (!an) return null;
    if (!buffers.time || buffers.time.length !== an.fftSize) {
      buffers.time = new Float32Array(an.fftSize);
      buffers.freq = new Float32Array(an.frequencyBinCount);
    }
    return buffers;
  }

  function paintWave() {
    const g = fit(waveCanvas);
    if (!g) return;
    const rows = rowsNow();
    const points = Math.max(32, Math.round(g.w - 44));
    const data = computedWave(rows, points, CYCLES, stringOffsets(params.strings, params.detune));
    let sum = data.sum;
    const b = running ? liveBuffers() : null;
    if (b) {
      synth.analyser.getFloatTimeDomainData(b.time);
      sum = liveWave(b.time, rate(), params.freq, points) ?? (params.decay && isSilent(b.time) ? new Float32Array(points) : sum);
    }
    drawWaveView(g, currentColors(), { sum, parts: data.parts, rows, cycles: CYCLES, freq: params.freq }, showParts);
  }

  function paintSpectrum() {
    const g = fit(specCanvas);
    if (!g) return;
    const rows = rowsNow();
    let levels = rows.map((r) => r.db);
    const b = running ? liveBuffers() : null;
    if (b) {
      synth.analyser.getFloatFrequencyData(b.freq);
      levels = barLevels(rows, b.freq, rate(), params.strings > 1 ? params.detune : 0);
    }
    drawSpectrumView(g, currentColors(), rows, levels);
  }

  function paintGramAxes() {
    const g = fit(gramAxes);
    if (g) drawGramAxes(g, currentColors());
  }

  function clearGram() {
    const g = fit(gramCanvas);
    if (!g) return;
    g.ctx.setTransform(1, 0, 0, 1, 0, 0);
    g.ctx.clearRect(0, 0, gramCanvas.width, gramCanvas.height);
    g.ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  }

  function stepGram(dt) {
    const g = fit(gramCanvas);
    if (!g) return;
    const b = liveBuffers();
    if (!b) return;
    if (g.resized) paintGramAxes();
    const { ctx } = g;
    const pw = gramCanvas.width;
    const ph = gramCanvas.height;
    pending += (pw * dt) / GRAM_SECONDS;
    const dx = Math.floor(pending);
    if (dx < 1) return;
    pending -= dx;
    synth.analyser.getFloatFrequencyData(b.freq);
    const rowCount = Math.min(ph, 160);
    const key = `${rowCount}|${rate()}|${b.freq.length}`;
    if (key !== gramRowsKey) { gramRowsKey = key; gramMap = gramRows(rowCount, rate(), b.freq.length); }
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

  function paintStatic() {
    paintWave();
    paintSpectrum();
    paintGramAxes();
  }

  function tick() {
    if (!running || gone) return;
    frame = raf(tick);
    const t = now();
    const dt = Math.min(0.25, Math.max(0, (t - lastTick) / 1000));
    lastTick = t;
    paintWave();
    paintSpectrum();
    stepGram(dt);
  }

  function paintButton() {
    label.textContent = running ? 'Stop' : 'Play';
    button.classList.toggle('primary', !running);
    button.classList.toggle('outline', running);
    toggleIcon.replaceChildren(icon(running ? 'clear' : 'play', 'action'));
  }

  function say(key) {
    state.textContent = TEXT[key];
    state.classList.toggle('error', key !== 'idle' && key !== 'playing');
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
    clearGram();
    paintStatic();
  }

  function start() {
    if (running || gone) return;
    try {
      synth.start(params);
    } catch (ex) {
      say(ex?.name === 'NotSupportedError' ? 'unsupported' : 'failed');
      return;
    }
    running = true;
    pending = 0;
    lastTick = now();
    clearGram();
    safety = setTimeout(() => stop('timeout'), MAX_RUN_MS);
    listen(doc, 'visibilitychange', () => { if (doc.hidden) stop('hidden'); });
    paintButton();
    say('playing');
    frame = raf(tick);
  }

  function change(next) {
    params = clampParams({ ...params, ...next });
    synth.update(params);
    paintOutputs();
    if (!running) paintStatic();
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
    start,
    stop: () => stop('idle'),
    dispose() {
      gone = true;
      ro?.disconnect();
      if (running) { running = false; release(); synth.stop(); }
    },
  };
}
