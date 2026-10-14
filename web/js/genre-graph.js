import { createSim } from './genre-sim.js';
import { familyIndex, nodeRadius, FAMILIES } from './genre-data.js';

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
  let fitted = false;

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
    W = Math.max(1, canvas.clientWidth);
    H = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
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
    draw();
    if (again) request();
  }

  function toWorld(sx, sy) { return [(sx - tf.x) / tf.k, (sy - tf.y) / tf.k]; }

  function nodeAt(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    const slack = 3 / tf.k;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
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

  function fitTo(list, { pad = 48, maxK = 2.2, animate = true } = {}) {
    if (!list.length) return;
    const b = bbox(list);
    const bw = Math.max(b.x1 - b.x0, 40);
    const bh = Math.max(b.y1 - b.y0, 40);
    const k = Math.min(maxK, Math.max(MIN_K, Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh)));
    const to = { k, x: W / 2 - ((b.x0 + b.x1) / 2) * k, y: H / 2 - ((b.y0 + b.y1) / 2) * k };
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
      ctx.globalAlpha = isOn(n) ? 1 : 0.16;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = colors.fam[n.fi];
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
    ctx.font = `${12 / k}px ${colors.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    for (const n of nodes) {
      const show = focus ? isOn(n) : n.r >= 10 || k >= 1.5;
      if (!show && n !== selected) continue;
      const y = n.y + n.r + 3 / k;
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = colors.halo;
      ctx.strokeText(n.label, n.x, y);
      ctx.fillStyle = colors.label;
      ctx.fillText(n.label, n.x, y);
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
    if (keys[ev.key]) { ev.preventDefault(); keys[ev.key](); request(); }
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

  function fit() { fitTo(nodes, { animate: false }); }

  function setData(graph) {
    const old = byId;
    nodes = graph.nodes.map((d) => {
      const prev = old.get(d.id);
      return {
        id: d.id, label: d.label, data: d, r: nodeRadius(d.count), fi: familyIndex(d.family),
        x: prev?.x, y: prev?.y, vx: prev?.vx || 0, vy: prev?.vy || 0,
      };
    });
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
    if (!fitted && nodes.length) { fit(); fitted = true; }
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
    setData, select, focus, fit, setActive, resize, refreshColors: onScheme,
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
