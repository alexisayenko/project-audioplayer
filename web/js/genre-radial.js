import { familyIndex, OTHER_COLOR } from './genre-data.js';
import { uniqueIndices } from './genre-disc.js';
import { MAX_FAMILIES, subfamilyOrder } from './genre-levels.js';
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

export function layoutRadial(tree, rootGenre = 'Electronic', { related = false } = {}) {
  const root = tree?.roots.find((r) => r.name === rootGenre);
  if (!root) return null;
  const shown = (n) => n.all.size > 0;
  const hueOf = new Map();
  let next = 0;
  for (const k of root.children) hueOf.set(k.id, k.children.length ? next++ % HUES : NEUTRAL_HUE);
  const main = root.children.filter(shown);
  const kidsOf = (k) => k.children.filter(shown);
  const total = main.reduce((s, k) => s + weight(kidsOf(k)), 0) || 1;
  const unit = (2 * Math.PI) / total;
  const r3 = Math.max(R3, LEVEL3_GAP / unit);
  const nodes = [{ id: root.id, name: root.name, label: root.label, level: 1, x: 0, y: 0, r: radius(1), angle: 0, hue: familyIndex(root.name), hues: [familyIndex(root.name)], node: root }];
  const edges = [];
  let a = -Math.PI / 2;
  main.forEach((k, i) => {
    const kids = kidsOf(k);
    const span = unit * weight(kids);
    const mid = a + span / 2;
    const rr = R2 + (i % 2) * STAGGER2;
    const h = hueOf.get(k.id);
    const link = k.own.size === 0;
    nodes.push({ id: k.id, name: k.name, label: k.label, level: 2, connector: link, x: Math.cos(mid) * rr, y: Math.sin(mid) * rr, r: radius(2, k.all.size), angle: mid, hue: link ? NEUTRAL_HUE : h, hues: hueSet(link ? NEUTRAL_HUE : h, k), node: k });
    edges.push({ from: root.id, to: k.id });
    kids.forEach((c, j) => {
      const ang = a + (span / kids.length) * (j + 0.5);
      const cr = r3 + (j % 2) * STAGGER3;
      const leaf = c.own.size === 0;
      nodes.push({ id: c.id, name: c.name, label: c.label, level: 3, connector: leaf, x: Math.cos(ang) * cr, y: Math.sin(ang) * cr, r: radius(3, c.all.size), angle: ang, hue: leaf ? NEUTRAL_HUE : h, hues: hueSet(leaf ? NEUTRAL_HUE : h, c), node: c });
      edges.push({ from: k.id, to: c.id });
    });
    a += span;
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
  if (related) {
    const seen = new Set();
    for (const n of nodes) {
      for (const r of n.node.related) {
        const t = pos.get(`g:${r}`) || pos.get(`s:${r}`);
        const key = t && [n.id, t.id].sort().join('|');
        if (!t || t.id === n.id || seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: n.id, to: t.id, dotted: true });
      }
    }
  }
  for (const n of nodes) n.subOrder = n.level > 1 && n.node.subfamily ? subfamilyOrder(tree, n.node.subfamily) : 0;
  const subIdx = tree.subfamilies?.length ? familyIndex(tree.subfamilies[0].family) : -1;
  const ext = Math.max(...nodes.map((n) => Math.hypot(n.x, n.y) + n.r)) + 40;
  return { root: root.id, subIdx, nodes, edges, links, byId: pos, bounds: { x0: -ext, y0: -ext, x1: ext, y1: ext } };
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

export function hueSet(hue, node) {
  const fams = uniqueIndices(node.fams || [], familyIndex);
  return fams.length > 1 ? fams.slice(0, MAX_FAMILIES) : [hue];
}
