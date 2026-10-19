import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, applyCounts } from './genre-levels.js';
import { layoutRadial, highlightSets, radius, selectLabels, labelBox } from './genre-radial.js';

const doc = JSON.parse(readFileSync(new URL('../../server/data/genre_levels.json', import.meta.url), 'utf8'));
const discogs = JSON.parse(readFileSync(new URL('../../server/data/genre_discogs.json', import.meta.url), 'utf8'));
const entries = Object.fromEntries(Object.entries(doc).filter(([k]) => k !== '_meta' && !['genres', 'families', 'flavours', 'subfamilies'].includes(k)));
const vocab = {
  families: discogs.families,
  family_synonyms: Object.fromEntries(Object.entries(doc.families).map(([k, v]) => [k, v.synonyms])),
  levels: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { synonyms: [], provisional: false, ...v }])),
  genres: [],
};
const electronic = [...buildTree(vocab).byId.values()].filter((n) => n.id.startsWith('s:') && (n.family === 'Electronic' || n.alsoIn.includes('Electronic'))).map((n) => [n.name]);

function sample() {
  const t = buildTree(vocab);
  const songs = electronic.slice(0, 40).map(([k], i) => ({ id: `s${i}`, tags: [`genre:${k}`, ...(i % 3 ? [`genre:${electronic[i + 7][0]}`] : [])] }));
  applyCounts(t, songs);
  return t;
}

test('every Electronic style with library songs appears exactly once, plus the root', () => {
  const t = sample();
  const l = layoutRadial(t);
  const withSongs = electronic.filter(([k]) => t.byId.get(`s:${k}`).all.size > 0);
  assert.ok(withSongs.length > 20 && withSongs.length < electronic.length);
  assert.equal(l.nodes.length, withSongs.length + 1);
  const ids = l.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(new Set(ids), new Set(['g:Electronic', ...withSongs.map(([k]) => `s:${k}`)]));
  assert.equal(l.edges.length, withSongs.length);
});

test('layout is deterministic and does not depend on input order', () => {
  const a = layoutRadial(sample());
  const b = layoutRadial(sample());
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y, n.r]), b.nodes.map((n) => [n.id, n.x, n.y, n.r]));
  assert.deepEqual(a.bounds, b.bounds);
});

test('level 2 nodes do not overlap beyond a tolerance, level 3 stays outside level 2', () => {
  const l = layoutRadial(sample());
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

test('umbrellas with songs of their own get distinct hues, children share them, standalone and connector nodes are neutral', () => {
  const t = sample();
  const l = layoutRadial(t);
  const tagged = l.nodes.filter((n) => n.level === 2 && n.node.children.length && n.node.own.size > 0);
  assert.ok(tagged.length > 3);
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
  applyCounts(t, [{ id: 'a', tags: ['genre:deep house'] }]);
  const l = layoutRadial(t);
  assert.deepEqual(l.nodes.map((n) => n.id).sort(), ['g:Electronic', 's:deep house', 's:house']);
  const house = l.byId.get('s:house');
  assert.equal(house.connector, true);
  assert.equal(house.hue, 15);
  assert.equal(house.node.own.size, 0);
  assert.equal(house.node.all.size, 1);
  assert.equal(l.byId.get('s:deep house').connector, false);
  assert.equal(l.byId.get('g:Electronic').connector, undefined);
});

test('an extra parent that is a genre becomes a cross-link between level 2 nodes only', () => {
  const l = layoutRadial(sample());
  const t = buildTree(vocab);
  applyCounts(t, [{ id: 'a', tags: ['genre:psybient'] }, { id: 'b', tags: ['genre:ambient'] }]);
  const psybient = layoutRadial(t).links.filter((x) => x.from === 's:psybient');
  assert.deepEqual(psybient.map((x) => x.to).sort(), ['s:ambient']);
  assert.ok(l.links.length > 0);
  for (const x of l.links) assert.equal(l.byId.get(x.to).level, 2);
});

test('the root genre is a parameter; unknown roots give null', () => {
  const t = sample();
  const rock = layoutRadial(t, 'Rock');
  assert.equal(rock.nodes.length, 1);
  assert.equal(layoutRadial(t, 'Nope'), null);
});

test('Blues, Jazz and Rock lay out like Electronic: family hue on the root, only genres with songs around it', () => {
  const t = buildTree(vocab);
  for (const [name, hue] of [['Blues', 9], ['Jazz', 4], ['Rock', 1]]) {
    const own = Object.entries(entries).filter(([, v]) => v.parents[0] === name);
    assert.ok(own.length > 2, `${name} has genres in genre_levels.json`);
    assert.equal(layoutRadial(t, name).nodes.length, 1);
    applyCounts(t, own.slice(0, 2).map(([k], i) => ({ id: `${name}${i}`, tags: [`genre:${k}`] })));
    const l = layoutRadial(t, name);
    assert.equal(l.byId.get(`g:${name}`).hue, hue);
    assert.equal(l.nodes.filter((n) => n.level === 2).length, 2);
    assert.equal(l.nodes.filter((n) => n.level === 3).length, 0);
  }
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
  const l = layoutRadial(t, 'Electronic');
  assert.ok(l.nodes.length < electronic.length + 1);
  for (const n of l.nodes) assert.ok(n.level === 1 || n.node.all.size > 0, n.name);
  const have = new Set(l.nodes.map((n) => n.id));
  for (const n of l.nodes) if (n.level === 3) assert.ok(have.has(n.node.parent), `${n.name} lost its parent`);
  for (const [k] of electronic) {
    const n = t.byId.get(`s:${k}`);
    assert.equal(have.has(n.id), n.all.size > 0, k);
  }
    assert.equal(l.edges.length, l.nodes.length - 1);
});

test('default view of a genre without songs is just the root; positions stay deterministic', () => {
  const t = buildTree(vocab);
  assert.equal(layoutRadial(t, 'Electronic').nodes.length, 1);
  const a = layoutRadial(sample(), 'Electronic');
  const b = layoutRadial(sample(), 'Electronic');
  assert.deepEqual(a.nodes.map((n) => [n.id, n.x, n.y]), b.nodes.map((n) => [n.id, n.x, n.y]));
});

test('the layout keeps the also-under links as data but the map draws no dashed cross-link lines', async () => {
  const l = layoutRadial(sample(), 'Electronic');
  assert.ok(l.links.length > 0);
  const view = await import('node:fs').then((fs) => fs.readFileSync(new URL('./genre-radial-view.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(view, /drawCrossLinks|visibleCrossLinks/);
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
  assert.equal(t.byId.get('s:dark psytrance').display, 'dark psy-trance');
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
  const l = layoutRadial(sample(), 'Electronic');
  const at = (k) => selectLabels(l.nodes.filter((n) => n.level === 2).sort((p, q) => q.node.all.size - p.node.all.size).map((n) => box(n.id, n.x * k, n.y * k + n.r * k, 7 * n.name.length, 14))).size;
  const lvl2 = l.nodes.filter((n) => n.level === 2).length;
  assert.ok(at(0.2) < lvl2);
  assert.ok(at(0.2) < at(1));
  assert.ok(at(3) >= at(1));
});
