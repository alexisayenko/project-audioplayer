export function legacyRootId(tree, byName) {
  const root = (tree?.roots || []).find((r) => byName?.[r.name]?.legacy === true);
  return root ? root.id : null;
}

export function legacyIds(tree, rootId) {
  const out = new Set();
  const stack = [...(tree?.byId.get(rootId)?.children || [])];
  while (stack.length) {
    const n = stack.pop();
    if (out.has(n.id)) continue;
    out.add(n.id);
    stack.push(...n.children);
  }
  return out;
}

export function legacyVisible(tree, rootId, open) {
  if (!tree || !rootId || open) return null;
  const hidden = legacyIds(tree, rootId);
  return new Set([...tree.byId.keys()].filter((id) => !hidden.has(id)));
}

export const legacyMarks = (rootId, open) => (rootId ? new Map([[rootId, open ? 'open' : 'closed']]) : new Map());
