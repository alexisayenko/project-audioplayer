export const WEIGHT_BASE = 1;
export const WEIGHT_POWER = 2;

export function weightFor(n) {
  const c = Number.isFinite(n) && n > 0 ? n : 0;
  return 1 / Math.pow(WEIGHT_BASE + c, WEIGHT_POWER);
}

export function countsFromListening(songs) {
  if (!songs || typeof songs !== 'object') return null;
  const out = {};
  for (const [id, e] of Object.entries(songs)) {
    out[id] = (Number(e?.listened?.d30) || 0) + (Number(e?.skipped?.d30) || 0);
  }
  return out;
}

export function buildOrder(candidates, countsById, rng = Math.random, last = null) {
  const keyed = candidates.map((id) => {
    const w = countsById ? weightFor(countsById[id] || 0) : 1;
    return { id, key: Math.pow(rng(), 1 / w) };
  });
  keyed.sort((a, b) => b.key - a.key);
  const order = keyed.map((k) => k.id);
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
