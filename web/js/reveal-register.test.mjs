import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './test-dom.mjs';

installDom();
globalThis.location = { hash: '' };
const { registerRevealer, requestReveal } = await import('./reveal.js');

test('request before a revealer exists navigates to the library and replays on register', async () => {
  requestReveal('s1');
  assert.equal(location.hash, '#/library');
  const got = [];
  const off = registerRevealer((id) => got.push(id));
  await flush();
  assert.deepEqual(got, ['s1']);
  const again = [];
  registerRevealer((id) => again.push(id));
  await flush();
  assert.deepEqual(again, [], 'pending request is consumed once');
  off();
});

test('with a live revealer the request is delivered at once without navigation', () => {
  location.hash = '#/queue';
  const got = [];
  const off = registerRevealer((id) => got.push(id));
  requestReveal('s2');
  assert.deepEqual(got, ['s2']);
  assert.equal(location.hash, '#/queue');
  off();
});

test('unregistering a stale revealer does not remove a newer one', () => {
  const a = [];
  const b = [];
  const offA = registerRevealer((id) => a.push(id));
  const offB = registerRevealer((id) => b.push(id));
  offA();
  requestReveal('s3');
  assert.deepEqual(b, ['s3']);
  assert.deepEqual(a, []);
  offB();
});
