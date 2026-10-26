import { gt } from './cmp.js';
import { el } from './dom.js';
import { segmented } from './segmented.js';
import { liveBpmLabel } from './bpm-label.js';
import { WINDOWS_S, MIN_PERIODS } from './live-bpm.js';
import { parseColor } from './viz-color.js';
import { css, fit, trackHover, view, clamp } from './listen-views.js';

export const WINDOW_LABELS = WINDOWS_S.map((s, i) => (i === 0 ? `Last ${s} s` : `${s} s`));
export const LEGEND_LABELS = WINDOWS_S.map((s) => `${s} s`);
export const DRIFT_TOLERANCE = 0.03;
export const NO_DATA_TIP = `Needs at least ${MIN_PERIODS} beats in the window`;
export const WINDOWS_TITLE = 'Tempo by analysis window';
export const WINDOWS_CAPTION = 'Short windows react fast but are noisy; long windows are stable. If all agree the tempo is steady.';
export const KEY_DRIFT = ` = differs from the main BPM by more than ${DRIFT_TOLERANCE * 100} percent.`;
export const KEY_BAR = ' = confidence: how clearly the rhythm repeats in that window.';
export const KEY_DASH = `- = not enough beats in the window yet (needs at least ${MIN_PERIODS}).`;
export const GRAPH_TITLE ='BPM over time';
export const SPANS = [60, 120, 300];
export const DEFAULT_SPAN_S = 120;
export const SPAN_LABELS = { 60: '1 min', 120: '2 min', 300: '5 min' };
export const HISTORY_KEEP_S = 300;
export const LOG_RATIO = 1.5;
export const RANGE_PAD = 0.1;
export const GAP_S = 2.5;
export const HOVER_MAX_S = 3;
export const SERIES_TOKENS = ['--chart-2', '--chart-5', '--chart-4', '--chart-7', '--chart-6', '--chart-3'];
export const THICK_WINDOWS = [8, 30];
export const GRAPH_PAD = { left: 42, right: 10, top: 8, bottom: 20 };
export const EMPTY_RANGE = { lo: 60, hi: 180, log: false };
export const GRAPH_EMPTY_TEXT = 'No tempo yet';

export const drifts = (main, bpm) => main > 0 && bpm > 0 && Math.abs(bpm / main - 1) > DRIFT_TOLERANCE;

export const readoutText = (res) => (res ? liveBpmLabel(res.bpm) : '-');

export const confidencePercent = (res) => (res ? Math.round(100 * clamp(res.confidence, 0, 1)) : 0);

export function readoutLabel(label, res) {
  return res ? `${label}: ${liveBpmLabel(res.bpm)} BPM, confidence ${confidencePercent(res)} percent` : `${label}: ${NO_DATA_TIP.toLowerCase()}`;
}

export function createHistory(keepS = HISTORY_KEEP_S) {
  let list = [];
  return {
    get list() { return list; },
    clear() { list = []; },
    push(t, results) {
      list.push({ t, v: results.map((r) => (r ? r.bpm : null)), c: results.map((r) => (r ? r.confidence : 0)) });
      const cut = t - keepS * 1000;
      let drop = 0;
      while (drop < list.length - 1 && list[drop].t < cut) drop += 1;
      if (drop) list = list.slice(drop);
    },
  };
}

function visibleExtent(list, from, visible) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of list) {
    if (s.t < from) continue;
    for (let k = 0; k < s.v.length; k += 1) {
      const v = s.v[k];
      if (v === null || !visible[k]) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return { lo, hi };
}

export function plotRange(list, endT, spanS, visible) {
  const { lo, hi } = visibleExtent(list, endT - spanS * 1000, visible);
  if (!gt(hi, 0)) return null;
  if (hi / lo > LOG_RATIO) {
    const pad = Math.log(hi / lo) * RANGE_PAD;
    return { lo: lo * Math.exp(-pad), hi: hi * Math.exp(pad), log: true };
  }
  const pad = hi > lo ? (hi - lo) * RANGE_PAD : Math.max(1, hi * 0.05);
  return { lo: Math.max(0, lo - pad), hi: hi + pad, log: false };
}

export function yFraction(v, range) {
  return range.log ? Math.log(v / range.lo) / Math.log(range.hi / range.lo) : (v - range.lo) / (range.hi - range.lo);
}

const NICE = [1, 2, 2.5, 5, 10];

function linearTicks(lo, hi, target = 4) {
  const rough = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = (NICE.find((n) => n * mag >= rough) ?? 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

const LOG_SETS = [[1, 2, 5], [1, 1.5, 2, 3, 4, 5, 7], [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9]];

function logTicks(lo, hi) {
  const first = Math.floor(Math.log10(lo));
  const last = Math.ceil(Math.log10(hi));
  let best = [];
  for (const set of LOG_SETS) {
    const out = [];
    for (let e = first; e <= last; e += 1) for (const m of set) {
      const v = m * 10 ** e;
      if (v >= lo && v <= hi) out.push(+v.toPrecision(12));
    }
    best = out;
    if (out.length >= 3) break;
  }
  return best;
}

export const axisTicks = (range) => (range.log ? logTicks(range.lo, range.hi) : linearTicks(range.lo, range.hi));

export const fmtAxis = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function agoText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s === 0) return 'now';
  if (s < 60) return `${s} s ago`;
  return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s ago` : `${s / 60} min ago`;
}

export function timeTicks(spanS) {
  let step = 60;
  if (spanS <= 60) step = 15;
  else if (spanS <= 120) step = 30;
  const out = [];
  for (let s = 0; s <= spanS; s += step) out.push(s);
  return out;
}

export function timeTickText(s) {
  if (s === 0) return 'now';
  return s < 60 ? `-${s} s` : `-${s / 60} min`;
}

export function graphGeo(w, h) {
  const { left, right, top, bottom } = GRAPH_PAD;
  return { left, top, plotW: Math.max(1, w - left - right), plotH: Math.max(1, h - top - bottom) };
}

export const timeX = (t, endT, spanS, geo) => geo.left + geo.plotW * (1 - (endT - t) / (spanS * 1000));

function hoverRows(hit, visible) {
  const rows = [];
  for (let k = 0; k < hit.v.length; k += 1) if (visible[k] && hit.v[k] !== null) rows.push({ k, text: liveBpmLabel(hit.v[k]) });
  return rows;
}

export function graphHover(px, list, endT, spanS, geo, visible) {
  if (!(px >= geo.left && px <= geo.left + geo.plotW)) return null;
  const t = endT - (1 - (px - geo.left) / geo.plotW) * spanS * 1000;
  let near = null;
  for (const s of list) if (!near || Math.abs(s.t - t) < Math.abs(near.t - t)) near = s;
  const hit = near && Math.abs(near.t - t) <= HOVER_MAX_S * 1000 ? near : null;
  const rows = hit ? hoverRows(hit, visible) : [];
  const at = hit ? hit.t : t;
  return { x: hit ? timeX(hit.t, endT, spanS, geo) : px, title: agoText(endT - at), rows, empty: !rows.length };
}

export function readSeries(node) {
  const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
  return SERIES_TOKENS.map((token, i) => parseColor(style?.getPropertyValue(token).trim(), [90 + i * 25, 120, 160]));
}

const LINE_ALPHA = 0.85;

function drawAxes(g, pal, geo, range, spanS) {
  const { ctx } = g;
  ctx.font = `10px ${pal.font}`;
  ctx.lineWidth = 1;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (const v of axisTicks(range)) {
    const y = Math.round(geo.top + geo.plotH * (1 - yFraction(v, range))) + 0.5;
    ctx.strokeStyle = css(pal.line);
    ctx.beginPath(); ctx.moveTo(geo.left, y); ctx.lineTo(geo.left + geo.plotW, y); ctx.stroke();
    ctx.fillStyle = css(pal.muted);
    ctx.fillText(fmtAxis(v), geo.left - 5, y);
  }
  ctx.textBaseline = 'alphabetic';
  for (const s of timeTicks(spanS)) {
    const x = geo.left + geo.plotW * (1 - s / spanS);
    ctx.strokeStyle = css(pal.line, 0.6);
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, geo.top); ctx.lineTo(Math.round(x) + 0.5, geo.top + geo.plotH); ctx.stroke();
    ctx.fillStyle = css(pal.muted);
    ctx.textAlign = 'center';
    if (s === 0) ctx.textAlign = 'right';
    else if (s === spanS) ctx.textAlign = 'left';
    ctx.fillText(timeTickText(s), x, geo.top + geo.plotH + 14);
  }
}

function startRun(ctx, geo, model, range, prevT, prevV) {
  ctx.beginPath();
  ctx.moveTo(timeX(prevT, model.endT, model.spanS, geo), geo.top + geo.plotH * (1 - yFraction(prevV, range)));
}

function isAlone(list, i, k) {
  const next = list[i + 1];
  return !next || next.v[k] === null || (next.t - list[i].t) / 1000 > GAP_S;
}

function lineStep(ctx, geo, model, range, k, run, i) {
  const { list, endT, spanS } = model;
  const s = list[i];
  const v = s.v[k];
  if (v === null) { run.prev = null; return; }
  const x = timeX(s.t, endT, spanS, geo);
  const y = geo.top + geo.plotH * (1 - yFraction(v, range));
  if (run.prev !== null && (s.t - run.prev) / 1000 <= GAP_S) {
    if (!run.open) { startRun(ctx, geo, model, range, run.prev, list[i - 1].v[k]); run.open = true; }
    ctx.lineTo(x, y);
  } else {
    if (run.open) { ctx.stroke(); run.open = false; }
    if (isAlone(list, i, k)) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }
  run.prev = s.t;
}

function drawLine(ctx, pal, geo, model, range, k) {
  const { list, endT, spanS } = model;
  const from = endT - (spanS + GAP_S) * 1000;
  ctx.strokeStyle = css(pal.series[k], LINE_ALPHA);
  ctx.fillStyle = css(pal.series[k], LINE_ALPHA);
  ctx.lineWidth = THICK_WINDOWS.includes(WINDOWS_S[k]) ? 2 : 1.2;
  const run = { prev: null, open: false };
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].t < from) continue;
    lineStep(ctx, geo, model, range, k, run, i);
  }
  if (run.open) ctx.stroke();
}

function drawSeries(g, pal, geo, model, range) {
  const { ctx } = g;
  ctx.save();
  ctx.beginPath();
  ctx.rect(geo.left, geo.top - 2, geo.plotW, geo.plotH + 4);
  ctx.clip();
  ctx.lineJoin = 'round';
  for (let k = 0; k < WINDOWS_S.length; k += 1) if (model.visible[k]) drawLine(ctx, pal, geo, model, range, k);
  ctx.restore();
}

function drawHover(g, pal, geo, hover, model, range) {
  const { list, endT, spanS } = model;
  const { ctx, w } = g;
  const x = Math.round(hover.x) + 0.5;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(pal.ink, 0.55);
  ctx.beginPath(); ctx.moveTo(x, geo.top); ctx.lineTo(x, geo.top + geo.plotH); ctx.stroke();
  for (const r of hover.rows) {
    const s = list.find((q) => Math.abs(timeX(q.t, endT, spanS, geo) - hover.x) < 0.5);
    if (!s) continue;
    ctx.fillStyle = css(pal.series[r.k]);
    ctx.beginPath(); ctx.arc(hover.x, geo.top + geo.plotH * (1 - yFraction(s.v[r.k], range)), 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.font = `10px ${pal.font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const lines = hover.rows.length ? hover.rows.map((r) => `${LEGEND_LABELS[r.k]}  ${r.text}`) : ['no tempo'];
  const widest = Math.max(ctx.measureText(hover.title).width, ...lines.map((l) => ctx.measureText(l).width + 14));
  const bw = Math.ceil(widest) + 10;
  const bh = 8 + 13 * (lines.length + 1);
  const by = geo.top + 4;
  const bx = x + 6 + bw <= w - 2 ? x + 6 : Math.max(2, x - 6 - bw);
  ctx.fillStyle = css(pal.surface, 0.94);
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = css(pal.line);
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  ctx.fillStyle = css(pal.ink);
  ctx.fillText(hover.title, bx + 5, by + 13);
  lines.forEach((l, i) => {
    const y = by + 13 + 13 * (i + 1);
    if (hover.rows[i]) {
      ctx.fillStyle = css(pal.series[hover.rows[i].k]);
      ctx.fillRect(bx + 5, y - 7, 6, 6);
    }
    ctx.fillStyle = css(pal.ink);
    ctx.fillText(l, bx + (hover.rows[i] ? 14 : 5), y);
  });
  ctx.restore();
}

export function drawBpmGraph(g, pal, model) {
  const { ctx, w, h } = g;
  ctx.clearRect(0, 0, w, h);
  const geo = graphGeo(w, h);
  const range = plotRange(model.list, model.endT, model.spanS, model.visible);
  drawAxes(g, pal, geo, range ?? EMPTY_RANGE, model.spanS);
  if (!range) {
    ctx.save();
    ctx.font = `12px ${pal.font}`;
    ctx.fillStyle = css(pal.muted);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(GRAPH_EMPTY_TEXT, geo.left + geo.plotW / 2, geo.top + geo.plotH / 2);
    ctx.restore();
    return { geo, range };
  }
  drawSeries(g, pal, geo, model, range);
  const hover = model.hoverX === null ? null : graphHover(model.hoverX, model.list, model.endT, model.spanS, geo, model.visible);
  if (hover) drawHover(g, pal, geo, hover, model, range);
  return { geo, range, hover };
}

function swatch(k) {
  const node = el('span', { class: 'rh-sw', 'aria-hidden': 'true' });
  node.style.setProperty('--rh-c', `var(${SERIES_TOKENS[k]})`);
  return node;
}

export function createBpmWindowsView({ uid, colors, now = () => Date.now() }) {
  const history = createHistory();
  const visible = WINDOWS_S.map(() => true);
  let spanS = DEFAULT_SPAN_S;
  let endT = 0;
  let paletteAt = -Infinity;
  let series = null;

  const readouts = WINDOWS_S.map((_, k) => {
    const value = el('span', { class: 'rh-win-val' }, '-');
    const fill = el('i');
    const bar = el('span', { class: 'rh-bar', 'aria-hidden': 'true' }, fill);
    const item = el('li', { class: 'rh-win', title: NO_DATA_TIP, 'aria-label': readoutLabel(WINDOW_LABELS[k], null) },
      el('span', { class: 'rh-win-label' }, WINDOW_LABELS[k]), value, bar);
    return { item, value, fill, k };
  });
  const list = el('ul', { class: 'rh-wins', 'aria-label': 'BPM per analysis window' }, ...readouts.map((r) => r.item));

  const legend = el('div', { class: 'rh-legend', role: 'group', 'aria-label': 'Show or hide a window' },
    ...WINDOWS_S.map((_, k) => el('button', {
      class: 'rh-leg', type: 'button', 'aria-pressed': 'true',
      onclick: (ev) => {
        visible[k] = !visible[k];
        ev.currentTarget.setAttribute('aria-pressed', String(visible[k]));
        paint();
      },
    }, swatch(k), LEGEND_LABELS[k])));

  const canvas = el('canvas', { class: 'hm-canvas', role: 'img', 'aria-label': 'BPM over time for each analysis window' });
  const stage = view(canvas, 'rh-graph');
  const hover = trackHover(canvas, () => paint());
  const spanSeg = segmented(SPANS.map((s) => [s, SPAN_LABELS[s]]), () => spanS, (s) => { spanS = s; spanSeg.paint(); paint(); }, { 'aria-labelledby': `${uid}-sl` });
  spanSeg.paint();

  const node = el('div', { class: 'hm-block rh-block' },
    el('h3', { class: 't-subhead' }, WINDOWS_TITLE),
    list,
    el('p', { class: 'rh-cap muted t-caption' }, WINDOWS_CAPTION),
    el('p', { class: 'rh-key muted t-caption' },
      el('span', { class: 'rh-key-drift', 'aria-hidden': 'true' }), 'Red', KEY_DRIFT, ' ',
      el('span', { class: 'rh-key-bar', 'aria-hidden': 'true' }, el('i')), 'Bar', KEY_BAR, ' ', KEY_DASH),
    el('div', { class: 'hm-head' },
      el('h3', { class: 't-subhead' }, GRAPH_TITLE),
      el('div', { class: 'hm-axis' }, el('span', { id: `${uid}-sl`, class: 'hm-lbl' }, 'Time span'), spanSeg.group)),
    stage,
    legend);

  function palette() {
    const t = now();
    if (!series || t - paletteAt > 500) { series = readSeries(node); paletteAt = t; }
    return { ...colors(), series };
  }

  function paint() {
    const g = fit(canvas);
    if (!g) return;
    drawBpmGraph(g, palette(), { list: history.list, endT, spanS, visible, hoverX: hover.x });
  }

  function paintReadouts(main, results) {
    for (const r of readouts) {
      const res = results?.[r.k] ?? null;
      r.value.textContent = readoutText(res);
      r.fill.style.width = `${confidencePercent(res)}%`;
      r.item.setAttribute('title', res ? readoutLabel(WINDOW_LABELS[r.k], res) : NO_DATA_TIP);
      r.item.setAttribute('aria-label', readoutLabel(WINDOW_LABELS[r.k], res));
      r.item.classList.toggle('is-drift', !!res && drifts(main, res.bpm));
    }
  }

  paintReadouts(null, null);

  return {
    node,
    history,
    get span() { return spanS; },
    update(t, main, results) {
      endT = t;
      history.push(t, results);
      paintReadouts(main, results);
      paint();
    },
    clearReadouts() { paintReadouts(null, null); },
    reset() {
      history.clear();
      endT = 0;
      paintReadouts(null, null);
      paint();
    },
    paint,
  };
}
