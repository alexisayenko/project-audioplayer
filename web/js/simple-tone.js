import { el } from './dom.js';
import { icon } from './icons.js';
import { segmented } from './segmented.js';

export const TITLE = 'Primitive';
export const INTRO = 'A primitive sound: one sine wave, one frequency, H1 only. It models a speaker cone driven by an electrical signal. Set the four numbers, press Play.';
export const MIN_HZ = 20;
export const MAX_HZ = 20000;
export const MAX_AMP = 0.8;
export const MAX_POWER_PCT = 64;
export const MIN_LEN = 0.1;
export const MAX_LEN = 30;
export const DEFAULTS = { freq: 440, amp: 0.3, length: 2, continuous: false };
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
export const WAVE_LINK = 'See how a speaker makes a sound wave in the Glossary →';
export const WAVE_HREF = '#/glossary/sound-wave';
export const GLOSSARY_LINK = 'Terms: see the Glossary →';
export const GLOSSARY_HREF = '#/glossary';
export const SINE_NOTE = 'One sine wave = one frequency = H1 only.';
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

export function clampParams(p = {}) {
  return {
    freq: clamp(num(p.freq, DEFAULTS.freq), MIN_HZ, MAX_HZ),
    amp: clamp(num(p.amp, DEFAULTS.amp), 0, MAX_AMP),
    length: clamp(num(p.length, DEFAULTS.length), MIN_LEN, MAX_LEN),
    continuous: !!p.continuous,
  };
}

export function sliderToHz(pos) {
  const f = MIN_HZ * (MAX_HZ / MIN_HZ) ** (clamp(pos, 0, 1000) / 1000);
  return f < 100 ? Math.round(f * 10) / 10 : Math.round(f);
}

export function hzToSlider(f) {
  return Math.round((1000 * Math.log(clamp(f, MIN_HZ, MAX_HZ) / MIN_HZ)) / Math.log(MAX_HZ / MIN_HZ));
}

export function noteInfo(freq) {
  if (!(freq > 0)) return { name: '-', cents: 0, text: '-' };
  const exact = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(exact);
  const cents = Math.round((exact - midi) * 100);
  const name = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return { name, cents, text: `${name} ${cents >= 0 ? '+' : '-'}${Math.abs(cents)} cents` };
}

export const powerPct = (amp) => amp * amp * 100;

export const ampOfPower = (pct) => Math.sqrt(clamp(num(pct, 0), 0, MAX_POWER_PCT) / 100);

export const dbfs = (amp) => (amp > 0 ? 20 * Math.log10(amp) : -Infinity);

export const fmtDb = (amp) => (amp > 0 ? `${dbfs(amp).toFixed(1)} dBFS` : 'silence');

export const fmtPct = (v) => trim(v, 2);

export const periodMs = (freq) => 1000 / freq;

export const fmtMs = (ms) => String(+ms.toPrecision(3));

export function readout(p) {
  const lasts = p.continuous ? 'until you press Stop' : `${trim(p.length, 2)} s`;
  return `Period ${fmtMs(periodMs(p.freq))} ms = 1/f; pressure swings ±${fmtPct(p.amp * 100)} % of full scale; power ${fmtPct(powerPct(p.amp))} %; sound lasts ${lasts}.`;
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
  return all[all.length - 1];
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

export function scopeSeries(amp, points, cycles = CYCLES) {
  const out = new Array(points);
  for (let i = 0; i < points; i += 1) out[i] = amp * Math.sin(2 * Math.PI * cycles * (i / (points - 1)));
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

function readColors(node) {
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

function drawScope(g, colors, series, need, p, view) {
  const { ctx, w, h } = g;
  const { ticks, bracket = true } = view;
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
    ctx.textAlign = t.frac === 0 ? 'left' : t.frac >= 1 ? 'right' : 'center';
    ctx.fillText(`${fmtMs(t.ms)} ms`, x, h - bottom + 3);
  }
  if (p.amp > 0) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = colors.fill;
    ctx.setLineDash?.([4, 3]);
    for (const sign of [1, -1]) {
      const y = mid - sign * p.amp * scale;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }
    ctx.restore();
  }
  const n = series.length;
  if (n >= 2) {
    const step = Math.max(1, Math.floor(n / (plotW * 2)));
    ctx.strokeStyle = colors.fill;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      const x = left + (i / (need - 1)) * plotW;
      const y = mid - clamp(series[i], -1.2, 1.2) * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
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
  const ampNum = el('input', { id: `${uid}-an`, class: 'hm-num', type: 'number', min: '0', max: String(MAX_AMP * 100), step: 'any', inputmode: 'decimal', 'aria-describedby': `${uid}-ad` });
  const ampRange = el('input', { id: `${uid}-ar`, class: 'slider hm-range', type: 'range', min: '0', max: String(MAX_AMP * 100), step: '0.1', 'aria-label': 'Amplitude slider' });
  const ampOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-an ${uid}-ar` });
  const powNum = el('input', { id: `${uid}-pn`, class: 'hm-num', type: 'number', min: '0', max: String(MAX_POWER_PCT), step: 'any', inputmode: 'decimal', 'aria-describedby': `${uid}-pd` });
  const powRange = el('input', { id: `${uid}-pr`, class: 'slider hm-range', type: 'range', min: '0', max: String(MAX_POWER_PCT), step: '0.1', 'aria-label': 'Power slider' });
  const dbOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-pn ${uid}-pr ${uid}-an ${uid}-ar` });
  const lenNum = el('input', { id: `${uid}-ln`, class: 'hm-num', type: 'number', min: MIN_LEN, max: MAX_LEN, step: '0.1', inputmode: 'decimal', value: String(params.length), 'aria-describedby': `${uid}-ld` });
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

  const info = (id, about, text) => {
    const note = el('p', { id, class: 'hm-cap muted t-caption', hidden: true }, text);
    const btn = el('button', {
      class: 'sm-info',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': id,
      'aria-label': `About ${about}`,
      onclick: () => {
        note.hidden = !note.hidden;
        btn.setAttribute('aria-expanded', String(!note.hidden));
      },
    }, 'i');
    return { btn, note };
  };
  const field = (id, title, tip, ...rest) => el('div', { class: 'hm-field' },
    el('div', { class: 'sm-lab' }, el('label', { htmlFor: id }, title), tip?.btn ?? null),
    ...rest,
    tip?.note ?? null);
  const ampTip = info(`${uid}-ad`, 'amplitude', `${AMP_NOTE} ${LIMIT_NOTE}`);
  const powTip = info(`${uid}-pd`, 'power', `${POWER_NOTE} ${DB_NOTE}`);
  const lenTip = info(`${uid}-ld`, 'length', LENGTH_NOTE);

  const node = el('section', { class: 'card hm-card sm-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('p', { class: 'hm-cap muted t-caption' }, INTRO),
    el('div', { class: 'sm-ctl' },
      field(`${uid}-fn`, 'Frequency (Hz)', null, el('div', { class: 'hm-freq' }, freqNum, noteOut), freqRange),
      field(`${uid}-an`, 'Amplitude (% of full scale)', ampTip, el('div', { class: 'hm-freq' }, ampNum, ampOut), ampRange),
      field(`${uid}-pn`, 'Power (% of full-scale tone)', powTip, el('div', { class: 'hm-freq' }, powNum, dbOut), powRange),
      field(`${uid}-ln`, 'Length (seconds)', lenTip, el('div', { class: 'hm-freq' }, lenNum, el('span', { class: 'hm-check' }, contBox, el('label', { htmlFor: `${uid}-cb` }, 'Continuous (until Stop)')))),
      el('div', { class: 'hm-play' }, button, stateOut)),
    el('div', { class: 'sm-scopes' },
      el('div', { class: 'hm-block' },
        el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, SCOPE_TITLE)),
        el('p', { class: 'hm-cap muted t-caption' }, SCOPE_SUB),
        el('div', { class: 'hm-view hm-wave' }, canvas),
        readoutOut,
        el('p', { class: 'hm-cap muted t-caption' }, `${SCOPE_NOTE} ${SINE_NOTE}`)),
      el('div', { class: 'hm-block' },
        el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, WINDOW_TITLE), winField),
        el('p', { class: 'hm-cap muted t-caption' }, WINDOW_SUB),
        el('div', { class: 'hm-view hm-wave' }, windowCanvas),
        windowCapOut,
        manyOut)),
    el('p', { class: 'sm-links' },
      el('a', { class: 'gl-link t-subhead', href: WAVE_HREF }, WAVE_LINK),
      el('a', { class: 'gl-link t-subhead', href: GLOSSARY_HREF }, GLOSSARY_LINK)));

  const active = () => doc?.activeElement;

  function setValue(input, value, force) {
    if (force || active() !== input) input.value = value;
  }

  function paintOutputs(force = false) {
    const p = params;
    const note = noteInfo(p.freq);
    setValue(freqNum, String(p.freq), force);
    setValue(freqRange, String(hzToSlider(p.freq)), force);
    noteOut.textContent = note.text;
    setValue(ampNum, fmtPct(p.amp * 100), force);
    setValue(ampRange, fmtPct(p.amp * 100), force);
    ampOut.textContent = `±${trim(p.amp, 3)} of full scale`;
    setValue(powNum, fmtPct(powerPct(p.amp)), force);
    setValue(powRange, fmtPct(powerPct(p.amp)), force);
    dbOut.textContent = fmtDb(p.amp);
    setValue(lenNum, String(p.length), force);
    lenNum.disabled = p.continuous;
    contBox.checked = p.continuous;
    readoutOut.textContent = readout(p);
    canvas.setAttribute('aria-label', `Waveform: one cycle, sine wave, ${p.freq} Hz, amplitude ${fmtPct(p.amp * 100)} % of full scale; ${cycleLabels(p.freq)[0]}, at 20 °C`);
    const cyc = windowCycles(p.freq, win);
    windowCapOut.textContent = windowCaption(p.freq, win);
    manyOut.hidden = !tooManyCycles(cyc);
    windowCanvas.setAttribute('aria-label', `Waveform: time window, sine wave, ${p.freq} Hz, amplitude ${fmtPct(p.amp * 100)} % of full scale, ${windowCaption(p.freq, win)}`);
    winSeg.paint();
    canvas.setAttribute('title', `${cycleLabels(p.freq)[0]} (speed of sound 343 m/s at 20 °C)`);
  }

  function setWin(n) {
    if (!WINDOW_CHOICES.includes(n) || n === win) return;
    win = n;
    paintOutputs();
    paintWindow();
  }

  function say(key) {
    state = key;
    stateOut.textContent = key === 'playing' ? (params.continuous ? 'Playing until you press Stop' : `Playing for ${trim(live?.length ?? params.length, 2)} s`) : TEXT[key];
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
    const view = { ticks: scopeTicks(cycles, params.freq) };
    if (live) {
      live.analyser.getFloatTimeDomainData(live.buf);
      const lw = liveWindow(live.buf, live.ctx.sampleRate, params.freq, cycles, points);
      drawScope(g, c, lw.samples, lw.need, params, view);
    } else {
      drawScope(g, c, scopeSeries(params.amp, points, cycles), points, params, view);
    }
  }

  function paintWindow() {
    if (gone) return;
    const g = fit(windowCanvas);
    if (!g) return;
    const cyc = windowCycles(params.freq, win);
    const points = windowPoints(g.w, cyc);
    drawScope(g, currentColors(), scopeSeries(params.amp, points, cyc), points, params, { ticks: windowTicks(win), bracket: false });
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
    s.osc.onended = null;
    try { s.osc.disconnect(); s.gain.disconnect(); s.analyser.disconnect(); } catch { /* already gone */ }
    try { s.osc.stop(); } catch { /* already stopped */ }
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
    const { ctx, gain, osc } = s;
    const t = ctx.currentTime;
    const cur = Number.isFinite(gain.gain.value) ? gain.gain.value : s.amp;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(cur, t);
    gain.gain.linearRampToValueAtTime(0, t + FADE_S);
    try { osc.stop(t + FADE_S); } catch { /* already stopped */ }
    osc.onended = () => finish(s, key);
    clearTimeout(s.fallback);
    s.fallback = setTimeout(() => finish(s, key), FADE_S * 1000 + 250);
    say(key);
    paintButton();
  }

  function start() {
    if (gone) return;
    if (live) finish(live, 'idle');
    if (!Ctx) { say('unsupported'); return; }
    let s = null;
    let ctx = null;
    try {
      ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      s = { ctx, osc, gain, analyser, buf: null, amp: params.amp, length: params.length, endT: null, stopping: false, safety: 0, fallback: 0 };
      osc.type = 'sine';
      osc.frequency.value = params.freq;
      analyser.fftSize = FFT_SIZE;
      s.buf = new Float32Array(analyser.fftSize);
      osc.connect(gain);
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(params.amp, t + FADE_S);
      osc.onended = () => finish(s, 'done');
      osc.start(t);
      if (!params.continuous) {
        s.endT = t + params.length;
        gain.gain.setValueAtTime(params.amp, s.endT - FADE_S);
        gain.gain.linearRampToValueAtTime(0, s.endT);
        osc.stop(s.endT);
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

  function applyLive(ampChanged) {
    const s = live;
    if (!s || s.stopping) return;
    const t = s.ctx.currentTime;
    s.osc.frequency.setTargetAtTime(params.freq, t, SMOOTH_S);
    if (!ampChanged) return;
    if (s.endT != null && s.endT - t < 0.1) return;
    const cur = Number.isFinite(s.gain.gain.value) ? s.gain.gain.value : s.amp;
    s.gain.gain.cancelScheduledValues(t);
    s.gain.gain.setValueAtTime(cur, t);
    s.gain.gain.setTargetAtTime(params.amp, t, SMOOTH_S);
    if (s.endT != null) {
      s.gain.gain.setValueAtTime(params.amp, s.endT - FADE_S);
      s.gain.gain.linearRampToValueAtTime(0, s.endT);
    }
    s.amp = params.amp;
  }

  function change(next) {
    const before = params.amp;
    params = clampParams({ ...params, ...next });
    paintOutputs();
    applyLive(params.amp !== before);
    paintWindow();
    if (!looping) paintScope();
  }

  const typed = (input, apply) => {
    input.addEventListener('input', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) apply(v); });
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

  paintOutputs(true);
  paintButton();
  if (typeof requestAnimationFrame === 'function') raf(() => { if (!gone && !looping) paintAll(); });

  return {
    node,
    get running() { return !!live && !live.stopping; },
    get state() { return state; },
    get params() { return { ...params }; },
    get window() { return win; },
    setWindow: setWin,
    start,
    stop: () => stop('stopped'),
    change,
    dispose() {
      gone = true;
      ro?.disconnect();
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
