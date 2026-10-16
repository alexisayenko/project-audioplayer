import { api } from './api.js';
import { suggestGenres } from './genre-suggest.js';

const SUGGEST_FUZZY = 5;
const CLOSE = 0.6;

export const vkey = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[\s\-_]+/g, '');
const spaced = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

export function buildIndex(data) {
  const genres = Array.isArray(data?.genres) ? data.genres : [];
  const byKey = new Map();
  for (const e of genres) byKey.set(vkey(e.name), e);
  const aliases = new Map();
  for (const [a, target] of Object.entries(data?.aliases || {})) {
    const e = byKey.get(vkey(target));
    if (e) aliases.set(vkey(a), { alias: a, entry: e });
  }
  return { genres, byKey, aliases, names: genres.map((e) => e.name) };
}

export function resolveGenre(text, index) {
  const raw = spaced(text);
  if (!raw || !index) return null;
  const hit = index.byKey.get(vkey(raw)) || index.aliases.get(vkey(raw))?.entry
    || (raw.endsWith(' music') ? index.byKey.get(vkey(raw.slice(0, -6))) || index.aliases.get(vkey(raw.slice(0, -6)))?.entry : null);
  return hit || null;
}

function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

export function searchGenres(query, index, chosen = [], max = 6) {
  if (!index) return [];
  const names = suggestGenres(query, index.names, chosen, max);
  const out = names.map((n) => index.byKey.get(vkey(n)));
  const taken = new Set([...chosen.map(vkey), ...out.map((e) => vkey(e.name))]);
  const q = vkey(query);
  if (q) {
    for (const [k, { entry }] of index.aliases) {
      if (out.length >= max) break;
      if (k.startsWith(q) && !taken.has(vkey(entry.name))) { out.push(entry); taken.add(vkey(entry.name)); }
    }
  }
  return out;
}

export function didYouMean(text, index, limit = SUGGEST_FUZZY, chosen = []) {
  if (!index) return [];
  const q = vkey(text);
  if (!q) return [];
  const taken = new Set(chosen.map(vkey));
  const out = searchGenres(text, index, chosen, limit).map((e) => e.name);
  const scored = [];
  for (const e of index.genres) {
    const k = vkey(e.name);
    if (taken.has(k) || out.includes(e.name)) continue;
    const score = 1 - distance(q, k) / Math.max(q.length, k.length);
    if (score >= CLOSE) scored.push([score, e.name]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]));
  return [...out, ...scored.map((s) => s[1])].slice(0, limit);
}

export function unknownGenre(err) {
  const d = err?.data;
  if (err?.status !== 422 || d?.error !== 'unknown_genre') return null;
  return { value: String(d.value ?? ''), suggestions: Array.isArray(d.suggestions) ? d.suggestions.map(String) : [] };
}

let cached = null;
let loading = null;

export const cachedIndex = () => cached;

export function loadVocabulary() {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = api.genreVocabulary().then((data) => {
      const idx = buildIndex(data);
      if (idx.genres.length) cached = idx;
      return cached;
    }).catch(() => null).finally(() => { loading = null; });
  }
  return loading;
}

export function resetVocabulary(index = null) {
  cached = index;
  loading = null;
}
