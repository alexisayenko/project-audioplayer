import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const { slowConnection, readTier2, prefetchModules, startBackgroundLoad } = await import('./prefetch.js');

function fakeWin(list, { ready = true } = {}) {
  const links = [];
  const batches = [];
  const head = { append: (l) => { links.push(l); queueMicrotask(() => l.fire('load')); } };
  const doc = {
    readyState: ready ? 'complete' : 'loading',
    head,
    getElementById: (id) => (id === 'tier2-modules' && list ? { textContent: JSON.stringify(list) } : null),
    querySelectorAll: () => [],
    createElement: () => {
      const handlers = {};
      return { rel: '', href: '', addEventListener: (n, f) => { handlers[n] = f; }, fire: (n) => handlers[n]?.() };
    },
  };
  const win = { document: doc, navigator: {}, requestIdleCallback: (f) => { batches.push(links.length); queueMicrotask(f); }, setTimeout, addEventListener() {}, removeEventListener() {} };
  return { win, links, batches };
}

test('WEB-121: no background load on data saver, 2g and slow-2g', () => {
  assert.equal(slowConnection({ saveData: true }), true);
  assert.equal(slowConnection({ effectiveType: '2g' }), true);
  assert.equal(slowConnection({ effectiveType: 'slow-2g' }), true);
  assert.equal(slowConnection({ effectiveType: '4g' }), false);
  assert.equal(slowConnection(undefined), false);
});

test('WEB-121: the tier-2 list is read from the page and a broken one is empty', () => {
  assert.deepEqual(readTier2({ getElementById: () => ({ textContent: '["a","b",3]' }) }), ['a', 'b']);
  assert.deepEqual(readTier2({ getElementById: () => ({ textContent: '{oops' }) }), []);
  assert.deepEqual(readTier2({ getElementById: () => null }), []);
});

test('WEB-121: modules are warmed up with modulepreload in small batches, one idle slot per batch', async () => {
  const list = Array.from({ length: 14 }, (_, i) => `_v/x/js/m${i}.js`);
  const { win, links, batches } = fakeWin(list);
  await prefetchModules(list, { win, batch: 6 });
  assert.deepEqual(links.map((l) => l.href), list);
  assert.ok(links.every((l) => l.rel === 'modulepreload'));
  assert.deepEqual(batches, [0, 6, 12]);
});

test('WEB-121: the background load starts after load, and not at all on a slow connection or without a list', async () => {
  const a = fakeWin(['_v/x/js/a.js', '_v/x/js/b.js']);
  assert.equal(await startBackgroundLoad({ win: a.win, conn: { effectiveType: '4g' } }), true);
  assert.equal(a.links.length, 2);
  const b = fakeWin(['_v/x/js/a.js']);
  assert.equal(await startBackgroundLoad({ win: b.win, conn: { saveData: true } }), false);
  assert.equal(b.links.length, 0);
  const c = fakeWin(null);
  assert.equal(await startBackgroundLoad({ win: c.win, conn: {} }), false);
});

test('WEB-121: no new batch starts while a click is loading a module; in-flight links are left alone', async () => {
  const { beginClickLoad } = await import('./load-gate.js');
  const list = Array.from({ length: 12 }, (_, i) => `_v/x/js/g${i}.js`);
  const { win, links } = fakeWin(list);
  const end = beginClickLoad();
  const run = prefetchModules(list, { win, batch: 6 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(links.length, 0);
  end();
  await run;
  assert.equal(links.length, 12);
});
