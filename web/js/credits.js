import { splitTokens } from './tokens.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const text = (v) => String(v ?? '').trim();
const names = (list) => (Array.isArray(list) ? list.map(text).filter(Boolean) : []);

export const KINDS = ['remix', 'live', 'acoustic', 'extended', 'instrumental', 'remaster', 'edit', 'cover', 'mashup', 'other'];

export const ofNames = (v) => (Array.isArray(v) ? names(v) : text(v) ? [text(v)] : []);

export const isStructured = (song) => Array.isArray(song?.mainArtists);

export function joinNames(list) {
  const n = names(list);
  if (n.length <= 1) return n[0] ?? '';
  if (n.length === 2) return `${n[0]} & ${n[1]}`;
  return `${n.slice(0, -1).join(', ')} & ${n.at(-1)}`;
}

function hidden(seen, part) {
  const n = norm(part);
  return !n || ` ${seen} `.includes(` ${n} `);
}

function baseVersionLabel(song, title) {
  const v = song?.version;
  if (!v || typeof v !== 'object') return '';
  const seen = norm(title);
  const name = text(v.name);
  if (name) return splitTokens(name).filter((p) => !hidden(seen, p)).join(', ');
  const kind = text(v.type).toLowerCase();
  if (!kind || kind === 'other' || hidden(seen, kind)) return '';
  return kind;
}

function versionLabel(song, title) {
  const label = baseVersionLabel(song, title);
  if (!label || !isRemaster(song)) return label;
  const y = versionYear(song);
  if (y == null || y === original(song)) return label;
  const year = String(y);
  if (new RegExp(`(?<!\\d)${year}(?!\\d)`).test(`${label} ${text(song.version.name)}`)) return label;
  return `${year} ${label}`;
}

export function creditParts(song) {
  const title = String(song?.title ?? '');
  if (!isStructured(song)) {
    const seen = norm(title);
    const remix = splitTokens(song?.remixer ?? '').filter((p) => !hidden(seen, p)).join(', ');
    return { title, remix, artists: [], featured: [], version: null, structured: false };
  }
  const version = song.version && typeof song.version === 'object' ? song.version : null;
  return { title, remix: versionLabel(song, title), artists: names(song.mainArtists), featured: names(song.featuredArtists), withArtists: names(song.withArtists), version, structured: true };
}

export function artistLine(song) {
  if (!isStructured(song)) return text(song?.artist);
  const main = joinNames(song.mainArtists);
  const feat = joinNames(song.featuredArtists);
  const withs = joinNames(song.withArtists);
  const guests = [feat && `feat. ${feat}`, withs && `with ${withs}`].filter(Boolean).join(' ');
  return main && guests ? `${main} ${guests}` : main || guests;
}

export function titleLine(song) {
  const { title, remix } = creditParts(song);
  return remix ? `${title} (${remix})` : title;
}

export function displayLine(song) {
  const artist = artistLine(song);
  const t = titleLine(song);
  if (!artist) return t;
  return t ? `${artist} - ${t}` : artist;
}

export function tooltipLine(song) {
  if (isStructured(song)) return displayLine(song);
  const artist = artistLine(song);
  return artist ? `${titleLine(song)} - ${artist}` : titleLine(song);
}

export function versionTooltip(song) {
  const { remix } = creditParts(song);
  if (!remix) return '';
  const year = isRemaster(song) ? null : versionYear(song);
  return year == null ? remix : `${remix} (${year})`;
}

export function titleNodes(song, titleClass = 'ttl', remixClass = 'rmx') {
  const { title, remix } = creditParts(song);
  const a = document.createElement('span');
  a.className = titleClass;
  a.textContent = title;
  if (!remix) return [a];
  const b = document.createElement('span');
  b.className = remixClass;
  b.textContent = `(${remix})`;
  const tip = versionTooltip(song);
  if (tip !== remix) b.title = tip;
  return [a, document.createTextNode(' '), b];
}

export const albumOf = (song) => text(Array.isArray(song?.albums) ? song.albums[0] : song?.album);

export function releasedYear(song) {
  if (Number.isInteger(song?.releaseYear)) return song.releaseYear;
  return song?.year ?? null;
}

const isRemaster = (song) => text(song?.version?.type).toLowerCase() === 'remaster';

export function versionYear(song) {
  const y = song?.version?.releaseYear ?? song?.version?.year ?? song?.remix_year;
  return Number.isInteger(y) ? y : null;
}

const original = (song) => (Number.isInteger(releasedYear(song)) ? releasedYear(song) : null);

export const displayYear = (song) => (isRemaster(song) ? original(song) : versionYear(song) ?? original(song));

export function yearText(song) {
  const y = displayYear(song);
  return y == null ? '' : String(y);
}

export function yearFact(song) {
  const o = original(song);
  if (isRemaster(song)) return o == null ? '' : String(o);
  const v = versionYear(song);
  if (v == null) return o == null ? '' : String(o);
  return o != null && o !== v ? `${v} · original ${o}` : String(v);
}

export function subtitle(song) {
  return [artistLine(song), yearText(song)].filter(Boolean).join(' · ');
}

const KIND_LABEL = (k) => (k ? k[0].toUpperCase() + k.slice(1) : '');

export function detailsLines(song) {
  const out = [];
  const v = song?.version;
  if (isStructured(song) && v && typeof v === 'object') {
    const add = (label, value) => { if (value) out.push({ label, value }); };
    add('Version', KIND_LABEL(text(v.type).toLowerCase()));
    add('Version name', text(v.name));
    add('Remix by', joinNames(v.artists));
    add('Remix year', Number.isInteger(v.releaseYear) ? String(v.releaseYear) : '');
    const kind = text(v.type).toLowerCase();
    add(kind === 'mashup' ? 'Mashup of' : 'Cover of', ofNames(v.originalArtists).join(', '));
  }
  const year = releasedYear(song);
  if (Number.isInteger(year)) out.push({ label: 'First released', value: String(year) });
  return out;
}

export function sortKey(song, key) {
  const t = text(song?.title).toLocaleLowerCase();
  if (key !== 'artist') return [t];
  const a = isStructured(song) ? text(song.mainArtists?.[0]) : text(song?.artist);
  return [a.toLocaleLowerCase(), t];
}

export function compareKeys(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const c = String(a[i] ?? '').localeCompare(String(b[i] ?? ''), undefined, { sensitivity: 'base' });
    if (c) return c;
  }
  return 0;
}

export function searchText(song, extra = []) {
  const v = song?.version;
  const parts = isStructured(song)
    ? [song.title, ...names(song.mainArtists), ...names(song.featuredArtists), ...names(song.withArtists), v?.name, ...names(v?.artists), ...ofNames(v?.originalArtists), ...names(song.albums)]
    : [song?.title, song?.artist, song?.album, song?.remixer];
  return [...parts, ...extra].join('\n').toLocaleLowerCase();
}
