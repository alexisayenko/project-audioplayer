import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCollapsed, saveCollapsed } from './sidebar-state.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

test('defaults to expanded', () => assert.equal(loadCollapsed(mem()), false));
test('round-trips', () => {
  const s = mem();
  assert.equal(saveCollapsed(s, true), true);
  assert.equal(loadCollapsed(s), true);
  saveCollapsed(s, false);
  assert.equal(loadCollapsed(s), false);
});
test('failing storage is tolerated', () => {
  assert.equal(loadCollapsed(broken), false);
  assert.equal(saveCollapsed(broken, true), false);
});
