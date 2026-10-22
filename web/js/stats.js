import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { el, toast, plural, pageHead } from './dom.js';
import { icon } from './icons.js';
import { titleNodes, titleLine, artistLine } from './credits.js';
import { storeGet, storeSet } from './storage.js';
import { indexGraph } from './genre-data.js';
import { songGenres } from './genre-playing.js';
import { POLL_MS, shouldPoll } from './genre-view.js';
import { createChart } from './stats-chart.js';
import { watchPlayerInset } from './player-inset.js';
import { createCollapsible, loadCollapsed, saveCollapsed, PANEL_KEYS } from './collapsible.js';
import { renderTable } from './stats-table.js';
import { isGuest } from './guest.js';
import { getListening, refreshListening } from './listening-data.js';
import { renderListening } from './stats-listening.js';
import { renderGenres } from './stats-genres-view.js';
import { DEFAULT_SORT, genreTag } from './stats-genres.js';
import { filterByTags, prefs, saveLibraryView } from './library-data.js';
import {
  COLOR_MODES, DEFAULT_MODE, PALETTE_SIZE, FAMILY_PALETTE_SIZE, splitPlottable, makePoint, assignGroups, colorIndex, songFamilies, countText, skippedText, chartLabel,
} from './stats-data.js';

const MODE_KEY = 'stats.color';
const TAB_KEY = 'stats.tab';
const TABS = [['songs', 'Songs'], ['listening', 'Listening'], ['genres', 'Genres']];
const EMPTY_TEXT = 'Songs need a year and a BPM to appear here';

const BAR_GAP = 8;
const RESOLVING_TEXT = 'Resolving genre families...';
const LISTENING_POLL_MS = 30000;

export const loadMode = () => {
  const v = storeGet(MODE_KEY, DEFAULT_MODE);
  return COLOR_MODES.some(([k]) => k === v) ? v : DEFAULT_MODE;
};

export async function openSong(song, opener = null) {
  try {
    const mod = await import('./song-card.js');
    mod.openSongCard(song, opener);
    return;
  } catch { /* song card unavailable: fall back to the edit dialog */ }
  const { editDialog } = await import('./edit-dialog.js');
  editDialog(song);
}

const swatch = (color, family) => {
  const i = colorIndex(color, family ? FAMILY_PALETTE_SIZE : PALETTE_SIZE);
  const token = `--chart-${i < 0 ? FAMILY_PALETTE_SIZE - 1 : i}`;
  return el('span', { class: 'st-sw', style: `background: var(${token})`, 'aria-hidden': 'true' });
};

const countLabel = (n) => `${n} ${plural(n, 'song', 'songs')}`;

export function renderStats(root) {
  let points = [];
  let skipped = 0;
  let groups = [];
  let hidden = new Set();
  let selected = new Set();
  let mode = loadMode();
  let graph = null;
  let graphFailed = false;
  let families = null;
  let polls = 0;
  let pollTimer = 0;
  let listeningPollTimer = 0;
  let listeningRequest = null;
  let listeningRefreshQueued = false;
  let fetching = false;
  let legendOpen = true;
  let asTable = false;
  let sort = { key: 'year', dir: 1 };
  let dead = false;
  let wanted = storeGet(TAB_KEY, 'songs');
  const songsWrap = el('div', { class: 'st-songs', id: 'st-panel-songs', role: 'tabpanel', 'aria-labelledby': 'st-tab-songs' });
  const tabBtns = new Map(TABS.map(([k, label]) => [k, el('button', {
    class: 'st-tab t-subhead', type: 'button', role: 'tab', id: `st-tab-${k}`, 'aria-controls': `st-panel-${k}`, 'aria-selected': 'false', tabindex: '-1',
    hidden: k === 'listening', onclick: () => selectTab(k), onkeydown: onTabKey,
  }, label)]));

  const base = el('canvas', { class: 'st-canvas', 'aria-hidden': 'true' });
  const top = el('canvas', { class: 'st-canvas st-top', tabindex: 0, role: 'img', 'aria-label': chartLabel(0) });
  const tip = el('div', { class: 'st-tip t-caption', role: 'presentation', hidden: true });
  const live = el('p', { class: 'st-sr', 'aria-live': 'polite' });
  const status = el('p', { class: 'st-count t-caption', role: 'status' });
  const note = el('p', { class: 'st-note muted t-caption' });
  const empty = el('p', { class: 'st-empty t-subhead muted', hidden: true });
  const legend = el('ul', { class: 'st-legend t-caption', id: 'st-legend', 'aria-label': 'Colours (click to hide or show)' });
  const tableBox = el('div', { class: 'st-tablebox', hidden: true });
  const panel = el('div', { class: 'st-panel', role: 'group', 'aria-label': 'Selection', hidden: true });

  const chart = createChart(base, top, {
    onHover: (p, pos) => showTip(p, pos),
    onOpen: (p) => { void openSong(p.song, top); },
    onSelect: (ids) => setSelected(new Set(ids)),
    onFocus: (p) => { live.textContent = `${titleLine(p.song)}, ${artistLine(p.song) || 'unknown artist'}, ${p.year}, ${p.bpm} BPM`; },
    onView: () => syncReset(),
  });

  const select = el('select', {
    class: 'st-select t-caption', 'aria-label': 'Colour by',
    onchange: (e) => { mode = e.target.value; storeSet(MODE_KEY, mode); hidden = new Set(); rebuild(); },
  }, COLOR_MODES.map(([k, label]) => el('option', { value: k, selected: k === mode }, label)));
  const legendBtn = el('button', {
    class: 'st-btn t-caption', type: 'button', 'aria-expanded': 'true', 'aria-controls': 'st-legend',
    onclick: () => { legendOpen = !legendOpen; syncLegend(); },
  }, 'Legend');
  const tableBtn = el('button', {
    class: 'st-btn t-caption', type: 'button', 'aria-pressed': 'false',
    onclick: () => { asTable = !asTable; syncMode(); },
  }, 'View as table');
  let listening = null;
  const listeningBox = el('div', { class: 'st-tablebox st-listenbox', id: 'st-panel-listening', role: 'tabpanel', 'aria-labelledby': 'st-tab-listening', hidden: true });
  const genresBox = el('div', { class: 'st-genresbox', id: 'st-panel-genres', role: 'tabpanel', 'aria-labelledby': 'st-tab-genres', hidden: true });
  const genreSearch = el('input', {
    class: 'st-search t-caption', type: 'search', placeholder: 'Filter genres', 'aria-label': 'Filter genres',
    oninput: (e) => { genreQuery = e.target.value; paintGenreTable(); },
  });
  const genreTools = el('div', { class: 'st-gtools' }, genreSearch);
  const genreHost = el('div', { class: 'st-ghost' });
  genresBox.append(genreTools, genreHost);
  let genreQuery = '';
  let genreSort = null;
  const centerBtn = el('button', { class: 'st-btn t-caption', type: 'button', 'aria-label': 'Center chart', title: 'Center chart (C)', onclick: () => chart.center() }, icon('crosshair', 'inline'));
  const resetBtn = el('button', { class: 'st-btn t-caption', type: 'button', hidden: true, onclick: () => chart.reset() }, 'Reset');

  function genreLines(song) {
    const genres = songGenres(song).map((g) => g.label);
    const fam = families ? (families.get(song.id) || 'Other') : '';
    const text = [fam, genres.join(', ')].filter(Boolean).join(': ');
    return text ? [el('span', { class: 'st-tipmeta st-tipgenre' }, text)] : [];
  }

  function showTip(p, pos) {
    if (!p) { tip.hidden = true; return; }
    tip.replaceChildren(
      el('b', {}, titleNodes(p.song)),
      el('span', {}, artistLine(p.song)),
      el('span', { class: 'st-tipmeta' }, `${p.year} · ${p.bpm} BPM`),
      ...genreLines(p.song));
    const wide = top.clientWidth || 0;
    const left = pos.x + 14;
    tip.style.left = `${wide && left > wide - 220 ? pos.x - 220 : left}px`;
    tip.style.top = `${pos.y + 14}px`;
    tip.hidden = false;
  }

  function syncReset() { resetBtn.hidden = !chart.isZoomed(); }

  function syncLegend() {
    legend.hidden = !legendOpen || mode === 'none';
    legendBtn.setAttribute('aria-expanded', String(legendOpen));
    legendBtn.hidden = mode === 'none';
  }

  const resolving = () => mode === 'family' && !families;

  function renderLegend() {
    if (resolving()) { legend.replaceChildren(el('li', { class: 'st-resolving muted' }, RESOLVING_TEXT)); return; }
    legend.replaceChildren(...groups.map((g) => el('li', {}, el('button', {
      class: `st-key${hidden.has(g.key) ? ' off' : ''}`, type: 'button', 'aria-pressed': String(!hidden.has(g.key)),
      title: `${hidden.has(g.key) ? 'Show' : 'Hide'} ${g.label}`,
      onclick: () => toggleGroup(g.key),
    }, swatch(g.color, mode === 'family'), g.label, el('small', {}, String(g.count))))));
  }

  function toggleGroup(key) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    hidden = next;
    chart.setHidden(hidden);
    renderLegend();
    renderRows();
  }

  const shown = () => points.filter((p) => !hidden.has(p.group));

  function renderRows() {
    if (!asTable) return;
    const rows = shown().map((p) => p.song);
    tableBox.replaceChildren(renderTable(rows, {
      sort, onSort: (key) => { sort = { key, dir: sort.key === key ? -sort.dir : 1 }; renderRows(); },
      onOpen: (s) => { void openSong(s); },
      familyOf: (s) => (families ? (families.get(s.id) || 'Other') : ''),
    }));
  }

  const available = () => TABS.filter(([k]) => k !== 'listening' || (!isGuest() && !!listening)).map(([k]) => k);
  const effectiveTab = () => (available().includes(wanted) ? wanted : 'songs');

  function syncTabs() {
    const ok = available();
    const cur = effectiveTab();
    for (const [k, btn] of tabBtns) {
      btn.hidden = !ok.includes(k);
      btn.setAttribute('aria-selected', String(k === cur));
      btn.tabIndex = k === cur ? 0 : -1;
    }
  }

  function selectTab(k, focus = false) {
    wanted = k;
    storeSet(TAB_KEY, k);
    syncMode();
    syncListeningPoll();
    if (focus) tabBtns.get(k)?.focus();
  }

  function onTabKey(e) {
    const ok = available();
    const i = ok.indexOf(effectiveTab());
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % ok.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + ok.length) % ok.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ok.length - 1;
    if (next < 0) return;
    e.preventDefault();
    selectTab(ok[next], true);
  }

  function syncMode() {
    const cur = effectiveTab();
    const onSongs = cur === 'songs';
    syncTabs();
    songsWrap.hidden = !onSongs;
    listeningBox.hidden = cur !== 'listening';
    genresBox.hidden = cur !== 'genres';
    barEl.hidden = !onSongs;
    tableBtn.setAttribute('aria-pressed', String(asTable));
    tableBtn.textContent = asTable ? 'View as chart' : 'View as table';
    tableBox.hidden = !asTable;
    base.hidden = asTable;
    top.hidden = asTable;
    tip.hidden = true;
    resetBtn.hidden = asTable || !chart.isZoomed();
    centerBtn.hidden = asTable;
    panel.hidden = !onSongs || selected.size === 0;
    measureBar();
    if (cur === 'listening') paintListening();
    else if (cur === 'genres') paintGenreTable();
    else renderRows();
    if (onSongs && !asTable) chart.resize();
  }

  function paintListening() {
    listeningBox.replaceChildren(renderListening(listening, store.songs, (s) => { void openSong(s); }));
  }

  function documentVisible() {
    return document.visibilityState !== 'hidden';
  }

  function syncListeningPoll() {
    if (listeningPollTimer) clearTimeout(listeningPollTimer);
    listeningPollTimer = 0;
    if (dead || isGuest() || !documentVisible()) return;
    listeningPollTimer = setTimeout(async () => {
      listeningPollTimer = 0;
      await loadListening(true);
      syncListeningPoll();
    }, LISTENING_POLL_MS);
  }

  function loadListening(force = false) {
    if (dead || isGuest()) return Promise.resolve(null);
    if (listeningRequest) {
      if (force) listeningRefreshQueued = true;
      return listeningRequest;
    }
    listeningRequest = (force ? refreshListening() : getListening()).then((d) => {
      if (!dead && d) {
        const hadListening = !!listening;
        listening = d;
        if (!hadListening) syncMode();
        else if (effectiveTab() === 'listening') paintListening();
        else if (effectiveTab() === 'genres') paintGenreTable();
      }
      return d;
    }).finally(() => {
      listeningRequest = null;
      if (listeningRefreshQueued && !dead && documentVisible()) {
        listeningRefreshQueued = false;
        void loadListening(true);
      }
    });
    return listeningRequest;
  }

  function onPlaysFlushed() {
    if (documentVisible()) void loadListening(true);
  }

  function onVisibilityChange() {
    if (documentVisible()) {
      void loadListening(true);
      syncListeningPoll();
    } else {
      if (listeningPollTimer) clearTimeout(listeningPollTimer);
      listeningPollTimer = 0;
    }
  }

  function openGenre(row) {
    filterByTags([genreTag(row)]);
    prefs.never = false;
    prefs.view = 'songs';
    saveLibraryView('songs');
    location.hash = '#/library';
  }

  function paintGenreTable() {
    const { empty: none, node } = renderGenres(store.songs, listening, {
      sort: genreSort || (listening ? DEFAULT_SORT : { key: 'songs', dir: -1 }),
      query: genreQuery,
      onSort: (s) => { genreSort = s; paintGenreTable(); },
      onOpen: openGenre,
    });
    genreTools.hidden = none;
    genreHost.replaceChildren(node);
  }


  if (!isGuest()) {
    window.addEventListener('plays-flushed', onPlaysFlushed);
    document.addEventListener('visibilitychange', onVisibilityChange);
    void loadListening();
    syncListeningPoll();
  }

  function selectedSongs() {
    return points.filter((p) => selected.has(p.id)).map((p) => p.song);
  }

  function setSelected(next) {
    selected = next;
    chart.setSelected(selected);
    renderPanel();
  }

  function addSelected() {
    const { added, already, fetching } = player.addListed(selectedSongs(), '');
    const dl = fetching ? `, ${fetching} downloading` : '';
    const queued = already ? ` (${already} already in queue)` : '';
    toast(`Added ${added} ${plural(added, 'song', 'songs')}${dl}${queued}`);
  }

  function playSelected() {
    const { count, skipped: none, replaced, fetching } = player.playListed(selectedSongs(), []);
    if (!count) { toast('Nothing to play'); return; }
    const tail = (fetching ? `, ${fetching} downloading` : '') + (none ? `, ${none} without audio skipped` : '');
    toast(`Playing ${countLabel(count)}${replaced ? ' (queue replaced)' : ''}${tail}`);
  }

  function renderPanel() {
    panel.hidden = effectiveTab() !== 'songs' || selected.size === 0;
    if (!selected.size) { panel.replaceChildren(); return; }
    panel.replaceChildren(
      el('span', { class: 't-subhead st-sel' }, `${selected.size} selected:`),
      el('button', { class: 'st-act t-caption', type: 'button', disabled: true, title: 'Coming soon', 'data-act': 'library' }, 'Show in Library'),
      el('button', { class: 'icon round', type: 'button', title: 'Add to playlist', 'aria-label': 'Add to playlist', 'data-act': 'add', onclick: addSelected }, icon('playlistAdd', 'nav')),
      el('button', { class: 'key lit', type: 'button', title: 'Play', 'aria-label': 'Play', 'data-act': 'play', onclick: playSelected }, icon('play', 'nav')),
      el('button', { class: 'st-act t-caption', type: 'button', 'data-act': 'clear', onclick: () => setSelected(new Set()) }, 'Clear'));
  }

  function computeFamilies() {
    if (graph) families = songFamilies(graph, store.songs);
    else families = graphFailed ? new Map() : null;
  }

  async function fetchGraph() {
    pollTimer = 0;
    fetching = true;
    let data = null;
    try { data = await api.genreGraph(); } catch { data = null; }
    fetching = false;
    if (dead) return;
    const usable = Array.isArray(data?.nodes) && data.nodes.length > 0;
    if (usable) graph = indexGraph(data);
    const pending = shouldPoll(data?.pending, polls);
    if (pending) { polls += 1; pollTimer = setTimeout(fetchGraph, POLL_MS); }
    if (!usable && !pending && !graph) graphFailed = true;
    recolor();
  }

  function ensureGraph() {
    if (!graph && !graphFailed && !fetching && !pollTimer) void fetchGraph();
  }

  // recolours the existing points: positions, zoom and selection stay untouched
  function recolor() {
    if (mode !== 'family') return;
    computeFamilies();
    groups = assignGroups(points, mode, families);
    const keys = new Set(groups.map((g) => g.key));
    hidden = new Set([...hidden].filter((k) => keys.has(k)));
    chart.setFamilyPalette(true);
    chart.setHidden(hidden);
    renderLegend();
    syncLegend();
    renderRows();
  }

  function paintStates() {
    const loaded = store.loaded;
    empty.hidden = loaded && points.length > 0;
    empty.textContent = loaded ? EMPTY_TEXT : 'Loading songs...';
    status.textContent = loaded ? countText(points.length, store.songs.length) : '';
    note.textContent = skippedText(skipped);
    note.hidden = !skipped;
    top.setAttribute('aria-label', chartLabel(points.length));
  }

  function rebuild() {
    const split = splitPlottable(store.songs);
    skipped = split.skipped;
    points = split.plotted.map(makePoint);
    if (mode === 'family') { computeFamilies(); ensureGraph(); }
    groups = assignGroups(points, mode, families);
    const keys = new Set(groups.map((g) => g.key));
    hidden = new Set([...hidden].filter((k) => keys.has(k)));
    const ids = new Set(points.map((p) => p.id));
    selected = new Set([...selected].filter((id) => ids.has(id)));
    chart.setFamilyPalette(mode === 'family');
    chart.setData(points, hidden);
    chart.setSelected(selected);
    paintStates();
    renderLegend();
    syncLegend();
    renderPanel();
    renderRows();
    if (effectiveTab() === 'genres') paintGenreTable();
    else if (effectiveTab() === 'listening') paintListening();
  }

  const unsub = store.subscribe(() => rebuild());

  const barCl = createCollapsible({
    id: 'st-bar-body',
    collapsed: loadCollapsed(globalThis.localStorage, PANEL_KEYS.stats, window.innerWidth),
    onToggle: (v) => saveCollapsed(globalThis.localStorage, PANEL_KEYS.stats, v),
    content: [
      el('div', { class: 'st-row st-tools', title: 'Drag: select - Right-drag or Shift-drag: pan - C: center - Wheel: zoom - Double-click: reset' }, select, legendBtn, tableBtn, centerBtn, resetBtn),
      note,
      legend],
  });

  songsWrap.append(base, top, tip, live, empty, tableBox);
  const st = el('div', { class: 'st' },
pageHead('Statistics'),    el('div', { class: 'st-tabs', role: 'tablist', 'aria-label': 'Statistics views' }, ...tabBtns.values()),    el('div', { class: 'st-work' },      el('div', { class: 'st-stage' }, songsWrap, listeningBox, genresBox),
      el('div', { class: 'st-bar' },
        el('div', { class: 'st-row' }, status, barCl.button),
        barCl.root),
      panel));
  root.append(st);
  const stopInset = watchPlayerInset(st, (h) => chart.setInsetBottom(h));
  const barEl = st.querySelector('.st-bar');
  const measureBar = () => {
    const px = barEl.offsetHeight ? (barEl.offsetTop || 0) + barEl.offsetHeight + BAR_GAP : 0;
    st.style.setProperty('--st-top', `${px}px`);
    chart.setInsetTop(px);
  };
  const barRo = typeof ResizeObserver === 'function' ? new ResizeObserver(measureBar) : null;
  barRo?.observe(barEl);
  measureBar();
  syncMode();
  rebuild();

  return () => {
    dead = true;
    if (pollTimer) clearTimeout(pollTimer);
    if (listeningPollTimer) clearTimeout(listeningPollTimer);
    window.removeEventListener('plays-flushed', onPlaysFlushed);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stopInset();
    barRo?.disconnect();
    unsub();
    chart.destroy();
  };
}
