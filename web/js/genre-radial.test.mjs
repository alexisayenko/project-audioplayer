import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts } from './genre-levels.js';
import { realVocab } from './genre-real-vocab.mjs';
import { layoutRadial, highlightSets, radius, selectLabels, labelBox } from './genre-radial.js';

const vocab = realVocab();
const lay = (t, root = 'Others', o = {}) => layoutRadial(t, root, { hidden: false, ...o });
const electronic = [...buildTree(vocab).byId.values()].filter((n) => n.id.startsWith('s:') && n.fams.includes('Others')).map((n) => [n.name]);

function sample() {
  const t = buildTree(vocab);
  const umbrellas = t.byId.get('g:Others').children.filter((n) => n.children.length);
  const songs = electronic.slice(0, 40).map(([k], i) => ({ id: `s${i}`, tags: [`genre:${k}`, ...(i % 3 ? [`genre:${electronic[i + 7][0]}`] : [])] }));
  for (const [i, n] of umbrellas.entries()) songs.push({ id: `umbrella${i}`, tags: i === umbrellas.length - 1 ? [`genre:${n.children[0].name}`] : [`genre:${n.name}`, `genre:${n.children[0].name}`] });
  for (const [i, [k]] of electronic.filter(([k]) => t.byId.get(`s:${k}`).parents.length > 1).entries()) songs.push({ id: `multi${i}`, tags: [`genre:${k}`] });
  applyCounts(t, songs);
  return t;
}

test('every Others style with library songs appears exactly once, plus the root', () => {
  const t = sample();
  const l = lay(t);
  const withSongs = electronic.filter(([k]) => t.byId.get(`s:${k}`).all.size > 0);
  assert.ok(withSongs.length > 20 && withSongs.length < electronic.length);
  assert.equal(l.nodes.length, withSongs.length + 1);
  const ids = l.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(new Set(ids), new Set(['g:Others', ...withSongs.map(([k]) => `s:${k}`)]));
  assert.equal(l.edges.filter((e) => !e.cross).length, withSongs.length);
  for (const n of l.nodes) for (const p of n.node.parents) {
    if (l.byId.has(p)) assert.ok(l.edges.some((e) => e.from === p && e.to === n.id), `${p} -> ${n.id}`);
  }
});

test('layout is deterministic and does not depend on input order', () => {
  const a = lay(sample());
  const b = lay(sample());
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y, n.r]), b.nodes.map((n) => [n.id, n.x, n.y, n.r]));
  assert.deepEqual(a.bounds, b.bounds);
});

test('level 2 nodes do not overlap beyond a tolerance, level 3 stays outside level 2', () => {
  const l = lay(sample());
  const l2 = l.nodes.filter((n) => n.level === 2);
  for (let i = 0; i < l2.length; i += 1) {
    for (let j = i + 1; j < l2.length; j += 1) {
      const d = Math.hypot(l2[i].x - l2[j].x, l2[i].y - l2[j].y);
      assert.ok(d >= l2[i].r + l2[j].r - 2, `${l2[i].name} / ${l2[j].name}: ${d}`);
    }
  }
  const maxR2 = Math.max(...l2.map((n) => Math.hypot(n.x, n.y) + n.r));
  for (const n of l.nodes.filter((x) => x.level === 3)) assert.ok(Math.hypot(n.x, n.y) - n.r > maxR2, n.name);
});

test('level 3 nodes keep apart within a tolerance and sit in their umbrella sector side', () => {
  const l = lay(sample());
  const l3 = l.nodes.filter((n) => n.level === 3);
  for (let i = 0; i < l3.length; i += 1) {
    for (let j = i + 1; j < l3.length; j += 1) {
      assert.ok(Math.hypot(l3[i].x - l3[j].x, l3[i].y - l3[j].y) >= l3[i].r + l3[j].r - 2, `${l3[i].name} / ${l3[j].name}`);
    }
  }
});

test('size follows the song count, the root is centred, bounds contain all nodes', () => {
  const l = lay(sample());
  assert.equal(l.byId.get('g:Others').x, 0);
  assert.ok(radius(2, 25) > radius(2, 0) && radius(3, 9) > radius(3, 0));
  assert.ok(radius(2, 10000) <= 14 && radius(3, 10000) <= 8);
  for (const n of l.nodes) assert.ok(n.x - n.r >= l.bounds.x0 && n.x + n.r <= l.bounds.x1 && n.y - n.r >= l.bounds.y0 && n.y + n.r <= l.bounds.y1);
});

test('umbrellas with songs of their own get distinct hues, children share them, standalone and connector nodes are neutral', () => {
  const t = sample();
  const l = lay(t);
  const tagged = l.nodes.filter((n) => n.level === 2 && n.node.children.length && n.node.own.size > 0);
  assert.ok(tagged.length >= 1);
  assert.equal(new Set(tagged.map((n) => n.hue)).size, tagged.length);
  for (const u of tagged) for (const c of l.nodes.filter((x) => x.level === 3 && x.node.parent === u.id)) assert.equal(c.hue, u.hue, c.name);
  for (const n of l.nodes.filter((x) => x.level > 1)) {
    assert.equal(n.connector, n.node.own.size === 0, n.name);
    if (n.connector) assert.equal(n.hue, 15, n.name);
  }
  assert.ok(l.nodes.some((n) => n.connector));
  assert.equal(l.nodes.find((n) => n.level === 2 && !n.node.children.length && n.node.own.size > 0).hue, 15);
});

test('a style without songs of its own but with a populated child is drawn as a neutral connector node', () => {
  const t = buildTree(vocab);
  applyCounts(t, [{ id: 'a', tags: ['genre:jungle'] }]);
  const l = lay(t);
  assert.deepEqual(l.nodes.map((n) => n.id).sort(), ['g:Others', 's:breakbeat', 's:jungle']);
  const house = l.byId.get('s:breakbeat');
  assert.equal(house.connector, true);
  assert.equal(house.hue, 15);
  assert.equal(house.node.own.size, 0);
  assert.equal(house.node.all.size, 1);
  assert.equal(l.byId.get('s:jungle').connector, false);
  assert.equal(l.byId.get('g:Others').connector, undefined);
});

test('every other parent of a drawn node gets an edge: the node is drawn once with a line to each parent', () => {
  const t = buildTree(vocab);
  applyCounts(t, [{ id: 'a', tags: ['genre:glitch hop'] }, { id: 'b', tags: ['genre:bass music'] }, { id: 'c', tags: ['genre:breakbeat'] }]);
  const l = lay(t);
  assert.equal(l.nodes.filter((n) => n.id === 's:glitch hop').length, 1);
  const into = l.edges.filter((x) => x.to === 's:glitch hop');
  assert.deepEqual(into.map((x) => x.from).sort(), ['s:bass music', 's:breakbeat']);
  assert.equal(into.filter((x) => x.cross).length, 1);
  const all = lay(sample());
  const ids = all.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of all.edges) assert.ok(all.byId.has(e.from) && all.byId.has(e.to));
  const seen = new Set(all.edges.map((e) => `${e.from}|${e.to}`));
  assert.equal(seen.size, all.edges.length);
});

test('the root genre is a parameter; unknown roots give null', () => {
  const t = sample();
  const rock = lay(t, 'Rock');
  assert.ok(rock.nodes.length >= 1 && rock.nodes[0].id === 'g:Rock');
  assert.equal(layoutRadial(t, 'Nope'), null);
});

test('Blues, Jazz and Rock lay out like other families: family hue on the root, only genres with songs around it', () => {
  const t = buildTree(vocab);
  for (const [name, hue] of [['Blues', 9], ['Jazz', 4], ['Rock', 1]]) {
    const own = Object.entries(vocab.levels).filter(([, v]) => v.parents[0] === name);
    assert.ok(own.length > 2, `${name} has genres in genre_levels.json`);
    assert.equal(lay(t, name).nodes.length, 1);
    applyCounts(t, own.slice(0, 2).map(([k], i) => ({ id: `${name}${i}`, tags: [`genre:${k}`] })));
    const l = lay(t, name);
    assert.equal(l.byId.get(`g:${name}`).hue, hue);
    assert.equal(l.nodes.filter((n) => n.level === 2).length, 2);
    assert.equal(l.nodes.filter((n) => n.level === 3).length, 0);
  }
});

test('highlightSets returns the ancestor chain and the direct children', () => {
  const t = sample();
  const h = highlightSets(t, 's:breakbeat');
  assert.deepEqual([...h.chain].sort(), ['g:Others', 's:breakbeat']);
  assert.ok(h.kids.has('s:jungle') && !h.kids.has('s:breakbeat'));
  assert.equal(highlightSets(t, 'nope').chain.size, 0);
});

test('default view keeps only nodes with songs and the ancestors that connect them', () => {
  const t = sample();
  const l = lay(t);
  assert.ok(l.nodes.length < electronic.length + 1);
  for (const n of l.nodes) assert.ok(n.level === 1 || n.node.all.size > 0, n.name);
  const have = new Set(l.nodes.map((n) => n.id));
  for (const n of l.nodes) if (n.level >= 3) assert.ok(n.node.parents.some((p) => have.has(p)), `${n.name} lost its parent`);
  for (const [k] of electronic) {
    const n = t.byId.get(`s:${k}`);
    assert.equal(have.has(n.id), n.all.size > 0, k);
  }
    assert.equal(l.edges.filter((e) => !e.cross).length, l.nodes.length - 1);
});

test('default view of a genre without songs is just the root; positions stay deterministic', () => {
  const t = buildTree(vocab);
  assert.equal(lay(t).nodes.length, 1);
  const a = lay(sample());
  const b = lay(sample());
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y]), b.nodes.map((n) => [n.id, n.x, n.y]));
});

test('the layout draws the other parents as edges but the map draws no dashed cross-link lines', async () => {
  const l = lay(sample());
  for (const n of l.nodes) for (const p of n.node.parents) {
    if (l.byId.has(p)) assert.ok(l.edges.some((e) => e.from === p && e.to === n.id), `${p} -> ${n.id}`);
  }
  assert.equal(l.links, undefined);
  const view = await import('node:fs').then((fs) => fs.readFileSync(new URL('./genre-radial-view.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(view, /drawCrossLinks|visibleCrossLinks/);
});

test('psytrance sits under trance (level 1) at level 2 and its own children are level 3; counts roll up to trance', async () => {
  const { chain, count, searchMatches, resolveNode } = await import('./genre-levels.js');
  const t = buildTree(vocab);
  applyCounts(t, [{ id: 'a', tags: ['genre:dark psytrance'] }, { id: 'b', tags: ['genre:goa trance'] }, { id: 'c', tags: ['genre:psytrance'] }, { id: 'd', tags: ['genre:trance'] }]);
  const psy = t.byId.get('s:psytrance');
  assert.equal(psy.level, 2);
  assert.deepEqual(psy.parents, ['g:trance']);
  const kids = psy.children.map((c) => c.name);
  for (const k of ['dark psytrance', 'forest psytrance', 'full-on psytrance', 'goa trance', 'progressive psytrance', 'psybient']) assert.ok(kids.includes(k), k);
  for (const c of psy.children) {
    assert.ok(c.parents.includes('s:psytrance'), `${c.name} lists psytrance as a parent`);
    assert.equal(c.level, 3, `${c.name} is level 3`);
  }
  assert.equal(t.byId.get('s:psybient').level, 3, 'psybient is also under ambient, a level 2 genre, so its shortest path is level 3');
  assert.equal(count(psy), 3);
  assert.equal(count(t.byId.get('g:trance')), 4);
  assert.deepEqual(chain(t, 's:dark psytrance').map((n) => n.name), ['trance', 'psytrance', 'dark psytrance']);
  assert.equal(t.byId.get('s:dark psytrance').display, 'dark psy-trance');
  assert.equal(resolveNode('darkpsy', t).id, 's:dark psytrance');
  assert.equal(resolveNode('prog psy', t).id, 's:progressive psytrance');
  assert.ok(searchMatches(t, 'darkpsy').has('s:dark psytrance'));
  assert.ok(searchMatches(t, 'prog psy').has('s:progressive psytrance'));
  assert.equal(t.byId.get('s:progressive trance').level, 2);
  const l = lay(t, 'trance');
  assert.equal(l.nodes.filter((n) => n.id === 's:psytrance').length, 1);
  assert.equal(l.byId.get('s:dark psytrance').level, 3);
  assert.ok(Math.hypot(l.byId.get('s:dark psytrance').x, l.byId.get('s:dark psytrance').y) > Math.hypot(l.byId.get('s:psytrance').x, l.byId.get('s:psytrance').y));
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
  const l = layoutRadial(sample(), 'Others');
  const at = (k) => selectLabels(l.nodes.filter((n) => n.level === 2).sort((p, q) => q.node.all.size - p.node.all.size).map((n) => box(n.id, n.x * k, n.y * k + n.r * k, 7 * n.name.length, 14))).size;
  const lvl2 = l.nodes.filter((n) => n.level === 2).length;
  assert.ok(at(0.2) < lvl2);
  assert.ok(at(0.2) < at(1));
  assert.ok(at(3) >= at(1));
});

test('Others is drawn like other families: circle, lines to its level 2 genres, nothing hidden', async () => {
  const { HIDDEN_FAMILY_NODES, isHiddenFamily } = await import('./genre-data.js');
  assert.deepEqual(HIDDEN_FAMILY_NODES, []);
  assert.equal(isHiddenFamily('Others'), false);
  const t = sample();
  const l = layoutRadial(t, 'Others');
  assert.equal(l.hiddenRoot, false);
  const root = l.byId.get('g:Others');
  assert.deepEqual([root.hidden, root.x, root.y, root.r], [undefined, 0, 0, 26]);
  assert.ok(l.nodes.some((n) => n.id === 'g:Others'));
  const ring = l.nodes.filter((n) => n.level === 2);
  assert.ok(ring.length > 5);
  for (const n of ring) assert.ok(l.edges.some((e) => e.from === 'g:Others' && e.to === n.id), n.name);
  assert.deepEqual(l.nodes.map((n) => [n.id, n.x, n.y]), layoutRadial(t, 'Others', { hidden: false }).nodes.map((n) => [n.id, n.x, n.y]));
});

test('the hidden-family mechanism: a name in HIDDEN_FAMILY_NODES leaves the family circle undrawn around an empty centre and keeps it addressable', async () => {
  const { HIDDEN_FAMILY_NODES, isHiddenFamily } = await import('./genre-data.js');
  const t = sample();
  const shown = layoutRadial(t, 'Others');
  HIDDEN_FAMILY_NODES.push('Others');
  try {
    assert.equal(isHiddenFamily('Others'), true);
    assert.equal(isHiddenFamily('Rock'), false);
    const l = layoutRadial(t, 'Others');
    assert.equal(l.hiddenRoot, true);
    assert.equal(l.nodes.some((n) => n.id === 'g:Others'), false);
    assert.equal(l.nodes.length, shown.nodes.length - 1);
    assert.equal(l.edges.some((e) => e.from === 'g:Others' || e.to === 'g:Others'), false);
    const root = l.byId.get('g:Others');
    assert.deepEqual([root.hidden, root.x, root.y, root.r], [true, 0, 0, 0]);
    for (const n of l.nodes) assert.deepEqual([n.x, n.y], [shown.byId.get(n.id).x, shown.byId.get(n.id).y]);
    const h = highlightSets(t, 'g:Others');
    assert.ok(h.kids.has('s:breakbeat') && h.chain.has('g:Others'));
    assert.equal(l.byId.has('s:breakbeat'), true);
    assert.equal(layoutRadial(t, 'Rock').hiddenRoot, false);
  } finally { HIDDEN_FAMILY_NODES.pop(); }
  assert.equal(layoutRadial(t, 'Others').hiddenRoot, false);
});

test('a genre beyond level 3 is drawn on a ring further out, under its parent, with an edge to it', () => {
  const deep = buildTree({ families: ['Rock'], levels: { a: { parents: ['Rock'] }, b: { parents: ['a'] }, c: { parents: ['b'] }, d: { parents: ['c'] }, e: { parents: ['d'] } }, modifiers: {}, genres: [] });
  applyCounts(deep, [{ id: '1', tags: ['genre:e'] }]);
  const l = layoutRadial(deep, 'Rock');
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((k) => l.byId.get(`s:${k}`).level), [2, 3, 4, 5, 6]);
  const dist = ['a', 'b', 'c', 'd', 'e'].map((k) => Math.hypot(l.byId.get(`s:${k}`).x, l.byId.get(`s:${k}`).y));
  for (let i = 1; i < dist.length; i++) assert.ok(dist[i] > dist[i - 1], `ring ${i}`);
  assert.deepEqual(l.edges.map((e) => [e.from, e.to]), [['g:Rock', 's:a'], ['s:a', 's:b'], ['s:b', 's:c'], ['s:c', 's:d'], ['s:d', 's:e']]);
});
