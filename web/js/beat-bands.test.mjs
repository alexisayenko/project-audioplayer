import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAND_COUNTS, DEFAULT_BAND_COUNT, BAND_TABLES, bandsFor, lowLaneCount, bandsHeight, laneHeight, bandRangeText, LANE_MIN_PX, LOW_LANE_MAX_HZ,
  LANE_RATIOS, LANE_WINDOWS_S, LANE_WINDOW_DEFAULT_S, LANE_HISTORY_S, laneWindowFor, laneCaption, laneNoDataTip,
  laneRelation, estimateLane, laneBpmText, laneConfidence, laneTitle,
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

const hits = (period, seconds = 30, start = period) => {
  const onsets = [];
  for (let t = start; t <= seconds; t += period) onsets.push({ t, strength: 12 });
  return onsets;
};

const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const poissonHits = (rate, seconds, seed) => {
  const rnd = lcg(seed);
  const onsets = [];
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rnd()) / rate;
    if (t > seconds) return onsets;
    if (!onsets.length || t - onsets.at(-1).t >= 0.12) onsets.push({ t, strength: 6 + rnd() * 8 });
  }
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

test('WEB-191: the lane BPM window offers 1, 4, 8, 15 and 30 s, defaults to 4 s and keeps 30 s of onsets', () => {
  assert.deepEqual([...LANE_WINDOWS_S], [1, 4, 8, 15, 30]);
  assert.equal(LANE_WINDOW_DEFAULT_S, 4);
  assert.equal(LANE_HISTORY_S, Math.max(...LANE_WINDOWS_S));
  assert.equal(laneWindowFor(15), 15);
  assert.equal(laneWindowFor(7), 4);
  assert.equal(laneWindowFor(), 4);
  assert.match(laneCaption(15), /over the last 15 s/);
  assert.match(laneNoDataTip(30), /in the last 30 s/);
});

test('WEB-191: a lane waits for a full window of history before it reads anything', () => {
  const onsets = hits(0.5, 3.5);
  assert.equal(estimateLane(onsets, 3.5, 0, 4), null);
  assert.ok(Math.abs(estimateLane(hits(0.5, 4.2), 4.2, 0, 4).bpm - 120) < 0.5);
  assert.equal(estimateLane(hits(0.5, 30), 30, 28, 4), null);
  assert.equal(estimateLane([], 30, 0, 4), null);
});

test('WEB-191: a lane of regular hits reads their rate for every window that holds four periods', () => {
  for (const w of [4, 8, 15, 30]) {
    assert.ok(Math.abs(estimateLane(hits(0.5), 30, 0, w).bpm - 120) < 0.5, `120 in ${w}`);
    assert.ok(Math.abs(estimateLane(hits(0.25), 30, 0, w).bpm - 240) < 1, `240 in ${w}`);
  }
  assert.equal(estimateLane(hits(1), 30, 0, 4), null);
  for (const w of [8, 15, 30]) assert.ok(Math.abs(estimateLane(hits(1), 30, 0, w).bpm - 60) < 0.5, `60 in ${w}`);
  assert.equal(estimateLane(hits(0.5), 30, 0, 1), null);
  assert.equal(estimateLane(hits(0.3), 30, 0, 1), null);
  assert.ok(Math.abs(estimateLane(hits(0.24), 30, 0, 1).bpm - 250) < 1);
});

test('WEB-191: a lane of hits with dropouts, extras and timing jitter still reads the period', () => {
  const rnd = lcg(5);
  const onsets = [];
  for (let t = 0.2; t < 30; t += 0.42) {
    if (rnd() < 0.85) onsets.push({ t: t + (rnd() * 2 - 1) * 0.02, strength: 6 + rnd() * 8 });
    if (rnd() < 0.15) onsets.push({ t: t + 0.42 * (0.25 + 0.5 * rnd()), strength: 6 + rnd() * 8 });
  }
  onsets.sort((a, b) => a.t - b.t);
  const spaced = onsets.filter((o, i) => i === 0 || o.t - onsets[i - 1].t >= 0.12);
  for (const w of [8, 15, 30]) {
    const res = estimateLane(spaced, 30, 0, w);
    assert.ok(res && Math.abs(res.bpm / (60 / 0.42) - 1) < 0.03, `143 in ${w}`);
    assert.ok(res.confidence >= 0.4);
  }
});

test('WEB-191: random hits read nothing in at least 95 percent of 200 trials for every window', () => {
  for (const w of LANE_WINDOWS_S) {
    let reads = 0;
    for (let seed = 1; seed <= 200; seed += 1) if (estimateLane(poissonHits(2.4, 45, seed * 7919), 45, 0, w)) reads += 1;
    assert.ok(reads <= 10, `${w} s: ${reads} false readings`);
  }
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
  assert.match(laneTitle(band, null, laneRelation(120, 0)), /No regular pattern in the last 4 s/);
  assert.match(laneTitle(band, null, laneRelation(120, 0), 15), /No regular pattern in the last 15 s/);
});
