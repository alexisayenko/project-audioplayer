import { fanSlots, fanCenter, RING_GAP, RING_SCALE } from './genre-force-fan.js';

const NEAR_STEP = 0.5;
const sum = (list) => list.reduce((t, v) => t + v, 0);

const seatOf = (n) => ({ x: n.hx ?? n.x, y: n.hy ?? n.y });
const parentsOf = (s, n) => (s.env.parentLinks.get(n.id) || []).map((l) => l.s);

function startSession(entering, chained, env) {
  const fresh = new Set(entering);
  const placed = new Set();
  return {
    env,
    chained,
    fresh,
    placed,
    pending: new Set(entering),
    seeds: new Map(entering.map((n) => [n, seatOf(n)])),
    anchored: new Map(),
    ready: (m) => m.target === 1 && ((chained && placed.has(m)) || (!fresh.has(m) && m.vis > 0.3)),
  };
}

function settle(s, n) {
  s.placed.add(n);
  s.pending.delete(n);
}

function fanAround(s, par) {
  return fanCenter(par, parentsOf(s, par).filter(s.ready));
}

function fan(s, par, kids) {
  const { center, arc } = fanAround(s, par);
  const slots = fanSlots(kids.map((n) => n.r), par, center, arc);
  kids.forEach((n, i) => {
    const { ang, rad } = slots[i];
    n.x = par.x + Math.cos(ang) * rad;
    n.y = par.y + Math.sin(ang) * rad;
    n.vx = 0; n.vy = 0;
    n.hx = n.x; n.hy = n.y;
    n.ringPar = par.id; n.ringRad = rad;
    settle(s, n);
  });
}

function pendingKidsOf(s, a) {
  return [...s.pending].filter((m) => (s.env.parentLinks.get(m.id) || []).some((l) => l.s === a));
}

function reach(s, a, n) {
  const rings = s.env.nodes.filter((m) => m.ringPar === a.id && m.target === 1 && !s.fresh.has(m)).map((m) => m.ringRad);
  const kids = pendingKidsOf(s, a);
  if (kids.length) {
    const { center, arc } = fanAround(s, a);
    rings.push(...fanSlots(kids.map((m) => m.r), a, center, arc).map((o) => o.rad));
  }
  return rings.length ? Math.max(...rings) + RING_SCALE * RING_GAP + n.r : RING_SCALE * (a.r + n.r + RING_GAP);
}

function bearing(from, to, n) {
  return Math.hypot(to.x - from.x, to.y - from.y) > 1 ? Math.atan2(to.y - from.y, to.x - from.x) : (n.id.length % 11) * 0.6;
}

function nearArc(s, n, a) {
  const from = s.seeds.get(a) || seatOf(a);
  const to = s.seeds.get(n) || seatOf(n);
  const k = s.anchored.get(a) || 0;
  s.anchored.set(a, k + 1);
  const ang = bearing(from, to, n) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * NEAR_STEP;
  const rad = reach(s, a, n);
  n.x = a.x + Math.cos(ang) * rad;
  n.y = a.y + Math.sin(ang) * rad;
  n.vx = 0; n.vy = 0;
  n.hx = n.x; n.hy = n.y;
  n.ringPar = null;
}

function near(s, n) {
  const nb = [...(s.env.adj.get(n.id) || [])].map((id) => s.env.byId.get(id)).filter((m) => s.ready(m));
  if (!nb.length) return false;
  n.x = sum(nb.map((m) => m.x)) / nb.length + ((n.id.length % 7) - 3);
  n.y = sum(nb.map((m) => m.y)) / nb.length + ((n.id.length % 5) - 2);
  n.vx = 0; n.vy = 0;
  n.ringPar = null;
  settle(s, n);
  return true;
}

function liftPass(s) {
  let any = false;
  for (const n of s.pending) {
    const kid =(s.env.childrenOf.get(n.id) || []).find(s.ready);
    if (!kid) continue;
    nearArc(s, n, kid);
    settle(s, n);
    any = true;
  }
  return any;
}

function liftAncestors(s) {
  let any = false;
  while (liftPass(s)) any = true;
  return any;
}

function groupByReadyParent(s) {
  const groups = new Map();
  for (const n of s.pending) {
    const par = parentsOf(s, n).find(s.ready);
    if (par) groups.set(par, [...(groups.get(par) || []), n]);
  }
  return groups;
}

function fanGroups(s) {
  const groups = groupByReadyParent(s);
  for (const [par, kids] of groups) fan(s, par, kids);
  return groups.size > 0;
}

function nearNeighbours(s) {
  let any = false;
  for (const n of s.pending) if (near(s, n)) any = true;
  return any;
}

export function enterNodes(entering, chained, env) {
  const s = startSession(entering, chained, env);
  for (let moved = true; moved && s.pending.size; ) {
    moved = false;
    if (chained && liftAncestors(s)) moved = true;
    if (fanGroups(s)) moved = true;
    if (nearNeighbours(s)) moved = true;
    if (!chained) break;
  }
}
