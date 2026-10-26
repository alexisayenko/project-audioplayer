import { ancestorIds } from './genre-levels.js';

export const DRILL_KEY = 'electrophone.genresDrill';

export function loadDrill(storage) {
  try { return storage?.getItem(DRILL_KEY) !== '0'; } catch { return true; }
}

export function saveDrill(storage, on) {
  try { storage?.setItem(DRILL_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

const FOCUS_DEPTH = 20;

export const newDrill = () => ({ open: new Set(), anchors: new Set(), focus: [] });

export const drillEmpty = (s) => !s.open.size && !s.anchors.size;

export function pruneDrill(s, graph) {
  for (const id of s.open) if (!graph?.byId.has(id)) s.open.delete(id);
  for (const id of s.anchors) if (!graph?.byId.has(id)) s.anchors.delete(id);
}

const allowed = (allow, id) => !allow || allow.has(id);

function shownParents(graph, allow, id) {
  return (graph.byId.get(id)?.node.parents || []).filter((p) => graph.byId.has(p) && allowed(allow, p));
}

function shownKids(graph, allow, id) {
  return (graph.byId.get(id)?.node.children || []).map((c) => c.id).filter((c) => graph.byId.has(c) && allowed(allow, c));
}

export function drillTop(graph, allow = null) {
  return graph.nodes.filter((n) => allowed(allow, n.id) && !shownParents(graph, allow, n.id).length).map((n) => n.id);
}

const isTop = (graph, allow, id) => !shownParents(graph, allow, id).length;

export function drillVisible(tree, graph, state, allow = null) {
  const out = new Set(drillTop(graph, allow));
  for (const a of state.anchors) {
    if (!graph.byId.has(a)) continue;
    for (const x of ancestorIds(tree, a)) if (graph.byId.has(x) && allowed(allow, x)) out.add(x);
  }
  expandOpen(graph, allow, state, out);
  return out;
}

function expandOpen(graph, allow, state, out) {
  const seen = new Set();
  const stack = [...out];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    if (!state.open.has(id)) continue;
    for (const c of shownKids(graph, allow, id)) { out.add(c); stack.push(c); }
  }
}

function descendants(graph, id) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const x = stack.pop();
    for (const c of graph.byId.get(x)?.node.children || []) {
      if (!graph.byId.has(c.id) || out.has(c.id)) continue;
      out.add(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

function collapse(tree, graph, state, id, allow) {
  state.open.delete(id);
  state.anchors.delete(id);
  for (const d of descendants(graph, id)) { state.open.delete(d); state.anchors.delete(d); }
  if (!drillVisible(tree, graph, state, allow).has(id)) state.anchors.add(id);
}

function liveFocus(state) {
  while (state.focus.length && !state.anchors.has(state.focus.at(-1).id)) state.focus.pop();
  return state.focus.at(-1) || null;
}

function focusNode(graph, state, id, allow) {
  state.focus.push({ id, open: new Set(state.open), anchors: new Set(state.anchors) });
  if (state.focus.length > FOCUS_DEPTH) state.focus.shift();
  state.open.clear();
  state.anchors.clear();
  state.anchors.add(id);
  if (shownKids(graph, allow, id).length) state.open.add(id);
}

function unfocus(state) {
  const saved = state.focus.pop();
  state.open = new Set(saved.open);
  state.anchors = new Set(saved.anchors);
}

export function toggleDrill(tree, graph, state, id, allow = null) {
  if (!graph?.byId.has(id) || !drillVisible(tree, graph, state, allow).has(id)) return false;
  if (state.open.has(id)) { collapse(tree, graph, state, id, allow); return true; }
  const multi = shownParents(graph, allow, id).length > 1;
  if (!multi && !shownKids(graph, allow, id).length) return false;
  state.open.add(id);
  if (multi) state.anchors.add(id);
  return true;
}

export function clickDrill(tree, graph, state, id, allow = null) {
  if (!graph?.byId.has(id) || !drillVisible(tree, graph, state, allow).has(id)) return false;
  if (isTop(graph, allow, id)) return toggleDrill(tree, graph, state, id, allow);
  const top = liveFocus(state);
  if (top?.id === id) { unfocus(state); return true; }
  if (state.open.has(id) || (top && ancestorIds(tree, top.id).has(id))) return toggleDrill(tree, graph, state, id, allow);
  focusNode(graph, state, id, allow);
  return true;
}

export function revealDrill(tree, graph, state, id, allow = null) {
  if (!graph?.byId.has(id) || !allowed(allow, id)) return false;
  if (!isTop(graph, allow, id)) {
    if (liveFocus(state)?.id === id) return false;
    focusNode(graph, state, id, allow);
    return true;
  }
  const vis = drillVisible(tree, graph, state, allow);
  if (vis.has(id) && shownParents(graph, allow, id).every((p) => vis.has(p))) return false;
  state.anchors.add(id);
  return true;
}

export function collapseDrill(state) {
  const had = !drillEmpty(state);
  state.open.clear();
  state.anchors.clear();
  state.focus.length = 0;
  return had;
}

export function drillMarks(graph, state, allow, visible) {
  const marks = new Map();
  for (const id of visible) {
    if (state.open.has(id)) { marks.set(id, 'open'); continue; }
    const hiddenKid = shownKids(graph, allow, id).some((c) => !visible.has(c));
    const hiddenParent = shownParents(graph, allow, id).some((p) => !visible.has(p));
    if (hiddenKid || hiddenParent) marks.set(id, 'closed');
  }
  return marks;
}
