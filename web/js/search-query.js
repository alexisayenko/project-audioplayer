const NOISE = new Set(['ft', 'feat', 'featuring', 'x', 'vs']);

export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();

export function queryTokens(query) {
  const tokens = fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.filter((t) => !NOISE.has(t));
}

export function matchesQuery(hay, query) {
  const h = fold(hay);
  const whole = fold(query).trim();
  if (!whole) return true;
  if (h.includes(whole)) return true;
  const tokens = queryTokens(query);
  return tokens.length > 0 && tokens.every((t) => h.includes(t));
}
