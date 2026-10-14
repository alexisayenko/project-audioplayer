import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitPlottable, jitter, makePoint, extentX, extentY, tickStep, ticks, makeScale, zoomRange, panRange, assignGroups, songFamilies,
  buildIndex, inRect, neighbour, firstItem, groupOf, colorIndex, NEUTRAL, countText, skippedText, chartLabel,
  JITTER_YEAR, JITTER_BPM, MIN_YEAR_SPAN,
} from './stats-data.js';

const S = (id, year, bpm, extra = {}) => ({ id, title: id, year, bpm, ...extra });

test('splitPlottable keeps songs with numeric year and BPM and counts the rest', () => {
  const r = splitPlottable([S('a', 1999, 120), S('b', null, 120), S('c', 2001, undefined), S('d', 'x', 90), S('e', 2000, 0), S('f', 2010, 140.5)]);
  assert.deepEqual(r.plotted.map((s) => s.id), ['a', 'f']);
  assert.equal(r.skipped, 4);
  assert.deepEqual(splitPlottable(null), { plotted: [], skipped: 0 });
});

test('jitter is deterministic and bounded', () => {
  assert.deepEqual(jitter('abc'), jitter('abc'));
  assert.notDeepEqual(jitter('abc'), jitter('abd'));
  for (let i = 0; i < 500; i += 1) {
    const j = jitter(`song-${i}`);
    assert.ok(Math.abs(j.dx) < JITTER_YEAR && Math.abs(j.dy) < JITTER_BPM);
  }
  assert.ok(JITTER_YEAR < 0.35 && JITTER_BPM < 1.5);
});

test('makePoint keeps true values and jitters only the plotted position', () => {
  const p = makePoint(S('a', 1999, 120));
  assert.equal(p.year, 1999);
  assert.equal(p.bpm, 120);
  assert.ok(Math.abs(p.x - 1999) < 0.35 && Math.abs(p.y - 120) < 1.5);
  const q = makePoint(S('b', 1999, 120));
  assert.ok(p.x !== q.x || p.y !== q.y);
});

test('extentX pads by one year and enforces the minimum span', () => {
  assert.deepEqual(extentX([1990, 2010]), { lo: 1989, hi: 2011 });
  const one = extentX([2005]);
  assert.equal(one.hi - one.lo, MIN_YEAR_SPAN);
  assert.ok(one.lo < 2005 && one.hi > 2005);
  const close = extentX([2000, 2003]);
  assert.equal(close.hi - close.lo, MIN_YEAR_SPAN);
  assert.ok(close.lo <= 1999 && close.hi >= 2004);
  assert.equal(extentX([]).hi - extentX([]).lo, MIN_YEAR_SPAN);
});

test('extentY defaults to 60..200 and extends to include outliers with padding', () => {
  assert.deepEqual(extentY([]), { lo: 60, hi: 200 });
  assert.deepEqual(extentY([90, 150]), { lo: 60, hi: 200 });
  assert.deepEqual(extentY([30, 150]), { lo: 20, hi: 200 });
  assert.deepEqual(extentY([100, 200]), { lo: 60, hi: 200 });
  const hi = extentY([100, 230]);
  assert.equal(hi.hi, 240);
  assert.equal(extentY([10]).lo, 0);
});

test('ticks are integer, inside the range, on the step', () => {
  assert.deepEqual(ticks(60, 200, 20), [60, 80, 100, 120, 140, 160, 180, 200]);
  assert.deepEqual(ticks(1989, 2011, 5), [1990, 1995, 2000, 2005, 2010]);
  assert.equal(tickStep(140, 10), 20);
  assert.equal(tickStep(22, 10), 5);
  assert.equal(tickStep(4, 10), 1);
  assert.equal(tickStep(1000, 5), 200);
  assert.equal(tickStep(5, 100, 2), 2);
  for (const t of ticks(1989.4, 2011.2, tickStep(21.8, 8))) assert.ok(Number.isInteger(t));
});

test('makeScale maps both ways', () => {
  const s = makeScale(0, 10, 100, 200);
  assert.equal(s.to(5), 150);
  assert.equal(s.from(150), 5);
  const flip = makeScale(60, 200, 500, 100);
  assert.equal(flip.to(60), 500);
  assert.equal(flip.to(200), 100);
});

test('zoomRange keeps the anchor fixed and clamps the span', () => {
  const lim = { minSpan: 2, maxSpan: 100 };
  const z = zoomRange(1990, 2010, 2000, 0.5, lim);
  assert.equal(z.hi - z.lo, 10);
  assert.equal((2000 - z.lo) / 10, 0.5);
  assert.equal(zoomRange(1990, 2010, 1990, 0.5, lim).lo, 1990);
  const small = zoomRange(1990, 2010, 2000, 0.01, lim);
  assert.equal(small.hi - small.lo, 2);
  const big = zoomRange(1990, 2010, 2000, 50, lim);
  assert.equal(big.hi - big.lo, 100);
  assert.deepEqual(panRange(10, 20, 5), { lo: 15, hi: 25 });
});

test('grouping by decade, audio, family and none with colour keys and counts', () => {
  const pts = [makePoint(S('a', 1995, 100, { file: 'a.mp3' })), makePoint(S('b', 1999, 100, { file: null, audio_state: 'none' })),
    makePoint(S('c', 2003, 100, { file: 'c.mp3' }))];
  const dec = assignGroups(pts, 'decade');
  assert.deepEqual(dec.map((g) => [g.label, g.count, g.color]), [['1990s', 2, 0], ['2000s', 1, 1]]);
  assert.deepEqual(pts.map((p) => p.color), [0, 0, 1]);
  const aud = assignGroups(pts, 'audio');
  assert.deepEqual(aud.map((g) => [g.label, g.count, g.color]), [['Audio on server', 2, 0], ['No audio', 1, NEUTRAL]]);
  const none = assignGroups(pts, 'none');
  assert.equal(none.length, 1);
  assert.equal(pts[0].color, NEUTRAL);
  const fam = assignGroups(pts, 'family', null);
  assert.equal(fam.length, 1);
  assert.equal(fam[0].label, 'Other');
  assert.equal(fam[0].color, NEUTRAL);
});

test('family grouping uses the genre graph and falls back to Other', () => {
  const graph = { nodes: [{ id: 'q1', label: 'House', family: 'Electronic', tags: ['house'] }, { id: 'q2', label: 'Rock', family: 'Rock', tags: [] }] };
  const songs = [S('a', 2000, 120, { tags: ['genre:House', 'chill'] }), S('b', 2000, 120, { tags: ['genre:rock'] }), S('c', 2000, 120, { tags: ['genre:unknown'] })];
  const fams = songFamilies(graph, songs);
  assert.equal(fams.get('a'), 'Electronic');
  assert.equal(fams.get('b'), 'Rock');
  assert.equal(fams.has('c'), false);
  assert.equal(songFamilies(null, songs).size, 0);
  const groups = assignGroups(songs.map(makePoint), 'family', fams);
  assert.deepEqual(groups.map((g) => g.label), ['Electronic', 'Rock', 'Other']);
  assert.equal(groups[0].color, 0);
  assert.equal(groups[2].color, NEUTRAL);
  assert.equal(groupOf(songs[2], 'family', fams).label, 'Other');
});

test('colorIndex wraps into the palette and keeps neutral', () => {
  assert.equal(colorIndex(NEUTRAL), NEUTRAL);
  assert.equal(colorIndex(13), 1);
});

const grid = [{ px: 10, py: 10 }, { px: 100, py: 100 }, { px: 105, py: 100 }, { px: 300, py: 20 }];

test('grid index returns the nearest item within the hit radius', () => {
  const idx = buildIndex(grid);
  assert.equal(idx.near(12, 12, 9), 0);
  assert.equal(idx.near(103, 100, 9), 2);
  assert.equal(idx.near(101, 100, 9), 1);
  assert.equal(idx.near(200, 200, 9), -1);
  assert.equal(idx.near(10, 10, 9, (it) => it !== grid[0]), -1);
  assert.equal(buildIndex([]).near(0, 0, 9), -1);
});

test('rectangle selection is inclusive, order-insensitive and honours the filter', () => {
  assert.deepEqual(inRect(grid, { x: 0, y: 0 }, { x: 110, y: 110 }), [0, 1, 2]);
  assert.deepEqual(inRect(grid, { x: 110, y: 110 }, { x: 0, y: 0 }), [0, 1, 2]);
  assert.deepEqual(inRect(grid, { x: 100, y: 100 }, { x: 105, y: 100 }), [1, 2]);
  assert.deepEqual(inRect(grid, { x: 0, y: 0 }, { x: 110, y: 110 }, (it) => it.px > 50), [1, 2]);
  assert.deepEqual(inRect(grid, { x: 500, y: 500 }, { x: 600, y: 600 }), []);
});

test('keyboard neighbour moves to the nearest dot in the arrow direction', () => {
  const g = [{ px: 100, py: 100 }, { px: 150, py: 100 }, { px: 400, py: 100 }, { px: 100, py: 160 }, { px: 120, py: 40 }];
  assert.equal(neighbour(g, 0, 'ArrowRight'), 1);
  assert.equal(neighbour(g, 1, 'ArrowRight'), 2);
  assert.equal(neighbour(g, 2, 'ArrowRight'), 2);
  assert.equal(neighbour(g, 1, 'ArrowLeft'), 0);
  assert.equal(neighbour(g, 0, 'ArrowDown'), 3);
  assert.equal(neighbour(g, 0, 'ArrowUp'), 4);
  assert.equal(neighbour(g, 0, 'x'), 0);
  assert.equal(neighbour([], 0, 'ArrowUp'), 0);
  assert.equal(neighbour(g, 0, 'ArrowRight', (it) => it !== g[1]), 4);
  assert.equal(firstItem(g), 0);
  assert.equal(firstItem(g, (it) => it.px > 100), 4);
  assert.equal(firstItem([]), -1);
});

test('texts', () => {
  assert.equal(countText(3, 10), '3 of 10 songs plotted');
  assert.equal(skippedText(0), '');
  assert.equal(skippedText(1), '1 song without year or BPM is not shown');
  assert.equal(skippedText(7), '7 songs without year or BPM are not shown');
  assert.match(chartLabel(5), /^Scatter plot of 5 songs/);
  assert.match(chartLabel(1), /1 song:/);
});
