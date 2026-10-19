import { buildIndex, resolveGenre, vkey } from './genre-vocab.js';
import { cleanSourceLinks } from './genre-source-links.js';

const spaced = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

export function hasLevels(vocab) {
  return !!vocab && typeof vocab.levels === 'object' && vocab.levels !== null && Object.keys(vocab.levels).length > 0;
}

const effectiveStatus = (v) => (v.status === 'question' || (v.status === 'approved' && v.discogs === false) ? v.status : null);

function makeNode(id, name, level, family, extra = {}) {
  return {
    id, name, level, family, parent: null, parents: [], parentNames: [], fams: [], children: [], subfamily: null, discogs: true, fusion: false, related: [], sourceLinks: [], synonyms: [], provisional: false, status: null, flavours: [], display: null, label: name,
    own: new Set(), all: new Set(), ...extra,
  };
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

function genreNode(k, v) {
  const display = typeof v.display === 'string' && v.display.trim() ? v.display.trim() : null;
  const n = makeNode(`s:${k}`, k, 0, null, {
    subfamily: typeof v.subfamily === 'string' && v.subfamily.trim() ? v.subfamily.trim() : null,
    discogs: v.discogs !== false, fusion: v.fusion === true, related: Array.isArray(v.related) ? v.related.filter((r) => typeof r === 'string' && r) : [], sourceLinks: cleanSourceLinks(v.source_links), synonyms: [...(v.synonyms || [])], provisional: v.provisional === true, status: effectiveStatus(v), display, flavours: Array.isArray(v.flavours) ? [...v.flavours] : [],
  });
  n.label = n.display || k;
  return n;
}

const parentList = (v) => (Array.isArray(v?.parents) ? v.parents.filter((p) => typeof p === 'string' && p) : []);

const knownParent = (byId, genres, p) => byId.has(`g:${p}`) || genres.has(p);

function keptParents(v, byId, genres, fusion) {
  const all = [...new Set(parentList(v))].filter((p) => knownParent(byId, genres, p));
  if (fusion || !v.fusion) return all;
  const ofGenres = all.filter((p) => !byId.has(`g:${p}`));
  return ofGenres.length ? ofGenres : all.slice(0, 1);
}

function linkGenres(levels, genres, byId, fusion) {
  const state = new Map();
  const settle = (k) => {
    if (state.has(k)) return;
    state.set(k, 1);
    const n = genres.get(k);
    const names = keptParents(levels[k], byId, genres, fusion).filter((p) => p !== k && state.get(p) !== 1);
    const nodes = names.map((p) => byId.get(`g:${p}`) || genres.get(p));
    for (const [i, p] of nodes.entries()) if (p.level === 0) settle(names[i]);
    n.parentNames = names;
    n.parents = nodes.map((p) => p.id);
    if (!nodes.length) n.level = 2;
    else {
      n.level = 1 + Math.min(...nodes.map((p) => p.level));
      n.parent = nodes.filter((p) => p.level === n.level - 1).sort(byName)[0].id;
      for (const p of nodes) p.children.push(n);
    }
    state.set(k, 2);
  };
  for (const k of Object.keys(levels)) settle(k);
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

export function buildTree(vocab, { fusion = true } = {}) {
  const levels = vocab?.levels || {};
  const gsyn = vocab?.family_synonyms || {};
  const names = Array.isArray(vocab?.families) && vocab.families.length ? vocab.families : Object.keys(gsyn);
  const byId = new Map();
  const roots = names.map((g) => {
    const n = makeNode(`g:${g}`, g, 1, g, { synonyms: [...(gsyn[g] || [])] });
    byId.set(n.id, n);
    return n;
  });
  const genres = new Map();
  for (const [k, v] of Object.entries(levels)) {
    const n = genreNode(k, v);
    genres.set(k, n);
    byId.set(n.id, n);
  }
  linkGenres(levels, genres, byId, fusion);
  assignFamilies(roots, byId);
  const flavours = new Map(Object.entries(vocab?.flavours || {}).map(([key, f]) => [key, { key, name: f.name || key, kind: f.kind === 'scene' ? 'scene' : 'sound', description: f.description || '', songs: new Set() }]));
  for (const n of byId.values()) n.flavours = n.flavours.filter((f) => flavours.has(f));
  const { byKey, bySyn } = nodeLookups(byId);
  return { roots, byId, byKey, bySyn, flavours, subfamilies: cleanSubfamilies(vocab?.subfamilies), index: buildIndex(vocab) };
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
  const stack = [id];
  while (stack.length) {
    const x = stack.pop();
    const n = out.has(x) ? null : tree.byId.get(x);
    if (!n) continue;
    out.add(x);
    stack.push(...n.parents);
  }
  return out;
}

export function depthIn(tree, id, rootId) {
  const memo = new Map();
  const go = (x) => {
    if (x === rootId) return 1;
    if (memo.has(x)) return memo.get(x);
    memo.set(x, Infinity);
    const best = Math.min(Infinity, ...(tree.byId.get(x)?.parents || []).map((p) => go(p) + 1));
    memo.set(x, best);
    return best;
  };
  return go(id);
}

export function genreLines(tree, names) {
  const lines = new Map(tree ? tree.roots.map((r) => [r.id, { family: r.name, rows: new Map() }]) : []);
  const loose = new Map();
  const seen = new Set();
  for (const name of names || []) {
    const node = resolveNode(name, tree);
    const key = node ? node.id : `?${vkey(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const fams = node ? node.fams.map((f) => `g:${f}`) : [];
    if (!fams.length) loose.set(key, { name, depth: 0 });
    for (const f of fams) lines.get(f).rows.set(key, { name, depth: node.level > 1 ? depthIn(tree, node.id, f) : 0 });
  }
  return lineGroups(lines, loose);
}

function lineGroups(lines, loose) {
  const order = (a, b) => a.depth - b.depth || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const out = [...lines.values()].filter((l) => l.rows.size).map((l) => ({
    family: l.family,
    genres: [l.family, ...[...l.rows.values()].filter((r) => r.depth > 0).sort(order).map((r) => r.name)],
  }));
  if (loose.size) out.push({ family: null, genres: [...loose.values()].sort(order).map((r) => r.name) });
  return out;
}

export function otherGenres(n, rootName) {
  return n.level > 1 ? n.fams.filter((g) => g !== rootName) : [];
}

function songGenreNames(s) {
  const names = [];
  for (const t of s.tags || []) if (typeof t === 'string' && t.toLowerCase().startsWith('genre:')) names.push(t.slice(6));
  for (const g of s.genres || []) if (typeof g === 'string') names.push(g);
  return names;
}

function countSong(tree, s, sid) {
  const done = new Set();
  for (const name of songGenreNames(s)) {
    const node = resolveNode(name, tree);
    if (!node || done.has(node.id)) continue;
    done.add(node.id);
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

export function populatedFamilies(tree) {
  return (tree?.roots || []).filter((r) => r.all.size > 0).sort((a, b) => b.all.size - a.all.size || a.name.localeCompare(b.name)).map((r) => r.name);
}

export function genresWithSongs(layout) {
  return (layout?.nodes || []).filter((n) => n.node.own.size > 0).length;
}

export function libraryTags(tree, id) {
  const out = new Set();
  const seen = new Set();
  const walk = (n) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    if (n.level > 1 || n.name !== 'Other') out.add(`genre:${n.name}`);
    n.children.forEach(walk);
  };
  walk(tree.byId.get(id));
  return [...out];
}

export function searchMatches(tree, query, { populatedOnly = false } = {}) {
  const q = vkey(query);
  const hits = new Map();
  if (!q) return hits;
  for (const n of tree.byId.values()) {
    if (populatedOnly && !n.all.size) continue;
    if (vkey(n.name).includes(q) || (n.display && vkey(n.display).includes(q))) hits.set(n.id, null);
    else {
      const s = n.synonyms.find((x) => vkey(x).includes(q));
      if (s) hits.set(n.id, s);
    }
  }
  return hits;
}

export const STATUS_FILTERS = ['all', 'question', 'unreviewed'];
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

export function visibleRows(tree, { expanded = new Set(), query = '', onlyWithSongs = false, status = 'all', flavours = [], only = null } = {}) {
  const hits = searchMatches(tree, query, { populatedOnly: onlyWithSongs });
  const byStatus = filterIds(tree, { status, flavours });
  const searching = !!vkey(query);
  const open = new Set();
  const keep = new Set();
  if (byStatus) for (const id of byStatus) for (const p of tree.byId.get(id).parents) open.add(p);
  if (searching) {
    for (const id of hits.keys()) {
      keep.add(id);
      for (const a of ancestorIds(tree, id)) {
        keep.add(a);
        if (a !== id) open.add(a);
      }
    }
  }
  const rows = [];
  const seen = new Set();
  const walk = (n, parentKey = null, parentId = null, depth = 1) => {
    if (searching && !keep.has(n.id)) return;
    if (byStatus && !byStatus.has(n.id)) return;
    if (only && !only.has(n.id)) return;
    if (onlyWithSongs && !n.all.size) return;
    const kids = n.children.filter((c) => (!searching || keep.has(c.id)) && (!byStatus || byStatus.has(c.id)) && (!only || only.has(c.id)) && (!onlyWithSongs || c.all.size));
    const isOpen = kids.length > 0 && (expanded.has(n.id) || open.has(n.id));
    const key = seen.has(n.id) ? `${parentKey}|${n.id}` : n.id;
    seen.add(n.id);
    rows.push({ key, parentKey, parentId, node: n, level: depth, hasChildren: kids.length > 0, expanded: isOpen, via: hits.get(n.id) ?? null, matched: hits.has(n.id) });
    if (isOpen) kids.forEach((c) => walk(c, key, n.id, depth + 1));
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

export function cleanSubfamilies(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.name === 'string' && s.name && typeof s.family === 'string' && s.family)
    .map((s, i) => ({ name: s.name, family: s.family, order: Number.isFinite(s.order) ? s.order : i + 1 }))
    .sort((a, b) => a.order - b.order);
}

export const subfamilyOrder = (tree, name) => tree?.subfamilies?.find((s) => s.name === name)?.order || 0;

function assignFamilies(roots, byId) {
  const order = new Map(roots.map((r, i) => [r.name, i]));
  const memo = new Map();
  const of = (n) => {
    if (memo.has(n.id)) return memo.get(n.id);
    const out = new Set(n.level === 1 ? [n.name] : []);
    memo.set(n.id, out);
    for (const p of n.parents) for (const f of of(byId.get(p))) out.add(f);
    return out;
  };
  for (const n of byId.values()) {
    n.fams = [...of(n)].sort((x, y) => order.get(x) - order.get(y));
    n.family = n.fams[0] || null;
  }
}
