import { store } from './store.js';
import { player } from './player.js';
import { el, toast, plural } from './dom.js';
import { icon } from './icons.js';
import { autodl } from './autodl.js';
import { openAdd, openSongCard, loadUi } from './lazy-ui.js';
import { can, isGuest } from './guest.js';
import { getListening } from './listening-data.js';
import { LIBRARY_FRESH_MS, EAGER_COVERS } from './constants.js';
import { findRowIndex, registerRevealer } from './reveal.js';
import { prefs, SORTS, savePrefs, visibleSongs, setListening, hasListening, listeningData } from './library-data.js';
import { songRow, paintDownloadRows } from './library-rows.js';
import { loadReferences, onReferencesChange } from './references.js';
import { disposeAll } from './marquee.js';
import { isRowControl, keepCovers } from './row-cover.js';
import { mountScrollTop } from './scroll-top.js';
import { searchBox } from './search-box.js';
import { addAllToQueue, playAll as playAllSongs } from './play-all.js';
import { draftStore } from './drafts-store.js';
import { countText } from './drafts-model.js';
import { chipNodes, matchSummary } from './library-chips.js';
import { lazyPane } from './library-panes.js';
import { flashedId, clearFlash, scrollToRow } from './row-flash.js';
import { paintStatus } from './library-status.js';
import { whenIdle } from './idle-task.js';

export { filterByTags, visibleSongs } from './library-data.js';

if (typeof window !== 'undefined') window.addEventListener('auth-changed', () => { prefs.view = 'songs'; setListening(null); prefs.refs = ''; });

let albumsTotal = '';

export function prioritizeCovers(rows, count = EAGER_COVERS) {
  for (const row of rows.slice(0, count)) {
    const img = row.querySelector?.('img.cover');
    if (!img) continue;
    img.setAttribute('fetchpriority', 'high');
    img.loading = 'eager';
  }
}

export function renderLibrary(root) {
  const searchField = searchBox({
    placeholder: 'Search title, artist, album, remix or tag', value: prefs.query,
    onChange: (text) => { prefs.query = text; renderList(); },
  });
  const search = searchField.input;
  const { paintClear } = searchField;
  const sort = el('select', {
    'aria-label': 'Sort',
    onchange: (e) => { prefs.sort = e.target.value; renderList(); },
  });
  function paintSort() {
    sort.replaceChildren(...Object.entries(SORTS).filter(([k]) => k !== 'listened' || hasListening())
      .map(([k, [label]]) => el('option', { value: k, selected: k === prefs.sort }, label)));
  }
  paintSort();
  const reverse = el('button', { class: 'icon sort-reverse', type: 'button', title: 'Reverse order', 'aria-label': 'Reverse order', 'aria-pressed': String(!!prefs.reverse) }, icon('arrowUpDown', 'inline'));
  reverse.addEventListener('click', () => {
    prefs.reverse = !prefs.reverse;
    reverse.setAttribute('aria-pressed', String(prefs.reverse));
    renderList();
  });
  const cats = el('div', { class: 'cats', role: 'group', 'aria-label': 'Filter by category' });
  const total = el('span', { class: 'muted t-caption' });
  const summary = el('p', { class: 'muted t-caption', role: 'status' });
  const list = el('ul', { class: 'songs' });
  const addAll = el('button', { class: 'btn outline small', type: 'button', hidden: true });
  addAll.addEventListener('click', () => {
    const only = prefs.sel.size === 1 ? store.tags.find((t) => prefs.sel.has(t.tag.toLocaleLowerCase())) : null;
    addAllToQueue(visibleSongs(), only ? only.tag : '');
  });
  const playAll = el('button', { class: 'btn outline small', type: 'button', hidden: true });
  playAll.addEventListener('click', () => {
    const tags = [...prefs.sel].map((k) => store.tags.find((t) => t.tag.toLocaleLowerCase() === k)).filter(Boolean).map((t) => t.tag);
    playAllSongs(visibleSongs(), tags);
  });
  const showPlaying = el('button', { class: 'btn outline small', type: 'button', hidden: true, 'aria-label': 'Show the playing song in the list' }, icon('crosshair', 'inline'), 'Show playing');
  showPlaying.addEventListener('click', () => { if (player.current) reveal(player.current.id); });
  const clearFilters = el('button', { class: 'btn outline small', type: 'button', hidden: true, 'aria-label': 'Clear the search and all filters' }, icon('clear', 'inline'), 'Clear filters');
  clearFilters.addEventListener('click', () => clearAllFilters());
  const status = el('div');
  const head = el('div', { class: 'table-head t-eyebrow', 'aria-hidden': 'true' },
    el('span'), el('span', {}, 'Track'), el('span', { class: 'c-genres' }, 'Genres'), el('span', { class: 'c-stats' }, 'Stats'));
  list.addEventListener('click', (e) => {
    const row = e.target.closest('li.song');
    const song = row && !isRowControl(e.target) ? store.get(row.dataset.id) : null;
    if (song) void openSongCard(song, row.querySelector('.open'));
  });
  const group = el('div', { class: 'group' }, head, list);

  const drafting = can('drafts');
  const songsPane = el('div', { class: 'lib-pane', id: 'lib-songs', });
  const draftsPane = el('div', { class: 'lib-pane drafts', id: 'lib-drafts', hidden: true });
  const albumsPane = el('div', { class: 'lib-pane', id: 'lib-albums', hidden: true });
  let gone = false;
  const albumsLazy = lazyPane(albumsPane, { module: 'albums', mount: 'mountAlbums', noun: 'albums', isGone: () => gone, freshMs: LIBRARY_FRESH_MS });
  const draftsLazy = lazyPane(draftsPane, { module: 'drafts', mount: 'mountDrafts', noun: 'drafts', clear: true, isGone: () => gone });

  const addSong = can('add') ? el('button', { class: 'btn primary glow', type: 'button', onclick: (e) => openAdd(undefined, e.currentTarget) }, icon('plus', 'action'), 'Add song') : null;
  const addAlbum = can('add') ? el('button', { class: 'btn primary glow', type: 'button', hidden: true, onclick: (e) => { const o = e.currentTarget; void loadUi('albums').then((m) => m.openAddAlbum(o)); } }, icon('plus', 'action'), 'Add album') : null;
  root.append(
    el('header', { class: 'page-head lib-head' },
      el('div', { class: 'page-title' },
        el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
        el('h1', { class: 't-display', id: 'lib-title' }, 'Library')),
      el('div', { class: 'head-actions' }, total,
        addSong, addAlbum)),
    songsPane,
    albumsPane,
    draftsPane);
  songsPane.append(
    el('div', { class: 'toolbar' },
      searchField.node,
      showPlaying,
      cats),
    el('div', { class: 'sortbar' },
      el('label', { class: 'sort t-headline' }, sort, icon('chevron', 'inline')), reverse,
      summary, el('div', { class: 'sort-actions' }, clearFilters, playAll, addAll)),
    group,
    status);

  function paintTotal() {
    if (prefs.view === 'albums') total.textContent = albumsTotal;
    else if (prefs.view === 'drafts') total.textContent = draftStore.loaded ? countText(draftStore.count) : '';
    else total.textContent = store.loaded ? `${store.songs.length} ${plural(store.songs.length, 'song', 'songs')}` : '';
  }

  const onAlbumsTotal = (e) => { albumsTotal = e.detail?.text || ''; paintTotal(); };
  window.addEventListener('albums-total', onAlbumsTotal);

  function paintSwitch() {
    paintTotal();
  }

  function routeView() {
    const m = /^#\/library\/(albums(?:\/[^/?#]+)?|drafts)$/.exec(location.hash);
    return drafting && m ? m[1].split('/')[0] : 'songs';
  }

  let mountedAlbum = null;
  let stale = false;
  const albumRoute = () => /^#\/library\/albums\/([^/?#]+)$/.exec(location.hash)?.[1] || '';

  function setView(view) {
    prefs.view = view;
    songsPane.hidden = view !== 'songs';
    albumsPane.hidden = view !== 'albums';
    draftsPane.hidden = view !== 'drafts';
    if (addSong) addSong.hidden = view === 'albums';
    if (addAlbum) addAlbum.hidden = view !== 'albums';
    const heading = root.querySelector('#lib-title');
    if (heading) heading.textContent = { songs: 'Library', albums: 'Albums', drafts: 'Drafts' }[view];
    if (view === 'songs' && stale) renderAll();
    if (view === 'drafts') draftsLazy.show();
    if (view === 'albums') {
      mountedAlbum = albumRoute();
      albumsLazy.show();
    }
    paintTotal();
  }

  // A Songs/Albums/Drafts switch keeps this page (and its rows) alive instead of rebuilding it.
  function retarget() {
    const view = routeView();
    if (view === 'albums' && albumRoute() !== mountedAlbum) albumsLazy.remount();
    setView(view);
    if (view === 'songs') void load();
  }

  function renderChips() {
    cats.replaceChildren(...chipNodes(renderAll));
  }

  // While Albums or Drafts is showing, the song rows are rebuilt once when the browser is idle, so Songs is ready before it is clicked.
  let cancelIdle = null;
  function renderLater() {
    stale = true;
    if (cancelIdle) return;
    cancelIdle = whenIdle(() => {
      cancelIdle = null;
      if (gone || !stale) return;
      renderChips();
      paintList();
    });
  }

  function renderList() {
    paintTotal();
    if (songsPane.hidden) renderLater(); else paintList();
  }

  function paintList() {
    stale = false;
    const songs = visibleSongs();
    const cur = player.current;
    const filtered = !!(prefs.sel.size || prefs.never || prefs.refs || prefs.query.trim());
    savePrefs();
    summary.textContent = store.loaded && store.songs.length && filtered ? matchSummary(songs.length) : '';
    playAll.hidden = !(store.loaded && songs.length);
    playAll.textContent = `Play all ${songs.length}`;
    addAll.hidden = !(store.loaded && filtered && songs.length);
    addAll.textContent = `Add all ${songs.length} to queue`;
    clearFilters.hidden = !(store.loaded && filtered);
    showPlaying.hidden = !(store.loaded && cur);
    const nothing = store.loaded && !store.songs.length;
    group.hidden = nothing || !store.loaded;
    paintLoadStatus(nothing);
    const data = isGuest() ? null : listeningData();
    group.classList.toggle('has-stats', !!data);
    const empty = !songs.length && store.loaded && store.songs.length
      ? [el('li', { class: 'empty muted t-subhead' }, 'No songs match. Clear the search or the filters.')]
      : [];
    const focusedEl = document.activeElement;
    const focusedCls = ['row-cover', 'act-pl', 'act-queue', 'sq-btn'].find((c) => focusedEl?.classList?.contains(c));
    const focusedId = focusedCls ? focusedEl.closest('li.song')?.dataset.id : null;
    const prevRows = [...list.querySelectorAll('li.song')];
    const rows = songs.map((s) => songRow(s, cur, flashedId(), data ? data.songs[s.id]?.listened?.all || 0 : null));
    prioritizeCovers(rows);
    keepCovers(prevRows, rows);
    disposeAll(list);
    list.replaceChildren(...empty, ...rows);
    if (focusedId) [...list.querySelectorAll('li.song')].find((r) => r.dataset.id === focusedId)?.querySelector(`.${focusedCls}`)?.focus();
  }

  const paintDownloads = () => paintDownloadRows(list, renderList);

  function renderAll() { renderChips(); renderList(); }

  function clearAllFilters() {
    prefs.query = '';
    prefs.sel.clear();
    prefs.never = false;
    prefs.refs = '';
    search.value = '';
    paintClear();
    renderAll();
  }

  function reveal(id) {
    if (!store.loaded || !store.get(id)) return;
    if (findRowIndex(visibleSongs(), id) >= 0) { scrollToRow(list, id); return; }
    toast('Song is hidden by the current filters', {
      label: 'Show',
      run: () => {
        clearAllFilters();
        scrollToRow(list, id);
      },
    });
  }
  const unregister = registerRevealer(reveal);

  const unsub = store.subscribe(renderAll);
  let unsubDrafts = null;
  if (drafting) {
    unsubDrafts = draftStore.subscribe(paintSwitch);
    if (!draftStore.loaded) void draftStore.load();
    paintSwitch();
    setView(routeView());
  } else setView('songs');
  const unsubPlayer = player.onChange(renderList);
  const unsubDl = autodl.onChange(paintDownloads);

  let loadError = null;
  const retry = () => { loadError = null; void load(); renderList(); };
  const paintLoadStatus = (nothing) => paintStatus(status, { loadError, nothing, retry });
  const load = () => store.refresh({ maxAgeMs: LIBRARY_FRESH_MS }).catch((e) => { loadError = e.message; renderList(); });
  const onStarting = () => { if (!store.loaded && !gone) renderList(); };
  window.addEventListener('server-starting', onStarting);
  void load();
  const unsubRefs = onReferencesChange(() => { if (!gone) renderAll(); });
  if (!isGuest()) void loadReferences();
  renderAll();
  if (!isGuest()) {
    void getListening().then((d) => {
      if (gone || !d || listeningData()?.songs === d.songs) return;
      setListening(d);
      paintSort();
      renderAll();
    });
  }

  const unmountScrollTop = mountScrollTop();

  const cleanup = () => { gone = true; cancelIdle?.();window.removeEventListener('server-starting', onStarting); unmountScrollTop(); unsub(); unsubDrafts?.(); draftsLazy.dispose(); albumsLazy.dispose(); window.removeEventListener('albums-total', onAlbumsTotal); unsubPlayer(); unsubRefs(); unsubDl(); unregister(); clearFlash(); const d = document.getElementById('filter-sheet'); if (d.open) d.close(); };
  cleanup.retarget = retarget;
  return cleanup;
}
