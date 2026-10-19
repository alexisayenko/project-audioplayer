import { createSim } from './genre-sim.js';
import { fitTransform, recenterOnResize, placeLabels, isDragMove } from './genre-view.js';
import { createHash } from './genre-spatial.js';
import { createCrossingLayout } from './genre-layout.js';
import { FAMILY_PALETTE_SIZE } from './genre-data.js';
import { fillDisc } from './genre-disc.js';
import { shadeTable } from './genre-shade.js';

const MIN_K = 0.08;
const MAX_K = 8;
const FOCUS_K = 1.8;
const FONT_PX = 12;
const EMPHASIS_ALPHA = [0.34, 0.72, 1];
const DIM = 0.2;
const FADE_MS = 130;
const MOVE_MS = 380;
const FLASH_MS = 1400;
const DRAG_ALPHA = 0.3;
const RELEASE_ALPHA = 0.35;
const SETTLE_STATIC = 400;
const SIM = { charge: 6, linkDistance: 20, gravity: 0, home: 0.05 };
const LAYOUT_SLICE_MS = 6;
const LAYOUT_STATIC_MS = 1500;
const PAD = { t: 16, r: 0, b: 16, l: 16 };

const inert = () => ({
  setGraph() {}, setVisible() {}, setRelated() {}, resetLayout() {}, useSavedLayout() {}, exportPositions: () => [], select() {}, setMatches() {}, focusNode() {}, flash() {}, setFocusInset() {}, reset() {}, zoomBy() {}, resize() {}, destroy() {}, stats: () => ({}), nodeScreen: () => null,
});

const clampK = (k) => Math.min(MAX_K, Math.max(MIN_K, k));

export function createForceView(canvas, { onSelect, onHover, reducedMotion = false, simOptions = {} } = {}) {
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return inert();
  let W = 1;
  let H = 1;
  let dpr = 1;
  let tf = { k: 1, x: 0, y: 0 };
  let nodes = [];
  let order = [];
  let links = [];
  let allLinks = [];
  let shadeIdx = -1;
  let layout = null;
  let rawGraph = null;
  let savedMap = null;
  let showRelated = false;
  let byId = new Map();
  let adj = new Map();
  let incident = new Map();
  let parentLink = new Map();
  let sim = null;
  let awake = false;
  let sel = null;
  let hover = null;
  let focus = null;
  let matches = new Set();
  let visibleSet = null;
  let flashing = null;
  let raf = 0;
  let last = 0;
  let anim = null;
  let follow = true;
  let userMoved = false;
  let hashDirty = true;
  let active = true;
  let focusInset = { r: 0, b: 0 };
  let colors = {};
  let drag = null;
  let pinch = null;
  let hoverRaf = 0;
  let hoverAt = null;
  let ro = null;
  const pointers = new Map();
  const widths = new Map();
  const hash = createHash(48);
  const perf = { frames: 0, ticks: 0, simMs: 0, drawMs: 0, sleeps: 0 };

  function readColors() {
    const cs = getComputedStyle(canvas);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = {
      fam: Array.from({ length: FAMILY_PALETTE_SIZE }, (_, i) => v(`--chart-${i}`)),
      edge: v('--ink-muted'), accent: v('--accent-ink'), ink: v('--ink'), halo: v('--surface'), warn: v('--accent'), font: cs.fontFamily || 'sans-serif',
    };
    widths.clear();
    colors.shades = shadeIdx >= 0 ? shadeTable(colors.fam[shadeIdx]) : [];
  }

  const request = () => {
    if (!raf && active && typeof requestAnimationFrame === 'function' && !globalThis.document?.hidden) raf = requestAnimationFrame(frame);
  };
  const shown = (n) => n.target === 1 && n.vis > 0.5;
  const toWorld = (px, py) => ({ x: (px - tf.x) / tf.k, y: (py - tf.y) / tf.k });
  const local = (ev) => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };

  function bounds(list) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const n of list) {
      if (n.x - n.r < x0) x0 = n.x - n.r;
      if (n.x + n.r > x1) x1 = n.x + n.r;
      if (n.y - n.r < y0) y0 = n.y - n.r;
      if (n.y + n.r > y1) y1 = n.y + n.r;
    }
    return { x0, y0, x1, y1 };
  }

  function fitFor(list, { maxK = 1.6, pad = 24 } = {}) {
    if (!list.length) return null;
    return fitTransform(bounds(list), W, H, { insets: { t: PAD.t, r: focusInset.r, b: PAD.b + focusInset.b, l: PAD.l }, pad, minK: MIN_K, maxK });
  }

  const liveNodes = () => nodes.filter((n) => n.target === 1);

  function moveTo(to) {
    follow = false;
    userMoved = true;
    if (reducedMotion) { tf = to; anim = null; } else anim = { from: { ...tf }, to, t0: performance.now() };
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
    if (W > 10 && H > 10 && nodes.length) {
      if (ow <= 10 || !userMoved) { follow = true; if (ow <= 10) snapFit(); } else tf = recenterOnResize(tf, ow, oh, W, H);
    }
    request();
  }

  function snapFit() {
    const to = fitFor(liveNodes());
    if (to) tf = to;
    anim = null;
  }

  function rebuildSim(heat) {
    const act = liveNodes();
    const ids = new Set(act.map((n) => n.id));
    const ls = links.filter((l) => ids.has(l.s.id) && ids.has(l.t.id)).map((l) => ({ source: l.s.id, target: l.t.id, kind: l.assoc ? 'assoc' : l.related ? 'related' : 'parent' }));
    sim = createSim({ nodes: act, links: ls, seed: 1, breathing: false, ...SIM, ...simOptions });
    syncLinkLength();
    sim.alpha = heat;
    awake = true;
    hashDirty = true;
  }

  function syncLinkLength() {
    if (!sim) return;
    for (const l of sim.links) {
      if (l.assoc || l.s.hx === undefined || l.t.hx === undefined) continue;
      l.dist = Math.hypot(l.s.hx - l.t.hx, l.s.hy - l.t.hy);
    }
  }

  function startLayout(saved) {
    if (!rawGraph) return;
    layout = createCrossingLayout({ nodes, links: rawGraph.links }, { saved });
    layout.apply();
    if (reducedMotion) {
      layout.run(LAYOUT_STATIC_MS);
      layout.apply();
      for (const n of nodes) { n.x = n.hx; n.y = n.hy; }
    }
    syncLinkLength();
  }

  function wakeLayout(heat = 0.5) {
    follow = true;
    userMoved = false;
    anim = null;
    if (sim && !reducedMotion) { sim.reheat(heat); awake = true; }
    request();
  }

  function stepVis(dt) {
    let busy = false;
    const f = 1 - Math.exp(-dt / FADE_MS);
    for (const n of nodes) {
      if (n.vis === n.target) continue;
      n.vis += (n.target - n.vis) * f;
      if (Math.abs(n.target - n.vis) < 0.012) n.vis = n.target;
      else busy = true;
      hashDirty = true;
    }
    return busy;
  }

  function stepCamera(now) {
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / MOVE_MS);
      const e = 1 - (1 - t) ** 3;
      tf = { k: anim.from.k + (anim.to.k - anim.from.k) * e, x: anim.from.x + (anim.to.x - anim.from.x) * e, y: anim.from.y + (anim.to.y - anim.from.y) * e };
      if (t >= 1) anim = null;
      return true;
    }
    if (!follow || W <= 10) return false;
    const to = fitFor(liveNodes());
    if (!to) return false;
    const a = 0.1;
    tf = { k: tf.k + (to.k - tf.k) * a, x: tf.x + (to.x - tf.x) * a, y: tf.y + (to.y - tf.y) * a };
    const close = Math.abs(to.k - tf.k) < 0.002 && Math.abs(to.x - tf.x) < 0.6 && Math.abs(to.y - tf.y) < 0.6;
    if (close && !awake) { tf = to; follow = false; return false; }
    return true;
  }

  function frame(now) {
    raf = 0;
    if (!active) return;
    const t0 = performance.now();
    const dt = Math.min(64, Math.max(1, last ? now - last : 16));
    last = now;
    let again = false;
    if (layout && !layout.done && !reducedMotion) {
      if (layout.step(LAYOUT_SLICE_MS) || layout.done) {
        layout.apply();
        syncLinkLength();
        if (sim) { sim.reheat(0.25); awake = true; }
      }
      again = true;
    }
    if (sim && awake && !reducedMotion) {
      awake = sim.tick();
      perf.ticks++;
      hashDirty = true;
      again = awake;
      if (!awake) perf.sleeps++;
    }
    const t1 = performance.now();
    if (stepVis(dt)) again = true;
    if (stepCamera(now)) again = true;
    draw(now);
    if (flashing) again = true;
    perf.frames++;
    perf.simMs += t1 - t0;
    perf.drawMs += performance.now() - t1;
    if (again) request(); else last = 0;
  }

  function focusState(n) {
    if (!n) return null;
    const set = new Set([n]);
    const edges = new Set(incident.get(n.id) || []);
    for (const id of adj.get(n.id) || []) set.add(byId.get(id));
    if (n === sel) {
      for (let c = n; c; ) {
        const l = parentLink.get(c.id);
        if (!l) break;
        set.add(l.s); edges.add(l);
        c = l.s;
      }
    }
    return { n, set, edges };
  }

  function refocus() { focus = focusState(sel); }

  function strokeLinks(list, k, alpha, color, width, dotted = false) {
    if (!list.length) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width / k;
    ctx.setLineDash(dotted ? [1 / k, 3 / k] : []);
    ctx.beginPath();
    for (const l of list) { ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); }
    ctx.stroke();
  }

  function drawLinks(k) {
    const plain = [];
    const lit = [];
    const dotted = [];
    const litDotted = [];
    const fading = [];
    for (const l of links) {
      const v = Math.min(l.s.vis, l.t.vis);
      if (v < 0.02) continue;
      if (v < 0.99) { fading.push(l); continue; }
      const on = focus?.edges.has(l);
      if (l.assoc) (on ? litDotted : dotted).push(l); else (on ? lit : plain).push(l);
    }
    const base = focus ? 0.06 : 0.2;
    strokeLinks(plain, k, base, colors.edge, 1);
    for (const l of fading) strokeLinks([l], k, 0.3 * Math.min(l.s.vis, l.t.vis), colors.edge, 1, l.assoc);
    strokeLinks(dotted, k, base * 0.8, colors.edge, 0.7, true);
    strokeLinks(lit, k, 0.95, colors.accent, 1.8);
    strokeLinks(litDotted, k, 0.95, colors.accent, 1.2, true);
    ctx.setLineDash([]);
  }

  function ring(n, extra, w, color, k) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = w / k;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r + extra / k, 0, 2 * Math.PI); ctx.stroke();
  }

  function nodeAlpha(n) {
    let a = n.level === 1 ? 1 : EMPHASIS_ALPHA[n.em];
    if (focus && !focus.set.has(n)) a *= DIM;
    return a * n.vis;
  }

  function drawNode(n, k) {
    const r = n.r * (0.4 + 0.6 * n.vis);
    const a = nodeAlpha(n);
    ctx.globalAlpha = a;
    fillDisc(ctx, n.x, n.y, r, colors.fam, n.fis, colors.ink, n.subOrder ? shadeIdx : -1, n.subOrder ? colors.shades[n.subOrder] : null);
    if (n.em === 2 || n.level === 1) {
      ctx.strokeStyle = colors.halo;
      ctx.lineWidth = 1.5 / k;
      ctx.stroke();
    }
    if (n.vis < 0.99) return;
    if (!n.node.discogs && n.level > 1 && r * k >= 3) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.2 / k;
      ctx.setLineDash([3 / k, 2.5 / k]);
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 2.5 / k, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (n === sel) ring(n, 3.5, 3, colors.accent, k);
    else if (n === hover) ring(n, 3, 2, colors.accent, k);
    else if (matches.has(n.id)) ring(n, 3, 2.5, colors.accent, k);
    if (n.node.status === 'question' && r * k >= 4) drawBadge(n, r, a, k);
    if (flashing && flashing.id === n.id) drawFlash(n, k);
  }

  function drawBadge(n, r, a, k) {
    ctx.globalAlpha = Math.max(a, 0.6);
    const br = 5.5 / k;
    const off = (r + 4 / k) * 0.72;
    const bx = n.x + off;
    const by = n.y - off;
    ctx.fillStyle = colors.warn;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = colors.halo;
    ctx.lineWidth = 1.5 / k;
    ctx.stroke();
    ctx.fillStyle = colors.halo;
    ctx.font = `bold ${8 / k}px ${colors.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', bx, by + 0.5 / k);
  }

  function drawFlash(n, k) {
    const t = (performance.now() - flashing.t0) / FLASH_MS;
    if (t >= 1) { flashing = null; return; }
    const phase = reducedMotion ? 0 : (t * 3) % 1;
    ctx.globalAlpha = 1 - (reducedMotion ? t : phase);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 3 / k;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r + (6 + 16 * phase) / k, 0, 2 * Math.PI); ctx.stroke();
  }

  const onScreen = (n, k, m = 24) => {
    const sx = n.x * k + tf.x;
    const sy = n.y * k + tf.y;
    return sx > -m && sx < W + m && sy > -m && sy < H + m;
  };

  function labelWidth(text) {
    let w = widths.get(text);
    if (w === undefined) { w = ctx.measureText(text).width; widths.set(text, w); }
    return w;
  }

  function drawLabels(k) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${FONT_PX}px ${colors.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const isForced = (n) => n === sel || n === hover || matches.has(n.id) || flashing?.id === n.id;
    const cands = [];
    for (const n of order) {
      if (n.vis < 0.6 || !onScreen(n, k, 60)) continue;
      const force = isForced(n);
      const lit = focus?.set.has(n) ?? false;
      if (!force && !lit && n.r * k < 3.2) continue;
      cands.push({ id: n.id, n, x: n.x * k + tf.x, y: n.y * k + tf.y + n.r * k + 3, w: labelWidth(n.label), h: FONT_PX + 2, force, lit });
    }
    cands.sort((a, b) => Number(b.force) - Number(a.force) || Number(b.lit) - Number(a.lit));
    const keep = placeLabels(cands);
    ctx.lineWidth = 3;
    for (const c of cands) {
      if (!keep.has(c.id)) continue;
      ctx.globalAlpha = Math.min(c.n.vis, focus && !focus.set.has(c.n) ? 0.5 : 1);
      ctx.strokeStyle = colors.halo;
      ctx.strokeText(c.n.label, c.x, c.y);
      ctx.fillStyle = colors.ink;
      ctx.fillText(c.n.label, c.x, c.y);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!colors.ink) readColors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!nodes.length) return;
    const k = tf.k;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tf.x, dpr * tf.y);
    drawLinks(k);
    for (const n of order) {
      if (n.vis >= 0.02 && onScreen(n, k, n.r * k + 12)) drawNode(n, k);
    }
    ctx.globalAlpha = 1;
    drawLabels(k);
  }

  function pick(ev) {
    if (!nodes.length) return null;
    if (hashDirty) { hash.rebuild(order, shown); hashDirty = false; }
    const p = local(ev);
    const w = toWorld(p.x, p.y);
    return hash.hit(w.x, w.y, 4 / tf.k);
  }

  function setHover(n, ev) {
    if (n !== hover) {
      hover = n;
      refocus();
      canvas.style.cursor = n ? 'pointer' : 'grab';
      request();
    }
    if (!onHover) return;
    if (n && ev) onHover(n, { x: ev.clientX, y: ev.clientY }); else onHover(null);
  }

  function flushHover() {
    hoverRaf = 0;
    const ev = hoverAt;
    hoverAt = null;
    if (ev) setHover(pick(ev), ev);
  }

  function queueHover(ev) {
    hoverAt = { clientX: ev.clientX, clientY: ev.clientY };
    if (!hoverRaf && typeof requestAnimationFrame === 'function') hoverRaf = requestAnimationFrame(flushHover);
  }

  function cancelHover() {
    if (hoverRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(hoverRaf);
    hoverRaf = 0;
    hoverAt = null;
  }

  function zoomAt(px, py, f) {
    const k = clampK(tf.k * f);
    const w = toWorld(px, py);
    tf = { k, x: px - w.x * k, y: py - w.y * k };
    userMoved = true;
    follow = false;
    anim = null;
    request();
  }

  function unpin(n) { n.fx = null; n.fy = null; }

  function startNodeDrag() {
    drag.node.fx = drag.node.x;
    drag.node.fy = drag.node.y;
    follow = false;
    userMoved = true;
    if (sim && !reducedMotion) { sim.setAlphaTarget(DRAG_ALPHA); awake = true; }
  }

  function moveDragNode(p) {
    const w = toWorld(p.x, p.y);
    const n = drag.node;
    if (reducedMotion || !sim) { n.x = w.x; n.y = w.y; hashDirty = true; } else { n.fx = w.x; n.fy = w.y; }
    setHover(n, null);
  }

  function endDrag(ev) {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.node) {
      if (d.moved) { d.node.hx = d.node.x; d.node.hy = d.node.y; syncLinkLength(); }
      unpin(d.node);
      if (sim && d.moved && !reducedMotion) { sim.setAlphaTarget(sim.restTarget()); sim.reheat(RELEASE_ALPHA); awake = true; }
      if (!d.moved && ev.type === 'pointerup') onSelect?.(d.node.id);
    } else if (!d.moved && ev.type === 'pointerup') onSelect?.(null);
    if (ev.pointerType === 'touch') setHover(null);
    canvas.style.cursor = hover ? 'pointer' : 'grab';
    request();
  }

  const stop = () => {
    for (const n of nodes) if (n.fx != null) unpin(n);
    if (sim) sim.setAlphaTarget(sim.restTarget());
    pointers.clear(); pinch = null; drag = null;
  };

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') stop();
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    canvas.setPointerCapture?.(ev.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      if (drag?.node) unpin(drag.node);
      drag = null;
      return;
    }
    cancelHover();
    anim = null;
    const hit = pick(ev);
    drag = { node: hit, sx: ev.clientX, sy: ev.clientY, lx: p.x, ly: p.y, moved: false };
    if (ev.pointerType !== 'touch') setHover(hit, ev);
  });

  canvas.addEventListener('pointermove', (ev) => {
    if ((drag || pinch) && ev.pointerType !== 'touch' && ev.buttons === 0) stop();
    if (!pointers.has(ev.pointerId)) {
      if (ev.pointerType !== 'touch') queueHover(ev);
      return;
    }
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
      pinch.d = d;
      return;
    }
    if (!drag) return;
    if (!drag.moved) {
      if (!isDragMove(ev.clientX - drag.sx, ev.clientY - drag.sy)) return;
      drag.moved = true;
      if (drag.node) startNodeDrag(); else onHover?.(null);
    }
    if (drag.node) moveDragNode(p);
    else {
      tf = { ...tf, x: tf.x + p.x - drag.lx, y: tf.y + p.y - drag.ly };
      userMoved = true;
      follow = false;
      canvas.style.cursor = 'grabbing';
    }
    drag.lx = p.x; drag.ly = p.y;
    request();
  });

  const up = (ev) => {
    canvas.releasePointerCapture?.(ev.pointerId);
    pointers.delete(ev.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      drag = null;
      return;
    }
    endDrag(ev);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', (ev) => { if (ev.pointerType !== 'touch' && drag) up(ev); });
  const onBlur = () => stop();
  window.addEventListener?.('blur', onBlur);
  canvas.addEventListener('pointerleave', () => { cancelHover(); if (!drag) setHover(null); });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const p = local(ev);
    zoomAt(p.x, p.y, Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015)));
  }, { passive: false });
  canvas.addEventListener('dblclick', (ev) => {
    const n = pick(ev);
    if (n) zoomToNode(n.id);
  });

  function zoomToNode(id) {
    const n = byId.get(id);
    if (!n || n.target !== 1) return;
    const group = [n, ...[...(adj.get(id) || [])].map((x) => byId.get(x)).filter((x) => x.target === 1)];
    const to = fitFor(group, { maxK: 2.4, pad: 40 });
    if (to) moveTo(to);
  }

  function onVisibility() { if (!globalThis.document?.hidden) { last = 0; request(); } }
  globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
  const scheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const onScheme = () => { readColors(); request(); };
  scheme?.addEventListener?.('change', onScheme);
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => resize()); ro.observe(canvas); }

  function index() {
    byId = new Map(nodes.map((n) => [n.id, n]));
    adj = new Map(nodes.map((n) => [n.id, new Set()]));
    incident = new Map(nodes.map((n) => [n.id, []]));
    parentLink = new Map();
    for (const l of links) {
      adj.get(l.s.id).add(l.t.id); adj.get(l.t.id).add(l.s.id);
      incident.get(l.s.id).push(l); incident.get(l.t.id).push(l);
      if (!l.related && !l.assoc) parentLink.set(l.t.id, l);
    }
    order = [...nodes].sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));
  }

  function applyVisible() {
    for (const n of nodes) {
      const want = !visibleSet || visibleSet.has(n.id) ? 1 : 0;
      if (n.target === want && n.vis !== undefined) continue;
      n.target = want;
      if (n.vis === undefined) n.vis = want;
      if (reducedMotion) n.vis = want;
    }
    if (sel && sel.target !== 1) sel = null;
    if (hover && hover.target !== 1) hover = null;
    refocus();
  }

  function enterNodes(entering) {
    for (const n of entering) {
      const near = [...(adj.get(n.id) || [])].map((id) => byId.get(id)).filter((m) => m.target === 1 && m.vis > 0.3 && !entering.includes(m));
      if (!near.length) continue;
      n.x = near.reduce((s, m) => s + m.x, 0) / near.length + ((n.id.length % 7) - 3);
      n.y = near.reduce((s, m) => s + m.y, 0) / near.length + ((n.id.length % 5) - 2);
      n.vx = 0; n.vy = 0;
    }
  }

  return {
    setGraph(graph, { saved = null } = {}) {
      rawGraph = graph;
      shadeIdx = graph.subIdx ?? -1;
      if (colors.ink) colors.shades = shadeIdx >= 0 ? shadeTable(colors.fam[shadeIdx]) : [];
      savedMap = saved;
      const prev = byId;
      const prevSel = sel?.id;
      sel = null;
      hover = null;
      nodes = graph.nodes;
      const fresh = !prev.size;
      for (const n of nodes) {
        const p = prev.get(n.id);
        if (p) { n.x = p.x; n.y = p.y; n.vx = p.vx; n.vy = p.vy; n.vis = p.vis; n.target = p.target; }
      }
      const idx = new Map(nodes.map((n) => [n.id, n]));
      allLinks = graph.links.map((l) => ({ s: idx.get(l.source), t: idx.get(l.target), related: l.kind === 'related', assoc: l.kind === 'assoc' })).filter((l) => l.s && l.t);
      links = allLinks.filter((l) => showRelated || !l.assoc);
      index();
      startLayout(savedMap);
      for (const n of nodes) if (!Number.isFinite(n.x)) { n.x = n.hx; n.y = n.hy; }
      sel = prevSel ? byId.get(prevSel) || null : null;
      applyVisible();
      rebuildSim(fresh ? 1 : 0.4);
      if (reducedMotion) { sim.settle(SETTLE_STATIC); awake = false; }
      if (fresh && W > 10 && H > 10) { follow = true; userMoved = false; snapFit(); }
      request();
    },
    setVisible(ids) {
      visibleSet = ids ? new Set(ids) : null;
      if (!nodes.length) return;
      const before = new Map(nodes.map((n) => [n.id, n.target]));
      applyVisible();
      const entering = nodes.filter((n) => n.target === 1 && before.get(n.id) === 0);
      const changed = entering.length > 0 || nodes.some((n) => n.target === 0 && before.get(n.id) === 1);
      if (!changed) return;
      enterNodes(entering);
      rebuildSim(0.7);
      if (reducedMotion) { sim.settle(SETTLE_STATIC); awake = false; snapFit(); }
      follow = true;
      userMoved = false;
      anim = null;
      hashDirty = true;
      request();
    },
    select(id) {
      const n = id ? byId.get(id) : null;
      sel = n && n.target === 1 ? n : null;
      refocus();
      request();
    },
    setMatches(ids) { matches = new Set(ids); request(); },
    focusNode(id) {
      const n = byId.get(id);
      if (!n || n.target !== 1) return;
      const k = Math.max(tf.k, FOCUS_K);
      const w = Math.max(1, W - PAD.l - focusInset.r);
      const h = Math.max(1, H - PAD.t - PAD.b - focusInset.b);
      moveTo({ k, x: PAD.l + w / 2 - n.x * k, y: PAD.t + h / 2 - n.y * k });
    },
    zoomToNode,
    resetLayout() { startLayout(null); wakeLayout(0.6); },
    useSavedLayout() { if (savedMap) { startLayout(savedMap); wakeLayout(0.6); } },
    exportPositions() { return nodes.map((n) => ({ id: n.id, x: n.hx ?? n.x, y: n.hy ?? n.y })); },
    setRelated(on) {
      showRelated = !!on;
      links = allLinks.filter((l) => showRelated || !l.assoc);
      if (!nodes.length) return;
      index();
      refocus();
      rebuildSim(0.5);
      if (reducedMotion) { sim.settle(SETTLE_STATIC); awake = false; }
      request();
    },
    flash(id) {
      if (!byId.has(id)) return;
      flashing = { id, t0: performance.now() };
      request();
    },
    setFocusInset(inset) {
      focusInset = { r: Math.max(0, inset?.r || 0), b: Math.max(0, inset?.b || 0) };
      if (follow || !userMoved) { follow = true; request(); }
    },
    reset() {
      userMoved = false;
      follow = true;
      anim = null;
      if (reducedMotion) snapFit();
      request();
    },
    zoomBy(f) { zoomAt(W / 2, H / 2, f); },
    resize,
    stats() {
      const f = Math.max(1, perf.frames);
      return { layoutDone: layout ? layout.done : true, crossings: layout ? layout.crossings : 0, frames: perf.frames, ticks: perf.ticks, sleeps: perf.sleeps, awake, simMs: perf.simMs / f, drawMs: perf.drawMs / f, nodes: nodes.length, links: links.length, k: tf.k };
    },
    nodeScreen(id) {
      const n = byId.get(id);
      return n ? { x: n.x * tf.k + tf.x, y: n.y * tf.k + tf.y, r: n.r * tf.k } : null;
    },
    wake(heat = 0.5) { if (sim && !reducedMotion) { sim.reheat(heat); awake = true; request(); } },
    destroy() {
      active = false;
      cancelHover();
      window.removeEventListener?.('blur', onBlur);
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
      scheme?.removeEventListener?.('change', onScheme);
      ro?.disconnect();
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
