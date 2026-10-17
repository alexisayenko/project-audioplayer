import { buildIndex, resolveGenre, vkey } from './genre-vocab.js';

const spaced = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

export function hasLevels(vocab) {
  return !!vocab && typeof vocab.levels === 'object' && vocab.levels !== null && Object.keys(vocab.levels).length > 0;
}

const effectiveStatus = (v) => (v.status === 'question' || (v.status === 'approved' && v.discogs === false) ? v.status : null);

function makeNode(id, name, level, genre, extra = {}) {
  return {
    id, name, level, genre, parent: null, children: [], alsoUnder: [], discogs: true, synonyms: [], provisional: false, status: null, flavours: [], display: null, label: name, alsoIn: [],
    own: new Set(), all: new Set(), ...extra,
  };
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

function styleNode(k, v) {
  const display = typeof v.display === 'string' && v.display.trim() ? v.display.trim() : null;
  const n = makeNode(`s:${k}`, k, v.parent ? 3 : 2, v.genre, {
    discogs: v.discogs !== false, synonyms: [...(v.synonyms || [])], provisional: v.provisional === true, status: effectiveStatus(v), display, flavours: Array.isArray(v.flavours) ? [...v.flavours] : [], alsoUnder: [...(v.also_under || [])],
  });
  n.label = n.display || k;
  n.alsoIn = Array.isArray(v.also_in_genres) ? v.also_in_genres.filter((g) => g !== v.genre) : [];
  return n;
}

function linkStyles(levels, styles, byId) {
  for (const [k, v] of Object.entries(levels)) {
    const n = styles.get(k);
    const p = v.parent ? styles.get(v.parent) : byId.get(`g:${v.genre}`);
    if (!p) continue;
    n.parent = p.id;
    p.children.push(n);
  }
  for (const n of styles.values()) {
    if (n.level !== 2) continue;
    for (const g of n.alsoIn) byId.get(`g:${g}`)?.children.push(n);
  }
  for (const n of byId.values()) n.children.sort(byName);
}

function nodeLookups(byId) {
  const byKey = new Map();
  const bySyn = new Map();
  for (const n of byId.values()) if (!byKey.has(vkey(n.name))) byKey.set(vkey(n.name), n);
  for (const n of byId.values()) if (n.display && !byKey.has(vkey(n.display))) byKey.set(vkey(n.display), n);
  for (const n of byId.values()) for (const s of n.synonyms) if (!bySyn.has(vkey(s)) && !byKey.has(vkey(s))) bySyn.set(vkey(s), n);
  return { byKey, bySyn };
}

export function buildTree(vocab) {
  const levels = vocab?.levels || {};
  const gsyn = vocab?.genre_synonyms || {};
  const names = Array.isArray(vocab?.families) && vocab.families.length ? vocab.families : Object.keys(gsyn);
  const byId = new Map();
  const roots = names.map((g) => {
    const n = makeNode(`g:${g}`, g, 1, g, { synonyms: [...(gsyn[g] || [])] });
    byId.set(n.id, n);
    return n;
  });
  const styles = new Map();
  for (const [k, v] of Object.entries(levels)) {
    const n = styleNode(k, v);
    styles.set(k, n);
    byId.set(n.id, n);
  }
  linkStyles(levels, styles, byId);
  const flavours = new Map(Object.entries(vocab?.flavours || {}).map(([key, f]) => [key, { key, name: f.name || key, kind: f.kind === 'scene' ? 'scene' : 'sound', description: f.description || '', songs: new Set() }]));
  for (const n of byId.values()) n.flavours = n.flavours.filter((f) => flavours.has(f));
  const { byKey, bySyn } = nodeLookups(byId);
  return { roots, byId, byKey, bySyn, flavours, index: buildIndex(vocab) };
}

export function resolveNode(text, tree) {
  const raw = spaced(text);
  if (!raw || !tree) return null;
  const k = vkey(raw);
  const direct = tree.byKey.get(k) || tree.bySyn.get(k);
  if (direct) return direct;
  const hit = resolveGenre(raw, tree.index);
  return hit ? tree.byKey.get(vkey(hit.name)) || null : null;
}

export function chain(tree, id) {
  const out = [];
  for (let n = tree.byId.get(id); n; n = n.parent ? tree.byId.get(n.parent) : null) out.unshift(n);
  return out;
}

export function ancestorIds(tree, id) {
  const out = new Set();
  for (const a of chain(tree, id)) {
    out.add(a.id);
    for (const g of a.alsoIn) if (tree.byId.has(`g:${g}`)) out.add(`g:${g}`);
  }
  return out;
}

export function otherGenres(n, rootName) {
  return n.level === 2 ? [n.genre, ...n.alsoIn].filter((g) => g !== rootName) : [];
}

function countSong(tree, s, sid) {
  for (const t of s.tags || []) {
    if (typeof t !== 'string' || !t.toLowerCase().startsWith('genre:')) continue;
    const node = resolveNode(t.slice(6), tree);
    if (!node) continue;
    node.own.add(sid);
    for (const f of node.flavours) tree.flavours.get(f).songs.add(sid);
    for (const a of ancestorIds(tree, node.id)) tree.byId.get(a).all.add(sid);
  }
}

export function applyCounts(tree, songs) {
  for (const n of tree.byId.values()) { n.own = new Set(); n.all = new Set(); }
  for (const f of tree.flavours.values()) f.songs = new Set();
  for (const [i, s] of (songs || []).entries()) countSong(tree, s, s.id ?? `#${i}`);
}


export const count = (n) => n.all.size;

export function libraryTags(tree, id) {
  const out = [];
  const walk = (n) => {
    if (n.level > 1 || n.name !== 'Other') out.push(`genre:${n.name}`);
    n.children.forEach(walk);
  };
  walk(tree.byId.get(id));
  return out;
}

export function searchMatches(tree, query) {
  const q = vkey(query);
  const hits = new Map();
  if (!q) return hits;
  for (const n of tree.byId.values()) {
    if (vkey(n.name).includes(q) || (n.display && vkey(n.display).includes(q))) hits.set(n.id, null);
    else {
      const s = n.synonyms.find((x) => vkey(x).includes(q));
      if (s) hits.set(n.id, s);
    }
  }
  return hits;
}

export const STATUS_FILTERS = ['all', 'approved', 'question', 'unreviewed'];
export const STATUS_LABELS = { approved: 'Alex approved', question: 'Under question', unreviewed: 'Not reviewed yet' };
export const statusKey = (n) => n.status || 'unreviewed';

export function filterIds(tree, { status = 'all', flavours = [] } = {}) {
  const wanted = [...flavours];
  if (!tree || (status === 'all' && !wanted.length)) return null;
  const keep = new Set();
  for (const n of tree.byId.values()) {
    if (n.level < 2) continue;
    if (status !== 'all' && statusKey(n) !== status) continue;
    if (wanted.length && !n.flavours.some((f) => wanted.includes(f))) continue;
    for (const a of ancestorIds(tree, n.id)) keep.add(a);
  }
  return keep;
}

export const statusIds = (tree, status) => filterIds(tree, { status });

export function flavourCount(tree, key) {
  return tree?.flavours.get(key)?.songs.size || 0;
}

export function visibleRows(tree, { expanded = new Set(), query = '', onlyWithSongs = false, status = 'all', flavours = [] } = {}) {
  const hits = searchMatches(tree, query);
  const byStatus = filterIds(tree, { status, flavours });
  const searching = !!vkey(query);
  const open = new Set();
  const keep = new Set();
  if (byStatus) for (const id of byStatus) { const n = tree.byId.get(id); if (n.parent) open.add(n.parent); }
  if (searching) {
    for (const id of hits.keys()) {
      keep.add(id);
      const c = chain(tree, id);
      for (const a of c) keep.add(a.id);
      for (const a of c.slice(0, -1)) open.add(a.id);
    }
  }
  const rows = [];
  const seen = new Set();
  const walk = (n, parentKey = null, rootId = n.id) => {
    if (searching && !keep.has(n.id)) return;
    if (byStatus && !byStatus.has(n.id)) return;
    if (onlyWithSongs && !n.all.size) return;
    const kids = n.children.filter((c) => (!searching || keep.has(c.id)) && (!byStatus || byStatus.has(c.id)) && (!onlyWithSongs || c.all.size));
    const isOpen = kids.length > 0 && (expanded.has(n.id) || open.has(n.id));
    const key = seen.has(n.id) ? `${rootId}|${n.id}` : n.id;
    seen.add(n.id);
    rows.push({ key, parentKey, node: n, level: n.level, hasChildren: kids.length > 0, expanded: isOpen, via: hits.get(n.id) ?? null, matched: hits.has(n.id) });
    if (isOpen) kids.forEach((c) => walk(c, key, rootId));
  };
  tree.roots.forEach((r) => walk(r));
  return rows;
}

export function allExpandable(tree) {
  return new Set([...tree.byId.values()].filter((n) => n.children.length).map((n) => n.id));
}

const focusAt = (rows, i) => (rows[i] ? { type: 'focus', id: rows[i].key } : null);

function rightKey(rows, i, id) {
  const r = rows[i];
  if (r.hasChildren && !r.expanded) return { type: 'expand', id, node: r.node.id };
  return r.expanded ? focusAt(rows, i + 1) : null;
}

function leftKey(rows, r, id) {
  if (r.expanded) return { type: 'collapse', id, node: r.node.id };
  return r.parentKey && rows.some((x) => x.key === r.parentKey) ? { type: 'focus', id: r.parentKey } : null;
}

export function treeKey(rows, id, key) {
  const i = rows.findIndex((r) => r.key === id);
  if (i < 0) return focusAt(rows, 0);
  const r = rows[i];
  switch (key) {
    case 'ArrowDown': return focusAt(rows, i + 1);
    case 'ArrowUp': return focusAt(rows, i - 1);
    case 'Home': return focusAt(rows, 0);
    case 'End': return focusAt(rows, rows.length - 1);
    case 'ArrowRight': return rightKey(rows, i, id);
    case 'ArrowLeft': return leftKey(rows, r, id);
    case 'Enter':
    case ' ':
      return { type: 'activate', id, node: r.node.id, toggle: r.hasChildren };
    default: return null;
  }
}
