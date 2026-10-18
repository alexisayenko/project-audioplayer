import { familyIndex, OTHER_COLOR } from './genre-data.js';
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

const PARK_GAP = 18;
const PARK_PAD = 70;
const PARK_R = 5;

const weight = (kids) => Math.max(MIN_WEIGHT, kids.length);

export function layoutRadial(tree, rootGenre = 'Electronic', { showAll = false } = {}) {
  const root = tree?.roots.find((r) => r.name === rootGenre);
  if (!root) return null;
  const shown = (n) => showAll || n.all.size > 0;
  const hueOf = new Map();
  let next = 0;
  for (const k of root.children) hueOf.set(k.id, k.children.length ? next++ % HUES : NEUTRAL_HUE);
  const lvl2 = root.children.filter(shown);
  const parked = showAll ? lvl2.filter((k) => !k.children.length && !k.all.size) : [];
  const main = lvl2.filter((k) => !parked.includes(k));
  const kidsOf = (k) => k.children.filter(shown);
  const total = main.reduce((s, k) => s + weight(kidsOf(k)), 0) || 1;
  let theta = parked.length ? 0.5 : 0;
  let unit = (2 * Math.PI) / total;
  let r3 = R3;
  let rOut = 0;
  for (let i = 0; i < 6; i += 1) {
    unit = (2 * Math.PI - theta) / total;
    r3 = Math.max(R3, LEVEL3_GAP / unit);
    rOut = r3 + STAGGER3 + PARK_PAD;
    if (parked.length) theta = Math.min(Math.PI, (parked.length * PARK_GAP) / rOut);
  }
  const nodes = [{ id: root.id, name: root.name, label: root.label, level: 1, x: 0, y: 0, r: radius(1), angle: 0, hue: familyIndex(root.name), node: root }];
  const edges = [];
  let a = -Math.PI / 2;
  main.forEach((k, i) => {
    const kids = kidsOf(k);
    const span = unit * weight(kids);
    const mid = a + span / 2;
    const rr = R2 + (i % 2) * STAGGER2;
    const h = hueOf.get(k.id);
    nodes.push({ id: k.id, name: k.name, label: k.label, level: 2, x: Math.cos(mid) * rr, y: Math.sin(mid) * rr, r: radius(2, k.all.size), angle: mid, hue: h, node: k });
    edges.push({ from: root.id, to: k.id });
    kids.forEach((c, j) => {
      const ang = a + (span / kids.length) * (j + 0.5);
      const cr = r3 + (j % 2) * STAGGER3;
      nodes.push({ id: c.id, name: c.name, label: c.label, level: 3, x: Math.cos(ang) * cr, y: Math.sin(ang) * cr, r: radius(3, c.all.size), angle: ang, hue: h, node: c });
      edges.push({ from: k.id, to: c.id });
    });
    a += span;
  });
  parked.forEach((k, i) => {
    const ang = a + (theta / parked.length) * (i + 0.5);
    nodes.push({ id: k.id, name: k.name, label: k.label, level: 2, parked: true, x: Math.cos(ang) * rOut, y: Math.sin(ang) * rOut, r: PARK_R, angle: ang, hue: NEUTRAL_HUE, node: k });
  });
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const byName = new Map(nodes.filter((n) => n.level === 2).map((n) => [n.name, n]));
  const links = [];
  for (const n of nodes) {
    for (const name of n.node.alsoUnder) {
      const t = byName.get(name);
      if (t) links.push({ from: n.id, to: t.id });
    }
  }
  const ext = Math.max(...nodes.map((n) => Math.hypot(n.x, n.y) + n.r)) + 40;
  return { root: root.id, showAll, nodes, edges, links, byId: pos, bounds: { x0: -ext, y0: -ext, x1: ext, y1: ext } };
}

export function highlightSets(tree, id) {
  const chainIds = new Set();
  const kidIds = new Set();
  let n = tree?.byId.get(id);
  if (!n) return { chain: chainIds, kids: kidIds };
  for (const k of n.children) kidIds.add(k.id);
  for (; n; n = n.parent ? tree.byId.get(n.parent) : null) chainIds.add(n.id);
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
