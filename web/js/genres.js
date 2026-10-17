import { api } from './api.js';
import { store } from './store.js';
import { el, plural } from './dom.js';
import { icon } from './icons.js';
import { serviceIcon } from './service-icons.js';
import { createGraphView } from './genre-graph.js';
import {
  FAMILIES, familyIndex, indexGraph, flatGraph, localCounts, filterTags, searchNodes, outlineRows, pathKeys,
  loadExpanded, saveExpanded, hasStoredExpanded,
} from './genre-data.js';
import { filterByTags } from './library.js';
import { watchPlayerInset } from './player-inset.js';
import { createCollapsible, loadCollapsed, saveCollapsed, PANEL_KEYS } from './collapsible.js';
import { player } from './player.js';
import { setCover } from './player-ui.js';
import { titleNodes, artistLine } from './credits.js';
import { songGenres, mapToNodes, nodeIds, nowPlayingState, createNowSelection, orphanNodes, orphanState } from './genre-playing.js';
import { POLL_MS, shouldPoll, presentFamilies, toggleHidden, loadOutlineOpen, saveOutlineOpen } from './genre-view.js';

const CHILD_CHIPS = 12;

const songsText = (n) => `${n} ${plural(n, 'song', 'songs')}`;

export function wikiLink(n) {
  if (n.wikipedia) return { href: n.wikipedia, label: 'Open on Wikipedia', dim: false };
  if (n.qid) return { href: `https://www.wikidata.org/wiki/${n.qid}`, label: 'Open on Wikidata (no Wikipedia article)', dim: true };
  return null;
}

function wikiButton(n) {
  const w = wikiLink(n);
  if (!w) return null;
  return el('a', {
    class: `icon gm-wiki${w.dim ? ' dim' : ''}`, href: w.href, target: '_blank', rel: 'noopener noreferrer',
    title: w.label, 'aria-label': w.label,
  }, serviceIcon('wikipedia'));
}

function loadMessage(data, pending) {
  if (!data.ontology) return 'Genre data unavailable - showing your tags only';
  return pending ? 'Resolving genre families...' : '';
}

function toggleIcon(r) {
  return r.hasChildren ? icon('chevron', 'inline') : null;
}

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
  let nowOpen = false;
  let orphOpen = false;
  let infoCollapsed = loadCollapsed(localStorage, PANEL_KEYS.genreInfo, window.innerWidth);
  const infoCard = (id, content) => createCollapsible({
    id, content, collapsed: infoCollapsed,
    onToggle: (v) => { infoCollapsed = v; saveCollapsed(localStorage, PANEL_KEYS.genreInfo, v); },
  });

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
  const nowBtn = el('button', {
    class: 'gm-tbtn', type: 'button', 'aria-expanded': 'false', 'aria-pressed': 'false', 'aria-controls': 'gm-now',
    onclick: () => toggleNow(),
  }, icon('music', 'inline'), 'Now playing');
  const nowPop = el('div', { class: 'gm-now', id: 'gm-now', role: 'group', 'aria-label': 'Genres of the playing song', hidden: true });
  const orphBtn = el('button', {
    class: 'gm-tbtn', type: 'button', 'aria-pressed': 'false', 'aria-controls': 'gm-orphans', title: 'Genres with no connections',
    onclick: () => toggleOrph(),
  }, 'Orphans');
  const orphPop = el('div', { class: 'gm-now gm-orphans', id: 'gm-orphans', role: 'group', 'aria-label': 'Orphan genres', hidden: true });
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
      el('button', { class: 'gm-x', type: 'button', 'aria-label': 'Close outline', title: 'Close outline', onclick: () => setOutline(false) }, icon('clear', 'nav'))),
    tree);

  const view = createGraphView(canvas, {
    reducedMotion: reduced,
    onSelect: (data) => {
      selectedId = data ? data.id : null;
      if (nowSel.userSelected() && nowOpen) setNow(false);
      if (orphSel.userSelected()) setOrph(false);
      renderPanel();
      revealInOutline();
    },
    onHover: (h) => {
      if (!h) { tip.hidden = true; return; }
      tip.textContent = `${h.node.label} - ${songsText(h.node.count)}`;
      tip.style.transform = `translate(${Math.round(h.x + 14)}px, ${Math.round(h.y + 14)}px)`;
      tip.hidden = false;
    },
  });

  const live = el('p', { role: 'status', 'aria-live': 'polite', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap' });
  const nowSel = createNowSelection({
    setSelection: (ids) => view.selectMany(ids, { ancestors: true }),
    clearSelection: () => view.select(null),
    announce: (t) => { live.textContent = t; },
  });
  const orphSel = createNowSelection({
    setSelection: (ids) => view.selectMany(ids),
    clearSelection: () => view.select(null),
    announce: (t) => { live.textContent = t.replace(/ of the playing song$/, ' with no connections'); },
  });
  const orphIds = () => (g ? orphanNodes(g).map((n) => n.id) : []);
  const nowIds = () => (g ? nodeIds(mapToNodes(songGenres(player.current), g)) : []);

  const zoomBar = el('div', { class: 'gm-zoom', role: 'group', 'aria-label': 'Zoom' },
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => view.zoom(1.3) }, icon('plus', 'action')),
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => view.zoom(1 / 1.3) }, icon('minus', 'action')),
    el('button', { class: 'gm-zbtn', type: 'button', 'aria-label': 'Fit all genres', title: 'Fit all', onclick: () => view.fit() }, icon('maximize', 'action')));

  function syncLegend() {
    legend.hidden = !legendOpen;
    legendBtn.setAttribute('aria-expanded', String(legendOpen));
  }

  function closeNow() {
    if (nowSel.active) nowSel.toggle([]);
    setNow(false);
    nowBtn.focus?.();
  }

  function closeOrph() {
    if (orphSel.active) orphSel.toggle([]);
    setOrph(false);
    orphBtn.focus?.();
  }

  function toggleOrph() {
    if (orphOpen || orphSel.active) { closeOrph(); return; }
    if (nowOpen || nowSel.active) {
      if (nowSel.active) nowSel.toggle([]);
      setNow(false);
    }
    if (orphSel.toggle(orphIds())) setOrph(true);
  }

  function setOrph(open) {
    orphOpen = open;
    renderOrph();
  }

  function renderOrph() {
    const list = g ? orphanNodes(g) : [];
    const st = orphanState(list.length);
    orphBtn.disabled = st.disabled;
    orphBtn.title = st.hint;
    orphBtn.textContent = st.label;
    if (orphSel.active) orphSel.songChanged(list.map((n) => n.id));
    if (!orphSel.active) orphOpen = false;
    if (orphBtn.disabled) orphOpen = false;
    orphBtn.setAttribute('aria-pressed', String(orphOpen));
    orphPop.hidden = !orphOpen;
    if (!orphOpen) { orphPop.replaceChildren(); return; }
    const cl = infoCard('gm-orphans-body', [
      el('ul', { class: 'gm-orph-list' }, list.map((n) => el('li', {},
        el('button', {
          class: 'gm-hit', type: 'button', onclick: () => view.select(n.id, { center: true }),
          onpointerenter: () => view.hoverId(n.id), onpointerleave: () => view.hoverId(null),
        }, el('span', { class: `gm-dot f${familyIndex(n.family)}`, 'aria-hidden': 'true' }), n.label, el('small', {}, songsText(n.count))))))]);
    orphPop.replaceChildren(
      el('div', { class: 'gm-now-head' },
        el('div', { class: 'gm-now-text' }, el('b', { class: 'gm-now-title' }, `Orphans (${list.length})`),
          el('small', { class: 'muted' }, 'Genres with no connections')),
        cl.button),
      cl.root);
  }

  function toggleNow() {
    if (orphOpen || orphSel.active) {
      if (orphSel.active) orphSel.toggle([]);
      setOrph(false);
    }
    if (nowOpen || nowSel.active) { closeNow(); return; }
    nowSel.toggle(nowIds());
    setNow(true);
  }

  function setNow(open) {
    nowOpen = open;
    nowBtn.setAttribute('aria-expanded', String(open));
    nowBtn.classList.toggle('on', open);
    renderNow();
  }

  function renderNow() {
    const song = player.current;
    const items = g ? mapToNodes(songGenres(song), g) : songGenres(song).map((x) => ({ ...x, id: null }));
    const st = nowPlayingState(song, items);
    nowBtn.disabled = st.kind !== 'ready';
    nowBtn.title = st.hint;
    const wasActive = nowSel.active;
    nowSel.songChanged(nodeIds(items));
    if (wasActive && !nowSel.active) nowOpen = false;
    nowBtn.setAttribute('aria-pressed', String(nowSel.active));
    if (nowBtn.disabled && nowOpen) nowOpen = false;
    nowBtn.setAttribute('aria-expanded', String(nowOpen));
    nowBtn.classList.toggle('on', nowOpen);
    nowPop.hidden = !nowOpen;
    const ids = nowOpen ? nodeIds(items) : [];
    view.setMarked(ids);
    if (!nowOpen) { nowPop.replaceChildren(); return; }
    const cover = el('img', { class: 'cover gm-now-cover', alt: '' });
    setCover(cover, song);
    const cl = infoCard('gm-now-body', [
      el('div', { class: 'gm-chips' }, items.length ? items.map((x) => (x.id
        ? el('button', {
          class: 'gm-chip', type: 'button', onclick: () => { view.select(x.id, { center: true }); nowOpen = true; renderNow(); },
          onpointerenter: () => view.hoverId(x.id), onpointerleave: () => view.hoverId(null),
        }, x.label)
        : el('span', { class: 'gm-chip gm-chip-off', title: 'Not in the map yet' }, x.label))) : el('span', { class: 'muted t-caption gm-now-none' }, 'This song has no genres')),
      el('button', { class: 'gm-tbtn gm-now-all', type: 'button', disabled: !ids.length, onclick: () => view.fitIds(ids) }, 'Show all')]);
    nowPop.replaceChildren(
      el('div', { class: 'gm-now-head' }, cover,
        el('div', { class: 'gm-now-text' }, el('b', { class: 'gm-now-title' }, titleNodes(song)),
          el('small', { class: 'muted' }, artistLine(song)),
          el('small', { class: 'muted gm-now-count' }, `${items.length} ${plural(items.length, 'genre', 'genres')}`)),
        cl.button),
      cl.root);
  }

  function setOutline(open, save = true) {
    outlineOpen = open;
    if (save) saveOutlineOpen(localStorage, open);
    gm.classList.toggle('outline-open', open);
    outlineBtn.setAttribute('aria-expanded', String(open));
    outlineBtn.classList.toggle('on', open);
    outlinePanel.hidden = !open;
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
    const morePill = more > 0 ? el('span', { class: 'muted t-caption' }, `+${more} more`) : null;
    const exact = n.ownCount !== n.count ? ` (${n.ownCount} tagged exactly)` : '';
    const cl = infoCard('gm-info-body', [
      kids.length ? el('div', { class: 'gm-group' }, el('p', { class: 't-eyebrow' }, 'SUBGENRES'),
        el('div', { class: 'gm-chips' }, kids.slice(0, CHILD_CHIPS).map(chip), morePill)) : null,
      el('button', {
        class: 'btn primary small', type: 'button', disabled: !n.count,
        onclick: () => { filterByTags(filterTags(g, n.id)); location.hash = '#/library'; },
      }, `Show ${songsText(n.count)} in Library`)]);
    panel.replaceChildren(
      el('div', { class: 'gm-panel-head' },
        el('span', { class: `gm-dot f${familyIndex(n.family)}`, 'aria-hidden': 'true' }),
        el('h2', { class: 't-headline' }, n.label),
        wikiButton(n),
        cl.button,
        el('button', { class: 'gm-x', type: 'button', 'aria-label': 'Close', title: 'Close', onclick: () => view.select(null) }, icon('clear', 'nav'))),
      el('p', { class: 'muted t-caption' }, `${n.family} · ${songsText(n.count)}${exact}`),
      cl.root);
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
        onclick: () => {
          if (expanded.has(r.key)) expanded.delete(r.key);
          else expanded.add(r.key);
          saveOpen();
          renderOutline();
        },
      }, toggleIcon(r));
      const label = el('button', {
        class: 'gm-lbl', type: 'button', 'aria-current': r.id && r.id === selectedId ? 'true' : null,
        onpointerenter: () => view.hoverId(isFamily ? null : r.id), onpointerleave: () => view.hoverId(null),
        onclick: () => {
          if (isFamily) { toggle.click(); return; }
          view.select(r.id, { center: true });
        },
      }, el('span', { class: `gm-dot f${familyIndex(r.family)}`, 'aria-hidden': 'true' }), r.label);
      const unitWord = r.unit === 'style' ? plural(r.size, 'style', 'styles') : plural(r.size, 'root', 'roots');
      const countText = isFamily ? `${r.size} ${unitWord}` : String(r.count);
      return el('li', {
        class: `gm-row${isFamily ? ' fam' : ''}${r.id && r.id === selectedId ? ' sel' : ''}`, style: `--depth:${r.depth}`, 'data-key': r.key,
      }, toggle, label,
      el('small', { class: 'muted' }, countText),
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
    legend.append(el('li', { class: 'gm-legend-note' }, 'Arrow points to the parent genre (A -> B means A is a kind of B)'));
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
    renderNow();
    renderOrph();
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
      const message = loadMessage(data, pending);
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
    renderOrph();
  });

  const barCl = createCollapsible({
    id: 'gm-bar-body',
    collapsed: loadCollapsed(localStorage, PANEL_KEYS.genres, window.innerWidth),
    onToggle: (v) => saveCollapsed(localStorage, PANEL_KEYS.genres, v),
    content: [el('div', { class: 'gm-find' }, search, results), legend],
  });

  const gm = el('div', { class: 'gm' },
    el('div', { class: 'gm-stage' }, canvas, tip),
    el('div', { class: 'gm-bar' },
      el('div', { class: 'gm-bar-row' },
        barCl.button,
        el('h1', { class: 'gm-title' }, 'Genres map'),
        note,
        legendBtn, nowBtn, orphBtn),
      nowPop,
      orphPop,
      barCl.root),
    outlineBtn,
    zoomBar,
    panel,
    outlinePanel,
    live);
  root.append(gm);
  const unsubPlayer = player.onChange(renderNow);
  const unsubNowStore = store.subscribe(renderNow);
  renderNow();
  const stopInset = watchPlayerInset(gm, (h) => view.setInsets({ b: 16 + h }));
  gm.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.target === search) return;
    if (orphOpen || orphSel.active) closeOrph();
    else if (nowOpen || nowSel.active) closeNow();
    else if (outlineOpen) setOutline(false);
  });
  if (!hasStoredExpanded(localStorage)) for (const f of FAMILIES) expanded.add(`f:${f}`);
  setOutline(outlineOpen, false);

  void load();

  return () => {
    dead = true;
    stopInset();
    unsubPlayer();
    unsubNowStore();
    clearTimeout(pollTimer);
    unsub();
    view.destroy();
  };
}
