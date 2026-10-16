import { splitTokens } from './tokens.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const text = (v) => String(v ?? '').trim();
const names = (list) => (Array.isArray(list) ? list.map(text).filter(Boolean) : []);

export const KINDS = ['remix', 'live', 'acoustic', 'extended', 'instrumental', 'remaster', 'edit', 'cover', 'mashup', 'other'];

export const ofNames = (v) => (Array.isArray(v) ? names(v) : text(v) ? [text(v)] : []);

export const isStructured = (song) => Array.isArray(song?.artists);

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

function versionLabel(song, title) {
  const v = song?.version;
  if (!v || typeof v !== 'object') return '';
  const seen = norm(title);
  const name = text(v.name);
  if (name) return splitTokens(name).filter((p) => !hidden(seen, p)).join(', ');
  const kind = text(v.kind).toLowerCase();
  if (!kind || kind === 'other' || hidden(seen, kind)) return '';
  return kind;
}

export function creditParts(song) {
  const title = String(song?.title ?? '');
  if (!isStructured(song)) {
    const seen = norm(title);
    const remix = splitTokens(song?.remixer ?? '').filter((p) => !hidden(seen, p)).join(', ');
    return { title, remix, artists: [], featured: [], version: null, structured: false };
  }
  const version = song.version && typeof song.version === 'object' ? song.version : null;
  return { title, remix: versionLabel(song, title), artists: names(song.artists), featured: names(song.featured), version, structured: true };
}

export function artistLine(song) {
  if (!isStructured(song)) return text(song?.artist);
  const main = joinNames(song.artists);
  const feat = joinNames(song.featured);
  if (!feat) return main;
  return main ? `${main} feat. ${feat}` : `feat. ${feat}`;
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
  const { remix, version, structured } = creditParts(song);
  if (!remix) return '';
  const year = structured ? version?.year : song?.remix_year;
  return Number.isInteger(year) ? `${remix} (${year})` : remix;
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

export function releasedYear(song) {
  if (Number.isInteger(song?.released)) return song.released;
  return song?.year ?? null;
}

export function versionYear(song) {
  const y = song?.version?.year ?? song?.remix_year;
  return Number.isInteger(y) ? y : null;
}

export const displayYear = (song) => versionYear(song) ?? (Number.isInteger(releasedYear(song)) ? releasedYear(song) : null);

export function yearFact(song) {
  const v = versionYear(song);
  if (v == null) return '';
  const o = releasedYear(song);
  return Number.isInteger(o) && o !== v ? `${v} · original ${o}` : String(v);
}

export function subtitle(song) {
  const year = String(displayYear(song) ?? '').trim();
  return [artistLine(song), year].filter(Boolean).join(' · ');
}

const KIND_LABEL = (k) => (k ? k[0].toUpperCase() + k.slice(1) : '');

export function detailsLines(song) {
  const out = [];
  const v = song?.version;
  if (isStructured(song) && v && typeof v === 'object') {
    const add = (label, value) => { if (value) out.push({ label, value }); };
    add('Version', KIND_LABEL(text(v.kind).toLowerCase()));
    add('Version name', text(v.name));
    add('Remixed / mixed by', joinNames(v.by));
    add('Version year', Number.isInteger(v.year) ? String(v.year) : '');
    const kind = text(v.kind).toLowerCase();
    add(kind === 'mashup' ? 'Mashup of' : 'Cover of', ofNames(v.of).join(', '));
  }
  const year = releasedYear(song);
  if (Number.isInteger(year)) out.push({ label: 'First released', value: String(year) });
  return out;
}

export function sortKey(song, key) {
  const t = text(song?.title).toLocaleLowerCase();
  if (key !== 'artist') return [t];
  const a = isStructured(song) ? text(song.artists?.[0]) : text(song?.artist);
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
    ? [song.title, ...names(song.artists), ...names(song.featured), v?.name, ...names(v?.by), ...ofNames(v?.of), song.album]
    : [song?.title, song?.artist, song?.album, song?.remixer];
  return [...parts, ...extra].join('\n').toLocaleLowerCase();
}
