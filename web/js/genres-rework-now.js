import { assignableNode, ancestorIds, count } from './genre-levels.js';
import { songGenres } from './genre-playing.js';

function candidates(tree, song, rootId) {
  const found = new Map();
  for (const g of songGenres(song)) {
    const n = assignableNode(g.key, tree);
    if (n && (!rootId || ancestorIds(tree, n.id).has(rootId))) found.set(n.id, n);
  }
  return found;
}

const deepest = (found) => [...found.values()].sort((a, b) => b.level - a.level || count(b) - count(a) || a.name.localeCompare(b.name))[0];

function parentsOfLevel(tree, level, seen) {
  const next = [];
  for (const n of level) {
    for (const pid of n.parents || []) {
      const p = tree.byId.get(pid);
      if (p && !seen.has(p.id)) { seen.add(p.id); next.push(p); }
    }
  }
  return next;
}

export function findNowNode({ tree, song, kind, layout, graph, rootGenre }) {
  if (!tree) return null;
  if (kind === 'radial' && !layout) return null;
  const rootId = kind === 'radial' ? `g:${rootGenre}` : null;
  const best = deepest(candidates(tree, song, rootId));
  const drawn = (n) => (kind === 'radial' ? layout.byId.has(n.id) : graph?.byId.has(n.id));
  const seen = new Set();
  for (let level = best ? [best] : []; level.length; level = parentsOfLevel(tree, level, seen)) {
    const hit = level.find(drawn);
    if (hit) return hit;
  }
  return null;
}
