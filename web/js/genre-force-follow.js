import { shiftNode } from './genre-force-body.js';

const FOLLOW_EPS = 0.05;
const FOLLOW_STIFFNESS = 90;
const FOLLOW_DAMPING = 8;
export const FOLLOW_STEP_MS = 8;
const FOLLOW_REST_DIST = 0.02;
const FOLLOW_REST_SPEED = 0.05;

const pinnedOutside = (parentLinks, c, inside) => (parentLinks.get(c.id) || []).some((l) => l.s.target === 1 && l.s.fx != null && !l.s.dropped && !inside.has(l.s.id));

function nextLevel(level, depth, seen, out, { childrenOf, parentLinks }) {
  const next = [];
  for (const p of level) {
    for (const c of childrenOf.get(p.id) || []) {
      if (seen.has(c.id) || pinnedOutside(parentLinks, c, seen)) continue;
      seen.add(c.id);
      out.push({ c, depth });
      next.push(c);
    }
  }
  return next;
}

export function subtreeOf(root, env) {
  const seen = new Set([root.id]);
  const out = [];
  let level = [root];
  let depth = 1;
  while (level.length) {
    level = nextLevel(level, depth, seen, out, env);
    depth++;
  }
  return out;
}

function muteTreeLinks(simLinks, sub) {
  const inside = new Set(sub.map((it) => it.c.id));
  const muted = [];
  for (const sl of simLinks) {
    if (sl.tree && inside.has(sl.t.id)) { sl.mute = true; muted.push(sl); }
  }
  return muted;
}

function tether(it, root, byItem, parentLinks) {
  const l = (parentLinks.get(it.c.id) || []).find((pl) => pl.s === root || byItem.has(pl.s.id));
  if (!l) return;
  it.parent = l.s === root ? null : byItem.get(l.s.id);
  const [ox, oy] = it.parent ? [it.parent.px, it.parent.py] : [root.x, root.y];
  it.len = Math.hypot(it.px - ox, it.py - oy);
  it.tethered = true;
}

export function followItems(root, sub, simLinks, parentLinks) {
  const muted = muteTreeLinks(simLinks, sub);
  const items = sub.map(({ c }) => ({ c, px: c.x, py: c.y, parent: null, len: 0, tethered: false }));
  const byItem = new Map(items.map((it) => [it.c.id, it]));
  for (const it of items) tether(it, root, byItem, parentLinks);
  for (const n of [root, ...items.map((it) => it.c)]) n.ghost = true;
  for (const it of items) if (it.c.target === 1) { it.c.fx = it.c.x; it.c.fy = it.c.y; }
  return { root, items, muted };
}

function pullItem(it, rx, ry, f) {
  const ox = it.parent ? it.parent.px : rx;
  const oy = it.parent ? it.parent.py : ry;
  const dx = ox - it.px;
  const dy = oy - it.py;
  const d = Math.hypot(dx, dy);
  const excess = d - it.len;
  if (excess <= 0) return false;
  const k = (excess < FOLLOW_EPS ? 1 : f) * (excess / d);
  shiftNode(it.c, dx * k, dy * k);
  it.px += dx * k; it.py += dy * k;
  return excess >= FOLLOW_EPS;
}

export function stepTethers(pull, f) {
  const rx = pull.root.fx ?? pull.root.x;
  const ry = pull.root.fy ?? pull.root.y;
  let busy = false;
  for (const it of pull.items) {
    if (it.tethered && pullItem(it, rx, ry, f)) busy = true;
  }
  return busy;
}

const springError = (sp) => ({ ex: sp.root.x + sp.ox - sp.px, ey: sp.root.y + sp.oy - sp.py });

export function integrateSprings(springs, h) {
  for (const [c, sp] of springs) {
    const { ex, ey } = springError(sp);
    sp.vx += (FOLLOW_STIFFNESS * ex - FOLLOW_DAMPING * sp.vx) * h;
    sp.vy += (FOLLOW_STIFFNESS * ey - FOLLOW_DAMPING * sp.vy) * h;
    const dx = sp.vx * h, dy = sp.vy * h;
    sp.px += dx; sp.py += dy;
    shiftNode(c, dx, dy);
  }
}

export function restSprings(springs, held) {
  for (const [c, sp] of springs) {
    const { ex, ey } = springError(sp);
    const still = Math.hypot(ex, ey) < FOLLOW_REST_DIST && Math.hypot(sp.vx, sp.vy) < FOLLOW_REST_SPEED;
    if (still && !held(sp.root)) {
      shiftNode(c, ex, ey);
      springs.delete(c);
    }
  }
}

export function snapSprings(springs) {
  for (const [c, sp] of springs) {
    const { ex, ey } = springError(sp);
    shiftNode(c, ex, ey);
  }
  springs.clear();
}
