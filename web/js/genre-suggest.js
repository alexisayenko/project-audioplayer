const SUGGEST_MAX = 6;

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function suggestGenres(query, genres, chosen = [], max = SUGGEST_MAX) {
  const q = fold(query);
  if (!q) return [];
  const taken = new Set(chosen.map(fold));
  const starts = [];
  const words = [];
  const inside = [];
  const seen = new Set();
  for (const g of genres || []) {
    const f = fold(g);
    if (!f || taken.has(f) || seen.has(f)) continue;
    seen.add(f);
    if (f.startsWith(q)) starts.push(g);
    else if (f.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) words.push(g);
    else if (f.includes(q)) inside.push(g);
  }
  return [...starts, ...words, ...inside].slice(0, max);
}

export function matchRange(genre, query) {
  const g = fold(genre);
  const q = fold(query);
  if (!q || g.length !== String(genre).length) return null;
  const at = g.indexOf(q);
  return at < 0 ? null : [at, at + q.length];
}
