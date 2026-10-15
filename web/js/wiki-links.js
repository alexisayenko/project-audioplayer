import { el } from './dom.js';

const WP = /^https:\/\/(?:[a-z0-9-]+\.)+wikipedia\.org\/wiki\/\S+$/i;
const WD = /^https:\/\/(?:www\.|m\.)?wikidata\.org\/wiki\/Q[1-9]\d*$/i;

export const isWikiLink = (v) => WP.test(v) || WD.test(v);

const HTTPS = /^https:\/\//i;

export function wikiTarget(song) {
  const ok = (v) => typeof v === 'string' && HTTPS.test(v);
  if (ok(song?.wikipedia_song)) return { href: song.wikipedia_song, label: 'Song on Wikipedia' };
  if (ok(song?.wikipedia_album)) return { href: song.wikipedia_album, label: 'Album on Wikipedia' };
  if (ok(song?.wikipedia_artist)) return { href: song.wikipedia_artist, label: 'Artist on Wikipedia' };
  return null;
}

const EN = /^https?:\/\/(?:m\.en|en(?:\.m)?)\.wikipedia\.org\/wiki\/([^?#\s]+)(?:[?#].*)?$/i;
const PREFIX = 'https://en.wikipedia.org/wiki/';

export function wikiDisplay(url) {
  const v = String(url ?? '').trim();
  const m = EN.exec(v);
  if (!m) return v;
  let t = m[1];
  try { t = decodeURIComponent(t); } catch { /* keep escapes */ }
  return t.replaceAll('_', ' ');
}

export function wikiNormalize(text) {
  const v = String(text ?? '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const enc = encodeURIComponent(v.replace(/\s+/g, '_')).replace(/%3A/gi, ':').replace(/%2C/gi, ',').replace(/%2F/gi, '/');
  return PREFIX + enc;
}

export function wikiFields({ song = '', artist = '', album = '' }) {
  const make = (initial, label) => {
    let full = String(initial || '').trim();
    const inp = el('input', { type: 'text', value: wikiDisplay(full), placeholder: 'Article name or link', 'aria-label': label, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const mark = () => inp.setAttribute('aria-invalid', String(!!full && !isWikiLink(full)));
    const render = () => { inp.value = wikiDisplay(full); };
    inp.addEventListener('input', () => { full = wikiNormalize(inp.value); mark(); });
    inp.addEventListener('blur', render);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') render(); });
    mark();
    return { inp, get: () => full, set: (u) => { full = String(u || '').trim(); render(); mark(); } };
  };
  const fields = { song: make(song, 'Wikipedia article or link of the song'), artist: make(artist, 'Wikipedia article or link of the band'), album: make(album, 'Wikipedia article or link of the album') };
  const field = (label, f) => el('div', {}, el('label', {}, label), f.inp);
  return {
    node: el('div', { class: 'wiki-fields' },
      el('div', { class: 'grid2' }, field('Wikipedia: song', fields.song), field('Wikipedia: band', fields.artist)),
      el('div', {}, field('Wikipedia: album', fields.album))),
    fields,
    values: () => ({ wikipedia_song: fields.song.get() || null, wikipedia_artist: fields.artist.get() || null, wikipedia_album: fields.album.get() || null }),
    set: ({ song: s, artist: a, album: b }) => {
      if (s !== undefined) fields.song.set(s);
      if (a !== undefined) fields.artist.set(a);
      if (b !== undefined) fields.album.set(b);
    },
  };
}
