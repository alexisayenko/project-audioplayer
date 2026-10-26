import { el } from './dom.js';
import { icon } from './icons.js';
import { attachInfo } from './info-popover.js';
import {
  MAX_AMP, FADE_S, SMOOTH_S, MAX_RUN_MS, LIMIT_NOTE, LENGTH_NOTE, TEXT, MIN_LEN, MAX_LEN,
  GLOSSARY_LINK, GLOSSARY_HREF, trim, fmtMs, noteInfo, roundAmp, ampPercent, fmtAmp, fit, readColors, drawScope,
} from './simple-tone.js';

export const TITLE = 'Clicks to tone';
export const INTRO = 'A repeating click: slow it is a beat, fast it becomes a tone.';
export const MIN_RATE = 1;
export const MAX_RATE = 1000;
export const DEFAULTS = { rate: 2, amp: 0.3, length: 2, continuous: true };
export const RHYTHM_MAX = 5;
export const FAST_MAX = 15;
export const BORDER_MAX = 30;
export const INFRA_HZ = 20;
export const MIN_NOTE_HZ = 27.5;
export const TONE_ENTER = 25;
export const TONE_LEAVE = 22;
export const XFADE_TC = 0.008;
export const LOOKAHEAD_S = 0.1;
export const PUMP_MS = 25;
export const CLICK_MS = 2;
export const CLICK_TAU_MS = 0.4;
export const CLICK_TAIL = 0.5;
export const MAX_HARMONICS = 2048;
export const BAND_FRAC = 0.45;
export const HARMONICS = 16;
export const PERIODS = 8;
export const WINDOW_MIN_MS = 5;
export const WINDOW_MAX_MS = 4000;
export const WAVE_TITLE = 'Waveform: clicks over time';
export const WAVE_SUB = 'Each spike is one click: time across, amplitude up.';
export const HARM_TITLE = 'Harmonics of the click train';
export const HARM_TITLE_INFRA = 'Frequencies in the rhythm (infrasound: below hearing)';
export const HARM_SUB = 'The first 16 harmonics: H1 is the click rate, H2 twice the rate, and so on. Bar height is strength.';
export const HARM_NOTE = 'A click train contains every harmonic of its rate at equal strength: that is why it sounds bright and buzzy. Rhythm and pitch are the same repetition at different speeds.';
export const RATE_NOTE = 'A click is a very short, sharp sound. The rate is how many come each second. Slow, you hear a beat; fast, the ear fuses the clicks into a tone whose pitch equals the rate. 1 click per second = 60 BPM = 1 Hz.';
export const AMP_NOTE = 'How tall each click is: its peak, as a share of full scale.';
export const CLICK_HREF = '#/glossary/click-train';
export const CLICK_LINK = 'What is a click train? See the Glossary →';
export const REGIMES = {
  rhythm: 'Rhythm: separate beats',
  fast: 'Fast pulses: you can still count them',
  border: 'The border: flutter and roughness, the beats start to fuse into a tone',
};
export const PRESETS = [
  { label: '120 BPM (2/s)', rate: 2 },
  { label: '600 BPM (10/s)', rate: 10 },
  { label: '1000 BPM (16.7/s, Moby Thousand)', rate: 1000 / 60 },
  { label: '1200 BPM (20/s)', rate: 20 },
  { label: '100 Hz', rate: 100 },
  { label: 'A4 440 Hz', rate: 440 },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export const clampRate = (rate) => Math.round(clamp(num(rate, DEFAULTS.rate), MIN_RATE, MAX_RATE) * 1e4) / 1e4;

export function clampParams(p = {}) {
  return {
    rate: clampRate(p.rate),
    amp: roundAmp(p.amp === undefined ? DEFAULTS.amp : p.amp),
    length: clamp(num(p.length, DEFAULTS.length), MIN_LEN, MAX_LEN),
    continuous: p.continuous === undefined ? DEFAULTS.continuous : !!p.continuous,
  };
}

export function sliderToRate(pos) {
  const r = MAX_RATE ** (clamp(num(pos, 0), 0, 1000) / 1000);
  return r < 100 ? Math.round(r * 10) / 10 : Math.round(r);
}

export const rateToSlider = (rate) => Math.round((1000 * Math.log(clamp(num(rate, MIN_RATE), MIN_RATE, MAX_RATE))) / Math.log(MAX_RATE));

export const bpmOf = (rate) => rate * 60;

export const fmtRate = (rate) => trim(rate, 1);

export const fmtBpm = (bpm) => (bpm > 200 ? String(Math.round(bpm)) : trim(bpm, 1));

export function rateReadout(rate) {
  const n = fmtRate(rate);
  return `${n} ${n === '1' ? 'click' : 'clicks'} per second = ${fmtBpm(bpmOf(rate))} BPM = ${n} Hz`;
}

export function regimeOf(rate) {
  if (rate < RHYTHM_MAX) return 'rhythm';
  if (rate < FAST_MAX) return 'fast';
  return rate <= BORDER_MAX ? 'border' : 'tone';
}

export function regimeText(rate) {
  const key = regimeOf(rate);
  if (key !== 'tone') return REGIMES[key];
  const note = rate >= MIN_NOTE_HZ ? ` (${noteInfo(rate).text})` : '';
  return `Tone: you hear a pitch of ${fmtRate(rate)} Hz${note}`;
}

export const isInfrasound = (rate) => rate < INFRA_HZ;

export const harmonicsTitle = (rate) => (isInfrasound(rate) ? HARM_TITLE_INFRA : HARM_TITLE);

export function modeFor(rate, current = null) {
  if (current === 'tone') return rate < TONE_LEAVE ? 'rhythm' : 'tone';
  return rate >= TONE_ENTER ? 'tone' : 'rhythm';
}

export function harmonicCount(rate, sampleRate = 48000) {
  const exact = Math.max(1, Math.min(MAX_HARMONICS, Math.floor((BAND_FRAC * sampleRate) / rate)));
  return Math.max(1, Math.floor(2 ** (Math.floor(2 * Math.log2(exact)) / 2) + 1e-9));
}

export function windowMs(rate) {
  return clamp((PERIODS * 1000) / rate, WINDOW_MIN_MS, WINDOW_MAX_MS);
}

export const windowPeriods = (rate) => (windowMs(rate) * rate) / 1000;

export const clicksInWindow = (rate) => Math.max(0, Math.ceil(windowPeriods(rate) - 0.5));

export const fmtSpan = (ms) => (ms >= 1000 ? `${trim(ms / 1000, 2)} s` : `${fmtMs(ms)} ms`);

export function windowCaption(rate) {
  const n = clicksInWindow(rate);
  return `${n} ${n === 1 ? 'click' : 'clicks'} in ${fmtSpan(windowMs(rate))}`;
}

export function windowTicks(ms) {
  return Array.from({ length: 5 }, (_, k) => ({ frac: k / 4, ms: (k * ms) / 4 }));
}

export function clickSeries(amp, points, periods) {
  const out = new Array(points).fill(0);
  for (let k = 0; k + 0.5 < periods; k += 1) {
    const i = Math.round(((k + 0.5) / periods) * (points - 1));
    out[i] = amp;
  }
  return out;
}

export function harmonicRows(rate, count = HARMONICS) {
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, hz: rate * (i + 1), level: 1 }));
}

export function fmtHz(hz) {
  return hz >= 1000 ? `${trim(hz / 1000, 1)} kHz` : `${+hz.toPrecision(3)} Hz`;
}

export function clickBurst(sampleRate) {
  const len = Math.max(2, Math.round((CLICK_MS / 1000) * sampleRate));
  const tau = (CLICK_TAU_MS / 1000) * sampleRate;
  const out = new Float32Array(len);
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = Math.imul(seed + 0x6d2b79f5, 1);
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  out[0] = 1;
  for (let i = 1; i < len; i += 1) out[i] = (2 * rnd() - 1) * CLICK_TAIL * Math.exp(-i / tau);
  return out;
}

export function harmonicLabelSteps(pitch) {
  const names = Math.max(1, Math.ceil(26 / pitch));
  return { names, hz: names * Math.max(1, Math.ceil(54 / (pitch * names))) };
}

function release(p) {
  try { p.src.stop(); } catch { /* not started */ }
  try { p.src.disconnect(); } catch { /* gone */ }
}

export function createClickEngine(ctx, { destination = ctx.destination, rate = DEFAULTS.rate, amp = DEFAULTS.amp, fade = FADE_S } = {}) {
  const sr = ctx.sampleRate;
  const master = ctx.createGain();
  const toneGain = ctx.createGain();
  const clickGain = ctx.createGain();
  const osc = ctx.createOscillator();
  const burst = clickBurst(sr);
  const buffer = ctx.createBuffer(1, burst.length, sr);
  buffer.copyToChannel(burst, 0);
  const waves = new Map();
  let cur = clampRate(rate);
  let mode = modeFor(cur, null);
  let harmonics = 0;
  let ampNow = amp;
  let pending = [];
  let next = Infinity;
  let last = -Infinity;
  let endT = Infinity;
  let started = false;
  let stopped = false;

  osc.connect(toneGain);
  toneGain.connect(master);
  clickGain.connect(master);
  master.connect(destination);
  toneGain.gain.value = mode === 'tone' ? 1 : 0;
  clickGain.gain.value = mode === 'rhythm' ? 1 : 0;
  master.gain.value = 0;

  function wave(k) {
    let w = waves.get(k);
    if (!w) {
      const real = new Float32Array(k + 1);
      real.fill(1 / k, 1);
      w = ctx.createPeriodicWave(real, new Float32Array(k + 1), { disableNormalization: true });
      waves.set(k, w);
    }
    return w;
  }

  function shape() {
    const k = harmonicCount(cur, sr);
    if (k === harmonics) return;
    harmonics = k;
    osc.setPeriodicWave(wave(k));
  }

  function retime() {
    const now = ctx.currentTime;
    const keep = [];
    for (const p of pending) {
      if (p.t > now + 0.003) release(p); else keep.push(p);
    }
    pending = keep;
    last = keep.reduce((m, p) => Math.max(m, p.t), last <= now + 0.003 ? last : -Infinity);
    next = Math.max(last + 1 / cur, now + 0.005);
  }

  function schedule(t) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(clickGain);
    src.start(t);
    pending.push({ src, t });
  }

  function pump(horizon = ctx.currentTime + LOOKAHEAD_S) {
    const now = ctx.currentTime;
    const old = pending.filter((p) => p.t < now - 0.05);
    if (old.length) {
      for (const p of old) { try { p.src.disconnect(); } catch { /* gone */ } }
      pending = pending.filter((p) => p.t >= now - 0.05);
    }
    if (!started || stopped || mode !== 'rhythm') return;
    const period = 1 / cur;
    if (next < now) next += Math.ceil((now - next) / period) * period;
    while (next < horizon && next < endT) {
      schedule(next);
      last = next;
      next += 1 / cur;
    }
  }

  function setRate(r) {
    const t = ctx.currentTime;
    cur = clampRate(r);
    shape();
    osc.frequency.cancelScheduledValues(t);
    osc.frequency.setTargetAtTime(cur, t, SMOOTH_S);
    const want = modeFor(cur, mode);
    if (want !== mode) {
      mode = want;
      toneGain.gain.setTargetAtTime(mode === 'tone' ? 1 : 0, t, XFADE_TC);
      clickGain.gain.setTargetAtTime(mode === 'rhythm' ? 1 : 0, t, XFADE_TC);
      if (mode === 'rhythm') next = Math.max(t + 0.02, last + 1 / cur);
    } else if (mode === 'rhythm' && started) {
      retime();
    }
  }

  function setAmp(a) {
    if (stopped) return;
    const t = ctx.currentTime;
    if (endT - t < 0.1) return;
    const now = Number.isFinite(master.gain.value) ? master.gain.value : ampNow;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(now, t);
    master.gain.setTargetAtTime(a, t, SMOOTH_S);
    if (endT !== Infinity) {
      master.gain.setValueAtTime(a, endT - fade);
      master.gain.linearRampToValueAtTime(0, endT);
    }
    ampNow = a;
  }

  function start(t = ctx.currentTime) {
    shape();
    osc.frequency.setValueAtTime(cur, t);
    master.gain.setValueAtTime(fade > 0 ? 0 : amp, t);
    if (fade > 0) master.gain.linearRampToValueAtTime(amp, t + fade);
    osc.start(t);
    started = true;
    ampNow = amp;
    next = t + fade;
    pump();
  }

  function setEnd(t) {
    endT = t;
    master.gain.cancelScheduledValues(Math.max(0, t - fade));
    master.gain.setValueAtTime(ampNow, t - fade);
    master.gain.linearRampToValueAtTime(0, t);
    try { osc.stop(t); } catch { /* already stopped */ }
    for (const p of pending) if (p.t >= t) release(p);
    pending = pending.filter((p) => p.t < t);
  }

  function stop() {
    const t = ctx.currentTime;
    stopped = true;
    const now = Number.isFinite(master.gain.value) ? master.gain.value : ampNow;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(now, t);
    master.gain.linearRampToValueAtTime(0, t + fade);
    try { osc.stop(t + fade); } catch { /* already stopped */ }
    for (const p of pending) if (p.t > t + fade) release(p);
    return t + fade;
  }

  function dispose() {
    stopped = true;
    osc.onended = null;
    for (const p of pending) release(p);
    pending = [];
    try { osc.stop(); } catch { /* already stopped */ }
    try { osc.disconnect(); toneGain.disconnect(); clickGain.disconnect(); master.disconnect(); } catch { /* gone */ }
  }

  return {
    osc,
    master,
    get mode() { return mode; },
    get harmonics() { return harmonics; },
    get pending() { return pending.length; },
    start,
    pump,
    setRate,
    setAmp,
    setEnd,
    stop,
    dispose,
  };
}

function drawHarmonics(g, colors, rate) {
  const { ctx, w, h } = g;
  ctx.clearRect(0, 0, w, h);
  const rows = harmonicRows(rate);
  const pad = 8;
  const top = 12;
  const base = h - 34;
  const pitch = (w - 2 * pad) / rows.length;
  const bw = Math.max(2, pitch * 0.62);
  const steps = harmonicLabelSteps(pitch);
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, base + 0.5); ctx.lineTo(w - pad, base + 0.5); ctx.stroke();
  ctx.fillStyle = colors.fill;
  ctx.font = `10px ${colors.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  rows.forEach((r, i) => {
    const x = pad + (i + 0.5) * pitch;
    ctx.fillStyle = colors.fill;
    ctx.fillRect(x - bw / 2, top, bw, base - top);
    ctx.fillStyle = colors.muted;
    if (i % steps.names === 0) ctx.fillText(`H${r.n}`, x, base + 5);
    if (i % steps.hz === 0) {
      const text = fmtHz(r.hz);
      const half = ctx.measureText(text).width / 2;
      ctx.fillText(text, clamp(x, half + 2, w - half - 2), base + 18);
    }
  });
}

export function createClicksCard(env = {}) {
  const doc = env.document ?? globalThis.document;
  const Ctx = env.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const now = env.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const raf = env.raf ?? ((fn) => globalThis.requestAnimationFrame?.(fn) ?? 0);
  let params = { ...DEFAULTS };
  let live = null;
  let state = 'idle';
  let colors = null;
  let colorsAt = 0;
  let gone = false;
  const off = [];

  const uid = `cl-${Math.random().toString(36).slice(2, 7)}`;
  const rateNum = el('input', { id: `${uid}-rn`, class: 'hm-num', type: 'number', min: MIN_RATE, max: MAX_RATE, step: 'any', inputmode: 'decimal', value: String(params.rate) });
  const rateRange = el('input', { id: `${uid}-rr`, class: 'slider hm-range', type: 'range', min: '0', max: '1000', step: '1', value: String(rateToSlider(params.rate)), 'aria-label': 'Clicks per second slider' });
  const rateOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-rn ${uid}-rr` });
  const regimeOut = el('p', { class: 'cl-regime t-subhead', role: 'status' });
  const ampNum = el('input', { id: `${uid}-an`, class: 'hm-num', type: 'number', min: '0', max: String(MAX_AMP * 100), step: 'any', inputmode: 'decimal' });
  const ampRange = el('input', { id: `${uid}-ar`, class: 'slider hm-range', type: 'range', min: '0', max: String(MAX_AMP * 100), step: '1', 'aria-label': 'Amplitude slider' });
  const ampOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-an ${uid}-ar` });
  const lenNum = el('input', { id: `${uid}-ln`, class: 'hm-num', type: 'number', min: MIN_LEN, max: MAX_LEN, step: '0.1', inputmode: 'decimal', value: String(params.length) });
  const contBox = el('input', { id: `${uid}-cb`, type: 'checkbox', checked: params.continuous });

  const label = el('span', {}, 'Play');
  const toggleIcon = el('span', { class: 'hm-ic' }, icon('play', 'action'));
  const button = el('button', { class: 'btn primary hm-toggle', type: 'button', onclick: () => { if (live && !live.stopping) stop('stopped'); else start(); } }, toggleIcon, label);
  const stateOut = el('p', { class: 'hm-state t-subhead', role: 'status', 'aria-live': 'polite' }, TEXT.idle);

  const chips = PRESETS.map((pr) => ({
    pr,
    node: el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: () => change({ rate: pr.rate }, true) }, pr.label),
  }));

  const waveCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const waveCapOut = el('p', { class: 'hm-cap muted t-caption' });
  const harmCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const harmTitle = el('h3', { class: 't-subhead' });

  const detach = [];
  const info = (about, text) => {
    const btn = el('button', { class: 'sm-info', type: 'button', 'aria-label': `About ${about}` }, 'i');
    detach.push(attachInfo(btn, text));
    return btn;
  };
  const field = (id, title, tip, ...rest) => el('div', { class: 'hm-field' },
    el('div', { class: 'sm-lab' }, el('label', { htmlFor: id }, title), tip),
    ...rest);

  const node = el('section', { class: 'card hm-card sm-card cl-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('p', { class: 'hm-cap muted t-caption' }, INTRO),
    el('div', { class: 'cl-rate' },
      field(`${uid}-rn`, 'Clicks per second', info('clicks per second', RATE_NOTE), el('div', { class: 'hm-freq' }, rateNum, rateOut), rateRange),
      regimeOut,
      el('div', { class: 'cl-presets', role: 'group', 'aria-label': 'Presets' }, chips.map((c) => c.node))),
    el('div', { class: 'sm-ctl cl-ctl' },
      field(`${uid}-an`, 'Amplitude (% of full scale)', info('amplitude', `${AMP_NOTE} ${LIMIT_NOTE}`), el('div', { class: 'hm-freq' }, ampNum, ampOut), ampRange),
      field(`${uid}-ln`, 'Length (seconds)', info('length', LENGTH_NOTE), el('div', { class: 'hm-freq' }, lenNum, el('span', { class: 'hm-check' }, contBox, el('label', { htmlFor: `${uid}-cb` }, 'Continuous (until Stop)')))),
      el('div', { class: 'hm-play' }, button, stateOut)),
    el('div', { class: 'sm-scopes' },
      el('div', { class: 'hm-block' },
        el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, WAVE_TITLE)),
        el('p', { class: 'hm-cap muted t-caption' }, WAVE_SUB),
        el('div', { class: 'hm-view hm-wave' }, waveCanvas),
        waveCapOut),
      el('div', { class: 'hm-block' },
        el('div', { class: 'hm-head' }, harmTitle),
        el('p', { class: 'hm-cap muted t-caption' }, HARM_SUB),
        el('div', { class: 'hm-view hm-wave' }, harmCanvas),
        el('p', { class: 'hm-cap muted t-caption' }, HARM_NOTE))),
    el('p', { class: 'sm-links' },
      el('a', { class: 'gl-link t-subhead', href: CLICK_HREF }, CLICK_LINK),
      el('a', { class: 'gl-link t-subhead', href: GLOSSARY_HREF }, GLOSSARY_LINK)));

  const active = () => doc?.activeElement;
  const setValue = (input, value, force) => { if (force || active() !== input) input.value = value; };

  function paintOutputs(force = false) {
    const p = params;
    setValue(rateNum, trim(p.rate, 2), force);
    setValue(rateRange, String(rateToSlider(p.rate)), force);
    rateOut.textContent = rateReadout(p.rate);
    regimeOut.textContent = regimeText(p.rate);
    setValue(ampNum, String(ampPercent(p.amp)), force);
    setValue(ampRange, String(ampPercent(p.amp)), force);
    ampOut.textContent = `peak ${fmtAmp(p.amp)} of full scale`;
    setValue(lenNum, String(p.length), force);
    lenNum.disabled = p.continuous;
    contBox.checked = p.continuous;
    for (const c of chips) {
      const on = Math.abs(c.pr.rate - p.rate) < 0.01;
      c.node.classList.toggle('on', on);
      c.node.setAttribute('aria-pressed', String(on));
    }
    waveCapOut.textContent = windowCaption(p.rate);
    waveCanvas.setAttribute('aria-label', `Waveform: clicks over time, ${rateReadout(p.rate)}, peak ${ampPercent(p.amp)} % of full scale, ${windowCaption(p.rate)}`);
    harmTitle.textContent = harmonicsTitle(p.rate);
    harmCanvas.setAttribute('aria-label', `${harmonicsTitle(p.rate)}: H1 to H16 of ${fmtRate(p.rate)} Hz, all of equal strength`);
  }

  function say(key) {
    state = key;
    let text = TEXT[key];
    if (key === 'playing') text = params.continuous ? 'Playing until you press Stop' : `Playing for ${trim(live?.length ?? params.length, 2)} s`;
    stateOut.textContent = text;
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

  function paintWave() {
    if (gone) return;
    const g = fit(waveCanvas);
    if (!g) return;
    const points = Math.max(64, Math.round(g.w * 2));
    const ms = windowMs(params.rate);
    drawScope(g, currentColors(), clickSeries(params.amp, points, windowPeriods(params.rate)), points, { amp: params.amp, freq: params.rate }, { ticks: windowTicks(ms), bracket: false, tickText: (t) => fmtSpan(t.ms) });
  }

  function paintHarm() {
    if (gone) return;
    const g = fit(harmCanvas);
    if (g) drawHarmonics(g, currentColors(), params.rate);
  }

  function paintAll() {
    paintWave();
    paintHarm();
  }

  function listen(target, type, fn) {
    target?.addEventListener?.(type, fn);
    off.push(() => target?.removeEventListener?.(type, fn));
  }

  function teardown(s) {
    clearTimeout(s.safety);
    clearTimeout(s.fallback);
    clearInterval(s.timer);
    s.engine.dispose();
    Promise.resolve(s.ctx.close?.()).catch(() => {});
    if (live === s) {
      live = null;
      while (off.length) off.pop()();
    }
  }

  function finish(s, key) {
    if (s !== live) { teardown(s); return; }
    teardown(s);
    if (gone) return;
    say(key);
    paintButton();
  }

  function stop(key = 'stopped', hard = false) {
    const s = live;
    if (!s) return;
    if (hard || gone || s.stopping) { finish(s, key); return; }
    s.stopping = true;
    const t = s.engine.stop();
    s.engine.osc.onended = () => finish(s, key);
    clearTimeout(s.fallback);
    s.fallback = setTimeout(() => finish(s, key), Math.max(0, t - s.ctx.currentTime) * 1000 + 250);
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
      const engine = createClickEngine(ctx, { rate: params.rate, amp: params.amp });
      s = { ctx, engine, length: params.length, stopping: false, safety: 0, fallback: 0, timer: 0 };
      engine.osc.onended = () => finish(s, 'done');
      const t = ctx.currentTime;
      engine.start(t);
      if (!params.continuous) {
        engine.setEnd(t + params.length);
        s.fallback = setTimeout(() => { if (live === s) stop('done', true); }, params.length * 1000 + 500);
      }
      s.timer = setInterval(() => engine.pump(), PUMP_MS);
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
  }

  function change(next, force = false) {
    const before = params;
    params = clampParams({ ...params, ...next });
    paintOutputs(force);
    const s = live;
    if (s && !s.stopping) {
      if (params.rate !== before.rate) s.engine.setRate(params.rate);
      if (params.amp !== before.amp) s.engine.setAmp(params.amp);
    }
    paintAll();
  }

  const typed = (input, apply) => {
    input.addEventListener('input', () => { const v = Number.parseFloat(input.value); if (Number.isFinite(v)) apply(v); });
    input.addEventListener('change', () => paintOutputs(true));
  };
  typed(rateNum, (v) => change({ rate: v }));
  typed(rateRange, (v) => change({ rate: sliderToRate(v) }));
  typed(ampNum, (v) => change({ amp: v / 100 }));
  typed(ampRange, (v) => change({ amp: v / 100 }));
  typed(lenNum, (v) => change({ length: v }));
  contBox.addEventListener('change', () => change({ continuous: contBox.checked }));

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { if (!gone) paintAll(); });
    ro.observe(node);
  }

  paintOutputs(true);
  paintButton();
  if (typeof requestAnimationFrame === 'function') raf(() => { if (!gone) paintAll(); });

  return {
    node,
    get running() { return !!live && !live.stopping; },
    get state() { return state; },
    get params() { return { ...params }; },
    get engine() { return live?.engine ?? null; },
    start,
    stop: () => stop('stopped'),
    change,
    dispose() {
      gone = true;
      for (const d of detach) d();
      ro?.disconnect();
      if (live) teardown(live);
    },
  };
}

export function mountClicks(panel, env = {}) {
  const card = createClicksCard(env);
  panel.replaceChildren(card.node);
  return () => card.dispose();
}
