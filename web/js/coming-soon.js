import { el } from './dom.js';

export function renderComingSoon(root, title, text) {
  root.append(
    el('header', { class: 'page-head' },
      el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
      el('h1', { class: 't-display' }, title)),
    el('div', { class: 'state card' }, el('p', { class: 'muted t-subhead' }, text)));
}
