export const FAMILIES = [
  'Electronic', 'Rock', 'Pop', 'Hip Hop', 'Jazz', 'Funk / Soul', 'Classical', 'Reggae', 'Latin',
  'Blues', 'Folk, World, & Country', 'Other',
];

export const FAMILY_ORDER = [
  'Blues', 'Classical', 'Electronic', 'Folk, World, & Country', 'Funk / Soul', 'Hip Hop', 'Jazz',
  'Latin', 'Pop', 'Reggae', 'Rock', 'Other',
];

export const familyOrder = (family) => {
  const i = FAMILY_ORDER.indexOf(family);
  return i < 0 ? FAMILY_ORDER.length - 1 : i;
};

export const FAMILY_PALETTE_SIZE = 16;
export const OTHER_COLOR = FAMILY_PALETTE_SIZE - 1;

export const familyIndex = (family) => {
  const i = FAMILIES.indexOf(family);
  return i < 0 || family === 'Other' ? OTHER_COLOR : i;
};

export const nodeRadius = (count) => Math.min(30, 4 + 2.4 * Math.sqrt(Math.max(0, count)));

const byCountThenLabel = (a, b) => b.count - a.count || a.label.localeCompare(b.label);

export function indexGraph(data) {
  const nodes = (data?.nodes || []).map((n) => ({ ...n, parents: [], tags: n.tags || [] }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const src = new Map((data?.nodes || []).map((n) => [n.id, n]));
  const children = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) {
    for (const p of src.get(n.id).parents || []) {
      if (byId.has(p) && p !== n.id && !n.parents.includes(p)) {
        n.parents.push(p);
        children.get(p).push(n.id);
      }
    }
  }
  const edges = (data?.edges || []).filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target);
  const roots = nodes.filter((n) => !n.parents.length).sort(byCountThenLabel).map((n) => n.id);
  return { nodes, byId, children, edges, roots, ontology: !!data?.ontology };
}

export function flatGraph(tags) {
  const nodes = [];
  const seen = new Set();
  for (const { tag, count } of tags || []) {
    const i = tag.indexOf(':');
    if (i <= 0 || tag.slice(0, i).toLowerCase() !== 'genre') continue;
    const label = tag.slice(i + 1).trim();
    const key = label.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    nodes.push({ id: key, label, qid: null, family: 'Other', count, ownCount: count, parents: [], tags: [key] });
  }
  return { nodes, edges: [], ontology: false };
}

export function descendantIds(g, id) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const x = stack.pop();
    if (out.has(x) || !g.byId.has(x)) continue;
    out.add(x);
    for (const c of g.children.get(x) || []) stack.push(c);
  }
  return out;
}

const tagKey = (n) => (n.tags.length ? n.tags : [n.label.toLowerCase()]);

export function filterTags(g, id) {
  const out = new Set();
  for (const d of descendantIds(g, id)) {
    for (const k of g.byId.get(d).tags) out.add(`genre:${k}`);
  }
  return [...out];
}

export function localCounts(g, songs) {
  const own = new Map(g.nodes.map((n) => [n.id, new Set()]));
  const owner = new Map();
  for (const n of g.nodes) for (const k of tagKey(n)) owner.set(k.toLowerCase(), n.id);
  for (const s of songs) {
    for (const t of s.tags || []) {
      const i = String(t).indexOf(':');
      if (i <= 0 || t.slice(0, i).trim().toLowerCase() !== 'genre') continue;
      const id = owner.get(t.slice(i + 1).trim().toLowerCase().replace(/\s+/g, ' '));
      if (id) own.get(id).add(s.id);
    }
  }
  const reach = new Map();
  const visit = (id, path) => {
    if (reach.has(id)) return reach.get(id);
    const set = new Set(own.get(id));
    reach.set(id, set);
    for (const c of g.children.get(id) || []) {
      if (path.has(c)) continue;
      for (const s of visit(c, new Set(path).add(id))) set.add(s);
    }
    return set;
  };
  const out = new Map();
  for (const n of g.nodes) out.set(n.id, { count: visit(n.id, new Set()).size, ownCount: own.get(n.id).size });
  return out;
}

function searchRank(label, q, at) {
  if (label === q) return 0;
  if (at === 0) return 1;
  return label.split(/\W+/).includes(q) ? 2 : 3;
}

export function searchNodes(g, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const n of g.nodes) {
    const l = n.label.toLowerCase();
    const at = l.indexOf(q);
    if (at < 0) continue;
    scored.push({ n, rank: searchRank(l, q, at) });
  }
  scored.sort((a, b) => a.rank - b.rank || b.n.count - a.n.count || a.n.label.localeCompare(b.n.label));
  return scored.slice(0, limit).map((s) => s.n);
}

const familyKey = (f) => `f:${f}`;

export const CATEGORY_NAMES = [
  /^ethnic music$/, /^music of .+/, /^.+ diaspora$/, /^world music$/, /^folk music of .+/,
  /^by (country|region|genre|decade)$/, /^music genre$/, /^music by .+/,
  /^acoustic music$/, /^vocal music$/, /^instrumental music$/, /^regional music$/, /^national music$/, /^traditional music$/, /^folk music by .+/, /^music genres? by .+/,
];

export const isCategoryNode = (n) => (n.ownCount ?? n.count) === 0 && CATEGORY_NAMES.some((re) => re.test(n.label.trim().toLowerCase()));

const views = new WeakMap();
const hybridViews = new WeakMap();

function buildView(g, include = () => true) {
  const skip = new Set(g.nodes.filter((n) => !include(n) || isCategoryNode(n)).map((n) => n.id));
  const up = new Map();
  const eff = (id) => {
    if (up.has(id)) return up.get(id);
    up.set(id, []);
    const out = [];
    for (const p of g.byId.get(id).parents) for (const q of skip.has(p) ? eff(p) : [p]) if (!out.includes(q) && q !== id) out.push(q);
    up.set(id, out);
    return out;
  };
  const parents = new Map();
  const children = new Map();
  const roots = [];
  for (const n of g.nodes) {
    if (skip.has(n.id)) continue;
    const ps = eff(n.id);
    parents.set(n.id, ps);
    children.set(n.id, children.get(n.id) || []);
    for (const p of ps) children.set(p, [...(children.get(p) || []), n.id]);
    if (!ps.length) roots.push(n.id);
  }
  roots.sort((a, b) => byCountThenLabel(g.byId.get(a), g.byId.get(b)));
  return { skip, parents, children, roots, eff };
}

function outlineView(g) {
  if (!views.has(g)) views.set(g, buildView(g));
  return views.get(g);
}

function familyGroups(g, roots) {
  const groups = new Map();
  for (const id of roots) {
    const n = g.byId.get(id);
    const list = groups.get(n.family) || [];
    list.push(id);
    groups.set(n.family, list);
  }
  return [...groups.entries()].sort((a, b) => familyOrder(a[0]) - familyOrder(b[0]));
}

const own = (n) => n.ownCount ?? n.count;
const foldName = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim().replace(/ music$/, '');

export const hasAnchors = (g) => g.nodes.some((n) => n.anchor);

function isOwnAnchor(g, n) {
  if (!n.anchor) return false;
  const s = foldName(n.anchor);
  if (foldName(n.label) === s || n.tags.some((t) => foldName(t) === s)) return true;
  return !n.parents.some((p) => g.byId.get(p).anchor === n.anchor);
}

function hybridView(g) {
  if (hybridViews.has(g)) return hybridViews.get(g);
  const anchors = new Set(g.nodes.filter((n) => isOwnAnchor(g, n)).map((n) => n.id));
  const shownHung = new Set(g.nodes.filter((n) => n.anchor && !anchors.has(n.id) && own(n) > 0).map((n) => n.id));
  const upMemo = new Map();
  const up = (id) => {
    if (upMemo.has(id)) return upMemo.get(id);
    upMemo.set(id, []);
    const out = [];
    for (const p of g.byId.get(id).parents) {
      for (const q of anchors.has(p) || shownHung.has(p) ? [p] : up(p)) if (q !== id && !out.includes(q)) out.push(q);
    }
    upMemo.set(id, out);
    return out;
  };
  const sset = new Map();
  const anchorSet = (id, path = new Set()) => {
    if (anchors.has(id)) return new Set([id]);
    if (sset.has(id)) return sset.get(id);
    if (path.has(id)) return new Set();
    const out = new Set();
    for (const p of up(id)) for (const s of anchorSet(p, new Set(path).add(id))) out.add(s);
    sset.set(id, out);
    return out;
  };
  const placed = new Map();
  const orphans = new Set();
  for (const id of shownHung) {
    const ups = up(id);
    if (!ups.length) { orphans.add(id); continue; }
    const hungParents = ups.filter((x) => !anchors.has(x));
    const keep = ups.filter((x) => !anchors.has(x) || !hungParents.some((m) => anchorSet(m).has(x)));
    placed.set(id, keep.length ? keep : ups);
  }
  const fb = buildView(g, (n) => !n.anchor || orphans.has(n.id));
  const kids = new Map();
  for (const [id, ps] of placed) for (const p of ps) kids.set(p, [...(kids.get(p) || []), id]);
  const seen = new Map();
  const fbVisible = (id, path = new Set()) => {
    if (seen.has(id)) return seen.get(id);
    const n = g.byId.get(id);
    let ok = own(n) > 0;
    for (const c of fb.children.get(id) || []) if (!ok && !path.has(c)) ok = fbVisible(c, new Set(path).add(id));
    seen.set(id, ok);
    return ok;
  };
  const roots = [...anchors].filter((id) => g.byId.get(id).count > 0).concat(fb.roots.filter((id) => fbVisible(id)));
  roots.sort((a, b) => byCountThenLabel(g.byId.get(a), g.byId.get(b)));
  const row = (id) => anchors.has(id) || placed.has(id) || (fb.parents.has(id) && fbVisible(id));
  const parentsOf = (id) => {
    if (anchors.has(id)) return [];
    if (placed.has(id)) return placed.get(id);
    if (fb.parents.has(id) && fbVisible(id)) return fb.parents.get(id).filter((p) => row(p));
    const n = g.byId.get(id);
    return (n.anchor && !orphans.has(id) ? up(id) : fb.eff(id)).filter(row);
  };
  const children = (id) => {
    const fbKids = (fb.children.get(id) || []).filter((c) => fbVisible(c));
    return [...new Set([...(kids.get(id) || []), ...fbKids])];
  };
  const view = { anchors, roots, row, parentsOf, children };
  hybridViews.set(g, view);
  return view;
}

function hybridRows(g, expanded) {
  const v = hybridView(g);
  const rows = [];
  const walk = (id, depth, key, via, path) => {
    const n = g.byId.get(id);
    const kids = v.children(id).filter((c) => !path.has(c));
    const open = expanded.has(key) && kids.length > 0;
    rows.push({
      key, id, depth, label: n.label, count: n.count, family: n.family, hasChildren: kids.length > 0, expanded: open,
      alsoUnder: v.parentsOf(id).filter((p) => p !== via).map((p) => g.byId.get(p).label),
      ...(v.anchors.has(id) ? { kind: 'genre' } : {}),
    });
    if (!open) return;
    for (const c of kids.map((x) => g.byId.get(x)).sort(byCountThenLabel)) walk(c.id, depth + 1, `${key}>${c.id}`, id, new Set(path).add(id));
  };
  for (const [family, ids] of familyGroups(g, v.roots)) {
    const key = familyKey(family);
    const open = expanded.has(key);
    const anchored = ids.filter((id) => v.anchors.has(id)).length;
    rows.push({ key, id: null, depth: 0, label: family, count: null, family, hasChildren: true, expanded: open, alsoUnder: [], kind: 'family', size: ids.length, unit: anchored === ids.length ? 'genre' : 'root' });
    if (open) for (const id of ids) walk(id, 1, `${key}>${id}`, null, new Set());
  }
  return rows;
}

export function outlineRows(g, expanded) {
  if (hasAnchors(g)) return hybridRows(g, expanded);
  const v = outlineView(g);
  const rows = [];
  const walk = (id, depth, key, via, path) => {
    const n = g.byId.get(id);
    const kids = (v.children.get(id) || []).filter((c) => !path.has(c));
    const open = expanded.has(key) && kids.length > 0;
    rows.push({
      key, id, depth, label: n.label, count: n.count, family: n.family, hasChildren: kids.length > 0, expanded: open,
      alsoUnder: v.parents.get(id).filter((p) => p !== via).map((p) => g.byId.get(p).label),
    });
    if (!open) return;
    const sorted = kids.map((c) => g.byId.get(c)).sort(byCountThenLabel);
    for (const c of sorted) walk(c.id, depth + 1, `${key}>${c.id}`, id, new Set(path).add(id));
  };
  for (const [family, ids] of familyGroups(g, v.roots)) {
    const key = familyKey(family);
    const open = expanded.has(key);
    rows.push({ key, id: null, depth: 0, label: family, count: null, family, hasChildren: true, expanded: open, alsoUnder: [], kind: 'family', size: ids.length, unit: 'root' });
    if (open) for (const id of ids) walk(id, 1, `${key}>${id}`, null, new Set());
  }
  return rows;
}

function keysOf(g, chain) {
  const keys = [familyKey(g.byId.get(chain[0]).family)];
  for (const c of chain) keys.push(`${keys.at(-1)}>${c}`);
  return keys;
}

function hybridPath(g, id) {
  const v = hybridView(g);
  if (!v.row(id)) id = [...v.parentsOf(id)].sort((a, b) => byCountThenLabel(g.byId.get(a), g.byId.get(b)))[0];
  if (!id) return [];
  const chain = [id];
  const seen = new Set(chain);
  for (;;) {
    const next = v.parentsOf(chain[0]).map((p) => g.byId.get(p)).sort(byCountThenLabel).find((p) => !seen.has(p.id));
    if (!next) break;
    chain.unshift(next.id);
    seen.add(next.id);
  }
  return keysOf(g, chain);
}

export function pathKeys(g, id) {
  if (!g.byId.get(id)) return [];
  if (hasAnchors(g)) return hybridPath(g, id);
  const v = outlineView(g);
  if (v.skip.has(id)) id = v.eff(id).sort((a, b) => byCountThenLabel(g.byId.get(a), g.byId.get(b)))[0];
  const n = g.byId.get(id);
  if (!n) return [];
  const chain = [id];
  const seen = new Set(chain);
  let cur = n;
  while (v.parents.get(cur.id).length) {
    const next = [...v.parents.get(cur.id)].map((p) => g.byId.get(p)).sort(byCountThenLabel).find((p) => !seen.has(p.id));
    if (!next) break;
    chain.unshift(next.id);
    seen.add(next.id);
    cur = next;
  }
  return keysOf(g, chain);
}

const STORE_KEY = 'electrophone.genresOutline';

export function loadExpanded(storage) {
  try {
    const raw = JSON.parse(storage.getItem(STORE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((k) => typeof k === 'string') : []);
  } catch { return new Set(); }
}

export function saveExpanded(storage, expanded) {
  try { storage.setItem(STORE_KEY, JSON.stringify([...expanded].slice(0, 500))); return true; } catch { return false; }
}

export function hasStoredExpanded(storage) {
  try { return storage.getItem(STORE_KEY) !== null; } catch { return true; }
}

function parentLinks(edges) {
  const up = new Map();
  for (const e of edges || []) {
    if (e.kind === 'related' || e.source === e.target) continue;
    if (!up.has(e.source)) up.set(e.source, []);
    up.get(e.source).push(e.target);
  }
  return up;
}

export function ancestorsOf(id, edges, maxDepth = 12) {
  const up = parentLinks(edges);
  const depth = new Map();
  let level = [id];
  for (let d = 1; d <= maxDepth && level.length; d++) {
    const next = [];
    for (const n of level) {
      for (const p of up.get(n) || []) {
        if (p === id || depth.has(p)) continue;
        depth.set(p, d);
        next.push(p);
      }
    }
    level = next;
  }
  return depth;
}
