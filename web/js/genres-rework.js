import { api } from './api.js';
import { el, plural, pageHead, toast } from './dom.js';
import { icon } from './icons.js';
import { familyIndex } from './genre-data.js';
import { vkey } from './genre-vocab.js';
import { filterByTags } from './library-data.js';
import { outlineDefaultOpen } from './genre-view.js';
import { layoutRadial } from './genre-radial.js';
import { createRadialView } from './genre-radial-view.js';
import { player } from './player.js';
import { songGenres } from './genre-playing.js';
import {
  hasLevels, buildTree, applyCounts, count, populatedFamilies, genresWithSongs, chain, ancestorIds, resolveNode, libraryTags, otherGenres, searchMatches, visibleRows, allExpandable, treeKey, filterIds, flavourCount, STATUS_FILTERS, STATUS_LABELS, statusKey,
} from './genre-levels.js';

const songs = (n) => `${n} ${plural(n, 'song', 'songs')}`;
const LEVEL_NAMES = { 1: 'Genre (level 1)', 2: 'Umbrella or standalone genre (level 2)', 3: 'Specific genre (level 3)' };
const EMPTY_TEXT = 'No genres yet. Add songs with genres to see them here.';
const canvasLabel = (name) => `Map of ${name ? `${name} ` : ''}genres. Drag to pan, scroll or pinch to zoom. The outline lists the same genres and is the keyboard alternative.`;
const NARROW_PX = 720;
const FLASH_MS = 1400;
export const LEGEND_KEY = 'electrophone.genresLegend';

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

  const status = el('p', { class: 'gm-status t-caption', role: 'status' }, 'Loading...');
  const reload = el('button', { class: 'gm-tbtn', type: 'button', onclick: () => start() }, 'Reload');
  const canvas = el('canvas', {
    class: 'gmr-canvas', role: 'img', tabindex: '-1',
    'aria-label': canvasLabel(rootGenre),
  });
  const tip = el('div', { class: 'gmr-tip t-caption', role: 'tooltip', hidden: true });
  const treeEl = el('div', { class: 'gmr-tree', role: 'tree', 'aria-label': 'Genre hierarchy' });
  const details = el('div', { class: 'gmr-details', role: 'group', 'aria-label': 'Genre details', hidden: true });
  const empty = el('p', { class: 'gmr-empty muted t-body', hidden: true });
  const outlineEl = el('section', { class: 'gmr-outline', id: 'gmr-outline', 'aria-label': 'Outline' });
  const side = el('div', { class: 'gmr-side' });
  const outlineBtn = el('button', {
    class: 'gm-tbtn gmr-outline-btn', type: 'button', 'aria-controls': 'gmr-outline', 'aria-expanded': 'false', onclick: () => setOutline(!outlineOpen),
  }, 'Outline');
  const wrap = el('div', { class: 'gm gmr' });
  const work = el('div', { class: 'gm-work' });
  const familyRow = el('div', { class: 'gmr-family-row', role: 'group', 'aria-label': 'Genre family', hidden: true });

  function renderFamilies() {
    familyRow.hidden = !families.length;
    familyRow.replaceChildren(...families.map((f) => el('button', {
      class: 'gm-tbtn', type: 'button', 'data-family': f, 'aria-pressed': String(f === rootGenre), onclick: () => setFamily(f),
    }, el('span', { class: `gm-dot f${familyIndex(f)}`, 'aria-hidden': 'true' }), f)));
  }
  const legendBtn = el('button', {
    class: 'gm-tbtn', type: 'button', 'aria-controls': 'gmr-legend', 'aria-expanded': String(legendOpen), onclick: () => setLegend(!legendOpen, { save: true }),
  }, legendOpen ? 'Hide legend' : 'Show legend');
  const nowBtn = el('button', { class: 'gm-tbtn gmr-now', type: 'button', hidden: true, onclick: () => showNowPlaying() }, icon('music', 'inline'), 'Now playing');

  const view = createRadialView(canvas, {
    reducedMotion: reduced,
    onSelect: (id) => (id ? select(id, { reveal: true, info: true }) : deselect()),
    onHover: (n, pt) => showTip(n, pt),
  });

  function showTip(n, pt) {
    if (!n || !pt) { tip.hidden = true; return; }
    const r = work.getBoundingClientRect?.() || { left: 0, top: 0 };
    const t = n.node;
    tip.replaceChildren(
      el('strong', {}, t.label),
      el('span', {}, ` ${songs(count(t))}`),
      t.synonyms.length ? el('span', { class: 'muted' }, ` | also: ${t.synonyms.join(', ')}`) : null,
      !t.discogs ? el('span', { class: 'muted' }, ' | not in Discogs') : null,
      t.alsoIn.length ? el('span', { class: 'muted' }, ` | also in ${otherGenres(t, rootGenre).join(', ')}`) : null,
      t.status ? el('span', { class: 'muted' }, ` | ${STATUS_LABELS[t.status]}`) : null);
    tip.style.left = `${pt.x - r.left + 12}px`;
    tip.style.top = `${pt.y - r.top + 14}px`;
    tip.hidden = false;
  }

  const narrow = () => (window.innerWidth || 1200) < NARROW_PX;

  function setOutline(open) {
    outlineOpen = open;
    outlineEl.hidden = !open;
    outlineBtn.setAttribute('aria-expanded', String(open));
    wrap.classList.toggle('outline-open', open);
    if (open && narrow() && legendOpen) setLegend(false);
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

  function applyFilters() {
    view.setFilter(tree ? filterIds(tree, { status: statusFilter, flavours: flavourSel }) : null);
    renderTree();
    renderFlavours();
  }

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
    const used = new Set(tree ? [...tree.byId.values()].filter((n) => count(n)).flatMap((n) => n.flavours) : []);
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

  function matchIds() {
    return tree && query ? [...searchMatches(tree, query, { populatedOnly: true }).keys()].filter((id) => layout?.byId.has(id)) : [];
  }
  function markMatches() { view.setMatches(tree && query ? [...searchMatches(tree, query, { populatedOnly: true }).keys()] : []); }
  function panelInset() {
    if (!outlineOpen || outlineEl.hidden) return { r: 0, b: 0 };
    const rect = side.getBoundingClientRect?.() || { width: 0, height: 0 };
    return narrow() ? { r: 0, b: rect.height } : { r: rect.width, b: 0 };
  }
  function centre(id) {
    if (!layout?.byId.has(id)) return;
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
    if (!visibleRows(tree, { expanded, query, onlyWithSongs: true, status: statusFilter, flavours: flavourSel }).some((r) => r.node.id === id)) {
      query = '';
      search.value = '';
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

  function setFamily(name) {
    if (name === rootGenre) return;
    rootGenre = name;
    expanded.add(`g:${name}`);
    canvas.setAttribute('aria-label', canvasLabel(name));
    for (const b of familyRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.family === name));
    if (!tree) return;
    layout = layoutRadial(tree, rootGenre);
    view.setLayout(layout, tree);
    view.reset();
    view.select(selectedId);
    markMatches();
    renderTree();
    showTotals();
  }

  function select(id, { reveal: rv = false, center = false, toggle = false, info = false } = {}) {
    const family = tree && !layout?.byId.has(id) ? chain(tree, id)[0]?.name : null;
    if (family && families.includes(family)) setFamily(family);
    selectedId = id;
    panelId = info ? id : null;
    activeId = id;
    view.select(id);
    if (info && !outlineOpen) setOutline(true);
    if (rv) reveal(id);
    if (toggle) { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); }
    if (center) centre(id);
    renderTree();
    renderPanel();
    if (rv || center || toggle) focusRow(id);
  }

  function deselect() {
    selectedId = null;
    panelId = null;
    view.select(null);
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
      n.status === 'approved' ? badge('approved', STATUS_LABELS.approved, 'ok') : null,
      n.status === 'question' ? badge('question', STATUS_LABELS.question, 'q') : null,
      ...n.alsoUnder.map((a) => {
        const target = tree.byKey.get(vkey(a));
        if (!target || !count(target)) return null;
        return el('button', {
          class: 'gmr-also', type: 'button', tabindex: '-1', 'aria-label': `Also under ${target.label}: jump to ${target.label}`, title: `Also under ${target.label}`,
          onclick: (e) => { e.stopPropagation(); select(target.id, { reveal: true, center: true }); },
        }, `also under ${target.label}`);
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
    rows = visibleRows(tree, { expanded, query, onlyWithSongs: true, status: statusFilter, flavours: flavourSel });
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
    const path = chain(tree, n.id).slice(0, -1);
    const also = n.alsoUnder.map((a) => tree.byKey.get(vkey(a))).filter((t) => t && count(t));
    const chips = (list) => el('span', { class: 'gm-chips' }, list.map((p) => chipButton(p.id, p.label)));
    const items = [];
    const add = (k, ...v) => items.push(el('dt', { class: 't-caption muted' }, k), el('dd', { class: 't-body' }, ...v));
    if (n.display) add('Vocabulary key', n.name);
    add('Level', LEVEL_NAMES[n.level]);
    if (n.alsoIn.length) add('Also in genres', [n.genre, ...n.alsoIn].join(', '));
    add('Parent chain', path.length ? chips(path) : 'None (top level)');
    add('Synonyms', n.synonyms.length ? n.synonyms.join(', ') : 'None');
    if (n.level > 1) add('Also under', also.length ? chips(also) : 'None');
    add('In Discogs', n.discogs ? 'Yes' : 'No, a name added to this library');
    if (n.level > 1) add('Review', STATUS_LABELS[statusKey(n)]);
    if (n.level > 1 && n.flavours.length) add('Flavours', el('span', { class: 'gm-chips' }, n.flavours.map((k) => el('span', { class: 'gmr-badge flav', title: tree.flavours.get(k).description }, tree.flavours.get(k).name))));
    if (n.provisional) add('Status', 'Provisional: not yet reviewed');
    const exact = n.own.size !== total ? ` (${n.own.size} tagged exactly)` : '';
    add('Songs', `${total} in your library${exact}`);
    return items;
  }

  function renderPanel() {
    const n = tree && panelId ? tree.byId.get(panelId) : null;
    details.hidden = !n;
    outlineEl.classList.toggle('has-details', !!n);
    side.classList.toggle('has-details', !!n);
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
    if (!tree || !layout) return null;
    const rootId = `g:${rootGenre}`;
    const found = new Map();
    for (const g of songGenres(player.current)) {
      const n = resolveNode(g.key, tree);
      if (n && ancestorIds(tree, n.id).has(rootId)) found.set(n.id, n);
    }
    const best = [...found.values()].sort((a, b) => b.level - a.level || count(b) - count(a) || a.name.localeCompare(b.name))[0];
    for (let n = best; n; n = n.parent ? tree.byId.get(n.parent) : null) if (layout.byId.has(n.id)) return n;
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
    if (!n) { toast(rootGenre ? `The playing song has no ${rootGenre} genre` : 'The playing song has no genre on the map'); return; }
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
    if (a.type === 'focus') { focusRow(a.id); const nid = rows.find((x) => x.key === a.id)?.node.id; if (layout?.byId.has(nid)) view.select(nid); }
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

  async function load() {
    status.textContent = 'Loading...';
    reload.disabled = true;
    const [v, l] = await Promise.allSettled([api.genreVocabulary(), api.library()]);
    if (dead) return;
    reload.disabled = false;
    const vocab = v.status === 'fulfilled' ? v.value : null;
    const failed = !hasLevels(vocab) || l.status !== 'fulfilled';
    if (failed) {
      tree = null;
      layout = null;
      families = [];
      renderFamilies();
      view.setLayout(null, null);
      renderTree();
      renderPanel();
      refreshNow();
      if (v.status === 'rejected') status.textContent = 'Vocabulary unavailable';
      else if (!hasLevels(vocab)) status.textContent = 'Genre levels unavailable: the server has no level data yet';
      else status.textContent = 'Library unavailable: song counts are needed to show genres';
      return;
    }
    tree = buildTree(vocab);
    applyCounts(tree, l.value);
    families = populatedFamilies(tree);
    if (!families.includes(rootGenre)) rootGenre = families[0] || null;
    if (rootGenre) expanded.add(`g:${rootGenre}`);
    canvas.setAttribute('aria-label', canvasLabel(rootGenre));
    renderFamilies();
    layout = rootGenre ? layoutRadial(tree, rootGenre) : null;
    view.setLayout(layout, tree);
    if (selectedId && !tree.byId.has(selectedId)) selectedId = null;
    if (panelId && !tree.byId.has(panelId)) panelId = null;
    view.select(selectedId);
    for (const k of flavourSel) if (!tree.flavours.has(k)) flavourSel.delete(k);
    view.setFilter(filterIds(tree, { status: statusFilter, flavours: flavourSel }));
    markMatches();
    renderFlavours();
    renderTree();
    renderPanel();
    if (rootGenre) showTotals(); else status.textContent = EMPTY_TEXT;
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
      el('li', {}, el('span', { class: 'gmr-key neutral', 'aria-hidden': 'true' }), 'Grey: no song tagged here, shown to connect genres below'),
      el('li', {}, el('span', { class: 'gmr-key nodisc', 'aria-hidden': 'true' }), 'Dashed ring: not in Discogs'),
      el('li', {}, el('span', { class: 'gmr-key q', 'aria-hidden': 'true' }), 'Question badge: under question')));

  outlineEl.append(
    el('div', { class: 'gm-outline-head' },
      el('h2', { class: 't-headline' }, 'Outline'),
      el('button', { class: 'gm-x', type: 'button', 'aria-label': 'Close outline', title: 'Close outline', onclick: () => setOutline(false) }, icon('clear', 'nav'))),
    details,
    el('div', { class: 'gmr-scroll' },
      el('div', { class: 'gmr-tools' }, search, expandAll, collapseAll, statusRow, flavourRow),
      treeEl, empty));

  side.append(el('div', { class: 'gmr-bar' }, status, legendBtn, nowBtn, reload, outlineBtn, familyRow), outlineEl);
  work.append(canvas, side, zoomBar, legend, tip);
  wrap.append(pageHead('Genres map'), work);
  root.append(wrap);
  setOutline(outlineOpen);
  const unsubPlayer = player.onChange(refreshNow);
  start();
  return () => {
    dead = true;
    clearTimeout(flashTimer);
    unsubPlayer();
    view.destroy();
  };
}
