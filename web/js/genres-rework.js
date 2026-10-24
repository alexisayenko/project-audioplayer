import { api } from './api.js';
import { el, pageHead, toast } from './dom.js';
import { familyIndex, isHiddenFamily, dotClass, claimMapColours } from './genre-data.js';
import { layoutRadial } from './genre-radial.js';
import { createRadialView } from './genre-radial-view.js';
import { createForceView } from './genre-force-view.js';
import { shadeTable } from './genre-shade.js';
import { loadLayoutFile, exportLayout } from './genre-layout-io.js';
import { isGuest } from './guest.js';
import { buildMapGraph, visibleIds, libraryCount, genreCount } from './genre-map-graph.js';
import { saveDrill, newDrill, drillEmpty, pruneDrill, drillVisible, clickDrill, revealDrill, collapseDrill, drillMarks } from './genre-drill.js';
import { player } from './player.js';
import { createGenreDock } from './genre-dock.js';
import { createV2InfoRenderer } from './genres-v2-info.js';
import { openGenreCard } from './lazy-ui.js';
import { onGenreFocus, takeGenreFocus } from './genre-focus.js';
import {
  buildTree, resolveNode, genreDescription, applyCounts, count, populatedFamilies, genresWithSongs, ancestorIds, searchMatches, visibleRows, allExpandable, treeKey, filterIds, modifierCount, STATUS_FILTERS,
} from './genre-levels.js';
import {
  VIEWS, clearSubfamilies, saveSelected, loadRelated, saveRelated, loadFusion, saveFusion, saveView, loadLegend, saveLegend, initialKind,
} from './genres-rework-storage.js';
import {
  songs, EMPTY_TEXT, canvasLabel, graphLabel, GROUP_TEXT, failureText, failureTextV2, emptyTreeText, graphStatusText, radialTotalText,
} from './genres-rework-text.js';
import { findNowNode } from './genres-rework-now.js';
import { buildRow } from './genres-rework-row.js';
import { createToolbar } from './genres-rework-controls.js';
import { pageTitle, createSeeAlso, createZoomBar, createLegend, createBar, createCloseButton, fillSide, workChildren } from './genres-rework-chrome.js';
import { optionString, prefersReducedMotion, initialOutlineOpen, initialDrill, initialSelected, makeLayoutStore, wrapClass } from './genres-rework-init.js';
import { settledValue, adaptVocab, loadFailed } from './genres-rework-load.js';

const NARROW_PX = 720;
const FLASH_MS = 1400;
const store = () => globalThis.localStorage;
export {
  LEGEND_KEY, VIEW_KEY, VIEWS, SUB_KEY, clearSubfamilies, RELATED_KEY, FUSION_KEY, SELECTED_KEY, loadSelected, saveSelected, loadRelated, saveRelated, loadFusion, saveFusion, loadView, saveView, loadLegend, saveLegend,
} from './genres-rework-storage.js';
export { loadDrill, saveDrill, DRILL_KEY } from './genre-drill.js';

export function renderGenresRework(root, opts = {}) {
  let rootGenre = optionString(opts?.rootGenre);
  let families = [];
  const reduced = prefersReducedMotion();
  let dead = false;
  let tree = null;
  let layout = null;
  let query = '';
  let expanded = new Set();
  let activeId = null;
  let selectedId = null;
  let rows = [];
  let statusFilter = 'all';
  const modifierSel = new Set();
  let legendOpen = loadLegend(store());
  let flashTimer = 0;
  const v2 = opts?.v2 === true;
  let outlineOpen = initialOutlineOpen(v2);
  let kind = initialKind(v2, opts, store());
  let graph = null;
  let graphFamily = null;
  let allGenres = v2;
  let drill = initialDrill(v2, store());
  const drillState = newDrill();
  let fusion = loadFusion(store());
  let related = loadRelated(store());
  let lastData = null;
  let pendingSelected = initialSelected(v2, store());
  const subSel = new Set();
  clearSubfamilies(store());
  let savedLayout = null;
  let isOwner = false;
  const layoutStore = makeLayoutStore(v2);
  let userLayout = null;

  const status = el('p', { class: 'gm-status t-caption', role: 'status' }, 'Loading...');
  const reload = el('button', { class: 'gm-tbtn', type: 'button', onclick: () => start() }, 'Reload');
  const canvas = el('canvas', {
    class: 'gmr-canvas', role: 'img', tabindex: '-1', hidden: kind !== 'radial',
    'aria-label': canvasLabel(rootGenre),
  });
  const graphCanvas = el('canvas', {
    class: 'gmr-canvas gmr-graph', role: 'img', tabindex: '-1', hidden: kind !== 'graph', 'aria-label': graphLabel,
  });
  const treeEl = el('div', { class: 'gmr-tree', role: 'tree', 'aria-label': 'Genre hierarchy' });
  const empty = el('p', { class: 'gmr-empty muted t-body', hidden: true });
  const outlineEl = el('section', { class: 'gmr-outline', id: 'gmr-outline', 'aria-label': 'Outline' });
  const side = el('div', { class: 'gmr-side', id: 'gmr-panel' });
  const outlineBtn = el('button', {
    class: 'gm-tbtn gmr-outline-btn', type: 'button', 'aria-controls': 'gmr-panel', 'aria-expanded': 'false', onclick: () => setOutline(true),
  }, 'Outline');
  const wrap = el('div', { class: wrapClass(opts, v2) });
  const work = el('div', { class: 'gm-work' });
  const familyRow = el('div', { class: 'gmr-family-row', role: 'group', 'aria-label': 'Genre family', hidden: true });
  const subRow = el('div', { class: 'gmr-sub-row', role: 'group', 'aria-label': 'Subfamily', hidden: true });
  const legendSub = el('div', { class: 'gmr-legend-sub', hidden: true });
  const groupNote = el('p', { class: 'gmr-group-note t-caption', role: 'note', hidden: true });

  const previewName = el('button', { class: 'gmr-preview-name t-headline', type: 'button', title: 'Open the genre card', onclick: (e) => openCard(e.currentTarget) });
  const previewDesc = el('p', { class: 'gmr-preview-desc t-caption muted' });
  const previewOpen = el('button', { class: 'gm-tbtn gmr-preview-open', type: 'button', onclick: (e) => openCard(e.currentTarget) }, 'Open card');
  const preview = el('div', { class: 'gmr-preview', role: 'group', 'aria-label': 'Selected genre', hidden: true }, previewName, previewDesc, previewOpen);

  function openCard(opener) {
    const n = tree && selectedId ? tree.byId.get(selectedId) : null;
    if (n && !n.group) void openGenreCard(n.name, opener);
  }

  function renderPreview(n) {
    const on = !!n && !n.group;
    preview.hidden = !on;
    if (!on) return;
    previewName.textContent = n.label;
    previewDesc.textContent = genreDescription(n) || 'No description yet.';
  }

  function applyFocusRequest() {
    if (!tree) return;
    const want = takeGenreFocus();
    if (!want) return;
    const n = resolveNode(want, tree);
    if (!n) { toast(`${want} is not on the map`); return; }
    if (!outlineOpen) setOutline(true);
    select(n.id, { reveal: true, center: true });
  }

  const seeAlso = createSeeAlso();

  function renderGroupNote() {
    const n = tree && selectedId ? tree.byId.get(selectedId) : null;
    if (dock) dock.show(n ? n.name : null, n?.label);
    else renderPreview(n);
    groupNote.hidden = !n?.group;
    groupNote.textContent = n?.group ? GROUP_TEXT(n) : '';
  }

  function setAllGenres(on, { apply = false } = {}) {
    allGenres = on;
    libBtn.setAttribute('aria-pressed', String(on));
    if (!on && graphFamily && !families.includes(graphFamily)) graphFamily = null;
    if (apply) {
      applyFilters();
      if (selectedId && !onMap(selectedId)) deselect();
    }
  }

  const labelOf = (name) => tree?.byId.get(`g:${name}`)?.label || name;

  const graphFamilyNames = () => {
    if (!tree) return [];
    return allGenres ? tree.roots.map((r) => r.name) : families;
  };

  function renderFamilies() {
    if (kind === 'graph' && drill) {
      familyRow.hidden = true;
      familyRow.replaceChildren();
      return;
    }
    if (kind === 'graph') {
      const all = graphFamilyNames();
      familyRow.hidden = !all.length;
      familyRow.replaceChildren(...(all.length ? [el('button', {
        class: 'gm-tbtn', type: 'button', 'data-family': '', 'aria-pressed': String(!graphFamily), onclick: () => setGraphFamily(null),
      }, 'All')] : []), ...all.map((f) => el('button', {
        class: 'gm-tbtn', type: 'button', 'data-family': f, 'aria-pressed': String(f === graphFamily), onclick: () => setGraphFamily(f === graphFamily ? null : f),
      }, el('span', { class: dotClass(familyIndex(f)), 'aria-hidden': 'true' }), labelOf(f))));
      return;
    }
    familyRow.hidden = !families.length;
    familyRow.replaceChildren(...families.map((f) => el('button', {
      class: 'gm-tbtn', type: 'button', 'data-family': f, 'aria-pressed': String(f === rootGenre), onclick: () => setFamily(f),
    }, el('span', { class: dotClass(familyIndex(f)), 'aria-hidden': 'true' }), labelOf(f))));
  }

  function canvasSelect(id) {
    if (id && drillOn()) {
      drillClick(id);
      select(id, { reveal: true, map: true });
      return;
    }
    if (id) {
      select(id, { reveal: true });
      return;
    }
    if (drillOn()) collapseMap();
    deselect();
  }

  const viewOpts = {
    reducedMotion: reduced,
    rigid: true,
    onMoved: () => layoutStore?.touch(),
    onSelect: canvasSelect,
  };
  const radialView = createRadialView(canvas, viewOpts);
  const graphView = (opts?.forceViewFactory || createForceView)(graphCanvas, viewOpts);
  let view = kind === 'graph' ? graphView : radialView;

  const toolbar = createToolbar({ kind, legendOpen, drill, fusion, related }, {
    toggleLegend: () => setLegend(!legendOpen, { save: true }),
    showNowPlaying: () => showNowPlaying(),
    setView: (v) => setView(v, { save: true }),
    toggleAllGenres: () => setAllGenres(!allGenres, { apply: true }),
    toggleDrill: () => setDrill(!drill, { save: true }),
    collapseMap: () => collapseMap(),
    toggleFusion: () => setFusion(!fusion),
    toggleRelated: () => setRelated(!related),
    resetLayout: () => { graphView.resetLayout?.(); void layoutStore?.clear(); },
    useSavedLayout: () => graphView.useSavedLayout?.(),
    exportLayout: () => exportLayoutNow(),
  });
  const { legendBtn, nowBtn, viewBtns, libBtn, drillBtn, collapseMapBtn, fusionBtn, relatedBtn, resetLayoutBtn, useSavedBtn, exportBtn } = toolbar;

  const narrow = () => (window.innerWidth || 1200) < NARROW_PX;

  const dotFor = (name) => dotClass(familyIndex((tree && resolveNode(name, tree))?.family || name));

  function selectByName(name) {
    const n = tree && resolveNode(name, tree);
    if (n) select(n.id, { reveal: true, center: true });
  }

  function makeDock() {
    if (opts?.dock !== true) return null;
    return createGenreDock({
      renderInfo: v2 ? createV2InfoRenderer(() => lastData?.vocab?.v2, dotFor) : undefined,
      dotFor: v2 ? dotFor : undefined,
      storage: store(),
      narrow,
      onNavigate: selectByName,
      onMap: (n) => selectByName(n.name),
      onExpand: () => { if (narrow() && outlineOpen) setOutline(false); },
    });
  }

  const dock = makeDock();

  function setOutline(open) {
    if (v2) { syncInset(); return; }
    outlineOpen = open;
    side.hidden = !open;
    outlineEl.hidden = !open;
    outlineBtn.hidden = open;
    outlineBtn.setAttribute('aria-expanded', String(open));
    closeBtn.setAttribute('aria-expanded', String(open));
    wrap.classList.toggle('outline-open', open);
    if (open && narrow() && legendOpen) setLegend(false);
    if (dock && open && narrow() && !dock.isCollapsed()) dock.setCollapsed(true);
    syncInset();
  }

  function syncInset() {
    const inset = panelInset();
    radialView.setFocusInset(inset);
    graphView.setFocusInset(inset);
  }

  function familyFor(id) {
    const n = tree?.byId.get(id);
    if (!n) return null;
    const own = n.level === 1 ? [n.name] : n.fams;
    const open = own.filter((f) => families.includes(f));
    return open.includes(rootGenre) ? rootGenre : open[0] || null;
  }

  function setView(next, { save = false } = {}) {
    if (!VIEWS.includes(next) || next === kind) return;
    kind = next;
    if (save) saveView(store(), next);
    for (const b of viewBtns) b.setAttribute('aria-pressed', String(b.dataset.view === next));
    canvas.hidden = next !== 'radial';
    graphCanvas.hidden = next !== 'graph';
    libBtn.hidden = next !== 'graph';
    syncDrillUi();
    syncLayoutButtons();
    renderSubfamilies();
    const fam = next === 'radial' && tree && selectedId ? familyFor(selectedId) : null;
    if (fam) setFamily(fam);
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
    if (save) saveLegend(store(), open);
    if (open && narrow() && outlineOpen) setOutline(false);
  }

  function onSearchInput() {
    query = search.value;
    renderTree();
    markMatches();
    if (matchIds().length === 1) centre(matchIds()[0]);
  }

  function onSearchKey(e) {
    if (e.key === 'Escape') { search.value = ''; query = ''; renderTree(); markMatches(); }
    if (e.key === 'Enter' && matchIds().length) { e.preventDefault(); select(matchIds()[0], { reveal: true, center: true }); }
    if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); focusRow(activeId && rows.some((r) => r.key === activeId) ? activeId : rows[0].key); }
  }

  const search = el('input', {
    class: 'gmr-search', type: 'search', placeholder: 'Find a genre or synonym', 'aria-label': 'Find a genre or synonym', autocomplete: 'off',
    oninput: onSearchInput,
    onkeydown: onSearchKey,
  });
  const statusRow = el('div', { class: 'gmr-status-row', role: 'group', 'aria-label': 'Status filter' },
    el('span', { class: 't-caption muted' }, 'Status:'),
    ...STATUS_FILTERS.map((f) => el('button', {
      class: 'gm-tbtn', type: 'button', 'data-status': f, 'aria-pressed': String(f === statusFilter),
      onclick: () => setStatus(f),
    }, f)));

  function expandEverything() {
    if (!tree) return;
    expanded = allExpandable(tree);
    renderTree();
  }

  function collapseEverything() {
    expanded = new Set();
    renderTree();
  }

  const expandAll = el('button', { class: 'gm-tbtn', type: 'button', onclick: expandEverything }, 'Expand all');
  const collapseAll = el('button', { class: 'gm-tbtn', type: 'button', onclick: collapseEverything }, 'Collapse all');

  function setStatus(f) {
    statusFilter = f;
    for (const b of statusRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.status === f));
    applyFilters();
  }

  const subFamilyName = () => tree?.subfamilies?.[0]?.family || null;
  const subActive = () => !!subSel.size && !!subFamilyName() && (kind === 'graph' ? graphFamily === subFamilyName() : rootGenre === subFamilyName());
  const baseVisible = () => (tree ? visibleIds(tree, { family: drill ? null : graphFamily, libraryOnly: !allGenres, status: statusFilter, modifiers: modifierSel, subfamilies: subActive() ? subSel : null }) : null);
  const currentVisible = () => {
    const base = baseVisible();
    return drill && tree && graph ? drillVisible(tree, graph, drillState, base) : base;
  };
  const drillOn = () => drill && kind === 'graph';

  function syncDrillUi() {
    drillBtn.hidden = kind !== 'graph';
    drillBtn.setAttribute('aria-pressed', String(drill));
    collapseMapBtn.hidden = !drillOn();
    collapseMapBtn.disabled = drillEmpty(drillState);
  }

  function syncMap() {
    const vis = currentVisible();
    if (drill) {
      graphView.setVisible(vis, { heat: 0.4, keepCamera: true, chained: true });
      graphView.setMarks?.(tree && graph ? drillMarks(graph, drillState, baseVisible(), vis) : new Map());
    } else {
      graphView.setVisible(vis);
      graphView.setMarks?.(new Map());
    }
    syncDrillUi();
    renderStatus();
  }

  function drillClick(id) {
    if (clickDrill(tree, graph, drillState, id, baseVisible())) syncMap();
  }

  function collapseMap() {
    if (collapseDrill(drillState)) syncMap();
    if (selectedId && !onMap(selectedId)) deselect();
  }

  function setDrill(on, { save = false } = {}) {
    drill = on;
    if (save) saveDrill(store(), on);
    if (on) graphFamily = null;
    syncDrillUi();
    if (!tree) return;
    applyFilters();
    if (selectedId && !onMap(selectedId)) deselect();
  }
  const radialKeep = () => {
    if (!tree) return null;
    const base = filterIds(tree, { status: statusFilter, modifiers: modifierSel });
    const subs = subActive() && kind === 'radial' ? visibleIds(tree, { subfamilies: subSel }) : null;
    if (!subs) return base;
    return base ? new Set([...base].filter((id) => subs.has(id))) : subs;
  };

  function applyFilters() {
    radialView.setFilter(radialKeep());
    syncMap();
    renderTree();
    renderModifiers();
    renderFamilies();
    renderSubfamilies();
    renderStatus();
  }

  const familyBase = (name) => {
    try { return getComputedStyle(document.documentElement).getPropertyValue(`--chart-${familyIndex(name)}`).trim(); } catch { return ''; }
  };
  const subShades = () => shadeTable(familyBase(subFamilyName() || ''));

  function toggleSub(name) {
    if (subSel.has(name)) subSel.delete(name);
    else subSel.add(name);
    applyFilters();
  }

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
          onclick: () => toggleSub(s.name),
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
    saveFusion(store(), on);
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
    saveRelated(store(), on);
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
  const onlyIds = () => {
    if (kind === 'graph') return baseVisible();
    return subActive() ? visibleIds(tree, { subfamilies: subSel }) : null;
  };
  const rowOpts = () => ({
    expanded, query, onlyWithSongs: kind === 'radial' || !allGenres, status: statusFilter, modifiers: modifierSel, only: onlyIds(),
  });

  const modifierRow = el('div', { class: 'gmr-modifier-row', role: 'group', 'aria-label': 'Modifier filter', hidden: true });

  function modifierChip(f) {
    const n = modifierCount(tree, f.key);
    const described = f.description ? `${f.description} - ` : '';
    return el('button', {
      class: 'gm-tbtn gmr-mod', type: 'button', 'data-modifier': f.key, 'aria-pressed': String(modifierSel.has(f.key)),
      'aria-label': `${f.name}, ${songs(n)}`, title: `${described}${songs(n)}`,
      onclick: () => {
        if (modifierSel.has(f.key)) modifierSel.delete(f.key); else modifierSel.add(f.key);
        applyFilters();
      },
    }, f.name);
  }

  function renderModifiers() {
    const used = new Set(tree ? [...tree.byId.values()].filter((n) => kind === 'graph' || count(n)).flatMap((n) => n.modifiers) : []);
    const all = tree ? [...tree.modifiers.values()].filter((f) => used.has(f.key)) : [];
    modifierRow.hidden = !all.length;
    if (!all.length) { modifierRow.replaceChildren(); return; }
    const group = (kind, label) => {
      const list = all.filter((f) => f.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
      return list.length ? el('div', { class: 'gmr-mod-group', role: 'group', 'aria-label': `${label} modifiers` }, el('span', { class: 't-caption muted' }, `${label}:`), ...list.map(modifierChip)) : null;
    };
    modifierRow.replaceChildren(
      ...[group('sound', 'Sound'), group('mood', 'Mood'), group('scene', 'Scene')].filter(Boolean),
      el('button', { class: 'gm-tbtn', type: 'button', disabled: !modifierSel.size, onclick: () => { modifierSel.clear(); applyFilters(); } }, 'Clear modifiers'));
  }

  const searchOpts = () => ({ populatedOnly: kind === 'radial' || !allGenres });
  function matchIds() {
    return tree && query ? [...searchMatches(tree, query, searchOpts()).keys()].filter((id) => (kind === 'radial' ? onMap(id) : graph?.byId.has(id))) : [];
  }
  const hiddenSel = () => {
    const n = tree && selectedId ? tree.byId.get(selectedId) : null;
    return n?.level === 1 && isHiddenFamily(n.name) ? n : null;
  };
  function markMatches() {
    const ids = tree && query ? [...searchMatches(tree, query, searchOpts()).keys()] : [];
    radialView.setMatches(ids);
    const h = hiddenSel();
    graphView.setMatches(h ? [...new Set([...ids, ...h.children.filter((c) => kind === 'graph' && onMap(c.id)).map((c) => c.id)])] : ids);
  }
  function panelInset() {
    const box = (e, open) => (open && !e.hidden ? e.getBoundingClientRect?.() || { width: 0, height: 0 } : { width: 0, height: 0 });
    const a = box(side, outlineOpen);
    return narrow() ? { r: 0, b: a.height } : { r: a.width, b: 0 };
  }
  function centre(id) {
    const n = tree?.byId.get(id);
    if (kind === 'graph' && n?.level === 1 && isHiddenFamily(n.name)) {
      const best = n.children.filter((c) => onMap(c.id)).sort((a, b) => count(b) - count(a))[0];
      if (best) { view.setFocusInset(panelInset()); view.focusNode(best.id); }
      return;
    }
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

  function resetStatusFilter() {
    statusFilter = 'all';
    for (const b of statusRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.status === 'all'));
  }

  function reveal(id) {
    for (const a of ancestorIds(tree, id)) if (a !== id) expanded.add(a);
    if (visibleRows(tree, rowOpts()).some((r) => r.node.id === id)) return;
    query = '';
    search.value = '';
    graphFamily = null;
    if (!tree.byId.get(id)?.all.size) setAllGenres(true);
    if (statusFilter !== 'all') resetStatusFilter();
    if (modifierSel.size) modifierSel.clear();
    applyFilters();
    markMatches();
  }

  function showTotals() {
    status.textContent = radialTotalText(genresWithSongs(layout), labelOf(rootGenre));
  }

  const levelsBelowFamilies = (ids) => [...ids].filter((id) => tree.byId.get(id)?.level > 1).length;

  function graphStatus() {
    const total = genreCount(tree);
    const shownIds = baseVisible();
    const libShown = visibleIds(tree, { libraryOnly: true });
    return graphStatusText({
      total,
      mine: libraryCount(tree),
      shown: shownIds ? levelsBelowFamilies(shownIds) : total,
      onMapNow: drillOn() ? `, ${levelsBelowFamilies(currentVisible())} on the map` : '',
      libraryOnly: !allGenres && !!libShown && shownIds?.size === libShown.size,
    });
  }

  function renderStatus() {
    if (!tree) return;
    if (kind !== 'radial') {
      status.textContent = graphStatus();
      return;
    }
    if (rootGenre) showTotals();
    else status.textContent = EMPTY_TEXT;
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
    renderModifiers();
  }

  function select(id, { reveal: rv = false, center = false, toggle = false, map = false } = {}) {
    if (drill && tree && !map && revealDrill(tree, graph, drillState, id, baseVisible())) syncMap();
    const family = kind === 'radial' && tree && !layout?.byId.has(id) ? familyFor(id) : null;
    if (family) setFamily(family);
    selectedId = id;
    activeId = id;
    if (v2) saveSelected(store(), tree?.byId.get(id)?.name);
    renderGroupNote();
    radialView.select(id);
    graphView.select(id);
    markMatches();
    if (rv) { reveal(id); graphView.select(id); }
    if (toggle) { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); }
    if (center) centre(id);
    renderTree();
    if (rv || center || toggle) focusRow(id);
  }

  function deselect() {
    selectedId = null;
    if (v2) saveSelected(store(), null);
    renderGroupNote();
    radialView.select(null);
    graphView.select(null);
    markMatches();
    renderTree();
  }

  function renderTree() {
    if (!tree) { treeEl.replaceChildren(); return; }
    rows = visibleRows(tree, rowOpts());
    if (!rows.length) activeId = null;
    else if (!rows.some((r) => r.key === activeId)) activeId = rows[0].key;
    const ctx = { tree, kind, selectedId, activeId, rowCount: rows.length, labelOf, select };
    let rootName = '';
    treeEl.replaceChildren(...rows.map((r, i) => {
      if (r.level === 1) rootName = r.node.name;
      return buildRow(r, i, ctx, rootName);
    }));
    empty.hidden = rows.length > 0;
    empty.textContent = emptyTreeText(!!(statusFilter !== 'all' || modifierSel.size), query);
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
    const n = findNowNode({ tree, song: player.current, kind, layout, graph, rootGenre });
    if (!n) { toast(kind === 'radial' && rootGenre ? `The playing song has no ${rootGenre} genre` : 'The playing song has no genre on the map'); return; }
    if (!outlineOpen && !narrow()) setOutline(true);
    select(n.id, { reveal: true, center: true });
    view.flash(n.id);
    flashRow(n.id);
  }

  function applyTreeAction(a) {
    if (a.type === 'focus') {
      focusRow(a.id);
      const nid = rows.find((x) => x.key === a.id)?.node.id;
      if (onMap(nid)) view.select(nid);
    } else if (a.type === 'expand') {
      expanded.add(a.node);
      renderTree();
      focusRow(a.id);
    } else if (a.type === 'collapse') {
      expanded.delete(a.node);
      renderTree();
      focusRow(a.id);
    } else select(a.node, { center: true, toggle: a.toggle });
  }

  function onTreeKey(e) {
    if (e.target?.localName === 'button') return;
    const a = treeKey(rows, activeId, e.key);
    if (!a) return;
    e.preventDefault();
    applyTreeAction(a);
  }

  treeEl.addEventListener('keydown', onTreeKey);

  function start() {
    load().catch(() => {
      if (dead) return;
      reload.disabled = false;
      status.textContent = 'Failed to load';
    });
  }

  function dropStale() {
    if (selectedId && !tree.byId.has(selectedId)) selectedId = null;
    for (const k of modifierSel) if (!tree.modifiers.has(k)) modifierSel.delete(k);
  }

  const fetchVocab = () => (v2 ? api.genresV2() : api.genreVocabulary());

  function fetchLayout() {
    if (!v2) return loadLayoutFile();
    return layoutStore ? layoutStore.sync() : Promise.resolve(null);
  }

  function rememberLayout(result) {
    const value = settledValue(result);
    if (v2) userLayout = value;
    else savedLayout = value;
  }

  function showLoadFailure(v, vocab) {
    tree = null;
    layout = null;
    families = [];
    graph = null;
    renderFamilies();
    radialView.setLayout(null, null);
    graphView.setGraph({ nodes: [], links: [] });
    renderTree();
    refreshNow();
    status.textContent = v2 ? failureTextV2(v, vocab) : failureText(v, vocab);
  }

  async function load() {
    status.textContent = 'Loading...';
    reload.disabled = true;
    const [v, l, lay] = await Promise.allSettled([fetchVocab(), api.library(), fetchLayout()]);
    rememberLayout(lay);
    if (dead) return;
    reload.disabled = false;
    const vocab = adaptVocab(v2, settledValue(v));
    if (loadFailed(v2, vocab, l)) { showLoadFailure(v, vocab); return; }
    lastData = { vocab, lib: l.value };
    applyData();
  }

  function applyData() {
    tree = buildTree(lastData.vocab, { fusion });
    claimMapColours();
    applyCounts(tree, lastData.lib);
    families = populatedFamilies(tree);
    if (!families.includes(rootGenre)) rootGenre = families[0] || null;
    if (rootGenre) expanded.add(`g:${rootGenre}`);
    canvas.setAttribute('aria-label', canvasLabel(rootGenre));
    layout = buildLayout();
    radialView.setLayout(layout, tree);
    graph = buildMapGraph(tree);
    pruneDrill(drillState, graph);
    if (graphFamily && !tree.byId.has(`g:${graphFamily}`)) graphFamily = null;
    if (layoutStore) userLayout = layoutStore.current();
    graphView.setGraph(graph, v2 ? { saved: userLayout?.size ? userLayout : null, moved: userLayout } : { saved: savedLayout });
    graphView.setRelated?.(related);
    syncLayoutButtons();
    dropStale();
    renderGroupNote();
    radialView.select(selectedId);
    radialView.setFilter(radialKeep());
    syncMap();
    graphView.select(selectedId);
    renderFamilies();
    renderSubfamilies();
    markMatches();
    renderModifiers();
    renderTree();
    renderStatus();
    refreshNow();
    restoreSelected();
    applyFocusRequest();
  }

  function restoreSelected() {
    const name = pendingSelected;
    pendingSelected = null;
    if (!name || selectedId) return;
    const n = resolveNode(name, tree);
    if (n) select(n.id, { reveal: true });
  }

  const zoomBar = createZoomBar(() => view);
  const legend = createLegend(legendOpen, kind, legendSub);
  const closeBtn = createCloseButton(() => setOutline(false));
  const barEl = createBar({ status, bar: toolbar, reload, familyRow, subRow, groupNote, preview: dock ? null : preview });

  fillSide({ v2, side, barEl, outlineEl, search, modifierRow, seeAlso, expandAll, collapseAll, statusRow, treeEl, empty, closeBtn });
  work.append(...workChildren({ v2, dock, canvas, graphCanvas, side, outlineBtn, zoomBar, legend }));
  wrap.append(pageHead(pageTitle(v2, dock)), work);
  root.append(wrap);
  setOutline(outlineOpen);

  function onWrapKey(e) {
    if (e.key !== 'Escape' || e.target === search) return;
    if (drillOn() && !drillEmpty(drillState)) collapseMap();
  }

  wrap.addEventListener('keydown', onWrapKey);
  const unsubPlayer = player.onChange(refreshNow);
  const unsubFocus = onGenreFocus(applyFocusRequest);
  if (!isGuest()) api.me().then((m) => { if (!dead) { isOwner = m?.owner === true; syncLayoutButtons(); } }).catch(() => {});
  layoutStore?.attach({ collect: () => graphView.movedPositions?.() || new Map(), known: (id) => !!graph?.nodes.some((n) => n.id === id) });
  start();
  return () => {
    dead = true;
    layoutStore?.dispose();
    clearTimeout(flashTimer);
    unsubPlayer();
    unsubFocus();
    dock?.destroy();
    radialView.destroy();
    graphView.destroy();
  };
}

export const renderGenresMapV2 = (root) => renderGenresRework(root, { dock: true, v2: true });
