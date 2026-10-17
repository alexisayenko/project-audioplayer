import { createSim } from './genre-sim.js';
import { familyIndex, nodeRadius, FAMILIES, ancestorsOf } from './genre-data.js';
import { fitTransform, recenterOnResize, placeLabels, diffGraph, mixColor, hitNode, isDragMove } from './genre-view.js';

const MIN_K = 0.15;
const MAX_K = 6;
const BAR_GAP = 8;

function bbox(list) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const n of list) {
    x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r);
    y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r);
  }
  return { x0, y0, x1, y1 };
}

function ancAlpha(depth, top, floor) {
  return Math.max(floor, top - 0.12 * (depth - 1));
}

function linkAlpha(on, focus) {
  if (!on) return 0.06;
  return focus ? 0.95 : 0.5;
}

export function createGraphView(canvas, { onSelect, onHover, reducedMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  let W = 1;
  let H = 1;
  let dpr = 1;
  let tf = { k: 1, x: 0, y: 0 };
  let nodes = [];
  let links = [];
  let marked = new Set();
  let sim = null;
  let byId = new Map();
  let nbr = new Map();
  let hover = null;
  let selected = null;
  let selSet = new Set();
  let anc = new Map();
  let rawEdges = [];
  let withAnc = false;
  let active = true;
  let raf = 0;
  let anim = null;
  let colors = readColors();
  let drag = null;
  const pointers = new Map();
  let pinch = null;
  let needFit = true;
  let autoFitAt = 0;
  let userMoved = false;
  let insets = { t: 56, r: 0, b: 16, l: 16 };
  let bar = null;
  let barRo = null;
  let hiddenIdx = new Set();
  let order = [];
  let lastGraph = null;
  const widths = new Map();

  function readColors() {
    const cs = getComputedStyle(canvas);
    const v = (name) => cs.getPropertyValue(name).trim();
    return {
      fam: FAMILIES.map((_, i) => v(`--chart-${i}`)),
      edge: v('--ink-muted'),
      hi: v('--accent-ink'),
      label: v('--ink'),
      halo: v('--surface'),
      ring: v('--accent-ink'),
      font: cs.fontFamily || 'sans-serif',
    };
  }

  function measureBar() {
    if (!bar) {
      bar = canvas.closest?.('.gm')?.querySelector?.('.gm-bar') ?? null;
      if (bar && typeof ResizeObserver === 'function') {
        barRo = new ResizeObserver(() => { if (measureBar() && !userMoved && nodes.length) fitTo(nodes.filter(visible)); });
        barRo.observe(bar);
      }
    }
    if (!bar?.offsetHeight) return false;
    const t = (bar.offsetTop || 0) + bar.offsetHeight + BAR_GAP;
    if (t === insets.t) return false;
    insets = { ...insets, t };
    return true;
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const ow = W;
    const oh = H;
    W = Math.max(1, canvas.clientWidth);
    H = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    colors = readColors();
    measureBar();
    widths.clear();
    const laidOut = canvas.clientWidth > 10 && canvas.clientHeight > 10;
    if (laidOut && needFit && nodes.length) { fit(); needFit = false; autoFitAt = performance.now() + 700; }
    else if (laidOut && ow > 10 && oh > 10) { tf = recenterOnResize(tf, ow, oh, W, H); anim = null; }
    request();
  }

  function request() {
    if (!raf && active && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    if (!active || document.hidden) return;
    if (!colors.label) colors = readColors();
    let again = false;
    if (sim && !reducedMotion) { sim.tick(); again = true; }
    if (anim) { stepAnim(); again = true; }
    if (autoFitAt && performance.now() > autoFitAt) {
      autoFitAt = 0;
      if (!userMoved) fitTo(nodes.filter(visible));
    }
    if (autoFitAt) again = true;
    if (mixStep()) again = true;
    draw();
    if (again) request();
  }

  const visible = (n) => !hiddenIdx.has(n.fi);

  function mixStep() {
    let busy = false;
    for (const n of nodes) {
      if (n.mix < 1) { n.mix = Math.min(1, n.mix + 0.04); busy = true; }
    }
    return busy;
  }

  const nodeColor = (n) => (n.mix < 1 ? mixColor(colors.fam[n.fiPrev], colors.fam[n.fi], n.mix) : colors.fam[n.fi]);

  function toWorld(sx, sy) { return [(sx - tf.x) / tf.k, (sy - tf.y) / tf.k]; }

  function nodeAt(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    return hitNode(nodes, wx, wy, 3 / tf.k, visible);
  }

  function fitTo(list, { pad = 32, maxK = 2.2, animate = true } = {}) {
    if (!list.length) return;
    const to = fitTransform(bbox(list), W, H, { insets, pad, maxK, minK: MIN_K });
    if (animate && !reducedMotion) anim = { from: { ...tf }, to, t: 0 };
    else { tf = to; anim = null; }
    request();
  }

  function stepAnim() {
    anim.t = Math.min(1, anim.t + 0.07);
    const e = 1 - (1 - anim.t) ** 3;
    tf = {
      k: anim.from.k + (anim.to.k - anim.from.k) * e,
      x: anim.from.x + (anim.to.x - anim.from.x) * e,
      y: anim.from.y + (anim.to.y - anim.from.y) * e,
    };
    if (anim.t >= 1) anim = null;
  }

  function zoomAt(factor, sx, sy) {
    const k = Math.min(MAX_K, Math.max(MIN_K, tf.k * factor));
    const f = k / tf.k;
    tf = { k, x: sx - (sx - tf.x) * f, y: sy - (sy - tf.y) * f };
    anim = null;
    userMoved = true;
    request();
  }

  function drawArrow(l, k, d) {
    const ux = (l.t.x - l.s.x) / d;
    const uy = (l.t.y - l.s.y) / d;
    const tipX = l.t.x - ux * (l.t.r + 1);
    const tipY = l.t.y - uy * (l.t.r + 1);
    const s = 6 / k;
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * s - uy * s * 0.5, tipY - uy * s + ux * s * 0.5);
    ctx.lineTo(tipX - ux * s + uy * s * 0.5, tipY - uy * s - ux * s * 0.5);
    ctx.closePath();
    ctx.fill();
  }


  function drawLink(l, focus, k) {
    const chain = !l.related && anc.has(l.t) && (anc.has(l.s) || focus?.has(l.s));
    const on = !focus || focus.has(l.s) || focus.has(l.t) || chain;
    ctx.globalAlpha = chain ? ancAlpha(anc.get(l.t), 0.95, 0.45) : linkAlpha(on, focus);
    ctx.strokeStyle = on && focus ? colors.hi : colors.edge;
    ctx.lineWidth = (on && focus ? 1.8 : 1) / k;
    ctx.setLineDash(l.related ? [4 / k, 4 / k] : []);
    const d = Math.hypot(l.t.x - l.s.x, l.t.y - l.s.y) || 1;
    ctx.beginPath();
    ctx.moveTo(l.s.x, l.s.y);
    ctx.lineTo(l.t.x, l.t.y);
    ctx.stroke();
    if (!l.related && k > 0.45 && d > l.t.r + 10 / k) drawArrow(l, k, d);
  }

  function drawNode(n, alpha, k) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = nodeColor(n);
    ctx.fill();
    ctx.lineWidth = 1.5 / k;
    ctx.strokeStyle = colors.halo;
    ctx.stroke();
    if (marked.has(n.id)) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 6 / k, 0, Math.PI * 2);
      ctx.lineWidth = 2 / k;
      ctx.strokeStyle = colors.ring;
      ctx.stroke();
    }
    if (selSet.has(n) || n === hover) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 3 / k, 0, Math.PI * 2);
      ctx.lineWidth = (selSet.has(n) ? 2.5 : 1.5) / k;
      ctx.strokeStyle = colors.ring;
      ctx.stroke();
    }
  }

  function nodeAlpha(n, on, near) {
    if (!on) return 0.16;
    const d = anc.get(n);
    return d && !near.has(n.id) ? ancAlpha(d, 1, 0.55) : 1;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(tf.x, tf.y);
    ctx.scale(tf.k, tf.k);
    const k = tf.k;
    const focus = selSet.size ? selSet : null;
    const near = new Set();
    if (focus) for (const f of focus) for (const id of nbr.get(f.id) || []) near.add(id);
    const isOn = (n) => !focus || focus.has(n) || near.has(n.id) || anc.has(n);
    for (const l of links) {
      if (visible(l.s) && visible(l.t)) drawLink(l, focus, k);
    }
    ctx.setLineDash([]);
    for (const n of nodes) {
      if (visible(n)) drawNode(n, nodeAlpha(n, isOn(n), near), k);
    }
    ctx.globalAlpha = 1;
    drawLabels(focus, isOn);
  }

  function labelWidth(text) {
    let w = widths.get(text);
    if (w === undefined) { w = ctx.measureText(text).width; widths.set(text, w); }
    return w;
  }

  function drawLabels(focus, isOn) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `12px ${colors.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const cands = [];
    for (const n of order) {
      if (!visible(n)) continue;
      const force = !!focus && isOn(n);
      if (focus && !force) continue;
      const sx = n.x * tf.k + tf.x;
      const sy = n.y * tf.k + tf.y;
      if (sx < -80 || sx > W + 80 || sy < -40 || sy > H + 40) continue;
      if (!force && n.r * tf.k < 2.5) continue;
      cands.push({ id: n.id, n, x: sx, y: sy + n.r * tf.k + 3, w: labelWidth(n.label), h: 14, force });
    }
    const shown = placeLabels(cands);
    for (const c of cands) {
      if (!shown.has(c.id)) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.halo;
      ctx.strokeText(c.n.label, c.x, c.y);
      ctx.fillStyle = colors.label;
      ctx.fillText(c.n.label, c.x, c.y);
    }
  }

  function cursorFor(n) {
    if (n) return 'pointer';
    return drag ? 'grabbing' : 'grab';
  }

  let hoverRaf = 0;
  let hoverAt = null;

  function flushHover() {
    hoverRaf = 0;
    const p = hoverAt;
    hoverAt = null;
    if (p) setHover(nodeAt(p.sx, p.sy), p.ev);
  }

  function queueHover(ev) {
    const [sx, sy] = local(ev);
    hoverAt = { sx, sy, ev: { clientX: ev.clientX, clientY: ev.clientY } };
    if (!hoverRaf) hoverRaf = requestAnimationFrame(flushHover);
  }

  function cancelHover() {
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    hoverRaf = 0;
    hoverAt = null;
  }

  function setHover(n, ev) {
    if (n !== hover) { hover = n; canvas.style.cursor = cursorFor(n); request(); }
    if (onHover) {
      if (n && ev) {
        const r = canvas.getBoundingClientRect();
        onHover({ node: n.data, x: ev.clientX - r.left, y: ev.clientY - r.top });
      } else onHover(null);
    }
  }

  function local(ev) {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, local(ev));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 };
      if (drag?.node) { drag.node.fx = null; drag.node.fy = null; }
      drag = null;
      return;
    }
    const [sx, sy] = local(ev);
    const hit = nodeAt(sx, sy);
    cancelHover();
    drag = { node: hit, sx, sy, moved: false, lastX: sx, lastY: sy };
    if (ev.pointerType !== 'touch') setHover(hit, ev);
    anim = null;
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (drag && pointers.has(ev.pointerId) && ev.pointerType !== 'touch' && ev.buttons === 0) release(ev);
    if (!pointers.has(ev.pointerId)) { if (ev.pointerType !== 'touch') queueHover(ev); return; }
    const [sx, sy] = local(ev);
    pointers.set(ev.pointerId, [sx, sy]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      zoomAt(d / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pinch.d = d;
      return;
    }
    if (!drag) return;
    if (!drag.moved && !isDragMove(sx - drag.sx, sy - drag.sy)) return;
    if (!drag.moved && drag.node && sim && !reducedMotion) sim.setAlphaTarget(0.3);
    drag.moved = true;
    applyDrag(sx, sy);
    drag.lastX = sx; drag.lastY = sy;
    request();
  });

  function applyDrag(sx, sy) {
    if (drag.node) {
      const [wx, wy] = toWorld(sx, sy);
      drag.node.fx = wx; drag.node.fy = wy;
      if (reducedMotion) { drag.node.x = wx; drag.node.y = wy; }
      setHover(drag.node, null);
    } else {
      tf = { ...tf, x: tf.x + sx - drag.lastX, y: tf.y + sy - drag.lastY };
      userMoved = true;
      canvas.style.cursor = 'grabbing';
    }
  }

  function release(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.node) {
      d.node.fx = null; d.node.fy = null;
      if (sim && d.moved) sim.setAlphaTarget(sim.restTarget());
      if (!d.moved) { select(d.node.id, { quiet: false }); }
    } else if (!d.moved) select(null);
    if (ev.pointerType === 'touch') setHover(null);
    canvas.style.cursor = hover ? 'pointer' : 'grab';
    request();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', (ev) => { if (drag && ev.pointerType !== 'touch') release(ev); });
  canvas.addEventListener('pointerleave', () => { cancelHover(); if (!drag) setHover(null); });

  canvas.addEventListener('dblclick', (ev) => {
    const n = nodeAt(...local(ev));
    if (n) focus(n.id);
  });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const [sx, sy] = local(ev);
    zoomAt(Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015)), sx, sy);
  }, { passive: false });

  canvas.addEventListener('keydown', (ev) => {
    const step = 40;
    const keys = {
      '+': () => zoomAt(1.25, W / 2, H / 2), '=': () => zoomAt(1.25, W / 2, H / 2), '-': () => zoomAt(0.8, W / 2, H / 2),
      ArrowLeft: () => { tf = { ...tf, x: tf.x + step }; }, ArrowRight: () => { tf = { ...tf, x: tf.x - step }; },
      ArrowUp: () => { tf = { ...tf, y: tf.y + step }; }, ArrowDown: () => { tf = { ...tf, y: tf.y - step }; },
      0: () => fit(), Escape: () => select(null),
    };
    if (keys[ev.key]) { ev.preventDefault(); userMoved = true; keys[ev.key](); request(); }
  });

  function select(id, { center = false } = {}) {
    const n = id ? byId.get(id) || null : null;
    selected = n;
    selSet = new Set(n ? [n] : []);
    withAnc = true;
    computeAnc();
    if (n && center) focus(n.id);
    if (onSelect) onSelect(n ? n.data : null, n ? [n.id] : []);
    request();
  }

  function computeAnc() {
    anc = new Map();
    if (!withAnc) return;
    for (const f of selSet) {
      for (const [id, d] of ancestorsOf(f.id, rawEdges)) {
        const n = byId.get(id);
        if (n && !selSet.has(n) && (!anc.has(n) || anc.get(n) > d)) anc.set(n, d);
      }
    }
  }

  function selectMany(ids, { fit: doFit = true, ancestors = false } = {}) {
    const list = [...new Set(ids)].map((id) => byId.get(id)).filter(Boolean);
    selected = list.length === 1 ? list[0] : null;
    selSet = new Set(list);
    withAnc = ancestors;
    computeAnc();
    if (list.length && doFit) {
      const group = new Set([...list, ...anc.keys()]);
      for (const n of list) for (const x of nbr.get(n.id) || []) if (byId.has(x)) group.add(byId.get(x));
      userMoved = true;
      fitTo([...group], { maxK: 2.4 });
    }
    if (onSelect) onSelect(selected ? selected.data : null, list.map((n) => n.id));
    request();
  }

  function focus(id) {
    const n = byId.get(id);
    if (!n) return;
    const group = [n, ...[...(nbr.get(id) || [])].map((x) => byId.get(x)), ...(selSet.has(n) ? anc.keys() : [])];
    fitTo(group, { maxK: 2.4 });
  }

  function hoverId(id) {
    const n = id ? byId.get(id) || null : null;
    if (n !== hover) { hover = n; request(); }
  }

  function setMarked(ids) { marked = new Set(ids); request(); }

  function fitIds(ids) {
    const list = ids.map((id) => byId.get(id)).filter(Boolean);
    if (list.length) { userMoved = true; fitTo(list, { maxK: 2.4 }); }
  }

  function fit() { userMoved = false; fitTo(nodes.filter(visible), { animate: false }); }

  function setData(graph) {
    const old = byId;
    nodes = graph.nodes.map((d) => {
      const prev = old.get(d.id);
      return {
        id: d.id, label: d.label, data: d, r: nodeRadius(d.count), fi: familyIndex(d.family),
        x: prev?.x, y: prev?.y, vx: prev?.vx || 0, vy: prev?.vy || 0, fiPrev: prev?.fi ?? familyIndex(d.family), mix: 1,
      };
    });
    order = [...nodes].sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));
    lastGraph = graph;
    byId = new Map(nodes.map((n) => [n.id, n]));
    nbr = new Map(nodes.map((n) => [n.id, new Set()]));
    const raw = graph.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind }));
    rawEdges = raw;
    for (const e of raw) { nbr.get(e.source)?.add(e.target); nbr.get(e.target)?.add(e.source); }
    sim = createSim({ nodes, links: raw, seed: 1, breathing: !reducedMotion });
    links = sim.links;
    for (const l of links) l.related = l.related === true;
    selected = selected ? byId.get(selected.id) || null : null;
    selSet = new Set([...selSet].map((n) => byId.get(n.id)).filter(Boolean));
    computeAnc();
    hover = null;
    if (!old.size) sim.settle(reducedMotion ? 500 : 240); else sim.reheat(0.4);
    if (needFit && nodes.length && canvas.clientWidth > 10 && canvas.clientHeight > 10) {
      fit();
      needFit = false;
      autoFitAt = performance.now() + 700;
    }
    request();
  }

  function update(graph) {
    const diff = diffGraph(lastGraph, graph);
    if (!nodes.length || !diff.sameTopology) { setData(graph); return; }
    for (const d of graph.nodes) {
      const n = byId.get(d.id);
      n.data = d;
      n.r = nodeRadius(d.count);
      const fi = familyIndex(d.family);
      if (fi !== n.fi) { n.fiPrev = n.fi; n.fi = fi; n.mix = reducedMotion ? 1 : 0; }
    }
    order = [...nodes].sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));
    lastGraph = graph;
    request();
  }

  function setInsets(next) {
    insets = { ...insets, ...next };
    if (!userMoved && nodes.length) fitTo(nodes.filter(visible));
  }

  function setHiddenFamilies(names) {
    hiddenIdx = new Set([...names].map(familyIndex));
    if (selSet.size && [...selSet].some((n) => !visible(n))) select(null);
    request();
  }

  function setActive(on) {
    active = on;
    if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
    if (on) request();
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);
  const onVisible = () => { if (!document.hidden) request(); };
  document.addEventListener('visibilitychange', onVisible);
  const scheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const onScheme = () => { colors = readColors(); request(); };
  scheme?.addEventListener?.('change', onScheme);
  resize();
  canvas.style.cursor = 'grab';

  return {
    setData, update, setInsets, setMarked, hoverId, fitIds, setHiddenFamilies, select, selectMany, focus, fit, setActive, resize, refreshColors: onScheme,
    zoom: (f) => zoomAt(f, W / 2, H / 2),
    nodeCount: () => nodes.length,
    destroy() {
      active = false;
      cancelHover();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro?.disconnect();
      barRo?.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      scheme?.removeEventListener?.('change', onScheme);
    },
  };
}
