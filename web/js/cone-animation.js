import { el } from './dom.js';
import { segmented } from './segmented.js';
import { MIN_HZ, MAX_HZ, MAX_AMP, noteInfo, fmtPct, trim, wavelengthM, fit, styleReader } from './simple-tone.js';

export const DEFAULT_FREQ = 440;
export const DEFAULT_AMP = 0.3;
export const SLOW = 1000;
export const SLOW_CHOICES = [250, 500, 1000, 2000, 5000, 10000];
export const SLOW_DEFAULT = 2000;
export const SLOW_LABEL = 'Slow motion factor';
export const FAST_SLOWED_HZ = 5;
export const MAX_FRAME_MS = 100;
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
export const AIR_CURVE_NOTE = 'The curve is the air density along the path in front of the cone, right now: above the dashed line the air is denser than at rest (compression), below it thinner (rarefaction). It is the same wave as the waveform, seen in space instead of time.';
export const CONE_TITLE = 'Slow motion: the speaker cone';
export const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
export const WAVE_DEFAULT = 'sine';
export const WAVE_LABEL = 'Waveform';
export const WAVE_TEXT = { sine: 'Sine', triangle: 'Triangle', square: 'Square', sawtooth: 'Sawtooth' };
export const WAVE_TABLE_N = 512;
export const HARM_COUNT = 16;
export const HARM_TICKS = [1, 2, 4, 8, 16];
export const HARM_TITLE = 'Harmonics: relative amplitude, H1 = 1';
export const HARM_NOTE = 'The shape is the sum of these sine waves.';
export const HARM_TEXT = {
  sine: 'Sine: only H1.',
  triangle: 'Triangle: odd harmonics, falling as 1/n squared (soft, flute-like).',
  square: 'Square: odd harmonics only, falling as 1/n (hollow).',
  sawtooth: 'Sawtooth: all harmonics, falling as 1/n (buzzy).',
};
const CONE_SHAPE_NOTE = {
  sine: 'The cone is a quarter cycle behind the pressure: the air is squeezed hardest when the cone moves fastest, in the middle of its swing.',
  triangle: 'The cone speed follows the pressure, which rises and falls steadily, so the cone speeds up and slows down steadily and its path is made of parabola arcs.',
  square: 'The cone speed follows the pressure, which jumps between two levels, so the cone moves at a constant speed forth and back and its path is a triangle.',
  sawtooth: 'The cone speed follows the pressure, which builds up steadily and then drops at once, so the cone speeds up steadily, reverses suddenly and its path is made of parabola arcs with a sharp corner.',
};
export const coneNote = (slow = SLOW, wave = WAVE_DEFAULT) => `Swing exaggerated. The real cone moves a fraction of a millimetre. Here its motion runs ${slow} times slower. ${CONE_SHAPE_NOTE[wave] ?? CONE_SHAPE_NOTE.sine}`;
export const PAUSE_TEXT = 'Pause animation';
export const PLAY_ANIM_TEXT = 'Play animation';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const TAU = 2 * Math.PI;

export const waveName = (wave) => (WAVES.includes(wave) ? wave : WAVE_DEFAULT);

export function waveValue(wave, u) {
  const x = u - Math.floor(u);
  switch (wave) {
    case 'triangle': return x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4;
    case 'square': return x < 0.5 ? 1 : -1;
    case 'sawtooth': return 2 * x - 1;
    default: return Math.sin(TAU * x);
  }
}

const WAVE_ANTIDERIVATIVE = {
  sine: (x) => (1 - Math.cos(TAU * x)) / TAU,
  triangle: (x) => (x < 0.25 ? 2 * x * x : x < 0.75 ? 2 * x - 2 * x * x - 0.25 : 2 * x * x - 4 * x + 2),
  square: (x) => (x < 0.5 ? x : 1 - x),
  sawtooth: (x) => x * x - x,
};

const waveTables = {};

export function waveTable(wave) {
  const name = waveName(wave);
  if (!waveTables[name]) {
    const values = new Float32Array(WAVE_TABLE_N + 1);
    let sum = 0;
    for (let i = 0; i < WAVE_TABLE_N; i += 1) {
      values[i] = WAVE_ANTIDERIVATIVE[name](i / WAVE_TABLE_N);
      sum += values[i];
    }
    const mean = sum / WAVE_TABLE_N;
    let peak = 0;
    for (let i = 0; i < WAVE_TABLE_N; i += 1) {
      values[i] -= mean;
      peak = Math.max(peak, Math.abs(values[i]));
    }
    values[WAVE_TABLE_N] = values[0];
    waveTables[name] = { values, peak };
  }
  return waveTables[name];
}

export function wavePotential(wave, u) {
  if (wave === 'sine' || !WAVES.includes(wave)) return -Math.cos(TAU * u) / TAU;
  const { values } = waveTable(wave);
  const x = (u - Math.floor(u)) * WAVE_TABLE_N;
  const i = Math.min(WAVE_TABLE_N - 1, Math.floor(x));
  return values[i] + (values[i + 1] - values[i]) * (x - i);
}

export const wavePeak = (wave) => (wave === 'sine' || !WAVES.includes(wave) ? 1 / TAU : waveTable(wave).peak);

export const waveCone = (wave, u) => wavePotential(wave, u) / wavePeak(wave);

export const WAVE_MAX_POTENTIAL = Math.max(...WAVES.map(wavePeak));

export function harmonicRaw(wave, n) {
  const odd = n % 2 === 1;
  switch (wave) {
    case 'triangle': return odd ? 8 / (Math.PI * Math.PI * n * n) : 0;
    case 'square': return odd ? 4 / (Math.PI * n) : 0;
    case 'sawtooth': return 2 / (Math.PI * n);
    default: return n === 1 ? 1 : 0;
  }
}

export function harmonicAmps(wave, count = HARM_COUNT) {
  const raw = Array.from({ length: count }, (_, i) => harmonicRaw(waveName(wave), i + 1));
  const top = Math.max(...raw);
  return raw.map((v) => v / top);
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

export const coneOffset = (phase, amp, wave = WAVE_DEFAULT) => (amp / MAX_AMP) * waveCone(wave, phase);

export const pressureAt = (phase, dist, wavelength, wave = WAVE_DEFAULT) => waveValue(wave, phase - dist / wavelength);

export function fmtWavelength(freq) {
  const m = wavelengthM(freq);
  if (m >= 0.995) return `${fmtSig(m)} m`;
  return `${+(m * 100).toPrecision(2)} cm`;
}

export const airNote = (freq) => `The dots are the air in front of the cone: one dense bunch (high pressure) and one thin gap (low pressure) are one cycle of the wave; the curve above them is the waveform curve mirrored in time. Red dots are the compression: air squeezed closer than at rest (high pressure). Teal dots are at rest or spread thinner. The spacing is schematic: the real wavelength of ${trim(freq, 2)} Hz is about ${fmtWavelength(freq)}. ${AIR_CURVE_NOTE}`;

export function airGeometry(base, right, wave = WAVE_DEFAULT) {
  const avail = Math.max(0, right - base);
  const reach = AIR_K * wavePeak(wave);
  const shift = Math.max(AIR_SHIFT_MIN, avail * AIR_SHIFT_FRAC, (avail * reach) / (1 + 2 * reach));
  const wavelength = Math.max(1, avail - 2 * shift);
  const cols = clamp(Math.round(wavelength / AIR_GAP), 1, AIR_MAX_COLS);
  return { start: base + shift, wavelength, shift, cols, gap: wavelength / cols };
}

export const airRest = (geo, col, row) => (col + 0.25 + 0.5 * (row % 2)) * geo.gap;

export const airK = (amp) => AIR_K * (amp / MAX_AMP);

export const airShift = (phase, amp, geo, dist, wave = WAVE_DEFAULT) => geo.wavelength * airK(amp) * wavePotential(wave, phase - dist / geo.wavelength);

export const airX = (phase, amp, geo, dist, wave = WAVE_DEFAULT) => geo.start + dist + airShift(phase, amp, geo, dist, wave);

export const airBunchFrac = (phase) => {
  const u = (phase - 0.25) % 1;
  return u < 0 ? u + 1 : u;
};

export const airHeat = (phase, amp, geo, dist, wave = WAVE_DEFAULT) => (amp > 0 ? clamp(pressureAt(phase, dist, geo.wavelength, wave), 0, 1) : 0);

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

export const airCurveY = (phase, amp, frac, wave = WAVE_DEFAULT) => pressureAt(phase, frac, 1, wave) * airCurveSwing(amp);

export const airSpeedPx = (geo, freq, slow = SLOW) => (geo.wavelength * slowedHz(freq, slow));

export const airSpacing = (phase, amp, geo, dist, wave = WAVE_DEFAULT) => 1 - airK(amp) * pressureAt(phase, dist, geo.wavelength, wave);

export const airDensity = (phase, amp, geo, dist, wave = WAVE_DEFAULT) => 1 + airK(amp) * pressureAt(phase, dist, geo.wavelength, wave);

export const airCurve = (phase, amp, frac, wave = WAVE_DEFAULT) => (amp / MAX_AMP) * pressureAt(phase, frac, 1, wave);

function readColors(node) {
  const get = styleReader(node);
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

function drawAirCurve(g, colors, geo, phase, amp, wave) {
  const { ctx } = g;
  const mid = AIR_CURVE_H / 2;
  const x0 = geo.start;
  const steps = clamp(Math.round(wave === 'sine' ? geo.wavelength / 2 : geo.wavelength), 24, 800);
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
    const y = mid - airCurveY(phase, amp, frac, wave);
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

function drawCone(g, colors, phase, amp, wave) {
  const { ctx, w, h } = g;
  const top = AIR_CURVE_H;
  const cy = top + (h - top) / 2;
  const travel = clamp(w * 0.07, 16, 28);
  const swing = coneOffset(phase, amp, wave) * travel;
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
  const geo = airGeometry(restX + travel + 6, w - 8, wave);
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
  drawAirCurve(g, colors, geo, phase, amp, wave);
  const ramp = colors.ramp ?? [colors.fill];
  ctx.globalAlpha = 0.85;
  for (let r = 0; r < AIR_ROWS; r += 1) {
    const y = cy - radius + ((r + 0.5) * 2 * radius) / AIR_ROWS;
    for (let c = 0; c < geo.cols; c += 1) {
      const dist = airRest(geo, c, r);
      const x = airX(phase, amp, geo, dist, wave);
      const heat = airHeat(phase, amp, geo, dist, wave);
      ctx.fillStyle = ramp[Math.min(airHeatStep(heat), ramp.length - 1)];
      ctx.beginPath(); ctx.arc(x, y, airDotRadius(heat), 0, 2 * Math.PI); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export const HARM_BOX = { w: 320, h: 120, left: 32, right: 316, top: 8, base: 90, bar: 11, tick: 1.5 };

function svgEl(tag, attrs = {}, ...kids) {
  const node = globalThis.document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const k of kids) node.append(k);
  return node;
}

export const WAVE_GLYPH = {
  sine: 'M2 10 C5 1 9 1 14 10 C19 19 23 19 26 10',
  triangle: 'M2 10 L8 3 L20 17 L26 10',
  square: 'M2 17 V3 H14 V17 H26',
  sawtooth: 'M2 17 L14 3 V17 L26 3',
};

export const waveGlyph = (wave) => svgEl('svg', { class: 'ca-glyph', viewBox: '0 0 28 20', 'aria-hidden': 'true', focusable: 'false' },
  svgEl('path', { d: WAVE_GLYPH[wave], fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

export const harmonicCell =(n, count = HARM_COUNT) => (HARM_BOX.right - HARM_BOX.left) / count * (n - 0.5) + HARM_BOX.left;

export function harmonicLabel(wave, amps) {
  const parts = amps.map((a, i) => (a > 0 ? `H${i + 1} ${+a.toPrecision(3)}` : null)).filter(Boolean);
  return `Bar chart of the harmonics of a ${wave} wave, relative amplitude with H1 = 1: ${parts.join(', ')}`;
}

function createHarmonicsChart() {
  const { w, h, left, right, top, base } = HARM_BOX;
  const span = base - top;
  const grid = [0, 0.5, 1].flatMap((v) => {
    const y = base - v * span;
    return [
      svgEl('line', { class: 'ca-axis', x1: left, x2: right, y1: y, y2: y }),
      Object.assign(svgEl('text', { class: 'ca-axis-text', x: left - 4, y: y + 3, 'text-anchor': 'end' }), { textContent: v === 0.5 ? '0.5' : String(v) }),
    ];
  });
  const labels = HARM_TICKS.map((n) => Object.assign(svgEl('text', { class: 'ca-axis-text', x: harmonicCell(n), y: base + 14, 'text-anchor': 'middle' }), { textContent: `H${n}` }));
  const bars = Array.from({ length: HARM_COUNT }, (_, i) => svgEl('rect', { class: 'ca-tick', 'data-h': i + 1 }));
  const svg = svgEl('svg', { class: 'ca-harm', viewBox: `0 0 ${w} ${h}`, role: 'img', preserveAspectRatio: 'xMidYMid meet' }, ...grid, ...labels, ...bars);
  function paint(wave) {
    const amps = harmonicAmps(wave);
    amps.forEach((a, i) => {
      const bar = bars[i];
      const bh = a > 0 ? a * span : HARM_BOX.tick;
      bar.setAttribute('class', a > 0 ? 'ca-bar' : 'ca-tick');
      bar.setAttribute('x', (harmonicCell(i + 1) - HARM_BOX.bar / 2).toFixed(2));
      bar.setAttribute('y', (base - bh).toFixed(2));
      bar.setAttribute('width', HARM_BOX.bar);
      bar.setAttribute('height', bh.toFixed(2));
      bar.setAttribute('data-amp', a.toFixed(4));
    });
    svg.setAttribute('aria-label', harmonicLabel(wave, amps));
  }
  return { svg, paint };
}

export function createConeAnimation({ frequency = DEFAULT_FREQ, amplitude = DEFAULT_AMP, wave = WAVE_DEFAULT } = {}, env = {}) {
  const doc = env.document ?? globalThis.document;
  const raf = env.raf ?? ((fn) => globalThis.requestAnimationFrame?.(fn) ?? 0);
  const caf = env.caf ?? ((id) => globalThis.cancelAnimationFrame?.(id));
  const now = env.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const matchMedia = env.matchMedia ?? globalThis.matchMedia;
  const reduced = typeof matchMedia === 'function' && !!matchMedia.call(globalThis, '(prefers-reduced-motion: reduce)')?.matches;
  let freq = clamp(num(frequency, DEFAULT_FREQ), MIN_HZ, MAX_HZ);
  let amp = clamp(num(amplitude, DEFAULT_AMP), 0, MAX_AMP);
  let phase = reduced ? 0.25 : 0;
  let paused = reduced;
  let slow = SLOW_DEFAULT;
  let shape = waveName(wave);
  let inView = true;
  let last = 0;
  let frame = 0;
  let looping = false;
  let colors = null;
  let colorsAt = 0;
  let gone = false;

  const uid = `ca-${Math.random().toString(36).slice(2, 7)}`;
  const freqNum = el('input', { id: `${uid}-fn`, class: 'hm-num', type: 'number', min: MIN_HZ, max: MAX_HZ, step: 'any', inputmode: 'decimal', value: String(freq) });
  const noteOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-fn` });
  const ampNum = el('input', { id: `${uid}-an`, class: 'hm-num', type: 'number', min: '0', max: String(MAX_AMP * 100), step: 'any', inputmode: 'decimal' });
  const canvas = el('canvas', { class: 'hm-canvas', role: 'img' });
  const slowOut = el('p', { class: 'hm-cap muted t-caption' });
  const airOut = el('p', { class: 'hm-cap muted t-caption' });
  const coneNoteOut = el('p', { class: 'hm-cap muted t-caption' });
  const pauseButton = el('button', { class: 'btn outline small', type: 'button', onclick: () => setPaused(!paused) }, reduced ? PLAY_ANIM_TEXT : PAUSE_TEXT);
  const slowSeg = segmented(SLOW_CHOICES.map((n) => [n, `${n}×`]), () => slow, (n) => setSlow(n), { 'aria-labelledby': `${uid}-sl` });
  const waveSeg = segmented(WAVES.map((n) => [n, waveGlyph(n)]), () => shape, (n) => setWave(n), { 'aria-label': WAVE_LABEL });
  waveSeg.group.querySelectorAll('button').forEach((b, i) => {
    b.setAttribute('aria-label', WAVE_TEXT[WAVES[i]]);
    b.setAttribute('title', WAVE_TEXT[WAVES[i]]);
  });
  const harm = createHarmonicsChart();
  const harmOut = el('p', { class: 'hm-cap muted t-caption' });
  const view = el('div', { class: 'hm-view ca-view' }, canvas);
  const stage = el('div', { class: 'ca-stage' }, el('div', { class: 'ca-wave' }, waveSeg.group), view);

  const field = (id, title, ...rest) => el('div', { class: 'hm-field' }, el('label', { htmlFor: id }, title), el('div', { class: 'hm-freq' }, ...rest));
  const node = el('div', { class: 'hm-block ca' },
    el('p', { class: 't-subhead ca-title' }, CONE_TITLE),
    el('div', { class: 'ca-ctl' },
      field(`${uid}-fn`, 'Frequency (Hz)', freqNum, noteOut),
      field(`${uid}-an`, 'Amplitude (% of full scale)', ampNum),
      el('div', { class: 'hm-axis' }, el('span', { id: `${uid}-sl`, class: 'hm-lbl' }, SLOW_LABEL), slowSeg.group),
      pauseButton),
    stage,
    slowOut,
    coneNoteOut,
    el('p', { class: 'hm-cap muted t-caption ca-key' },
      el('span', { class: 'ca-key-item' }, el('span', { class: 'ca-dot dense', 'aria-hidden': 'true' }), AIR_DENSE_TEXT),
      el('span', { class: 'ca-key-item' }, el('span', { class: 'ca-dot thin', 'aria-hidden': 'true' }), AIR_THIN_TEXT)),
    airOut,
    el('p', { class: 't-subhead ca-title ca-harm-title' }, HARM_TITLE),
    harm.svg,
    harmOut);

  function setValue(input, value, force) {
    if (force || doc?.activeElement !== input) input.value = value;
  }

  function paintOutputs(force = false) {
    setValue(freqNum, String(freq), force);
    noteOut.textContent = noteInfo(freq).text;
    setValue(ampNum, fmtPct(amp * 100), force);
    canvas.setAttribute('aria-label', `Side view of a speaker cone moving ${slow} times slower than real at ${freq} Hz, swing in proportion to the amplitude, ${fmtPct(amp * 100)} % of full scale; the air dots in front of the cone show one cycle of the wave as one dense bunch and one thin gap, and the curve above them is the waveform curve mirrored in time, the density along the air, red above the dashed rest line where the air is denser than at rest and teal below it; red dots are the compression, air squeezed closer than at rest, and teal dots are at rest or spread thinner`);
    canvas.setAttribute('title', AIR_CURVE_TITLE);
    slowOut.textContent = slowReadout(freq, slow);
    coneNoteOut.textContent = coneNote(slow, shape);
    airOut.textContent = airNote(freq);
    harmOut.textContent = `${HARM_TEXT[shape]} ${HARM_NOTE}`;
    harm.paint(shape);
    slowSeg.paint();
    waveSeg.paint();
  }

  function currentColors() {
    const t = now();
    if (!colors || t - colorsAt > 500) { colors = readColors(node); colorsAt = t; }
    return colors;
  }

  function paint() {
    if (gone) return;
    const g = fit(canvas);
    if (!g) return;
    drawCone(g, currentColors(), phase, amp, shape);
    canvas.setAttribute('data-phase', phase.toFixed(4));
    canvas.setAttribute('data-offset', coneOffset(phase, amp, shape).toFixed(4));
    canvas.setAttribute('data-wave', shape);
  }

  const animOn = () => !gone && !paused && inView && !doc?.hidden;

  function request() {
    if (looping) return;
    looping = true;
    frame = raf(tick);
  }

  function tick() {
    looping = false;
    frame = 0;
    if (gone) return;
    const t = now();
    if (animOn()) phase = advancePhase(phase, freq, Math.min(t - last, MAX_FRAME_MS), slow);
    last = t;
    paint();
    if (animOn()) request();
  }

  function sync() {
    if (animOn()) {
      if (!looping) {
        last = now();
        request();
      }
    } else if (looping) {
      looping = false;
      caf(frame);
      frame = 0;
    }
  }

  function setPaused(next) {
    paused = next;
    pauseButton.textContent = paused ? PLAY_ANIM_TEXT : PAUSE_TEXT;
    paint();
    sync();
  }

  function setSlow(n) {
    if (!SLOW_CHOICES.includes(n) || n === slow) return;
    slow = n;
    paintOutputs();
  }

  function setWave(name) {
    if (!WAVES.includes(name) || name === shape) return;
    shape = name;
    paintOutputs();
    if (!looping) paint();
  }

  function setFrequency(v) {
    freq = clamp(num(v, freq), MIN_HZ, MAX_HZ);
    paintOutputs();
    if (!looping) paint();
  }

  function setAmplitude(v) {
    amp = clamp(num(v, amp), 0, MAX_AMP);
    paintOutputs();
    if (!looping) paint();
  }

  const typed = (input, apply) => {
    input.addEventListener('input', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) apply(v); });
    input.addEventListener('change', () => paintOutputs(true));
  };
  typed(freqNum, setFrequency);
  typed(ampNum, (v) => setAmplitude(v / 100));

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { if (!gone && !looping) paint(); });
    ro.observe(view);
  }
  const onVisibility = () => sync();
  doc?.addEventListener?.('visibilitychange', onVisibility);
  const IO = env.IntersectionObserver ?? globalThis.IntersectionObserver;
  let io = null;
  if (typeof IO === 'function') {
    io = new IO((entries) => {
      inView = entries[entries.length - 1].isIntersecting;
      sync();
    });
    io.observe(view);
  }

  paintOutputs(true);
  last = now();
  request();

  return {
    node,
    start: () => setPaused(false),
    stop: () => setPaused(true),
    togglePause: () => setPaused(!paused),
    setSlow,
    setWave,
    setFrequency,
    setAmplitude,
    get wave() { return shape; },
    get phase() { return phase; },
    get paused() { return paused; },
    get slow() { return slow; },
    get frequency() { return freq; },
    get amplitude() { return amp; },
    get animating() { return looping && animOn(); },
    destroy() {
      gone = true;
      ro?.disconnect();
      io?.disconnect();
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      sync();
    },
  };
}
