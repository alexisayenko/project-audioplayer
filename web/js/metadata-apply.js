export const GENRE_CAP = 12;
export const COUNTRY_CAP = 1;
const CAPS = { genre: GENRE_CAP, country: COUNTRY_CAP };
export const SERVICES = ['youtube', 'soundcloud', 'wikipedia', 'spotify', 'musicbrainz', 'discogs'];
export const INERT = new Set(['spotify', 'musicbrainz', 'discogs']);

const tagKey = (t) => { const i = t.indexOf(':'); return i > 0 ? t.slice(0, i).trim().toLowerCase() : ''; };
const hasTag = (tags, t) => tags.some((x) => x.toLowerCase() === t.toLowerCase());

export function addNamespaced(tags, candidates) {
  const have = [...tags];
  const added = [];
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const k = tagKey(raw);
    const t = raw.trim().toLowerCase();
    if (!CAPS[k] || t.length <= k.length + 1 || hasTag(have, t)) continue;
    if (have.filter((x) => tagKey(x) === k).length >= CAPS[k]) continue;
    have.push(t);
    added.push(t);
  }
  return added;
}

export function planMetadata(resp, cur) {
  const r = resp || {};
  const album = typeof r.album === 'string' ? r.album.trim() : '';
  const year = Number.isInteger(r.year) ? r.year : null;
  const returnedTags = (Array.isArray(r.tags) ? r.tags : []).filter((t) => typeof t === 'string' && CAPS[tagKey(t)]);
  const plan = { album: null, year: null, tags: addNamespaced(cur.tags || [], returnedTags) };
  if (album && !String(cur.album ?? '').trim()) plan.album = album;
  if (year != null && String(cur.year ?? '').trim() === '') plan.year = year;
  const returned = !!album || year != null || returnedTags.length > 0;
  const filled = plan.album != null || plan.year != null || plan.tags.length > 0;
  if (filled) plan.status = 'filled';
  else plan.status = returned ? 'current' : 'empty';
  return plan;
}

export const statusText = (plan) => ({ current: 'Already up to date', empty: 'Nothing found' })[plan.status] || '';

export function serviceState(services) {
  const out = {};
  for (const name of SERVICES) {
    const s = services && typeof services === 'object' ? services[name] : null;
    const on = !INERT.has(name) && !!s && s.found === true;
    out[name] = { on, url: on && typeof s.url === 'string' && /^https?:\/\//i.test(s.url) ? s.url : null };
  }
  return out;
}

const norm = (v) => String(v ?? '').trim().toLowerCase();

export function suggestion(suggest, cur) {
  const s = suggest && typeof suggest === 'object' ? suggest : {};
  const out = {};
  for (const k of ['artist', 'title']) {
    if (typeof s[k] === 'string' && s[k].trim() && norm(s[k]) !== norm(cur[k])) out[k] = s[k].trim();
  }
  return Object.keys(out).length ? out : null;
}

export const suggestionText = (sug, cur) => [sug.artist ?? cur.artist, sug.title ?? cur.title].map((v) => String(v ?? '').trim()).filter(Boolean).join(' / ');

let names = null;
function regionNames() {
  if (names) return names;
  names = new Map();
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    const A = 65;
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCodePoint(A + i, A + j);
        const n = dn.of(code);
        if (n && n !== code) names.set(code.toLowerCase(), n.toLowerCase());
      }
    }
  } catch { /* no Intl.DisplayNames: only codes are accepted */ }
  return names;
}

export function countryCode(raw) {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return null;
  const map = regionNames();
  if (/^[a-z]{2}$/.test(t) && (map.has(t) || map.size === 0)) return t;
  for (const [code, n] of map) if (n === t) return code;
  return null;
}
