import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { autodl } from './autodl.js';
import { el, toast, plural } from './dom.js';
import { icon } from './icons.js';
import { titleLine } from './credits.js';
import { saveText } from './download.js';
import { openSongCard } from './lazy-ui.js';
import { isRowControl, keepCovers } from './row-cover.js';
import { disposeAll } from './marquee.js';
import { LIBRARY_FRESH_MS } from './constants.js';
import { songRow, coverTile, paintDownloadRows } from './library-rows.js';
import { playlistStore } from './playlists-store.js';
import { totalText, moveId, insertId, exportName, queueNotes } from './playlists-model.js';
import { createOrderSync, attachDrag } from './playlist-order.js';
import { playlistForm } from './playlist-dialogs.js';
import { deleteWithUndo } from './playlists-list.js';

const FOCUSABLE = 'button, a[href]';

function captureFocus(list) {
  const active = document.activeElement;
  const row = active?.closest?.('li.song');
  if (!row || !list.contains(row)) return null;
  return { id: row.dataset.id, index: [...row.querySelectorAll(FOCUSABLE)].indexOf(active) };
}

function restoreFocus(list, saved) {
  if (!saved) return;
  const row = [...list.querySelectorAll('li.song')].find((r) => r.dataset.id === saved.id);
  const target = row && [...row.querySelectorAll(FOCUSABLE)][Math.max(0, saved.index)];
  target?.focus();
}

export function renderPlaylistPage(root, id) {
  let detail = null;
  let ids = [];
  let loadError = null;
  let missing = false;
  let gone = false;

  const head = el('header', { class: 'page-head pl-head' });
  const actions = el('div', { class: 'pl-actions' });
  const list = el('ul', { class: 'songs pl-songs' });
  const group = el('div', { class: 'group', hidden: true }, list);
  const status = el('div');
  const live = el('p', { class: 'pl-live', role: 'status', 'aria-live': 'polite' });
  const back = el('a', { class: 'link-btn pl-back', href: '#/playlists' }, icon('chevronLeft', 'inline'), 'Playlists');

  const songsNow = () => ids.map((sid) => store.get(sid)).filter(Boolean);
  const say = (text) => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 50); };

  const sync = createOrderSync({
    send: (order) => playlistStore.order(id, order),
    onError: (ex) => {
      toast(ex.status === 422 ? 'The playlist changed elsewhere. Reloaded.' : `Could not save the order: ${ex.message}`);
      if (!gone) void load();
    },
  });

  function summaryLine() {
    return totalText(songsNow());
  }

  function paintHead() {
    if (!detail) { head.replaceChildren(); return; }
    const first = store.get(ids[0]);
    head.replaceChildren(
      el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
      el('div', { class: 'pl-hero' },
        coverTile(first),
        el('div', { class: 'pl-meta' },
          el('h1', { class: 't-display' }, detail.name),
          detail.description ? el('p', { class: 'pl-desc-text muted t-subhead' }, detail.description) : null,
          el('p', { class: 'muted t-subhead', 'data-role': 'summary' }, summaryLine()))));
  }

  function paintActions() {
    if (!detail) { actions.replaceChildren(); return; }
    const none = !ids.length;
    actions.replaceChildren(
      el('button', { class: 'btn primary glow', type: 'button', disabled: none, onclick: () => playAll(false) }, icon('play', 'action'), 'Play playlist'),
      el('button', { class: 'btn outline', type: 'button', disabled: none, onclick: () => playAll(true) }, icon('shuffle', 'action'), 'Shuffle'),
      el('button', { class: 'btn outline', type: 'button', disabled: none, onclick: addAllToQueue }, icon('listAdd', 'action'), 'Add to queue'),
      el('button', { class: 'btn outline', type: 'button', onclick: (e) => exportList(e.currentTarget) }, icon('download', 'action'), 'Export'),
      el('button', { class: 'btn outline', type: 'button', onclick: editDetails }, icon('pencil', 'action'), 'Edit'),
      el('button', { class: 'btn danger', type: 'button', onclick: removePlaylist }, icon('trash', 'action'), 'Delete'));
  }

  function listRow(s) {
    const title = titleLine(s);
    const row = songRow(s, player.current, null, null);
    row.classList.add('pl-song');
    row.append(el('div', { class: 'pl-ctl' },
      el('button', { class: 'icon pl-grip', type: 'button', title: 'Drag to reorder, or press Alt with the Up or Down arrow', 'aria-label': `Reorder: ${title}. Press Alt with the Up or Down arrow to move.` }, icon('grip', 'inline')),
      el('button', { class: 'icon pl-remove', type: 'button', title: 'Remove from playlist', 'aria-label': `Remove from playlist: ${title}`, onclick: () => removeSong(s.id) }, icon('clear', 'inline'))));
    return row;
  }

  function paintRows() {
    if (list.classList.contains('is-dragging')) return;
    const saved = captureFocus(list);
    const prev = [...list.querySelectorAll('li.song')];
    const rows = songsNow().map(listRow);
    keepCovers(prev, rows);
    disposeAll(list);
    list.replaceChildren(...rows);
    restoreFocus(list, saved);
  }

  function paintStatus() {
    if (missing) {
      status.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 't-headline' }, 'This playlist does not exist'),
        el('p', { class: 'muted t-subhead' }, 'It may have been deleted.'),
        el('a', { class: 'btn outline small', href: '#/playlists' }, 'Back to playlists')));
    } else if (loadError) {
      status.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 'msg error', role: 'alert' }, loadError),
        el('button', { class: 'btn', type: 'button', onclick: () => { loadError = null; paintStatus(); void load(); } }, 'Retry')));
    } else if (!detail) {
      status.replaceChildren(el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading the playlist...'));
    } else if (!ids.length) {
      status.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 't-headline' }, 'No songs yet'),
        el('p', { class: 'muted t-subhead' }, 'Use "Add to playlist" on a song in the Library to put it here.'),
        el('a', { class: 'btn outline small', href: '#/library' }, 'Open Library')));
    } else {
      status.replaceChildren();
    }
  }

  function paintAll() {
    paintHead();
    paintActions();
    group.hidden = !ids.length;
    paintRows();
    paintStatus();
  }

  function adopt(next) {
    detail = next;
    ids = next.songs.filter((sid) => store.get(sid));
  }

  async function load() {
    try {
      adopt(await playlistStore.detail(id));
      missing = false;
      loadError = null;
    } catch (ex) {
      if (gone) return;
      if (ex.status === 404) missing = true; else loadError = ex.message;
    }
    if (!gone) paintAll();
  }

  function playAll(shuffled) {
    const songs = songsNow();
    const wasShuffle = player.shuffleOn;
    if (shuffled !== wasShuffle) player.setShuffle(shuffled);
    const r = songs.length ? player.playListed(songs, []) : { count: 0, skipped: 0 };
    if (!r.count) {
      if (shuffled !== wasShuffle) player.setShuffle(wasShuffle);
      toast('No playable songs');
      return;
    }
    const mode = shuffled ? ' (shuffled)' : (wasShuffle ? ' (shuffle off)' : '');
    if (r.skipped) toast(`${r.skipped} ${plural(r.skipped, 'song', 'songs')} without audio skipped`);
    else toast(`Playing ${r.count} ${plural(r.count, 'song', 'songs')}${mode}${r.fetching ? `, ${r.fetching} downloading` : ''}`);
  }

  function addAllToQueue() {
    const songs = songsNow();
    const r = player.addListed(songs, '');
    if (!r.added && !r.already) { toast('No playable songs'); return; }
    toast(queueNotes({ ...r, skipped: songs.length - r.added - r.already }));
  }

  async function exportList(button) {
    button.disabled = true;
    try {
      const { text, filename } = await api.exportPlaylist(id);
      saveText(text, exportName(filename, detail.name));
      toast('Export saved');
    } catch (ex) {
      toast(`Export failed: ${ex.message}`);
    } finally {
      button.disabled = false;
    }
  }

  function editDetails() {
    playlistForm({
      title: 'Edit playlist',
      submit: 'Save',
      name: detail.name,
      description: detail.description || '',
      exceptId: id,
      onSubmit: async (name, description) => {
        const next = await playlistStore.patch(id, { name, description });
        if (!gone) { adopt({ ...next, songs: detail.songs }); paintHead(); }
      },
    });
  }

  function removePlaylist() {
    deleteWithUndo({ id, name: detail.name }, () => { location.hash = '#/playlists'; });
  }

  async function restoreSong(sid, index) {
    try {
      await playlistStore.add(id, [sid]);
      const now = await playlistStore.detail(id);
      const known = now.songs.filter((x) => x === sid || store.get(x));
      const order = insertId(known.filter((x) => x !== sid), sid, index);
      if (order.some((x, i) => x !== known[i])) await playlistStore.order(id, order);
      if (!gone) await load();
      toast('Restored');
    } catch (ex) {
      toast(ex.message);
    }
  }

  async function removeSong(sid) {
    const index = ids.indexOf(sid);
    const song = store.get(sid);
    try {
      await sync.flush();
      await playlistStore.removeSong(id, sid);
    } catch (ex) {
      if (ex.status !== 404) { toast(ex.message); return; }
    }
    if (gone) return;
    ids = ids.filter((x) => x !== sid);
    detail = { ...detail, songs: detail.songs.filter((x) => x !== sid) };
    paintAll();
    say(`Removed ${song ? titleLine(song) : 'song'} from the playlist`);
    toast('Removed from playlist', { label: 'Undo', run: () => restoreSong(sid, index) });
  }

  function reorder(next, moved, position) {
    ids = next;
    detail = { ...detail, songs: next };
    sync.schedule(next);
    const song = store.get(moved);
    say(`${song ? titleLine(song) : 'Song'}, position ${position + 1} of ${next.length}`);
  }

  function moveBy(sid, delta) {
    const from = ids.indexOf(sid);
    const to = from + delta;
    const song = store.get(sid);
    if (from < 0) return;
    if (to < 0 || to >= ids.length) {
      say(`${song ? titleLine(song) : 'Song'} is already ${delta < 0 ? 'first' : 'last'}`);
      return;
    }
    const focused = document.activeElement;
    const row = [...list.querySelectorAll('li.song')][from];
    const other = [...list.querySelectorAll('li.song')][to];
    if (delta < 0) other.before(row); else other.after(row);
    focused?.focus?.();
    reorder(moveId(ids, from, to), sid, to);
  }

  list.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const row = e.target.closest?.('li.song');
    if (!row) return;
    e.preventDefault();
    moveBy(row.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
  });

  list.addEventListener('click', (e) => {
    const row = e.target.closest('li.song');
    const song = row && !isRowControl(e.target) ? store.get(row.dataset.id) : null;
    if (song) void openSongCard(song, row.querySelector('.open'));
  });

  const stopDrag = attachDrag(list, {
    onMove: (from, to, row) => {
      const moved = row.dataset.id;
      const rows = [...list.querySelectorAll('li.song')];
      const slotRow = rows[to];
      if (to > from) slotRow.after(row); else slotRow.before(row);
      reorder(moveId(ids, from, to), moved, to);
      void sync.flush();
    },
  });

  root.append(back, head, actions, group, status, live);

  const unsubLibrary = store.subscribe(() => {
    if (gone || !detail || list.classList.contains('is-dragging')) return;
    ids = detail.songs.filter((sid) => store.get(sid));
    paintAll();
  });
  const unsubPlayer = player.onChange(() => { if (!gone && detail) paintRows(); });
  const unsubDl = autodl.onChange(() => { if (!gone && detail) paintDownloadRows(list, paintRows); });
  const flushOnHide = () => { if (sync.pending()) void sync.flush(); };
  window.addEventListener('pagehide', flushOnHide);

  paintStatus();
  if (!store.loaded) {
    store.refresh({ maxAgeMs: LIBRARY_FRESH_MS }).catch(() => {}).then(() => load());
  } else {
    void load();
  }

  return () => {
    gone = true;
    stopDrag();
    void sync.flush();
    window.removeEventListener('pagehide', flushOnHide);
    unsubLibrary();
    unsubPlayer();
    unsubDl();
  };
}
