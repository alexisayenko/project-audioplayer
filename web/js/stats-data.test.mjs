import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validBpm, validYear, clampLo, splitPlottable, jitter, makePoint, extentX, extentY, tickStep, ticks, makeScale, zoomRange, panRange, centerRange, assignGroups, songFamilies, songFamily, DEFAULT_MODE,
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
  assert.deepEqual(panRange(10, 20, -3, { lo: 0, hi: 100 }), { lo: 7, hi: 17 });
  assert.deepEqual(panRange(10, 20, 500, { lo: 0, hi: 100 }), { lo: 95, hi: 105 });
  assert.deepEqual(panRange(10, 20, -500, { lo: 0, hi: 100 }), { lo: -5, hi: 5 });
  assert.deepEqual(panRange(0, 300, 40, { lo: 100, hi: 120 }), { lo: -30, hi: 270 });
  const b = { lo: 1990, hi: 2020 };
  for (const target of [1990, 2005, 2020]) {
    const r = panRange(2000, 2010, target - 2005 + 0, b);
    assert.ok(r.lo + 5 >= b.lo && r.lo + 5 <= b.hi);
    const toTarget = panRange(2000, 2010, target - 2005, b);
    assert.equal((toTarget.lo + toTarget.hi) / 2, target);
  }
  assert.equal((panRange(2000, 2010, -999, b).lo + 5), 1990);
  assert.equal((panRange(2000, 2010, 999, b).lo + 5), 2020);
  const c = centerRange(1995, 2000, b);
  assert.equal(c.hi - c.lo, 5);
  assert.equal((c.lo + c.hi) / 2, 2005);
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
  const pending = assignGroups(pts, 'family', null);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].label, 'All songs');
  assert.equal(pending[0].color, NEUTRAL);
  const fam = assignGroups(pts, 'family', new Map());
  assert.equal(fam.length, 1);
  assert.equal(fam[0].label, 'Other');
  assert.equal(fam[0].color, 15);
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
  assert.equal(groups[2].color, 15);
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

const GRAPH = {
  nodes: [
    { id: 'q1', label: 'House', family: 'Electronic', tags: ['house'] },
    { id: 'q2', label: 'Drum and bass', family: 'Electronic', tags: [] },
    { id: 'q3', label: 'Rock', family: 'Rock', tags: ['rock'] },
    { id: 'q4', label: 'Jazz', family: 'Jazz', tags: ['jazz'] },
  ],
};

test('songFamily takes the family of the first genre tag that resolves', () => {
  assert.equal(songFamily(S('a', 2000, 1, { tags: ['genre:zouk', 'genre:rock', 'genre:house'] }), GRAPH), 'Rock');
  assert.equal(songFamily(S('a', 2000, 1, { tags: ['genre:house', 'genre:rock'] }), GRAPH), 'Electronic');
  assert.equal(songFamily(S('a', 2000, 1, { tags: ['genre:  DRUM   and Bass '] }), GRAPH), 'Electronic');
  assert.equal(songFamily(S('a', 2000, 1, { tags: ['country:lt', 'rock'] }), GRAPH), 'Other');
});

test('songFamily accepts a legacy plain genre after the tags, and falls back to Other', () => {
  assert.equal(songFamily(S('a', 2000, 1, { genre: 'Jazz' }), GRAPH), 'Jazz');
  assert.equal(songFamily(S('a', 2000, 1, { genre: 'Jazz', tags: ['genre:rock'] }), GRAPH), 'Rock');
  assert.equal(songFamily(S('a', 2000, 1, { genre: 'nonsense' }), GRAPH), 'Other');
  assert.equal(songFamily(S('a', 2000, 1), GRAPH), 'Other');
  assert.equal(songFamily(S('a', 2000, 1, { tags: ['genre:house'] }), null), 'Other');
  assert.equal(songFamily(null, GRAPH), 'Other');
});

test('family legend counts sort by count with Other last and colours follow the Genres map family index', () => {
  const songs = [
    S('1', 2000, 100, { tags: ['genre:jazz'] }), S('2', 2000, 100, { tags: ['genre:rock'] }), S('3', 2000, 100, { tags: ['genre:rock'] }),
    S('4', 2000, 100, { tags: ['genre:house'] }), S('5', 2000, 100, { tags: ['genre:house'] }), S('6', 2000, 100, { tags: ['genre:house'] }),
    S('7', 2000, 100), S('8', 2000, 100), S('9', 2000, 100), S('10', 2000, 100),
  ];
  const groups = assignGroups(songs.map(makePoint), 'family', songFamilies(GRAPH, songs));
  assert.deepEqual(groups.map((g) => [g.label, g.count, g.color]), [['Electronic', 3, 0], ['Rock', 2, 1], ['Jazz', 1, 4], ['Other', 4, 15]]);
});

test('recolouring keeps point positions and the points array', () => {
  const pts = [makePoint(S('a', 1995, 100, { tags: ['genre:rock'] })), makePoint(S('b', 2005, 130, { tags: ['genre:jazz'] }))];
  const before = pts.map((p) => [p.x, p.y]);
  const ref = pts;
  assignGroups(pts, 'family', new Map());
  const colours = pts.map((p) => p.color);
  assignGroups(pts, 'family', songFamilies(GRAPH, pts.map((p) => p.song)));
  assert.equal(pts, ref);
  assert.deepEqual(pts.map((p) => [p.x, p.y]), before);
  assert.notDeepEqual(pts.map((p) => p.color), colours);
});

test('the default colour mode is the genre family', () => {
  assert.equal(DEFAULT_MODE, 'family');
});

test('validBpm accepts only finite numbers within 20..300', () => {
  for (const v of [0, -5, 19, 301, NaN, Infinity, null, undefined, '120', [], {}]) assert.equal(validBpm(v), false, String(v));
  for (const v of [20, 120, 140.5, 300]) assert.equal(validBpm(v), true, String(v));
});

test('validYear accepts only 1900..next year', () => {
  const max = new Date().getFullYear() + 1;
  for (const v of [0, null, undefined, '2000', NaN, 1899, max + 1]) assert.equal(validYear(v), false, String(v));
  for (const v of [1900, 1999, max]) assert.equal(validYear(v), true, String(v));
});

test('a song with BPM 0 among valid ones is counted as missing, not plotted', () => {
  const r = splitPlottable([S('a', 1999, 120), S('z', 2000, 0), S('n', 2001, null), S('s', 2002, '120'), S('lo', 2003, 19), S('hi', 2004, 301), S('b', 2005, 20), S('c', 2006, 300), S('y0', 0, 120)]);
  assert.deepEqual(r.plotted.map((s) => s.id), ['a', 'b', 'c']);
  assert.equal(r.skipped, 6);
  assert.equal(skippedText(r.skipped), '6 songs without year or BPM are not shown');
  const e = extentY(r.plotted.map((s) => s.bpm));
  assert.ok(e.lo >= 0);
});

test('y extent and ticks never go below 0 and start on a multiple of 20', () => {
  assert.deepEqual(extentY([]), { lo: 60, hi: 200 });
  assert.equal(extentY([20]).lo, 0);
  assert.ok(ticks(0, 200, 20)[0] === 0 && ticks(-7, 200, 20)[0] === 0);
  assert.deepEqual(ticks(5, 100, 20), [20, 40, 60, 80, 100]);
});

test('clampLo keeps the span and shifts a range that dips below 0', () => {
  assert.deepEqual(clampLo({ lo: -30, hi: 70 }), { lo: 0, hi: 100 });
  assert.deepEqual(clampLo({ lo: 10, hi: 70 }), { lo: 10, hi: 70 });
  const v = clampLo(panRange(20, 120, -500, { lo: 0, hi: 200 }));
  assert.ok(v.lo >= 0 && v.hi - v.lo === 100);
});

test('stats plot a version at its version year', () => {
  const v = S('v', 1985, 120, { remix_year: 2012 });
  assert.equal(makePoint(v).year, 2012);
  assert.equal(splitPlottable([S('n', null, 120, { remix_year: 2012 })]).plotted.length, 1);
});
