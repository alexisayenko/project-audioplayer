import { el, field } from './dom.js';
import { tokenGroup } from './token-field.js';
import { splitTokens } from './tokens.js';
import { linksPanel } from './links-panel.js';
import { ALBUM_TYPES as TYPES, normalType } from './album-video-model.js';

export { TYPES, normalType };

export const LINK_ROWS = [
  { key: 'youtube', kind: 'youtube', label: 'YouTube link' },
  { key: 'wikipedia', kind: 'wikipedia', label: 'Wikipedia: album' },
  { key: 'discogs', kind: 'discogs', label: 'Discogs link' },
  { key: 'rateyourmusic', kind: 'rateyourmusic', label: 'Rate Your Music link' },
];

const httpUrl = (v) => (/^https?:\/\/\S+$/i.test(v || '') ? v : null);

export const artistText = (value) => splitTokens(value).join(' & ');

export function albumLinksPanel(initial = {}, id = 'album-links') {
  const inputs = {};
  for (const r of LINK_ROWS) {
    inputs[r.key] = el('input', { type: 'text', value: initial[r.key] || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-key': r.key });
  }
  const panel = linksPanel({ inputs, rows: LINK_ROWS, id });
  const have = {};
  const get = () => Object.fromEntries(LINK_ROWS.map((r) => [r.key, inputs[r.key].value.trim()]));
  const paint = () => {
    const vals = get();
    const states = {};
    for (const r of LINK_ROWS) if (httpUrl(vals[r.key])) states[r.kind] = { on: true, url: vals[r.key] };
    panel.paint(vals, states);
  };
  for (const inp of Object.values(inputs)) inp.addEventListener('input', paint);
  paint();
  Object.assign(have, get());
  return { panel, inputs, get, have, paint, node: el('div', { class: 'album-links-panel' }, panel.bar, panel.clip) };
}

export function albumFields({ title = '', artist = '', year = '', type = 'album', genres, links = {}, linksId }) {
  const tg = tokenGroup();
  const titleF = tg.field('title', title);
  const artistsF = tg.field('artists', artist);
  titleF.setLabel('Album title');
  artistsF.setLabel('Album artists');
  const yearIn = el('input', { type: 'text', class: 'album-year', inputMode: 'numeric', autocomplete: 'off', 'aria-label': 'Year', maxLength: 4, size: 4, value: year ? String(year) : '' });
  const typeSel = el('select', { 'aria-label': 'Album type' }, ...TYPES.map(([k, label]) => el('option', { value: k, selected: k === normalType(type) }, label)));
  typeSel.value = normalType(type);
  const lk = albumLinksPanel(links, linksId);
  const node = el('div', { class: 'album-fields' },
    field('Album title', titleF),
    field('Album artists', artistsF),
    el('div', { class: 'album-yt-row2' }, field('Year', yearIn), field('Type', typeSel)),
    genres.node,
    lk.node);
  return {
    node, titleF, artistsF, yearIn, typeSel, links: lk,
    title: () => titleF.value.trim(),
    artist: () => artistText(artistsF.value),
    type: () => typeSel.value,
    year: () => yearIn.value.trim(),
  };
}
