import { store } from './store.js';
import { player } from './player.js';
import { el, toast, plural } from './dom.js';
import { icon } from './icons.js';
import { autodl } from './autodl.js';
import { ringModel } from './dl-progress.js';
import { paintRing, paintLine } from './dl-ring.js';
import { openAdd } from './add.js';
import { can } from './guest.js';
import { ROW_FLASH_MS } from './constants.js';
import { findRowIndex, scrollTarget, registerRevealer } from './reveal.js';
import { tagLabel, categoryOf, CATEGORIES } from './tagname.js';
import { prefs, SORTS, visibleSongs, selectedIn, isUnsetKey, unsetCount } from './library-data.js';
import { songRow } from './library-rows.js';
import { disposeAll } from './marquee.js';
import { isRowControl, keepCovers } from './row-cover.js';
import { openSongCard } from './song-card.js';
import { openFilterSheet } from './library-toolbar.js';
import { mountScrollTop } from './scroll-top.js';

export { filterByTags, visibleSongs } from './library-data.js';

let flashId = null;
let flashTimer;

export function renderLibrary(root) {
  const search = el('input', {
    type: 'search', placeholder: 'Search title, artist, album, remix or tag', value: prefs.query,
    'aria-label': 'Search',
    oninput: (e) => { prefs.query = e.target.value; renderList(); },
  });
  const sort = el('select', {
    'aria-label': 'Sort',
    onchange: (e) => { prefs.sort = e.target.value; renderList(); },
  }, Object.entries(SORTS).map(([k, [label]]) => el('option', { value: k, selected: k === prefs.sort }, label)));
  const cats = el('div', { class: 'cats', role: 'group', 'aria-label': 'Filter by category' });
  const total = el('span', { class: 'muted t-caption' });
  const summary = el('p', { class: 'muted t-caption', role: 'status' });
  const list = el('ul', { class: 'songs' });
  const addAll = el('button', { class: 'btn outline small', type: 'button', hidden: true });
  addAll.addEventListener('click', () => {
    const songs = visibleSongs();
    const only = prefs.sel.size === 1 ? store.tags.find((t) => prefs.sel.has(t.tag.toLocaleLowerCase())) : null;
    const { added, already, fetching } = player.addListed(songs, only ? only.tag : '');
    const note = already ? ` (${already} already in queue)` : '';
    const dl = fetching ? `, ${fetching} downloading` : '';
    toast(`Added ${added} ${plural(added, 'song', 'songs')}${dl}${note}`);
  });
  const playAll = el('button', { class: 'btn outline small', type: 'button', hidden: true });
  playAll.addEventListener('click', () => {
    const tags = [...prefs.sel].map((k) => store.tags.find((t) => t.tag.toLocaleLowerCase() === k)).filter(Boolean).map((t) => t.tag);
    const { count, skipped, replaced, fetching } = player.playListed(visibleSongs(), tags);
    if (!count) { toast('Nothing to play'); return; }
    const note = (fetching ? `, ${fetching} downloading` : '') + (skipped ? `, ${skipped} without audio skipped` : '');
    toast(`Playing ${count} ${plural(count, 'song', 'songs')}${replaced ? ' (queue replaced)' : ''}${note}`);
  });
  const showPlaying = el('button', { class: 'btn outline small', type: 'button', hidden: true, 'aria-label': 'Show the playing song in the list' }, icon('crosshair', 'inline'), 'Show playing');
  showPlaying.addEventListener('click', () => { if (player.current) reveal(player.current.id); });
  const clearFilters = el('button', { class: 'btn outline small', type: 'button', hidden: true, 'aria-label': 'Clear the search and all filters' }, icon('clear', 'inline'), 'Clear filters');
  clearFilters.addEventListener('click', () => clearAllFilters());
  const status = el('div');
  const head = el('div', { class: 'table-head t-eyebrow', 'aria-hidden': 'true' },
    el('span'), el('span', {}, 'Track'), el('span', { class: 'c-genres' }, 'Genres'), el('span', { class: 'c-dur' }, 'Time'), el('span'), el('span'));
  list.addEventListener('click', (e) => {
    const row = e.target.closest('li.song');
    const song = row && !isRowControl(e.target) ? store.get(row.dataset.id) : null;
    if (song) openSongCard(song, row.querySelector('.open'));
  });
  const group = el('div', { class: 'group' }, head, list);

  root.append(
    el('header', { class: 'page-head lib-head' },
      el('div', { class: 'page-title' },
        el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
        el('h1', { class: 't-display' }, 'Library')),
      el('div', { class: 'head-actions' }, total,
        can('add') ? el('button', { class: 'btn primary glow', type: 'button', onclick: openAdd }, icon('plus', 'action'), 'Add song') : null)),
    el('div', { class: 'toolbar' },
      el('label', { class: 'search' }, icon('search', 'action'), search),
      cats),
    el('div', { class: 'sortbar' },
      el('label', { class: 'sort t-headline' }, sort, icon('chevron', 'inline')),
      summary, el('div', { class: 'sort-actions' }, clearFilters, showPlaying, playAll, addAll)),
    group,
    status);

  function renderChips() {
    for (const t of prefs.sel) if (!isUnsetKey(t) && !store.tags.some((x) => x.tag.toLocaleLowerCase() === t)) prefs.sel.delete(t);
    cats.replaceChildren(...CATEGORIES.map((c) => {
      const values = store.tags.filter((t) => categoryOf(t.tag) === c.id).length;
      const n = selectedIn(c.id);
      const b = el('button', {
        class: `cat-chip${n ? ' on' : ''}`, type: 'button', disabled: !values && !unsetCount(c.id),
        'aria-haspopup': 'dialog', 'data-cat': c.id,
        onclick: () => openFilterSheet(c, b, renderAll),
      }, c.name, el('small', { class: 't-caption' }, n || values));
      b.setAttribute('aria-label', n ? `${c.name}, ${n} selected` : `${c.name}, ${values}`);
      return b;
    }));
  }

  function selectedNames() {
    return [...prefs.sel].map((k) => (isUnsetKey(k) ? { unset: categoryOf(k) } : store.tags.find((t) => t.tag.toLocaleLowerCase() === k))).filter(Boolean).slice(0, 3)
      .map((t) => (t.unset ? `${CATEGORIES.find((c) => c.id === t.unset).name}: not set` : tagLabel(t.tag)));
  }

  function renderList() {
    const songs = visibleSongs();
    const cur = player.current;
    const filtered = !!(prefs.sel.size || prefs.query.trim());
    total.textContent = store.loaded ? `${store.songs.length} ${plural(store.songs.length, 'song', 'songs')}` : '';
    summary.textContent = store.loaded && store.songs.length && filtered ? matchSummary(songs.length) : '';
    playAll.hidden = !(store.loaded && songs.length);
    playAll.textContent = `Play all ${songs.length}`;
    addAll.hidden = !(store.loaded && filtered && songs.length);
    addAll.textContent = `Add all ${songs.length} to playlist`;
    clearFilters.hidden = !(store.loaded && filtered);
    showPlaying.hidden = !(store.loaded && cur);
    const nothing = store.loaded && !store.songs.length;
    group.hidden = nothing || !store.loaded;
    paintStatus(nothing);
    const empty = !songs.length && store.loaded && store.songs.length
      ? [el('li', { class: 'empty muted t-subhead' }, 'No songs match. Clear the search or the filters.')]
      : [];
    const focusedId = document.activeElement?.classList?.contains('row-cover') ? document.activeElement.closest('li.song')?.dataset.id : null;
    const prevRows = [...list.querySelectorAll('li.song')];
    const rows = songs.map((s) => songRow(s, cur, flashId));
    keepCovers(prevRows, rows);
    disposeAll(list);
    list.replaceChildren(...empty, ...rows);
    if (focusedId) [...list.querySelectorAll('li.song')].find((r) => r.dataset.id === focusedId)?.querySelector('.row-cover')?.focus();
  }

  // Progress ticks update the rings in place; a row gaining or losing its indicator rebuilds the list.
  function paintDownloads() {
    for (const row of list.querySelectorAll('li.song.no-audio[data-id]')) {
      const model = ringModel(autodl.view(row.dataset.id));
      const ring = row.querySelector('.dl-ring');
      const line = row.querySelector('.dl-line');
      if (!model && !ring) continue;
      if (!model || !ring || !paintRing(ring, model)) { renderList(); return; }
      if (line) paintLine(line, model);
    }
  }

  function matchSummary(count) {
    const names = prefs.sel.size ? ` · ${selectedNames().join(', ')}` : '';
    return `${count} ${plural(count, 'song matches', 'songs match')}${names}`;
  }

  function renderAll() { renderChips(); renderList(); }

  function clearAllFilters() {
    prefs.query = '';
    prefs.sel.clear();
    search.value = '';
    renderAll();
  }

  function scrollToRow(id) {
    const row = list.querySelector(`li.song[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    const r = row.getBoundingClientRect();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: scrollTarget({ rowTop: r.top, rowHeight: r.height, scrollY: window.scrollY, viewportH: window.innerHeight, docH: document.documentElement.scrollHeight }),
      behavior: reduce ? 'auto' : 'smooth',
    });
    flashId = id;
    row.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashId = null;
      list.querySelector('li.song.flash')?.classList.remove('flash');
    }, ROW_FLASH_MS);
  }

  function reveal(id) {
    if (!store.loaded || !store.get(id)) return;
    if (findRowIndex(visibleSongs(), id) >= 0) { scrollToRow(id); return; }
    toast('Song is hidden by the current filters', {
      label: 'Show',
      run: () => {
        clearAllFilters();
        scrollToRow(id);
      },
    });
  }
  const unregister = registerRevealer(reveal);

  const unsub = store.subscribe(renderAll);
  const unsubPlayer = player.onChange(renderList);
  const unsubDl = autodl.onChange(paintDownloads);

  let loadError = null;
  function paintStatus(nothing) {
    if (loadError) {
      status.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 'msg error' }, loadError),
        el('button', { class: 'btn', type: 'button', onclick: () => { loadError = null; void load(); renderList(); } }, 'Retry')));
    } else if (!store.loaded) {
      status.replaceChildren(el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading your library...'));
    } else if (nothing) {
      status.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 't-headline' }, 'No songs yet'),
        el('p', { class: 'muted t-subhead' }, 'Paste a YouTube or SoundCloud link to save the song to your library.'),
        can('add') ? el('button', { class: 'btn primary glow', type: 'button', onclick: openAdd }, icon('plus', 'action'), 'Add song') : null));
    } else {
      status.replaceChildren();
    }
  }
  const load = () => store.refresh().catch((e) => { loadError = e.message; renderList(); });
  void load();
  renderAll();

  const unmountScrollTop = mountScrollTop();

  return () => { unmountScrollTop(); unsub(); unsubPlayer(); unsubDl(); unregister(); clearTimeout(flashTimer); flashId = null; const d = document.getElementById('filter-sheet'); if (d.open) d.close(); };
}
