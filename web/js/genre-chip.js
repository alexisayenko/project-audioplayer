import { el } from './dom.js';
import { openGenreCard } from './lazy-ui.js';
import { cachedTree } from './genre-tree.js';
import { resolveNode } from './genre-levels.js';

export function genreChip(g) {
  if (!resolveNode(g, cachedTree())) return el('span', { class: 'tag ns t-caption', title: `genre:${g}` }, g);
  const chip = el('button', { class: 'tag ns t-caption genre-chip-btn', type: 'button', title: `Open the genre card: ${g}`, 'data-genre': g, onclick: () => openGenreCard(g, chip) }, g);
  return chip;
}
