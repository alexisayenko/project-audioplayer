import { api } from './api.js';
import { store } from './store.js';
import { el, plural } from './dom.js';
import { createGraphView } from './genre-graph.js';
import {
  FAMILIES, familyIndex, indexGraph, flatGraph, localCounts, filterTags, searchNodes, outlineRows, pathKeys,
  loadExpanded, saveExpanded, hasStoredExpanded,
} from './genre-data.js';
import { filterByTags } from './library.js';
import { BP_WIDE, BP_DESKTOP, GENRES_OUTLINE_INSET } from './constants.js';
import { POLL_MS, shouldPoll, presentFamilies, toggleHidden, loadOutlineOpen, saveOutlineOpen } from './genre-view.js';

const CHILD_CHIPS = 12;

const songsText = (n) => `${n} ${plural(n, 'song', 'songs')}`;

export function renderGenres(root) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const expanded = loadExpanded(localStorage);
  let g = null;
  let selectedId = null;
  let pollTimer = 0;
  let polls = 0;
  let dead = false;
  let hidden = new Set();
  let outlineOpen = loadOutlineOpen(localStorage, window.innerWidth);
  let legendOpen = false;

  const note = el('p', { class: 'gm-status t-caption', role: 'status' }, 'Loading genres...');
  const canvas = el('canvas', {
    class: 'gm-canvas', tabindex: 0,
    'aria-label': 'Genre graph. Drag to move genres, scroll or pinch to zoom, click a genre to select it. The outline lists the same genres. Keys: plus, minus, arrows, 0 to fit.',
  });
  const tip = el('div', { class: 'gm-tip t-caption', role: 'presentation', hidden: true });
  const panel = el('aside', { class: 'gm-panel', 'aria-label': 'Selected genre', hidden: true });
  const legend = el('ul', { class: 'gm-legend t-caption', 'aria-label': 'Families (click to hide or show)', hidden: true });
  const legendBtn = el('button', {
    class: 'gm-tbtn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'gm-legend',
    onclick: () => { legendOpen = !legendOpen; syncLegend(); },
  }, 'Legend');
  legend.id = 'gm-legend';
  const outlineBtn = el('button', {
    class: 'gm-tbtn gm-outline-btn', type: 'button', 'aria-controls': 'gm-outline-panel', onclick: () => setOutline(!outlineOpen),
  }, 'Outline');
  const tree = el('ul', { class: 'gm-tree' });
  const results = el('ul', { class: 'gm-results', role: 'listbox', 'aria-label': 'Matching genres', hidden: true });
  const search = el('input', {
    type: 'search', placeholder: 'Find a genre', 'aria-label': 'Find a genre', autocomplete: 'off',
    oninput: () => renderResults(),
    onkeydown: (e) => {
      if (e.key === 'Enter') { const first = searchNodes(g || { nodes: [] }, search.value)[0]; if (first) pick(first.id); }
      if (e.key === 'Escape') { search.value = ''; renderResults(); }
    },
  });

  const outlinePanel = el('section', { class: 'gm-outline', id: 'gm-outline-panel', 'aria-label': 'Outline' },
    el('div', { class: 'gm-outline-head' },
      el('h2', { class: 't-headline' }, 'Outline'),
      el('button', { class: 'gm-x', type: 'button', 'aria-label': 'Close outline', title: 'Close outline', onclick: () => setOutline(false) }, '×')),
    tree);

  const view = createGraphView(canvas, {
    reducedMotion: reduced,
    onSelect: (data) => { selectedId = data ? data.id : null; renderPanel(); revealInOutline(); },
    onHover: (h) => {
      if (!h) { tip.hidden = true; return; }
      tip.textContent = `${h.node.label} - ${songsText(h.node.count)}`;
      tip.style.left = `${h.x + 14}px`;
      tip.style.top = `${h.y + 14}px`;
      tip.hidden = false;
    },
  });

  const zoomBar = el('div', { class: 'gm-zoom', role: 'group', 'aria-label': 'Zoom' },
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => view.zoom(1.3) }, '+'),
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => view.zoom(1 / 1.3) }, '−'),
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Fit all genres', title: 'Fit all', onclick: () => view.fit() }, '□'));

  function syncLegend() {
    legend.hidden = !legendOpen;
    legendBtn.setAttribute('aria-expanded', String(legendOpen));
  }

  function setOutline(open, save = true) {
    outlineOpen = open;
    if (save) saveOutlineOpen(localStorage, open);
    gm.classList.toggle('outline-open', open);
    outlineBtn.setAttribute('aria-expanded', String(open));
    outlineBtn.classList.toggle('on', open);
    outlinePanel.hidden = !open;
    const w = window.innerWidth;
    view.setInsets({ r: open && w >= BP_WIDE && w < BP_DESKTOP ? GENRES_OUTLINE_INSET : 0 });
    if (open) revealInOutline();
  }

  function pick(id) {
    search.value = '';
    renderResults();
    view.select(id, { center: true });
  }

  function renderResults() {
    const hits = g ? searchNodes(g, search.value) : [];
    results.replaceChildren(...hits.map((n) => el('li', { role: 'option' },
      el('button', { type: 'button', class: 'gm-hit', onclick: () => pick(n.id) },
        el('span', { class: `gm-dot f${familyIndex(n.family)}`, 'aria-hidden': 'true' }), n.label, el('small', {}, songsText(n.count))))));
    results.hidden = !hits.length;
  }

  function chip(id) {
    const n = g.byId.get(id);
    return el('button', { class: 'gm-chip', type: 'button', onclick: () => view.select(id, { center: true }) }, n.label);
  }

  function renderPanel() {
    const n = g && selectedId ? g.byId.get(selectedId) : null;
    panel.hidden = !n;
    if (!n) { panel.replaceChildren(); return; }
    const kids = g.children.get(n.id) || [];
    const more = kids.length - CHILD_CHIPS;
    const exact = n.ownCount !== n.count ? ` (${n.ownCount} tagged exactly)` : '';
    panel.replaceChildren(
      el('div', { class: 'gm-panel-head' },
        el('span', { class: `gm-dot f${familyIndex(n.family)}`, 'aria-hidden': 'true' }),
        el('h2', { class: 't-headline' }, n.label),
        el('button', { class: 'gm-x', type: 'button', 'aria-label': 'Close', title: 'Close', onclick: () => view.select(null) }, '×')),
      el('p', { class: 'muted t-caption' }, `${n.family} · ${songsText(n.count)}${exact}`),
      n.parents.length ? el('div', { class: 'gm-group' }, el('p', { class: 't-eyebrow' }, 'PARENTS'), el('div', { class: 'gm-chips' }, n.parents.map(chip))) : null,
      kids.length ? el('div', { class: 'gm-group' }, el('p', { class: 't-eyebrow' }, 'SUBGENRES'),
        el('div', { class: 'gm-chips' }, kids.slice(0, CHILD_CHIPS).map(chip), more > 0 ? el('span', { class: 'muted t-caption' }, `+${more} more`) : null)) : null,
      el('button', {
        class: 'btn primary small', type: 'button', disabled: !n.count,
        onclick: () => { filterByTags(filterTags(g, n.id)); location.hash = '#/library'; },
      }, `Show ${songsText(n.count)} in Library`),
      n.qid ? el('a', { class: 't-caption', href: `https://www.wikidata.org/wiki/${n.qid}`, target: '_blank', rel: 'noopener noreferrer' }, 'Wikidata') : null);
  }

  function saveOpen() { saveExpanded(localStorage, expanded); }

  function renderOutline() {
    if (!g) { tree.replaceChildren(); return; }
    const rows = outlineRows(g, expanded);
    tree.replaceChildren(...rows.map((r) => {
      const isFamily = r.kind === 'family';
      const toggle = el('button', {
        class: 'gm-tw', type: 'button', disabled: !r.hasChildren, 'aria-expanded': r.hasChildren ? String(r.expanded) : null,
        'aria-label': `${r.expanded ? 'Collapse' : 'Expand'} ${r.label}`,
        onclick: () => { if (expanded.has(r.key)) expanded.delete(r.key); else expanded.add(r.key); saveOpen(); renderOutline(); },
      }, r.hasChildren ? (r.expanded ? '▾' : '▸') : '');
      const label = el('button', {
        class: 'gm-lbl', type: 'button', 'aria-current': r.id && r.id === selectedId ? 'true' : null,
        onclick: () => {
          if (isFamily) { toggle.click(); return; }
          view.select(r.id, { center: true });
        },
      }, el('span', { class: `gm-dot f${familyIndex(r.family)}`, 'aria-hidden': 'true' }), r.label);
      return el('li', {
        class: `gm-row${isFamily ? ' fam' : ''}${r.id && r.id === selectedId ? ' sel' : ''}`, style: `--depth:${r.depth}`, 'data-key': r.key,
      }, toggle, label,
      el('small', { class: 'muted' }, isFamily ? `${r.size} ${plural(r.size, 'root', 'roots')}` : String(r.count)),
      r.alsoUnder.length ? el('small', { class: 'gm-also muted' }, `also under ${r.alsoUnder.join(', ')}`) : null);
    }));
  }

  function revealInOutline() {
    if (g && selectedId) {
      let changed = false;
      for (const k of pathKeys(g, selectedId).slice(0, -1)) if (!expanded.has(k)) { expanded.add(k); changed = true; }
      if (changed) saveOpen();
    }
    renderOutline();
    const row = tree.querySelector('.gm-row.sel');
    row?.scrollIntoView?.({ block: 'nearest' });
  }

  function renderLegend() {
    const rows = presentFamilies(g?.nodes || []);
    legend.replaceChildren(...rows.map(({ family, count }) => el('li', {},
      el('button', {
        class: `gm-key${hidden.has(family) ? ' off' : ''}`, type: 'button', 'aria-pressed': String(!hidden.has(family)),
        title: hidden.has(family) ? `Show ${family}` : `Hide ${family}`,
        onclick: () => { hidden = toggleHidden(hidden, family); view.setHiddenFamilies(hidden); renderLegend(); },
      }, el('span', { class: `gm-dot f${familyIndex(family)}`, 'aria-hidden': 'true' }), family, el('small', {}, String(count))))));
    if (hidden.size) legend.append(el('li', {}, el('button', {
      class: 'gm-key', type: 'button', onclick: () => { hidden = new Set(); view.setHiddenFamilies(hidden); renderLegend(); },
    }, 'Show all')));
  }

  function apply(data, message) {
    g = indexGraph(data);
    if (store.loaded) {
      const counts = localCounts(g, store.songs);
      for (const n of g.nodes) { const c = counts.get(n.id); if (c) { n.count = c.count; n.ownCount = c.ownCount; } }
    }
    note.textContent = message;
    note.hidden = !message;
    view.update({ nodes: g.nodes, edges: g.edges });
    if (selectedId && !g.byId.has(selectedId)) selectedId = null;
    renderLegend();
    renderPanel();
    renderOutline();
    renderResults();
  }

  function genreTagCount() {
    return store.tags.filter((t) => /^genre:/i.test(t.tag)).length;
  }

  async function load() {
    pollTimer = 0;
    let data = null;
    let failed = false;
    try { data = await api.genreGraph(); } catch { failed = true; }
    if (dead) return;
    if (!failed && data && Array.isArray(data.nodes) && data.nodes.length) {
      const pending = shouldPoll(data.pending, polls);
      const message = !data.ontology ? 'Genre data unavailable - showing your tags only'
        : pending ? 'Resolving genre families...' : '';
      apply(data, message);
      if (pending) { polls += 1; pollTimer = setTimeout(load, POLL_MS); }
      return;
    }
    if (!failed && genreTagCount() === 0) {
      apply({ nodes: [], edges: [] }, 'No genres yet - add songs with genre tags');
      return;
    }
    apply(flatGraph(store.tags), 'Genre data unavailable - showing your tags only');
  }

  const unsub = store.subscribe(() => {
    if (!g) return;
    const counts = localCounts(g, store.songs);
    for (const n of g.nodes) { const c = counts.get(n.id); if (c) { n.count = c.count; n.ownCount = c.ownCount; } }
    view.update({ nodes: g.nodes, edges: g.edges });
    renderPanel();
    renderOutline();
  });

  const gm = el('div', { class: 'gm' },
    el('div', { class: 'gm-stage' }, canvas, tip),
    el('div', { class: 'gm-bar' },
      el('div', { class: 'gm-bar-row' },
        el('h1', { class: 'gm-title' }, 'Genres map'),
        note,
        legendBtn),
      el('div', { class: 'gm-find' }, search, results),
      legend),
    outlineBtn,
    zoomBar,
    panel,
    outlinePanel);
  root.append(gm);
  if (!hasStoredExpanded(localStorage)) for (const f of FAMILIES) expanded.add(`f:${f}`);
  setOutline(outlineOpen, false);

  load();

  return () => {
    dead = true;
    clearTimeout(pollTimer);
    unsub();
    view.destroy();
  };
}
