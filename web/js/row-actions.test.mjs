import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowActions } from './row-actions.js';

test('rowActions', () => {
  assert.deepEqual(rowActions({ audio: true, link: null, ring: null }), { ring: false, source: false, download: false });
  assert.deepEqual(rowActions({ audio: false, link: { url: 'u' }, ring: null }), { ring: false, source: true, download: true });
  assert.deepEqual(rowActions({ audio: false, link: null, ring: null }), { ring: false, source: false, download: true });
  assert.deepEqual(rowActions({ audio: false, link: { url: 'u' }, ring: { kind: 'running' } }), { ring: true, source: false, download: false });
});
