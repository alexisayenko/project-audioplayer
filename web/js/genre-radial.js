import { familyIndex, isHiddenFamily, pieIndices, OTHER_COLOR } from './genre-data.js';
import { ancestorIds, subfamilyOrder } from './genre-levels.js';
export const R2 = 220;
export const STAGGER2 = 30;
export const R3 = 420;
export const STAGGER3 = 26;
const MIN_WEIGHT = 3;
const LEVEL3_GAP = 12;
export const HUES = 15;
export const NEUTRAL_HUE = OTHER_COLOR;

export const radius = (level, n) => {
  if (level === 1) return 26;
  const c = Math.sqrt(n);
  return level === 2 ? Math.min(14, 5 + 1.6 * c) : Math.min(8, 3 + 1.1 * c);
};

const weight = (kids) => Math.max(MIN_WEIGHT, kids.length);

const RING_STEP = 56;

export function layoutRadial(tree, rootGenre = 'Electronic', { related = false, hidden: hideRoot } = {}) {
  const root = tree?.roots.find((r) => r.name === rootGenre);
  if (!root) return null;
  const hidden = hideRoot ?? isHiddenFamily(root.name);
  const shown = (n) => n.all.size > 0;
  const hueOf = new Map();
  let next = 0;
  for (const k of root.children) hueOf.set(k.id, k.children.length ? next++ % HUES : NEUTRAL_HUE);
  const main = root.children.filter(shown);
  const claimed = new Set([root.id, ...main.map((k) => k.id)]);
  const kidsMap = new Map();
  const claim = (n) => {
    const kids = n.children.filter((c) => shown(c) && !claimed.has(c.id));
    for (const c of kids) claimed.add(c.id);
    kidsMap.set(n.id, kids);
    for (const c of kids) claim(c);
  };
  main.forEach(claim);
  const kidsOf = (k) => kidsMap.get(k.id) || [];
  const total = main.reduce((s, k) => s + weight(kidsOf(k)), 0) || 1;
  const unit = (2 * Math.PI) / total;
  const r3 = Math.max(R3, LEVEL3_GAP / unit);
  const rootFam = familyIndex(root.name);
  const rootNode = { id: root.id, name: root.name, label: root.label, level: 1, x: 0, y: 0, r: hidden ? 0 : radius(1), angle: 0, hue: rootFam, hues: [rootFam], node: root, subOrder: 0, ...(hidden ? { hidden: true } : {}) };
  const nodes = hidden ? [] : [rootNode];
  const edges = [];
  const place = (n, level, x, y, r, ang, hue, connector) => {
    nodes.push({ id: n.id, name: n.name, label: n.label, level, connector, x, y, r, angle: ang, hue: connector ? NEUTRAL_HUE : hue, hues: hueSet(connector ? NEUTRAL_HUE : hue, n), node: n });
  };
  const deeper = (c, ang, slot, level, hue) => {
    const kids = kidsOf(c);
    kids.forEach((d, j) => {
      const a = ang - slot / 2 + (slot / kids.length) * (j + 0.5);
      const rr = r3 + RING_STEP * (level - 3) + (j % 2) * STAGGER3;
      place(d, level, Math.cos(a) * rr, Math.sin(a) * rr, radius(level, d.all.size), a, hue, d.own.size === 0);
      edges.push({ from: c.id, to: d.id });
      deeper(d, a, slot / kids.length, level + 1, hue);
    });
  };
  let a = -Math.PI / 2;
  main.forEach((k, i) => {
    const kids = kidsOf(k);
    const span = unit * weight(kids);
    const mid = a + span / 2;
    const rr = R2 + (i % 2) * STAGGER2;
    const h = hueOf.get(k.id);
    place(k, 2, Math.cos(mid) * rr, Math.sin(mid) * rr, radius(2, k.all.size), mid, h, k.own.size === 0);
    if (!hidden) edges.push({ from: root.id, to: k.id });
    kids.forEach((c, j) => {
      const ang = a + (span / kids.length) * (j + 0.5);
      const cr = r3 + (j % 2) * STAGGER3;
      place(c, 3, Math.cos(ang) * cr, Math.sin(ang) * cr, radius(3, c.all.size), ang, h, c.own.size === 0);
      edges.push({ from: k.id, to: c.id });
      deeper(c, ang, span / kids.length, 4, h);
    });
    a += span;
  });
  const pos = new Map(nodes.map((n) => [n.id, n]));
  pos.set(root.id, rootNode);
  const drawn = new Set(edges.map((e) => `${e.from}|${e.to}`));
  for (const n of nodes) {
    for (const p of n.node.parents) {
      const key = `${p}|${n.id}`;
      if (drawn.has(key) || !pos.has(p) || (hidden && p === root.id)) continue;
      drawn.add(key);
      edges.push({ from: p, to: n.id, cross: true });
    }
  }
  if (related) {
    const seen = new Set();
    for (const n of nodes) {
      for (const r of n.node.related) {
        const t = pos.get(`g:${r}`) || pos.get(`s:${r}`);
        const key = t && [n.id, t.id].sort().join('|');
        if (!t || t.id === n.id || seen.has(key) || (hidden && t.id === root.id)) continue;
        seen.add(key);
        edges.push({ from: n.id, to: t.id, dotted: true });
      }
    }
  }
  for (const n of nodes) n.subOrder = n.level > 1 && n.node.subfamily ? subfamilyOrder(tree, n.node.subfamily) : 0;
  const subIdx = tree.subfamilies?.length ? familyIndex(tree.subfamilies[0].family) : -1;
  const ext = Math.max(...nodes.map((n) => Math.hypot(n.x, n.y) + n.r), 0) + 40;
  return { root: root.id, hiddenRoot: hidden, subIdx, nodes, edges, byId: pos, bounds: { x0: -ext, y0: -ext, x1: ext, y1: ext } };
}

export function highlightSets(tree, id) {
  const chainIds = new Set();
  const kidIds = new Set();
  const n = tree?.byId.get(id);
  if (!n) return { chain: chainIds, kids: kidIds };
  for (const k of n.children) kidIds.add(k.id);
  for (const a of ancestorIds(tree, id)) chainIds.add(a);
  return { chain: chainIds, kids: kidIds };
}


const hits = (a, b, pad) => a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;

export const labelBox = (it) => ({ x: it.x - it.w / 2, y: it.y, w: it.w, h: it.h });

export function selectLabels(items, markers = [], { pad = 2.5 } = {}) {
  const rank = new Map(items.map((it, i) => [it.id, i]));
  const drawn = [];
  const shown = new Set();
  items.forEach((it, i) => {
    const box = labelBox(it);
    if (!it.force) {
      if (drawn.some((d) => hits(box, d, pad))) return;
      const blocked = markers.some((m) => m.id !== it.id && (rank.get(m.id) ?? Infinity) < i && hits(box, { x: m.x - m.r, y: m.y - m.r, w: 2 * m.r, h: 2 * m.r }, pad));
      if (blocked) return;
    }
    drawn.push(box);
    shown.add(it.id);
  });
  return shown;
}

export function hueSet(hue, node) {
  const fams = pieIndices(node.fams);
  return fams.length > 1 ? fams : [hue];
}
