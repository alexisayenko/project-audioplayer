import { el, fmtTime } from './dom.js';
import { displayLine, titleNodes, artistLine } from './credits.js';
import { formatTotal } from './listening-stats.js';

export const COLUMNS = [
  { key: 'song', label: 'Song', num: false },
  { key: 'length', label: 'Length', num: true },
  { key: 'listened', label: 'Times listened', num: true, first: true },
  { key: 'skipped', label: 'Times skipped', num: true },
  { key: 'total', label: 'Total listened', num: true },
];

export const formatLength = (seconds) => (Number(seconds) > 0 ? fmtTime(seconds) : '-');
export const formatCount = (n) => (n == null ? '-' : String(n));
export const formatListened = (s) => (s == null || !(Number(s) > 0) ? '-' : formatTotal(s));

export function tableRows(songs, data) {
  const entries = data?.songs || null;
  return songs.map((song) => {
    const e = entries ? entries[song.id] : undefined;
    const known = !!entries;
    return {
      song,
      label: displayLine(song),
      length: Number(song.duration) > 0 ? Number(song.duration) : 0,
      listened: known ? e?.listened?.all || 0 : null,
      skipped: known ? e?.skipped?.all || 0 : null,
      total: known ? e?.total_listened_s || 0 : null,
    };
  });
}

export function sortRows(rows, sort) {
  if (!sort) return rows;
  const { key, dir } = sort;
  const cmp = key === 'song'
    ? (a, b) => a.label.localeCompare(b.label)
    : (a, b) => (a[key] || 0) - (b[key] || 0);
  return rows.map((r, i) => [r, i]).sort((a, b) => dir * cmp(a[0], b[0]) || a[1] - b[1]).map(([r]) => r);
}

export function nextSort(sort, key) {
  const first = key === 'song' ? 1 : -1;
  if (!sort || sort.key !== key) return { key, dir: first };
  if (sort.dir === first) return { key, dir: -first };
  return null;
}

function cells(r, onOpen) {
  const artist = artistLine(r.song);
  return [
    el('td', { class: 'lt-song' },
      el('button', { class: 'lt-open', type: 'button', title: r.label, onclick: () => onOpen(r.song) },
        el('b', {}, titleNodes(r.song)), ' ', el('span', { class: 'muted' }, artist))),
    el('td', { class: 'lt-num' }, formatLength(r.length)),
    el('td', { class: 'lt-num lt-first' }, formatCount(r.listened)),
    el('td', { class: 'lt-num' }, formatCount(r.skipped)),
    el('td', { class: 'lt-num' }, formatListened(r.total)),
  ];
}

export function renderLibraryTable(songs, data, onOpen, state = { sort: null }) {
  const wrap = el('div', { class: 'lt-wrap' });
  const paint = () => {
    const head = el('tr', {}, COLUMNS.map((c) => {
      const active = state.sort?.key === c.key;
      return el('th', {
        scope: 'col',
        class: `${c.num ? 'lt-num' : ''}${c.first ? ' lt-first' : ''}`.trim(),
        'aria-sort': active ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none',
      }, el('button', { class: 'lt-th', type: 'button', onclick: () => { state.sort = nextSort(state.sort, c.key); paint(); } },
        c.label, active ? el('span', { class: 'lt-arrow', 'aria-hidden': 'true' }, state.sort.dir > 0 ? '▲' : '▼') : null));
    }));
    wrap.replaceChildren(el('table', { class: 'lt-table t-subhead' },
      el('thead', {}, head),
      el('tbody', {}, sortRows(tableRows(songs, data), state.sort).map((r) => el('tr', {}, cells(r, onOpen))))));
  };
  paint();
  return wrap;
}
