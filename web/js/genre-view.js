import { BP_DESKTOP } from './constants.js';
import { FAMILIES } from './genre-data.js';

export const POLL_MS = 5000;
const POLL_MAX = 24;

export const shouldPoll = (pending, polls, max = POLL_MAX) => !!pending && polls < max;

export function fitTransform(b, W, H, { insets = {}, pad = 32, minK = 0.15, maxK = 2.2 } = {}) {
  const { t = 0, r = 0, b: bot = 0, l = 0 } = insets;
  const aw = Math.max(1, W - l - r - 2 * pad);
  const ah = Math.max(1, H - t - bot - 2 * pad);
  const bw = Math.max(b.x1 - b.x0, 40);
  const bh = Math.max(b.y1 - b.y0, 40);
  const k = Math.min(maxK, Math.max(minK, Math.min(aw / bw, ah / bh)));
  const cx = l + (W - l - r) / 2;
  const cy = t + (H - t - bot) / 2;
  return { k, x: cx - ((b.x0 + b.x1) / 2) * k, y: cy - ((b.y0 + b.y1) / 2) * k };
}

export const recenterOnResize = (tf, ow, oh, w, h) => ({ k: tf.k, x: tf.x + (w - ow) / 2, y: tf.y + (h - oh) / 2 });

const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function placeLabels(cands, { cell = 64, gap = 2 } = {}) {
  const grid = new Map();
  const shown = new Set();
  const cellsOf = (r) => {
    const out = [];
    for (let gx = Math.floor(r.x / cell); gx <= Math.floor((r.x + r.w) / cell); gx++) {
      for (let gy = Math.floor(r.y / cell); gy <= Math.floor((r.y + r.h) / cell); gy++) out.push(`${gx},${gy}`);
    }
    return out;
  };
  const place = (c) => {
    const box = { x: c.x - c.w / 2 - gap, y: c.y - gap, w: c.w + 2 * gap, h: c.h + 2 * gap };
    const keys = cellsOf(box);
    if (!c.force) {
      for (const k of keys) for (const o of grid.get(k) || []) if (hit(box, o)) return;
    }
    for (const k of keys) { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(box); }
    shown.add(c.id);
  };
  for (const c of cands) if (c.force) place(c);
  for (const c of cands) if (!c.force) place(c);
  return shown;
}

export function toggleHidden(hidden, family) {
  const next = new Set(hidden);
  if (next.has(family)) next.delete(family); else next.add(family);
  return next;
}


export function presentFamilies(nodes) {
  const counts = new Map();
  for (const n of nodes) counts.set(n.family, (counts.get(n.family) || 0) + 1);
  return FAMILIES.filter((f) => counts.has(f)).map((f) => ({ family: f, count: counts.get(f) }));
}

const edgeKey = (e) => `${e.kind || 'parent'}|${e.source}|${e.target}`;

export function diffGraph(prev, next) {
  const no = { sameTopology: false, changed: [] };
  if (!prev || prev.nodes.length !== next.nodes.length || prev.edges.length !== next.edges.length) return no;
  const before = new Map(prev.nodes.map((n) => [n.id, n]));
  const changed = [];
  for (const n of next.nodes) {
    const p = before.get(n.id);
    if (!p) return no;
    if (p.family !== n.family) changed.push(n.id);
  }
  const edges = new Set(prev.edges.map(edgeKey));
  for (const e of next.edges) if (!edges.has(edgeKey(e))) return no;
  return { sameTopology: true, changed };
}

const parseHex = (c) => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(c).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

export function mixColor(a, b, t) {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y || t >= 1) return b;
  if (t <= 0) return a;
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}

const OPEN_KEY = 'electrophone.genresPanel';
export const outlineDefaultOpen = (width) => width >= BP_DESKTOP;

export function loadOutlineOpen(storage, width) {
  try {
    const raw = storage.getItem(OPEN_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch { /* storage unavailable: use the default */ }
  return outlineDefaultOpen(width);
}

export function saveOutlineOpen(storage, open) {
  try { storage.setItem(OPEN_KEY, open ? '1' : '0'); return true; } catch { return false; }
}
