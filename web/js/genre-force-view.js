import { createSim } from './genre-sim.js';
import { fitTransform, recenterOnResize, placeLabels, isDragMove } from './genre-view.js';
import { createHash } from './genre-spatial.js';
import { createCrossingLayout } from './genre-layout.js';
import { FAMILY_PALETTE_SIZE, onSlotColours, isOutlinedSlot } from './genre-data.js';
import { fillDisc, outlineDisc } from './genre-disc.js';
import { shadeTable } from './genre-shade.js';
import { enterNodes } from './genre-force-enter.js';
import { focusState } from './genre-force-focus.js';
import { drawLinks, FADE_STEP } from './genre-force-links.js';
import { DISCOGS_RING, GROUP_RING, strokeRing, dashedRing, drawBadge, drawMark, paintFlash } from './genre-force-draw.js';
import { bounds, unpin } from './genre-force-body.js';
import { FOLLOW_STEP_MS, subtreeOf, followItems, stepTethers, integrateSprings, restSprings, snapSprings } from './genre-force-follow.js';

const MIN_K = 0.08;
const MAX_K = 8;
const FOCUS_K = 1.8;
const FONT_PX = 12;
const EMPHASIS_ALPHA = [0.34, 0.72, 1];
const DIM = 0.2;
const fadeAt = (d, floor) => (d > 1 ? Math.max(floor, 1 - FADE_STEP * (d - 1)) : 1);
const FADE_MS = 130;
const MOVE_MS = 380;
const FLASH_MS = 1400;
const DRAG_ALPHA = 0.1;
const RELEASE_ALPHA = 0.35;
const SETTLE_STATIC = 400;
const CHILD_FOLLOW_MS = 300;
const CHILD_FOLLOW_TAU = CHILD_FOLLOW_MS / 3;
const PARENT_REACTION = 0;
const REVEAL_ALPHA = 0.25;
const SIM = { charge: 6, linkDistance: 20, gravity: 0, home: 0.05, velocityDecay: 0.34, parentStrength: 1.4, linkFloor: 0.15, parentReaction: PARENT_REACTION };
const LAYOUT_SLICE_MS = 6;
const LAYOUT_STATIC_MS = 1500;
const PAD = { t: 16, r: 0, b: 16, l: 16 };

const inert = () => ({
  setGraph() {}, setVisible() {}, setMarks() {}, setRelated() {}, resetLayout() {}, useSavedLayout() {}, exportPositions: () => [], movedPositions: () => new Map(), select() {}, setMatches() {}, focusNode() {}, flash() {}, setFocusInset() {}, reset() {}, zoomBy() {}, resize() {}, destroy() {}, stats: () => ({}), nodeScreen: () => null,
});

const clampK = (k) => Math.min(MAX_K, Math.max(MIN_K, k));

function linkKind(l) {
  if (l.assoc) return 'assoc';
  return l.related ? 'related' : 'parent';
}

export function createForceView(canvas, { onSelect, onHover, onMoved, reducedMotion = false, simOptions = {}, rigid = false } = {}) {
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
  let movedIds = new Set();
  let showRelated = false;
  let byId = new Map();
  let adj = new Map();
  let incident = new Map();
  let parentLinks = new Map();
  let childrenOf = new Map();
  let sim = null;
  let awake = false;
  let sel = null;
  let hover = null;
  let focus = null;
  let matches = new Set();
  let visibleSet = null;
  let marks = new Map();
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
  let pull = null;
  const springs = new Map();
  let springAcc = 0;
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
      edge: v('--ink-muted'), rim: v('--chart-rim'), accent: v('--accent-ink'), ink: v('--ink'), halo: v('--surface'), warn: v('--accent'), font: cs.fontFamily || 'sans-serif',
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

  function fitFor(list, { maxK = 1.6, pad = 24 } = {}) {
    if (!list.length) return null;
    return fitTransform(bounds(list), W, H, { insets: { t: PAD.t, r: focusInset.r, b: PAD.b + focusInset.b, l: PAD.l }, pad, minK: MIN_K, maxK });
  }

  const liveNodes = () => nodes.filter((n) => n.target === 1);

  function inView() {
    const x1 = W - focusInset.r;
    const y1 = H - PAD.b - focusInset.b;
    return liveNodes().every((n) => {
      const r = n.r * tf.k;
      const x = n.x * tf.k + tf.x;
      const y = n.y * tf.k + tf.y;
      return x - r >= PAD.l && x + r <= x1 && y - r >= PAD.t && y + r <= y1;
    });
  }

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
    const ls = links.filter((l) => ids.has(l.s.id) && ids.has(l.t.id)).map((l) => ({ source: l.s.id, target: l.t.id, kind: linkKind(l) }));
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
      if (l.tree && l.t.ringPar === l.s.id) { l.dist = l.t.ringRad; continue; }
      l.dist =Math.hypot(l.s.hx - l.t.hx, l.s.hy - l.t.hy);
    }
  }

  function startLayout(saved) {
    if (!rawGraph) return;
    for (const n of nodes) if (n.dropped) { n.dropped = false; unpin(n); }
    layout = createCrossingLayout({ nodes, links: rawGraph.links }, { saved });
    layout.apply();
    for (const n of nodes) n.ringPar = null;
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

  function stepLayout() {
    if (!layout || layout.done || reducedMotion) return false;
    if (layout.step(LAYOUT_SLICE_MS) || layout.done) {
      layout.apply();
      syncLinkLength();
      if (sim) { sim.reheat(0.25); awake = true; }
    }
    return true;
  }

  function tickSim() {
    if (!sim || !awake || reducedMotion || (rigid && drag?.moved)) return false;
    awake = sim.tick();
    perf.ticks++;
    hashDirty = true;
    if (!awake) perf.sleeps++;
    return true;
  }

  function settlePull() {
    if (!pull || drag?.node) return;
    if (!reducedMotion && awake) return;
    stepFollow(1);
    clearPull();
  }

  function frame(now) {
    raf = 0;
    if (!active) return;
    const t0 = performance.now();
    const dt = Math.min(64, Math.max(1, last ? now - last : 16));
    last = now;
    let again = stepLayout();
    if (pull && stepPull(dt)) again = true;
    if (springs.size && stepSprings(dt)) again = true;
    if (tickSim()) again = awake;
    settlePull();
    const t1 = performance.now();
    if (stepVis(dt)) again = true;
    if (stepCamera(now)) again = true;
    draw();
    if (flashing) again = true;
    perf.frames++;
    perf.simMs += t1 - t0;
    perf.drawMs += performance.now() - t1;
    if (again) request(); else last = 0;
  }

  function refocus() { focus = focusState(sel, sel, { incident, adj, byId, parentLinks }); }

  function nodeAlpha(n) {
    let a = n.level === 1 ? 1 : EMPHASIS_ALPHA[n.em];
    if (focus && !focus.set.has(n)) a *= DIM;
    else if (focus?.depth.has(n)) a = fadeAt(focus.depth.get(n), 0.55);
    return a * n.vis;
  }

  function drawNode(n, k) {
    const r = n.r * (0.4 + 0.6 * n.vis);
    const a = nodeAlpha(n);
    ctx.globalAlpha = a;
    fillDisc(ctx, { x: n.x, y: n.y, r }, colors.fam, n.fis, colors.ink, n.subOrder ? shadeIdx : -1, n.subOrder ? colors.shades[n.subOrder] : null);
    if (n.em === 2 || n.level === 1) {
      ctx.strokeStyle = colors.halo;
      ctx.lineWidth = 1.5 / k;
      ctx.stroke();
    }
    outlineDisc(ctx, { x: n.x, y: n.y, r }, n.fis, isOutlinedSlot, colors.rim, k);
    if (n.vis < 0.99) return;
    drawAdornments(n, r, a, k);
  }

  function drawAdornments(n, r, a, k) {
    if (!n.node.discogs && n.level > 1 && r * k >= 3) dashedRing(ctx, colors, n, r, a, k, DISCOGS_RING);
    if (n.node.group) dashedRing(ctx, colors, n, r, a, k, GROUP_RING);
    drawHighlight(n, k);
    if (n.node.status === 'question' && r * k >= 4) drawBadge(ctx, colors, n, r, a, k);
    if (marks.has(n.id) && r * k >= 4) drawMark(ctx, colors, n, r, a, k, marks.get(n.id));
    if (flashing && flashing.id === n.id) drawFlash(n, k);
  }

  function drawHighlight(n, k) {
    if (n === sel) strokeRing(ctx, n, 3.5, 3, colors.accent, k);
    else if (n === hover) strokeRing(ctx, n, 3, 2, colors.accent, k);
    else if (matches.has(n.id)) strokeRing(ctx, n, 3, 2.5, colors.accent, k);
  }

  function drawFlash(n, k) {
    const t = (performance.now() - flashing.t0) / FLASH_MS;
    if (t >= 1) { flashing = null; return; }
    paintFlash(ctx, colors, n, k, t, reducedMotion);
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
    drawLinks(ctx, links, focus, colors, k);
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

  function releaseGhosts() {
    if (!pull) return;
    pull.root.ghost = false;
    for (const { c } of pull.items) c.ghost = false;
  }

  function clearPull() {
    if (!pull) return;
    releaseGhosts();
    for (const sl of pull.muted) sl.mute = false;
    for (const { c } of pull.items) if (c.target === 1) unpin(c);
    const settled = pull.muted.length > 0;
    pull = null;
    if (settled) syncLinkLength();
  }

  function stepFollow(f) {
    const busy = stepTethers(pull, f);
    if (busy) hashDirty = true;
    return busy;
  }

  const springHeld = (root) => !!(drag?.moved && drag.node === root);

  function stepSprings(dt) {
    springAcc = Math.min(springAcc + dt, 100);
    const h = FOLLOW_STEP_MS / 1000;
    while (springAcc >= FOLLOW_STEP_MS) {
      springAcc -= FOLLOW_STEP_MS;
      integrateSprings(springs, h);
    }
    restSprings(springs, springHeld);
    hashDirty = true;
    return springs.size > 0;
  }

  function stepPull(dt) {
    return stepFollow(1 - Math.exp(-dt / CHILD_FOLLOW_TAU));
  }

  function startNodeDrag() {
    drag.node.fx = drag.node.x;
    drag.node.fy = drag.node.y;
    clearPull();
    drag.sub = subtreeOf(drag.node, { childrenOf, parentLinks });
    drag.ax = drag.node.x;
    drag.ay = drag.node.y;
    if (rigid) {
      const root = drag.node;
      springs.delete(root);
      for (const { c } of drag.sub) {
        if (c.target === 1) { c.fx = c.x; c.fy = c.y; }
        springs.set(c, { root, ox: c.x - root.x, oy: c.y - root.y, px: c.x, py: c.y, vx: 0, vy: 0 });
      }
      follow = false;
      userMoved = true;
      return;
    }
    pull = reducedMotion ? null : followItems(drag.node, drag.sub, sim?.links || [], parentLinks);
    drag.held = [];
    for (const l of parentLinks.get(drag.node.id) || []) {
      const p = l.s;
      if (p.target !== 1 || p.fx != null || drag.held.includes(p)) continue;
      p.fx = p.x; p.fy = p.y;
      drag.held.push(p);
    }
    follow = false;
    userMoved = true;
    if (sim && !reducedMotion) { sim.setAlphaTarget(DRAG_ALPHA); awake = true; }
  }

  function moveDragNode(p) {
    const w = toWorld(p.x, p.y);
    const n = drag.node;
    drag.ax = w.x; drag.ay = w.y;
    hashDirty = true;
    if (rigid) {
      n.x = w.x; n.y = w.y; n.fx = w.x; n.fy = w.y;
      if (reducedMotion) snapSprings(springs);
      setHover(n, null);
      request();
      return;
    }
    if (reducedMotion || !sim) {
      n.x = w.x; n.y = w.y; n.fx = w.x; n.fy = w.y;
      if (pull) stepFollow(1);
    } else { n.fx = w.x; n.fy = w.y; }
    setHover(n, null);
  }

  function dropMovedNode(d) {
    d.node.hx = d.ax; d.node.hy = d.ay;
    syncLinkLength();
    d.node.dropped = true; d.node.fx = d.ax; d.node.fy = d.ay;
    if (rigid) {
      for (const { c } of d.sub || []) if (c.target === 1) { c.dropped = true; c.fx = c.x; c.fy = c.y; }
    }
    if (sim && !reducedMotion && !rigid) { sim.setAlphaTarget(sim.restTarget()); sim.reheat(RELEASE_ALPHA); awake = true; }
    movedIds.add(d.node.id);
    for (const { c } of d.sub || []) movedIds.add(c.id);
    onMoved?.();
  }

  function finishNodeDrag(d, ev) {
    for (const p of d.held || []) unpin(p);
    releaseGhosts();
    if (d.moved) { dropMovedNode(d); return; }
    if (!d.node.dropped) unpin(d.node);
    if (ev.type === 'pointerup') onSelect?.(d.node.id);
  }

  function endDrag(ev) {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.node) finishNodeDrag(d, ev);
    else if (!d.moved && ev.type === 'pointerup') onSelect?.(null);
    if (ev.pointerType === 'touch') setHover(null);
    canvas.style.cursor = hover ? 'pointer' : 'grab';
    request();
  }

  const stop = () => {
    for (const n of nodes) if (n.fx != null && !n.dropped) unpin(n);
    if (sim) sim.setAlphaTarget(sim.restTarget());
    pointers.clear(); pinch = null; drag = null;
    clearPull();
  };

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') stop();
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    canvas.setPointerCapture?.(ev.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      if (drag?.node) { drag.node.dropped = false; unpin(drag.node); }
      drag = null;
      return;
    }
    cancelHover();
    anim = null;
    const hit = pick(ev);
    drag = { node: hit, sx: ev.clientX, sy: ev.clientY, lx: p.x, ly: p.y, moved: false };
    if (ev.pointerType !== 'touch') setHover(hit, ev);
  });

  function pinchMove() {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
    pinch.d = d;
  }

  function panBy(p) {
    tf = { ...tf, x: tf.x + p.x - drag.lx, y: tf.y + p.y - drag.ly };
    userMoved = true;
    follow = false;
    canvas.style.cursor = 'grabbing';
  }

  function dragMove(ev, p) {
    if (!drag.moved) {
      if (!isDragMove(ev.clientX - drag.sx, ev.clientY - drag.sy)) return;
      drag.moved = true;
      if (drag.node) startNodeDrag(); else onHover?.(null);
    }
    if (drag.node) moveDragNode(p); else panBy(p);
    drag.lx = p.x; drag.ly = p.y;
    request();
  }

  function onPointerMove(ev) {
    if ((drag || pinch) && ev.pointerType !== 'touch' && ev.buttons === 0) stop();
    if (!pointers.has(ev.pointerId)) {
      if (ev.pointerType !== 'touch') queueHover(ev);
      return;
    }
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    if (pinch && pointers.size === 2) pinchMove();
    else if (drag) dragMove(ev, p);
  }

  canvas.addEventListener('pointermove', onPointerMove);

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
    if (n?.target !== 1) return;
    const group =[n, ...[...(adj.get(id) || [])].map((x) => byId.get(x)).filter((x) => x.target === 1)];
    const to = fitFor(group, { maxK: 2.4, pad: 40 });
    if (to) moveTo(to);
  }

  function onVisibility() { if (!globalThis.document?.hidden) { last = 0; request(); } }
  globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
  const scheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const onScheme = () => { readColors(); request(); };
  scheme?.addEventListener?.('change', onScheme);
  const offColours = onSlotColours(onScheme);
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => resize()); ro.observe(canvas); }

  function index() {
    byId = new Map(nodes.map((n) => [n.id, n]));
    adj = new Map(nodes.map((n) => [n.id, new Set()]));
    incident = new Map(nodes.map((n) => [n.id, []]));
    parentLinks = new Map();
    childrenOf = new Map();
    for (const l of links) {
      adj.get(l.s.id).add(l.t.id); adj.get(l.t.id).add(l.s.id);
      incident.get(l.s.id).push(l); incident.get(l.t.id).push(l);
      if (l.related || l.assoc) continue;
      if (parentLinks.has(l.t.id)) parentLinks.get(l.t.id).push(l); else parentLinks.set(l.t.id, [l]);
      if (childrenOf.has(l.s.id)) childrenOf.get(l.s.id).push(l.t); else childrenOf.set(l.s.id, [l.t]);
    }
    clearPull();
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

  const enter = (entering, chained) => enterNodes(entering, chained, { nodes, byId, adj, parentLinks, childrenOf });

  return {
    setGraph(graph, { saved = null, moved = null } = {}) {
      rawGraph = graph;
      springs.clear();
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
      movedIds = new Set(moved instanceof Map ? [...moved.keys()].filter((id) => idx.has(id)) : []);
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
    setVisible(ids, { heat = 0.7, keepCamera = false, chained = false } = {}) {
      visibleSet = ids ? new Set(ids) : null;
      if (!nodes.length) return;
      const before = new Map(nodes.map((n) => [n.id, n.target]));
      applyVisible();
      const entering = nodes.filter((n) => n.target === 1 && before.get(n.id) === 0);
      const changed = entering.length > 0 || nodes.some((n) => n.target === 0 && before.get(n.id) === 1);
      if (!changed) return;
      enter(entering, chained);
      rebuildSim(chained ? Math.min(heat, REVEAL_ALPHA) : heat);
      const hold = keepCamera && (userMoved || (chained && inView()));
      if (hold && !userMoved) follow = false;
      if (reducedMotion) { sim.settle(SETTLE_STATIC); awake = false; if (!hold) snapFit(); }
      if (!hold) { follow = true; userMoved = false; anim = null; }
      hashDirty = true;
      request();
    },
    setMarks(map) { marks = map instanceof Map ? map : new Map(); request(); },
    select(id) {
      const n = id ? byId.get(id) : null;
      sel = n?.target === 1 ? n : null;
      refocus();
      request();
    },
    setMatches(ids) { matches = new Set(ids); request(); },
    focusNode(id) {
      const n = byId.get(id);
      if (n?.target !== 1) return;
      const k = Math.max(tf.k, FOCUS_K);
      const w = Math.max(1, W - PAD.l - focusInset.r);
      const h = Math.max(1, H - PAD.t - PAD.b - focusInset.b);
      moveTo({ k, x: PAD.l + w / 2 - n.x * k, y: PAD.t + h / 2 - n.y * k });
    },
    zoomToNode,
    resetLayout() { movedIds.clear(); startLayout(null); wakeLayout(0.6); },
    useSavedLayout() { if (savedMap) { startLayout(savedMap); wakeLayout(0.6); } },
    exportPositions() { return nodes.map((n) => ({ id: n.id, x: n.hx ?? n.x, y: n.hy ?? n.y })); },
    movedPositions() {
      const out = new Map();
      for (const id of movedIds) {
        const n = byId.get(id);
        const x = n ? n.hx ?? n.x : Number.NaN;
        const y = n ? n.hy ?? n.y : Number.NaN;
        if (Number.isFinite(x) && Number.isFinite(y)) out.set(id, [Math.round(x), Math.round(y)]);
      }
      return out;
    },
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
      offColours();
      ro?.disconnect();
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
