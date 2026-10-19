export const LAYOUT_VERSION = 1;
export const LAYOUT_WIDTH = 1000;
export const LAYOUT_URL = 'data/genre-layout.json';

const round1 = (v) => Math.round(v * 10) / 10;

export function exportLayout(nodes, { now = new Date() } = {}) {
  const list = nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
  if (!list.length) return { version: LAYOUT_VERSION, generated_at: now.toISOString(), genres: {}, families: {} };
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const n of list) {
    x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x);
    y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
  }
  const k = x1 > x0 ? LAYOUT_WIDTH / (x1 - x0) : 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const out = { version: LAYOUT_VERSION, generated_at: now.toISOString(), genres: {}, families: {} };
  for (const n of list) {
    const target = n.id.startsWith('g:') ? out.families : out.genres;
    target[n.id.slice(2)] = [round1((n.x - cx) * k), round1((n.y - cy) * k)];
  }
  return out;
}

const point = (v) => Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);

export function parseLayout(data) {
  if (!data || typeof data !== 'object' || data.version !== LAYOUT_VERSION) return null;
  const saved = new Map();
  for (const [key, v] of Object.entries(data.genres || {})) if (point(v)) saved.set(`s:${key}`, [v[0], v[1]]);
  for (const [key, v] of Object.entries(data.families || {})) if (point(v)) saved.set(`g:${key}`, [v[0], v[1]]);
  return saved.size ? saved : null;
}

export async function loadLayoutFile(fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(LAYOUT_URL);
    if (!res.ok) return null;
    return parseLayout(await res.json());
  } catch { return null; }
}
