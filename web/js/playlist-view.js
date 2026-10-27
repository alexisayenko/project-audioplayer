import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { autodl } from './autodl.js';
import { el, toast } from './dom.js';
import { icon } from './icons.js';
import { titleLine } from './credits.js';
import { saveText } from './download.js';
import { openSongCard } from './lazy-ui.js';
import { isRowControl, keepCovers } from './row-cover.js';
import { disposeAll } from './marquee.js';
import { LIBRARY_FRESH_MS } from './constants.js';
import { paintDownloadRows } from './library-rows.js';
import { captureFocus, restoreFocus, headNodes, actionButtons, listRow, paintStatus } from './playlist-paint.js';
import { playlistStore } from './playlists-store.js';
import { totalText, moveId, insertId, exportName, queueNotes, addedText } from './playlists-model.js';
import { playSongs } from './playlist-play.js';
import { addSongsPanel } from './playlist-add.js';
import { createOrderSync, attachDrag } from './playlist-order.js';
import { playlistForm } from './playlist-dialogs.js';
import { deleteWithUndo } from './playlists-list.js';

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

  let queue = Promise.resolve();
  let posting = Promise.resolve();
  const adder = addSongsPanel({ held: () => new Set(ids), onAdd: (song) => addFound(song) });

  const sync = createOrderSync({
    send: async (order) => {
      await posting;
      return playlistStore.order(id, order);
    },
    onError: (ex) => {
      toast(ex.status === 422 ? 'The playlist changed elsewhere. Reloaded.' : `Could not save the order: ${ex.message}`);
      if (!gone) void load();
    },
  });

  function paintHead() {
    if (!detail) { head.replaceChildren(); return; }
    head.replaceChildren(...headNodes({ detail, first: store.get(ids[0]), summary: totalText(songsNow()) }));
  }

  function paintActions() {
    if (!detail) { actions.replaceChildren(); return; }
    actions.replaceChildren(...actionButtons({ none: !ids.length, playAll, addAllToQueue, exportList, editDetails, removePlaylist }));
  }

  function paintRows() {
    if (list.classList.contains('is-dragging')) return;
    const saved = captureFocus(list);
    const prev = [...list.querySelectorAll('li.song')];
    const rows = songsNow().map((song) => listRow(song, removeSong));
    keepCovers(prev, rows);
    disposeAll(list);
    list.replaceChildren(...rows);
    restoreFocus(list, saved);
  }

  function paintLoadStatus() {
    paintStatus(status, { missing, loadError, loaded: !!detail, empty: !ids.length, retry: () => { loadError = null; paintLoadStatus(); void load(); } });
  }

  function paintAll() {
    paintHead();
    paintActions();
    group.hidden = !ids.length;
    paintRows();
    paintLoadStatus();
    adder.node.hidden = !detail;
    adder.refresh();
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
    playSongs(songsNow(), shuffled);
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

  function dropOptimistic(sid) {
    ids = ids.filter((x) => x !== sid);
    detail = { ...detail, songs: detail.songs.filter((x) => x !== sid) };
  }

  async function postAdd(sid) {
    if (gone) return;
    const request = playlistStore.add(id, [sid]);
    posting = request.catch(() => {});
    try {
      await request;
    } catch (ex) {
      if (gone) return;
      dropOptimistic(sid);
      paintAll();
      toast(`Could not add: ${ex.message}`);
    }
  }

  function addFound(song) {
    const sid = song.id;
    if (!detail || ids.includes(sid)) return;
    ids = [...ids, sid];
    detail = { ...detail, songs: [...detail.songs, sid] };
    if (sync.pending()) sync.schedule(ids);
    paintAll();
    toast(addedText(detail.name, { added: 1, skipped: [] }, 1));
    say(`Added ${titleLine(song)}`);
    queue = queue.then(() => postAdd(sid));
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
      await queue;
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

  root.append(back, head, actions, adder.node, group, status, live);

  const unsubLibrary = store.subscribe(() => {
    if (gone || !detail || list.classList.contains('is-dragging')) return;
    ids = detail.songs.filter((sid) => store.get(sid));
    paintAll();
  });
  const unsubPlayer = player.onChange(() => { if (!gone && detail) paintRows(); });
  const unsubDl = autodl.onChange(() => { if (!gone && detail) paintDownloadRows(list, paintRows); });
  const flushOnHide = () => { if (sync.pending()) void sync.flush(); };
  window.addEventListener('pagehide', flushOnHide);

  paintLoadStatus();
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
