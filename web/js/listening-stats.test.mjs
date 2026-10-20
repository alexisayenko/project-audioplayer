import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTotal, formatDay, hasListening, listeningRows, getListening, resetListeningForTests, invalidateListening, TTL_MS } from './listening-stats.js';

test('LIB-195: total listened is shown as h and min', () => {
  assert.equal(formatTotal(7500), '2 h 5 min');
  assert.equal(formatTotal(720), '12 min');
  assert.equal(formatTotal(7200), '2 h');
  assert.equal(formatTotal(30), 'under 1 min');
  assert.equal(formatTotal(0), '0 min');
});

test('LIB-195: last listened is a date without time', () => {
  assert.match(formatDay('2026-10-21'), /2026/);
  assert.doesNotMatch(formatDay('2026-10-21'), /:/);
  assert.equal(formatDay('garbage'), 'garbage');
});

test('LIB-195: a song without any data shows nothing; rows have four cells', () => {
  assert.equal(hasListening(undefined), false);
  assert.equal(hasListening({ listened: { today: 0, d7: 0, d30: 0, all: 0 }, skipped: { all: 0 }, total_listened_s: 0 }), false);
  const e = { listened: { today: 1, d7: 2, d30: 3, all: 4 }, skipped: { today: 0, d7: 0, d30: 1, all: 1 }, total_listened_s: 600 };
  assert.equal(hasListening(e), true);
  const rows = listeningRows(e);
  assert.deepEqual(rows[0].cells, ['1', '2', '3', '4']);
  assert.deepEqual(rows[1].cells, ['0', '0', '1', '1']);
});

test('LIB-196: the response is cached for the page session and refreshed after invalidation', async () => {
  resetListeningForTests();
  let n = 0;
  let t = 1000;
  const load = async () => { n += 1; return { songs: { a: { total_listened_s: n } } }; };
  const now = () => t;
  await Promise.all([getListening({ load, now }), getListening({ load, now })]);
  assert.equal(n, 1);
  await getListening({ load, now });
  assert.equal(n, 1);
  invalidateListening();
  const d = await getListening({ load, now });
  assert.equal(n, 2);
  assert.equal(d.a.total_listened_s, 2);
  t += TTL_MS + 1;
  await getListening({ load, now });
  assert.equal(n, 3);
});
