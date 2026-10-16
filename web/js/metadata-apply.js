import { canonicalCountry } from './countries.js';
export const GENRE_CAP = 12;
const COUNTRY_CAP = 1;
const CAPS = { genre: GENRE_CAP, country: COUNTRY_CAP };
const SERVICES = ['youtube', 'soundcloud', 'wikipedia', 'spotify', 'musicbrainz', 'discogs'];
export const INERT = new Set(['spotify', 'discogs']);

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
  const rawAlbum = Array.isArray(r.albums) ? r.albums[0] : r.album;
  const album = typeof rawAlbum === 'string' ? rawAlbum.trim() : '';
  const rawYear = r.releaseYear ?? r.year;
  const year = Number.isInteger(rawYear) ? rawYear : null;
  const returnedTags = (Array.isArray(r.tags) ? r.tags : []).filter((t) => typeof t === 'string' && CAPS[tagKey(t)]);
  const plan = { album: null, released: null, tags: addNamespaced(cur.tags || [], returnedTags) };
  if (album && !cur.versioned && !String(cur.album ?? '').trim()) plan.album = album;
  if (year != null && String(cur.released ?? '').trim() === '') plan.released = year;
  for (const key of ['wikipedia_song', 'wikipedia_artist', 'wikipedia_album']) {
    const link = typeof r[key] === 'string' && /^https:\/\/\S+$/i.test(r[key]) ? r[key] : null;
    if (link && !String(cur[key] ?? '').trim()) plan[key] = link;
  }
  const returned = !!album || year != null || returnedTags.length > 0;
  const filled = plan.album != null || plan.released != null || plan.tags.length > 0 || !!(plan.wikipedia_song || plan.wikipedia_artist || plan.wikipedia_album);
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

export const countryCode = (raw) => canonicalCountry(String(raw ?? '').trim());
