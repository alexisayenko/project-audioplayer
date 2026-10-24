export const RING_GAP = 6;
export const RING_SCALE = 3;
const RING_MAX = 70 * RING_SCALE;
const RING_PITCH = 6;
const RING_MULTI_MIN = 14;
const RING_STEP = 0.85;
const RING_ARC = (300 * Math.PI) / 180;
const MAX_RINGS = 24;

const at = (ang, rad) => ({ ang, rad });
const sum = (list) => list.reduce((s, v) => s + v, 0);
const spread = (par) => ({ center: (par.id.length % 11) * 0.3, arc: 2 * Math.PI });

function singleRing(count, first, pitch, center, arc) {
  const rad = Math.min(RING_MAX, Math.max(first, (RING_SCALE * count * pitch) / arc));
  return Array.from({ length: count }, (_, i) => at(center - arc / 2 + (arc * (i + 0.5)) / count, rad));
}

function ringRadii(count, first, pitch, arc) {
  const step = RING_SCALE * pitch * RING_STEP;
  const radii = [];
  for (let cap = 0, k = 0; cap < count && k < MAX_RINGS; k++) {
    radii.push(first + k * step);
    cap += (arc * radii[k]) / pitch;
  }
  return radii;
}

function ringCounts(count, radii) {
  const total = sum(radii);
  const per = radii.map((r) => Math.floor((count * r) / total));
  const order = radii.map((r, k) => ({ k, rem: (count * r) / total - per[k] })).sort((a, b) => b.rem - a.rem);
  for (let left = count - sum(per), i = 0; left > 0; left--, i++) per[order[i % order.length].k]++;
  return per;
}

function multiRing(count, first, pitch, center, arc) {
  const radii = ringRadii(count, first, pitch, arc);
  const per = ringCounts(count, radii);
  const slots = [];
  radii.forEach((rad, k) => {
    for (let j = 0; j < per[k]; j++) slots.push(at(center - arc / 2 + (arc * (j + (k % 2 ? 0.25 : 0.75))) / per[k], rad));
  });
  return slots.sort((a, b) => a.ang - b.ang || a.rad - b.rad);
}

export function fanSlots(rs, par, center, arc) {
  const count = rs.length;
  const maxR = Math.max(...rs);
  const pitch = 2 * (sum(rs) / count) + RING_PITCH;
  const first = RING_SCALE * (par.r + maxR + RING_GAP);
  return count <= RING_MULTI_MIN ? singleRing(count, first, pitch, center, arc) : multiRing(count, first, pitch, center, arc);
}

export function fanCenter(par, ups) {
  if (!ups.length) return spread(par);
  const gx = sum(ups.map((m) => m.x)) / ups.length;
  const gy = sum(ups.map((m) => m.y)) / ups.length;
  if (Math.hypot(par.x - gx, par.y - gy) < 1) return spread(par);
  return { center: Math.atan2(par.y - gy, par.x - gx), arc: RING_ARC };
}
