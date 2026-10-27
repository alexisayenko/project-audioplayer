import { player } from './player.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { titleLine } from './credits.js';
import { songRow, coverTile } from './library-rows.js';

const FOCUSABLE = 'button, a[href]';

export function captureFocus(list) {
  const active = document.activeElement;
  const row = active?.closest?.('li.song');
  if (!row || !list.contains(row)) return null;
  return { id: row.dataset.id, index: [...row.querySelectorAll(FOCUSABLE)].indexOf(active) };
}

export function restoreFocus(list, saved) {
  if (!saved) return;
  const row = [...list.querySelectorAll('li.song')].find((r) => r.dataset.id === saved.id);
  const target = row && [...row.querySelectorAll(FOCUSABLE)][Math.max(0, saved.index)];
  target?.focus();
}

export function headNodes({ detail, first, summary }) {
  return [
    el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
    el('div', { class: 'pl-hero' },
      coverTile(first),
      el('div', { class: 'pl-meta' },
        el('h1', { class: 't-display' }, detail.name),
        detail.description ? el('p', { class: 'pl-desc-text muted t-subhead' }, detail.description) : null,
        el('p', { class: 'muted t-subhead', 'data-role': 'summary' }, summary))),
  ];
}

export function actionButtons({ none, playAll, addAllToQueue, exportList, editDetails, removePlaylist }) {
  return [
    el('button', { class: 'btn primary glow', type: 'button', disabled: none, onclick: () => playAll(false) }, icon('play', 'action'), 'Play playlist'),
    el('button', { class: 'btn outline', type: 'button', disabled: none, onclick: addAllToQueue }, icon('listAdd', 'action'), 'Add to queue'),
    el('button', { class: 'btn outline', type: 'button', disabled: none, onclick: () => playAll(true) }, icon('shuffle', 'action'), 'Shuffle'),
    el('button', { class: 'btn outline', type: 'button', onclick: (e) => exportList(e.currentTarget) }, icon('download', 'action'), 'Export'),
    el('button', { class: 'btn outline', type: 'button', onclick: editDetails }, icon('pencil', 'action'), 'Edit'),
    el('button', { class: 'btn danger', type: 'button', onclick: removePlaylist }, icon('trash', 'action'), 'Delete'),
  ];
}

export function listRow(song, removeSong) {
  const title = titleLine(song);
  const row = songRow(song, player.current, null, null);
  row.classList.add('pl-song');
  row.append(el('div', { class: 'pl-ctl' },
    el('button', { class: 'icon pl-grip', type: 'button', title: 'Drag to reorder, or press Alt with the Up or Down arrow', 'aria-label': `Reorder: ${title}. Press Alt with the Up or Down arrow to move.` }, icon('grip', 'inline')),
    el('button', { class: 'icon pl-remove', type: 'button', title: 'Remove from playlist', 'aria-label': `Remove from playlist: ${title}`, onclick: () => removeSong(song.id) }, icon('clear', 'inline'))));
  return row;
}

export function paintStatus(status, { missing, loadError, loaded, empty, retry }) {
  if (missing) {
    status.replaceChildren(el('div', { class: 'state card' },
      el('p', { class: 't-headline' }, 'This playlist does not exist'),
      el('p', { class: 'muted t-subhead' }, 'It may have been deleted.'),
      el('a', { class: 'btn outline small', href: '#/playlists' }, 'Back to playlists')));
  } else if (loadError) {
    status.replaceChildren(el('div', { class: 'state card' },
      el('p', { class: 'msg error', role: 'alert' }, loadError),
      el('button', { class: 'btn', type: 'button', onclick: retry }, 'Retry')));
  } else if (!loaded) {
    status.replaceChildren(el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading the playlist...'));
  } else if (empty) {
    status.replaceChildren(el('div', { class: 'state card' },
      el('p', { class: 't-headline' }, 'No songs yet'),
      el('p', { class: 'muted t-subhead' }, 'Search above to add songs, or use "Add to playlist" on a song in the Library.'),
      el('a', { class: 'btn outline small', href: '#/library' }, 'Open Library')));
  } else {
    status.replaceChildren();
  }
}
