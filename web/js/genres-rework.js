import { api, isSignedIn } from './api.js';
import { el, pageHead, toast } from './dom.js';
import { familyIndex, isHiddenFamily, dotClass, claimMapColours } from './genre-data.js';
import { createForceView } from './genre-force-view.js';
import { isGuest } from './guest.js';
import { buildMapGraph } from './genre-map-graph.js';
import { legacyRootId, legacyIds, legacyVisible, legacyMarks } from './genre-legacy.js';
import { createGenreDock } from './genre-dock.js';
import { createV2InfoRenderer } from './genres-v2-info.js';
import { createLayoutStore } from './genre-layout-store.js';
import { onGenreFocus, takeGenreFocus } from './genre-focus.js';
import { buildTree, resolveNode, applyCounts, count } from './genre-levels.js';
import { saveSelected, loadSelected, loadRelated, loadFusion, clearSubfamilies } from './genres-rework-storage.js';
import { failureText } from './genres-rework-text.js';
import { pageTitle, createZoomBar } from './genres-rework-chrome.js';
import { settledValue, adaptVocab } from './genres-rework-load.js';

const NARROW_PX = 720;
const store = () => globalThis.localStorage;
export { SELECTED_KEY, loadSelected, saveSelected, RELATED_KEY, FUSION_KEY, loadRelated, loadFusion } from './genres-rework-storage.js';

export function renderGenresMap(root, opts = {}) {
  let dead = false;
  let tree = null;
  let graph = null;
  let selectedId = null;
  let lastData = null;
  let userLayout = null;
  let pendingSelected = loadSelected(store());
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let legacyId = null;
  let legacyOpen = false;
  const fusion = loadFusion(store());
  const related = loadRelated(store());
  clearSubfamilies(store());
  const layoutStore = !isGuest() && isSignedIn() ? createLayoutStore() : null;

  const status = el('p', { class: 'gm-status t-caption', role: 'status', hidden: true });
  const canvas = el('canvas', {
    class: 'gmr-canvas gmr-graph', role: 'img', tabindex: '-1',
    'aria-label': 'Map of all genres. Drag a circle to pull its neighbours, drag the background to pan, scroll or pinch to zoom, double-click a circle to centre it.',
  });
  const wrap = el('div', { class: 'gm gmr has-dock gm-v2' });
  const work = el('div', { class: 'gm-work' });

  const narrow = () => (window.innerWidth || 1200) < NARROW_PX;
  const dotFor = (name) => dotClass(familyIndex((tree && resolveNode(name, tree))?.family || name));

  function selectByName(name) {
    const n = tree && resolveNode(name, tree);
    if (n) select(n.id, { center: true });
  }

  const dock = createGenreDock({
    renderInfo: createV2InfoRenderer(() => lastData?.vocab?.v2, dotFor),
    dotFor,
    storage: store(),
    narrow,
    onNavigate: selectByName,
    onMap: (n) => selectByName(n.name),
  });

  const currentVisible = () => legacyVisible(tree, legacyId, legacyOpen);
  const onMap = (id) => !!graph?.byId.has(id) && (currentVisible()?.has(id) ?? true);

  function syncMap(animate = true) {
    const vis = currentVisible();
    if (animate) view.setVisible(vis, { heat: 0.4, keepCamera: true, chained: true });
    else view.setVisible(vis);
    view.setMarks?.(legacyMarks(legacyId, legacyOpen));
  }

  function setLegacyOpen(on) {
    if (!legacyId || legacyOpen === on) return;
    legacyOpen = on;
    syncMap();
    if (selectedId && !onMap(selectedId)) deselect();
  }

  function canvasSelect(id) {
    if (!id) { deselect(); return; }
    if (id === legacyId) setLegacyOpen(!legacyOpen);
    select(id, { map: true });
  }

  const view = (opts?.forceViewFactory || createForceView)(canvas, {
    reducedMotion: reduced,
    rigid: true,
    onMoved: () => layoutStore?.touch(),
    onSelect: canvasSelect,
  });

  function markMatches() {
    const n = tree && selectedId ? tree.byId.get(selectedId) : null;
    const hidden = n?.level === 1 && isHiddenFamily(n.name) ? n : null;
    view.setMatches(hidden ? hidden.children.filter((c) => onMap(c.id)).map((c) => c.id) : []);
  }

  function centre(id) {
    const n = tree?.byId.get(id);
    if (n?.level === 1 && isHiddenFamily(n.name)) {
      const best = n.children.filter((c) => onMap(c.id)).sort((a, b) => count(b) - count(a))[0];
      if (best) view.focusNode(best.id);
      return;
    }
    if (onMap(id)) view.focusNode(id);
  }

  function select(id, { center = false, map = false } = {}) {
    if (!map && legacyId && !legacyOpen && legacyIds(tree, legacyId).has(id)) setLegacyOpen(true);
    selectedId = id;
    const n = tree?.byId.get(id);
    saveSelected(store(), n?.name);
    dock.show(n ? n.name : null, n?.label);
    view.select(id);
    markMatches();
    if (center) centre(id);
  }

  function deselect() {
    selectedId = null;
    saveSelected(store(), null);
    dock.show(null);
    view.select(null);
    markMatches();
  }

  function applyFocusRequest() {
    if (!tree) return;
    const want = takeGenreFocus();
    if (!want) return;
    const n = resolveNode(want, tree);
    if (!n) { toast(`${want} is not on the map`); return; }
    select(n.id, { center: true });
  }

  function showLoadFailure(v, vocab) {
    tree = null;
    graph = null;
    view.setGraph({ nodes: [], links: [] });
    status.hidden = false;
    status.textContent = failureText(v, vocab);
  }

  async function load() {
    status.hidden = true;
    const [v, l, lay] = await Promise.allSettled([api.genresV2(), api.library(), layoutStore ? layoutStore.sync() : Promise.resolve(null)]);
    userLayout = settledValue(lay);
    if (dead) return;
    const vocab = adaptVocab(settledValue(v));
    if (!vocab || l.status !== 'fulfilled') { showLoadFailure(v, vocab); return; }
    lastData = { vocab, lib: l.value };
    applyData();
  }

  function applyData() {
    tree = buildTree(lastData.vocab, { fusion });
    claimMapColours();
    applyCounts(tree, lastData.lib);
    graph = buildMapGraph(tree);
    legacyId = legacyRootId(tree, lastData.vocab.v2?.byName);
    legacyOpen = false;
    if (layoutStore) userLayout = layoutStore.current();
    view.setGraph(graph, { saved: userLayout?.size ? userLayout : null, moved: userLayout });
    view.setRelated?.(related);
    if (selectedId && !tree.byId.has(selectedId)) selectedId = null;
    dock.show(null);
    view.select(selectedId);
    syncMap(false);
    markMatches();
    restoreSelected();
    applyFocusRequest();
  }

  function restoreSelected() {
    const name = pendingSelected;
    pendingSelected = null;
    if (!name || selectedId) return;
    const n = resolveNode(name, tree);
    if (n) select(n.id);
  }

  work.append(canvas, dock.node, createZoomBar(() => view), status);
  wrap.append(pageHead(pageTitle), work);
  root.append(wrap);

  const unsubFocus = onGenreFocus(applyFocusRequest);
  layoutStore?.attach({ collect: () => view.movedPositions?.() || new Map(), known: (id) => !!graph?.nodes.some((n) => n.id === id) });
  load().catch(() => {
    if (dead) return;
    status.hidden = false;
    status.textContent = 'Failed to load';
  });
  return () => {
    dead = true;
    layoutStore?.dispose();
    unsubFocus();
    dock.destroy();
    view.destroy();
  };
}
