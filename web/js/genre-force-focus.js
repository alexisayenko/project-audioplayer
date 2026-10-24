const ANCESTOR_LEVELS = 12;

function visitParents(cur, seen, queue, acc, parentLinks) {
  const d = seen.get(cur.id) + 1;
  for (const l of parentLinks.get(cur.id) || []) {
    acc.set.add(l.s);
    acc.edges.add(l);
    if (!acc.edgeDepth.has(l)) acc.edgeDepth.set(l, d);
    if (seen.has(l.s.id)) continue;
    seen.set(l.s.id, d);
    acc.depth.set(l.s, d);
    queue.push(l.s);
  }
}

function climbAncestors(n, acc, parentLinks) {
  const seen = new Map([[n.id, 0]]);
  const queue = [n];
  for (let i = 0; i < queue.length && seen.get(queue[i].id) < ANCESTOR_LEVELS; i++) {
    visitParents(queue[i], seen, queue, acc, parentLinks);
  }
}

export function focusState(n, sel, { incident, adj, byId, parentLinks }) {
  if (!n) return null;
  const acc = { set: new Set([n]), edges: new Set(incident.get(n.id) || []), depth: new Map(), edgeDepth: new Map() };
  for (const id of adj.get(n.id) || []) acc.set.add(byId.get(id));
  if (n === sel) climbAncestors(n, acc, parentLinks);
  return { n, ...acc };
}
