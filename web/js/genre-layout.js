import { createTreeLayout } from './genre-tree-layout.js';
import { createAnnealer } from './genre-crossing-anneal.js';
import { countCrossingsXY } from './genre-crossing.js';

export const MOVE_BUDGET = 30000;

export function createCrossingLayout(graph, { seed = 1, saved = null, budget = MOVE_BUDGET } = {}) {
  const nodes = graph.nodes;
  const N = nodes.length;
  const tree = createTreeLayout(graph, { seed, sweeps: 4 });
  const { xs, ys } = tree.positions();
  const fixed = new Uint8Array(N);
  const placed = new Set();
  if (saved) {
    nodes.forEach((n, i) => {
      const p = saved.get(n.id);
      if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) { xs[i] = p[0]; ys[i] = p[1]; fixed[i] = 1; placed.add(n.id); }
    });
    seedMissing(graph, xs, ys, placed);
  }
  const radii = Float64Array.from(nodes, (n) => n.r);
  const free = fixed.some((f) => !f);
  const annealer = free && budget > 0 && tree.segs.length ? createAnnealer({ xs, ys, radii, segs: tree.segs, fixed: saved ? fixed : null, seed: seed + 4 }) : null;
  let spent = 0;
  const api = {
    nodes,
    xs,
    ys,
    treeCrossings: tree.crossings,
    get crossings() { return annealer ? annealer.crossings : countCrossingsXY(xs, ys, tree.segs); },
    get done() { return !annealer || spent >= budget; },
    get moves() { return spent; },
    apply() { nodes.forEach((n, i) => { n.hx = xs[i]; n.hy = ys[i]; }); },
    step(maxMs) {
      if (api.done) return false;
      const before = annealer.moves;
      const changed = annealer.step(maxMs, budget - spent);
      spent += annealer.moves - before;
      return changed;
    },
    run(maxMs = Infinity) {
      let changed = false;
      const t0 = performance.now();
      while (!api.done && performance.now() - t0 < maxMs) if (api.step(8)) changed = true;
      return changed;
    },
    segs: tree.segs,
  };
  return api;
}

function seedMissing(graph, xs, ys, placed) {
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const parentOf = new Map();
  for (const l of graph.links) if (l.kind === 'parent') parentOf.set(l.target, l.source);
  const slot = new Map();
  let pending = graph.nodes.filter((n) => !placed.has(n.id));
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    const next = [];
    for (const n of pending) {
      const p = parentOf.get(n.id);
      if (p !== undefined && !placed.has(p) && pass < 5) { next.push(n); continue; }
      const i = index.get(n.id);
      const pi = p !== undefined ? index.get(p) : undefined;
      const k = slot.get(p) || 0;
      slot.set(p, k + 1);
      const ang = k * 2.399963 + (i % 7) * 0.31;
      const dist = (pi !== undefined ? graph.nodes[pi].r : 0) + n.r + 14 + 9 * Math.sqrt(k);
      const cx = pi !== undefined ? xs[pi] : 0;
      const cy = pi !== undefined ? ys[pi] : 0;
      xs[i] = cx + Math.cos(ang) * dist;
      ys[i] = cy + Math.sin(ang) * dist;
      placed.add(n.id);
    }
    pending = next;
  }
}
