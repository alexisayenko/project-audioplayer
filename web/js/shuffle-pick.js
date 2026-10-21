export const MIN_LOCAL_PLAY_S = 5;
export const WINDOW_MS = 30 * 86400000;

export function countsFromListening(songs) {
  if (!songs || typeof songs !== 'object') return null;
  const out = {};
  for (const [id, e] of Object.entries(songs)) {
    out[id] = (Number(e?.listened?.d30) || 0) + (Number(e?.skipped?.d30) || 0);
  }
  return out;
}

export function localPlayCounts(plays, nowMs = Date.now(), open = null) {
  const out = {};
  const add = (p) => {
    if (!p || typeof p.song_id !== 'string' || !(Number(p.listened_s) >= MIN_LOCAL_PLAY_S)) return;
    const t = Date.parse(p.timestamp);
    if (Number.isFinite(t) && nowMs - t > WINDOW_MS) return;
    out[p.song_id] = (out[p.song_id] || 0) + 1;
  };
  for (const p of plays || []) add(p);
  add(open);
  return out;
}

export function mergeCounts(server, local) {
  if (!server) return null;
  const out = { ...server };
  for (const [id, n] of Object.entries(local || {})) out[id] = (out[id] || 0) + n;
  return out;
}

export function buildOrder(candidates, countsById, rng = Math.random, last = null) {
  const order = candidates.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (countsById) {
    const keyed = order.map((id, i) => ({ id, i, n: countsById[id] || 0 }));
    keyed.sort((a, b) => a.n - b.n || a.i - b.i);
    keyed.forEach((k, i) => { order[i] = k.id; });
  }
  if (last != null && order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

export function rankMap(order) {
  const m = new Map();
  order.forEach((id, i) => { if (!m.has(id)) m.set(id, i); });
  return m;
}

export function createShuffleRank({ getCounts, rng = Math.random }) {
  let sig = null;
  let rank = null;
  let weighted = false;
  return function shuffleRank(ids, fresh = false, last = null) {
    const s = ids.join('\u0000');
    if (!fresh && rank && s === sig && (weighted || !getCounts())) return rank;
    const counts = getCounts();
    sig = s;
    weighted = !!counts;
    rank = rankMap(buildOrder(ids, counts, rng, last));
    return rank;
  };
}

export function pickByRank(cand, queue, rank) {
  let best = cand[0];
  let bestRank = Infinity;
  for (const i of cand) {
    const r = rank.get(queue[i]);
    if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
  }
  return best;
}
