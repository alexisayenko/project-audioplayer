import { el, fmtTime, plural } from './dom.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { titleLine, subtitle } from './credits.js';
import { hasAudio } from './playable.js';
import { coverTile } from './library-rows.js';
import { searchBox } from './search-box.js';
import { songMatches } from './song-match.js';

const MAX_SHOWN = 100;
let serial = 0;

export function findText({ shown, total, held, capped }) {
  if (!total) return 'No songs match. Clear the search.';
  const already = held ? `${held} already in this playlist` : '';
  if (!shown) return already;
  const head = `${shown} ${plural(shown, 'song', 'songs')} found${capped ? ', first ones shown' : ''}`;
  return already ? `${head}, ${already}` : head;
}

export function addSongsPanel({ held, onAdd }) {
  const base = `pl-found-${++serial}`;
  let query = '';
  let found = [];
  let active = 0;

  const box = searchBox({
    placeholder: 'Add songs by title or artist',
    label: 'Add songs to this playlist',
    onChange: (text) => { query = text; active = 0; paint(); },
    onKeydown: (e) => keydown(e),
  });
  const input = box.input;
  const note = el('p', { class: 'pl-found-note muted t-subhead', role: 'status', 'aria-live': 'polite' });
  const list = el('ul', { class: 'pl-found-list', id: `${base}-list`, role: 'listbox', 'aria-label': 'Songs to add' });
  const panel = el('div', { class: 'group pl-found-panel', hidden: true }, note, list);
  const node = el('section', { class: 'pl-add', 'aria-label': 'Add songs', hidden: true }, box.node, panel);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');

  function foundMeta(s, audio) {
    if (!audio) return el('span', { class: 'pl-found-meta t-caption', title: 'Not downloaded yet' }, 'No audio');
    return s.duration ? el('span', { class: 'pl-found-meta t-time', title: 'Length' }, fmtTime(s.duration)) : null;
  }

  function row(s, i) {
    const full = titleLine(s);
    const sub = subtitle(s);
    const audio = hasAudio(s);
    const subLabel = sub ? `, ${sub}` : '';
    return el('li', {
      class: `pl-found${audio ? '' : ' no-audio'}${i === active ? ' active' : ''}`,
      id: `${base}-${i}`, role: 'option', 'aria-selected': String(i === active), 'data-id': s.id,
      'aria-label': `${full}${subLabel}${audio ? '' : ', no audio'}`,
    },
    coverTile(s),
    el('span', { class: 'pl-found-info' },
      el('span', { class: 'pl-found-title t-headline' }, full),
      sub ? el('span', { class: 'pl-found-sub muted t-subhead' }, sub) : null),
    foundMeta(s, audio),
    el('button', { class: 'icon pl-found-add', type: 'button', tabindex: -1, 'aria-hidden': 'true', title: 'Add to this playlist' }, icon('plus', 'inline')));
  }

  function mark(scroll = false) {
    const rows = [...list.children];
    rows.forEach((r, i) => {
      r.classList.toggle('active', i === active);
      r.setAttribute('aria-selected', String(i === active));
    });
    const cur = rows[active];
    if (cur) input.setAttribute('aria-activedescendant', cur.id); else input.removeAttribute('aria-activedescendant');
    if (scroll) cur?.scrollIntoView({ block: 'nearest' });
  }

  function paint() {
    const q = query.trim().toLocaleLowerCase();
    const open = !!q;
    panel.hidden = !open;
    input.setAttribute('aria-expanded', String(open && found.length > 0));
    if (!open) {
      found = [];
      list.replaceChildren();
      note.textContent = '';
      input.removeAttribute('aria-activedescendant');
      return;
    }
    const have = held();
    const matches = store.songs.filter((s) => songMatches(s, q));
    const fresh = matches.filter((s) => !have.has(s.id));
    found = fresh.slice(0, MAX_SHOWN);
    active = Math.min(active, Math.max(0, found.length - 1));
    note.textContent = findText({ shown: fresh.length, total: matches.length, held: matches.length - fresh.length, capped: fresh.length > found.length });
    list.replaceChildren(...found.map(row));
    list.hidden = !found.length;
    input.setAttribute('aria-expanded', String(found.length > 0));
    mark();
  }

  function keydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!found.length) return;
      e.preventDefault();
      active = Math.min(found.length - 1, Math.max(0, active + (e.key === 'ArrowDown' ? 1 : -1)));
      mark(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (found[active]) onAdd(found[active]);
    }
  }

  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li.pl-found');
    const song = li && found.find((s) => s.id === li.dataset.id);
    if (!song) return;
    active = Math.max(0, found.indexOf(song));
    onAdd(song);
    input.focus();
  });

  return { node, refresh: paint, input };
}
