import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, applyCounts } from './genre-levels.js';
import { layoutRadial as layout0, highlightSets, radius, visibleCrossLinks, selectLabels, labelBox } from './genre-radial.js';
const layoutRadial = (t, root, o = { showAll: true }) => layout0(t, root, o);

const doc = JSON.parse(readFileSync(new URL('../../server/data/genre_levels.json', import.meta.url), 'utf8'));
const styles = JSON.parse(readFileSync(new URL('../../server/data/genre_styles.json', import.meta.url), 'utf8'));
const entries = Object.fromEntries(Object.entries(doc).filter(([k]) => k !== '_meta' && k !== 'genres'));
const vocab = {
  families: styles.genres,
  genre_synonyms: Object.fromEntries(Object.entries(doc.genres).map(([k, v]) => [k, v.synonyms])),
  levels: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { also_under: [], synonyms: [], provisional: false, ...v }])),
  genres: [],
};
const electronic = Object.entries(entries).filter(([, v]) => v.genre === 'Electronic' || (v.also_in_genres || []).includes('Electronic'));

function sample() {
  const t = buildTree(vocab);
  const songs = electronic.slice(0, 40).map(([k], i) => ({ id: `s${i}`, tags: [`genre:${k}`, ...(i % 3 ? [`genre:${electronic[i + 7][0]}`] : [])] }));
  applyCounts(t, songs);
  return t;
}

test('every Electronic style appears exactly once, plus the root', () => {
  const l = layoutRadial(sample());
  assert.equal(l.nodes.length, electronic.length + 1);
  const ids = l.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(new Set(ids), new Set(['g:Electronic', ...electronic.map(([k]) => `s:${k}`)]));
  assert.deepEqual(l.nodes.map((n) => n.level).reduce((a, x) => { a[x] += 1; return a; }, [0, 0, 0, 0]).slice(1), [1, electronic.filter(([, v]) => !v.parent).length, electronic.filter(([, v]) => v.parent).length]);
  assert.equal(l.edges.length, electronic.length - l.nodes.filter((n) => n.parked).length);
});

test('layout is deterministic and does not depend on input order', () => {
  const a = layoutRadial(sample());
  const b = layoutRadial(sample());
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y, n.r]), b.nodes.map((n) => [n.id, n.x, n.y, n.r]));
  assert.deepEqual(a.bounds, b.bounds);
});

test('level 2 nodes do not overlap beyond a tolerance, level 3 stays outside level 2', () => {
  const l = layoutRadial(sample());
  const l2 = l.nodes.filter((n) => n.level === 2 && !n.parked);
  for (let i = 0; i < l2.length; i += 1) {
    for (let j = i + 1; j < l2.length; j += 1) {
      const d = Math.hypot(l2[i].x - l2[j].x, l2[i].y - l2[j].y);
      assert.ok(d >= l2[i].r + l2[j].r - 2, `${l2[i].name} / ${l2[j].name}: ${d}`);
    }
  }
  const maxR2 = Math.max(...l2.map((n) => Math.hypot(n.x, n.y) + n.r));
  for (const n of l.nodes.filter((x) => x.level === 3)) assert.ok(Math.hypot(n.x, n.y) - n.r > maxR2, n.name);
  const maxR3 = Math.max(...l.nodes.filter((x) => x.level === 3).map((n) => Math.hypot(n.x, n.y) + n.r));
  for (const n of l.nodes.filter((x) => x.parked)) assert.ok(Math.hypot(n.x, n.y) - n.r > maxR3, n.name);
});

test('level 3 nodes keep apart within a tolerance and sit in their umbrella sector side', () => {
  const l = layoutRadial(sample());
  const l3 = l.nodes.filter((n) => n.level === 3);
  for (let i = 0; i < l3.length; i += 1) {
    for (let j = i + 1; j < l3.length; j += 1) {
      assert.ok(Math.hypot(l3[i].x - l3[j].x, l3[i].y - l3[j].y) >= l3[i].r + l3[j].r - 2, `${l3[i].name} / ${l3[j].name}`);
    }
  }
});

test('size follows the song count, the root is centred, bounds contain all nodes', () => {
  const l = layoutRadial(sample());
  assert.equal(l.byId.get('g:Electronic').x, 0);
  assert.ok(radius(2, 25) > radius(2, 0) && radius(3, 9) > radius(3, 0));
  assert.ok(radius(2, 10000) <= 14 && radius(3, 10000) <= 8);
  for (const n of l.nodes) assert.ok(n.x - n.r >= l.bounds.x0 && n.x + n.r <= l.bounds.x1 && n.y - n.r >= l.bounds.y0 && n.y + n.r <= l.bounds.y1);
});

test('umbrellas get distinct hues, children share the umbrella hue, standalone styles are neutral', () => {
  const l = layoutRadial(sample());
  const house = l.byId.get('s:house');
  assert.equal(l.byId.get('s:deep house').hue, house.hue);
  const umbrellas = l.nodes.filter((n) => n.level === 2 && n.node.children.length);
  assert.equal(umbrellas.length, electronic.filter(([k]) => electronic.some(([, v]) => v.parent === k)).length);
  assert.equal(new Set(umbrellas.map((n) => n.hue)).size, Math.min(umbrellas.length, 15));
  assert.equal(l.byId.get('s:darkwave').hue, 15);
});

test('also_under becomes a cross-link between level 2 nodes only', () => {
  const l = layoutRadial(sample());
  const jungle = l.links.filter((x) => x.from === 's:jungle');
  assert.deepEqual(jungle.map((x) => x.to).sort(), ['s:breakbeat']);
  assert.ok(l.links.length > 10);
  for (const x of l.links) assert.equal(l.byId.get(x.to).level, 2);
});

test('the root genre is a parameter; unknown roots give null', () => {
  const t = sample();
  const rock = layoutRadial(t, 'Rock');
  assert.equal(rock.nodes.length, Object.values(entries).filter((v) => v.genre === 'Rock').length + 1);
  assert.equal(layoutRadial(t, 'Nope'), null);
});

test('highlightSets returns the ancestor chain and the direct children', () => {
  const t = sample();
  const h = highlightSets(t, 's:house');
  assert.deepEqual([...h.chain].sort(), ['g:Electronic', 's:house']);
  assert.ok(h.kids.has('s:deep house') && !h.kids.has('s:house'));
  assert.equal(highlightSets(t, 'nope').chain.size, 0);
});

test('default view keeps only nodes with songs and the ancestors that connect them', () => {
  const t = sample();
  const l = layout0(t, 'Electronic');
  assert.ok(l.nodes.length < electronic.length + 1);
  for (const n of l.nodes) assert.ok(n.level === 1 || n.node.all.size > 0, n.name);
  const have = new Set(l.nodes.map((n) => n.id));
  for (const n of l.nodes) if (n.level === 3) assert.ok(have.has(n.node.parent), `${n.name} lost its parent`);
  for (const [k] of electronic) {
    const n = t.byId.get(`s:${k}`);
    assert.equal(have.has(n.id), n.all.size > 0, k);
  }
  assert.equal(l.nodes.some((n) => n.parked), false);
  assert.equal(l.edges.length, l.nodes.length - 1);
});

test('default view of a genre without songs is just the root; positions stay deterministic', () => {
  const t = buildTree(vocab);
  assert.equal(layout0(t, 'Electronic').nodes.length, 1);
  const a = layout0(sample(), 'Electronic');
  const b = layout0(sample(), 'Electronic');
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y]), b.nodes.map((n) => [n.id, n.x, n.y]));
});

test('whole vocabulary shows every style once; empty standalone styles are parked on one outer arc', () => {
  const l = layout0(sample(), 'Electronic', { showAll: true });
  assert.equal(l.nodes.length, electronic.length + 1);
  assert.equal(new Set(l.nodes.map((n) => n.id)).size, l.nodes.length);
  const parked = l.nodes.filter((n) => n.parked);
  assert.ok(parked.length > 10);
  for (const n of parked) assert.ok(n.level === 2 && n.node.all.size === 0 && !n.node.children.length, n.name);
  const rs = parked.map((n) => Math.hypot(n.x, n.y));
  assert.ok(Math.max(...rs) - Math.min(...rs) < 1e-6);
  for (let i = 1; i < parked.length; i += 1) assert.ok(Math.hypot(parked[i].x - parked[i - 1].x, parked[i].y - parked[i - 1].y) >= 2 * parked[i].r);
});

test('cross-links are drawn only for the selected or hovered node', () => {
  const l = layout0(sample(), 'Electronic', { showAll: true });
  assert.ok(l.links.length > 10);
  assert.deepEqual(visibleCrossLinks(l, null, null), []);
  const link = l.links[0];
  assert.ok(visibleCrossLinks(l, link.from, null).every((x) => x.from === link.from || x.to === link.from));
  assert.ok(visibleCrossLinks(l, link.from, null).includes(link));
  assert.ok(visibleCrossLinks(l, null, link.to).includes(link));
  assert.ok(visibleCrossLinks(l, null, null).length < l.links.length);
});

test('psytrance is a level 2 sibling of trance with its own level 3 children; counts do not leak into trance', async () => {
  const { chain, count, searchMatches, resolveNode } = await import('./genre-levels.js');
  const t = buildTree(vocab);
  applyCounts(t, [{ id: 'a', tags: ['genre:dark psytrance'] }, { id: 'b', tags: ['genre:goa trance'] }, { id: 'c', tags: ['genre:psytrance'] }, { id: 'd', tags: ['genre:trance'] }]);
  const psy = t.byId.get('s:psytrance');
  assert.equal(psy.level, 2);
  assert.equal(psy.parent, 'g:Electronic');
  assert.deepEqual(psy.alsoUnder, []);
  assert.deepEqual(psy.children.map((c) => c.name).sort(), ['dark psytrance', 'forest psytrance', 'full-on psytrance', 'goa trance', 'progressive psytrance', 'psybient']);
  assert.ok(psy.children.every((c) => c.level === 3));
  assert.ok(!t.byId.get('s:trance').children.some((c) => ['psytrance', 'goa trance', 'psybient'].includes(c.name)));
  assert.equal(count(psy), 3);
  assert.equal(count(t.byId.get('s:trance')), 1);
  assert.deepEqual(chain(t, 's:dark psytrance').map((n) => n.name), ['Electronic', 'psytrance', 'dark psytrance']);
  assert.equal(t.byId.get('s:dark psytrance').display, 'Dark Psy-Trance');
  assert.equal(resolveNode('darkpsy', t).id, 's:dark psytrance');
  assert.equal(resolveNode('prog psy', t).id, 's:progressive psytrance');
  assert.ok(searchMatches(t, 'darkpsy').has('s:dark psytrance'));
  assert.ok(searchMatches(t, 'prog psy').has('s:progressive psytrance'));
  assert.equal(t.byId.get('s:progressive trance').level, 3);
  const l = layoutRadial(t);
  assert.equal(l.nodes.filter((n) => n.id === 's:psytrance').length, 1);
});

const box = (id, x, y, w = 40, h = 14, force = false) => ({ id, x, y, w, h, force });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('selectLabels hides what does not fit, in priority order, and is deterministic', () => {
  const items = [box('a', 100, 100), box('b', 110, 102), box('c', 300, 100), box('d', 120, 140)];
  const shown = selectLabels(items);
  assert.deepEqual([...shown], ['a', 'c', 'd']);
  assert.deepEqual([...selectLabels(items)], [...shown]);
  assert.deepEqual([...selectLabels([...items].reverse())].sort(), ['a', 'c', 'd'].filter((x) => x !== 'a').concat(['b']).sort());
  const boxes = items.filter((i) => shown.has(i.id)).map(labelBox);
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) assert.equal(overlaps(boxes[i], boxes[j]), false);
});

test('padding counts: labels closer than the pad are hidden', () => {
  assert.equal(selectLabels([box('a', 100, 100), box('b', 100, 115)], [], { pad: 2.5 }).has('b'), false);
  assert.equal(selectLabels([box('a', 100, 100), box('b', 100, 117)], [], { pad: 2.5 }).has('b'), true);
});

test('a label is hidden when it would cover the marker of a higher priority node, not a lower one', () => {
  const markers = [{ id: 'a', x: 300, y: 300, r: 8 }, { id: 'b', x: 100, y: 108, r: 8 }];
  const items = [box('a', 100, 100), box('b', 300, 300 - 14)];
  const s = selectLabels(items, markers);
  assert.equal(s.has('a'), true);
  assert.equal(s.has('b'), false);
  const s2 = selectLabels([box('b', 300, 286), box('a', 100, 100)], markers);
  assert.equal(s2.has('b'), true);
  assert.equal(s2.has('a'), false);
});

test('forced labels (selected, hovered, matched) are always drawn even over others', () => {
  const items = [box('a', 100, 100), box('sel', 105, 100, 40, 14, true)];
  assert.deepEqual([...selectLabels(items)], ['a', 'sel']);
  assert.deepEqual([...selectLabels([box('sel', 105, 100, 40, 14, true), box('a', 100, 100)])], ['sel']);
});

test('hidden labels reappear when zooming in because spacing grows', () => {
  const l = layout0(sample(), 'Electronic', { showAll: false });
  const at = (k) => selectLabels(l.nodes.filter((n) => n.level === 2).sort((p, q) => q.node.all.size - p.node.all.size).map((n) => box(n.id, n.x * k, n.y * k + n.r * k, 7 * n.name.length, 14))).size;
  const lvl2 = l.nodes.filter((n) => n.level === 2).length;
  assert.ok(at(0.2) < lvl2);
  assert.ok(at(0.2) < at(1));
  assert.ok(at(3) >= at(1));
});
