import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { el, toast, plural } from './dom.js';
import { titleNodes, displayString } from './display-title.js';
import { storeGet, storeSet } from './storage.js';
import { indexGraph } from './genre-data.js';
import { songGenres } from './genre-playing.js';
import { POLL_MS, shouldPoll } from './genre-view.js';
import { createChart } from './stats-chart.js';
import { watchPlayerInset } from './player-inset.js';
import { renderTable } from './stats-table.js';
import {
  COLOR_MODES, DEFAULT_MODE, PALETTE_SIZE, FAMILY_PALETTE_SIZE, splitPlottable, makePoint, assignGroups, colorIndex, songFamilies, countText, skippedText, chartLabel,
} from './stats-data.js';

const MODE_KEY = 'stats.color';
const EMPTY_TEXT = 'Songs need a year and a BPM to appear here';

const RESOLVING_TEXT = 'Resolving genre families...';

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
  const name = family ? '--gf' : '--st';
  return el('span', { class: 'st-sw', style: `background: var(${i < 0 ? '--st-n' : `${name}-${i}`})`, 'aria-hidden': 'true' });
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
  let fetching = false;
  let legendOpen = true;
  let asTable = false;
  let sort = { key: 'year', dir: 1 };
  let dead = false;

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
    onFocus: (p) => { live.textContent = `${displayString(p.song)}, ${p.song.artist || 'unknown artist'}, ${p.year}, ${p.bpm} BPM`; },
    onView: () => syncReset(),
  });

  const select = el('select', {
    class: 'st-select', 'aria-label': 'Colour by',
    onchange: (e) => { mode = e.target.value; storeSet(MODE_KEY, mode); hidden = new Set(); rebuild(); },
  }, COLOR_MODES.map(([k, label]) => el('option', { value: k, selected: k === mode }, label)));
  const legendBtn = el('button', {
    class: 'st-btn', type: 'button', 'aria-expanded': 'true', 'aria-controls': 'st-legend',
    onclick: () => { legendOpen = !legendOpen; syncLegend(); },
  }, 'Legend');
  const tableBtn = el('button', {
    class: 'st-btn', type: 'button', 'aria-pressed': 'false',
    onclick: () => { asTable = !asTable; syncMode(); },
  }, 'View as table');
  const centerBtn = el('button', { class: 'st-btn', type: 'button', 'aria-label': 'Center chart', title: 'Center chart (C)', onclick: () => chart.center() }, '⌖');
  const resetBtn = el('button', { class: 'st-btn', type: 'button', hidden: true, onclick: () => chart.reset() }, 'Reset');

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
      el('span', {}, p.song.artist || ''),
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

  function syncMode() {
    tableBtn.setAttribute('aria-pressed', String(asTable));
    tableBtn.textContent = asTable ? 'View as chart' : 'View as table';
    tableBox.hidden = !asTable;
    base.hidden = asTable;
    top.hidden = asTable;
    tip.hidden = true;
    resetBtn.hidden = asTable || !chart.isZoomed();
    centerBtn.hidden = asTable;
    renderRows();
    if (!asTable) chart.resize();
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
    toast(`Added ${added} ${plural(added, 'song', 'songs')}${dl}${already ? ` (${already} already in queue)` : ''}`);
  }

  function playSelected() {
    const { count, skipped: none, replaced, fetching } = player.playListed(selectedSongs(), []);
    if (!count) { toast('Nothing to play'); return; }
    const tail = (fetching ? `, ${fetching} downloading` : '') + (none ? `, ${none} without audio skipped` : '');
    toast(`Playing ${countLabel(count)}${replaced ? ' (queue replaced)' : ''}${tail}`);
  }

  function renderPanel() {
    panel.hidden = selected.size === 0;
    if (!selected.size) { panel.replaceChildren(); return; }
    panel.replaceChildren(
      el('span', { class: 't-subhead st-sel' }, `${selected.size} selected:`),
      el('button', { class: 'st-act', type: 'button', disabled: true, title: 'Coming soon', 'data-act': 'library' }, 'Show in Library'),
      el('button', { class: 'st-act', type: 'button', 'data-act': 'add', onclick: addSelected }, 'Add to playlist'),
      el('button', { class: 'st-act', type: 'button', 'data-act': 'play', onclick: playSelected }, 'Play'),
      el('button', { class: 'st-act', type: 'button', 'data-act': 'clear', onclick: () => setSelected(new Set()) }, 'Clear'));
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
  }

  const unsub = store.subscribe(() => rebuild());

  const st = el('div', { class: 'st' },
    el('div', { class: 'st-stage' }, base, top, tip, live, empty, tableBox),
    el('div', { class: 'st-bar' },
      el('div', { class: 'st-row' }, el('h1', { class: 'st-title' }, 'Song stats'), status),
      el('div', { class: 'st-row st-tools', title: 'Drag: select - Right-drag or Shift-drag: pan - C: center - Wheel: zoom - Double-click: reset' }, select, legendBtn, tableBtn, centerBtn, resetBtn),
      note,
      legend),
    panel);
  root.append(st);
  const stopInset = watchPlayerInset(st, (h) => chart.setInsetBottom(h));
  syncMode();
  rebuild();

  return () => {
    dead = true;
    if (pollTimer) clearTimeout(pollTimer);
    stopInset();
    unsub();
    chart.destroy();
  };
}
