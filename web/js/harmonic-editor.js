import { el } from './dom.js';
import { svgEl } from './wave-shapes.js';
import { MAX_HARMONICS, VISIBLE_HARMONICS, BAR_MIN, BAR_MAX, PRESETS, matchesPreset, snapBar, barLabel, hoverText, keyStep, stepBar, fmtBar } from './custom-wave.js';

export const ED = { cell: 18, left: 34, right: 6, top: 10, half: 64, h: 162 };
ED.zero = ED.top + ED.half;
ED.plotBottom = ED.zero + ED.half;

export const READ_DEFAULT = 'Drag a bar up or down (hold Shift for 0.1 steps), or focus one and use the arrow keys. Hover or focus a bar to see its frequency.';
export const TITLE = 'Harmonics: drag the bars (H1 = 100 %)';
export const EACH_LABEL = 'Show each harmonic';
export const MORE_LABEL = 'More harmonics (up to 32)';
export const BUILD_LABEL = 'Build up: show the first N harmonics';
export const PLAY_BUILD_LABEL = 'Play the build-up too';
export const BUILD_NOTE = 'The scopes draw the sum of the first N bars; the sound keeps all bars unless "Play the build-up too" is on.';
export const TIP = 'Any repeating shape is a sum of sine waves at whole-number multiples of the frequency. Each bar is the height of one of them, as a percent of H1 = 100 (up is +, down is -). The sign flips that sine upside down: the sum is bars x sin(n x phase), so the Sawtooth preset is a falling ramp (the Sawtooth option rises; the sound is the same) and Triangle alternates +, -, +. Loudness is matched to the other shapes, so only the shape changes, not the volume.';

export const edWidth = (count) => ED.left + count * ED.cell + ED.right;

export const columnAt = (x) => Math.floor((x - ED.left) / ED.cell);

export const valueAt = (y, fine = false) => snapBar(((ED.zero - y) / ED.half) * 100, fine);

export function barExtent(v) {
  const len = (Math.abs(v) / 100) * ED.half;
  return v >= 0 ? { y: ED.zero - len, h: len } : { y: ED.zero, h: len };
}

export const columnX = (i) => ED.left + i * ED.cell;

export function createHarmonicEditor(handlers) {
  const uid = `he-${Math.random().toString(36).slice(2, 7)}`;
  const state = { bars: [], count: VISIBLE_HARMONICS, freq: 440, buildN: MAX_HARMONICS };
  let lastCount = 0;
  let drag = null;

  const grid = [];
  const line = (cls, y) => { const n = svgEl('line', { class: cls, y1: y, y2: y, x1: ED.left }); grid.push(n); return n; };
  const lines = [
    line('ca-axis', ED.top), line('ca-axis', ED.zero - ED.half / 2), line('he-zero', ED.zero),
    line('ca-axis', ED.zero + ED.half / 2), line('ca-axis', ED.plotBottom),
  ];
  const yText = [[ED.top, '+100'], [ED.zero, '0'], [ED.plotBottom, '-100']].map(([y, t]) => Object.assign(
    svgEl('text', { class: 'ca-axis-text', x: ED.left - 4, y: y + 3, 'text-anchor': 'end' }), { textContent: t }));

  const cols = Array.from({ length: MAX_HARMONICS }, (_, i) => {
    const bar = svgEl('rect', { class: 'ca-bar he-bar', x: columnX(i) + 3, width: ED.cell - 6, y: ED.zero, height: 0 });
    const num = Object.assign(svgEl('text', { class: 'ca-axis-text he-num', x: columnX(i) + ED.cell / 2, y: ED.plotBottom + 13, 'text-anchor': 'middle' }), { textContent: String(i + 1) });
    const hit = svgEl('rect', {
      class: 'he-hit', x: columnX(i), y: 0, width: ED.cell, height: ED.plotBottom + 2, tabindex: 0, role: 'slider', 'data-h': i + 1,
      'aria-orientation': 'vertical', 'aria-valuemin': BAR_MIN, 'aria-valuemax': BAR_MAX, 'aria-valuenow': 0,
    });
    const title = svgEl('title');
    hit.append(title);
    hit.addEventListener('keydown', (ev) => {
      const step = keyStep(ev.key, ev.shiftKey);
      if (!step) return;
      ev.preventDefault();
      handlers.onSet(i, stepBar(state.bars[i] ?? 0, step));
    });
    hit.addEventListener('focus', () => showReadout(i));
    hit.addEventListener('blur', () => showReadout(-1));
    return { bar, num, hit, title };
  });

  const svg = svgEl('svg', { class: 'ca-harm he-svg', viewBox: `0 0 ${edWidth(VISIBLE_HARMONICS)} ${ED.h}`, role: 'group', 'aria-label': 'Harmonic bars editor: one slider per harmonic', preserveAspectRatio: 'xMidYMid meet' },
    ...lines, ...yText, ...cols.map((c) => c.bar), ...cols.map((c) => c.num), ...cols.map((c) => c.hit));
  const scroll = el('div', { class: 'he-scroll' }, svg);
  const read = el('p', { class: 'hm-cap muted t-caption he-read' }, READ_DEFAULT);

  function showReadout(i) {
    if (i < 0 || i >= state.count) { read.textContent = READ_DEFAULT; return; }
    read.textContent = hoverText(i + 1, state.freq, state.bars[i] ?? 0);
  }

  function locate(ev) {
    const r = svg.getBoundingClientRect?.();
    if (!r || !r.width || !r.height) return null;
    const k = edWidth(state.count) / r.width;
    const x = (ev.clientX - r.left) * k;
    const y = (ev.clientY - r.top) * (ED.h / r.height);
    return { col: columnAt(x), y };
  }

  function apply(ev, spot) {
    const col = Math.min(state.count - 1, Math.max(0, spot.col));
    const v = valueAt(spot.y, ev.shiftKey);
    const from = drag?.col ?? col;
    const fromV = drag?.v ?? v;
    const lo = Math.min(from, col);
    const hi = Math.max(from, col);
    for (let c = lo; c <= hi; c += 1) {
      const t = hi === lo ? 1 : (c - from) / (col - from);
      handlers.onSet(c, snapBar(fromV + (v - fromV) * t, ev.shiftKey));
    }
    if (drag) { drag.col = col; drag.v = v; }
    showReadout(col);
  }

  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    const spot = locate(ev);
    if (!spot || spot.col < 0 || spot.col >= state.count) return;
    ev.preventDefault();
    try { svg.setPointerCapture?.(ev.pointerId); } catch { /* capture is optional */ }
    cols[spot.col].hit.focus?.({ preventScroll: true });
    drag = { id: ev.pointerId, col: spot.col, v: valueAt(spot.y, ev.shiftKey) };
    apply(ev, spot);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (drag && ev.pointerType === 'mouse' && ev.buttons === 0) drag = null;
    const spot = locate(ev);
    if (!spot) return;
    if (drag && drag.id === ev.pointerId) { apply(ev, spot); return; }
    showReadout(spot.col >= 0 && spot.col < state.count ? spot.col : -1);
  });
  const end = (ev) => { if (drag && drag.id === ev.pointerId) drag = null; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('lostpointercapture', end);
  svg.addEventListener('pointerleave', (ev) => { if (!drag) showReadout(-1); end(ev); });

  const chips = PRESETS.map((p) => ({
    id: p.id,
    node: el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', title: p.title, onclick: () => handlers.onPreset(p.id) }, p.label),
  }));
  const resetBtn = el('button', { class: 'chip', type: 'button', title: 'Back to the starting shape: a sine (H1 only), 32 bars, no build-up.', onclick: () => handlers.onReset() }, 'Reset');
  const presets = el('div', { class: 'cl-presets he-presets', role: 'group', 'aria-label': 'Presets' }, ...chips.map((c) => c.node), resetBtn);

  const check = (id, text, onchange) => {
    const box = el('input', { id: `${uid}-${id}`, type: 'checkbox' });
    box.addEventListener('change', () => onchange(box.checked));
    return { box, node: el('span', { class: 'hm-check' }, box, el('label', { htmlFor: `${uid}-${id}` }, text)) };
  };
  const each = check('each', EACH_LABEL, (b) => handlers.onEach(b));
  const more = check('more', MORE_LABEL, (b) => handlers.onMore(b));
  const playBuild = check('pb', PLAY_BUILD_LABEL, (b) => handlers.onPlayBuild(b));
  const buildOut = el('output', { class: 'hm-note t-subhead', htmlFor: `${uid}-bu` });
  const buildRange = el('input', { id: `${uid}-bu`, class: 'slider hm-range', type: 'range', min: '1', max: String(MAX_HARMONICS), step: '1', value: String(MAX_HARMONICS) });
  buildRange.addEventListener('input', () => { const n = parseInt(buildRange.value, 10); if (Number.isFinite(n)) handlers.onBuild(n); });
  const build = el('div', { class: 'hm-field he-build' },
    el('div', { class: 'sm-lab' }, el('label', { htmlFor: `${uid}-bu` }, BUILD_LABEL), buildOut),
    buildRange,
    el('p', { class: 'hm-cap muted t-caption' }, BUILD_NOTE),
    playBuild.node);
  const notes = el('div', { class: 'he-notes' });

  const node = el('div', { class: 'he' },
    read,
    scroll,
    presets,
    el('div', { class: 'hm-checks he-opts' }, each.node, more.node),
    build,
    notes);

  function paint(next) {
    Object.assign(state, next);
    const { bars, count, freq, buildN } = state;
    if (count !== lastCount) {
      lastCount = count;
      svg.setAttribute('viewBox', `0 0 ${edWidth(count)} ${ED.h}`);
      svg.setAttribute('class', `ca-harm he-svg${count > VISIBLE_HARMONICS ? ' he-wide' : ''}`);
      for (const l of grid) l.setAttribute('x2', edWidth(count) - ED.right);
    }
    cols.forEach((c, i) => {
      const shown = i < count;
      const v = bars[i] ?? 0;
      for (const part of [c.bar, c.num, c.hit]) part.setAttribute('display', shown ? 'inline' : 'none');
      if (!shown) return;
      const { y, h } = barExtent(v);
      c.bar.setAttribute('y', y.toFixed(2));
      c.bar.setAttribute('height', Math.max(h, v === 0 ? 1.5 : 0).toFixed(2));
      c.bar.setAttribute('class', `ca-bar he-bar${v === 0 ? ' he-zero-bar' : ''}${i >= buildN ? ' he-off' : ''}`);
      c.hit.setAttribute('aria-valuenow', fmtBar(v));
      const label = barLabel(i + 1, freq, v);
      c.hit.setAttribute('aria-label', label);
      c.title.textContent = hoverText(i + 1, freq, v);
    });
    for (const c of chips) {
      const on = matchesPreset(bars, c.id);
      c.node.classList.toggle('on', on);
      c.node.setAttribute('aria-pressed', String(on));
    }
    each.box.checked = !!state.showEach;
    more.box.checked = count > VISIBLE_HARMONICS;
    playBuild.box.checked = !!state.playBuild;
    buildRange.value = String(buildN);
    buildOut.textContent = `N = ${buildN}`;
    notes.replaceChildren(...(state.notes ?? []).map((t) => el('p', { class: 'hm-cap t-caption he-note', role: 'status' }, t)));
    if (read.textContent !== READ_DEFAULT) {
      const focused = cols.findIndex((c) => c.hit === (globalThis.document?.activeElement));
      if (focused >= 0) showReadout(focused);
    }
  }

  return { node, svg, hits: cols.map((c) => c.hit), paint, showReadout };
}
