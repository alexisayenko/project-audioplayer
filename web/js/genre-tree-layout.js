import { mulberry32 } from './genre-sim.js';
import { FAMILY_ORDER } from './genre-data.js';
import { countCrossingsXY, segmentsCross } from './genre-crossing.js';

export const HUB_RING = 190;
export const RING2 = 300;
export const RING3 = 620;
export const BAND = 20;
export const BANDS = 3;
const DEEP_STEP = 140;
const BASE_WEIGHT = [20, 3, 1];
const ROOT = '\u0000root';

function primaryParent(nodes, index, b) {
  const node = nodes[b].node;
  const primaryId = node?.parent || (node?.parents || []).find((id) => nodes[index.get(id)]?.level === nodes[b].level - 1);
  return primaryId ? index.get(primaryId) : undefined;
}

function classifyLinks(graph, index) {
  const nodes = graph.nodes;
  const parentOf = new Array(nodes.length).fill(-1);
  const kids = new Map();
  const segs = [];
  const crossLinks = [];
  for (const l of graph.links) {
    const a = index.get(l.source);
    const b = index.get(l.target);
    if (a === undefined || b === undefined) continue;
    if (l.kind !== 'parent' && l.kind !== 'related') continue;
    segs.push([a, b]);
    if (l.kind === 'parent' && primaryParent(nodes, index, b) === a) {
      parentOf[b] = a;
      if (!kids.has(a)) kids.set(a, []);
      kids.get(a).push(b);
    } else {
      crossLinks.push([a, b]);
    }
  }
  return { parentOf, kids, segs, crossLinks };
}

const sharesEndpoint = (a, b, p, q) => a === p || a === q || b === p || b === q;

export function createTreeLayout(graph, { seed = 1, sweeps = 4 } = {}) {
  const rng = mulberry32(seed);
  const nodes = graph.nodes;
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const N = nodes.length;
  const { parentOf, kids, segs, crossLinks } = classifyLinks(graph, index);
  const labelOf = (i) => nodes[i].label || nodes[i].name || nodes[i].id;
  const byLabel = (a, b) => labelOf(a).localeCompare(labelOf(b));
  const rootRank = (i) => { const r = FAMILY_ORDER.indexOf(nodes[i].name); return r < 0 ? FAMILY_ORDER.length : r; };
  const roots = nodes.map((_, i) => i).filter((i) => parentOf[i] < 0).sort((a, b) => rootRank(a) - rootRank(b) || byLabel(a, b));
  const orders = new Map();
  orders.set(ROOT, roots);
  for (const [p, list] of kids) orders.set(p, list.sort(byLabel));

  const weight = new Float64Array(N);
  const depthOf = new Int32Array(N);
  const calcWeight = (i, depth) => {
    depthOf[i] = depth;
    let sum = 0;
    for (const c of kids.get(i) || []) sum += calcWeight(c, depth + 1);
    weight[i] = Math.max(BASE_WEIGHT[Math.min(depth, 2)], sum);
    return weight[i];
  };
  for (const r of roots) calcWeight(r, 0);

  const xs = new Float64Array(N);
  const ys = new Float64Array(N);
  const angle = new Float64Array(N);
  const lo = new Float64Array(N);
  const hi = new Float64Array(N);
  const depthAt = new Int32Array(N);

  const put = (i, depth, a, slot) => {
    let r = HUB_RING;
    if (depth === 1) r = RING2;
    else if (depth >= 2) r = RING3 + (depth - 2) * DEEP_STEP + (slot % BANDS) * BAND;
    angle[i] = a;
    xs[i] = Math.cos(a) * r;
    ys[i] = Math.sin(a) * r;
  };

  const assign = (i, a0, a1, depth, slot) => {
    put(i, depth, (a0 + a1) / 2, slot);
    lo[i] = a0; hi[i] = a1; depthAt[i] = depth;
    const list = orders.get(i);
    if (!list) return;
    let total = 0;
    for (const c of list) total += weight[c];
    let cur = a0;
    list.forEach((c, k) => {
      const span = ((a1 - a0) * weight[c]) / total;
      assign(c, cur, cur + span, depth + 1, k);
      cur += span;
    });
  };

  function place() {
    let total = 0;
    for (const r of orders.get(ROOT)) total += weight[r];
    let cur = -Math.PI / 2;
    orders.get(ROOT).forEach((r, k) => {
      const span = (2 * Math.PI * weight[r]) / total;
      assign(r, cur, cur + span, 0, k);
      cur += span;
    });
  }

  function reassign(key) {
    if (key === ROOT) { place(); return; }
    const list = orders.get(key);
    let total = 0;
    for (const c of list) total += weight[c];
    let cur = lo[key];
    list.forEach((c, k) => {
      const span = ((hi[key] - lo[key]) * weight[c]) / total;
      assign(c, cur, cur + span, depthAt[key] + 1, k);
      cur += span;
    });
  }

  const count = () => countCrossingsXY(xs, ys, segs);
  const nSeg = segs.length;
  const sx0 = new Float64Array(nSeg);
  const sy0 = new Float64Array(nSeg);
  const sx1 = new Float64Array(nSeg);
  const sy1 = new Float64Array(nSeg);
  const refreshBoxes = () => {
    for (let k = 0; k < nSeg; k++) {
      const a = segs[k][0];
      const b = segs[k][1];
      sx0[k] = Math.min(xs[a], xs[b]); sx1[k] = Math.max(xs[a], xs[b]);
      sy0[k] = Math.min(ys[a], ys[b]); sy1[k] = Math.max(ys[a], ys[b]);
    }
  };
  const segsOf = new Map();
  const descendants = (key, out) => { for (const c of kids.get(key) || []) { out.add(c); descendants(c, out); } return out; };
  const affected = (key) => {
    if (segsOf.has(key)) return segsOf.get(key);
    const moved = new Set();
    for (const c of orders.get(key)) { moved.add(c); descendants(c, moved); }
    const list = [];
    segs.forEach(([a, b], k) => { if (moved.has(a) || moved.has(b)) list.push(k); });
    const mask = new Uint8Array(nSeg);
    for (const k of list) mask[k] = 1;
    const out = { list, mask };
    segsOf.set(key, out);
    return out;
  };
  const boxesApart = (t, s) => sx1[t] < sx0[s] || sx0[t] > sx1[s] || sy1[t] < sy0[s] || sy0[t] > sy1[s];
  const touching = ({ list, mask }) => {
    let c = 0;
    for (const s of list) {
      const [a, b] = segs[s];
      for (let t = 0; t < nSeg; t++) {
        if (t === s || (mask[t] && t < s)) continue;
        if (boxesApart(t, s)) continue;
        const [p, q] = segs[t];
        if (sharesEndpoint(a, b, p, q)) continue;
        if (segmentsCross(xs[a], ys[a], xs[b], ys[b], xs[p], ys[p], xs[q], ys[q])) c++;
      }
    }
    return c;
  };
  const wrap = (d) => {
    let x = d;
    while (x > Math.PI) x -= 2 * Math.PI;
    while (x < -Math.PI) x += 2 * Math.PI;
    return x;
  };

  const cross = new Map();
  for (const [a, b] of crossLinks) {
    if (!cross.has(a)) cross.set(a, []);
    if (!cross.has(b)) cross.set(b, []);
    cross.get(a).push(b);
    cross.get(b).push(a);
  }

  function barycenterSweep() {
    for (const [key, list] of orders) {
      if (list.length < 2) continue;
      const centre = key === ROOT ? 0 : angle[key];
      const keyOf = (c) => {
        const others = cross.get(c);
        const own = wrap(angle[c] - centre);
        if (!others) return own;
        let s = 0;
        for (const o of others) s += wrap(angle[o] - centre);
        return (s / others.length + own) / 2;
      };
      const keyed = list.map((c) => [keyOf(c), c]);
      keyed.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      orders.set(key, keyed.map((p) => p[1]));
    }
    place();
  }

  function orderFamilies() {
    const rootOf = (i) => {
      let x = i;
      while (parentOf[x] >= 0) x = parentOf[x];
      return x;
    };
    const list = orders.get(ROOT);
    const w = new Map();
    for (const [a, b] of crossLinks) {
      const p = rootOf(a);
      const q = rootOf(b);
      if (p === q) continue;
      const key = p < q ? p + '|' + q : q + '|' + p;
      w.set(key, (w.get(key) || 0) + 1);
    }
    const pairs = [...w.entries()].map(([k, c]) => [...k.split('|').map(Number), c]);
    const n = list.length;
    const cost = (order) => {
      const at = new Map(order.map((r, k) => [r, k]));
      let sum = 0;
      for (const [p, q, c] of pairs) { const d = Math.abs(at.get(p) - at.get(q)); sum += c * Math.min(d, n - d); }
      return sum;
    };
    let cur = list.slice();
    let curCost = cost(cur);
    let best = cur;
    let bestCost = curCost;
    let t = 2;
    for (let it = 0; it < 6000; it++) {
      const next = cur.slice();
      const i = Math.floor(rng() * n);
      const j = Math.floor(rng() * n);
      if (i === j) continue;
      [next[i], next[j]] = [next[j], next[i]];
      const c = cost(next);
      if (c <= curCost || rng() < Math.exp((curCost - c) / t)) { cur = next; curCost = c; if (c < bestCost) { best = next; bestCost = c; } }
      t = Math.max(0.05, t * 0.999);
    }
    orders.set(ROOT, best);
  }

  orderFamilies();
  place();
  refreshBoxes();
  const initial = count();
  for (let s = 0; s < sweeps; s++) barycenterSweep();
  refreshBoxes();

  let best = count();
  let current = best;
  const movable = [...orders.entries()].filter(([, l]) => l.length >= 2).map(([k]) => k);
  const involved = movable.filter((k) => orders.get(k).some((c) => cross.has(c) || (kids.get(c) || []).some((d) => cross.has(d))));
  const pool = involved.length ? involved : movable;
  let temperature = Math.max(1, best * 0.02);
  let iterations = 0;

  function iterate() {
    if (!pool.length) return false;
    const key = pool[Math.floor(rng() * pool.length)];
    const list = orders.get(key);
    const i = Math.floor(rng() * list.length);
    let j = Math.floor(rng() * list.length);
    if (i === j) j = (j + 1) % list.length;
    const copy = list.slice();
    if (rng() < 0.5) { const [x] = copy.splice(i, 1); copy.splice(j, 0, x); } else { [copy[i], copy[j]] = [copy[j], copy[i]]; }
    const full = key === ROOT;
    const aff = full ? null : affected(key);
    const before = full ? current : touching(aff);
    orders.set(key, copy);
    reassign(key);
    refreshBoxes();
    const after = full ? count() : touching(aff);
    const c = full ? after : current + after - before;
    iterations++;
    if (c <= current || rng() < Math.exp((current - c) / temperature)) {
      current = c;
      if (c < best) best = c;
      temperature *= 0.9985;
      return true;
    }
    orders.set(key, list);
    reassign(key);
    refreshBoxes();
    return false;
  }

  return {
    nodes,
    initialCrossings: initial,
    get crossings() { return current; },
    get iterations() { return iterations; },
    positions() { return { xs, ys }; },
    apply() { nodes.forEach((n, i) => { n.hx = xs[i]; n.hy = ys[i]; }); },
    step(maxMs, maxIter = Infinity) {
      const t0 = performance.now();
      let n = 0;
      let changed = false;
      while (n < maxIter && performance.now() - t0 < maxMs) {
        if (iterate()) changed = true;
        n++;
      }
      return changed;
    },
    run(iters) {
      for (let k = 0; k < iters; k++) iterate();
      return current;
    },
    treeCrossings() {
      const tree = segs.filter(([a, b]) => parentOf[b] === a);
      return countCrossingsXY(xs, ys, tree);
    },
    segs,
  };
}
