import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAND_COUNTS, DEFAULT_BAND_COUNT, BAND_TABLES, bandsFor, lowLaneCount, bandsHeight, laneHeight, bandRangeText, LANE_MIN_PX, LOW_LANE_MAX_HZ,
  LANE_ENV_RATE, LANE_RATIOS, laneRelation, laneEnvelope, laneScratch, estimateLane, laneBpmText, laneConfidence, laneTitle,
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

const hits = (period, seconds = 10, step = 1 / 60) => {
  const points = [];
  let next = period;
  for (let t = 0; t <= seconds; t += step) {
    const onset = t >= next;
    if (onset) next += period;
    points.push({ t, db: -40, onset, strength: onset ? 12 : 0 });
  }
  return points;
};

test('WEB-191: the ratio chip rule names x2, x4, x1/2, x1/4 and x3/2 within 3 percent and shows none for the main beat itself', () => {
  assert.deepEqual(LANE_RATIOS.map((r) => r.chip), ['x2', 'x4', 'x1/2', 'x1/4', 'x3/2']);
  const rel = (bpm) => laneRelation(120, bpm);
  assert.deepEqual([240, 480, 60, 30, 180].map((b) => rel(b).chip), ['x2', 'x4', 'x1/2', 'x1/4', 'x3/2']);
  assert.deepEqual([120, 121, 116.5].map((b) => [rel(b).kind, rel(b).chip]), [['same', ''], ['same', ''], ['same', '']]);
  assert.equal(rel(247).chip, 'x2');
  assert.equal(rel(234).chip, 'x2');
  assert.equal(rel(250).kind, 'other');
  assert.equal(rel(90).kind, 'other');
  assert.equal(rel(90).chip, '');
  assert.equal(rel(240).tip, 'twice the main beat');
});

test('WEB-191: without a main BPM or a lane BPM there is no chip and no highlight', () => {
  assert.equal(laneRelation(0, 240).kind, 'none');
  assert.equal(laneRelation(null, 240).chip, '');
  assert.equal(laneRelation(120, 0).kind, 'none');
});

test('WEB-191: the lane envelope puts each onset of the last 8 s on a 200 Hz grid and needs 8 s of history', () => {
  const out = laneScratch();
  assert.equal(out.length, 8 * LANE_ENV_RATE);
  assert.equal(laneEnvelope(hits(0.5, 5), LANE_ENV_RATE, 8, out), false);
  assert.equal(laneEnvelope(hits(0.5, 10), LANE_ENV_RATE, 8, out), true);
  const marked = out.filter((v) => v > 0).length;
  assert.ok(marked >= 15 && marked <= 16);
});

test('WEB-191: a lane of regular hits reads their rate, a lane of irregular hits reads nothing', () => {
  const out = laneScratch();
  assert.ok(Math.abs(estimateLane(hits(0.5), out).bpm - 120) < 0.5);
  assert.ok(Math.abs(estimateLane(hits(0.25), out).bpm - 240) < 1);
  assert.ok(Math.abs(estimateLane(hits(1), out).bpm - 60) < 0.5);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const points = [];
  let next = 0.3;
  for (let t = 0; t <= 10; t += 1 / 60) {
    const onset = t >= next;
    if (onset) next += 0.15 + rnd() * 0.9;
    points.push({ t, db: -40, onset, strength: onset ? 12 : 0 });
  }
  assert.equal(estimateLane(points, out), null);
  assert.equal(estimateLane([], out), null);
});

test('WEB-191: the lane readout uses the badge decimals, a confidence percent and a title with the chip meaning', () => {
  const band = BAND_TABLES[6][5];
  assert.equal(laneBpmText({ bpm: 120.04 }), '120.0');
  assert.equal(laneBpmText({ bpm: 240.4 }), '240');
  assert.equal(laneBpmText(null), '-');
  assert.equal(laneConfidence({ confidence: 0.874 }), 87);
  assert.equal(laneConfidence(null), 0);
  const res = { bpm: 240, confidence: 0.9 };
  assert.equal(laneTitle(band, res, laneRelation(120, 240)), 'Air 6-16 kHz: 240 BPM, confidence 90 percent, x2: twice the main beat');
  assert.equal(laneTitle(band, res, laneRelation(0, 240)), 'Air 6-16 kHz: 240 BPM, confidence 90 percent');
  assert.match(laneTitle(band, null, laneRelation(120, 0)), /No regular pattern in the last 8 s/);
});
