export const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
export const WAVE_DEFAULT = 'sine';
export const WAVE_LABEL = 'Waveform';
export const WAVE_TEXT = { sine: 'Sine', triangle: 'Triangle', square: 'Square', sawtooth: 'Sawtooth' };
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
export const WAVE_RMS = { sine: Math.SQRT1_2, triangle: 1 / Math.sqrt(3), square: 1, sawtooth: 1 / Math.sqrt(3) };

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

export const GIBBS = 1.1789797444721675;
export const OSC_NORM = { sine: 1, triangle: 1, square: 1 / GIBBS, sawtooth: 1 / GIBBS };

export const waveRms = (wave) => WAVE_RMS[waveName(wave)];

export const oscNorm = (wave) => OSC_NORM[waveName(wave)];

export const loudnessScale = (wave) => WAVE_RMS.sine / waveRms(wave);

export const wavePowerPct = (wave, peak) => 200 * (peak * waveRms(wave)) ** 2;

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

const SVG_NS = 'http://www.w3.org/2000/svg';
export const HARM_BOX = { w: 320, h: 120, left: 32, right: 316, top: 8, base: 90, bar: 11, tick: 1.5 };

export function svgEl(tag, attrs = {}, ...kids) {
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
  custom: 'M4 8 V12 M9 3 V17 M14 6 V14 M19 2 V18 M24 7 V13',
};

export const waveGlyph = (wave) => svgEl('svg', { class: 'ca-glyph', viewBox: '0 0 28 20', 'aria-hidden': 'true', focusable: 'false' },
  svgEl('path', { d: WAVE_GLYPH[wave], fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

export const harmonicCell = (n, count = HARM_COUNT) => (HARM_BOX.right - HARM_BOX.left) / count * (n - 0.5) + HARM_BOX.left;

export function harmonicLabel(wave, amps) {
  const parts = amps.map((a, i) => (a > 0 ? `H${i + 1} ${+a.toPrecision(3)}` : null)).filter(Boolean);
  return `Bar chart of the harmonics of a ${wave} wave, relative amplitude with H1 = 1: ${parts.join(', ')}`;
}

export function createHarmonicsChart() {
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
