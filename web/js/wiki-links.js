import { el } from './dom.js';

const WP = /^https:\/\/(?:[a-z0-9-]+\.)+wikipedia\.org\/wiki\/\S+$/i;
const WD = /^https:\/\/(?:www\.|m\.)?wikidata\.org\/wiki\/Q[1-9]\d*$/i;

export const isWikiLink = (v) => WP.test(v) || WD.test(v);

export function songLinks(song) {
  const rows = [
    ['Source', song.source_url, /^https?:\/\//i],
    ['Wikipedia (song)', song.wikipedia_song, /^https:\/\//i],
    ['Wikipedia (band)', song.wikipedia_artist, /^https:\/\//i],
  ];
  return rows.filter(([, href, ok]) => typeof href === 'string' && ok.test(href)).map(([label, href]) => ({ label, href }));
}

export function wikiFields({ song = '', artist = '' }) {
  const input = (value, label) => el('input', { type: 'url', value: value || '', placeholder: 'https://en.wikipedia.org/wiki/...', 'aria-label': label, autocomplete: 'off', inputMode: 'url' });
  const fields = { song: input(song, 'Wikipedia link of the song'), artist: input(artist, 'Wikipedia link of the band') };
  const mark = (inp) => {
    const v = inp.value.trim();
    inp.setAttribute('aria-invalid', String(!!v && !isWikiLink(v)));
  };
  for (const inp of Object.values(fields)) inp.addEventListener('input', () => mark(inp));
  const field = (label, inp) => el('div', {}, el('label', {}, label), inp);
  return {
    node: el('div', { class: 'wiki-fields' },
      el('div', { class: 'grid2' }, field('Wikipedia: song', fields.song), field('Wikipedia: band', fields.artist))),
    values: () => ({ wikipedia_song: fields.song.value.trim() || null, wikipedia_artist: fields.artist.value.trim() || null }),
  };
}
