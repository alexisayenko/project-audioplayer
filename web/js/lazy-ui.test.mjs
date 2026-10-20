import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { withUi, loadUi, PENDING_DELAY_MS } = await import('./lazy-ui.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opener = () => {
  const o = { attrs: {}, notes: [], isConnected: true };
  o.setAttribute = (k, v) => { o.attrs[k] = v; };
  o.removeAttribute = (k) => { delete o.attrs[k]; };
  o.after = (n) => { o.notes.push(n); n.remove = () => { o.notes = o.notes.filter((x) => x !== n); }; };
  return o;
};

test('WEB-120: a module is loaded once and every caller gets the same module', async () => {
  let n = 0;
  const loaders = { a: async () => { n += 1; return { run: () => 'ok' }; } };
  const [x, y] = await Promise.all([loadUi('a', loaders), loadUi('a', loaders)]);
  assert.equal(n, 1);
  assert.equal(x, y);
});

test('WEB-120: a fast load shows no pending note and runs the action with the module', async () => {
  const o = opener();
  const out = await withUi('fast', o, (m) => m.run(), { fast: async () => ({ run: () => 'done' }) });
  assert.equal(out, 'done');
  await sleep(PENDING_DELAY_MS + 50);
  assert.equal(o.notes.length, 0);
  assert.deepEqual(o.attrs, {});
});

test('WEB-120: a slow load shows an inline Loading note and aria-busy, removed when the module arrives', async () => {
  const o = opener();
  let gate;
  const p = withUi('slow', o, () => 'ran', { slow: () => new Promise((r) => { gate = () => r({}); }) });
  await sleep(PENDING_DELAY_MS + 50);
  assert.equal(o.attrs['aria-busy'], 'true');
  assert.equal(o.notes.length, 1);
  assert.match(o.notes[0].textContent, /Loading/);
  gate();
  assert.equal(await p, 'ran');
  assert.equal(o.notes.length, 0);
  assert.equal(o.attrs['aria-busy'], undefined);
});

test('WEB-120: a failed load shows an inline error, does not run the action and is retried on the next call', async () => {
  const o = opener();
  let calls = 0;
  const loaders = { flaky: async () => { calls += 1; if (calls === 1) throw new Error('net'); return { ok: 1 }; } };
  let ran = 0;
  await withUi('flaky', o, () => { ran += 1; }, loaders);
  assert.equal(ran, 0);
  assert.match(o.notes[0].textContent, /Could not load/);
  await withUi('flaky', o, () => { ran += 1; }, loaders);
  assert.equal(ran, 1);
  assert.equal(calls, 2);
});
