import { el } from './dom.js';
import { playlistsOn } from './playlists-store.js';
import { playlistIdOf } from './playlists-model.js';
import { renderPlaylistList } from './playlists-list.js';
import { renderPlaylistPage } from './playlist-view.js';

function renderUnavailable(root) {
  root.append(
    el('header', { class: 'page-head' },
      el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
      el('h1', { class: 't-display' }, 'Playlists')),
    el('div', { class: 'state card' },
      el('p', { class: 'muted t-subhead' }, 'Playlists are private to a signed-in account. Sign in to build your own.'),
      el('a', { class: 'btn outline small', href: '#/settings' }, 'Open Settings')));
}

export function renderPlaylists(root) {
  if (!playlistsOn()) {
    renderUnavailable(root);
    return null;
  }
  const id = playlistIdOf(location.hash);
  return id ? renderPlaylistPage(root, id) : renderPlaylistList(root);
}
