import { el } from './dom.js';

export function renderPlaylists(root) {
  root.append(
    el('header', { class: 'page-head' },
      el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
      el('h1', { class: 't-display' }, 'Playlists')),
    el('div', { class: 'state card' }, el('p', { class: 'muted t-subhead' }, 'Playlists are coming soon.')));
}
