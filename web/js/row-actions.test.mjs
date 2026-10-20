import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowActions } from './row-actions.js';

test('rowActions', () => {
  assert.deepEqual(rowActions({ audio: true, ring: null }), { ring: false, download: false });
  assert.deepEqual(rowActions({ audio: false, ring: null }), { ring: false, download: true });
  assert.deepEqual(rowActions({ audio: false, ring: { kind: 'running' } }), { ring: true, download: false });
});
