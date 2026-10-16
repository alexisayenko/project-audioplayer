import { api } from './api.js';
import { el, plural } from './dom.js';
import { icon } from './icons.js';
import { familyIndex } from './genre-data.js';
import { vkey } from './genre-vocab.js';
import { filterByTags } from './library-data.js';
import { outlineDefaultOpen } from './genre-view.js';
import { layoutRadial } from './genre-radial.js';
import { createRadialView } from './genre-radial-view.js';
import {
  hasLevels, buildTree, applyCounts, count, chain, libraryTags, otherGenres, searchMatches, visibleRows, allExpandable, treeKey, filterIds, flavourCount, STATUS_FILTERS, STATUS_LABELS, statusKey,
} from './genre-levels.js';

const songs = (n) => `${n} ${plural(n, 'song', 'songs')}`;
const LEVEL_NAMES = { 1: 'Genre (level 1)', 2: 'Umbrella or standalone style (level 2)', 3: 'Specific style (level 3)' };
const ROOT_GENRE = 'Electronic';
export const ALL_KEY = 'electrophone.genresReworkAll';

export function loadShowAll(storage) {
  try { return storage?.getItem(ALL_KEY) === '1'; } catch { return false; }
}

export function saveShowAll(storage, on) {
  try { storage?.setItem(ALL_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

export function renderGenresRework(root, opts = {}) {
  const rootGenre = typeof opts?.rootGenre === 'string' ? opts.rootGenre : ROOT_GENRE;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let dead = false;
  let tree = null;
  let layout = null;
  let query = '';
  let onlyWithSongs = false;
  let expanded = new Set([`g:${rootGenre}`]);
  let activeId = null;
  let selectedId = null;
  let rows = [];
  let countsOk = true;
  let statusFilter = 'all';
  const flavourSel = new Set();
  let showAll = loadShowAll(globalThis.localStorage);
  let outlineOpen = outlineDefaultOpen(window.innerWidth || 1200);

  const status = el('p', { class: 'gm-status t-caption', role: 'status' }, 'Loading...');
  const reload = el('button', { class: 'gm-tbtn', type: 'button', onclick: () => load() }, 'Reload');
  const canvas = el('canvas', {
    class: 'gmr-canvas', role: 'img', tabindex: '-1',
    'aria-label': `Map of ${rootGenre} genres and styles. Drag to pan, scroll or pinch to zoom. The outline lists the same genres and is the keyboard alternative.`,
  });
  const tip = el('div', { class: 'gmr-tip t-caption', role: 'tooltip', hidden: true });
  const treeEl = el('div', { class: 'gmr-tree', role: 'tree', 'aria-label': 'Genre hierarchy' });
  const panel = el('section', { class: 'gm-panel gmr-panel', 'aria-label': 'Genre details', hidden: true });
  const empty = el('p', { class: 'gmr-empty muted t-body', hidden: true });
  const outlineEl = el('section', { class: 'gm-outline', id: 'gmr-outline', 'aria-label': 'Outline' });
  const outlineBtn = el('button', {
    class: 'gm-tbtn gm-outline-btn', type: 'button', 'aria-controls': 'gmr-outline', 'aria-expanded': 'false', onclick: () => setOutline(!outlineOpen),
  }, 'Outline');
  const wrap = el('div', { class: 'gm gmr' });
  const allBtn = el('button', {
    class: 'gm-tbtn', type: 'button', 'aria-pressed': String(showAll),
    onclick: () => {
      showAll = !showAll;
      allBtn.setAttribute('aria-pressed', String(showAll));
      saveShowAll(globalThis.localStorage, showAll);
      if (tree) { layout = layoutRadial(tree, rootGenre, { showAll }); view.setLayout(layout, tree); view.select(selectedId); markMatches(); }
    },
  }, 'Show whole vocabulary');

  const view = createRadialView(canvas, {
    reducedMotion: reduced,
    onSelect: (id) => (id ? select(id, { reveal: true }) : deselect()),
    onHover: (n, pt) => showTip(n, pt),
  });

  function showTip(n, pt) {
    if (!n || !pt) { tip.hidden = true; return; }
    const r = wrap.getBoundingClientRect?.() || { left: 0, top: 0 };
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

  function setOutline(open) {
    outlineOpen = open;
    outlineEl.hidden = !open;
    outlineBtn.setAttribute('aria-expanded', String(open));
    wrap.classList.toggle('outline-open', open);
  }

  const search = el('input', {
    class: 'gmr-search', type: 'search', placeholder: 'Find a genre or synonym', 'aria-label': 'Find a genre or synonym', autocomplete: 'off',
    oninput: () => { query = search.value; renderTree(); markMatches(); if (matchIds().length === 1) centre(matchIds()[0]); },
    onkeydown: (e) => {
      if (e.key === 'Escape') { search.value = ''; query = ''; renderTree(); markMatches(); }
      if (e.key === 'Enter' && matchIds().length) { e.preventDefault(); select(matchIds()[0], { reveal: true, center: true }); }
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
  const onlyBtn = el('button', {
    class: 'gm-tbtn', type: 'button', 'aria-pressed': 'false',
    onclick: () => { onlyWithSongs = !onlyWithSongs; onlyBtn.setAttribute('aria-pressed', String(onlyWithSongs)); renderTree(); },
  }, 'Only with songs');

  function setStatus(f) {
    statusFilter = f;
    for (const b of statusRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.getAttribute('data-status') === f));
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
    return el('button', {
      class: 'gm-tbtn gmr-flav', type: 'button', 'data-flavour': f.key, 'aria-pressed': String(flavourSel.has(f.key)),
      'aria-label': `${f.name}, ${songs(n)}`, title: `${f.description ? `${f.description} - ` : ''}${songs(n)}`,
      onclick: () => { if (flavourSel.has(f.key)) flavourSel.delete(f.key); else flavourSel.add(f.key); applyFilters(); },
    }, f.name);
  }

  function renderFlavours() {
    const used = new Set(tree ? [...tree.byId.values()].flatMap((n) => n.flavours) : []);
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
    return tree && query ? [...searchMatches(tree, query).keys()].filter((id) => layout?.byId.has(id)) : [];
  }
  function markMatches() { view.setMatches(tree && query ? [...searchMatches(tree, query).keys()] : []); }
  function centre(id) { if (layout?.byId.has(id)) view.focusNode(id); }

  function focusRow(id) {
    activeId = id;
    renderTree();
    const row = treeEl.querySelectorAll('[role="treeitem"]').find((r) => r.getAttribute('data-id') === id);
    if (row) row.focus();
  }

  function reveal(id) {
    for (const a of chain(tree, id).slice(0, -1)) expanded.add(a.id);
    if (!visibleRows(tree, { expanded, query, onlyWithSongs, status: statusFilter, flavours: flavourSel }).some((r) => r.node.id === id)) {
      query = '';
      search.value = '';
      if (statusFilter !== 'all') { statusFilter = 'all'; for (const b of statusRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.getAttribute('data-status') === 'all')); }
      if (flavourSel.size) flavourSel.clear();
      applyFilters();
      markMatches();
      if (onlyWithSongs && !count(tree.byId.get(id))) { onlyWithSongs = false; onlyBtn.setAttribute('aria-pressed', 'false'); }
    }
  }

  function select(id, { reveal: rv = false, center = false, toggle = false } = {}) {
    selectedId = id;
    activeId = id;
    view.select(id);
    if (rv) reveal(id);
    if (toggle) { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); }
    if (center) centre(id);
    renderTree();
    renderPanel();
    if (rv || center || toggle) focusRow(id);
  }

  function deselect() {
    selectedId = null;
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
        return el('button', {
          class: 'gmr-also', type: 'button', tabindex: '-1', 'aria-label': `Also under ${target?.label || a}: jump to ${target?.label || a}`, title: `Also under ${target?.label || a}`,
          onclick: (e) => { e.stopPropagation(); if (target) select(target.id, { reveal: true, center: true }); },
        }, `also under ${target?.label || a}`);
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
    rows = visibleRows(tree, { expanded, query, onlyWithSongs, status: statusFilter, flavours: flavourSel });
    if (!rows.length) activeId = null;
    else if (!rows.some((r) => r.key === activeId)) activeId = rows[0].key;
    let rootName = '';
    treeEl.replaceChildren(...rows.map((r, i) => { if (r.level === 1) rootName = r.node.name; return buildRow(r, i, rootName); }));
    empty.hidden = rows.length > 0;
    empty.textContent = (statusFilter !== 'all' || flavourSel.size) && !query ? 'No genres match the filters.' : query ? `No genre or synonym matches "${query.trim()}".` : onlyWithSongs ? 'No genre has songs yet.' : 'No genres.';
  }

  const chipButton = (id, label) => el('button', { class: 'gm-chip', type: 'button', onclick: () => select(id, { reveal: true, center: true }) }, label);

  function renderPanel() {
    const n = tree && selectedId ? tree.byId.get(selectedId) : null;
    panel.hidden = !n;
    if (!n) { panel.replaceChildren(); return; }
    const total = count(n);
    const path = chain(tree, n.id).slice(0, -1);
    const also = n.alsoUnder.map((a) => tree.byKey.get(vkey(a))).filter(Boolean);
    const dl = (k, ...v) => [el('dt', { class: 't-caption muted' }, k), el('dd', { class: 't-body' }, ...v)];
    const items = [
      ...(n.display ? dl('Vocabulary key', n.name) : []),
      ...dl('Level', LEVEL_NAMES[n.level]),
      ...(n.alsoIn.length ? dl('Also in genres', [n.genre, ...n.alsoIn].join(', ')) : []),
      ...dl('Parent chain', path.length ? el('span', { class: 'gm-chips' }, path.map((p) => chipButton(p.id, p.label))) : 'None (top level)'),
      ...dl('Synonyms', n.synonyms.length ? n.synonyms.join(', ') : 'None'),
      ...(n.level > 1 ? dl('Also under', also.length ? el('span', { class: 'gm-chips' }, also.map((p) => chipButton(p.id, p.label))) : 'None') : []),
      ...dl('In Discogs', n.discogs ? 'Yes' : 'No, a name added to this library'),
      ...(n.level > 1 ? dl('Review', STATUS_LABELS[statusKey(n)]) : []),
      ...(n.level > 1 && n.flavours.length ? dl('Flavours', el('span', { class: 'gm-chips' }, n.flavours.map((k) => el('span', { class: 'gmr-badge flav', title: tree.flavours.get(k).description }, tree.flavours.get(k).name)))) : []),
      ...(n.provisional ? dl('Status', 'Provisional: not yet reviewed') : []),
      ...dl('Songs', countsOk ? `${total} in your library${n.own.size !== total ? ` (${n.own.size} tagged exactly)` : ''}` : 'Counts unavailable'),
    ];
    panel.replaceChildren(
      el('div', { class: 'gm-panel-head' },
        n.level === 1 ? el('span', { class: `gm-dot f${familyIndex(n.name)}`, 'aria-hidden': 'true' }) : null,
        el('h2', { class: 't-headline' }, n.label),
        el('button', { class: 'gm-x', type: 'button', 'aria-label': 'Close details', title: 'Close details', onclick: () => deselect() }, icon('clear', 'nav'))),
      el('dl', { class: 'gmr-dl' }, items),
      el('button', {
        class: 'btn primary small', type: 'button', disabled: !total,
        onclick: () => { filterByTags(libraryTags(tree, n.id)); location.hash = '#/library'; },
      }, `Show ${songs(total)} in Library`));
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

  async function load() {
    status.textContent = 'Loading...';
    reload.disabled = true;
    const [v, l] = await Promise.allSettled([api.genreVocabulary(), api.library()]);
    if (dead) return;
    reload.disabled = false;
    const vocab = v.status === 'fulfilled' ? v.value : null;
    countsOk = l.status === 'fulfilled';
    if (!hasLevels(vocab)) {
      tree = null;
      layout = null;
      view.setLayout(null, null);
      renderTree();
      renderPanel();
      status.textContent = v.status === 'rejected' ? 'Vocabulary unavailable' : 'Genre levels unavailable: the server has no level data yet';
      return;
    }
    tree = buildTree(vocab);
    applyCounts(tree, countsOk ? l.value : []);
    layout = layoutRadial(tree, rootGenre, { showAll });
    view.setLayout(layout, tree);
    if (selectedId && !tree.byId.has(selectedId)) selectedId = null;
    view.select(selectedId);
    for (const k of [...flavourSel]) if (!tree.flavours.has(k)) flavourSel.delete(k);
    view.setFilter(filterIds(tree, { status: statusFilter, flavours: flavourSel }));
    markMatches();
    renderFlavours();
    renderTree();
    renderPanel();
    const styles = tree.byId.size - tree.roots.length;
    status.textContent = countsOk ? `${tree.roots.length} genres, ${styles} styles` : `${tree.roots.length} genres, ${styles} styles; song counts unavailable`;
  }

  const zoomBar = el('div', { class: 'gm-zoom', role: 'group', 'aria-label': 'Zoom' },
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => view.zoomBy(1.3) }, icon('plus', 'action')),
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => view.zoomBy(1 / 1.3) }, icon('minus', 'action')),
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Reset view', title: 'Reset view', onclick: () => view.reset() }, icon('maximize', 'action')));

  const legend = el('ul', { class: 'gmr-legend t-caption', 'aria-label': 'Legend' },
    el('li', {}, el('span', { class: 'gmr-key size', 'aria-hidden': 'true' }), 'Size: songs here and below'),
    el('li', {}, el('span', { class: 'gmr-key dim', 'aria-hidden': 'true' }), 'Faded: no songs'),
    el('li', {}, el('span', { class: 'gmr-key nodisc', 'aria-hidden': 'true' }), 'Dashed ring: not in Discogs'),
    el('li', {}, el('span', { class: 'gmr-key also', 'aria-hidden': 'true' }), 'Dashed line: also under (selected or hovered node)'),
    el('li', { title: 'Discogs outranks approval: a style that is in Discogs never shows this badge' }, el('span', { class: 'gmr-key ok', 'aria-hidden': 'true' }), 'Check badge: Alex approved (styles not in Discogs only)'),
    el('li', {}, el('span', { class: 'gmr-key q', 'aria-hidden': 'true' }), 'Question badge: under question'),
    el('li', {}, el('span', { class: 'gmr-key dim small', 'aria-hidden': 'true' }), 'Small dim dots on the outer arc: styles with no songs (whole vocabulary)'));

  outlineEl.append(
    el('div', { class: 'gm-outline-head' },
      el('h2', { class: 't-headline' }, 'Outline'),
      el('button', { class: 'gm-x', type: 'button', 'aria-label': 'Close outline', title: 'Close outline', onclick: () => setOutline(false) }, icon('clear', 'nav'))),
    el('div', { class: 'gmr-tools' }, search, expandAll, collapseAll, onlyBtn, statusRow, flavourRow),
    treeEl, empty);

  wrap.append(
    canvas,
    el('div', { class: 'gm-bar' }, el('div', { class: 'gm-bar-row' }, el('h1', { class: 'gm-title' }, 'Genres map rework'), status, allBtn, reload)),
    outlineBtn, outlineEl, zoomBar, legend, panel, tip);
  root.append(wrap);
  setOutline(outlineOpen);
  load();
  return () => { dead = true; view.destroy(); };
}
