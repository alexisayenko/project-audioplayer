import { api } from './api.js';
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

export function lookupSummary(found, appliedYear) {
  const parts = [];
  if (appliedYear) parts.push(`year ${appliedYear}`);
  const n = (found.tags || []).length;
  if (n) parts.push(`${n} suggested ${n === 1 ? 'tag' : 'tags'}`);
  return parts.length ? `Found: ${parts.join(', ')}.` : 'Nothing found for these links.';
}

export function wikiFields({ song = '', artist = '', year, editor, onMessage }) {
  const input = (value, label) => el('input', { type: 'url', value: value || '', placeholder: 'https://en.wikipedia.org/wiki/...', 'aria-label': label, autocomplete: 'off', inputMode: 'url' });
  const fields = { song: input(song, 'Wikipedia link of the song'), artist: input(artist, 'Wikipedia link of the band') };
  const mark = (inp) => {
    const v = inp.value.trim();
    inp.setAttribute('aria-invalid', String(!!v && !isWikiLink(v)));
  };
  for (const inp of Object.values(fields)) inp.addEventListener('input', () => mark(inp));
  const button = el('button', { type: 'button', class: 'btn' }, 'Fill from Wikipedia links');
  button.addEventListener('click', async () => {
    const body = { wikipedia_song: fields.song.value.trim() || null, wikipedia_artist: fields.artist.value.trim() || null };
    if (!body.wikipedia_song && !body.wikipedia_artist) { onMessage('Add a Wikipedia link first.', 'error'); return; }
    button.disabled = true;
    button.textContent = 'Looking up...';
    try {
      const found = await api.lookupWikipedia(body);
      let applied = null;
      if (found.year != null) {
        const current = year.value === '' ? null : Number(year.value);
        if (current == null || (current !== found.year && window.confirm(`Replace year ${current} with ${found.year}?`))) {
          year.value = found.year;
          year.dispatchEvent(new Event('input'));
          applied = found.year;
        }
      }
      editor.setSuggested(found.tags || []);
      onMessage(lookupSummary(found, applied), 'ok');
    } catch (ex) {
      onMessage(ex.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Fill from Wikipedia links';
    }
  });
  const field = (label, inp) => el('div', {}, el('label', {}, label), inp);
  return {
    node: el('div', { class: 'wiki-fields' },
      el('div', { class: 'grid2' }, field('Wikipedia: song', fields.song), field('Wikipedia: band', fields.artist)),
      el('div', { class: 'row' }, button)),
    values: () => ({ wikipedia_song: fields.song.value.trim() || null, wikipedia_artist: fields.artist.value.trim() || null }),
  };
}
