import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts } from './genre-levels.js';
import { layoutRadial, R2, STAGGER2, R3, STAGGER3 } from './genre-radial.js';
import { realVocab } from './genre-real-vocab.mjs';

function fullTree() {
  const t = buildTree(realVocab());
  const songs = [...t.byId.values()].filter((n) => n.level > 1).map((n, i) => ({ id: `s${i}`, tags: [`genre:${n.name}`] }));
  applyCounts(t, songs);
  return t;
}

test('every family radial keeps its nodes on the rings and every edge inside the displayed set', () => {
  const t = fullTree();
  for (const root of t.roots) {
    const l = layoutRadial(t, root.name);
    if (!l) continue;
    assert.equal(new Set(l.nodes.map((n) => n.id)).size, l.nodes.length, root.name);
    const centre = l.byId.get(root.id);
    assert.deepEqual([centre.x, centre.y], [0, 0]);
    const r3 = Math.max(...l.nodes.filter((n) => n.level === 3).map((n) => Math.hypot(n.x, n.y)), R3);
    for (const n of l.nodes) {
      const d = Math.hypot(n.x, n.y);
      if (n.level === 2) assert.ok(d >= R2 - 1e-6 && d <= R2 + STAGGER2 + 1e-6, `${root.name}/${n.id} level 2 at ${d}`);
      if (n.level === 3) assert.ok(d >= R3 - 1e-6 && d <= r3 + STAGGER3 + 1e-6, `${root.name}/${n.id} level 3 at ${d}`);
      assert.ok(d + n.r <= l.bounds.x1 + 1e-6, `${n.id} inside the bounds`);
    }
    for (const e of l.edges) assert.ok(l.byId.has(e.from) && l.byId.has(e.to), `${root.name}: edge ${e.from}>${e.to} references a node that is not shown`);
    const shown = [...t.byId.values()].filter((n) => n.all.size > 0 && n.level > 1 && n.parent && chainRoot(t, n) === root.name && n.level <= 3);
    for (const n of shown) if (n.parent === root.id || t.byId.get(n.parent)?.parent === root.id) assert.ok(l.byId.has(n.id), `${n.id} placed`);
  }
});

const chainRoot = (t, n) => { let x = n; while (x.parent) x = t.byId.get(x.parent); return x.name; };
