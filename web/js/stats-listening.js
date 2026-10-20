import { el, plural } from './dom.js';
import { titleNodes, artistLine } from './credits.js';

export const TOP_N = 10;
export const EMPTY_LISTENING = 'No listening data yet.';

export function formatHm(seconds) {
  const mins = Math.round((seconds || 0) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function top(data, songs, valueOf) {
  const byId = new Map(songs.map((s) => [s.id, s]));
  return Object.entries(data?.songs || {})
    .map(([id, e]) => ({ song: byId.get(id), value: valueOf(e) || 0 }))
    .filter((r) => r.song && r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);
}

export const topListened = (data, songs) => top(data, songs, (e) => e.total_listened_s);
export const topSkipped = (data, songs) => top(data, songs, (e) => e.skipped?.all);

export const hasListeningData = (data, songs) => topListened(data, songs).length > 0 || topSkipped(data, songs).length > 0;

function block(title, rows, label, onOpen) {
  const max = rows[0]?.value || 1;
  return el('section', { class: 'st-lis-block' },
    el('h2', { class: 't-headline' }, title),
    rows.length
      ? el('ol', { class: 'st-lis-list' }, rows.map((r) => el('li', { class: 'st-lis-row t-subhead' },
        el('button', { class: 'st-open', type: 'button', onclick: () => onOpen(r.song) },
          el('b', {}, titleNodes(r.song)), ' ', el('span', { class: 'muted' }, artistLine(r.song))),
        el('span', { class: 'st-lis-bar', 'aria-hidden': 'true' }, el('i', { style: `width: ${Math.max(2, (r.value / max) * 100)}%` })),
        el('span', { class: 'st-lis-val t-caption' }, label(r.value)))))
      : el('p', { class: 'muted t-subhead' }, EMPTY_LISTENING));
}

export function renderListening(data, songs, onOpen) {
  if (!hasListeningData(data, songs)) return el('p', { class: 'st-empty-inline t-subhead muted' }, EMPTY_LISTENING);
  return el('div', { class: 'st-lis' },
    block('Most listened', topListened(data, songs), formatHm, onOpen),
    block('Most skipped', topSkipped(data, songs), (n) => `${n} ${plural(n, 'skip', 'skips')}`, onOpen));
}
