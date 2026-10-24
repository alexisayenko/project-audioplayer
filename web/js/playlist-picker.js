import { el, toast } from './dom.js';
import { dialogHead } from './edit-dialog.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { titleLine } from './credits.js';
import { coverTile } from './library-rows.js';
import { playlistStore } from './playlists-store.js';
import { addedText, songCount } from './playlists-model.js';
import { openPlDialog, closePlDialog, playlistForm } from './playlist-dialogs.js';

export function openPlaylistPicker(songs) {
  const picked = Array.isArray(songs) ? songs : [songs];
  const ids = picked.map((s) => s.id);
  const sub = picked.length === 1 ? titleLine(picked[0]) : songCount(picked.length);
  const holder = el('div', { class: 'pl-pick-body', 'aria-live': 'polite' });
  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });

  const newButton = el('button', { type: 'button', class: 'btn outline pl-pick-new' }, icon('plus', 'action'), 'New playlist...');
  newButton.addEventListener('click', () => playlistForm({
    title: 'New playlist',
    sub,
    submit: 'Create and add',
    withDescription: false,
    onSubmit: async (name) => {
      const made = await playlistStore.create(name, '', ids);
      toast(addedText(made.name, { added: made.songs.length, skipped: ids.filter((id) => !made.songs.includes(id)) }, ids.length));
    },
  }));

  async function choose(p, buttons) {
    err.hidden = true;
    for (const b of buttons) b.disabled = true;
    try {
      const result = await playlistStore.add(p.id, ids);
      toast(addedText(p.name, result, ids.length));
      closePlDialog();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      for (const b of buttons) b.disabled = false;
    }
  }

  function paint(held) {
    const items = playlistStore.items;
    if (!items.length) {
      holder.replaceChildren(el('p', { class: 'muted t-subhead' }, 'You have no playlists yet. Create the first one.'));
      return;
    }
    const buttons = [];
    const rows = items.map((p) => {
      const mark = held?.has(p.id) ? el('span', { class: 'pl-in t-caption' }, icon('check', 'inline'), 'In playlist') : null;
      const b = el('button', { type: 'button', class: 'pl-pick-item', onclick: () => choose(p, buttons) },
        coverTile(store.get(p.first_song_id)),
        el('span', { class: 'pl-pick-text' }, el('span', { class: 'pl-pick-name t-headline' }, p.name), el('small', { class: 'muted t-caption' }, songCount(p.count))),
        mark);
      buttons.push(b);
      return el('li', {}, b);
    });
    holder.replaceChildren(el('ul', { class: 'pl-pick-list' }, rows));
  }

  function load() {
    holder.replaceChildren(el('p', { class: 'muted t-subhead', role: 'status' }, 'Loading playlists...'));
    playlistStore.refresh().then(() => {
      paint(null);
      return playlistStore.holding(ids);
    }).then(paint, (ex) => {
      holder.replaceChildren(el('p', { class: 'msg error', role: 'alert' }, ex.message),
        el('button', { type: 'button', class: 'btn', onclick: load }, 'Retry'));
    });
  }

  openPlDialog('Add to playlist',
    dialogHead('Add to playlist', sub, closePlDialog),
    newButton,
    err,
    holder);
  load();
}
