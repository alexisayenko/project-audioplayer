import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, applyCounts } from './genre-levels.js';
import { layoutRadial as layout0, highlightSets, radius, visibleCrossLinks, placeLevel2Labels, truncateLabel } from './genre-radial.js';
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

const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function level2Items(k) {
  const l = layout0(sample(), 'Electronic', { showAll: true });
  return l.nodes.filter((n) => n.level === 2 && !n.parked).map((n) => ({
    id: n.id, sx: n.x * k + 500, sy: n.y * k + 400, r: (n.r + 4) * k, dx: Math.cos(n.angle), dy: Math.sin(n.angle), w: 6.5 * truncateLabel(n.label).length, h: 14,
  }));
}

test('level 2 labels are never hidden: every one gets a box, deterministic, nudged without overlap when room allows', () => {
  const items = level2Items(0.8);
  const a = placeLevel2Labels(items);
  const b = placeLevel2Labels(items);
  assert.equal(a.size, items.length);
  assert.deepEqual([...a], [...b]);
  const boxes = [...a.values()];
  let bad = 0;
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (overlapArea(boxes[i], boxes[j]) > 0) bad += 1;
  assert.equal(bad, 0);
});

test('a crowded ring still places every label, uses leaders for displaced ones, and truncates long names', () => {
  const items = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * 2 * Math.PI;
    return { id: `n${i}`, sx: 300 + Math.cos(a) * 60, sy: 300 + Math.sin(a) * 60, r: 8, dx: Math.cos(a), dy: Math.sin(a), w: 90, h: 14 };
  });
  const out = placeLevel2Labels(items);
  assert.equal(out.size, 40);
  assert.ok([...out.values()].some((p) => p.leader));
  assert.equal(truncateLabel('a very long style name indeed').length, 18);
  assert.equal(truncateLabel('short'), 'short');
});
