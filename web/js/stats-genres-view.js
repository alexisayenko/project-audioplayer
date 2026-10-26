import { el } from './dom.js';
import { icon } from './icons.js';
import {
  GENRE_COLUMNS, EMPTY_GENRES, MULTI_NOTE, genreRows, totalsOf, sortGenres, filterGenres, nextSort, formatListened, formatPlays,
} from './stats-genres.js';

export function renderGenres(songs, listening, { sort, query, onSort, onOpen }) {
  const withListening = !!listening;
  const cols = GENRE_COLUMNS.filter((c) => withListening || !c.listening);
  const all = genreRows(songs, listening);
  const rows = sortGenres(filterGenres(all, query), sort);
  const num = (c) => (c.key === 'genre' ? '' : ' st-num');
  const edge = (c) => (c.listening && c.key === 'listened' ? ' st-edge' : '');

  const head = el('tr', {}, cols.map((c) => {
    const on = sort.key === c.key;
    const asc = sort.dir > 0;
    const arrow = el('span', { class: 'st-sort', 'aria-hidden': 'true' }, icon(asc ? 'chevronUp' : 'chevron', 14));
    return el('th', { scope: 'col', class: `${num(c)}${edge(c)}`.trim(), 'aria-sort': on ? (asc ? 'ascending' : 'descending') : 'none' },
      el('button', { class: 'st-th', type: 'button', onclick: () => onSort(nextSort(sort, c.key)) }, c.label, on ? arrow : null));
  }));

  const textOf = (c, r) => {
    if (c.key === 'songs') return String(r.songs);
    return c.key === 'listened' ? formatListened(r.listened) : formatPlays(r.plays);
  };

  const cell = (c, r) => {
    if (c.key === 'genre') return el('td', {}, el('button', { class: 'st-open', type: 'button', title: `View ${r.label} in Library`, onclick: () => onOpen(r) }, r.label));
    const text = textOf(c, r);
    return el('td', { class: `${num(c)}${edge(c)}`.trim() }, text);
  };

  const t = totalsOf(songs, listening);
  const foot = el('tr', { class: 'st-total' }, cols.map((c) => {
    if (c.key === 'genre') return el('th', { scope: 'row' }, 'All songs');
    const text = c.key === 'songs' ? String(t.songs) : (c.key === 'listened' ? formatListened(t.listened) : formatPlays(t.plays));
    return el('td', { class: `${num(c)}${edge(c)}`.trim() }, text);
  }));

  const body = all.length
    ? el('div', { class: 'st-gscroll' },
      el('table', { class: 'st-table st-gtable t-caption' }, el('caption', { class: 'st-sr' }, 'Genres in the library'),
        el('thead', {}, head),
        el('tbody', {}, rows.map((r) => el('tr', { 'data-genre': r.key }, cols.map((c) => cell(c, r))))),
        el('tfoot', {}, foot)),
      rows.length ? null : el('p', { class: 'muted t-caption st-gnone' }, 'No genres match.'))
    : el('p', { class: 'st-empty-inline t-subhead muted' }, EMPTY_GENRES);

  return {
    empty: !all.length,
    node: el('div', { class: 'st-gwrap' }, body, all.length ? el('p', { class: 'muted t-caption st-gnote' }, MULTI_NOTE) : null),
  };
}
