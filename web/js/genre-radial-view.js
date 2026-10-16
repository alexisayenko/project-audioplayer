import { fitTransform, recenterOnResize, placeLabels, hitNode, isDragMove } from './genre-view.js';
import { highlightSets, visibleCrossLinks } from './genre-radial.js';

const MIN_K = 0.15;
const MAX_K = 8;
const LABEL_K = 1.5;
const FOCUS_K = 1.8;
const FOCUS_MS = 350;
const FONT_PX = 12;
const DIM = 0.22;
const EMPTY_ALPHA = 0.38;

const inert = () => ({
  setLayout() {}, setTree() {}, select() {}, setMatches() {}, setFilter() {}, focusNode() {}, reset() {}, zoomBy() {}, resize() {}, destroy() {},
});

export function createRadialView(canvas, { onSelect, onHover, reducedMotion = false } = {}) {
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return inert();
  let W = 1;
  let H = 1;
  let dpr = 1;
  let tf = { k: 1, x: 0, y: 0 };
  let layout = null;
  let tree = null;
  let sel = null;
  let hl = { chain: new Set(), kids: new Set() };
  let matches = new Set();
  let only = null;
  let hover = null;
  let raf = 0;
  let anim = null;
  let userMoved = false;
  let colors = {};
  let drag = null;
  const pointers = new Map();
  let pinch = null;
  let ro = null;
  const insets = { t: 64, r: 0, b: 16, l: 16 };

  function readColors() {
    const cs = getComputedStyle(canvas);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = {
      fam: Array.from({ length: 16 }, (_, i) => v(`--chart-${i}`)),
      edge: v('--ink-muted'), accent: v('--accent-ink'), ink: v('--ink'), halo: v('--surface'), ok: v('--ok'), warn: v('--accent'), font: cs.fontFamily || 'sans-serif',
    };
  }

  const request = () => { if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame); };
  const clampK = (k) => Math.min(MAX_K, Math.max(MIN_K, k));
  const toWorld = (px, py) => ({ x: (px - tf.x) / tf.k, y: (py - tf.y) / tf.k });

  function fit() {
    if (!layout) return;
    const bar = canvas.closest?.('.gm')?.querySelector?.('.gm-bar');
    insets.t = bar?.offsetHeight ? bar.offsetTop + bar.offsetHeight + 8 : 64;
    tf = fitTransform(layout.bounds, W, H, { insets: { t: insets.t, r: 0, b: insets.b, l: insets.l }, pad: 16, minK: MIN_K, maxK: 2.2 });
    userMoved = false;
    anim = null;
    request();
  }

  function resize() {
    const ow = W;
    const oh = H;
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, canvas.clientWidth);
    H = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    readColors();
    if (W > 10 && H > 10) {
      if (!userMoved || ow <= 10) fit();
      else tf = recenterOnResize(tf, ow, oh, W, H);
    }
    request();
  }

  const alphaOf = (n) => {
    let a = n.node.all.size ? 1 : EMPTY_ALPHA;
    if (sel && !hl.chain.has(n.id) && !hl.kids.has(n.id)) a *= sel === n.id ? 1 : DIM + 0.1;
    if (only && !only.has(n.id)) a *= DIM + 0.1;
    return a;
  };

  function draw() {
    if (!colors.ink) readColors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!layout) return;
    const { k } = tf;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tf.x, dpr * tf.y);
    const lit = (id) => hl.chain.has(id) || hl.kids.has(id);
    ctx.lineCap = 'round';
    ctx.strokeStyle = colors.edge;
    for (const l of visibleCrossLinks(layout, sel, hover)) {
      const a = layout.byId.get(l.from);
      const b = layout.byId.get(l.to);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1 / k;
      ctx.setLineDash([5 / k, 4 / k]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const e of layout.edges) {
      const a = layout.byId.get(e.from);
      const b = layout.byId.get(e.to);
      const on = sel && lit(e.from) && lit(e.to);
      ctx.globalAlpha = sel ? (on ? 0.95 : 0.1) : 0.45;
      ctx.strokeStyle = on ? colors.accent : colors.edge;
      ctx.lineWidth = (on ? 2 : 1) / k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const n of layout.nodes) {
      ctx.globalAlpha = alphaOf(n);
      ctx.fillStyle = colors.fam[n.hue] || colors.ink;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 2 * Math.PI); ctx.fill();
      if (!n.node.discogs) {
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = 1.5 / k;
        ctx.setLineDash([3 / k, 2.5 / k]);
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3 / k, 0, 2 * Math.PI); ctx.stroke();
        ctx.setLineDash([]);
      }
      const ring = n.id === sel ? 3 : n.id === hover ? 2 : matches.has(n.id) ? 2.5 : 0;
      if (ring) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = ring / k;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + (n.discogs ? 3 : 6) / k, 0, 2 * Math.PI); ctx.stroke();
      }
      if (n.node.status) drawBadge(n, k);
    }
    ctx.globalAlpha = 1;
    drawLabels();
  }

  function drawBadge(n, k) {
    const a = alphaOf(n);
    ctx.globalAlpha = a >= EMPTY_ALPHA ? 1 : a;
    const br = 5.5 / k;
    const off = (n.r + 4 / k) * 0.72;
    const bx = n.x + off;
    const by = n.y - off;
    const ok = n.node.status === 'approved';
    ctx.fillStyle = ok ? colors.ok : colors.warn;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = colors.halo;
    ctx.lineWidth = 1.5 / k;
    ctx.stroke();
    ctx.strokeStyle = colors.halo;
    ctx.fillStyle = colors.halo;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (ok) {
      ctx.lineWidth = 1.6 / k;
      ctx.beginPath(); ctx.moveTo(bx - br * 0.45, by + br * 0.05); ctx.lineTo(bx - br * 0.1, by + br * 0.4); ctx.lineTo(bx + br * 0.5, by - br * 0.35); ctx.stroke();
    } else {
      ctx.font = `bold ${8 / k}px ${colors.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', bx, by + 0.5 / k);
    }
  }

  function drawLabels() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${FONT_PX}px ${colors.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const zoomed = tf.k >= LABEL_K;
    const cands = [];
    for (const n of layout.nodes) {
      const forced = n.level === 1 || n.id === sel || n.id === hover || matches.has(n.id);
      const near = lit3(n);
      if (n.level === 3 && !zoomed && !forced && !near) continue;
      if (n.parked && !forced) continue;
      cands.push({ n, forced: forced || near, w: ctx.measureText(n.label || n.name).width });
    }
    cands.sort((a, b) => (b.forced - a.forced) || (a.n.level - b.n.level) || (b.n.node.all.size - a.n.node.all.size) || a.n.name.localeCompare(b.n.name));
    const boxes = cands.map(({ n, forced, w }) => ({
      id: n.id, x: n.x * tf.k + tf.x, y: n.y * tf.k + tf.y + (n.r + (n.discogs ? 2 : 5)) * tf.k + 1, w, h: FONT_PX + 2, force: forced,
    }));
    const shown = placeLabels(boxes);
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    for (const b of boxes) {
      if (!shown.has(b.id)) continue;
      const n = layout.byId.get(b.id);
      ctx.globalAlpha = Math.max(alphaOf(n), n.node.all.size || b.force ? alphaOf(n) : 0.6);
      ctx.strokeStyle = colors.halo;
      ctx.strokeText(n.label || n.name, b.x, b.y);
      ctx.fillStyle = colors.ink;
      ctx.fillText(n.label || n.name, b.x, b.y);
    }
    ctx.globalAlpha = 1;
  }

  const lit3 = (n) => n.level === 3 && !!sel && (hl.kids.has(n.id) || hl.chain.has(n.id));

  function frame() {
    raf = 0;
    if (anim) {
      const t = Math.min(1, (performance.now() - anim.t0) / FOCUS_MS);
      const e = 1 - (1 - t) ** 3;
      tf = { k: anim.from.k + (anim.to.k - anim.from.k) * e, x: anim.from.x + (anim.to.x - anim.from.x) * e, y: anim.from.y + (anim.to.y - anim.from.y) * e };
      if (t >= 1) anim = null;
    }
    draw();
    if (anim) request();
  }

  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    const p = toWorld(ev.clientX - r.left, ev.clientY - r.top);
    return layout ? hitNode(layout.nodes, p.x, p.y, 4 / tf.k) : null;
  }

  function zoomAt(px, py, f) {
    const k = clampK(tf.k * f);
    const w = toWorld(px, py);
    tf = { k, x: px - w.x * k, y: py - w.y * k };
    userMoved = true;
    anim = null;
    request();
  }

  const local = (ev) => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };

  const stop = () => { pointers.clear(); pinch = null; drag = null; };

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') stop();
    pointers.set(ev.pointerId, local(ev));
    canvas.setPointerCapture?.(ev.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      drag = null;
    } else drag = { sx: ev.clientX, sy: ev.clientY, tx: tf.x, ty: tf.y, moved: false };
  });
  canvas.addEventListener('pointermove', (ev) => {
    if ((drag || pinch) && ev.pointerType !== 'touch' && ev.buttons === 0) stop();
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, local(ev));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
      pinch.d = d;
      return;
    }
    if (drag) {
      const dx = ev.clientX - drag.sx;
      const dy = ev.clientY - drag.sy;
      if (drag.moved || isDragMove(dx, dy)) {
        drag.moved = true;
        tf = { ...tf, x: drag.tx + dx, y: drag.ty + dy };
        userMoved = true;
        anim = null;
        onHover?.(null);
        request();
      }
      return;
    }
    const h = pick(ev);
    const id = h ? h.id : null;
    if (id !== hover) { hover = id; request(); }
    onHover?.(h, { x: ev.clientX, y: ev.clientY });
  });
  const up = (ev) => {
    canvas.releasePointerCapture?.(ev.pointerId);
    pointers.delete(ev.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    if (drag && !drag.moved && ev.type === 'pointerup') { const h = pick(ev); onSelect?.(h ? h.id : null); }
    drag = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('lostpointercapture', (ev) => { if (ev.pointerType !== 'touch') stop(); });
  const onBlur = () => stop();
  window.addEventListener?.('blur', onBlur);
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; onHover?.(null); request(); } });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const p = local(ev);
    zoomAt(p.x, p.y, Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015)));
  }, { passive: false });

  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => resize()); ro.observe(canvas); }

  return {
    setLayout(l, t) { layout = l; tree = t || tree; hl = sel && tree ? highlightSets(tree, sel) : hl; resize(); },
    select(id) { sel = id && layout?.byId.has(id) ? id : null; hl = sel ? highlightSets(tree, sel) : { chain: new Set(), kids: new Set() }; request(); },
    setMatches(ids) { matches = new Set(ids); request(); },
    setFilter(ids) { only = ids ? new Set(ids) : null; request(); },
    focusNode(id) {
      const n = layout?.byId.get(id);
      if (!n) return;
      const k = Math.max(tf.k, FOCUS_K);
      const to = { k, x: insets.l + (W - insets.l) / 2 - n.x * k, y: insets.t + (H - insets.t) / 2 - n.y * k };
      userMoved = true;
      if (reducedMotion) { tf = to; anim = null; } else anim = { from: { ...tf }, to, t0: performance.now() };
      request();
    },
    reset() { fit(); },
    zoomBy(f) { zoomAt(W / 2, H / 2, f); },
    resize,
    destroy() { window.removeEventListener?.('blur', onBlur); ro?.disconnect(); if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf); raf = 0; },
  };
}
