import { el } from '../web/js/dom.js';
import { termById } from '../web/js/glossary-terms.js';
import {
  DOMAINS, buildGraph, neighbourMap, relationsOf, layoutDomains, boxBounds, fitView, initialView, zoomAbout, edgeEnds, neighbourInDirection, shapeFor,
} from '../web/js/glossary-map.js';

const NS = 'http://www.w3.org/2000/svg';
const DRAG_PX = 4;
const MAX_K = 3;
const ARROWS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

function svgEl(tag, attrs = {}, ...kids) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) node.setAttribute(k, v === true ? '' : String(v));
  for (const c of kids) if (c != null) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

const domainOf = (id) => DOMAINS.find((d) => d.id === id);
const dotFor = (domain) => {
  const dot = el('span', { class: 'gm-dot', 'aria-hidden': 'true' });
  dot.style.setProperty('--dc', `var(${domainOf(domain).token})`);
  return dot;
};

export function createGlossaryMap({ terms, onSelect } = {}) {
  const { nodes, edges } = buildGraph(terms);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = neighbourMap(edges);
  const nodeEls = new Map();
  const edgeEls = [];
  let shape = 'wide';
  let boxes = [];
  let tf = { k: 1, x: 0, y: 0 };
  let W = 0;
  let H = 0;
  let userMoved = false;
  let fitted = false;
  let selected = null;
  let hover = null;
  let focused = null;
  let matches = null;
  let minK = 0.1;
  let drag = null;
  let pinch = null;
  const pointers = new Map();

  const world = svgEl('g', { class: 'gm-world' });
  const edgeLayer = svgEl('g', { class: 'gm-edges', 'aria-hidden': 'true' });
  const nodeLayer = svgEl('g', { class: 'gm-nodes' });
  const labelLayer = svgEl('g', { class: 'gm-labels', 'aria-hidden': 'true' });
  const arrow = (id, cls) => svgEl('marker', { id, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 8, markerHeight: 8, orient: 'auto', markerUnits: 'userSpaceOnUse' },
    svgEl('path', { d: 'M0,0 L8,4 L0,8 z', class: cls }));
  const svg = svgEl('svg', {
    class: 'gm-svg', role: 'group', 'aria-label': `Glossary map: ${nodes.length} terms in ${DOMAINS.length} domains. Select a term to see how it relates to the others.`,
  }, svgEl('defs', {}, arrow('gm-arr', 'gm-arr'), arrow('gm-arr-on', 'gm-arr-on')), world);
  const hullLayer = svgEl('g', { class: 'gm-hulls', 'aria-hidden': 'true' });
  world.append(hullLayer, edgeLayer, nodeLayer, labelLayer);
  const hulls = new Map();
  for (const d of DOMAINS) {
    const g = svgEl('g', { class: 'gm-hull' }, svgEl('rect', { rx: 18 }), svgEl('text', {}, d.label));
    g.style.setProperty('--dc', `var(${d.token})`);
    hulls.set(d.id, g);
    hullLayer.append(g);
  }

  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    const line = svgEl('line', { class: 'gm-edge', 'marker-end': 'url(#gm-arr)' }, svgEl('title', {}, `${a.term} ${e.label} ${b.term}`));
    edgeEls.push(line);
    edgeLayer.append(line);
  }

  const order = (n) => DOMAINS.findIndex((d) => d.id === n.domain);
  const tabOrder = [...nodes].sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
  for (const n of tabOrder) {
    const g = svgEl('g', { class: 'gm-n', 'data-id': n.id, tabindex: '0', role: 'button', 'aria-pressed': 'false', 'aria-label': `${n.term}, ${domainOf(n.domain).label}${n.aliases.length ? `. Also called: ${n.aliases.join(', ')}` : ''}` },
      svgEl('rect', { x: -n.w / 2, y: -n.h / 2, width: n.w, height: n.h, rx: n.h / 2 }),
      svgEl('text', { 'text-anchor': 'middle', y: 4.2 }, n.label),
      n.aliases.length ? svgEl('title', {}, `${n.term}. Also called: ${n.aliases.join(', ')}`) : null);
    g.style.setProperty('--dc', `var(${domainOf(n.domain).token})`);
    nodeEls.set(n.id, g);
    nodeLayer.append(g);
  }

  const setTf = (next) => {
    tf = next;
    world.setAttribute('transform', `translate(${tf.x.toFixed(2)} ${tf.y.toFixed(2)}) scale(${tf.k.toFixed(4)})`);
  };

  function paintGeometry() {
    for (const n of nodes) {
      const g = nodeEls.get(n.id);
      g.setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
      g.firstChild.setAttribute('x', (-n.w / 2).toFixed(1));
      g.firstChild.setAttribute('width', n.w.toFixed(1));
    }
    for (const b of boxes) {
      const g = hulls.get(b.id);
      const rect = g.firstChild;
      rect.setAttribute('x', b.x0.toFixed(1));
      rect.setAttribute('y', b.y0.toFixed(1));
      rect.setAttribute('width', b.w.toFixed(1));
      rect.setAttribute('height', b.h.toFixed(1));
      g.lastChild.setAttribute('x', (b.x0 + 14).toFixed(1));
      g.lastChild.setAttribute('y', (b.y0 + 19).toFixed(1));
    }
    edges.forEach((e, i) => {
      const p = edgeEnds(byId.get(e.from), byId.get(e.to));
      const line = edgeEls[i];
      line.setAttribute('x1', p.x1.toFixed(1));
      line.setAttribute('y1', p.y1.toFixed(1));
      line.setAttribute('x2', p.x2.toFixed(1));
      line.setAttribute('y2', p.y2.toFixed(1));
    });
  }

  const focusId = () => hover ?? focused ?? selected;

  function paintState() {
    const f = focusId();
    const near = f ? new Set([f, ...(adj.get(f) ?? [])]) : null;
    for (const n of nodes) {
      const g = nodeEls.get(n.id);
      const dim = (near && !near.has(n.id)) || (matches && !matches.has(n.id));
      g.classList.toggle('sel', n.id === selected);
      g.classList.toggle('near', !!near && n.id !== f && near.has(n.id));
      g.classList.toggle('dim', !!dim);
      g.setAttribute('aria-pressed', String(n.id === selected));
    }
    const labels = [];
    edges.forEach((e, i) => {
      const line = edgeEls[i];
      const on = !!f && (e.from === f || e.to === f);
      const dim = (f && !on) || (matches && !(matches.has(e.from) && matches.has(e.to)));
      line.classList.toggle('on', on);
      line.classList.toggle('dim', !!dim);
      line.setAttribute('marker-end', on ? 'url(#gm-arr-on)' : 'url(#gm-arr)');
      if (on) {
        const x = (+line.getAttribute('x1') + +line.getAttribute('x2')) / 2;
        const y = (+line.getAttribute('y1') + +line.getAttribute('y2')) / 2;
        labels.push(svgEl('text', { class: 'gm-el', x, y, 'text-anchor': 'middle' }, e.label));
      }
    });
    labelLayer.replaceChildren(...labels);
  }

  const panel = el('aside', { class: 'gm-panel', 'aria-label': 'Selected term', 'aria-live': 'polite' });

  function relRow(id, r) {
    const me = byId.get(id).term;
    const go = (other) => el('button', { type: 'button', class: 'link-btn gm-go', onclick: () => select(other, { reveal: true }) }, byId.get(other).term);
    const label = el('span', { class: 'gm-lab' }, r.edge.label);
    return el('li', {}, ...(r.out ? [me, ' ', label, ' ', go(r.other)] : [go(r.other), ' ', label, ' ', me]));
  }

  function renderPanel() {
    const n = selected && byId.get(selected);
    if (!n) {
      panel.replaceChildren(el('p', { class: 'hm-cap muted t-caption' }, 'Select a term to see its definition and how it connects to the others.'));
      return;
    }
    const t = termById(n.id);
    const rels = relationsOf(n.id, edges);
    const demo = t.demo ? [el('a', { href: `#/${t.demo.page}` }, `${t.demo.label} page →`)] : [];
    panel.replaceChildren(
      el('div', { class: 'gm-ph' }, dotFor(n.domain), el('h3', { class: 't-subhead' }, t.term)),
      el('p', { class: 'hm-cap muted t-caption' }, domainOf(n.domain).label),
      ...(n.aliases.length ? [el('p', { class: 'hm-cap muted t-caption gl-also' }, `Also called: ${n.aliases.join(', ')}`)] : []),
      el('p', { class: 'gl-text t-subhead muted' }, t.text),
      el('p', { class: 'gl-more t-caption' }, el('a', { href: `#/glossary/${n.id}` }, 'Open in list'), ...demo),
      rels.length ? el('p', { class: 'gl-label t-caption' }, 'Relations') : null,
      rels.length ? el('ul', { class: 'gm-rels t-caption' }, ...rels.map((r) => relRow(n.id, r))) : null);
  }

  function reveal(id) {
    const n = byId.get(id);
    if (!n || !W) return;
    const m = 24;
    const sx = n.x * tf.k + tf.x;
    const sy = n.y * tf.k + tf.y;
    const hw = (n.w / 2) * tf.k;
    const hh = (n.h / 2) * tf.k;
    let dx = 0;
    let dy = 0;
    if (sx - hw < m) dx = m - (sx - hw);
    else if (sx + hw > W - m) dx = W - m - (sx + hw);
    if (sy - hh < m) dy = m - (sy - hh);
    else if (sy + hh > H - m) dy = H - m - (sy + hh);
    if (dx || dy) {
      userMoved = true;
      setTf({ ...tf, x: tf.x + dx, y: tf.y + dy });
    }
  }

  function select(id, { silent = false, reveal: doReveal = false } = {}) {
    const next = id && byId.has(id) ? id : null;
    selected = next;
    paintState();
    renderPanel();
    if (next && doReveal) reveal(next);
    if (!silent) onSelect?.(next);
  }

  const setHover = (id) => {
    if (id === hover) return;
    hover = id;
    paintState();
  };

  function fit({ all = true } = {}) {
    if (!W || !H) return;
    const b = boxBounds(boxes);
    minK = Math.min(fitView(b, W, H).k * 0.5, 0.5);
    userMoved = false;
    fitted = true;
    setTf(all ? fitView(b, W, H) : initialView(b, W, H));
  }

  function relayout() {
    boxes = layoutDomains(nodes, edges, shape).boxes;
    paintGeometry();
    paintState();
  }

  function measure() {
    const r = svg.getBoundingClientRect();
    const ow = W;
    const oh = H;
    W = r.width;
    H = r.height;
    return { ok: W > 10 && H > 10, ow, oh };
  }

  function resize() {
    const { ok, ow, oh } = measure();
    if (!ok) return;
    const next = shapeFor(W, H);
    if (next !== shape || !fitted) {
      shape = next;
      relayout();
      fit({ all: false });
    } else if (!userMoved) fit({ all: false });
    else if (ow > 10 && oh > 10) setTf({ ...tf, x: tf.x + (W - ow) / 2, y: tf.y + (H - oh) / 2 });
  }

  const local = (ev) => {
    const r = svg.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const nodeIdOf = (target) => target?.closest?.('.gm-n')?.getAttribute('data-id') ?? null;
  const zoomBy = (px, py, f) => {
    userMoved = true;
    setTf(zoomAbout(tf, px, py, f, minK, MAX_K));
  };

  svg.addEventListener('pointerdown', (ev) => {
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    svg.setPointerCapture?.(ev.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      drag = null;
      return;
    }
    drag = { id: nodeIdOf(ev.target), sx: ev.clientX, sy: ev.clientY, lx: p.x, ly: p.y, moved: false };
  });

  svg.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId)) {
      if (ev.pointerType !== 'touch') setHover(nodeIdOf(ev.target));
      return;
    }
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomBy((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
      pinch.d = d;
    } else if (drag) {
      if (!drag.moved) {
        if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < DRAG_PX) return;
        drag.moved = true;
        svg.classList.add('dragging');
        setHover(null);
      }
      userMoved = true;
      setTf({ ...tf, x: tf.x + p.x - drag.lx, y: tf.y + p.y - drag.ly });
      drag.lx = p.x;
      drag.ly = p.y;
    }
  });

  const release = (ev, commit) => {
    svg.releasePointerCapture?.(ev.pointerId);
    pointers.delete(ev.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      drag = null;
      return;
    }
    const d = drag;
    drag = null;
    svg.classList.remove('dragging');
    if (commit && d && !d.moved) select(d.id);
  };
  svg.addEventListener('pointerup', (ev) => release(ev, true));
  svg.addEventListener('pointercancel', (ev) => release(ev, false));
  svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch') setHover(null); });
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const p = local(ev);
    zoomBy(p.x, p.y, Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015)));
  }, { passive: false });

  svg.addEventListener('focusin', (ev) => {
    focused = nodeIdOf(ev.target);
    paintState();
  });
  svg.addEventListener('focusout', () => {
    focused = null;
    paintState();
  });
  svg.addEventListener('keydown', (ev) => {
    const id = nodeIdOf(ev.target);
    if (!id) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      select(id);
    } else if (ev.key === 'Escape') {
      select(null);
    } else if (ARROWS[ev.key]) {
      ev.preventDefault();
      const [dx, dy] = ARROWS[ev.key];
      const next = neighbourInDirection(byId.get(id), [...(adj.get(id) ?? [])].map((o) => byId.get(o)), dx, dy);
      if (next) {
        reveal(next.id);
        nodeEls.get(next.id).focus({ preventScroll: true });
      }
    }
  });

  const center = (f) => zoomBy(W / 2, H / 2, f);
  const tools = el('div', { class: 'gm-tools' },
    el('button', { type: 'button', class: 'btn outline small', 'aria-label': 'Zoom in', onclick: () => center(1.4) }, '+'),
    el('button', { type: 'button', class: 'btn outline small', 'aria-label': 'Zoom out', onclick: () => center(1 / 1.4) }, '−'),
    el('button', { type: 'button', class: 'btn outline small', onclick: () => fit({ all: true }) }, 'Fit'));
  const stage = el('div', { class: 'gm-stage' }, svg, tools);
  const legend = el('ul', { class: 'gm-legend t-caption', 'aria-label': 'Domains' },
    ...DOMAINS.map((d) => el('li', {}, dotFor(d.id), `${d.label} (${nodes.filter((n) => n.domain === d.id).length})`)));
  const hint = el('p', { class: 'hm-cap muted t-caption' }, 'Select a term to highlight its neighbours and label the links. Drag to pan; scroll, pinch or use + and − to zoom; Fit shows everything. Arrow keys move between neighbours.');
  const node = el('div', { class: 'gm' }, legend, el('div', { class: 'gm-body' }, stage, panel), hint);

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => resize());
    ro.observe(svg);
  }
  relayout();
  renderPanel();

  return {
    node,
    show: () => resize(),
    select,
    setMatches(set) {
      matches = set;
      paintState();
    },
    size: () => ({ nodes: nodes.length, edges: edges.length }),
    destroy() {
      ro?.disconnect();
    },
  };
}
