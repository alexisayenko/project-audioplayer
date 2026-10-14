import { el } from './dom.js';
import { displayString, titleNodes } from './display-title.js';
import { decadeOf } from './stats-data.js';

export const COLUMNS = [
  ['title', 'Title'], ['artist', 'Artist'], ['year', 'Year'], ['bpm', 'BPM'], ['decade', 'Decade'], ['family', 'Family'],
];

const NUMERIC = new Set(['year', 'bpm', 'decade']);

export function rowValue(song, key, familyOf) {
  if (key === 'title') return displayString(song);
  if (key === 'decade') return decadeOf(song.year);
  if (key === 'family') return familyOf?.(song) ?? '';
  return song[key] ?? '';
}

export function sortRows(songs, key, dir = 1, familyOf) {
  const num = NUMERIC.has(key);
  const cmp = (a, b) => {
    const x = rowValue(a, key, familyOf);
    const y = rowValue(b, key, familyOf);
    return num ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' });
  };
  return [...songs].sort((a, b) => dir * cmp(a, b) || String(a.title).localeCompare(String(b.title)));
}

export const decadeLabel = (song) => `${decadeOf(song.year)}s`;

export function renderTable(songs, { sort, onSort, onOpen, familyOf }) {
  const head = el('tr', {}, COLUMNS.map(([key, label]) => {
    const on = sort.key === key;
    const asc = sort.dir > 0;
    const ariaSort = asc ? 'ascending' : 'descending';
    const arrow = asc ? ' ▲' : ' ▼';
    return el('th', { scope: 'col', 'aria-sort': on ? ariaSort : 'none' },
      el('button', { class: 'st-th', type: 'button', onclick: () => onSort(key) }, label, on ? arrow : ''));
  }));
  const rows = sortRows(songs, sort.key, sort.dir, familyOf).map((s) => {
    const open = el('button', { class: 'st-open', type: 'button', onclick: () => onOpen(s) }, titleNodes(s));
    return el('tr', { 'data-id': s.id }, el('td', {}, open), el('td', {}, s.artist || ''), el('td', {}, String(s.year)),
      el('td', {}, String(s.bpm)), el('td', {}, decadeLabel(s)), el('td', {}, familyOf?.(s) ?? ''));
  });
  return el('table', { class: 'st-table t-caption' }, el('caption', { class: 'st-sr' }, 'Plotted songs'),
    el('thead', {}, head), el('tbody', {}, rows));
}
