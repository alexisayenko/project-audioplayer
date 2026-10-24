import { store } from './store.js';
import { el, toast, plural } from './dom.js';
import { icon } from './icons.js';
import { LIBRARY_FRESH_MS } from './constants.js';
import { coverTile } from './library-rows.js';
import { playlistStore } from './playlists-store.js';
import { changedText, songCount, suggestName, playlistAddHash } from './playlists-model.js';
import { playlistForm, confirmDeletePlaylist } from './playlist-dialogs.js';

export async function restorePlaylist(saved) {
  let name = saved.name;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await playlistStore.create(name, saved.description, saved.songs); // NOSONAR a taken name is retried once with a free one
    } catch (ex) {
      if (ex.code !== 'playlist_name_taken') throw ex;
      name = suggestName(name, playlistStore.names());
    }
  }
  return null;
}

export function deleteWithUndo(playlist, onDone = () => {}) {
  confirmDeletePlaylist(playlist, async () => {
    const detail = await playlistStore.detail(playlist.id);
    await playlistStore.remove(playlist.id);
    const saved = { name: playlist.name, description: detail.description || '', songs: detail.songs };
    onDone();
    toast(`Deleted "${playlist.name}"`, {
      label: 'Undo',
      run: () => restorePlaylist(saved).then(() => toast(`Restored "${saved.name}"`), (ex) => toast(ex.message)),
    });
  });
}

export function renderPlaylistList(root) {
  const total = el('span', { class: 'muted t-caption' });
  const list = el('ul', { class: 'songs pl-list' });
  const group = el('div', { class: 'group', hidden: true }, list);
  const status = el('div');
  let loadError = null;
  let gone = false;

  const create = () => playlistForm({
    title: 'New playlist',
    submit: 'Create',
    withDescription: false,
    onSubmit: async (name) => {
      const made = await playlistStore.create(name);
      toast(`Created "${made.name}"`);
    },
  });
  const newButton = el('button', { class: 'btn primary glow', type: 'button', onclick: create }, icon('plus', 'action'), 'New playlist');

  root.append(
    el('header', { class: 'page-head lib-head' },
      el('div', { class: 'lib-lead' },
        el('div', { class: 'page-title' },
          el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
          el('h1', { class: 't-display' }, 'Playlists'))),
      el('div', { class: 'head-actions' }, total, newButton)),
    group,
    status);

  const edit = (p) => playlistForm({
    title: 'Edit playlist',
    submit: 'Save',
    name: p.name,
    description: p.description || '',
    exceptId: p.id,
    onSubmit: (name, description) => playlistStore.patch(p.id, { name, description }),
  });

  function row(p) {
    const open = () => { location.hash = `#/playlists/${encodeURIComponent(p.id)}`; };
    const sub = [songCount(p.count), changedText(p.updated)].filter(Boolean).join(' · ');
    const node = el('li', { class: 'song pl-row', 'data-id': p.id },
      coverTile(store.get(p.first_song_id)),
      el('div', { class: 'info' },
        el('div', { class: 'title-line' }, el('a', { class: 'open t-headline', href: `#/playlists/${encodeURIComponent(p.id)}`, title: p.name }, p.name)),
        el('div', { class: 'sub-line' }, el('small', { class: 'sub t-subhead' }, p.description ? `${sub} · ${p.description}` : sub))),
      el('div', { class: 'pl-ctl' },
        el('button', { class: 'icon pl-add-songs', type: 'button', title: `Add songs to ${p.name}`, 'aria-label': `Add songs to ${p.name}`, onclick: () => { location.hash = playlistAddHash(p.id); } }, icon('plus', 'inline')),
        el('button', { class: 'icon', type: 'button', title: 'Edit playlist', 'aria-label': `Edit playlist: ${p.name}`, onclick: () => edit(p) }, icon('pencil', 'inline')),
        el('button', { class: 'icon', type: 'button', title: 'Delete playlist', 'aria-label': `Delete playlist: ${p.name}`, onclick: () => deleteWithUndo(p) }, icon('trash', 'inline'))));
    node.addEventListener('click', (e) => { if (!e.target.closest('a, button')) open(); });
    return node;
  }

  function paintStatus() {
    if (loadError) {
      status.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 'msg error', role: 'alert' }, loadError),
        el('button', { class: 'btn', type: 'button', onclick: () => { loadError = null; load(); render(); } }, 'Retry')));
    } else if (!playlistStore.loaded) {
      status.replaceChildren(el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading your playlists...'));
    } else if (!playlistStore.items.length) {
      status.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 't-headline' }, 'No playlists yet'),
        el('p', { class: 'muted t-subhead' }, 'A playlist is a named, ordered list of songs from your library. Create one here, or use "Add to playlist" on a song.'),
        el('button', { class: 'btn primary glow', type: 'button', onclick: create }, icon('plus', 'action'), 'New playlist')));
    } else {
      status.replaceChildren();
    }
  }

  function render() {
    const items = playlistStore.items;
    total.textContent = playlistStore.loaded ? `${items.length} ${plural(items.length, 'playlist', 'playlists')}` : '';
    group.hidden = !items.length;
    list.replaceChildren(...items.map(row));
    paintStatus();
  }

  function load() {
    playlistStore.refresh().catch((ex) => { if (gone) return; loadError = ex.message; render(); });
  }

  const unsub = playlistStore.subscribe(() => { if (!gone) render(); });
  const unsubLibrary = store.subscribe(() => { if (!gone) render(); });
  if (!store.loaded) store.refresh({ maxAgeMs: LIBRARY_FRESH_MS }).catch(() => {});
  load();
  render();

  return () => { gone = true; unsub(); unsubLibrary(); };
}
