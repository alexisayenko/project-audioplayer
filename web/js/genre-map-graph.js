import { familyIndex, pieIndices, isHiddenFamily, FAMILY_ORDER } from './genre-data.js';
import { mulberry32 } from './genre-sim.js';
import { ancestorIds, filterIds, pairKey, subfamilyOrder } from './genre-levels.js';

export const FAMILY_MIN_R = 14;
export const GENRE_MIN_R = 3.8;
export const MAX_R = 20;

export const mapRadius = (level, all) => {
  const c = Math.sqrt(Math.max(0, all));
  return level === 1 ? Math.min(28, FAMILY_MIN_R + 1.6 * c) : Math.min(MAX_R, GENRE_MIN_R + 2.3 * c);
};

export function emphasis(own, all) {
  if (own > 0) return 2;
  return all > 0 ? 1 : 0;
}

export function buildMapGraph(tree) {
  if (!tree) return { nodes: [], links: [], byId: new Map() };
  const nodes = [];
  for (const n of tree.byId.values()) {
    if (n.level === 1 && isHiddenFamily(n.name)) continue;
    nodes.push({
      id: n.id, name: n.name, label: n.label || n.name, level: n.level, family: n.family, fi: familyIndex(n.family), sub: n.subfamily, subOrder: n.subfamily ? subfamilyOrder(tree, n.subfamily) : 0, fis: n.fams.length ? pieIndices(n.fams) : [familyIndex(n.family)],
      own: n.own.size, all: n.all.size, em: emphasis(n.own.size, n.all.size), r: mapRadius(n.level, n.all.size), node: n,
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = [];
  const seen = new Set();
  const add = (source, target, kind) => {
    if (!byId.has(source) || !byId.has(target) || source === target) return;
    const key = `${source}|${target}`;
    if (seen.has(key) || seen.has(`${target}|${source}`)) return;
    seen.add(key);
    links.push({ source, target, kind });
  };
  for (const n of tree.byId.values()) {
    for (const p of n.parents) add(p, n.id, 'parent');
  }
  const assoc = new Set();
  for (const n of tree.byId.values()) {
    for (const r of n.related) {
      const t = tree.byId.get(`g:${r}`) || tree.byId.get(`s:${r}`);
      const key = t && pairKey(n.id, t.id);
      if (!t || t.id === n.id || assoc.has(key) || !byId.has(n.id) || !byId.has(t.id)) continue;
      assoc.add(key);
      links.push({ source: n.id, target: t.id, kind: 'assoc' });
    }
  }
  const subIdx = tree.subfamilies?.length ? familyIndex(tree.subfamilies[0].family) : -1;
  return { nodes, links, byId, subIdx };
}

export function seedPositions(graph, seed = 1, { ring = 240 } = {}) {
  const rng = mulberry32(seed);
  const fams = graph.nodes.filter((n) => n.level === 1);
  const orderOf = (n) => { const i = FAMILY_ORDER.indexOf(n.name); return i < 0 ? FAMILY_ORDER.length : i; };
  fams.sort((a, b) => orderOf(a) - orderOf(b) || a.name.localeCompare(b.name));
  const out = new Map();
  fams.forEach((f, i) => {
    const a = (i / Math.max(1, fams.length)) * 2 * Math.PI - Math.PI / 2;
    f.x = Math.cos(a) * ring; f.y = Math.sin(a) * ring;
    out.set(f.id, a);
  });
  const parentOf = new Map();
  const kids = new Map();
  for (const l of graph.links) {
    if (l.kind !== 'parent' || parentOf.has(l.target)) continue;
    parentOf.set(l.target, l.source);
    if (!kids.has(l.source)) kids.set(l.source, []);
    kids.get(l.source).push(l.target);
  }
  const place = (id, depth) => {
    const list = kids.get(id) || [];
    const p = graph.byId.get(id);
    const base = out.get(id) ?? 0;
    list.forEach((cid, j) => {
      const c = graph.byId.get(cid);
      const arc = depth === 0 ? 1.7 : 1.3;
      const spread = list.length > 1 ? ((j + 0.5) / list.length - 0.5) * Math.PI * arc : 0;
      const ang = base + spread + (rng() - 0.5) * 0.1;
      const dist = (depth === 0 ? 50 : 34) + 5 * Math.sqrt(j + 1) + rng() * 6;
      c.x = p.x + Math.cos(ang) * dist; c.y = p.y + Math.sin(ang) * dist;
      out.set(cid, ang);
      place(cid, depth + 1);
    });
  };
  for (const f of fams) place(f.id, 0);
  let k = 0;
  for (const n of graph.nodes) {
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) continue;
    const a = k++ * 2.399963 + rng();
    n.x = Math.cos(a) * ring * 1.4; n.y = Math.sin(a) * ring * 1.4;
  }
  return graph;
}

export function visibleIds(tree, { family = null, libraryOnly = false, status = 'all', modifiers = [], subfamilies = null } = {}) {
  if (!tree) return null;
  const byFilter = filterIds(tree, { status, modifiers });
  const subs = subfamilies?.size ? subfamilies : null;
  if (!family && !libraryOnly && !byFilter && !subs) return null;
  const root = family ? `g:${family}` : null;
  const out = new Set();
  for (const n of tree.byId.values()) {
    if (libraryOnly && !n.all.size) continue;
    if (byFilter && !byFilter.has(n.id)) continue;
    if (root && !ancestorIds(tree, n.id).has(root)) continue;
    if (subs && n.level > 1 && tree.subfamilies.some((s) => n.fams.includes(s.family)) && !subs.has(n.subfamily)) continue;
    out.add(n.id);
  }
  return out;
}

export function libraryCount(tree) {
  let n = 0;
  for (const g of tree?.byId.values() || []) if (g.level > 1 && g.own.size > 0) n++;
  return n;
}

export const genreCount = (tree) => {
  let n = 0;
  for (const g of tree?.byId.values() || []) if (g.level > 1) n++;
  return n;
};
