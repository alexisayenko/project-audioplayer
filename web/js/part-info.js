import { creditParts, releasedYear, versionYear, albumsOf, isStructured } from './credits.js';

const text = (v) => String(v ?? '').trim();
const FEAT_WORD = /(?:feat\.?|ft\.?|featuring|with|and|&|x)\s+/iy;

function skipSpace(s, from) {
  let i = from;
  while (i < s.length && /\s/.test(s[i])) i += 1;
  return i;
}

function featSeparators(raw) {
  const found = [];
  let i = 0;
  while (i < raw.length) {
    const word = skipSpace(raw, i);
    let end = -1;
    if (raw[word] === ',') {
      end = skipSpace(raw, word + 1);
    } else if (word > i) {
      FEAT_WORD.lastIndex = word;
      const m = FEAT_WORD.exec(raw);
      if (m) end = word + m[0].length;
    }
    if (end >= 0) {
      found.push({ index: i, text: raw.slice(i, end) });
      i = end;
    } else {
      i = word + 1;
    }
  }
  return found;
}

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
  for (const sep of featSeparators(raw)) {
    if (sep.index > last) out.push({ kind: 'artist', text: raw.slice(last, sep.index), name: raw.slice(last, sep.index) });
    out.push({ kind: 'text', text: sep.text });
    last = sep.index + sep.text.length;
  }
  if (last < raw.length) out.push({ kind: 'artist', text: raw.slice(last), name: raw.slice(last) });
  return out.filter((p) => p.kind === 'text' || p.text.trim());
}

export function lineParts(song) {
  const { title, remix, version } = creditParts(song);
  const plain = remix && (String(version?.type).toLowerCase() === 'remaster' || /remaster/i.test(remix));
  const out = isStructured(song) ? structuredArtists(song) : legacyArtists(song);
  if (out.length && (title || remix)) out.push({ kind: 'text', text: ' - ' });
  if (title) out.push({ kind: 'title', text: title });
  if (remix) {
    if (title) out.push({ kind: 'text', text: ' ' });
    if (plain) out.push({ kind: 'text', text: `(${remix})` });
    else out.push({ kind: 'text', text: '(' }, { kind: 'version', text: remix }, { kind: 'text', text: ')' });
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
  const add = (label, value) => { if (value?.length) rows.push({ label, value }); };
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
  return { heading: part.text, rows: infoRows('title', titleInfo(song)), filter: part.text };
}
