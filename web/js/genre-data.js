export const FAMILIES = [
  'Electronic', 'Rock', 'Pop', 'Hip Hop', 'Jazz', 'Funk / Soul', 'Classical', 'Reggae', 'Latin',
  'Blues', 'Folk, World, & Country', 'Stage & Screen', 'Non-Music', "Children's", 'Brass & Military', 'Other',
];

export const familyIndex = (family) => {
  const i = FAMILIES.indexOf(family);
  return i < 0 ? FAMILIES.length - 1 : i;
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

function familyGroups(g) {
  const groups = new Map();
  for (const id of g.roots) {
    const n = g.byId.get(id);
    const list = groups.get(n.family) || [];
    list.push(id);
    groups.set(n.family, list);
  }
  return [...groups.entries()].sort((a, b) => familyIndex(a[0]) - familyIndex(b[0]));
}

export function outlineRows(g, expanded) {
  const rows = [];
  const walk = (id, depth, key, via, path) => {
    const n = g.byId.get(id);
    const kids = (g.children.get(id) || []).filter((c) => !path.has(c));
    const open = expanded.has(key) && kids.length > 0;
    rows.push({
      key, id, depth, label: n.label, count: n.count, family: n.family, hasChildren: kids.length > 0, expanded: open,
      alsoUnder: n.parents.filter((p) => p !== via).map((p) => g.byId.get(p).label),
    });
    if (!open) return;
    const sorted = kids.map((c) => g.byId.get(c)).sort(byCountThenLabel);
    for (const c of sorted) walk(c.id, depth + 1, `${key}>${c.id}`, id, new Set(path).add(id));
  };
  for (const [family, ids] of familyGroups(g)) {
    const key = familyKey(family);
    const open = expanded.has(key);
    rows.push({ key, id: null, depth: 0, label: family, count: null, family, hasChildren: true, expanded: open, alsoUnder: [], kind: 'family', size: ids.length });
    if (open) for (const id of ids) walk(id, 1, `${key}>${id}`, null, new Set());
  }
  return rows;
}

export function pathKeys(g, id) {
  const n = g.byId.get(id);
  if (!n) return [];
  const chain = [id];
  const seen = new Set(chain);
  let cur = n;
  while (cur.parents.length) {
    const next = [...cur.parents].map((p) => g.byId.get(p)).sort(byCountThenLabel).find((p) => !seen.has(p.id));
    if (!next) break;
    chain.unshift(next.id);
    seen.add(next.id);
    cur = next;
  }
  const top = g.byId.get(chain[0]);
  const keys = [familyKey(top.family)];
  for (const c of chain) keys.push(`${keys.at(-1)}>${c}`);
  return keys;
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
