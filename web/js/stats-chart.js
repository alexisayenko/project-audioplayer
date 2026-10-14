import {
  PALETTE_SIZE, MIN_ZOOM_YEARS, MIN_ZOOM_BPM, extentX, extentY, tickStep, ticks, makeScale, zoomRange, panRange,
  colorIndex, buildIndex, inRect, neighbour, firstItem,
} from './stats-data.js';

const MARGIN = { l: 56, r: 16, t: 84, b: 44 };
const DOT_R = 5;
const HIT_R = 9;
const DRAG_PX = 4;
const DOT_ALPHA = 0.55;

const readColors = (el) => {
  const cs = getComputedStyle(el);
  const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
  return {
    palette: Array.from({ length: PALETTE_SIZE }, (_, i) => v(`--st-${i}`, '#888')),
    neutral: v('--st-n', '#8a8f93'),
    grid: v('--line', '#ddd'),
    text: v('--ink-muted', '#666'),
    ink: v('--ink', '#111'),
    accent: v('--accent', '#06c'),
    surface: v('--surface', '#fff'),
    font: cs.fontFamily || 'sans-serif',
  };
};

export function createChart(base, top, { onHover, onOpen, onSelect, onFocus, onView } = {}) {
  const bctx = base.getContext('2d');
  const tctx = top.getContext('2d');
  let W = 1;
  let H = 1;
  let insetB = 0;
  let dpr = 1;
  let points = [];
  let hidden = new Set();
  let full = { x: extentX([]), y: extentY([]) };
  let view = { x: { ...full.x }, y: { ...full.y } };
  let zoomed = false;
  let items = [];
  let index = buildIndex([]);
  let hover = -1;
  let focus = -1;
  let selected = new Set();
  let band = null;
  let drag = null;
  let raf = 0;
  let dirty = false;
  let overlayDirty = false;
  let dead = false;

  const visible = (it) => !hidden.has(it.point.group);
  const plot = () => ({ x0: MARGIN.l, x1: Math.max(MARGIN.l + 1, W - MARGIN.r), y0: MARGIN.t, y1: Math.max(MARGIN.t + 1, H - MARGIN.b - insetB) });
  const scales = () => {
    const p = plot();
    return { sx: makeScale(view.x.lo, view.x.hi, p.x0, p.x1), sy: makeScale(view.y.lo, view.y.hi, p.y1, p.y0), p };
  };

  function layout() {
    const { sx, sy } = scales();
    items = points.map((point) => ({ point, px: sx.to(point.x), py: sy.to(point.y) }));
    index = buildIndex(items);
  }

  function ensureLayout() { if (dirty || items.length !== points.length) layout(); }

  function dotsDraw(c) {
    const p = plot();
    bctx.save();
    bctx.beginPath();
    bctx.rect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
    bctx.clip();
    bctx.globalAlpha = DOT_ALPHA;
    const order = items.filter(visible).sort((a, b) => a.point.color - b.point.color);
    let cur = null;
    for (const it of order) {
      const idx = colorIndex(it.point.color);
      if (idx !== cur) { cur = idx; bctx.fillStyle = idx < 0 ? c.neutral : c.palette[idx]; }
      if (it.px < p.x0 - DOT_R || it.px > p.x1 + DOT_R || it.py < p.y0 - DOT_R || it.py > p.y1 + DOT_R) continue;
      bctx.beginPath();
      bctx.arc(it.px, it.py, DOT_R, 0, Math.PI * 2);
      bctx.fill();
    }
    bctx.restore();
  }

  function axesDraw(c) {
    const { sx, sy, p } = scales();
    bctx.font = `12px ${c.font}`;
    bctx.lineWidth = 1;
    bctx.fillStyle = c.text;
    bctx.strokeStyle = c.grid;
    bctx.textAlign = 'center';
    bctx.textBaseline = 'top';
    for (const v of ticks(view.x.lo, view.x.hi, tickStep(view.x.hi - view.x.lo, (p.x1 - p.x0) / 56))) {
      const x = Math.round(sx.to(v)) + 0.5;
      bctx.beginPath(); bctx.moveTo(x, p.y0); bctx.lineTo(x, p.y1); bctx.stroke();
      bctx.fillText(String(v), x, p.y1 + 6);
    }
    bctx.textAlign = 'right';
    bctx.textBaseline = 'middle';
    for (const v of ticks(view.y.lo, view.y.hi, tickStep(view.y.hi - view.y.lo, (p.y1 - p.y0) / 34))) {
      const y = Math.round(sy.to(v)) + 0.5;
      bctx.beginPath(); bctx.moveTo(p.x0, y); bctx.lineTo(p.x1, y); bctx.stroke();
      bctx.fillText(String(v), p.x0 - 8, y);
    }
    bctx.textAlign = 'center';
    bctx.textBaseline = 'alphabetic';
    bctx.fillText('Year', (p.x0 + p.x1) / 2, H - 8);
    bctx.save();
    bctx.translate(14, (p.y0 + p.y1) / 2);
    bctx.rotate(-Math.PI / 2);
    bctx.fillText('BPM', 0, 0);
    bctx.restore();
  }

  function drawBase() {
    const c = readColors(base);
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, W, H);
    layout();
    axesDraw(c);
    dotsDraw(c);
    drawTop();
  }

  function ring(it, r, color, width, dash = []) {
    tctx.beginPath();
    tctx.setLineDash(dash);
    tctx.lineWidth = width;
    tctx.strokeStyle = color;
    tctx.arc(it.px, it.py, r, 0, Math.PI * 2);
    tctx.stroke();
    tctx.setLineDash([]);
  }

  function drawTop() {
    const c = readColors(top);
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.clearRect(0, 0, W, H);
    for (const it of items) if (selected.has(it.point.id) && visible(it)) ring(it, DOT_R + 2, c.accent, 2);
    if (hover >= 0 && items[hover]) {
      const it = items[hover];
      tctx.beginPath();
      tctx.fillStyle = c.ink;
      tctx.globalAlpha = 0.9;
      tctx.arc(it.px, it.py, DOT_R + 1, 0, Math.PI * 2);
      tctx.fill();
      tctx.globalAlpha = 1;
      ring(it, DOT_R + 4, c.ink, 1.5);
    }
    if (focus >= 0 && items[focus]) ring(items[focus], DOT_R + 6, c.ink, 2, [3, 3]);
    if (band) {
      tctx.fillStyle = c.accent;
      tctx.globalAlpha = 0.15;
      tctx.fillRect(Math.min(band.a.x, band.b.x), Math.min(band.a.y, band.b.y), Math.abs(band.b.x - band.a.x), Math.abs(band.b.y - band.a.y));
      tctx.globalAlpha = 1;
      tctx.strokeStyle = c.accent;
      tctx.lineWidth = 1;
      tctx.strokeRect(Math.min(band.a.x, band.b.x) + 0.5, Math.min(band.a.y, band.b.y) + 0.5, Math.abs(band.b.x - band.a.x), Math.abs(band.b.y - band.a.y));
    }
  }

  function frame() {
    raf = 0;
    if (dead) return;
    if (dirty) drawBase();
    else if (overlayDirty) drawTop();
    dirty = false;
    overlayDirty = false;
  }

  function schedule() {
    if (!raf && !dead) raf = requestAnimationFrame(frame);
  }
  const redraw = () => { dirty = true; schedule(); };
  const redrawTop = () => { overlayDirty = true; schedule(); };

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, base.clientWidth);
    H = Math.max(1, base.clientHeight);
    for (const cv of [base, top]) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    redraw();
  }

  function setView(next) {
    view = next;
    zoomed = true;
    hover = -1;
    onHover?.(null);
    onView?.(true);
    redraw();
  }

  function reset() {
    view = { x: { ...full.x }, y: { ...full.y } };
    zoomed = false;
    hover = -1;
    onHover?.(null);
    onView?.(false);
    redraw();
  }

  function setData(next, nextHidden) {
    points = next;
    hidden = nextHidden;
    full = { x: extentX(points.map((p) => p.year)), y: extentY(points.map((p) => p.bpm)) };
    if (!zoomed) view = { x: { ...full.x }, y: { ...full.y } };
    hover = -1;
    focus = -1;
    redraw();
  }

  function setHidden(next) { hidden = next; hover = -1; redraw(); }
  function setSelected(next) { selected = next; redrawTop(); }

  function localPos(ev) {
    const r = top.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function hitAt(pos) {
    ensureLayout();
    return index.near(pos.x, pos.y, HIT_R, visible);
  }

  function setHover(i, pos) {
    if (i === hover) return;
    hover = i;
    top.style.cursor = i >= 0 ? 'pointer' : 'crosshair';
    onHover?.(i >= 0 ? items[i].point : null, pos);
    redrawTop();
  }

  function wheel(ev) {
    ev.preventDefault();
    const pos = localPos(ev);
    const { sx, sy, p } = scales();
    if (pos.x < p.x0 - 40 || pos.y > p.y1 + 40) return;
    const factor = Math.exp((ev.deltaY || 0) * 0.0015);
    const xr = zoomRange(view.x.lo, view.x.hi, sx.from(pos.x), factor, { minSpan: MIN_ZOOM_YEARS, maxSpan: (full.x.hi - full.x.lo) * 3 });
    const yr = zoomRange(view.y.lo, view.y.hi, sy.from(pos.y), factor, { minSpan: MIN_ZOOM_BPM, maxSpan: (full.y.hi - full.y.lo) * 3 });
    setView({ x: xr, y: yr });
  }

  function down(ev) {
    top.setPointerCapture?.(ev.pointerId);
    top.focus?.();
    const pos = localPos(ev);
    const pan = ev.button === 1 || ev.shiftKey;
    drag = { pos, last: pos, pan, moved: false, pointer: ev.pointerId };
    if (pan) top.style.cursor = 'grabbing';
  }

  function panBy(pos) {
    const { sx, sy } = scales();
    const dx = sx.from(drag.last.x) - sx.from(pos.x);
    const dy = sy.from(drag.last.y) - sy.from(pos.y);
    setView({ x: panRange(view.x.lo, view.x.hi, dx), y: panRange(view.y.lo, view.y.hi, dy) });
  }

  function dragMove(pos) {
    if (!drag.moved && Math.hypot(pos.x - drag.pos.x, pos.y - drag.pos.y) < DRAG_PX) return;
    drag.moved = true;
    if (drag.pan) panBy(pos);
    else { band = { a: drag.pos, b: pos }; redrawTop(); }
    drag.last = pos;
  }

  function move(ev) {
    const pos = localPos(ev);
    if (drag) { dragMove(pos); return; }
    setHover(hitAt(pos), pos);
  }

  function finishBand() {
    ensureLayout();
    const ids = inRect(items, band.a, band.b, visible).map((i) => items[i].point.id);
    band = null;
    onSelect?.(ids);
    redrawTop();
  }

  function clickAt(pos) {
    const i = hitAt(pos);
    if (i >= 0) { focus = i; onOpen?.(items[i].point); redrawTop(); } else onSelect?.([]);
  }

  function up(ev) {
    if (!drag) return;
    const d = drag;
    drag = null;
    top.releasePointerCapture?.(d.pointer);
    top.style.cursor = 'crosshair';
    if (d.pan) return;
    if (band && d.moved) finishBand();
    else clickAt(localPos(ev));
  }

  function leave() { if (!drag) setHover(-1); }

  function setFocus(i) {
    focus = i;
    if (i >= 0 && items[i]) onFocus?.(items[i].point);
    redrawTop();
  }

  function key(ev) {
    if (ev.key === 'Enter' && focus >= 0 && items[focus]) { ev.preventDefault(); onOpen?.(items[focus].point); return; }
    if (ev.key === 'Escape') { onSelect?.([]); return; }
    if (ev.key === '0') { reset(); return; }
    if (!ev.key.startsWith('Arrow')) return;
    ev.preventDefault();
    ensureLayout();
    setFocus(focus < 0 ? firstItem(items, visible) : neighbour(items, focus, ev.key, visible));
  }

  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  ro?.observe(base);
  top.addEventListener('wheel', wheel, { passive: false });
  top.addEventListener('pointerdown', down);
  top.addEventListener('pointermove', move);
  top.addEventListener('pointerup', up);
  top.addEventListener('pointercancel', () => { drag = null; band = null; redrawTop(); });
  top.addEventListener('pointerleave', leave);
  top.addEventListener('dblclick', reset);
  top.addEventListener('keydown', key);
  top.addEventListener('contextmenu', (ev) => { if (drag?.pan) ev.preventDefault(); });
  resize();

  return {
    setData, setHidden, setSelected, reset, resize,
    setInsetBottom(px) { if (px !== insetB) { insetB = px; redraw(); } },
    isZoomed: () => zoomed,
    focusPoint: (id) => { ensureLayout(); setFocus(items.findIndex((it) => it.point.id === id)); },
    destroy() { dead = true; if (raf) cancelAnimationFrame(raf); ro?.disconnect(); },
  };
}
