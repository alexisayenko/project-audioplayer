import { creditParts, releasedYear, versionYear, albumsOf, isStructured } from './credits.js';

const text = (v) => String(v ?? '').trim();
const FEAT = /\s+(?:feat\.?|ft\.?|featuring|with)\s+|\s+(?:and|&)\s+|\s*,\s*|\s+x\s+/gi;

function pushList(out, list, ownerKind) {
  list.forEach((name, i) => {
    if (i) out.push({ kind: 'text', text: i === list.length - 1 ? ' & ' : ', ' });
    out.push({ kind: ownerKind, text: name, name });
  });
}

function structuredArtists(song) {
  const { artists, featured, withArtists } = creditParts(song);
  const out = [];
  pushList(out, artists, 'artist');
  const guests = [];
  if (featured.length) guests.push({ lead: 'feat. ', list: featured });
  if (withArtists?.length) guests.push({ lead: 'with ', list: withArtists });
  guests.forEach((g) => {
    if (out.length) out.push({ kind: 'text', text: ' ' });
    out.push({ kind: 'text', text: g.lead });
    pushList(out, g.list, 'artist');
  });
  return out;
}

function legacyArtists(song) {
  const raw = text(song?.artist);
  const out = [];
  let last = 0;
  for (const m of raw.matchAll(FEAT)) {
    if (m.index > last) out.push({ kind: 'artist', text: raw.slice(last, m.index), name: raw.slice(last, m.index) });
    out.push({ kind: 'text', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < raw.length) out.push({ kind: 'artist', text: raw.slice(last), name: raw.slice(last) });
  return out.filter((p) => p.kind === 'text' || p.text.trim());
}

export function lineParts(song) {
  const { title, remix } = creditParts(song);
  const out = isStructured(song) ? structuredArtists(song) : legacyArtists(song);
  if (out.length && (title || remix)) out.push({ kind: 'text', text: ' - ' });
  if (title) out.push({ kind: 'title', text: title });
  if (remix) {
    if (title) out.push({ kind: 'text', text: ' ' });
    out.push({ kind: 'text', text: '(' }, { kind: 'version', text: remix }, { kind: 'text', text: ')' });
  }
  return out;
}

const genresOf = (song) => {
  if (Array.isArray(song?.genres)) return song.genres.map(text).filter(Boolean);
  return (song?.tags || []).filter((t) => /^genre:/i.test(t)).map((t) => text(t.slice(6))).filter(Boolean);
};

const yearOf = (y) => (Number.isInteger(y) ? String(y) : '');

export function titleInfo(song) {
  return { year: yearOf(releasedYear(song)), albums: albumsOf(song), genres: genresOf(song) };
}

export function versionInfo(song) {
  return { year: yearOf(versionYear(song) ?? releasedYear(song)), albums: albumsOf(song), genres: genresOf(song) };
}

export function artistInfoStub(name) {
  return { name, country: 'Germany', genres: ['electronic', 'house', 'synthpop'], years: '2002-2014' };
}

export function infoRows(kind, info) {
  const rows = [];
  const add = (label, value) => { if (value && value.length) rows.push({ label, value }); };
  if (kind === 'artist') {
    add('Country', info.country);
    add('Genres', info.genres);
    add('Years of activity', info.years);
  } else {
    add('Year of release', info.year);
    add(info.albums.length === 1 ? 'Album' : 'Albums', info.albums.join(', '));
    add('Genres', info.genres);
  }
  return rows;
}

export function partInfo(song, part) {
  if (part.kind === 'artist') return { heading: part.name, rows: infoRows('artist', artistInfoStub(part.name)), filter: part.name };
  if (part.kind === 'version') return { heading: part.text, rows: infoRows('version', versionInfo(song)) };
  return { heading: part.text, rows: infoRows('title', titleInfo(song)) };
}
