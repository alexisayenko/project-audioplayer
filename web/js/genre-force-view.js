import { createSim } from './genre-sim.js';
import { fitTransform, recenterOnResize, placeLabels, isDragMove } from './genre-view.js';
import { createHash } from './genre-spatial.js';
import { createCrossingLayout } from './genre-layout.js';
import { FAMILY_PALETTE_SIZE, arrowHead } from './genre-data.js';
import { fillDisc } from './genre-disc.js';
import { shadeTable } from './genre-shade.js';

const MIN_K = 0.08;
const MAX_K = 8;
const FOCUS_K = 1.8;
const FONT_PX = 12;
const EMPHASIS_ALPHA = [0.34, 0.72, 1];
const DIM = 0.2;
const ANCESTOR_LEVELS = 12;
const FADE_STEP = 0.12;
const fadeAt = (d, floor) => (d > 1 ? Math.max(floor, 1 - FADE_STEP * (d - 1)) : 1);
const FADE_MS = 130;
const MOVE_MS = 380;
const FLASH_MS = 1400;
const DRAG_ALPHA = 0.1;
const RELEASE_ALPHA = 0.35;
const SETTLE_STATIC = 400;
const CHILD_FOLLOW_MS = 300;
const CHILD_FOLLOW_TAU = CHILD_FOLLOW_MS / 3;
const FOLLOW_EPS = 0.05;
const PARENT_REACTION = 0;
const REVEAL_ALPHA = 0.25;
const RING_GAP = 6;
const RING_SCALE = 3;
const RING_MAX = 70 * RING_SCALE;
const RING_PITCH = 6;
const RING_MULTI_MIN = 14;
const RING_STEP = 0.85;
const NEAR_STEP = 0.5;
const RING_ARC = (300 * Math.PI) / 180;
const SIM = { charge: 6, linkDistance: 20, gravity: 0, home: 0.05, velocityDecay: 0.34, parentStrength: 1.4, linkFloor: 0.15, parentReaction: PARENT_REACTION };
const LAYOUT_SLICE_MS = 6;
const LAYOUT_STATIC_MS = 1500;
const PAD = { t: 16, r: 0, b: 16, l: 16 };

const inert = () => ({
  setGraph() {}, setVisible() {}, setMarks() {}, setRelated() {}, resetLayout() {}, useSavedLayout() {}, exportPositions: () => [], select() {}, setMatches() {}, focusNode() {}, flash() {}, setFocusInset() {}, reset() {}, zoomBy() {}, resize() {}, destroy() {}, stats: () => ({}), nodeScreen: () => null,
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
      if (l.tree && l.t.ringPar === l.s.id) { l.dist = l.t.ringRad; continue; }
      l.dist =Math.hypot(l.s.hx - l.t.hx, l.s.hy - l.t.hy);
    }
  }

  function startLayout(saved) {
    if (!rawGraph) return;
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
    if (pull && stepPull(dt)) again = true;
    if (sim && awake && !reducedMotion) {
      awake = sim.tick();
      perf.ticks++;
      hashDirty = true;
      again = awake;
      if (!awake) perf.sleeps++;
    }
    if (pull && !drag?.node && (reducedMotion || !awake)) {
      stepFollow(1);
      clearPull();
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
    const depth = new Map();
    const edgeDepth = new Map();
    for (const id of adj.get(n.id) || []) set.add(byId.get(id));
    if (n === sel) {
      const seen = new Map([[n.id, 0]]);
      const queue = [n];
      for (let i = 0; i < queue.length && seen.get(queue[i].id) < ANCESTOR_LEVELS; i++) {
        const d = seen.get(queue[i].id) + 1;
        for (const l of parentLinks.get(queue[i].id) || []) {
          set.add(l.s); edges.add(l);
          if (!edgeDepth.has(l)) edgeDepth.set(l, d);
          if (!seen.has(l.s.id)) { seen.set(l.s.id, d); depth.set(l.s, d); queue.push(l.s); }
        }
      }
    }
    return { n, set, edges, depth, edgeDepth };
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

  function arrowLinks(list, k, alpha, color) {
    let any = false;
    for (const l of list) {
      if (l.related) continue;
      const a = arrowHead(l.s.x, l.s.y, l.s.r, l.t.x, l.t.y, l.t.r * (0.4 + 0.6 * l.t.vis), k);
      if (!a) continue;
      if (!any) { ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath(); any = true; }
      ctx.moveTo(a.tx, a.ty); ctx.lineTo(a.ax, a.ay); ctx.lineTo(a.bx, a.by); ctx.closePath();
    }
    if (any) ctx.fill();
  }

  function drawLinks(k) {
    const plain = [];
    const lit = [];
    const litFar = new Map();
    const dotted = [];
    const litDotted = [];
    const fading = [];
    for (const l of links) {
      const v = Math.min(l.s.vis, l.t.vis);
      if (v < 0.02) continue;
      if (v < 0.99) { fading.push(l); continue; }
      const on = focus?.edges.has(l);
      const d = on ? focus.edgeDepth.get(l) || 1 : 1;
      if (on && d > 1 && !l.assoc) litFar.set(d, [...(litFar.get(d) || []), l]);
      else if (l.assoc) (on ? litDotted : dotted).push(l); else (on ? lit : plain).push(l);
    }
    const base = focus ? 0.06 : 0.2;
    strokeLinks(plain, k, base, colors.edge, 1);
    for (const l of fading) strokeLinks([l], k, 0.3 * Math.min(l.s.vis, l.t.vis), colors.edge, 1, l.assoc);
    strokeLinks(dotted, k, base * 0.8, colors.edge, 0.7, true);
    strokeLinks(lit, k, 0.95, colors.accent, 1.8);
    for (const [d, list] of litFar) strokeLinks(list, k, Math.max(0.45, 0.95 - FADE_STEP * (d - 1)), colors.accent, 1.8);
    strokeLinks(litDotted, k, 0.95, colors.accent, 1.2, true);
    ctx.setLineDash([]);
    arrowLinks(plain, k, base, colors.edge);
    for (const l of fading) if (!l.assoc) arrowLinks([l], k, 0.3 * Math.min(l.s.vis, l.t.vis), colors.edge);
    arrowLinks(lit, k, 0.95, colors.accent);
    for (const [d, list] of litFar) arrowLinks(list, k, Math.max(0.45, 0.95 - FADE_STEP * (d - 1)), colors.accent);
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
    else if (focus?.depth.has(n)) a = fadeAt(focus.depth.get(n), 0.55);
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
    if (marks.has(n.id) && r * k >= 4) drawMark(n, r, a, k, marks.get(n.id));
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

  function drawMark(n, r, a, k, state) {
    ctx.globalAlpha = Math.max(a, 0.7);
    const br = 5 / k;
    const off = (r + 3 / k) * 0.72;
    const bx = n.x + off;
    const by = n.y + off;
    ctx.fillStyle = colors.ink;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = colors.halo;
    ctx.lineWidth = 1.5 / k;
    ctx.stroke();
    ctx.strokeStyle = colors.halo;
    ctx.lineWidth = 1.4 / k;
    const d = 2.4 / k;
    ctx.beginPath();
    ctx.moveTo(bx - d, by); ctx.lineTo(bx + d, by);
    if (state === 'closed') { ctx.moveTo(bx, by - d); ctx.lineTo(bx, by + d); }
    ctx.stroke();
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

  const pinnedOutside = (c, inside) => (parentLinks.get(c.id) || []).some((l) => l.s.target === 1 && l.s.fx != null && !inside.has(l.s.id));

  function subtreeOf(root) {
    const seen = new Set([root.id]);
    const out = [];
    let level = [root];
    for (let depth = 1; level.length; depth++) {
      const next = [];
      for (const p of level) {
        for (const c of childrenOf.get(p.id) || []) {
          if (seen.has(c.id) || pinnedOutside(c, seen)) continue;
          seen.add(c.id);
          out.push({ c, depth });
          next.push(c);
        }
      }
      level = next;
    }
    return out;
  }

  function shift(c, dx, dy) {
    if (c.hx !== undefined) { c.hx += dx; c.hy += dy; }
    if (c.target !== 1) return;
    c.x += dx; c.y += dy;
    c.fx = c.x; c.fy = c.y;
  }

  function followItems(root, sub) {
    const inside = new Set(sub.map((it) => it.c.id));
    const muted = [];
    for (const sl of sim?.links || []) {
      if (sl.tree && inside.has(sl.t.id)) { sl.mute = true; muted.push(sl); }
    }
    return { root, items: sub.map(({ c }) => ({ c, ax: 0, ay: 0 })), muted, ox: root.x, oy: root.y };
  }

  function clearPull() {
    if (!pull) return;
    for (const sl of pull.muted) sl.mute = false;
    for (const { c } of pull.items) if (c.target === 1) unpin(c);
    const settled = pull.muted.length > 0;
    pull = null;
    if (settled) syncLinkLength();
  }

  function stepFollow(f) {
    const root = pull.root;
    const dx = (root.fx ?? root.x) - pull.ox;
    const dy = (root.fy ?? root.y) - pull.oy;
    let busy = false;
    for (const it of pull.items) {
      const rx = dx - it.ax;
      const ry = dy - it.ay;
      const len = Math.hypot(rx, ry);
      if (len === 0) continue;
      const k = len < FOLLOW_EPS ? 1 : f;
      shift(it.c, rx * k, ry * k);
      it.ax += rx * k; it.ay += ry * k;
      if (len >= FOLLOW_EPS) busy = true;
    }
    if (busy) hashDirty = true;
    return busy;
  }

  function stepPull(dt) {
    return stepFollow(1 - Math.exp(-dt / CHILD_FOLLOW_TAU));
  }

  function startNodeDrag() {
    drag.node.fx = drag.node.x;
    drag.node.fy = drag.node.y;
    clearPull();
    drag.sub = subtreeOf(drag.node);
    drag.ax = drag.node.x;
    drag.ay = drag.node.y;
    pull = followItems(drag.node, drag.sub);
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
    if (reducedMotion || !sim) {
      n.x = w.x; n.y = w.y; n.fx = w.x; n.fy = w.y;
      if (pull) stepFollow(1);
    } else { n.fx = w.x; n.fy = w.y; }
    setHover(n, null);
  }

  function endDrag(ev) {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.node) {
      for (const p of d.held || []) unpin(p);
      if (d.moved) { d.node.hx = d.ax; d.node.hy = d.ay; syncLinkLength(); }
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

  function fanSlots(rs, par, center, arc) {
    const count = rs.length;
    const maxR = Math.max(...rs);
    const pitch = 2 * (rs.reduce((s, r) => s + r, 0) / count) + RING_PITCH;
    const first = RING_SCALE * (par.r + maxR + RING_GAP);
    const at = (ang, rad) => ({ ang, rad });
    if (count <= RING_MULTI_MIN) {
      const rad = Math.min(RING_MAX, Math.max(first, (RING_SCALE * count * pitch) / arc));
      return rs.map((_, i) => at(center - arc / 2 + (arc * (i + 0.5)) / count, rad));
    }
    const step = RING_SCALE * pitch * RING_STEP;
    const radii = [];
    for (let cap = 0, k = 0; cap < count && k < 24; k++) {
      radii.push(first + k * step);
      cap += (arc * radii[k]) / pitch;
    }
    const total = radii.reduce((s, r) => s + r, 0);
    const per = radii.map((r) => Math.floor((count * r) / total));
    const order = radii.map((r, k) => ({ k, rem: (count * r) / total - per[k] })).sort((a, b) => b.rem - a.rem);
    for (let left = count - per.reduce((s, c) => s + c, 0), i = 0; left > 0; left--, i++) per[order[i % order.length].k]++;
    const slots = [];
    radii.forEach((rad, k) => {
      for (let j = 0; j < per[k]; j++) slots.push(at(center - arc / 2 + (arc * (j + (k % 2 ? 0.25 : 0.75))) / per[k], rad));
    });
    return slots.sort((a, b) => a.ang - b.ang || a.rad - b.rad);
  }

  function fanCenter(par, ready) {
    const ups = (parentLinks.get(par.id) || []).map((l) => l.s).filter(ready);
    if (!ups.length) return { center: (par.id.length % 11) * 0.3, arc: 2 * Math.PI };
    const gx = ups.reduce((s, m) => s + m.x, 0) / ups.length;
    const gy = ups.reduce((s, m) => s + m.y, 0) / ups.length;
    if (Math.hypot(par.x - gx, par.y - gy) < 1) return { center: (par.id.length % 11) * 0.3, arc: 2 * Math.PI };
    return { center: Math.atan2(par.y - gy, par.x - gx), arc: RING_ARC };
  }

  function enterNodes(entering, chained = false) {
    const fresh = new Set(entering);
    const placed = new Set();
    const ready = (m) => m.target === 1 && ((chained && placed.has(m)) || (!fresh.has(m) && m.vis > 0.3));
    const pending = new Set(entering);
    const fan = (par, kids) => {
      const { center, arc } = fanCenter(par, ready);
      const slots = fanSlots(kids.map((n) => n.r), par, center, arc);
      kids.forEach((n, i) => {
        const { ang, rad } = slots[i];
        n.x = par.x + Math.cos(ang) * rad;
        n.y = par.y + Math.sin(ang) * rad;
        n.vx = 0; n.vy = 0;
        n.hx = n.x; n.hy = n.y;
        n.ringPar = par.id; n.ringRad = rad;
        placed.add(n);
        pending.delete(n);
      });
    };
    const seeds = new Map(entering.map((n) => [n, { x: n.hx ?? n.x, y: n.hy ?? n.y }]));
    const anchored = new Map();
    const reach = (a, n) => {
      const rings = nodes.filter((m) => m.ringPar === a.id && m.target === 1 && !fresh.has(m)).map((m) => m.ringRad);
      const kids = [...pending].filter((m) => (parentLinks.get(m.id) || []).some((l) => l.s === a));
      if (kids.length) {
        const { center, arc } = fanCenter(a, ready);
        rings.push(...fanSlots(kids.map((m) => m.r), a, center, arc).map((o) => o.rad));
      }
      return rings.length ? Math.max(...rings) + RING_SCALE * RING_GAP + n.r : RING_SCALE * (a.r + n.r + RING_GAP);
    };
    const nearArc = (n, a) => {
      const from = seeds.get(a) || { x: a.hx ?? a.x, y: a.hy ?? a.y };
      const to = seeds.get(n) || { x: n.hx ?? n.x, y: n.hy ?? n.y };
      const k = anchored.get(a) || 0;
      anchored.set(a, k + 1);
      const base = Math.hypot(to.x - from.x, to.y - from.y) > 1 ? Math.atan2(to.y - from.y, to.x - from.x) : (n.id.length % 11) * 0.6;
      const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * NEAR_STEP;
      const rad = reach(a, n);
      n.x = a.x + Math.cos(ang) * rad;
      n.y = a.y + Math.sin(ang) * rad;
      n.vx = 0; n.vy = 0;
      n.hx = n.x; n.hy = n.y;
      n.ringPar = null;
    };
    const near = (n) => {
      const nb = [...(adj.get(n.id) || [])].map((id) => byId.get(id)).filter(ready);
      if (!nb.length) return false;
      n.x = nb.reduce((s, m) => s + m.x, 0) / nb.length + ((n.id.length % 7) - 3);
      n.y = nb.reduce((s, m) => s + m.y, 0) / nb.length + ((n.id.length % 5) - 2);
      n.vx = 0; n.vy = 0;
      n.ringPar = null;
      placed.add(n);
      pending.delete(n);
      return true;
    };
    const lift = () => {
      let any = false;
      for (let again = true; again; ) {
        again = false;
        for (const n of [...pending]) {
          const kid = (childrenOf.get(n.id) || []).find(ready);
          if (!kid) continue;
          nearArc(n, kid);
          placed.add(n);
          pending.delete(n);
          again = true;
          any = true;
        }
      }
      return any;
    };
    for (let moved = true; moved && pending.size; ) {
      moved = false;
      if (chained && lift()) moved = true;
      const groups = new Map();
      for (const n of pending) {
        const par = (parentLinks.get(n.id) || []).map((l) => l.s).find(ready);
        if (par) groups.set(par, [...(groups.get(par) || []), n]);
      }
      for (const [par, kids] of groups) { fan(par, kids); moved = true; }
      for (const n of [...pending]) if (near(n)) moved = true;
      if (!chained) break;
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
    setVisible(ids, { heat = 0.7, keepCamera = false, chained = false } = {}) {
      visibleSet = ids ? new Set(ids) : null;
      if (!nodes.length) return;
      const before = new Map(nodes.map((n) => [n.id, n.target]));
      applyVisible();
      const entering = nodes.filter((n) => n.target === 1 && before.get(n.id) === 0);
      const changed = entering.length > 0 || nodes.some((n) => n.target === 0 && before.get(n.id) === 1);
      if (!changed) return;
      enterNodes(entering, chained);
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
