import { el } from './dom.js';
import { segmented } from './segmented.js';

export const TITLE = 'Harmonics stack';
export const CAPTION = 'Each row is one harmonic: a sine wave at a whole-number multiple of the fundamental. Add the rows and you get the bottom row: the shape of the sound.';
export const DETUNE_NOTE = 'The detune between strings is ignored here: every row is one clean sine wave.';
export const PERCENT_NOTE = 'The percent is the amplitude of the row against a full-strength H1.';
export const ROWS_LABEL = 'Rows';
export const ANIMATE_LABEL = 'Animate';
export const ROW_CHOICES = [4, 8, 12];
export const ROWS_DEFAULT = 8;
export const SCAN_MAX = 32;
export const CYCLE_S = 6;
export const NARROW_PX = 480;
export const ROW_H = 60;
export const ROW_H_NARROW = 52;
export const SUM_H = 136;
export const SUM_H_NARROW = 112;
export const PAD_Y = 6;
export const GUIDES = [0, 0.25, 0.5, 0.75, 1];
export const PEAK_POINTS = 720;
export const MAX_POINTS = 1200;

const TAU = 2 * Math.PI;
const EPS = 1e-9;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const partialCycles = (n, B = 0) => n * Math.sqrt(1 + B * n * n);

export function seriesAmp(wave, n) {
  const odd = n % 2 === 1;
  switch (wave) {
    case 'triangle': return odd ? (-1) ** ((n - 1) / 2) / (n * n) : 0;
    case 'square': return odd ? 1 / n : 0;
    case 'sawtooth': return (-1) ** (n + 1) / n;
    default: return n === 1 ? 1 : 0;
  }
}

export const makeHarmonic = (n, freqHz, signed, cycles = n) => ({ n, freqHz, amp: Math.abs(signed), sign: signed < 0 ? -1 : 1, cycles });

export function shapeHarmonics(wave, freq, max = SCAN_MAX) {
  const out = [];
  for (let n = 1; n <= max; n += 1) {
    const a = seriesAmp(wave, n);
    if (Math.abs(a) > EPS) out.push(makeHarmonic(n, n * freq, a));
  }
  return out;
}

export function barHarmonics(bars, freq) {
  const out = [];
  bars.forEach((v, i) => {
    if (Math.abs(v) > EPS) out.push(makeHarmonic(i + 1, (i + 1) * freq, v / 100));
  });
  return out;
}

export function synthHarmonics(rows, freq) {
  return rows
    .filter((r) => r.played && !r.muted && r.amp > EPS)
    .map((r) => makeHarmonic(r.n, r.freq, r.amp, r.freq / freq));
}

export function sumAt(list, t, phase = 0) {
  let s = 0;
  for (const h of list) s += h.sign * h.amp * Math.sin(TAU * h.cycles * (t + phase));
  return s;
}

export function sumPeak(list, points = PEAK_POINTS) {
  if (!list.length) return 0;
  let peak = 0;
  for (let i = 0; i <= points; i += 1) peak = Math.max(peak, Math.abs(sumAt(list, i / points)));
  return peak > EPS ? peak : 0;
}

export function sumSeries(list, points, { cycles = 1, phase = 0, peak = 0 } = {}) {
  const top = peak > 0 ? peak : sumPeak(list);
  const out = new Float64Array(points);
  if (!(top > 0)) return out;
  for (let i = 0; i < points; i += 1) out[i] = sumAt(list, (cycles * i) / (points - 1), phase) / top;
  return out;
}

export function rowSeries(h, scale, points, { cycles = 1, phase = 0 } = {}) {
  const out = new Float64Array(points);
  const k = scale > 0 ? (h.sign * h.amp) / scale : 0;
  for (let i = 0; i < points; i += 1) out[i] = k * Math.sin(TAU * h.cycles * ((cycles * i) / (points - 1) + phase));
  return out;
}

export function stackModel(harmonics, { rows = ROWS_DEFAULT, freq, highlightN, partialSumN } = {}) {
  const all = harmonics.filter((h) => h.amp > EPS).sort((a, b) => a.n - b.n);
  const count = Math.max(1, Math.round(Number.isFinite(rows) ? rows : ROWS_DEFAULT));
  const first = harmonics.find((h) => h.cycles > 0);
  const base = freq > 0 ? freq : first ? first.freqHz / first.cycles : 0;
  const byN = new Map(all.map((h) => [h.n, h]));
  const shown = base > 0 ? Array.from({ length: count }, (_, i) => byN.get(i + 1) ?? makeHarmonic(i + 1, (i + 1) * base, 0)) : all.slice(0, count);
  const limit = Number.isFinite(partialSumN) ? partialSumN : Infinity;
  const active = shown.filter((h) => h.n <= limit);
  const pool = all.filter((h) => h.n <= limit);
  const truncated = pool.length > active.filter((h) => h.amp > EPS).length;
  const cut = all.some((h) => h.n > limit);
  return {
    all,
    shown,
    active,
    pool,
    truncated,
    cut,
    total: all.length,
    scale: shown.reduce((m, h) => Math.max(m, h.amp), 0),
    highlightN: Number.isFinite(highlightN) ? highlightN : Infinity,
    partialSumN: limit,
    peak: sumPeak(active),
    fullPeak: truncated ? sumPeak(pool) : 0,
  };
}

export const fmtPct = (amp) => {
  const p = Math.abs(amp) * 100;
  return p >= 10 ? String(Math.round(p)) : String(+p.toPrecision(2));
};

export const fmtHz = (hz) => String(+hz.toPrecision(5));

export const signedPct = (h) => `${h.sign < 0 ? '-' : ''}${fmtPct(h.amp)}`;

export const rowLabel = (h, narrow = false) => (narrow
  ? `H${h.n} ${signedPct(h)} %`
  : `H${h.n} · ${fmtHz(h.freqHz)} Hz · ${signedPct(h)} %`);

export function sumLabels(model, narrow = false) {
  if (model.truncated) {
    return { title: `Sum of ${model.active.length}`, note: narrow ? `all ${model.pool.length}` : `faint: all ${model.pool.length}` };
  }
  if (model.cut && model.active.length) return { title: 'Sum', note: `first ${model.partialSumN}` };
  return { title: 'Sum', note: '' };
}

export function sumNote(model) {
  if (!model.total) return 'There are no harmonics: all amplitudes are zero, which is silence.';
  const zeros = model.shown.filter((h) => !(h.amp > EPS)).length;
  const head = `Showing H1 to H${model.shown.length}${zeros ? `; the ${zeros} at 0 % are flat lines` : ''}.`;
  if (model.truncated) return `${head} The bold Sum adds the ${model.active.length} rows shown; the faint line is the sum of all ${model.pool.length} harmonics.`;
  if (model.cut) return `${head} The Sum adds only the first ${model.partialSumN} harmonics (Build up).`;
  return `${head} The Sum adds all ${model.total} nonzero harmonic${model.total === 1 ? '' : 's'}.`;
}

export const tableRows = (model) => model.shown.map((h) => [
  `H${h.n}`,
  fmtHz(h.freqHz),
  `${fmtPct(h.amp)}`,
  h.sign < 0 ? 'inverted (180 degrees)' : 'normal (0 degrees)',
]);

export const stackHeight = (rows, narrow = false) => 2 * PAD_Y + rows * (narrow ? ROW_H_NARROW : ROW_H) + (narrow ? SUM_H_NARROW : SUM_H);

export function stackColors(node) {
  const css = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
  const get = (name, fallback) => css?.getPropertyValue(name).trim() || fallback;
  return {
    muted: get('--ink-muted', '#5f6669'),
    line: get('--line', '#ddd5c6'),
    fill: get('--fill', '#2298b1'),
    ink: get('--ink', '#1b2024'),
    font: get('--font-sans', 'system-ui, sans-serif'),
  };
}

function fitStack(canvas, rows, width) {
  const box = canvas.parentElement;
  const w = Math.max(1, Math.round(width || box?.clientWidth || canvas.clientWidth || 320));
  const narrow = w < NARROW_PX;
  const h = stackHeight(rows, narrow);
  const dpr = globalThis.devicePixelRatio || 1;
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  if (canvas.style) canvas.style.height = `${h}px`;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, narrow };
}

export function drawHarmonicsStack(canvas, opts = {}) {
  const model = opts.model ?? stackModel(opts.harmonics ?? [], opts);
  const cycles = opts.cycles ?? 1;
  const phase = opts.phase ?? 0;
  const g = fitStack(canvas, Math.max(model.shown.length, 1), opts.width);
  if (!g) return null;
  const { ctx, w, h, narrow } = g;
  const c = opts.colors ?? stackColors(canvas);
  const rh = narrow ? ROW_H_NARROW : ROW_H;
  const sh = narrow ? SUM_H_NARROW : SUM_H;
  const n = Math.max(model.shown.length, 1);
  const top = PAD_Y;
  const sumTop = top + n * rh;
  const bottom = sumTop + sh;
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const small = `${narrow ? 10 : 11}px ${c.font}`;
  const bold = `600 ${narrow ? 11 : 12}px ${c.font}`;
  const measure = (text, font) => {
    ctx.font = font;
    return ctx.measureText?.(text)?.width ?? text.length * 6;
  };
  const labels = model.shown.map((hm) => rowLabel(hm, narrow));
  const sum = sumLabels(model, narrow);
  let labelW = Math.max(measure(sum.title, bold), sum.note ? measure(sum.note, small) : 0);
  for (const text of labels) labelW = Math.max(labelW, measure(text, small));
  labelW = Math.min(Math.ceil(labelW) + 4, Math.round(w * 0.5));
  const x0 = 6 + labelW + 6;
  const x1 = w - 8;
  const plotW = Math.max(40, x1 - x0);
  const maxCycles = model.shown.reduce((m, hm) => Math.max(m, hm.cycles), 1);
  const points = clamp(Math.round(Math.max(plotW, maxCycles * cycles * 8)), 64, MAX_POINTS);
  const xAt = (i) => x0 + (i / (points - 1)) * plotW;
  const trace = (data, cy, half) => {
    ctx.beginPath();
    for (let i = 0; i < points; i += 1) {
      const y = cy - clamp(data[i], -1.3, 1.3) * half;
      if (i === 0) ctx.moveTo(xAt(i), y); else ctx.lineTo(xAt(i), y);
    }
    ctx.stroke();
  };

  ctx.lineWidth = 1;
  ctx.strokeStyle = c.line;
  for (let i = 1; i <= n; i += 1) {
    const y = Math.round(top + i * rh) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.save();
  ctx.setLineDash?.([1, 3]);
  for (const f of GUIDES) {
    const x = Math.round(x0 + f * plotW) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
  }
  ctx.setLineDash?.([3, 3]);
  const zeroLines = [...model.shown.map((_, i) => top + i * rh + rh / 2), sumTop + sh / 2];
  for (const cy of zeroLines) {
    ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
  }
  ctx.restore();

  if (!model.shown.length) {
    ctx.font = small;
    ctx.fillStyle = c.muted;
    ctx.textAlign = 'center';
    ctx.fillText('No harmonics: all amplitudes are zero', (x0 + x1) / 2, top + rh / 2);
    ctx.textAlign = 'left';
  }

  ctx.lineJoin = 'round';
  model.shown.forEach((hm, i) => {
    const cy = top + i * rh + rh / 2;
    const fade = 1 - 0.55 * (model.shown.length > 1 ? i / (model.shown.length - 1) : 0);
    const alpha = hm.n > model.highlightN ? 0.22 : fade;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = c.fill;
    ctx.lineWidth = 1.5;
    trace(rowSeries(hm, model.scale, points, { cycles, phase }), cy, rh / 2 - 3);
    ctx.fillStyle = c.muted;
    ctx.font = small;
    ctx.globalAlpha = hm.n > model.highlightN ? 0.45 : 1;
    ctx.fillText(labels[i], 6, cy);
  });
  ctx.globalAlpha = 1;

  const sumCy = sumTop + sh / 2;
  const half = sh / 2 - 5;
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, sumTop + 0.5); ctx.lineTo(w, sumTop + 0.5); ctx.stroke();
  if (model.truncated && model.fullPeak > 0) {
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = c.fill;
    ctx.lineWidth = 1.5;
    trace(sumSeries(model.pool, points, { cycles, phase, peak: model.fullPeak }), sumCy, half);
    ctx.globalAlpha = 1;
  }
  if (model.peak > 0) {
    ctx.strokeStyle = c.fill;
    ctx.lineWidth = 2.5;
    trace(sumSeries(model.active, points, { cycles, phase, peak: model.peak }), sumCy, half);
  }
  ctx.fillStyle = c.ink;
  ctx.font = bold;
  ctx.fillText(sum.title, 6, sumCy - (sum.note ? 7 : 0));
  if (sum.note) {
    ctx.fillStyle = c.muted;
    ctx.font = small;
    ctx.fillText(sum.note, 6, sumCy + 8);
  }
  return { model, width: w, height: h, narrow, labelW, points, x0, x1 };
}

export function createStackCard(env = {}) {
  const doc = env.document ?? globalThis.document;
  const raf = env.raf ?? ((fn) => globalThis.requestAnimationFrame?.(fn) ?? 0);
  const caf = env.caf ?? ((id) => globalThis.cancelAnimationFrame?.(id));
  const now = env.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const reduced = env.reducedMotion ?? (() => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  let rows = ROWS_DEFAULT;
  let animate = false;
  let phase = 0;
  let pending = false;
  let frame = 0;
  let lastT = 0;
  let visible = true;
  let gone = false;
  let state = null;
  let model = null;
  let colors = null;
  let colorsAt = 0;
  let tableKey = '';
  const off = [];

  const uid = `hs-${Math.random().toString(36).slice(2, 7)}`;
  const canvas = el('canvas', { class: 'hm-canvas hs-canvas', role: 'img', 'aria-describedby': `${uid}-t` });
  const table = el('table', { id: `${uid}-t` });
  const note = el('p', { class: 'hm-cap muted t-caption hs-note' });
  const extra = el('p', { class: 'hm-cap muted t-caption', hidden: true });
  const rowsSeg = segmented(ROW_CHOICES.map((n) => [n, String(n)]), () => rows, (n) => setRows(n), { 'aria-labelledby': `${uid}-rl` });
  const animBox = el('input', { id: `${uid}-an`, type: 'checkbox', checked: false, onchange: () => setAnimate(animBox.checked) });
  const view = el('div', { class: 'hm-view hs-view' }, canvas);

  const node = el('div', { class: 'hm-block hs-block' },
    el('div', { class: 'hm-head' },
      el('h3', { class: 't-subhead' }, TITLE),
      el('div', { class: 'hm-checks hs-ctl' },
        el('div', { class: 'hm-axis' }, el('span', { id: `${uid}-rl`, class: 'hm-lbl' }, ROWS_LABEL), rowsSeg.group),
        el('span', { class: 'hm-check' }, animBox, el('label', { htmlFor: `${uid}-an` }, ANIMATE_LABEL)))),
    el('p', { class: 'hm-cap muted t-caption' }, CAPTION),
    view,
    note,
    extra,
    el('div', { class: 'hs-sr' }, table));

  const currentColors = () => {
    const t = now();
    if (!colors || t - colorsAt > 500) { colors = stackColors(canvas); colorsAt = t; }
    return colors;
  };

  const want = () => animate && !gone && visible && !doc?.hidden;

  function syncLoop() {
    if (want()) {
      if (!pending) { pending = true; lastT = now(); frame = raf(tick); }
    } else if (pending) {
      pending = false;
      caf(frame);
      frame = 0;
    }
  }

  function tick() {
    pending = false;
    frame = 0;
    if (!want()) return;
    const t = now();
    phase = (phase + Math.min(0.25, Math.max(0, (t - lastT) / 1000)) / CYCLE_S) % 1;
    lastT = t;
    draw();
    pending = true;
    frame = raf(tick);
  }

  function draw() {
    if (gone || !model) return;
    drawHarmonicsStack(canvas, { model, phase, colors: currentColors() });
  }

  function describe() {
    const list = model.shown;
    const span = list.length ? `H${list[0].n} to H${list.at(-1).n}` : 'none';
    const freq = state.freq ? ` of ${fmtHz(state.freq)} Hz` : '';
    canvas.setAttribute('aria-label', `Harmonics stack${freq}: ${list.length} sine wave rows (${span}), one per harmonic, and the bottom row Sum, the shape of the sound. ${sumNote(model)}`);
    const rowsText = tableRows(model);
    const key = JSON.stringify(rowsText);
    if (key === tableKey) return;
    tableKey = key;
    table.replaceChildren(
      el('caption', {}, 'Harmonics shown in the stack'),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Harmonic'), el('th', { scope: 'col' }, 'Frequency (Hz)'), el('th', { scope: 'col' }, 'Amplitude (% of a full-strength H1)'), el('th', { scope: 'col' }, 'Phase'))),
      el('tbody', {}, ...rowsText.map((r) => el('tr', {}, ...r.map((cell, i) => el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : {}, cell))))));
  }

  function paint() {
    if (gone || !state) return;
    model = stackModel(state.harmonics, { rows, freq: state.freq, highlightN: state.highlightN, partialSumN: state.partialSumN });
    note.textContent = `${sumNote(model)} ${PERCENT_NOTE}`;
    extra.hidden = !state.extra;
    extra.textContent = state.extra ?? '';
    animBox.disabled = reduced();
    if (animBox.disabled && animate) { animate = false; animBox.checked = false; }
    rowsSeg.paint();
    describe();
    draw();
  }

  function setRows(n) {
    if (!ROW_CHOICES.includes(n) || n === rows) return;
    rows = n;
    paint();
  }

  function setAnimate(on) {
    animate = !!on && !reduced();
    animBox.checked = animate;
    if (!animate) phase = 0;
    syncLoop();
    if (!animate) draw();
  }

  function listen(target, type, fn) {
    target?.addEventListener?.(type, fn);
    off.push(() => target?.removeEventListener?.(type, fn));
  }
  listen(doc, 'visibilitychange', syncLoop);

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { if (!gone && model) draw(); });
    ro.observe(view);
  }
  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((entries) => {
      visible = entries.length ? entries[entries.length - 1].isIntersecting : true;
      syncLoop();
    });
    io.observe(view);
  }

  rowsSeg.paint();

  return {
    node,
    canvas,
    get rows() { return rows; },
    get animating() { return animate; },
    get pending() { return pending; },
    get model() { return model; },
    update(next) {
      state = next;
      paint();
    },
    setRows,
    setAnimate,
    dispose() {
      gone = true;
      syncLoop();
      ro?.disconnect();
      io?.disconnect();
      while (off.length) off.pop()();
    },
  };
}
