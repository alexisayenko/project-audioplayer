import { api } from './api.js';
import { el, plural, pageHead, toast } from './dom.js';
import { icon } from './icons.js';
import { familyIndex } from './genre-data.js';
import { vkey } from './genre-vocab.js';
import { filterByTags } from './library-data.js';
import { outlineDefaultOpen } from './genre-view.js';
import { layoutRadial } from './genre-radial.js';
import { createRadialView } from './genre-radial-view.js';
import { createForceView } from './genre-force-view.js';
import { sourceIcons } from './genre-sources-ui.js';
import { shadeTable } from './genre-shade.js';
import { loadLayoutFile, exportLayout } from './genre-layout-io.js';
import { isGuest } from './guest.js';
import { buildMapGraph, visibleIds, libraryCount, genreCount } from './genre-map-graph.js';
import { player } from './player.js';
import { songGenres } from './genre-playing.js';
import {
  hasLevels, buildTree, applyCounts, count, populatedFamilies, genresWithSongs, chain, ancestorIds, resolveNode, libraryTags, otherGenres, searchMatches, visibleRows, allExpandable, treeKey, filterIds, flavourCount, STATUS_FILTERS, STATUS_LABELS, statusKey,
} from './genre-levels.js';

const songs = (n) => `${n} ${plural(n, 'song', 'songs')}`;
const EMPTY_TEXT = 'No genres yet. Add songs with genres to see them here.';
const canvasLabel = (name) => {
  const of = name ? `${name} ` : '';
  return `Map of ${of}genres. Drag to pan, scroll or pinch to zoom. The outline lists the same genres and is the keyboard alternative.`;
};
const graphLabel = 'Map of all genres. Drag a circle to pull its neighbours, drag the background to pan, scroll or pinch to zoom, double-click a circle to centre it. The outline lists the same genres and is the keyboard alternative.';
const NARROW_PX = 720;
const FLASH_MS = 1400;
export const LEGEND_KEY = 'electrophone.genresLegend';
export const VIEW_KEY = 'electrophone.genresView';
export const VIEWS = ['graph', 'radial'];
export const SUB_KEY = 'electrophone.genresSubfamilies';
export function clearSubfamilies(storage) {
  try { storage?.removeItem?.(SUB_KEY); } catch { /* storage unavailable */ }
}
export const RELATED_KEY = 'electrophone.genresRelated';
export const FUSION_KEY = 'electrophone.genresFusion';
export const loadRelated = (storage) => loadFlag(storage, RELATED_KEY);
export const saveRelated = (storage, on) => saveFlag(storage, RELATED_KEY, on);
export const loadFusion = (storage) => loadFlag(storage, FUSION_KEY);
export const saveFusion = (storage, on) => saveFlag(storage, FUSION_KEY, on);

export function loadView(storage) {
  try {
    const v = storage?.getItem(VIEW_KEY);
    return VIEWS.includes(v) ? v : 'graph';
  } catch { return 'graph'; }
}

export function saveView(storage, v) {
  try { storage?.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ }
}

function failureText(v, vocab) {
  if (v.status === 'rejected') return 'Vocabulary unavailable';
  if (!hasLevels(vocab)) return 'Genre levels unavailable: the server has no level data yet';
  return 'Library unavailable: song counts are needed to show genres';
}

function loadFlag(storage, key) {
  try { return storage?.getItem(key) === '1'; } catch { return false; }
}

function saveFlag(storage, key, on) {
  try { storage?.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

export const loadLegend = (storage) => loadFlag(storage, LEGEND_KEY);
export const saveLegend = (storage, on) => saveFlag(storage, LEGEND_KEY, on);

export function renderGenresRework(root, opts = {}) {
  let rootGenre = typeof opts?.rootGenre === 'string' ? opts.rootGenre : null;
  let families = [];
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let dead = false;
  let tree = null;
  let layout = null;
  let query = '';
  let expanded = new Set();
  let activeId = null;
  let selectedId = null;
  let panelId = null;
  let rows = [];
  let statusFilter = 'all';
  const flavourSel = new Set();
  let legendOpen = loadLegend(globalThis.localStorage);
  let flashTimer = 0;
  let outlineOpen = outlineDefaultOpen(window.innerWidth || 1200);
  let kind = VIEWS.includes(opts?.view) ? opts.view : loadView(globalThis.localStorage);
  let graph = null;
  let graphFamily = null;
  let allGenres = false;
  let fusion = loadFusion(globalThis.localStorage);
  let related = loadRelated(globalThis.localStorage);
  let lastData = null;
  const subSel = new Set();
  clearSubfamilies(globalThis.localStorage);
  let savedLayout = null;
  let isOwner = false;

  const status = el('p', { class: 'gm-status t-caption', role: 'status' }, 'Loading...');
  const reload = el('button', { class: 'gm-tbtn', type: 'button', onclick: () => start() }, 'Reload');
  const canvas = el('canvas', {
    class: 'gmr-canvas', role: 'img', tabindex: '-1', hidden: kind !== 'radial',
    'aria-label': canvasLabel(rootGenre),
  });
  const graphCanvas = el('canvas', {
    class: 'gmr-canvas gmr-graph', role: 'img', tabindex: '-1', hidden: kind !== 'graph', 'aria-label': graphLabel,
  });
  const tip = el('div', { class: 'gmr-tip t-caption', role: 'tooltip', hidden: true });
  const treeEl = el('div', { class: 'gmr-tree', role: 'tree', 'aria-label': 'Genre hierarchy' });
  const details = el('div', { class: 'gmr-details gmr-info', id: 'gmr-info', role: 'group', 'aria-label': 'Genre details', hidden: true });
  const empty = el('p', { class: 'gmr-empty muted t-body', hidden: true });
  const outlineEl = el('section', { class: 'gmr-outline', id: 'gmr-outline', 'aria-label': 'Outline' });
  const side = el('div', { class: 'gmr-side', id: 'gmr-panel' });
  const outlineBtn = el('button', {
    class: 'gm-tbtn gmr-outline-btn', type: 'button', 'aria-controls': 'gmr-panel', 'aria-expanded': 'false', onclick: () => setOutline(true),
  }, 'Outline');
  const wrap = el('div', { class: 'gm gmr' });
  const work = el('div', { class: 'gm-work' });
  const familyRow = el('div', { class: 'gmr-family-row', role: 'group', 'aria-label': 'Genre family', hidden: true });
  const subRow = el('div', { class: 'gmr-sub-row', role: 'group', 'aria-label': 'Subfamily', hidden: true });
  const legendSub = el('div', { class: 'gmr-legend-sub', hidden: true });

  function setAllGenres(on, { apply = false } = {}) {
    allGenres = on;
    libBtn.setAttribute('aria-pressed', String(on));
    if (!on && graphFamily && !families.includes(graphFamily)) graphFamily = null;
    if (apply) {
      applyFilters();
      if (selectedId && !onMap(selectedId)) deselect();
    }
  }

  function renderFamilies() {
    if (kind === 'graph') {
      const all = tree ? (allGenres ? tree.roots.map((r) => r.name) : families) : [];
      familyRow.hidden = !all.length;
      familyRow.replaceChildren(...(all.length ? [el('button', {
        class: 'gm-tbtn', type: 'button', 'data-family': '', 'aria-pressed': String(!graphFamily), onclick: () => setGraphFamily(null),
      }, 'All')] : []), ...all.map((f) => el('button', {
        class: 'gm-tbtn', type: 'button', 'data-family': f, 'aria-pressed': String(f === graphFamily), onclick: () => setGraphFamily(f === graphFamily ? null : f),
      }, el('span', { class: `gm-dot f${familyIndex(f)}`, 'aria-hidden': 'true' }), f)));
      return;
    }
    familyRow.hidden = !families.length;
    familyRow.replaceChildren(...families.map((f) => el('button', {
      class: 'gm-tbtn', type: 'button', 'data-family': f, 'aria-pressed': String(f === rootGenre), onclick: () => setFamily(f),
    }, el('span', { class: `gm-dot f${familyIndex(f)}`, 'aria-hidden': 'true' }), f)));
  }
  const legendBtn = el('button', {
    class: 'gm-tbtn', type: 'button', 'aria-controls': 'gmr-legend', 'aria-expanded': String(legendOpen), onclick: () => setLegend(!legendOpen, { save: true }),
  }, legendOpen ? 'Hide legend' : 'Show legend');
  const nowBtn = el('button', { class: 'gm-tbtn gmr-now', type: 'button', hidden: true, onclick: () => showNowPlaying() }, icon('music', 'inline'), 'Now playing');

  const viewOpts = {
    reducedMotion: reduced,
    onSelect: (id) => (id ? select(id, { reveal: true, info: true }) : deselect()),
    onHover: (n, pt) => showTip(n, pt),
  };
  const radialView = createRadialView(canvas, viewOpts);
  const graphView = (opts?.forceViewFactory || createForceView)(graphCanvas, viewOpts);
  let view = kind === 'graph' ? graphView : radialView;
  const viewBtns = VIEWS.map((v) => el('button', {
    class: 'gm-tbtn', type: 'button', 'data-view': v, 'aria-pressed': String(v === kind), onclick: () => setView(v, { save: true }),
  }, v === 'graph' ? 'Graph' : 'Radial'));
  const viewRow = el('div', { class: 'gmr-view-row', role: 'group', 'aria-label': 'Map view' }, ...viewBtns);
  const libBtn = el('button', {
    class: 'gm-tbtn gmr-lib', type: 'button', 'aria-pressed': 'false', hidden: kind !== 'graph', title: 'Also show the genres that have no song in your library (this visit only)',
    onclick: () => setAllGenres(!allGenres, { apply: true }),
  }, 'All genres');
  const fusionBtn = el('button', {
    class: 'gm-tbtn gmr-fusion', type: 'button', role: 'switch', 'aria-checked': String(fusion), title: 'Also show fusion genres (blues rock, trip hop, ...) under their second family',
    onclick: () => setFusion(!fusion),
  }, 'Fusion genres');
  const resetLayoutBtn = el('button', {
    class: 'gm-tbtn gmr-layout', type: 'button', hidden: kind !== 'graph', title: 'Place the circles again with the fewest crossing lines',
    onclick: () => graphView.resetLayout?.(),
  }, 'Reset layout');
  const useSavedBtn = el('button', {
    class: 'gm-tbtn gmr-layout', type: 'button', hidden: true, title: 'Go back to the layout saved in the layout file',
    onclick: () => graphView.useSavedLayout?.(),
  }, 'Use saved layout');
  const exportBtn = el('button', {
    class: 'gm-tbtn gmr-layout', type: 'button', hidden: true, title: 'Copy the current circle positions as layout JSON (genre-layout.json)',
    onclick: () => exportLayoutNow(),
  }, 'Export layout');
  const relatedBtn = el('button', {
    class: 'gm-tbtn gmr-fusion gmr-related', type: 'button', role: 'switch', 'aria-checked': String(related), title: 'Show related genres (influences, not parents) as faint dotted lines',
    onclick: () => setRelated(!related),
  }, 'Related');

  function showTip(n, pt) {
    if (!n || !pt) { tip.hidden = true; return; }
    const r = work.getBoundingClientRect?.() || { left: 0, top: 0 };
    const t = n.node;
    tip.replaceChildren(...[
      el('strong', {}, t.label),
      el('span', {}, ` ${songs(count(t))}${t.own.size !== count(t) ? ` (${t.own.size} exactly)` : ''}`),
      t.synonyms.length ? el('span', { class: 'muted' }, ` | also: ${t.synonyms.join(', ')}`) : null,
      !t.discogs ? el('span', { class: 'muted' }, ' | not in Discogs') : null,
      t.alsoIn.length ? el('span', { class: 'muted' }, ` | also in ${otherGenres(t, kind === 'radial' ? rootGenre : t.family).join(', ')}`) : null,
      t.status === 'question' ? el('span', { class: 'muted' }, ` | ${STATUS_LABELS.question}`) : null,
    ].filter(Boolean));
    tip.style.left = `${pt.x - r.left + 12}px`;
    tip.style.top = `${pt.y - r.top + 14}px`;
    tip.hidden = false;
  }

  const narrow = () => (window.innerWidth || 1200) < NARROW_PX;

  function setOutline(open) {
    outlineOpen = open;
    side.hidden = !open;
    outlineEl.hidden = !open;
    outlineBtn.hidden = open;
    outlineBtn.setAttribute('aria-expanded', String(open));
    closeBtn.setAttribute('aria-expanded', String(open));
    wrap.classList.toggle('outline-open', open);
    if (open && narrow() && legendOpen) setLegend(false);
    syncInset();
  }

  function syncInset() {
    const inset = panelInset();
    radialView.setFocusInset(inset);
    graphView.setFocusInset(inset);
  }

  function setView(next, { save = false } = {}) {
    if (!VIEWS.includes(next) || next === kind) return;
    kind = next;
    if (save) saveView(globalThis.localStorage, next);
    for (const b of viewBtns) b.setAttribute('aria-pressed', String(b.dataset.view === next));
    canvas.hidden = next !== 'radial';
    graphCanvas.hidden = next !== 'graph';
    libBtn.hidden = next !== 'graph';
    syncLayoutButtons();
    renderSubfamilies();
    const fam = next === 'radial' && tree && selectedId ? chain(tree, selectedId)[0]?.name : null;
    if (fam && families.includes(fam)) setFamily(fam);
    legend.classList.toggle('is-graph', next === 'graph');
    view = next === 'graph' ? graphView : radialView;
    syncInset();
    view.resize();
    view.select(selectedId);
    renderFamilies();
    renderTree();
    renderStatus();
    markMatches();
  }

  function setLegend(open, { save = false } = {}) {
    legendOpen = open;
    legend.hidden = !open;
    legendBtn.setAttribute('aria-expanded', String(open));
    legendBtn.textContent = open ? 'Hide legend' : 'Show legend';
    if (save) saveLegend(globalThis.localStorage, open);
    if (open && narrow() && outlineOpen) setOutline(false);
  }

  const search = el('input', {
    class: 'gmr-search', type: 'search', placeholder: 'Find a genre or synonym', 'aria-label': 'Find a genre or synonym', autocomplete: 'off',
    oninput: () => { query = search.value; renderTree(); markMatches(); if (matchIds().length === 1) centre(matchIds()[0]); },
    onkeydown: (e) => {
      if (e.key === 'Escape') { search.value = ''; query = ''; renderTree(); markMatches(); }
      if (e.key === 'Enter' && matchIds().length) { e.preventDefault(); select(matchIds()[0], { reveal: true, center: true, info: true }); }
      if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); focusRow(activeId && rows.some((r) => r.key === activeId) ? activeId : rows[0].key); }
    },
  });
  const statusRow = el('div', { class: 'gmr-status-row', role: 'group', 'aria-label': 'Status filter' },
    el('span', { class: 't-caption muted' }, 'Status:'),
    ...STATUS_FILTERS.map((f) => el('button', {
      class: 'gm-tbtn', type: 'button', 'data-status': f, 'aria-pressed': String(f === statusFilter),
      onclick: () => setStatus(f),
    }, f)));
  const expandAll = el('button', { class: 'gm-tbtn', type: 'button', onclick: () => { if (tree) { expanded = allExpandable(tree); renderTree(); } } }, 'Expand all');
  const collapseAll = el('button', { class: 'gm-tbtn', type: 'button', onclick: () => { expanded = new Set(); renderTree(); } }, 'Collapse all');

  function setStatus(f) {
    statusFilter = f;
    for (const b of statusRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.status === f));
    applyFilters();
  }

  const subFamilyName = () => tree?.subfamilies?.[0]?.family || null;
  const subActive = () => !!subSel.size && !!subFamilyName() && (kind === 'graph' ? graphFamily === subFamilyName() : rootGenre === subFamilyName());
  const currentVisible = () => (tree ? visibleIds(tree, { family: graphFamily, libraryOnly: !allGenres, status: statusFilter, flavours: flavourSel, subfamilies: subActive() ? subSel : null }) : null);
  const radialKeep = () => {
    if (!tree) return null;
    const base = filterIds(tree, { status: statusFilter, flavours: flavourSel });
    const subs = subActive() && kind === 'radial' ? visibleIds(tree, { subfamilies: subSel }) : null;
    if (!subs) return base;
    return base ? new Set([...base].filter((id) => subs.has(id))) : subs;
  };

  function applyFilters() {
    radialView.setFilter(radialKeep());
    graphView.setVisible(currentVisible());
    renderTree();
    renderFlavours();
    renderFamilies();
    renderSubfamilies();
    renderStatus();
  }

  const familyBase = (name) => {
    try { return getComputedStyle(document.documentElement).getPropertyValue(`--chart-${familyIndex(name)}`).trim(); } catch { return ''; }
  };
  const subShades = () => shadeTable(familyBase(subFamilyName() || 'Electronic'));

  function renderSubfamilies() {
    const list = tree?.subfamilies || [];
    const fam = subFamilyName();
    const selected = kind === 'graph' ? graphFamily : rootGenre;
    const showRow = !!list.length && selected === fam;
    subRow.hidden = !showRow;
    if (!showRow) subRow.replaceChildren();
    else {
      const shades = subShades();
      subRow.replaceChildren(
        el('span', { class: 't-caption muted' }, 'Subfamily:'),
        el('button', { class: 'gm-tbtn', type: 'button', 'data-sub': '', 'aria-pressed': String(!subSel.size), onclick: () => { subSel.clear(); applyFilters(); } }, 'All'),
        ...list.map((s) => el('button', {
          class: 'gm-tbtn', type: 'button', 'data-sub': s.name, 'aria-pressed': String(subSel.has(s.name)),
          onclick: () => { if (subSel.has(s.name)) subSel.delete(s.name); else subSel.add(s.name); applyFilters(); },
        }, el('span', { class: 'gm-dot sub', style: shades[s.order] ? `background:${shades[s.order]}` : '', 'aria-hidden': 'true' }), s.name)));
    }
    renderLegendSub();
  }

  function renderLegendSub() {
    const list = tree?.subfamilies || [];
    const fam = subFamilyName();
    const on = !!list.length && (kind === 'graph' ? !graphFamily || graphFamily === fam : rootGenre === fam);
    legendSub.hidden = !on;
    if (!on) { legendSub.replaceChildren(); return; }
    const shades = subShades();
    legendSub.replaceChildren(
      el('h3', { class: 'gmr-legend-title t-caption' }, `Subfamilies of ${fam}`),
      el('ul', { class: 'gmr-legend-list t-caption' }, ...list.map((s) => el('li', { 'data-sub': s.name },
        el('span', { class: 'gmr-key sub', style: shades[s.order] ? `background:${shades[s.order]}` : '', 'aria-hidden': 'true' }), s.name))));
  }

  function setFusion(on) {
    fusion = on;
    fusionBtn.setAttribute('aria-checked', String(on));
    saveFusion(globalThis.localStorage, on);
    if (lastData) applyData();
  }

  function syncLayoutButtons() {
    const graphOn = kind === 'graph';
    resetLayoutBtn.hidden = !graphOn;
    useSavedBtn.hidden = !graphOn || !savedLayout;
    exportBtn.hidden = !graphOn || !isOwner;
  }

  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportLayoutNow() {
    const text = JSON.stringify(exportLayout(graphView.exportPositions?.() || []));
    try {
      await navigator.clipboard.writeText(text);
      toast('Layout copied to the clipboard');
    } catch {
      downloadText('genre-layout.json', text);
      toast('Layout saved as genre-layout.json');
    }
  }

  function setRelated(on) {
    related = on;
    relatedBtn.setAttribute('aria-checked', String(on));
    saveRelated(globalThis.localStorage, on);
    graphView.setRelated?.(on);
    if (tree && rootGenre) {
      layout = buildLayout();
      radialView.setLayout(layout, tree);
    }
  }

  function setGraphFamily(name) {
    graphFamily = name;
    applyFilters();
    if (selectedId && !onMap(selectedId)) deselect();
  }

  const onMap = (id) => {
    if (kind === 'radial') return !!layout?.byId.has(id);
    return !!graph?.byId.has(id) && (currentVisible()?.has(id) ?? true);
  };
  const rowOpts = () => ({
    expanded, query, onlyWithSongs: kind === 'radial' || !allGenres, status: statusFilter, flavours: flavourSel, only: kind === 'graph' ? currentVisible() : (subActive() ? visibleIds(tree, { subfamilies: subSel }) : null),
  });

  const flavourRow = el('div', { class: 'gmr-flavour-row', role: 'group', 'aria-label': 'Flavour filter', hidden: true });

  function flavourChip(f) {
    const n = flavourCount(tree, f.key);
    const described = f.description ? `${f.description} - ` : '';
    return el('button', {
      class: 'gm-tbtn gmr-flav', type: 'button', 'data-flavour': f.key, 'aria-pressed': String(flavourSel.has(f.key)),
      'aria-label': `${f.name}, ${songs(n)}`, title: `${described}${songs(n)}`,
      onclick: () => {
        if (flavourSel.has(f.key)) flavourSel.delete(f.key); else flavourSel.add(f.key);
        applyFilters();
      },
    }, f.name);
  }

  function renderFlavours() {
    const used = new Set(tree ? [...tree.byId.values()].filter((n) => kind === 'graph' || count(n)).flatMap((n) => n.flavours) : []);
    const all = tree ? [...tree.flavours.values()].filter((f) => used.has(f.key)) : [];
    flavourRow.hidden = !all.length;
    if (!all.length) { flavourRow.replaceChildren(); return; }
    const group = (kind, label) => {
      const list = all.filter((f) => f.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
      return list.length ? el('div', { class: 'gmr-flav-group', role: 'group', 'aria-label': `${label} flavours` }, el('span', { class: 't-caption muted' }, `${label}:`), ...list.map(flavourChip)) : null;
    };
    flavourRow.replaceChildren(
      group('sound', 'Sound'), group('scene', 'Scene'),
      el('button', { class: 'gm-tbtn', type: 'button', disabled: !flavourSel.size, onclick: () => { flavourSel.clear(); applyFilters(); } }, 'Clear flavours'));
  }

  const searchOpts = () => ({ populatedOnly: kind === 'radial' || !allGenres });
  function matchIds() {
    return tree && query ? [...searchMatches(tree, query, searchOpts()).keys()].filter((id) => (kind === 'radial' ? onMap(id) : graph?.byId.has(id))) : [];
  }
  function markMatches() {
    const ids = tree && query ? [...searchMatches(tree, query, searchOpts()).keys()] : [];
    radialView.setMatches(ids);
    graphView.setMatches(ids);
  }
  function panelInset() {
    const box = (e, open) => (open && !e.hidden ? e.getBoundingClientRect?.() || { width: 0, height: 0 } : { width: 0, height: 0 });
    const a = box(side, outlineOpen);
    const b = box(details, true);
    return narrow() ? { r: 0, b: Math.max(a.height, b.height) } : { r: a.width + b.width, b: 0 };
  }
  function centre(id) {
    if (!onMap(id)) return;
    view.setFocusInset(panelInset());
    view.focusNode(id);
  }

  function focusRow(id) {
    activeId = id;
    renderTree();
    const row = [...treeEl.querySelectorAll('[role="treeitem"]')].find((r) => r.dataset.id === id);
    if (row) row.focus();
  }

  function reveal(id) {
    for (const a of chain(tree, id).slice(0, -1)) expanded.add(a.id);
    if (!visibleRows(tree, rowOpts()).some((r) => r.node.id === id)) {
      query = '';
      search.value = '';
      graphFamily = null;
      if (!tree.byId.get(id)?.all.size) setAllGenres(true);
      if (statusFilter !== 'all') { statusFilter = 'all'; for (const b of statusRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.status === 'all')); }
      if (flavourSel.size) flavourSel.clear();
      applyFilters();
      markMatches();
    }
  }

  function showTotals() {
    const total = genresWithSongs(layout);
    status.textContent = `${total} ${plural(total, 'genre', 'genres')} in ${rootGenre}`;
  }

  function renderStatus() {
    if (!tree) return;
    if (kind === 'radial') { if (rootGenre) showTotals(); else status.textContent = EMPTY_TEXT; return; }
    const total = genreCount(tree);
    const mine = libraryCount(tree);
    const shownIds = kind === 'graph' ? currentVisible() : null;
    const shown = shownIds ? [...shownIds].filter((id) => tree.byId.get(id)?.level > 1).length : total;
    const libShown = visibleIds(tree, { libraryOnly: true });
    if (!allGenres && shownIds && libShown && shownIds.size === libShown.size) {
      status.textContent = `${mine} ${plural(mine, 'genre', 'genres')} in your library`;
      return;
    }
    const scope = shown === total ? '' : ` (${shown} shown)`;
    status.textContent = `${total} ${plural(total, 'genre', 'genres')}${scope}, ${mine} in your library`;
  }

  const buildLayout = () => (rootGenre ? layoutRadial(tree, rootGenre, { related }) : null);

  function setFamily(name) {
    if (name === rootGenre) return;
    rootGenre = name;
    expanded.add(`g:${name}`);
    canvas.setAttribute('aria-label', canvasLabel(name));
    for (const b of familyRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.family === name));
    if (!tree) return;
    layout = buildLayout();
    radialView.setLayout(layout, tree);
    radialView.reset();
    radialView.setFilter(radialKeep());
    renderSubfamilies();
    radialView.select(selectedId);
    markMatches();
    renderTree();
    if (kind === 'radial') renderStatus();
    renderFlavours();
  }

  function select(id, { reveal: rv = false, center = false, toggle = false, info = false } = {}) {
    const family = kind === 'radial' && tree && !layout?.byId.has(id) ? chain(tree, id)[0]?.name : null;
    if (family && families.includes(family)) setFamily(family);
    selectedId = id;
    panelId = info ? id : null;
    activeId = id;
    radialView.select(id);
    graphView.select(id);
    if (info && narrow() && outlineOpen) setOutline(false);
    if (rv) { reveal(id); graphView.select(id); }
    if (toggle) { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); }
    if (center) centre(id);
    renderTree();
    renderPanel();
    if (rv || center || toggle) focusRow(id);
  }

  function deselect() {
    selectedId = null;
    panelId = null;
    radialView.select(null);
    graphView.select(null);
    renderTree();
    renderPanel();
  }

  function badge(text, label, cls = '') {
    return el('span', { class: `gmr-badge ${cls}`.trim(), role: 'img', title: label, 'aria-label': label }, text);
  }

  function buildRow(r, i, rootName) {
    const n = r.node;
    const total = count(n);
    const kids = [
      el('span', { class: `gmr-chev${r.hasChildren ? '' : ' none'}`, 'aria-hidden': 'true' }, r.hasChildren ? icon('chevron', 'inline') : null),
      n.level === 1 ? el('span', { class: `gm-dot f${familyIndex(n.name)}`, 'aria-hidden': 'true' }) : null,
      el('span', { class: 'gmr-name' }, n.label),
      r.via ? el('span', { class: 'gmr-via t-caption muted' }, `also called ${r.via}`) : null,
      ...otherGenres(n, rootName).map((g) => badge(`also in ${g}`, `Also in ${g}`, 'alsoin')),
      n.provisional ? badge('provisional', 'Provisional: placement not reviewed yet', 'prov') : null,
      !n.discogs ? badge('not in Discogs', 'Not in Discogs', 'nodisc') : null,
      ...n.flavours.map((k) => el('span', { class: 'gmr-badge flav', title: tree.flavours.get(k).description || tree.flavours.get(k).name }, tree.flavours.get(k).name)),
      n.status === 'question' ? badge('question', STATUS_LABELS.question, 'q') : null,
      ...n.alsoUnder.map((a) => {
        const target = tree.byKey.get(vkey(a));
        if (!target || (kind === 'radial' && !count(target))) return null;
        return el('button', {
          class: 'gmr-also', type: 'button', tabindex: '-1', 'aria-label': `Parent ${target.label}: jump to ${target.label}`, title: `Parent ${target.label}`,
          onclick: (e) => { e.stopPropagation(); select(target.id, { reveal: true, center: true }); },
        }, `parent ${target.label}`);
      }),
      total ? el('span', { class: 'gmr-count t-caption', role: 'img', 'aria-label': songs(total) }, String(total)) : null,
    ];
    const attrs = {
      class: `gmr-row l${n.level}${selectedId === n.id ? ' sel' : ''}${r.matched ? ' hit' : ''}`,
      role: 'treeitem', 'data-id': r.key, 'data-node': n.id, tabindex: r.key === activeId ? '0' : '-1', 'aria-level': String(n.level),
      'aria-selected': String(selectedId === n.id), 'aria-posinset': String(i + 1), 'aria-setsize': String(rows.length),
      onclick: () => select(n.id, { center: true, toggle: r.hasChildren }),
    };
    if (r.hasChildren) attrs['aria-expanded'] = String(r.expanded);
    return el('div', attrs, kids);
  }

  function renderTree() {
    if (!tree) { treeEl.replaceChildren(); return; }
    rows = visibleRows(tree, rowOpts());
    if (!rows.length) activeId = null;
    else if (!rows.some((r) => r.key === activeId)) activeId = rows[0].key;
    let rootName = '';
    treeEl.replaceChildren(...rows.map((r, i) => {
      if (r.level === 1) rootName = r.node.name;
      return buildRow(r, i, rootName);
    }));
    empty.hidden = rows.length > 0;
    let emptyText = EMPTY_TEXT;
    if ((statusFilter !== 'all' || flavourSel.size) && !query) emptyText = 'No genres match the filters.';
    else if (query) emptyText = `No genre or synonym matches "${query.trim()}".`;
    empty.textContent = emptyText;
  }

  const chipButton = (id, label) => el('button', { class: 'gm-chip', type: 'button', onclick: () => select(id, { reveal: true, center: true, info: true }) }, label);

  function panelItems(n, total) {
    const parents = n.parentNames.map((p) => tree.byId.get(`g:${p}`) || tree.byId.get(`s:${p}`)).filter(Boolean);
    const rel = n.related.map((r) => tree.byId.get(`g:${r}`) || tree.byId.get(`s:${r}`)).filter(Boolean);
    const chips = (list) => el('span', { class: 'gm-chips' }, list.map((p) => chipButton(p.id, p.label)));
    const items = [];
    const add = (k, ...v) => items.push(el('dt', { class: 't-caption muted' }, k), el('dd', { class: 't-body' }, ...v));
    if (n.display) add('Vocabulary key', n.name);
    if (n.level > 1) add('Parents', chips(parents));
    if (n.subfamily) add('Subfamily', n.subfamily);
    add('Synonyms', n.synonyms.length ? n.synonyms.join(', ') : 'None');
    if (rel.length) add('Related', chips(rel));
    const src = sourceIcons(n.sourceLinks, n.label);
    if (src) add('Sources', src);
    if (n.level > 1 && n.status !== 'approved') add('Review', STATUS_LABELS[statusKey(n)]);
    if (n.level > 1 && n.flavours.length) add('Flavours', el('span', { class: 'gm-chips' }, n.flavours.map((k) => el('span', { class: 'gmr-badge flav', title: tree.flavours.get(k).description }, tree.flavours.get(k).name))));
    if (n.provisional) add('Status', 'Provisional: not yet reviewed');
    const exact = n.own.size !== total ? ` (${n.own.size} tagged exactly with it, the rest with genres below it)` : '';
    add('Songs', `${total} in your library${exact}`);
    return items;
  }

  function renderPanel() {
    const n = tree && panelId ? tree.byId.get(panelId) : null;
    details.hidden = !n;
    if (!n) { details.replaceChildren(); return; }
    const total = count(n);
    const items = panelItems(n, total);
    details.replaceChildren(
      el('div', { class: 'gm-panel-head' },
        n.level === 1 ? el('span', { class: `gm-dot f${familyIndex(n.name)}`, 'aria-hidden': 'true' }) : null,
        el('h3', { class: 't-headline' }, n.label),
        el('button', { class: 'gm-x', type: 'button', 'aria-label': 'Close details', title: 'Close details', onclick: () => deselect() }, icon('clear', 'nav'))),
      el('dl', { class: 'gmr-dl' }, items),
      el('button', {
        class: 'btn primary small', type: 'button', disabled: !total,
        onclick: () => { filterByTags(libraryTags(tree, n.id)); location.hash = '#/library'; },
      }, `Show ${songs(total)} in Library`));
  }

  function nowNode() {
    if (!tree) return null;
    if (kind === 'radial' && !layout) return null;
    const rootId = kind === 'radial' ? `g:${rootGenre}` : null;
    const found = new Map();
    for (const g of songGenres(player.current)) {
      const n = resolveNode(g.key, tree);
      if (n && (!rootId || ancestorIds(tree, n.id).has(rootId))) found.set(n.id, n);
    }
    const best = [...found.values()].sort((a, b) => b.level - a.level || count(b) - count(a) || a.name.localeCompare(b.name))[0];
    for (let n = best; n; n = n.parent ? tree.byId.get(n.parent) : null) if (kind === 'radial' ? layout.byId.has(n.id) : graph?.byId.has(n.id)) return n;
    return null;
  }

  function refreshNow() { nowBtn.hidden = !tree || !player.current; }

  function flashRow(id) {
    const r = [...treeEl.querySelectorAll('[role="treeitem"]')].find((x) => x.dataset.node === id);
    if (!r) return;
    r.classList.add('flash');
    r.scrollIntoView?.({ block: 'nearest' });
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => r.classList.remove('flash'), FLASH_MS);
  }

  function showNowPlaying() {
    const n = nowNode();
    if (!n) { toast(kind === 'radial' && rootGenre ? `The playing song has no ${rootGenre} genre` : 'The playing song has no genre on the map'); return; }
    if (!outlineOpen && !narrow()) setOutline(true);
    select(n.id, { reveal: true, center: true });
    view.flash(n.id);
    flashRow(n.id);
  }

  treeEl.addEventListener('keydown', (e) => {
    if (e.target?.localName === 'button') return;
    const a = treeKey(rows, activeId, e.key);
    if (!a) return;
    e.preventDefault();
    if (a.type === 'focus') { focusRow(a.id); const nid = rows.find((x) => x.key === a.id)?.node.id; if (onMap(nid)) view.select(nid); }
    else if (a.type === 'expand') { expanded.add(a.node); renderTree(); focusRow(a.id); }
    else if (a.type === 'collapse') { expanded.delete(a.node); renderTree(); focusRow(a.id); }
    else select(a.node, { center: true, toggle: a.toggle });
  });

  function start() {
    load().catch(() => {
      if (dead) return;
      reload.disabled = false;
      status.textContent = 'Failed to load';
    });
  }

  function dropStale() {
    if (selectedId && !tree.byId.has(selectedId)) selectedId = null;
    if (panelId && !tree.byId.has(panelId)) panelId = null;
    for (const k of flavourSel) if (!tree.flavours.has(k)) flavourSel.delete(k);
  }

  async function load() {
    status.textContent = 'Loading...';
    reload.disabled = true;
    const [v, l, lay] = await Promise.allSettled([api.genreVocabulary(), api.library(), loadLayoutFile()]);
    savedLayout = lay.status === 'fulfilled' ? lay.value : null;
    if (dead) return;
    reload.disabled = false;
    const vocab = v.status === 'fulfilled' ? v.value : null;
    const failed = !hasLevels(vocab) || l.status !== 'fulfilled';
    if (failed) {
      tree = null;
      layout = null;
      families = [];
      graph = null;
      renderFamilies();
      radialView.setLayout(null, null);
      graphView.setGraph({ nodes: [], links: [] });
      renderTree();
      renderPanel();
      refreshNow();
      status.textContent = failureText(v, vocab);
      return;
    }
    lastData = { vocab, lib: l.value };
    applyData();
  }

  function applyData() {
    tree = buildTree(lastData.vocab, { fusion });
    applyCounts(tree, lastData.lib);
    families = populatedFamilies(tree);
    if (!families.includes(rootGenre)) rootGenre = families[0] || null;
    if (rootGenre) expanded.add(`g:${rootGenre}`);
    canvas.setAttribute('aria-label', canvasLabel(rootGenre));
    layout = buildLayout();
    radialView.setLayout(layout, tree);
    graph = buildMapGraph(tree);
    if (graphFamily && !tree.byId.has(`g:${graphFamily}`)) graphFamily = null;
    graphView.setGraph(graph, { saved: savedLayout });
    graphView.setRelated?.(related);
    syncLayoutButtons();
    dropStale();
    radialView.select(selectedId);
    radialView.setFilter(radialKeep());
    graphView.setVisible(currentVisible());
    graphView.select(selectedId);
    renderFamilies();
    renderSubfamilies();
    markMatches();
    renderFlavours();
    renderTree();
    renderPanel();
    renderStatus();
    refreshNow();
  }

  const zoomBar = el('div', { class: 'gm-zoom', role: 'group', 'aria-label': 'Zoom' },
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => view.zoomBy(1.3) }, icon('plus', 'action')),
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => view.zoomBy(1 / 1.3) }, icon('minus', 'action')),
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Reset view', title: 'Reset view', onclick: () => view.reset() }, icon('maximize', 'action')));

  const legend = el('div', { class: 'gmr-legend', id: 'gmr-legend', role: 'group', 'aria-labelledby': 'gmr-legend-title', hidden: !legendOpen },
    el('h2', { class: 'gmr-legend-title t-caption', id: 'gmr-legend-title' }, 'Legend'),
    el('ul', { class: 'gmr-legend-list t-caption' },
      el('li', {}, el('span', { class: 'gmr-key size', 'aria-hidden': 'true' }), 'Size: songs here and below'),
      el('li', { class: 'gmr-r' }, el('span', { class: 'gmr-key neutral', 'aria-hidden': 'true' }), 'Grey: no song tagged here, shown to connect genres below'),
      el('li', { class: 'gmr-g' }, el('span', { class: 'gmr-key', 'aria-hidden': 'true' }), 'Solid, full colour: a song in your library is tagged with this genre'),
      el('li', { class: 'gmr-g' }, el('span', { class: 'gmr-key faint', 'aria-hidden': 'true' }), 'Faint: no song in your library; it only appears here as part of the vocabulary'),
      el('li', {}, el('span', { class: 'gmr-key split', 'aria-hidden': 'true' }), 'Split colour: genre belongs to several families'),
      el('li', {}, el('span', { class: 'gmr-key split', 'aria-hidden': 'true' }), 'Fusion genre (shown with the Fusion genres toggle)'),
      el('li', {}, el('span', { class: 'gmr-key nodisc', 'aria-hidden': 'true' }), 'Dashed ring: not in Discogs'),
      el('li', {}, el('span', { class: 'gmr-key q', 'aria-hidden': 'true' }), 'Question badge: under question'),
      el('li', {}, el('span', { class: 'gmr-line dotted', 'aria-hidden': 'true' }), 'Dotted: related (influence, not a parent)'),
      el('li', { class: 'gmr-g' }, el('span', { class: 'gmr-line', 'aria-hidden': 'true' }), 'Line: parent genre (a genre with several parents has a line to each)')));
  legend.classList.toggle('is-graph', kind === 'graph');
  legend.append(legendSub);

  const closeBtn = el('button', {
    class: 'gm-x', type: 'button', 'aria-label': 'Close outline', title: 'Close outline', 'aria-controls': 'gmr-panel', 'aria-expanded': 'true', onclick: () => setOutline(false),
  }, icon('clear', 'nav'));

  outlineEl.append(
    el('div', { class: 'gmr-scroll' },
      el('div', { class: 'gmr-tools' }, search, expandAll, collapseAll, statusRow, flavourRow),
      treeEl, empty));

  side.append(
    el('div', { class: 'gm-outline-head' }, el('h2', { class: 't-headline' }, 'Outline'), closeBtn),
    el('div', { class: 'gmr-bar' }, status, el('div', { class: 'gmr-btns' }, legendBtn, nowBtn, reload), el('div', { class: 'gmr-btns' }, viewRow, libBtn, fusionBtn, relatedBtn, resetLayoutBtn, useSavedBtn, exportBtn), familyRow, subRow),
    outlineEl);
  work.append(canvas, graphCanvas, side, details, outlineBtn, zoomBar, legend, tip);
  wrap.append(pageHead('Genres map'), work);
  root.append(wrap);
  setOutline(outlineOpen);
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelId && e.target !== search) deselect(); });
  const unsubPlayer = player.onChange(refreshNow);
  if (!isGuest()) api.me().then((m) => { if (!dead) { isOwner = m?.owner === true; syncLayoutButtons(); } }).catch(() => {});
  start();
  return () => {
    dead = true;
    clearTimeout(flashTimer);
    unsubPlayer();
    radialView.destroy();
    graphView.destroy();
  };
}
