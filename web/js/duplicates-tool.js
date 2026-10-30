import { store } from './store.js';
import { player } from './player.js';
import { el, fmtTime, plural } from './dom.js';
import { icon } from './icons.js';
import { hasAudio } from './playable.js';
import { artistLine, albumOf, titleLine } from './credits.js';
import { can } from './guest.js';
import { editDialog } from './edit-dialog.js';
import { DEFAULT_TOLERANCE, MAX_TOLERANCE, clampTolerance, findDuplicates, summary } from './duplicates.js';

function songItem(s) {
  const audio = hasAudio(s);
  const meta = [artistLine(s), albumOf(s), fmtTime(s.duration), audio ? 'On server' : 'No audio'].filter(Boolean).join(' · ');
  const name = titleLine(s);
  return el('li', { class: 'dup-song', 'data-id': s.id },
    el('div', { class: 'info' },
      el('div', { class: 't-subhead dup-title' }, name),
      el('div', { class: 'muted t-caption' }, meta)),
    el('button', { class: 'icon', type: 'button', title: 'Play', 'aria-label': `Play: ${name}`, disabled: !audio, onclick: () => player.playNow(s.id) }, icon('play', 'inline')),
    can('edit') ? el('button', { class: 'icon', type: 'button', title: 'Edit', 'aria-label': `Edit: ${name}`, onclick: () => editDialog(s) }, icon('pencil', 'inline')) : null);
}

export function duplicatesCard() {
  const toggle = el('button', { class: 'btn outline small', type: 'button', 'aria-expanded': 'false' }, 'Find duplicates');
  const tol = el('input', { type: 'number', id: 'dup-tolerance', min: '0', max: String(MAX_TOLERANCE), step: '1', value: String(DEFAULT_TOLERANCE), inputmode: 'numeric' });
  const title = el('input', { type: 'checkbox', id: 'dup-title', checked: true });
  const total = el('p', { class: 'muted t-caption', role: 'status', 'aria-live': 'polite' }, '');
  const list = el('div', { class: 'dup-groups' });
  const panel = el('div', { class: 'dup-panel', hidden: true },
    el('label', { class: 'switch-row', for: 'dup-tolerance' },
      el('span', { class: 't-subhead set-text' }, 'Length tolerance (seconds)'), tol),
    el('label', { class: 'switch-row', for: 'dup-title' },
      el('span', { class: 't-subhead set-text' }, 'Also match by title'), title),
    total, list);
  const card = el('div', { class: 'bulk-row', role: 'group', 'aria-label': 'Find duplicates' },
    el('div', { class: 'cell' },
      el('span', { class: 'muted t-caption bulk-lead' }, 'Songs of about the same length'),
      el('div', { class: 'bulk-actions' }, toggle)),
    panel);

  const run = () => {
    const groups = findDuplicates(store.songs, { tolerance: clampTolerance(tol.value), byTitle: title.checked });
    const { groups: g, songs: n } = summary(groups);
    total.textContent = g ? `${g} ${plural(g, 'group', 'groups')}, ${n} ${plural(n, 'song', 'songs')}` : 'No duplicates found';
    list.replaceChildren(...groups.map((grp) => el('section', { class: 'dup-group' },
      el('h3', { class: 't-caption muted' }, `${grp.length} songs, about ${fmtTime(grp[0].duration)}`),
      el('ul', { class: 'dup-list' }, grp.map(songItem)))));
  };

  let unsub = null;
  const sync = () => {
    if (!card.isConnected) { unsub?.(); unsub = null; return; }
    if (!panel.hidden) run();
  };
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) { run(); unsub ||= store.subscribe(sync); }
  });
  tol.addEventListener('input', run);
  title.addEventListener('change', run);
  return card;
}
