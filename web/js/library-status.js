import { store } from './store.js';
import { startup } from './api.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { loadingNote } from './loading-note.js';
import { openAdd } from './lazy-ui.js';
import { can } from './guest.js';

export function paintStatus(status, { loadError, nothing, retry }) {
  if (loadError) {
    status.replaceChildren(el('div', { class: 'state card' },
      el('p', { class: 'msg error' }, loadError),
      el('button', { class: 'btn', type: 'button', onclick: retry }, 'Retry')));
  } else if (!store.loaded) {
    status.replaceChildren(startup.waiting ? loadingNote('Server is starting...') : el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading your library...'));
  } else if (nothing) {
    status.replaceChildren(el('div', { class: 'state card' },
      el('p', { class: 't-headline' }, 'No songs yet'),
      el('p', { class: 'muted t-subhead' }, 'Paste a YouTube or SoundCloud link to save the song to your library.'),
      can('add') ? el('button', { class: 'btn primary glow', type: 'button', onclick: (e) => openAdd(undefined, e.currentTarget) }, icon('plus', 'action'), 'Add song') : null));
  } else {
    status.replaceChildren();
  }
}
