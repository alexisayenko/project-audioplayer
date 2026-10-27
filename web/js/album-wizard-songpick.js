import { api } from './api.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { artistLine, titleLine } from './credits.js';
import { searchSongs, usedFor } from './album-wizard-songlink.js';

let serial = 0;

function thumb(song) {
  const img = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (song.cover) img.src = api.coverUrl(song.id, song.cover_v);
  img.addEventListener('error', () => img.removeAttribute('src'));
  return el('span', { class: 'row-cover' }, el('span', { class: 'cover-mark', 'aria-hidden': 'true' }, icon('coverPlaceholder')), img);
}

export function songPicker({ draft, rowKey, name, onPick, onClose }) {
  const id = `wiz-songpick-${++serial}`;
  const input = el('input', {
    type: 'search', class: 'wiz-songpick-input', autocomplete: 'off', placeholder: 'Search your library', 'aria-label': `Library song for ${name}`,
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': `${id}-list`, 'aria-autocomplete': 'list',
  });
  const list = el('ul', { class: 'wiz-songpick-list', id: `${id}-list`, role: 'listbox', 'aria-label': 'Songs in your library' });
  const status = el('p', { class: 't-caption muted wiz-songpick-status', role: 'status' });
  const close = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Cancel');
  const node = el('div', { class: 'wiz-songpick' }, input, status, list, close);
  let shown = [];
  let active = -1;

  const setActive = (i) => {
    active = shown.length ? (i + shown.length) % shown.length : -1;
    [...list.children].forEach((li, n) => li.setAttribute('aria-selected', String(n === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView?.({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  function paint() {
    if (!store.loaded) { status.textContent = 'Loading your library...'; list.replaceChildren(); shown = []; return; }
    shown = searchSongs(store.songs, input.value);
    status.textContent = shown.length ? '' : (store.songs.length ? 'No song matches.' : 'Your library has no songs yet.');
    list.replaceChildren(...shown.map((s, n) => {
      const used = usedFor(draft, s.id, rowKey);
      const li = el('li', { class: 'wiz-songpick-item', role: 'option', id: `${id}-o${n}`, 'aria-selected': 'false', 'data-song': s.id },
        thumb(s),
        el('span', { class: 'wiz-songpick-text' },
          el('span', { class: 't-body wiz-songpick-title' }, titleLine(s)),
          el('span', { class: 't-caption muted wiz-songpick-artist' }, artistLine(s))),
        used ? el('span', { class: 't-caption muted wiz-songpick-used' }, `used for track ${used}`) : null);
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => onPick(s));
      return li;
    }));
    setActive(shown.length ? 0 : -1);
  }

  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (shown[active]) onPick(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  });
  close.addEventListener('click', onClose);

  paint();
  if (!store.loaded) store.refresh().then(paint, () => { status.textContent = 'The library could not be loaded.'; });
  return { node, focus: () => input.focus() };
}
