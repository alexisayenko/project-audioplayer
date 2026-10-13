import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtBytes, usageText, friendly } from './limits.js';

test('limits', () => {
  const GB = 1024 ** 3;
  assert.equal(fmtBytes(0), '0 KB');
  assert.equal(fmtBytes(5 * 1024 ** 2), '5 MB');
  assert.equal(fmtBytes(1.5 * GB), '1.5 GB');
  assert.equal(fmtBytes(5 * GB), '5.0 GB');
  assert.equal(fmtBytes(150 * GB), '150 GB');

  assert.equal(usageText({ songs: 12, max_songs: 500, bytes: 1.2 * GB, max_bytes: 5 * GB }), '12 / 500 songs · 1.2 GB / 5.0 GB');
  assert.equal(usageText({ songs: 3, max_songs: null, bytes: 2 * 1024 ** 2, max_bytes: null }), '3 songs · 2 MB');

  assert.equal(friendly('hourly_limit', { retry_after_minutes: 12 }, 'x'), 'Hourly limit reached. Try again in 12 minutes.');
  assert.equal(friendly('hourly_limit', { retry_after_minutes: 1 }, 'x'), 'Hourly limit reached. Try again in 1 minute.');
  assert.equal(friendly('hourly_limit', {}, 'x'), 'Hourly limit reached. Try again in 1 minute.');
  assert.match(friendly('library_full_songs', {}, 'x'), /library is full/);
  assert.match(friendly('library_full_bytes', {}, 'x'), /storage is full/);
  assert.match(friendly('server_full', {}, 'x'), /out of storage/);
  assert.match(friendly('signup_closed', {}, 'x'), /closed/);
  assert.equal(friendly('other', {}, 'fallback'), 'fallback');
  assert.equal(friendly('', null, 'fallback'), 'fallback');
  console.log('limits.test.mjs ok');
});
