import { buildTree, applyCounts, ancestorIds, genreLines, visibleRows, allExpandable } from './genre-levels.js';
import { layoutRadial } from './genre-radial.js';

const sortSet = (s) => [...s].sort();

export function treeFacts(vocab) {
  const t0 = buildTree(vocab);
  const ids = [...t0.byId.keys()];
  const nodeName = (id) => t0.byId.get(id).name;
  const full = ids.map((id, i) => ({ id: `s${i}`, tags: [`genre:${nodeName(id)}`] }));
  const sparse = ids.filter((_, i) => i % 5 === 0).map((id, i) => ({ id: `p${i}`, tags: [`genre:${nodeName(id)}`] }));
  const out = { nodes: {}, trees: {}, familyCounts: {} };
  for (const n of t0.byId.values()) {
    out.nodes[n.id] = {
      level: n.level, family: n.family, parent: n.parent, children: n.children.map((c) => c.id), alsoIn: n.alsoIn, alsoUnder: n.alsoUnder,
      ancestors: sortSet(ancestorIds(t0, n.id)), lines: genreLines(t0, [n.name]),
    };
  }
  for (const [label, songs] of [['full', full], ['sparse', sparse]]) {
    const t = buildTree(vocab);
    applyCounts(t, songs);
    const counts = {};
    for (const n of t.byId.values()) counts[n.id] = [n.own.size, n.all.size];
    const exp = allExpandable(t);
    const layouts = {};
    for (const r of t.roots) {
      const l = layoutRadial(t, r.name);
      layouts[r.name] = l && {
        nodes: l.nodes.map((n) => [n.id, n.level, n.connector ?? null, n.hue, Math.round(n.x * 1000), Math.round(n.y * 1000), Math.round(n.r * 1000)]),
        edges: l.edges.map((e) => [e.from, e.to]), links: l.links.map((e) => [e.from, e.to]),
      };
    }
    out.trees[label] = {
      counts,
      rows: visibleRows(t, { expanded: exp }).map((r) => [r.key, r.parentKey, r.level, r.hasChildren]),
      rowsPopulated: visibleRows(t, { expanded: exp, onlyWithSongs: true }).map((r) => [r.key, r.parentKey]),
      layouts,
    };
  }
  out.lines = genreLines(t0, ['house', 'disco', 'italo disco', 'acid', 'spacesynth', 'jungle', 'nonexistent thing', 'rock']);
  for (const r of t0.roots) {
    out.familyCounts[r.name] = {
      level2: r.children.filter((c) => c.level === 2).length,
      level3: [...t0.byId.values()].filter((n) => n.level === 3 && (n.family) === r.name).length,
    };
  }
  return out;
}
