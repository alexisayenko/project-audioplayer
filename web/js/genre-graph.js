import { createSim } from './genre-sim.js';
import { familyIndex, nodeRadius, FAMILIES } from './genre-data.js';
import { fitTransform, recenterOnResize, placeLabels, diffGraph, mixColor } from './genre-view.js';

const MIN_K = 0.15;
const MAX_K = 6;

export function createGraphView(canvas, { onSelect, onHover, reducedMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  let W = 1;
  let H = 1;
  let dpr = 1;
  let tf = { k: 1, x: 0, y: 0 };
  let nodes = [];
  let links = [];
  let sim = null;
  let byId = new Map();
  let nbr = new Map();
  let hover = null;
  let selected = null;
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
  let hiddenIdx = new Set();
  let order = [];
  let lastGraph = null;
  const widths = new Map();

  function readColors() {
    const cs = getComputedStyle(canvas);
    const v = (name, fb) => cs.getPropertyValue(name).trim() || fb;
    return {
      fam: FAMILIES.map((_, i) => v(`--gf-${i}`, '#888')),
      edge: v('--gm-edge', '#888'),
      hi: v('--gm-hi', '#06c'),
      label: v('--gm-label', '#111'),
      halo: v('--gm-halo', '#fff'),
      ring: v('--gm-ring', '#06c'),
      font: cs.fontFamily || 'sans-serif',
    };
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
    const slack = 3 / tf.k;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!visible(n)) continue;
      const dx = n.x - wx;
      const dy = n.y - wy;
      const rr = n.r + slack;
      if (dx * dx + dy * dy <= rr * rr) return n;
    }
    return null;
  }

  function bbox(list) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const n of list) {
      x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r);
      y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r);
    }
    return { x0, y0, x1, y1 };
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

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(tf.x, tf.y);
    ctx.scale(tf.k, tf.k);
    const k = tf.k;
    const focus = hover || selected;
    const near = focus ? nbr.get(focus.id) : null;
    const isOn = (n) => !focus || n === focus || near.has(n.id);
    for (const l of links) {
      if (!visible(l.s) || !visible(l.t)) continue;
      const on = !focus || l.s === focus || l.t === focus;
      ctx.globalAlpha = on ? (focus ? 0.95 : 0.5) : 0.06;
      ctx.strokeStyle = on && focus ? colors.hi : colors.edge;
      ctx.lineWidth = (on && focus ? 1.8 : 1) / k;
      ctx.setLineDash(l.related ? [4 / k, 4 / k] : []);
      const dx = l.t.x - l.s.x;
      const dy = l.t.y - l.s.y;
      const d = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(l.s.x, l.s.y);
      ctx.lineTo(l.t.x, l.t.y);
      ctx.stroke();
      if (!l.related && k > 0.45 && d > l.t.r + 10 / k) {
        const ux = dx / d;
        const uy = dy / d;
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
    }
    ctx.setLineDash([]);
    for (const n of nodes) {
      if (!visible(n)) continue;
      ctx.globalAlpha = isOn(n) ? 1 : 0.16;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor(n);
      ctx.fill();
      ctx.lineWidth = 1.5 / k;
      ctx.strokeStyle = colors.halo;
      ctx.stroke();
      if (n === selected || n === hover) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3 / k, 0, Math.PI * 2);
        ctx.lineWidth = (n === selected ? 2.5 : 1.5) / k;
        ctx.strokeStyle = colors.ring;
        ctx.stroke();
      }
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

  function setHover(n, ev) {
    if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : drag ? 'grabbing' : 'grab'; request(); }
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
    drag = { node: hit, sx, sy, moved: false, lastX: sx, lastY: sy };
    if (hit) {
      hit.fx = hit.x; hit.fy = hit.y;
      if (sim && !reducedMotion) sim.setAlphaTarget(0.3);
    }
    setHover(hit, ev);
    anim = null;
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId)) { setHover(nodeAt(...local(ev)), ev); return; }
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
    if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 4) return;
    drag.moved = true;
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
    drag.lastX = sx; drag.lastY = sy;
    request();
  });

  function release(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.node) {
      d.node.fx = null; d.node.fy = null;
      if (sim) sim.setAlphaTarget(sim.restTarget());
      if (!d.moved) { select(d.node.id, { quiet: false }); }
    } else if (!d.moved) select(null);
    canvas.style.cursor = hover ? 'pointer' : 'grab';
    request();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (!drag) setHover(null); });

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
    if (n && center) focus(n.id);
    if (onSelect) onSelect(n ? n.data : null);
    request();
  }

  function focus(id) {
    const n = byId.get(id);
    if (!n) return;
    const group = [n, ...[...(nbr.get(id) || [])].map((x) => byId.get(x))];
    fitTo(group, { maxK: 2.4 });
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
    for (const e of raw) { nbr.get(e.source)?.add(e.target); nbr.get(e.target)?.add(e.source); }
    sim = createSim({ nodes, links: raw, seed: 1, breathing: !reducedMotion });
    links = sim.links;
    for (const l of links) l.related = l.related === true;
    selected = selected ? byId.get(selected.id) || null : null;
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
    if (selected && !visible(selected)) select(null);
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
    setData, update, setInsets, setHiddenFamilies, select, focus, fit, setActive, resize, refreshColors: onScheme,
    zoom: (f) => zoomAt(f, W / 2, H / 2),
    nodeCount: () => nodes.length,
    destroy() {
      active = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      scheme?.removeEventListener?.('change', onScheme);
    },
  };
}
