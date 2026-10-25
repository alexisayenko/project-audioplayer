import { el } from './dom.js';
import { icon } from './icons.js';
import { segmented } from './segmented.js';

export const TITLE = 'Primitive';
export const PRIMITIVE_NOTE = 'A primitive sound: one sine wave, one frequency, H1 only. It models a speaker cone driven by an electrical signal.';
export const INTRO = 'The four numbers that describe a sound from a speaker. Set them, press Play and hear a pure sine tone.';
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
export const SLOW = 1000;
export const SLOW_CHOICES = [250, 500, 1000, 2000, 5000, 10000];
export const SLOW_DEFAULT = 2000;
export const SLOW_LABEL = 'Slow motion factor';
export const FAST_SLOWED_HZ = 5;
export const MAX_FRAME_MS = 100;
export const SOUND_SPEED = 343;
export const NARROW_PX = 480;
export const SCOPE_TITLE = 'Oscilloscope: one cycle';
export const SCOPE_SUB = 'Oscilloscope: one cycle. Waveform of the tone over one cycle: time across, amplitude up; the dot is the pressure now.';
export const SCOPE_NOTE = 'The bracket: one cycle in time is one wavelength in space (speed of sound 343 m/s divided by the frequency, in air at 20 °C).';
export const WINDOW_TITLE = 'Oscilloscope: time window';
export const WINDOW_SUB = 'Oscilloscope: time window. Waveform over a period of time: time across, amplitude up.';
export const WINDOW_LABEL = 'Time window';
export const WINDOW_CHOICES = [10, 20, 50, 200];
export const WINDOW_DEFAULT = 20;
export const WINDOW_STEPS = { 10: 2, 20: 5, 50: 10, 200: 50 };
export const MANY_CYCLES = 60;
export const MANY_TEXT = 'Too many cycles to see the shape: shorten the window';
export const WINDOW_MAX_POINTS = 8000;
export const AIR_ROWS = 5;
export const AIR_GAP = 12;
export const AIR_MAX_COLS = 56;
export const AIR_SHIFT_FRAC = 0.07;
export const AIR_SHIFT_MIN = 16;
export const AIR_K = 0.45;
export const AIR_CURVE_H = 148;
export const AIR_CURVE_MARGIN = 16;
export const AIR_CURVE_REF = 42;
export const AIR_CURVE_GAIN = 3;
export const AIR_DOT_R = 2.2;
export const AIR_DOT_GROW = 0.1;
export const AIR_HEAT_STEPS = 16;
export const AIR_DENSE_TEXT = 'dense (compression)';
export const AIR_THIN_TEXT = 'at rest or thinner';
export const AIR_NOW_TEXT = 'now';
export const AIR_AGO_TEXT = 'one cycle ago';
export const AIR_CURVE_TEXT = 'air density';
export const AIR_CURVE_TITLE = 'Air density: the density along the air in front of the cone, right now';
export const AIR_CURVE_NOTE = 'The curve is the air density along the path in front of the cone, right now: above the dashed line the air is denser than at rest (compression), below it thinner (rarefaction). It is the same wave as the oscilloscope, seen in space instead of time.';
export const CONE_TITLE = 'Slow motion: the speaker cone';
export const coneNote = (slow = SLOW) => `Swing exaggerated. The real cone moves a fraction of a millimetre. Here its motion runs ${slow} times slower. The cone is a quarter cycle behind the pressure: the air is squeezed hardest when the cone moves fastest, in the middle of its swing.`;
export const CONE_NOTE = coneNote();
export const PAUSE_TEXT = 'Pause animation';
export const PLAY_ANIM_TEXT = 'Play animation';
export const POWER_NOTE = 'Power grows with the square of the amplitude: double the amplitude, four times the power.';
export const DB_NOTE = 'In decibels of full scale: dBFS = 20 x log10(amplitude). 0 dBFS is the loudest tone the device can play.';
export const AMP_NOTE = 'How far the speaker cone moves.';
export const LIMIT_NOTE = 'Limited to 80 % of full scale to protect your hearing and the speaker.';
export const LENGTH_NOTE = 'A new length applies the next time you press Play. Continuous stops after 10 minutes.';
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
const trim = (v, digits) => String(+v.toFixed(digits));

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

export const slowedHz = (freq, slow = SLOW) => freq / slow;

export function advancePhase(phase, freq, dtMs, slow = SLOW) {
  const next = phase + (slowedHz(freq, slow) * Math.max(0, dtMs)) / 1000;
  return next - Math.floor(next);
}

export const fmtSig = (v) => String(+v.toPrecision(3));

export function slowReadout(freq, slow = SLOW) {
  const rate = slowedHz(freq, slow);
  const hz = trim(freq, 2);
  const swings = rate === 1 ? 'swing' : 'swings';
  const fast = rate > FAST_SLOWED_HZ ? ' Too fast to follow at this frequency.' : '';
  return `Slowed ${slow}×: real ${hz} Hz = ${fmtSig(rate)} ${swings} per second (one swing every ${fmtSig(1 / rate)} s); the real cone makes ${hz} swings each second.${fast}`;
}

export const coneOffset = (phase, amp) => -(amp / MAX_AMP) * Math.cos(2 * Math.PI * phase);

export const scopeMarker = (phase, amp) => ({ frac: phase, level: amp * Math.sin(2 * Math.PI * phase) });

export const pressureAt = (phase, dist, wavelength) => Math.sin(2 * Math.PI * (phase - dist / wavelength));

export function wavelengthM(freq) {
  return SOUND_SPEED / freq;
}

export function fmtWavelength(freq) {
  const m = wavelengthM(freq);
  if (m >= 0.995) return `${fmtSig(m)} m`;
  return `${+(m * 100).toPrecision(2)} cm`;
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

export const airNote = (freq) => `The dots are the air in front of the cone: one dense bunch (high pressure) and one thin gap (low pressure) are one cycle of the wave; the curve above them is the oscilloscope curve mirrored in time, and the dot on the oscilloscope is the pressure now. Red dots are the compression: air squeezed closer than at rest (high pressure). Teal dots are at rest or spread thinner. The spacing is schematic: the real wavelength of ${trim(freq, 2)} Hz is about ${fmtWavelength(freq)}. ${AIR_CURVE_NOTE}`;

export function airGeometry(base, right) {
  const avail = Math.max(0, right - base);
  const shift = Math.max(AIR_SHIFT_MIN, avail * AIR_SHIFT_FRAC);
  const wavelength = Math.max(1, avail - 2 * shift);
  const cols = clamp(Math.round(wavelength / AIR_GAP), 1, AIR_MAX_COLS);
  return { start: base + shift, wavelength, shift, cols, gap: wavelength / cols };
}

export const airRest = (geo, col, row) => (col + 0.25 + 0.5 * (row % 2)) * geo.gap;

export const airK = (amp) => AIR_K * (amp / MAX_AMP);

export const airShift = (phase, amp, geo, dist) => -((geo.wavelength / (2 * Math.PI)) * airK(amp)) * Math.cos(2 * Math.PI * (phase - dist / geo.wavelength));

export const airX = (phase, amp, geo, dist) => geo.start + dist + airShift(phase, amp, geo, dist);

export const airBunchFrac = (phase) => {
  const u = (phase - 0.25) % 1;
  return u < 0 ? u + 1 : u;
};

export const airHeat = (phase, amp, geo, dist) => (amp > 0 ? clamp(pressureAt(phase, dist, geo.wavelength), 0, 1) : 0);

export const airHeatStep = (heat) => Math.round(clamp(heat, 0, 1) * AIR_HEAT_STEPS);

export const airDotRadius = (heat) => AIR_DOT_R * (1 + AIR_DOT_GROW * clamp(heat, 0, 1));

export function parseColor(text) {
  const s = String(text ?? '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

export function mixColor(from, to, t) {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return t >= 0.5 ? to : from;
  return `rgb(${[0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)).join(',')})`;
}

export const airRamp = (cool, hot) => Array.from({ length: AIR_HEAT_STEPS + 1 }, (_, k) => (k === 0 ? cool : mixColor(cool, hot, k / AIR_HEAT_STEPS)));

export const airCurveHalf = () => AIR_CURVE_H / 2 - AIR_CURVE_MARGIN;

export const airCurveSwing = (amp) => Math.min(airCurveHalf(), AIR_CURVE_GAIN * AIR_CURVE_REF * (amp / MAX_AMP));

export const airCurveY = (phase, amp, frac) => pressureAt(phase, frac, 1) * airCurveSwing(amp);

export const airSpeedPx =(geo, freq, slow = SLOW) => (geo.wavelength * slowedHz(freq, slow));

export const airSpacing = (phase, amp, geo, dist) => 1 - airK(amp) * pressureAt(phase, dist, geo.wavelength);

export const airDensity = (phase, amp, geo, dist) => 1 + airK(amp) * pressureAt(phase, dist, geo.wavelength);

export const airCurve = (phase, amp, frac) => (amp / MAX_AMP) * pressureAt(phase, frac, 1);

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

function readColors(node) {
  const css = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
  const get = (name, fallback) => css?.getPropertyValue(name).trim() || fallback;
  const fill = get('--fill', '#2298b1');
  const hot = get('--chart-5', '#d2601a');
  return {
    muted: get('--ink-muted', '#5f6669'),
    line: get('--line', '#ddd5c6'),
    fill,
    hot,
    ramp: airRamp(fill, hot),
    font: get('--font-sans', 'system-ui, sans-serif'),
  };
}

function fit(canvas) {
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

function drawMarker(g, colors, marker) {
  const { ctx, w, h } = g;
  const { left, plotW, mid, scale } = scopeGeometry(w, h);
  const x = left + marker.frac * plotW;
  const y = mid - marker.level * scale;
  ctx.save();
  ctx.strokeStyle = colors.fill;
  ctx.fillStyle = colors.fill;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, mid); ctx.lineTo(x, y); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
}

function drawAirCurve(g, colors, geo, phase, amp) {
  const { ctx } = g;
  const mid = AIR_CURVE_H / 2;
  const x0 = geo.start;
  const steps = clamp(Math.round(geo.wavelength / 2), 24, 400);
  ctx.save();
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.setLineDash?.([2, 3]);
  ctx.beginPath(); ctx.moveTo(x0, mid); ctx.lineTo(x0 + geo.wavelength, mid); ctx.stroke();
  ctx.setLineDash?.([]);
  const swing = airCurveSwing(amp);
  let paint = colors.fill;
  if (swing > 0.5 && ctx.createLinearGradient) {
    paint = ctx.createLinearGradient(0, mid, 0, mid - swing);
    paint.addColorStop(0, colors.fill);
    paint.addColorStop(1, colors.hot ?? colors.fill);
  }
  ctx.strokeStyle = paint;
  ctx.fillStyle = paint;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const frac = i / steps;
    const x = x0 + frac * geo.wavelength;
    const y = mid - airCurveY(phase, amp, frac);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.lineTo(x0 + geo.wavelength, mid);
  ctx.lineTo(x0, mid);
  ctx.closePath();
  ctx.globalAlpha = 0.12;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.font = `10px ${colors.font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = colors.muted;
  ctx.fillText(AIR_CURVE_TEXT, x0, 2);
  ctx.restore();
}

function drawCone(g, colors, phase, amp) {
  const { ctx, w, h } = g;
  const top = AIR_CURVE_H;
  const cy = top + (h - top) / 2;
  const travel = clamp(w * 0.07, 16, 28);
  const swing = coneOffset(phase, amp) * travel;
  const magnetX = 10;
  const magnetW = 26;
  const magnetH = 44;
  const restX = magnetX + magnetW + 54;
  const radius = Math.max(20, Math.min(50, (h - top) / 2 - 12));
  const rimX = restX + swing;
  const apexX = rimX - 22;
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(magnetX + magnetW, cy + s * (magnetH / 2));
    ctx.lineTo(restX - 8, cy + s * (radius + 6));
    ctx.lineTo(restX - 2, cy + s * (radius + 6));
  }
  ctx.stroke();
  ctx.save();
  ctx.setLineDash?.([4, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(restX, cy - radius - 10); ctx.lineTo(restX, cy + radius + 10); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = colors.muted;
  ctx.fillRect(magnetX, cy - magnetH / 2, magnetW, magnetH);
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(magnetX + magnetW, cy); ctx.lineTo(apexX, cy); ctx.stroke();
  ctx.fillStyle = colors.fill;
  ctx.strokeStyle = colors.fill;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(rimX, cy - radius);
  ctx.lineTo(apexX, cy - 7);
  ctx.lineTo(apexX, cy + 7);
  ctx.lineTo(rimX, cy + radius);
  ctx.globalAlpha = 0.25;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.font = `10px ${colors.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = colors.muted;
  ctx.fillText('rest', restX, h - 2);
  ctx.textBaseline = 'top';
  ctx.fillText('magnet', magnetX + magnetW / 2, cy + magnetH / 2 + 4);
  const geo = airGeometry(restX + travel + 6, w - 8);
  const areaL = geo.start;
  const areaR = geo.start + geo.wavelength;
  const legendY = h - 16;
  ctx.save();
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.setLineDash?.([2, 3]);
  ctx.beginPath();
  for (const x of [areaL, areaR]) { ctx.moveTo(x, cy - radius); ctx.lineTo(x, legendY); }
  ctx.stroke();
  ctx.setLineDash?.([]);
  ctx.beginPath();
  ctx.moveTo(areaL, legendY); ctx.lineTo(areaR, legendY);
  for (const x of [areaL, areaR]) { ctx.moveTo(x, legendY - 3); ctx.lineTo(x, legendY + 3); }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = colors.muted;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.fillText(AIR_NOW_TEXT, areaL, legendY + 5);
  ctx.textAlign = 'right';
  ctx.fillText(AIR_AGO_TEXT, areaR, legendY + 5);
  drawAirCurve(g, colors, geo, phase, amp);
  const ramp = colors.ramp ?? [colors.fill];
  ctx.globalAlpha = 0.85;
  for (let r = 0; r < AIR_ROWS; r += 1) {
    const y = cy - radius + ((r + 0.5) * 2 * radius) / AIR_ROWS;
    for (let c = 0; c < geo.cols; c += 1) {
      const dist = airRest(geo, c, r);
      const x = airX(phase, amp, geo, dist);
      const heat = airHeat(phase, amp, geo, dist);
      ctx.fillStyle = ramp[Math.min(airHeatStep(heat), ramp.length - 1)];
      ctx.beginPath(); ctx.arc(x, y, airDotRadius(heat), 0, 2 * Math.PI); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawScope(g, colors, series, need, p, view) {
  const { ctx, w, h } = g;
  const { ticks, bracket = true, marker = null } = view;
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
  if (marker) drawMarker(g, colors, marker);
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
  const matchMedia = env.matchMedia ?? globalThis.matchMedia;
  const reduced = typeof matchMedia === 'function' && !!matchMedia.call(globalThis, '(prefers-reduced-motion: reduce)')?.matches;
  let phase = reduced ? 0.25 : 0;
  let paused = reduced;
  let slow = SLOW_DEFAULT;
  let win = WINDOW_DEFAULT;
  let inView = true;
  let animLast = 0;
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
  const coneCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const slowOut = el('p', { class: 'hm-cap muted t-caption' });
  const airOut = el('p', { class: 'hm-cap muted t-caption sm-air' });
  const pauseButton = el('button', { class: 'btn outline small', type: 'button', onclick: () => togglePause() }, reduced ? PLAY_ANIM_TEXT : PAUSE_TEXT);
  const coneNoteOut = el('p', { class: 'hm-cap muted t-caption' });
  const slowSeg = segmented(SLOW_CHOICES.map((n) => [n, `${n}×`]), () => slow, (n) => setSlow(n), { 'aria-labelledby': `${uid}-sl` });
  const slowField = el('div', { class: 'hm-axis' },
    el('span', { id: `${uid}-sl`, class: 'hm-lbl' }, SLOW_LABEL),
    slowSeg.group);

  const windowCanvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const windowCapOut = el('p', { class: 'hm-cap muted t-caption' });
  const manyOut = el('p', { class: 'hm-cap t-caption sm-many', role: 'status' }, MANY_TEXT);
  const winSeg = segmented(WINDOW_CHOICES.map((n) => [n, `${n} ms`]), () => win, (n) => setWin(n), { 'aria-labelledby': `${uid}-wl` });
  const winField = el('div', { class: 'hm-axis' },
    el('span', { id: `${uid}-wl`, class: 'hm-lbl' }, WINDOW_LABEL),
    winSeg.group);

  const field = (id, title, ...rest) => el('div', { class: 'hm-field' }, el('label', { htmlFor: id }, title), ...rest);
  const cap = (id, text) => el('p', { id, class: 'hm-cap muted t-caption' }, text);

  const node = el('section', { class: 'card hm-card sm-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('p', { class: 'hm-cap muted t-caption' }, PRIMITIVE_NOTE),
    el('p', { class: 'hm-cap muted t-caption' }, INTRO),
    el('div', { class: 'sm-ctl' },
      field(`${uid}-fn`, 'Frequency (Hz)', el('div', { class: 'hm-freq' }, freqNum, noteOut), freqRange),
      field(`${uid}-an`, 'Amplitude (strength, % of full scale)', el('div', { class: 'hm-freq' }, ampNum, ampOut), ampRange, cap(`${uid}-ad`, `${AMP_NOTE} ${LIMIT_NOTE}`)),
      field(`${uid}-pn`, 'Power (% of the full-scale tone)', el('div', { class: 'hm-freq' }, powNum, dbOut), powRange, cap(`${uid}-pd`, `${POWER_NOTE} ${DB_NOTE}`)),
      field(`${uid}-ln`, 'Length (seconds)', el('div', { class: 'hm-freq' }, lenNum, el('span', { class: 'hm-check' }, contBox, el('label', { htmlFor: `${uid}-cb` }, 'Continuous (until Stop)'))), cap(`${uid}-ld`, LENGTH_NOTE))),
    el('div', { class: 'hm-play' }, button, stateOut),
    el('div', { class: 'hm-block' },
      el('h3', { class: 't-subhead' }, SCOPE_TITLE),
      el('p', { class: 'hm-cap muted t-caption' }, SCOPE_SUB),
      el('div', { class: 'hm-view hm-wave sm-wave' }, canvas),
      readoutOut,
      el('p', { class: 'hm-cap muted t-caption' }, SCOPE_NOTE),
      el('p', { class: 'hm-cap muted t-caption' }, SINE_NOTE)),
    el('div', { class: 'hm-block' },
      el('h3', { class: 't-subhead' }, WINDOW_TITLE),
      el('p', { class: 'hm-cap muted t-caption' }, WINDOW_SUB),
      winField,
      el('div', { class: 'hm-view hm-wave' }, windowCanvas),
      windowCapOut,
      manyOut),
    el('div', { class: 'hm-block' },
      el('div', { class: 'hm-head' }, el('h3', { class: 't-subhead' }, CONE_TITLE), pauseButton),
      slowField,
      el('div', { class: 'hm-view sm-cone' }, coneCanvas),
      slowOut,
      coneNoteOut,
      el('p', { class: 'hm-cap muted t-caption sm-key' },
        el('span', { class: 'sm-key-item' }, el('span', { class: 'sm-dot dense', 'aria-hidden': 'true' }), AIR_DENSE_TEXT),
        el('span', { class: 'sm-key-item' }, el('span', { class: 'sm-dot thin', 'aria-hidden': 'true' }), AIR_THIN_TEXT)),
      airOut),
    el('a', { class: 'gl-link t-subhead', href: GLOSSARY_HREF }, GLOSSARY_LINK));

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
    canvas.setAttribute('aria-label', `Oscilloscope: one cycle, sine wave, ${p.freq} Hz, amplitude ${fmtPct(p.amp * 100)} % of full scale; ${cycleLabels(p.freq)[0]}, at 20 °C`);
    const cyc = windowCycles(p.freq, win);
    windowCapOut.textContent = windowCaption(p.freq, win);
    manyOut.hidden = !tooManyCycles(cyc);
    windowCanvas.setAttribute('aria-label', `Oscilloscope: time window, sine wave, ${p.freq} Hz, amplitude ${fmtPct(p.amp * 100)} % of full scale, ${windowCaption(p.freq, win)}`);
    winSeg.paint();
    canvas.setAttribute('title', `${cycleLabels(p.freq)[0]} (speed of sound 343 m/s at 20 °C)`);
    coneCanvas.setAttribute('aria-label', `Side view of a speaker cone moving ${slow} times slower than real at ${p.freq} Hz, swing in proportion to the amplitude, ${fmtPct(p.amp * 100)} % of full scale; the cone is a quarter cycle behind the pressure on the oscilloscope above; the air dots in front of the cone show one cycle of the wave as one dense bunch and one thin gap, and the curve above them is the oscilloscope curve mirrored in time, the density along the air, red above the dashed rest line where the air is denser than at rest and teal below it; red dots are the compression, air squeezed closer than at rest, and teal dots are at rest or spread thinner`);
    coneCanvas.setAttribute('title', AIR_CURVE_TITLE);
    slowOut.textContent = slowReadout(p.freq, slow);
    coneNoteOut.textContent = coneNote(slow);
    airOut.textContent = airNote(p.freq);
    slowSeg.paint();
  }

  function setWin(n) {
    if (!WINDOW_CHOICES.includes(n) || n === win) return;
    win = n;
    paintOutputs();
    paintWindow();
  }

  function setSlow(n) {
    if (!SLOW_CHOICES.includes(n) || n === slow) return;
    slow = n;
    paintOutputs();
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
    const marker = scopeMarker(phase, params.amp);
    const view = { ticks: scopeTicks(cycles, params.freq), marker };
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

  function paintCone() {
    if (gone) return;
    const g = fit(coneCanvas);
    if (!g) return;
    drawCone(g, currentColors(), phase, params.amp);
    coneCanvas.setAttribute('data-phase', phase.toFixed(4));
    coneCanvas.setAttribute('data-offset', coneOffset(phase, params.amp).toFixed(4));
  }

  function paintAll() {
    paintScope();
    paintCone();
    paintWindow();
  }

  const animOn = () => !gone && !paused && inView && !doc?.hidden;

  function schedule() {
    looping = true;
    frame = raf(tick);
  }

  function tick() {
    looping = false;
    frame = 0;
    if (gone) return;
    const t = now();
    const running = animOn();
    if (running) phase = advancePhase(phase, params.freq, Math.min(t - animLast, MAX_FRAME_MS), slow);
    animLast = t;
    if (running) { paintScope(); paintCone(); } else paintScope();
    if (live || running) schedule();
  }

  function syncLoop() {
    const want = !gone && (!!live || animOn());
    if (want && !looping) {
      animLast = now();
      schedule();
    } else if (!want && looping) {
      looping = false;
      caf(frame);
      frame = 0;
    }
  }

  function togglePause() {
    paused = !paused;
    pauseButton.textContent = paused ? PLAY_ANIM_TEXT : PAUSE_TEXT;
    paintCone();
    syncLoop();
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
    if (!looping) { paintScope(); paintCone(); }
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
      if (!looping) { paintScope(); paintCone(); }
    });
    ro.observe(node);
  }

  const onVisibility = () => syncLoop();
  doc?.addEventListener?.('visibilitychange', onVisibility);
  const IO = env.IntersectionObserver ?? globalThis.IntersectionObserver;
  let io = null;
  if (typeof IO === 'function') {
    io = new IO((entries) => {
      inView = entries[entries.length - 1].isIntersecting;
      syncLoop();
    });
    io.observe(coneCanvas.parentElement);
  }

  paintOutputs(true);
  paintButton();
  if (typeof requestAnimationFrame === 'function') raf(() => { if (!gone && !looping) paintAll(); });
  syncLoop();

  return {
    node,
    get running() { return !!live && !live.stopping; },
    get state() { return state; },
    get params() { return { ...params }; },
    get phase() { return phase; },
    get animating() { return looping && animOn(); },
    get paused() { return paused; },
    get slow() { return slow; },
    get window() { return win; },
    setSlow,
    setWindow: setWin,
    start,
    stop: () => stop('stopped'),
    change,
    togglePause,
    dispose() {
      gone = true;
      ro?.disconnect();
      io?.disconnect();
      doc?.removeEventListener?.('visibilitychange', onVisibility);
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
