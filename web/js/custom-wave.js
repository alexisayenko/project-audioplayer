export const CUSTOM = 'custom';
export const MAX_HARMONICS = 32;
export const VISIBLE_HARMONICS = 16;
export const TABLE_N = 1024;
export const BAR_MIN = -100;
export const BAR_MAX = 100;
export const PLAY_LIMIT_HZ = 20000;
export const SHOW_EACH_MAX = 8;
export const SMALL_JUMP = 0.08;

const TAU = 2 * Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const clampBar = (v) => (Number.isFinite(v) ? clamp(v, BAR_MIN, BAR_MAX) : 0);

export const snapBar = (v, fine = false) => clampBar(fine ? Math.round(v * 10) / 10 : Math.round(v));

export const emptyBars = (count = MAX_HARMONICS) => new Array(count).fill(0);

export const defaultBars = (count = MAX_HARMONICS) => emptyBars(count).map((_, i) => (i === 0 ? 100 : 0));

const fromRule = (rule, count) => Array.from({ length: count }, (_, i) => rule(i + 1));

const odd = (n) => n % 2 === 1;

export const RECIPES = {
  sine: (n) => (n === 1 ? 100 : 0),
  triangle: (n) => (odd(n) ? ((-1) ** ((n - 1) / 2) * 100) / (n * n) : 0),
  square: (n) => (odd(n) ? 100 / n : 0),
  sawtooth: (n) => 100 / n,
  organ: (n) => [100, 80, 60, 40, 30][n - 1] ?? 0,
  piano: (n) => [100, 65, 45, 30, 20, 14, 9, 6, 4, 3, 2, 1][n - 1] ?? 0,
  guitar: (n) => [100, 75, 50, 20, 3, 14, 10, 5, 3, 1, 2, 2][n - 1] ?? 0,
  hollow: (n) => (odd(n) ? [100, 60, 40, 25, 15, 10, 6, 4][(n - 1) / 2] ?? 0 : 0),
  overtones: (n) => (n >= 2 && n <= 8 ? 100 / n : 0),
  clear: () => 0,
};

export const PRESETS = [
  { id: 'sine', label: 'Sine', title: 'Sine: H1 only.' },
  { id: 'triangle', label: 'Triangle', title: 'Triangle: odd harmonics at 1/n squared, signs alternate (+, -, +, ...).' },
  { id: 'square', label: 'Square', title: 'Square: odd harmonics at 1/n.' },
  { id: 'sawtooth', label: 'Sawtooth', title: 'Sawtooth: all harmonics at 1/n (a falling ramp; the Sawtooth option rises, the sound is the same).' },
  { id: 'organ', label: 'Organ-like', title: 'Organ-like: a simple hand-picked approximation, not measured from a real organ. H1 100, H2 80, H3 60, H4 40, H5 30 percent.' },
  { id: 'piano', label: 'Piano-like', title: 'Piano-like: a simple approximation of a struck string, not measured from a real piano. H1 100, H2 65, H3 45, H4 30, H5 20, H6 14, H7 9, H8 6, H9 4, H10 3, H11 2, H12 1 percent.' },
  { id: 'guitar', label: 'Guitar-like', title: 'Guitar-like: a simple approximation of a plucked string, not measured from a real guitar. H1 100, H2 75, H3 50, H4 20, H5 3, H6 14, H7 10, H8 5, H9 3, H10 1, H11 2, H12 2 percent.' },
  { id: 'hollow', label: 'Hollow', title: 'Hollow: odd harmonics only, falling off.' },
  { id: 'overtones', label: 'Only overtones', title: 'Missing fundamental: H1 is 0, H2 to H8 at 1/n. You still hear the pitch of H1, because the wave still repeats at that rate and the brain infers it from the spacing of the overtones.' },
  { id: 'clear', label: 'Clear', title: 'Clear: all bars to zero (silence).' },
];

export const presetBars = (id, count = MAX_HARMONICS) => fromRule(RECIPES[id] ?? RECIPES.clear, count);

export const matchesPreset = (bars, id, eps = 0.05) => {
  const want = presetBars(id, bars.length);
  return want.every((v, i) => Math.abs(v - bars[i]) <= eps);
};

export const highestHarmonic = (bars) => {
  for (let i = bars.length - 1; i >= 0; i -= 1) if (bars[i] !== 0) return i + 1;
  return 0;
};

export const partialBars = (bars, n) => bars.map((v, i) => (i < n ? v : 0));

export const aboveLimit = (freq, bars, limit = PLAY_LIMIT_HZ) => freq * highestHarmonic(bars) > limit;

export const harmonicHz = (freq, n) => freq * n;

let SIN = null;
const sinTable = () => {
  if (!SIN) SIN = Float64Array.from({ length: TABLE_N }, (_, i) => Math.sin((TAU * i) / TABLE_N));
  return SIN;
};

export function harmonicTable(bars) {
  const sin = sinTable();
  const out = new Float64Array(TABLE_N);
  for (let k = 0; k < bars.length; k += 1) {
    const c = bars[k] / 100;
    if (c === 0) continue;
    const h = k + 1;
    for (let i = 0; i < TABLE_N; i += 1) out[i] += c * sin[(h * i) % TABLE_N];
  }
  return out;
}

export function analyzeBars(bars) {
  const raw = harmonicTable(bars);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < TABLE_N; i += 1) {
    const a = Math.abs(raw[i]);
    if (a > peak) peak = a;
    sum += raw[i] * raw[i];
  }
  if (!(peak > 1e-9)) return { table: new Float64Array(TABLE_N), peak: 0, rms: 0, scale: 0 };
  const scale = 1 / peak;
  const table = raw.map((v) => v * scale);
  return { table, peak, rms: Math.sqrt(sum / TABLE_N) * scale, scale };
}

export function customGain(amp, rms, maxAmp = 0.8) {
  return amp > 0 && rms > 0 ? Math.min(maxAmp, (amp * Math.SQRT1_2) / rms) : 0;
}

export function periodicCoefficients(bars, scale, maxHarmonic = MAX_HARMONICS) {
  const n = Math.min(maxHarmonic, bars.length);
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k += 1) imag[k] = (bars[k - 1] / 100) * scale;
  return { real, imag };
}

export function tableAt(table, u) {
  const x = (u - Math.floor(u)) * table.length;
  const i = Math.floor(x);
  const f = x - i;
  return table[i % table.length] * (1 - f) + table[(i + 1) % table.length] * f;
}

export function maxJump(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i += 1) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

export function strongest(bars, count = SHOW_EACH_MAX) {
  return bars
    .map((v, i) => ({ n: i + 1, v }))
    .filter((e) => e.v !== 0)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v) || a.n - b.n)
    .slice(0, count);
}

export function componentSeries(entry, scale, points, cycles = 1) {
  const out = new Array(points);
  for (let i = 0; i < points; i += 1) out[i] = (entry.v / 100) * scale * Math.sin(TAU * entry.n * cycles * (i / (points - 1)));
  return out;
}

export function tableSeries(table, amp, points, cycles = 1) {
  const out = new Array(points);
  for (let i = 0; i < points; i += 1) out[i] = amp * tableAt(table, cycles * (i / (points - 1)));
  return out;
}

export const fmtBar = (v) => String(+(+v).toFixed(1));

export const barLabel = (n, freq, v) => `Harmonic ${n}, ${String(+(freq * n).toPrecision(5))} Hz, ${fmtBar(v)} percent`;

export const hoverText = (n, freq, v) => `H${n} · ${String(+(freq * n).toPrecision(5))} Hz · ${fmtBar(v)} %`;

export function keyStep(key, shift) {
  const big = shift ? 10 : 1;
  switch (key) {
    case 'ArrowUp': case 'ArrowRight': return { by: big };
    case 'ArrowDown': case 'ArrowLeft': return { by: -big };
    case 'PageUp': return { by: 10 };
    case 'PageDown': return { by: -10 };
    case 'Home': return { to: BAR_MIN };
    case 'End': return { to: BAR_MAX };
    case 'Delete': case 'Backspace': return { to: 0 };
    default: return null;
  }
}

export function stepBar(value, step) {
  if (!step) return value;
  const next = 'to' in step ? step.to : Math.round((value + step.by) * 10) / 10;
  return clampBar(next);
}
