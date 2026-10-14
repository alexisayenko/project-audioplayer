import { COUNTRY_NAMES, COUNTRY_ALIASES, HISTORICAL_COUNTRIES } from './countries-data.js';

export const COUNTRY_CODES = Object.keys(COUNTRY_NAMES);

let namer = null;
try { namer = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* English table names are used */ }

export function normCountry(value) {
  const v = String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase()
    .replace(/['.]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
  return v.startsWith('the ') ? v.slice(4) : v;
}

export function canonicalCountry(value) {
  return COUNTRY_ALIASES[normCountry(value)] || null;
}

export const isHistoricalCountry = (code) => HISTORICAL_COUNTRIES.includes(String(code).toLowerCase());

export function countryName(code) {
  const c = String(code).toLowerCase();
  if (isHistoricalCountry(c)) return COUNTRY_NAMES[c];
  try {
    const n = namer?.of(c.toUpperCase());
    if (n && n.toLowerCase() !== c) return n;
  } catch { /* fall through */ }
  return COUNTRY_NAMES[c] || code;
}

export function filterCountries(query, limit = 12) {
  const q = normCountry(query);
  const all = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) }));
  if (!q) return all.toSorted((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  const alias = Object.entries(COUNTRY_ALIASES);
  const score = ({ code, name }) => {
    const n = normCountry(name);
    if (code === q || n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (alias.some(([k, v]) => v === code && k.startsWith(q))) return 2;
    if (n.includes(q)) return 3;
    return alias.some(([k, v]) => v === code && k.includes(q)) ? 4 : 9;
  };
  return all.map((c) => ({ c, s: score(c) })).filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name)).slice(0, limit).map((x) => x.c);
}

export const isKnownCountry = (value) => canonicalCountry(value) !== null;
