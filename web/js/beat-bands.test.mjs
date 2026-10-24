import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAND_COUNTS, DEFAULT_BAND_COUNT, BAND_TABLES, bandsFor, lowLaneCount, bandsHeight, laneHeight, bandRangeText, LANE_MIN_PX, LOW_LANE_MAX_HZ,
} from './beat-bands.js';

test('WEB-191: the band counts are 4, 6, 8 and 12 and the default is 6', () => {
  assert.deepEqual(BAND_COUNTS, [4, 6, 8, 12]);
  assert.equal(DEFAULT_BAND_COUNT, 6);
  assert.equal(bandsFor(99), BAND_TABLES[6]);
});

test('WEB-191: every band table is ascending, contiguous and starts at 20 Hz', () => {
  for (const n of BAND_COUNTS) {
    const bands = BAND_TABLES[n];
    assert.equal(bands.length, n);
    assert.equal(bands[0].lo, 20);
    assert.equal(bands.at(-1).hi, n === 4 ? 10000 : 16000);
    for (let i = 0; i < bands.length; i += 1) {
      assert.ok(bands[i].lo < bands[i].hi, `${n}:${i}`);
      if (i > 0) assert.equal(bands[i].lo, bands[i - 1].hi, `${n}:${i}`);
      assert.ok(bands[i].name && bands[i].range, `${n}:${i}`);
    }
  }
});

test('WEB-191: the band tables match the owner decision', () => {
  const edges = (n) => BAND_TABLES[n].map((b) => b.lo).concat(BAND_TABLES[n].at(-1).hi);
  assert.deepEqual(edges(4), [20, 60, 250, 2000, 10000]);
  assert.deepEqual(edges(6), [20, 60, 150, 400, 2000, 6000, 16000]);
  assert.deepEqual(edges(8), [20, 50, 100, 200, 400, 800, 1600, 4000, 16000]);
  assert.deepEqual(edges(12), [20, 40, 80, 150, 250, 400, 630, 1000, 1600, 2500, 4000, 8000, 16000]);
  assert.deepEqual(BAND_TABLES[6].map((b) => b.name), ['Sub', 'Bass', 'Low-mid', 'Mids', 'Presence', 'Air']);
});

test('WEB-191: the low lanes are the leading lanes whose upper edge is at most 250 Hz', () => {
  assert.deepEqual(BAND_COUNTS.map((n) => lowLaneCount(BAND_TABLES[n])), [2, 2, 3, 4]);
  for (const n of BAND_COUNTS) {
    const low = lowLaneCount(BAND_TABLES[n]);
    assert.ok(BAND_TABLES[n].slice(0, low).every((b) => b.hi <= LOW_LANE_MAX_HZ));
    assert.ok(BAND_TABLES[n].slice(low).every((b) => b.hi > LOW_LANE_MAX_HZ));
  }
});

test('WEB-191: the canvas height follows the band count within 480 to 1320 px and each lane stays at least 18 px', () => {
  assert.deepEqual(BAND_COUNTS.map(bandsHeight), [480, 612, 816, 1224]);
  assert.equal(bandsHeight(20), 1320);
  assert.equal(bandsHeight(1), 480);
  for (const n of BAND_COUNTS) assert.ok(laneHeight(bandsHeight(n), n) >= LANE_MIN_PX, String(n));
});

test('WEB-191: range text uses Hz below 1 kHz and kHz above', () => {
  assert.deepEqual(BAND_TABLES[12].map((b) => b.range), [
    '20-40 Hz', '40-80 Hz', '80-150 Hz', '150-250 Hz', '250-400 Hz', '400-630 Hz', '630-1000 Hz',
    '1-1.6 kHz', '1.6-2.5 kHz', '2.5-4 kHz', '4-8 kHz', '8-16 kHz',
  ]);
  assert.equal(bandRangeText({ lo: 20, hi: 60 }), '20-60 Hz');
});
