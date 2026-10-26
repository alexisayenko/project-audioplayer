import { mulberry32 } from './genre-sim.js';
import { segmentsCross, countCrossingsXY } from './genre-crossing.js';

const OVERLAP_PENALTY = 30;
const ANCHOR = 6e-6;

export function createAnnealer({ xs, ys, radii, segs, fixed = null, seed = 5, temperature = 1, cooling = 0.9998 }) {
  const rng = mulberry32(seed);
  const N = xs.length;
  const S = segs.length;
  const inc = Array.from({ length: N }, () => []);
  segs.forEach(([a, b], k) => { inc[a].push(k); inc[b].push(k); });
  const nbrs = inc.map((list, i) => list.map((k) => (segs[k][0] === i ? segs[k][1] : segs[k][0])));
  const bx0 = new Float64Array(S);
  const bx1 = new Float64Array(S);
  const by0 = new Float64Array(S);
  const by1 = new Float64Array(S);
  const box = (k) => {
    const [a, b] = segs[k];
    bx0[k] = Math.min(xs[a], xs[b]); bx1[k] = Math.max(xs[a], xs[b]);
    by0[k] = Math.min(ys[a], ys[b]); by1[k] = Math.max(ys[a], ys[b]);
  };
  for (let k = 0; k < S; k++) box(k);

  const home0x = Float64Array.from(xs);
  const home0y = Float64Array.from(ys);
  const anchor = (group) => {
    let a = 0;
    for (const g of group) { const dx = xs[g] - home0x[g]; const dy = ys[g] - home0y[g]; a += dx * dx + dy * dy; }
    return a * ANCHOR;
  };
  const inGroup = new Uint8Array(N);
  const segMark = new Uint8Array(S);
  const crossOf = (k, skipMarked = false) => {
    const [a, b] = segs[k];
    let c = 0;
    for (let u = 0; u < S; u++) {
      if (u === k || bx1[u] < bx0[k] || bx0[u] > bx1[k] || by1[u] < by0[k] || by0[u] > by1[k]) continue;
      if (skipMarked && segMark[u] && u < k) continue;
      const [p, q] = segs[u];
      if (a === p || a === q || b === p || b === q) continue;
      if (segmentsCross(xs[a], ys[a], xs[b], ys[b], xs[p], ys[p], xs[q], ys[q])) c++;
    }
    return c;
  };
  const cost = (group, touched) => {
    let c = 0;
    for (const k of touched) c += crossOf(k, true);
    let o = 0;
    for (const i of group) {
      for (let j = 0; j < N; j++) {
        if (inGroup[j]) continue;
        const dx = xs[i] - xs[j];
        const dy = ys[i] - ys[j];
        const m = radii[i] + radii[j] + 2;
        if (dx * dx + dy * dy < m * m) o++;
      }
    }
    return { c, o };
  };

  const free = [];
  for (let i = 0; i < N; i++) if (!fixed?.[i]) free.push(i);
  let current = countCrossingsXY(xs, ys, segs);
  let temp = temperature;
  let hot = [];
  let moves = 0;
  const refreshHot = () => {
    const set = new Set();
    for (let k = 0; k < S; k++) {
      if (crossOf(k) > 0) {
        for (const v of segs[k]) if (!fixed?.[v]) set.add(v);
      }
    }
    hot = [...set];
  };
  refreshHot();

  function move() {
    if (moves % 400 === 0) refreshHot();
    moves++;
    let i = hot.length && rng() < 0.8 ? hot[Math.floor(rng() * hot.length)] : Math.floor(rng() * N);
    if (fixed?.[i]) {
      if (!free.length) return false;
      i = free[Math.floor(rng() * free.length)];
    }
    const nb = nbrs[i];
    const mode = rng();
    const group = [i];
    if (mode >= 0.7) {
      for (const k of inc[i]) {
        const c = segs[k][0] === i ? segs[k][1] : -1;
        if (c >= 0 && inc[c].length === 1 && !fixed?.[c] && group.length < 40) group.push(c);
      }
    }
    for (const g of group) inGroup[g] = 1;
    const touched = [];
    for (const g of group) for (const k of inc[g]) if (!segMark[k]) { segMark[k] = 1; touched.push(k); }
    const ox = group.map((g) => xs[g]);
    const oy = group.map((g) => ys[g]);
    const before = cost(group, touched);
    const anchorBefore = anchor(group);
    let dx = 0;
    let dy = 0;
    const x0 = xs[i];
    const y0 = ys[i];
    let tx;
    let ty;
    if (mode < 0.3 && nb.length >= 2) {
      const a = nb[Math.floor(rng() * nb.length)];
      const b = nb[Math.floor(rng() * nb.length)];
      const t = 0.2 + 0.6 * rng();
      tx = xs[a] + (xs[b] - xs[a]) * t + (rng() - 0.5) * 10;
      ty = ys[a] + (ys[b] - ys[a]) * t + (rng() - 0.5) * 10;
    } else if (mode < 0.5 && nb.length >= 1) {
      const a = nb[Math.floor(rng() * nb.length)];
      const ang = rng() * 2 * Math.PI;
      const d = radii[a] + radii[i] + 6 + 40 * rng();
      tx = xs[a] + Math.cos(ang) * d;
      ty = ys[a] + Math.sin(ang) * d;
    } else if (mode < 0.7 || group.length === 1) {
      const sigma = 15 + 60 * rng();
      tx = x0 + (rng() - 0.5) * 2 * sigma;
      ty = y0 + (rng() - 0.5) * 2 * sigma;
    } else {
      const sigma = 20 + 90 * rng();
      tx = x0 + (rng() - 0.5) * 2 * sigma;
      ty = y0 + (rng() - 0.5) * 2 * sigma;
    }
    dx = tx - x0;
    dy = ty - y0;
    group.forEach((g, n) => { xs[g] = ox[n] + dx; ys[g] = oy[n] + dy; });
    for (const k of touched) box(k);
    const after = cost(group, touched);
    const dEnergy = after.c + after.o * OVERLAP_PENALTY - before.c - before.o * OVERLAP_PENALTY + anchor(group) - anchorBefore;
    const ok = dEnergy <= 0 || rng() < Math.exp(-dEnergy / temp);
    if (ok) current += after.c - before.c;
    else {
      group.forEach((g, n) => { xs[g] = ox[n]; ys[g] = oy[n]; });
      for (const k of touched) box(k);
    }
    for (const g of group) inGroup[g] = 0;
    for (const k of touched) segMark[k] = 0;
    temp = Math.max(0.05, temp * cooling);
    return ok;
  }

  return {
    get crossings() { return current; },
    get moves() { return moves; },
    recount() { current = countCrossingsXY(xs, ys, segs); return current; },
    step(maxMs, maxMoves = Infinity) {
      const t0 = performance.now();
      let n = 0;
      let changed = false;
      while (n < maxMoves && (n % 16 !== 0 || performance.now() - t0 < maxMs)) {
        if (move()) changed = true;
        n++;
      }
      return changed;
    },
    run(count) {
      for (let k = 0; k < count; k++) move();
      return current;
    },
  };
}
