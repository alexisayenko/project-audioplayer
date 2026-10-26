import { el } from './dom.js';
import { icon } from './icons.js';
import { segmented } from './segmented.js';
import { attachInfo } from './info-popover.js';
import { WAVES, WAVE_DEFAULT, WAVE_LABEL, WAVE_TEXT, HARM_TEXT, HARM_TITLE, waveName, waveValue, loudnessScale, oscNorm, wavePowerPct, waveGlyph, createHarmonicsChart } from './wave-shapes.js';
import {
  CUSTOM, MAX_HARMONICS, VISIBLE_HARMONICS, SMALL_JUMP, PLAY_LIMIT_HZ, defaultBars, presetBars, partialBars, analyzeBars, customGain, periodicCoefficients,
  tableSeries, componentSeries, strongest, maxJump, aboveLimit, snapBar,
} from './custom-wave.js';
import { createHarmonicEditor, TITLE as EDITOR_TITLE, TIP as EDITOR_TIP } from './harmonic-editor.js';
import { createStackCard, shapeHarmonics, barHarmonics } from './harmonics-stack.js';
import { gt } from './cmp.js';

export const TITLE = 'Primitive';
export const INTRO = 'A primitive sound: a single repeating shape (sine, triangle, square or sawtooth) at one frequency. Sine is one pure frequency (H1 only); the other shapes add harmonics. It models a speaker cone driven by an electrical signal. Pick a standard shape or build your own from harmonics. Set the four numbers, press Play.';
export const PRIMITIVE_WAVES = [...WAVES, CUSTOM];
export const PRIMITIVE_WAVE_TEXT = { ...WAVE_TEXT, [CUSTOM]: 'Custom' };
export const MIN_HZ = 20;
export const MAX_HZ = 20000;
export const MAX_AMP = 0.8;
export const MAX_POWER_PCT = 64;
export const MIN_LEN = 0.1;
export const MAX_LEN = 30;
export const DEFAULTS = { freq: 440, amp: 0.3, length: 2, continuous: true, wave: WAVE_DEFAULT };
export const FADE_S = 0.03;
export const SMOOTH_S = 0.015;
export const MAX_RUN_MS = 10 * 60 * 1000;
export const FFT_SIZE = 32768;
export const CYCLES = 1;
export const SCOPE_TICKS = 4;
export const SOUND_SPEED = 343;
export const NARROW_PX = 480;
export const SCOPE_TITLE = 'Waveform: one cycle';
export const SCOPE_SUB = 'Waveform of the tone you will hear over one cycle: time across, amplitude up.';
export const SCOPE_NOTE = 'The bracket: one cycle in time is one wavelength in space (speed of sound 343 m/s divided by the frequency, in air at 20 °C).';
export const WINDOW_TITLE = 'Waveform: time window';
export const WINDOW_SUB = 'Waveform of the tone you will hear over a period of time: time across, amplitude up.';
export const WINDOW_LABEL = 'Time window';
export const WINDOW_CHOICES = [10, 20, 50, 200];
export const WINDOW_DEFAULT = 20;
export const WINDOW_STEPS = { 10: 2, 20: 5, 50: 10, 200: 50 };
export const MANY_CYCLES = 60;
export const MANY_TEXT = 'Too many cycles to see the shape: shorten the window';
export const WINDOW_MAX_POINTS = 8000;
export const POWER_NOTE = 'Power grows with the square of the amplitude: double the amplitude, four times the power.';
export const DB_NOTE = 'In decibels of full scale: dBFS = 20 x log10(amplitude). 0 dBFS is the loudest tone the device can play.';
export const AMP_NOTE = 'How far the speaker cone moves.';
export const LIMIT_NOTE = 'Limited to 80 % of full scale to protect your hearing and the speaker.';
export const LENGTH_NOTE = 'A new length applies the next time you press Play. Continuous stops after 10 minutes.';
export const WAVE_LINK = 'See how a speaker makes a sound wave on the Sound wave page →';
export const WAVE_HREF = '#/learn/sound-wave';
export const GLOSSARY_LINK = 'Terms: see the Glossary →';
export const GLOSSARY_HREF = '#/glossary';
export const SINE_NOTE = 'One sine wave = one frequency = H1 only.';
export const SHAPE_NOTE = {
  sine: SINE_NOTE,
  triangle: 'One triangle wave = H1 plus odd harmonics (chart below).',
  square: 'One square wave = H1 plus odd harmonics (chart below).',
  sawtooth: 'One sawtooth wave = H1 plus all harmonics (chart below).',
  [CUSTOM]: 'Custom wave = the sum of the harmonic bars below, drawn from one table of 1024 points.',
};
export const WAVE_TIP = 'The shape of one cycle. Sine is one pure frequency; the others add harmonics: triangle and square only odd ones, sawtooth all of them. Custom lets you set every harmonic yourself.';
export const CUSTOM_HARM_TEXT = 'Custom: any repeating shape is a sum of sine waves; the standard shapes are particular recipes.';
export const LIMIT_HZ_NOTE = 'Harmonics above 20 kHz are not played.';
export const HIDDEN_NOTE = 'Harmonics 17 to 32 are hidden but still play.';
export const SILENT_NOTE = 'All bars are zero: this is silence.';
export const EQUIV_NOTE = 'Amplitude is the level of a sine with the same loudness; square waves are scaled down so that all shapes sound about equally loud.';
export const POWER_EQUIV_NOTE = 'Power here is the sine-equivalent power.';
export const HARM_SUM_NOTE = 'Your tone is the sum of these sine waves.';
export const TEXT = {
  idle: 'Ready',
  stopped: 'Stopped',
  done: 'Finished',
  hidden: 'Stopped: the page was hidden',
  timeout: 'Stopped: 10 minutes reached',
  unsupported: 'This browser cannot play audio',
  failed: 'Could not start the sound',
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
export const trim = (v, digits) => String(+v.toFixed(digits));

export const roundAmp = (amp) => Math.round(clamp(num(amp, DEFAULTS.amp), 0, MAX_AMP) * 100) / 100;

export const primitiveWave = (wave) => (wave === CUSTOM ? CUSTOM : waveName(wave));

export function waveFromHash(hash) {
  const q = new URLSearchParams(String(hash ?? '').split('?').slice(1).join('?'));
  const w = q.get('wave');
  return PRIMITIVE_WAVES.includes(w) ? w : null;
}

export function clampParams(p = {}) {
  return {
    freq: clamp(num(p.freq, DEFAULTS.freq), MIN_HZ, MAX_HZ),
    amp: roundAmp(p.amp),
    length: clamp(num(p.length, DEFAULTS.length), MIN_LEN, MAX_LEN),
    continuous: p.continuous === undefined ? DEFAULTS.continuous : !!p.continuous,
    wave: primitiveWave(p.wave),
  };
}

const presetGain = (wave, amp) => (amp > 0 ? Math.min(MAX_AMP, (amp * loudnessScale(waveName(wave))) / oscNorm(wave)) : 0);

export const oscGain = (wave, amp, rms = 0) => (wave === CUSTOM ? customGain(amp, rms, MAX_AMP) : presetGain(wave, amp));

export const shapeLevel = (wave, amp, rms = 0) => (wave === CUSTOM ? oscGain(wave, amp, rms) : oscGain(wave, amp) * oscNorm(wave));

export const shapePowerPct = (wave, peak, rms = 0) => (wave === CUSTOM ? 200 * (peak * rms) ** 2 : wavePowerPct(waveName(wave), peak));

export function shapeAt(wave, u) {
  if (wave === 'sine' || !WAVES.includes(wave)) return Math.sin(2 * Math.PI * u);
  return waveValue(wave, wave === 'sawtooth' ? u + 0.5 : u);
}

export function sliderToHz(pos) {
  const f = MIN_HZ * (MAX_HZ / MIN_HZ) ** (clamp(pos, 0, 1000) / 1000);
  return f < 100 ? Math.round(f * 10) / 10 : Math.round(f);
}

export function hzToSlider(f) {
  return Math.round((1000 * Math.log(clamp(f, MIN_HZ, MAX_HZ) / MIN_HZ)) / Math.log(MAX_HZ / MIN_HZ));
}

export function noteInfo(freq) {
  if (!gt(freq, 0)) return { name: '-', cents: 0, text: '-' };
  const exact = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(exact);
  const cents = Math.round((exact - midi) * 100);
  const name = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return { name, cents, text: `${name} ${cents >= 0 ? '+' : '-'}${Math.abs(cents)} cents` };
}

export const powerPct = (amp) => amp * amp * 100;

export const ampOfPower = (pct) => roundAmp(Math.sqrt(clamp(num(pct, 0), 0, MAX_POWER_PCT) / 100));

export const ampPercent = (amp) => Math.round(amp * 100);

export const fmtAmp = (amp) => trim(amp, 2);

export const fmtPower = (pct) => (pct < 10 ? trim(pct, 1) : String(Math.round(pct)));

export const dbfs = (amp) => (amp > 0 ? 20 * Math.log10(amp) : -Infinity);

export const fmtDb = (amp) => (amp > 0 ? `${dbfs(amp).toFixed(1)} dBFS` : 'silence');

export const fmtPct = (v) => trim(v, 2);

export const periodMs = (freq) => 1000 / freq;

export const fmtMs = (ms) => String(+ms.toPrecision(3));

export function readout(p, rms = 0) {
  const lasts = p.continuous ? 'until you press Stop' : `${trim(p.length, 2)} s`;
  const peak = shapeLevel(p.wave, p.amp, rms);
  return `Period ${fmtMs(periodMs(p.freq))} ms = 1/f; pressure swings ±${ampPercent(peak)} % of full scale; power ${fmtPower(shapePowerPct(p.wave, peak, rms))} %; sound lasts ${lasts}.`;
}

export function wavelengthM(freq) {
  return SOUND_SPEED / freq;
}

export function fmtWavelengthLabel(freq) {
  const m = wavelengthM(freq);
  if (m >= 0.995) return `${m.toFixed(2)} m`;
  return `${+(m * 100).toFixed(m * 100 < 9.95 ? 1 : 0)} cm`;
}

export function cycleLabels(freq) {
  const hz = trim(freq, 2);
  const ms = fmtMs(periodMs(freq));
  const wave = fmtWavelengthLabel(freq);
  return [
    `1 cycle = ${ms} ms = ${hz} Hz = ${wave} in air`,
    `1 cycle · ${ms} ms · ${hz} Hz · ${wave}`,
    `1 cycle · ${ms} ms · ${hz} Hz`,
  ];
}

export function pickCycleLabel(freq, maxWidth, measure, narrow) {
  const all = cycleLabels(freq);
  const from = narrow ? 1 : 0;
  for (let i = from; i < all.length; i += 1) if (measure(all[i]) <= maxWidth) return all[i];
  return all.at(-1);
}

export function scopeGeometry(w, h, bracket = true) {
  const left = 40;
  const bottom = 18;
  const pad = 8;
  const row = bracket ? 26 : 0;
  const mid = (h - bottom - row) / 2;
  return { left, bottom, pad, row, mid, scale: mid - pad, plotW: Math.max(1, w - left - pad), rowTop: h - bottom - row };
}

export const windowCycles = (freq, windowMs) => (freq * windowMs) / 1000;

export function fmtCycles(cycles) {
  return cycles < 10 ? String(+cycles.toFixed(1)) : String(Math.round(cycles));
}

export function windowCaption(freq, windowMs) {
  const text = fmtCycles(windowCycles(freq, windowMs));
  return `about ${text} ${text === '1' ? 'cycle' : 'cycles'} in ${windowMs} ms`;
}

export const tooManyCycles = (cycles) => cycles > MANY_CYCLES;

export function windowTicks(windowMs) {
  const step = WINDOW_STEPS[windowMs] ?? windowMs / 4;
  const n = Math.max(1, Math.round(windowMs / step));
  return Array.from({ length: n + 1 }, (_, k) => ({ frac: k / n, ms: k * step }));
}

export const windowPoints = (width, cycles) => clamp(Math.round(cycles * 12), Math.max(64, Math.round(width * 2)), WINDOW_MAX_POINTS);

export function scopeSeries(amp, points, cycles = CYCLES, wave = WAVE_DEFAULT, table = null) {
  if (wave === CUSTOM && table) return tableSeries(table, amp, points, cycles);
  const out = new Array(points);
  for (let i = 0; i < points; i += 1) out[i] = amp * shapeAt(wave, cycles * (i / (points - 1)));
  return out;
}

export function liveWindow(samples, sampleRate, freq, cycles = CYCLES, points = 0) {
  const period = sampleRate / freq;
  const span = cycles * period;
  const need = Math.max(2, points > 1 ? Math.round(points) : Math.round(span));
  const len = samples.length;
  const from = Math.max(0, len - Math.ceil(span) - Math.ceil(period) - 2);
  const last = Math.min(len - 2, from + Math.ceil(period));
  let start = from;
  for (let i = from; i <= last; i += 1) {
    if (samples[i] <= 0 && samples[i + 1] > 0) { start = i + -samples[i] / (samples[i + 1] - samples[i]); break; }
  }
  const out = new Float32Array(need);
  let count = 0;
  for (; count < need; count += 1) {
    const pos = start + (count / (need - 1)) * span;
    const i0 = Math.floor(pos);
    if (i0 + 1 > len - 1) break;
    const frac = pos - i0;
    out[count] = samples[i0] * (1 - frac) + samples[i0 + 1] * frac;
  }
  return { samples: out.subarray(0, count), need };
}

export function scopeTicks(cycles, freq) {
  return Array.from({ length: SCOPE_TICKS + 1 }, (_, k) => ({
    frac: k / SCOPE_TICKS,
    ms: (((cycles * k) / SCOPE_TICKS) * 1000) / freq,
  }));
}

export function styleReader(node) {
  const css = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
  return (name, fallback) => css?.getPropertyValue(name).trim() || fallback;
}

export function readColors(node) {
  const get = styleReader(node);
  return {
    muted: get('--ink-muted', '#5f6669'),
    line: get('--line', '#ddd5c6'),
    fill: get('--fill', '#2298b1'),
    font: get('--font-sans', 'system-ui, sans-serif'),
  };
}

export function fit(canvas) {
  const box = canvas.parentElement;
  const w = Math.max(1, Math.round(box?.clientWidth || canvas.clientWidth || 320));
  const h = Math.max(1, Math.round(box?.clientHeight || canvas.clientHeight || 160));
  const dpr = globalThis.devicePixelRatio || 1;
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function tickAlign(frac) {
  if (frac === 0) return 'left';
  return frac >= 1 ? 'right' : 'center';
}

function drawAmpGuides({ ctx, w }, colors, amp, { left, pad, mid, scale }) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = colors.fill;
  ctx.setLineDash?.([4, 3]);
  for (const sign of [1, -1]) {
    const y = mid - sign * amp * scale;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - pad, y); ctx.stroke();
  }
  ctx.restore();
}

export function drawScope(g, colors, series, need, p, view) {
  const { ctx, w, h } = g;
  const { ticks, bracket = true, tickText } = view;
  const { left, bottom, pad, mid, scale, plotW } = scopeGeometry(w, h, bracket);
  ctx.clearRect(0, 0, w, h);
  ctx.font = `10px ${colors.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillStyle = colors.muted;
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  for (const [v, text] of [[1, '+1'], [0.5, '+0.5'], [0, '0'], [-0.5, '-0.5'], [-1, '-1']]) {
    const y = mid - v * scale;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - pad, y); ctx.stroke();
    ctx.fillText(text, left - 4, y);
  }
  ctx.textBaseline = 'top';
  for (const t of ticks) {
    const x = left + t.frac * plotW;
    ctx.beginPath(); ctx.moveTo(x, mid - scale); ctx.lineTo(x, mid + scale); ctx.stroke();
    ctx.textAlign = tickAlign(t.frac);
    ctx.fillText(tickText ? tickText(t) : `${fmtMs(t.ms)} ms`, x, h - bottom + 3);
  }
  if (p.amp > 0) drawAmpGuides(g, colors, p.amp, { left, pad, mid, scale });
  const trace = (data) => {
    const n = data.length;
    if (n < 2) return;
    const step = Math.max(1, Math.floor(n / (plotW * 2)));
    ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      const x = left + (i / (need - 1)) * plotW;
      const y = mid - clamp(data[i], -1.2, 1.2) * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  if (view.extras?.length) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = colors.fill;
    ctx.lineWidth = 1;
    for (const data of view.extras) trace(data);
    ctx.restore();
  }
  ctx.strokeStyle = colors.fill;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  trace(series);
  if (bracket) drawCycleBracket(g, colors, p.freq);
}

function drawCycleBracket(g, colors, freq) {
  const { ctx, w, h } = g;
  const { left, plotW, rowTop } = scopeGeometry(w, h);
  const x0 = left;
  const x1 = left + plotW;
  const y = rowTop + 7;
  ctx.save();
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y); ctx.lineTo(x1, y);
  for (const x of [x0, x1]) { ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); }
  ctx.stroke();
  ctx.font = `11px ${colors.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = colors.fill;
  const text = pickCycleLabel(freq, plotW - 8, (s) => ctx.measureText(s).width, w <= NARROW_PX);
  ctx.fillText(text, (x0 + x1) / 2, y + 5);
  ctx.restore();
}

export function createSimpleCard(env = {}) {
  const doc = env.document ?? globalThis.document;
  const Ctx = env.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const raf = env.raf ?? ((fn) => globalThis.requestAnimationFrame?.(fn) ?? 0);
  const caf = env.caf ?? ((id) => globalThis.cancelAnimationFrame?.(id));
  const now = env.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  let params = { ...DEFAULTS };
  let live = null;
  let state = 'idle';
  let frame = 0;
  let looping = false;
  const cycles = CYCLES;
  let win = WINDOW_DEFAULT;
  let colors = null;
  let colorsAt = 0;
  let gone = false;
  const off = [];

  const uid = `sm-${Math.random().toString(36).slice(2, 7)}`;
  const freqNum = el('input', { id: `${uid}-fn`, class: 'hm-num', type: 'number', min: MIN_HZ, max: MAX_HZ, step: 'any', inputmode: 'decimal', value: String(params.freq) });
  const freqRange = el('input', { id: `${uid}-fr`, class: 'slider hm-range', type: 'range', min: '0', max: '1000', step: '1', value: String(hzToSlider(params.freq)), 'aria-label': 'Frequency slider' });
  const noteOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-fn ${uid}-fr` });
  const ampNum = el('input', { id: `${uid}-an`, class: 'hm-num', type: 'number', min: '0', max: String(MAX_AMP * 100), step: 'any', inputmode: 'decimal' });
  const ampRange = el('input', { id: `${uid}-ar`, class: 'slider hm-range', type: 'range', min: '0', max: String(MAX_AMP * 100), step: '1', 'aria-label': 'Amplitude slider' });
  const ampOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-an ${uid}-ar` });
  const powNum = el('input', { id: `${uid}-pn`, class: 'hm-num', type: 'number', min: '0', max: String(MAX_POWER_PCT), step: 'any', inputmode: 'decimal' });
  const powRange = el('input', { id: `${uid}-pr`, class: 'slider hm-range', type: 'range', min: '0', max: String(MAX_POWER_PCT), step: '0.1', 'aria-label': 'Power slider' });
  const dbOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-pn ${uid}-pr ${uid}-an ${uid}-ar` });
  const lenNum = el('input', { id: `${uid}-ln`, class: 'hm-num', type: 'number', min: MIN_LEN, max: MAX_LEN, step: '0.1', inputmode: 'decimal', value: String(params.length) });
  const contBox = el('input', { id: `${uid}-cb`, type: 'checkbox', checked: params.continuous });

  const label = el('span', {}, 'Play');
  const toggleIcon = el('span', { class: 'hm-ic' }, icon('play', 'action'));
  const button = el('button', { class: 'btn primary hm-toggle', type: 'button', onclick: () => { if (live && !live.stopping) stop('stopped'); else start(); } }, toggleIcon, label);
  const stateOut = el('p', { class: 'hm-state t-subhead', role: 'status', 'aria-live': 'polite' }, TEXT.idle);
  const canvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const readoutOut = el('p', { class: 'hm-cap muted t-caption' });

  const windowCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const windowCapOut = el('p', { class: 'hm-cap muted t-caption' });
  const manyOut = el('p', { class: 'hm-cap t-caption sm-many', role: 'status' }, MANY_TEXT);
  const winSeg = segmented(WINDOW_CHOICES.map((n) => [n, `${n} ms`]), () => win, (n) => setWin(n), { 'aria-labelledby': `${uid}-wl` });
  const winField = el('div', { class: 'hm-axis' },
    el('span', { id: `${uid}-wl`, class: 'hm-lbl' }, WINDOW_LABEL),
    winSeg.group);

  const detach = [];
  const info = (about, text) => {
    const btn = el('button', { class: 'sm-info', type: 'button', 'aria-label': `About ${about}` }, 'i');
    detach.push(attachInfo(btn, text));
    return btn;
  };
  const field = (id, title, tip, ...rest) => el('div', { class: 'hm-field' },
    el('div', { class: 'sm-lab' }, el('label', { htmlFor: id }, title), tip),
    ...rest);
  const ampTip = info('amplitude', `${AMP_NOTE} ${LIMIT_NOTE} ${EQUIV_NOTE}`);
  const powTip = info('power', `${POWER_NOTE} ${POWER_EQUIV_NOTE} ${DB_NOTE}`);
  const lenTip = info('length', LENGTH_NOTE);
  const waveTip = info('waveform', WAVE_TIP);

  const waveSeg = segmented(PRIMITIVE_WAVES.map((n) => [n, el('span', { class: 'sm-wv' }, waveGlyph(n), el('span', { class: 'sm-wv-txt' }, PRIMITIVE_WAVE_TEXT[n]))]), () => params.wave, (n) => change({ wave: n }), { 'aria-labelledby': `${uid}-wvl` });
  waveSeg.group.querySelectorAll('button').forEach((b, i) => {
    b.setAttribute('aria-label', PRIMITIVE_WAVE_TEXT[PRIMITIVE_WAVES[i]]);
    b.setAttribute('title', PRIMITIVE_WAVE_TEXT[PRIMITIVE_WAVES[i]]);
  });
  const waveField = el('div', { class: 'hm-field sm-wave' },
    el('div', { class: 'sm-lab' }, el('span', { id: `${uid}-wvl`, class: 'sm-wlab' }, WAVE_LABEL), waveTip),
    waveSeg.group);
  const harm = createHarmonicsChart();
  const harmOut = el('p', { class: 'hm-cap muted t-caption' });
  const shapeNoteOut = el('p', { class: 'hm-cap muted t-caption' });
  const harmTitle = el('h3', { class: 't-subhead' }, HARM_TITLE);
  const editorTip = info('the harmonics editor', EDITOR_TIP);
  editorTip.hidden = true;

  const custom = { bars: defaultBars(), count: VISIBLE_HARMONICS, buildN: MAX_HARMONICS, playBuild: false, showEach: false };
  let soundKey = custom.bars.join(',');
  let sound = analyzeBars(custom.bars);
  let view = sound;
  let soundDirty = false;
  const hasRaf = !!env.raf || typeof globalThis.requestAnimationFrame === 'function';

  const editor = createHarmonicEditor({
    onSet: (i, v) => setBar(i, v),
    onPreset: (id) => { custom.bars = presetBars(id); customChanged(); },
    onZero: () => { custom.bars = presetBars('clear'); customChanged(); },
    onReset: () => { custom.bars = defaultBars(); custom.buildN = MAX_HARMONICS; custom.playBuild = false; custom.showEach = false; custom.count = VISIBLE_HARMONICS; customChanged(); },
    onMore: (on) => { custom.count = on ? MAX_HARMONICS : VISIBLE_HARMONICS; customChanged(); },
    onEach: (on) => { custom.showEach = on; customChanged(); },
    onBuild: (n) => { custom.buildN = Math.min(MAX_HARMONICS, Math.max(1, n)); customChanged(); },
    onPlayBuild: (on) => { custom.playBuild = on; customChanged(); },
  });
  editor.node.hidden = true;

  const stack = createStackCard(env);
  stack.node.classList.add('sm-stack');

  const node =el('section', { class: 'card hm-card sm-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('p', { class: 'hm-cap muted t-caption' }, INTRO),
    el('div', { class: 'sm-ctl' },
      waveField,
      field(`${uid}-fn`, 'Frequency (Hz)', null,el('div', { class: 'hm-freq' }, freqNum, noteOut), freqRange),
      field(`${uid}-an`, 'Amplitude (% of full scale)', ampTip, el('div', { class: 'hm-freq' }, ampNum, ampOut), ampRange),
      field(`${uid}-pn`, 'Power (sine-equivalent, % of full-scale tone)', powTip, el('div', { class: 'hm-freq' }, powNum, dbOut), powRange),
      field(`${uid}-ln`, 'Length (seconds)', lenTip, el('div', { class: 'hm-freq' }, lenNum, el('span', { class: 'hm-check' }, contBox, el('label', { htmlFor: `${uid}-cb` }, 'Continuous (until Stop)')))),
      el('div', { class: 'hm-play' }, button, stateOut)),
    el('div', { class: 'sm-scopes' },
      el('div', { class: 'hm-block' },
        el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, SCOPE_TITLE)),
        el('p', { class: 'hm-cap muted t-caption' }, SCOPE_SUB),
        el('div', { class: 'hm-view hm-wave' }, canvas),
        readoutOut,
        el('p', { class: 'hm-cap muted t-caption' }, SCOPE_NOTE),
        shapeNoteOut),
      el('div', { class: 'hm-block sm-win' },
        el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, WINDOW_TITLE), winField),
        el('p', { class: 'hm-cap muted t-caption' }, WINDOW_SUB),
        el('div', { class: 'hm-view hm-wave' }, windowCanvas),
        windowCapOut,
        manyOut),
      stack.node),
    el('div', { class: 'hm-block sm-harm' },
      el('div', { class: 'sm-lab sm-harm-head' }, harmTitle, editorTip),
      harm.svg,
      editor.node,
      harmOut),
    el('p', { class: 'sm-links' },
      el('a', { class: 'gl-link t-subhead', href: WAVE_HREF }, WAVE_LINK),
      el('a', { class: 'gl-link t-subhead', href: GLOSSARY_HREF }, GLOSSARY_LINK)));

  const active = () => doc?.activeElement;
  const shownParams = () => ({ ...params, amp: shapeLevel(params.wave, params.amp, sound.rms) });
  const isCustom = () => params.wave === CUSTOM;
  const soundBars = () => (custom.playBuild ? partialBars(custom.bars, custom.buildN) : custom.bars);
  const viewBars = () => partialBars(custom.bars, custom.buildN);

  function refreshShape() {
    const key = soundBars().join(',');
    if (key !== soundKey) { soundKey = key; sound = analyzeBars(soundBars()); }
    view = custom.playBuild || custom.buildN >= MAX_HARMONICS ? sound : analyzeBars(viewBars());
  }

  function stackState() {
    const onCustom = isCustom();
    const cut = onCustom && custom.buildN < MAX_HARMONICS;
    return {
      harmonics: onCustom ? barHarmonics(custom.bars, params.freq) : shapeHarmonics(params.wave, params.freq),
      freq: params.freq,
      partialSumN: cut ? custom.buildN : undefined,
      highlightN: cut ? custom.buildN : undefined,
    };
  }

  function customNotes() {
    const out = [];
    if (aboveLimit(params.freq, soundBars(), PLAY_LIMIT_HZ)) out.push(LIMIT_HZ_NOTE);
    if (custom.count < MAX_HARMONICS && custom.bars.slice(custom.count).some((v) => v !== 0)) out.push(HIDDEN_NOTE);
    if (!gt(sound.rms, 0)) out.push(SILENT_NOTE);
    return out;
  }

  function setValue(input, value, force) {
    if (force || active() !== input) input.value = value;
  }

  function paintOutputs(force = false) {
    const p = params;
    const note = noteInfo(p.freq);
    setValue(freqNum, String(p.freq), force);
    setValue(freqRange, String(hzToSlider(p.freq)), force);
    noteOut.textContent = note.text;
    setValue(ampNum, String(ampPercent(p.amp)), force);
    setValue(ampRange, String(ampPercent(p.amp)), force);
    ampOut.textContent = `±${fmtAmp(p.amp)} of full scale`;
    setValue(powNum, fmtPower(powerPct(p.amp)), force);
    setValue(powRange, trim(powerPct(p.amp), 1), force);
    dbOut.textContent = fmtDb(p.amp);
    setValue(lenNum, String(p.length), force);
    lenNum.disabled = p.continuous;
    contBox.checked = p.continuous;
    readoutOut.textContent = readout(p, sound.rms);
    const peak = ampPercent(shapeLevel(p.wave, p.amp, sound.rms));
    canvas.setAttribute('aria-label', `Waveform: one cycle, ${p.wave} wave, ${p.freq} Hz, peak ${peak} % of full scale; ${cycleLabels(p.freq)[0]}, at 20 °C`);
    const cyc = windowCycles(p.freq, win);
    windowCapOut.textContent = windowCaption(p.freq, win);
    manyOut.hidden = !tooManyCycles(cyc);
    windowCanvas.setAttribute('aria-label', `Waveform: time window, ${p.wave} wave, ${p.freq} Hz, peak ${peak} % of full scale, ${windowCaption(p.freq, win)}`);
    shapeNoteOut.textContent = SHAPE_NOTE[p.wave];
    const onCustom = p.wave === CUSTOM;
    harmOut.textContent = `${onCustom ? CUSTOM_HARM_TEXT : HARM_TEXT[p.wave]} ${HARM_SUM_NOTE}`;
    harmTitle.textContent = onCustom ? EDITOR_TITLE : HARM_TITLE;
    harm.svg.classList.toggle('he-gone', onCustom);
    editor.node.hidden = !onCustom;
    editorTip.hidden = !onCustom;
    if (onCustom) editor.paint({ bars: custom.bars, count: custom.count, freq: p.freq, buildN: custom.buildN, playBuild: custom.playBuild, showEach: custom.showEach, notes: customNotes() });
    else harm.paint(p.wave);
    stack.update(stackState());
    waveSeg.paint();
    winSeg.paint();
    canvas.setAttribute('title', `${cycleLabels(p.freq)[0]} (speed of sound 343 m/s at 20 °C)`);
  }

  function setWin(n) {
    if (!WINDOW_CHOICES.includes(n) || n === win) return;
    win = n;
    paintOutputs();
    paintWindow();
  }

  function playingText() {
    if (params.continuous) return 'Playing until you press Stop';
    return `Playing for ${trim(live?.length ?? params.length, 2)} s`;
  }

  function say(key) {
    state = key;
    stateOut.textContent = key === 'playing' ? playingText() : TEXT[key];
    stateOut.classList.toggle('error', key === 'unsupported' || key === 'failed');
  }

  function paintButton() {
    const playing = !!live && !live.stopping;
    label.textContent = playing ? 'Stop' : 'Play';
    button.classList.toggle('primary', !playing);
    button.classList.toggle('outline', playing);
    toggleIcon.replaceChildren(icon(playing ? 'clear' : 'play', 'action'));
  }

  function currentColors() {
    const t = now();
    if (!colors || t - colorsAt > 500) { colors = readColors(node); colorsAt = t; }
    return colors;
  }

  function paintScope() {
    if (gone) return;
    const g = fit(canvas);
    if (!g) return;
    const c = currentColors();
    const points = Math.max(64, Math.round(g.w * 2));
    const shown = shownParams();
    const opts = { ticks: scopeTicks(cycles, params.freq) };
    if (isCustom() && custom.showEach) {
      opts.extras = strongest(viewBars()).map((e) => componentSeries(e, view.scale * shown.amp, points, cycles));
    }
    if (live && !isCustom()) {
      live.analyser.getFloatTimeDomainData(live.buf);
      const lw = liveWindow(live.buf, live.ctx.sampleRate, params.freq, cycles, points);
      drawScope(g, c, lw.samples, lw.need, shown, opts);
    } else {
      drawScope(g, c, scopeSeries(shown.amp, points, cycles, params.wave, view.table), points, shown, opts);
    }
  }

  function paintWindow() {
    if (gone) return;
    const g = fit(windowCanvas);
    if (!g) return;
    const cyc = windowCycles(params.freq, win);
    const points = windowPoints(g.w, cyc);
    const shown = shownParams();
    drawScope(g, currentColors(), scopeSeries(shown.amp, points, cyc, params.wave, view.table), points, shown, { ticks: windowTicks(win), bracket: false });
  }

  function paintAll() {
    paintScope();
    paintWindow();
  }

  function schedule() {
    looping = true;
    frame = raf(tick);
  }

  function tick() {
    looping = false;
    frame = 0;
    if (gone) return;
    if (soundDirty) { soundDirty = false; applyLive(); }
    paintScope();
    if (live) schedule();
  }

  function syncLoop() {
    const want = !gone && !!live;
    if (want && !looping) {
      schedule();
    } else if (!want && looping) {
      looping = false;
      caf(frame);
      frame = 0;
    }
  }

  function listen(target, type, fn) {
    target?.addEventListener?.(type, fn);
    off.push(() => target?.removeEventListener?.(type, fn));
  }

  function teardown(s) {
    clearTimeout(s.safety);
    clearTimeout(s.fallback);
    for (const v of s.voices) {
      v.osc.onended = null;
      try { v.osc.disconnect(); v.vg.disconnect(); } catch { /* already gone */ }
      try { v.osc.stop(); } catch { /* already stopped */ }
    }
    try { s.gain.disconnect(); s.analyser.disconnect(); } catch { /* already gone */ }
    Promise.resolve(s.ctx.close?.()).catch(() => {});
    if (live === s) {
      live = null;
      syncLoop();
      while (off.length) off.pop()();
    }
  }

  function finish(s, key) {
    if (s !== live) { teardown(s); return; }
    teardown(s);
    if (gone) return;
    say(key);
    paintButton();
    paintAll();
  }

  function stop(key = 'stopped', hard = false) {
    const s = live;
    if (!s) return;
    if (hard || gone || s.stopping) { finish(s, key); return; }
    s.stopping = true;
    const { ctx, gain } = s;
    const t = ctx.currentTime;
    const cur = Number.isFinite(gain.gain.value) ? gain.gain.value : s.amp;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(cur, t);
    gain.gain.linearRampToValueAtTime(0, t + FADE_S);
    for (const v of s.voices) {
      try { v.osc.stop(t + FADE_S); } catch { /* already stopped */ }
    }
    s.voice.osc.onended = () => finish(s, key);
    clearTimeout(s.fallback);
    s.fallback = setTimeout(() => finish(s, key), FADE_S * 1000 + 250);
    say(key);
    paintButton();
  }

  function makeWave(ctx) {
    const { real, imag } = periodicCoefficients(soundBars(), sound.scale, MAX_HARMONICS);
    return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
  }

  function addVoice(s, vg, type) {
    const osc = s.ctx.createOscillator();
    if (type === CUSTOM) osc.setPeriodicWave(makeWave(s.ctx)); else osc.type = type;
    osc.frequency.value = params.freq;
    osc.connect(vg);
    vg.connect(s.gain);
    const voice = { osc, vg };
    s.voices.push(voice);
    return voice;
  }

  function crossfade(s, t) {
    const old = s.voice;
    const vg = s.ctx.createGain();
    vg.gain.value = 0;
    const next = addVoice(s, vg, params.wave);
    const cur = Number.isFinite(old.vg.gain.value) ? old.vg.gain.value : 1;
    old.vg.gain.cancelScheduledValues(t);
    old.vg.gain.setValueAtTime(cur, t);
    old.vg.gain.linearRampToValueAtTime(0, t + FADE_S);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(1, t + FADE_S);
    next.osc.onended = old.osc.onended;
    old.osc.onended = () => {
      s.voices = s.voices.filter((v) => v !== old);
      try { old.osc.disconnect(); old.vg.disconnect(); } catch { /* already gone */ }
    };
    next.osc.start(t);
    if (s.endT != null) next.osc.stop(s.endT);
    try { old.osc.stop(t + FADE_S); } catch { /* already stopped */ }
    s.voice = next;
    s.wave = params.wave;
    s.shape = sound;
  }

  function start() {
    if (gone) return;
    if (live) finish(live, 'idle');
    if (!Ctx) { say('unsupported'); return; }
    let s = null;
    let ctx = null;
    try {
      ctx = new Ctx();
      const voiceGain = ctx.createGain();
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      const level = oscGain(params.wave, params.amp, sound.rms);
      s = { ctx, voice: null, voices: [], gain, analyser, buf: null, amp: level, wave: params.wave, shape: sound, length: params.length, endT: null, stopping: false, safety: 0, fallback: 0 };
      voiceGain.gain.value = 1;
      s.voice = addVoice(s, voiceGain, params.wave);
      analyser.fftSize = FFT_SIZE;
      s.buf = new Float32Array(analyser.fftSize);
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + FADE_S);
      s.voice.osc.onended = () => finish(s, 'done');
      s.voice.osc.start(t);
      if (!params.continuous) {
        s.endT = t + params.length;
        gain.gain.setValueAtTime(level, s.endT - FADE_S);
        gain.gain.linearRampToValueAtTime(0, s.endT);
        s.voice.osc.stop(s.endT);
        s.fallback = setTimeout(() => { if (live === s) stop('done', true); }, params.length * 1000 + 500);
      }
      if (ctx.state === 'suspended') Promise.resolve(ctx.resume?.()).catch(() => {});
    } catch (ex) {
      if (s) teardown(s); else Promise.resolve(ctx?.close?.()).catch(() => {});
      say(ex?.name === 'NotSupportedError' ? 'unsupported' : 'failed');
      return;
    }
    live = s;
    s.safety = setTimeout(() => finish(s, 'timeout'), MAX_RUN_MS);
    listen(doc, 'visibilitychange', () => { if (doc.hidden) stop('hidden', true); });
    say('playing');
    paintButton();
    syncLoop();
  }

  function applyLive() {
    const s = live;
    if (!s || s.stopping) return;
    const t = s.ctx.currentTime;
    s.voice.osc.frequency.setTargetAtTime(params.freq, t, SMOOTH_S);
    if (s.endT != null && s.endT - t < 0.1) return;
    if (params.wave !== s.wave) {
      crossfade(s, t);
    } else if (params.wave === CUSTOM && s.shape !== sound) {
      if (maxJump(s.shape.table, sound.table) <= SMALL_JUMP) {
        s.voice.osc.setPeriodicWave(makeWave(s.ctx));
        s.shape = sound;
      } else {
        crossfade(s, t);
      }
    }
    const level = oscGain(params.wave, params.amp, sound.rms);
    if (level === s.amp) return;
    const cur = Number.isFinite(s.gain.gain.value) ? s.gain.gain.value : s.amp;
    s.gain.gain.cancelScheduledValues(t);
    s.gain.gain.setValueAtTime(cur, t);
    s.gain.gain.setTargetAtTime(level, t, SMOOTH_S);
    if (s.endT != null) {
      s.gain.gain.setValueAtTime(level, s.endT - FADE_S);
      s.gain.gain.linearRampToValueAtTime(0, s.endT);
    }
    s.amp = level;
  }

  function change(next) {
    params = clampParams({ ...params, ...next });
    paintOutputs();
    applyLive();
    paintWindow();
    if (!looping) paintScope();
  }

  function customChanged() {
    refreshShape();
    paintOutputs();
    paintWindow();
    paintScope();
    if (!live || !isCustom()) return;
    if (hasRaf && looping) soundDirty = true; else applyLive();
  }

  function setBar(i, value) {
    if (!(i >= 0 && i < MAX_HARMONICS)) return;
    const v = Number.isFinite(value) ? snapBar(value, true) : 0;
    if (custom.bars[i] === v) return;
    custom.bars = custom.bars.slice();
    custom.bars[i] = v;
    customChanged();
  }

  function applyHash() {
    const w = waveFromHash(globalThis.location?.hash);
    if (w && w !== params.wave) change({ wave: w });
  }

  const typed = (input, apply) => {
    input.addEventListener('input', () => { const v = Number.parseFloat(input.value); if (Number.isFinite(v)) apply(v); });
    input.addEventListener('change', () => paintOutputs(true));
  };
  typed(freqNum, (v) => change({ freq: v }));
  typed(freqRange, (v) => change({ freq: sliderToHz(v) }));
  typed(ampNum, (v) => change({ amp: v / 100 }));
  typed(ampRange, (v) => change({ amp: v / 100 }));
  typed(powNum, (v) => change({ amp: ampOfPower(v) }));
  typed(powRange, (v) => change({ amp: ampOfPower(v) }));
  typed(lenNum, (v) => change({ length: v }));
  contBox.addEventListener('change', () => change({ continuous: contBox.checked }));

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (gone) return;
      paintWindow();
      if (!looping) paintScope();
    });
    ro.observe(node);
  }

  globalThis.addEventListener?.('hashchange', applyHash);
  const startWave = waveFromHash(globalThis.location?.hash);
  if (startWave) params = clampParams({ ...params, wave: startWave });
  paintOutputs(true);
  paintButton();
  if (typeof requestAnimationFrame === 'function') raf(() => { if (!gone && !looping) paintAll(); });

  return {
    node,
    get running() { return !!live && !live.stopping; },
    get state() { return state; },
    get params() { return { ...params }; },
    get window() { return win; },
    get custom() { return { ...custom, bars: custom.bars.slice() }; },
    get sound() { return sound; },
    setBar,
    setPreset: (id) => { custom.bars = presetBars(id); customChanged(); },
    setWindow: setWin,
    start,
    stop: () => stop('stopped'),
    change,
    dispose() {
      gone = true;
      globalThis.removeEventListener?.('hashchange', applyHash);
      for (const d of detach) d();
      ro?.disconnect();
      stack.dispose();
      syncLoop();
      if (live) teardown(live);
    },
  };
}

export function mountSimple(panel, env = {}) {
  const card = createSimpleCard(env);
  panel.replaceChildren(card.node);
  return () => card.dispose();
}
